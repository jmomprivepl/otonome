#include "qvac_memory_patcher.hpp"
#include "log.h"

#include <ggml.h>

#include <algorithm>
#include <cctype>
#include <cinttypes>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <sstream>

namespace qvac_memory_patcher {

namespace {

static std::string trim(std::string s) {
    while (!s.empty() && std::isspace(static_cast<unsigned char>(s.front()))) {
        s.erase(s.begin());
    }
    while (!s.empty() && std::isspace(static_cast<unsigned char>(s.back()))) {
        s.pop_back();
    }
    return s;
}

} // namespace

std::string make_nsdar_tensor_name(int layer, const std::string & suffix) {
    if (suffix.size() >= 4 && suffix.compare(0, 4, "blk.") == 0) {
        return suffix;
    }
    char buf[512];
    std::snprintf(buf, sizeof(buf), "blk.%d.%s", layer, suffix.c_str());
    return std::string(buf);
}

std::vector<int8_t> parse_nsdar_vector(const std::string & s, std::string & err_msg) {
    err_msg.clear();
    std::vector<int8_t> out;
    if (trim(s).empty()) {
        err_msg = "empty --nsdar-vector";
        return out;
    }
    std::stringstream ss(s);
    std::string item;
    while (std::getline(ss, item, ',')) {
        item = trim(item);
        if (item.empty()) {
            continue;
        }
        int v = 0;
        try {
            v = std::stoi(item);
        } catch (...) {
            err_msg = "invalid token in --nsdar-vector: " + item;
            out.clear();
            return out;
        }
        if (v < -1 || v > 1) {
            err_msg = "coefficient must be -1, 0, or 1: " + item;
            out.clear();
            return out;
        }
        out.push_back(static_cast<int8_t>(v));
    }
    if (out.empty()) {
        err_msg = "no coefficients parsed from --nsdar-vector";
    }
    return out;
}

bool session::init(struct llama_model * mdl, const std::string & tensor_name) {
    model = mdl;
    tensor = llama_model_get_tensor(mdl, tensor_name.c_str());
    if (!tensor) {
        LOG_ERR("%s: tensor not found: %s\n", __func__, tensor_name.c_str());
        return false;
    }
    return true;
}

bool session::apply(const std::vector<int8_t> & coeffs, const std::string & adapters_dir, std::string & err_msg) {
    err_msg.clear();
    if (!tensor || !model) {
        err_msg = "session not initialized";
        return false;
    }
    void * raw = ggml_get_data(tensor);
    if (!raw) {
        err_msg = "ggml_get_data returned NULL (weights not host-accessible?)";
        LOG_ERR("%s: %s\n", __func__, err_msg.c_str());
        return false;
    }
    if (ggml_type(tensor) != GGML_TYPE_F32) {
        err_msg = "NSDAR merge requires F32 target tensor; use an F32 checkpoint or a different block";
        LOG_ERR("%s: %s\n", __func__, err_msg.c_str());
        return false;
    }

    const int64_t ne = ggml_nelements(tensor);
    const size_t nb = ggml_nbytes(tensor);
    if (ne <= 0 || nb != static_cast<size_t>(ne) * sizeof(float)) {
        err_msg = "unexpected tensor size / type layout";
        LOG_ERR("%s: %s (ne=%" PRId64 " nb=%zu)\n", __func__, err_msg.c_str(), ne, nb);
        return false;
    }

    backup.resize(nb);
    std::memcpy(backup.data(), raw, nb);

    float * w = reinterpret_cast<float *>(raw);
    // Restore pristine weights, then accumulate adapter linear combination in place.
    std::memcpy(w, backup.data(), nb);

    const std::filesystem::path dir(adapters_dir);
    for (size_t i = 0; i < coeffs.size(); ++i) {
        const int8_t c = coeffs[i];
        if (c == 0) {
            continue;
        }
        const std::filesystem::path path = dir / (std::to_string(i) + ".bin");
        std::ifstream f(path, std::ios::binary | std::ios::ate);
        if (!f) {
            err_msg = "failed to open adapter file: " + path.string();
            LOG_ERR("%s: %s\n", __func__, err_msg.c_str());
            std::memcpy(w, backup.data(), nb);
            backup.clear();
            return false;
        }
        const auto sz = static_cast<size_t>(f.tellg());
        f.seekg(0);
        if (sz == static_cast<size_t>(ne) * sizeof(float)) {
            std::vector<float> buf(static_cast<size_t>(ne));
            if (!f.read(reinterpret_cast<char *>(buf.data()), static_cast<std::streamsize>(sz))) {
                err_msg = "read error (f32): " + path.string();
                LOG_ERR("%s: %s\n", __func__, err_msg.c_str());
                std::memcpy(w, backup.data(), nb);
                backup.clear();
                return false;
            }
            const float fc = static_cast<float>(c);
            for (int64_t j = 0; j < ne; ++j) {
                w[j] += fc * buf[static_cast<size_t>(j)];
            }
        } else if (sz == static_cast<size_t>(ne)) {
            std::vector<int8_t> buf(static_cast<size_t>(ne));
            if (!f.read(reinterpret_cast<char *>(buf.data()), static_cast<std::streamsize>(sz))) {
                err_msg = "read error (i8): " + path.string();
                LOG_ERR("%s: %s\n", __func__, err_msg.c_str());
                std::memcpy(w, backup.data(), nb);
                backup.clear();
                return false;
            }
            const float fc = static_cast<float>(c);
            for (int64_t j = 0; j < ne; ++j) {
                w[j] += fc * static_cast<float>(buf[static_cast<size_t>(j)]);
            }
        } else {
            err_msg = "adapter size mismatch for " + path.string() + ": expected " +
                      std::to_string(static_cast<size_t>(ne) * sizeof(float)) + " (f32) or " +
                      std::to_string(static_cast<size_t>(ne)) + " (i8), got " + std::to_string(sz);
            LOG_ERR("%s: %s\n", __func__, err_msg.c_str());
            std::memcpy(w, backup.data(), nb);
            backup.clear();
            return false;
        }
    }

    active = true;
    LOG_INF("%s: applied NSDAR merge on %s (%" PRId64 " floats, %zu adapters with non-zero coeff)\n",
            __func__, ggml_get_name(tensor), ne,
            static_cast<size_t>(std::count_if(coeffs.begin(), coeffs.end(), [](int8_t x) { return x != 0; })));
    return true;
}

void session::restore() {
    if (!active || !tensor || backup.empty()) {
        active = false;
        backup.clear();
        tensor = nullptr;
        model = nullptr;
        return;
    }
    void * raw = ggml_get_data(tensor);
    if (raw) {
        std::memcpy(raw, backup.data(), backup.size());
        LOG_INF("%s: restored base weights for %s\n", __func__, ggml_get_name(tensor));
    }
    active = false;
    backup.clear();
    tensor = nullptr;
    model = nullptr;
}

session::~session() {
    restore();
}

} // namespace qvac_memory_patcher
