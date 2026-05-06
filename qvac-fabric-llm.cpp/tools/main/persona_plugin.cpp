#include "persona_plugin.h"
#include "log.h"

#include <ggml.h>

#include <algorithm>
#include <cinttypes>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>

static std::string build_tensor_name(int layer, const char * suffix_buf) {
    std::string s(suffix_buf);
    const size_t n = s.find('\0');
    if (n != std::string::npos) {
        s.resize(n);
    }
    while (!s.empty() && (s.back() == ' ' || s.back() == '\0')) {
        s.pop_back();
    }
    if (s.size() >= 4 && s.compare(0, 4, "blk.") == 0) {
        return s;
    }
    char buf[256];
    snprintf(buf, sizeof(buf), "blk.%d.%s", layer, s.c_str());
    return std::string(buf);
}

static bool read_file_all(const std::string & path, std::vector<uint8_t> & out) {
    std::ifstream f(path, std::ios::binary | std::ios::ate);
    if (!f) {
        return false;
    }
    const auto sz = f.tellg();
    if (sz < 0) {
        return false;
    }
    out.resize(static_cast<size_t>(sz));
    f.seekg(0);
    if (!f.read(reinterpret_cast<char *>(out.data()), sz)) {
        return false;
    }
    return true;
}

bool persona_session::apply_from_file(struct llama_model * mdl, const std::string & path, int layer_override, const std::string & default_suffix) {
    rollback();
    model = mdl;

    std::vector<uint8_t> file_data;
    if (!read_file_all(path, file_data) || file_data.size() < 128) {
        LOG_ERR("%s: failed to read persona plugin or file too small: %s\n", __func__, path.c_str());
        return false;
    }

    if (memcmp(file_data.data(), "QVP1", 4) != 0) {
        LOG_ERR("%s: bad magic (expected QVP1): %s\n", __func__, path.c_str());
        return false;
    }

    uint32_t version = 0;
    uint32_t merge_mode = 0;
    uint32_t layer = 0;
    uint32_t reserved = 0;
    memcpy(&version, file_data.data() + 4, 4);
    memcpy(&merge_mode, file_data.data() + 8, 4);
    memcpy(&layer, file_data.data() + 12, 4);
    memcpy(&reserved, file_data.data() + 16, 4);

    char suffix_storage[64];
    memset(suffix_storage, 0, sizeof(suffix_storage));
    memcpy(suffix_storage, file_data.data() + 20, 64);

    float delta_scale = 0.f;
    memcpy(&delta_scale, file_data.data() + 84, 4);

    uint64_t payload_size = 0;
    memcpy(&payload_size, file_data.data() + 88, 8);

    if (version != 1) {
        LOG_ERR("%s: unsupported plugin version %u\n", __func__, version);
        return false;
    }

    const int eff_layer = layer_override >= 0 ? layer_override : (int) layer;
    if (suffix_storage[0] == '\0' && !default_suffix.empty()) {
        snprintf(suffix_storage, sizeof(suffix_storage), "%s", default_suffix.c_str());
    }
    std::string tensor_name = build_tensor_name(eff_layer, suffix_storage);

    tensor = llama_model_get_tensor(model, tensor_name.c_str());
    if (!tensor) {
        LOG_ERR("%s: tensor not found: %s\n", __func__, tensor_name.c_str());
        return false;
    }

    const size_t nb = ggml_nbytes(tensor);
    const void * src = file_data.data() + 128;
    const size_t avail = file_data.size() - 128;
    if (avail < payload_size) {
        LOG_ERR("%s: truncated payload (have %zu need %" PRIu64 ")\n", __func__, avail, payload_size);
        return false;
    }

    void * w = ggml_get_data(tensor);
    if (!w) {
        LOG_ERR("%s: ggml_get_data returned NULL (tensor on device?)\n", __func__);
        return false;
    }

    backup.resize(nb);
    memcpy(backup.data(), w, nb);

    if (merge_mode == 0) {
        if (payload_size != nb) {
            LOG_ERR("%s: raw merge_mode 0 requires payload_size (%" PRIu64 ") == ggml_nbytes (%zu)\n", __func__, payload_size, nb);
            memcpy(w, backup.data(), nb);
            backup.clear();
            tensor = nullptr;
            model = nullptr;
            return false;
        }
        memcpy(w, src, nb);
    } else if (merge_mode == 1) {
        if (ggml_get_tensor_type(tensor) != GGML_TYPE_F32) {
            LOG_ERR("%s: merge_mode 1 requires F32 tensor, got type %d\n", __func__, (int) ggml_get_tensor_type(tensor));
            memcpy(w, backup.data(), nb);
            backup.clear();
            tensor = nullptr;
            model = nullptr;
            return false;
        }
        const int64_t ne = ggml_nelements(tensor);
        if (payload_size != (uint64_t) ne) {
            LOG_ERR("%s: merge_mode 1 payload_size %" PRIu64 " != nelements %" PRId64 "\n", __func__, payload_size, ne);
            memcpy(w, backup.data(), nb);
            backup.clear();
            tensor = nullptr;
            model = nullptr;
            return false;
        }
        float * wf = static_cast<float *>(w);
        const auto * plug = static_cast<const int8_t *>(src);
        for (int64_t i = 0; i < ne; ++i) {
            int8_t t = plug[i];
            if (t < -1) {
                t = -1;
            }
            if (t > 1) {
                t = 1;
            }
            wf[i] += delta_scale * static_cast<float>(t);
        }
    } else {
        LOG_ERR("%s: unknown merge_mode %u\n", __func__, merge_mode);
        backup.clear();
        tensor = nullptr;
        model = nullptr;
        return false;
    }

    active = true;
    LOG_INF("%s: applied persona plugin to %s (merge_mode=%u)\n", __func__, tensor_name.c_str(), merge_mode);
    return true;
}

void persona_session::rollback() {
    if (!active || !tensor || backup.empty()) {
        active = false;
        tensor = nullptr;
        model = nullptr;
        backup.clear();
        return;
    }
    void * w = ggml_get_data(tensor);
    if (w) {
        memcpy(w, backup.data(), backup.size());
    }
    LOG_INF("%s: restored base weights for persona tensor\n", __func__);
    active = false;
    tensor = nullptr;
    model = nullptr;
    backup.clear();
}

bool persona_session::dry_run_tensor(struct llama_model * mdl, const std::string & tensor_name) {
    struct ggml_tensor * t = llama_model_get_tensor(mdl, tensor_name.c_str());
    if (!t) {
        LOG_ERR("%s: tensor not found: %s\n", __func__, tensor_name.c_str());
        return false;
    }
    LOG_INF("%s: tensor %s type=%d nelements=%" PRId64 " nbytes=%zu\n", __func__, tensor_name.c_str(),
            (int) ggml_get_tensor_type(t), ggml_nelements(t), ggml_nbytes(t));

    void * w = ggml_get_data(t);
    if (!w) {
        LOG_ERR("%s: no host pointer\n", __func__);
        return false;
    }
    const size_t nb = ggml_nbytes(t);
    std::vector<uint8_t> snap(nb);
    memcpy(snap.data(), w, nb);
    memcpy(w, snap.data(), nb);
    return memcmp(snap.data(), w, nb) == 0;
}
