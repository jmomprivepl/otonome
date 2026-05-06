// Minimal smoke: same memcpy pattern as QVP1 mode-0 snapshot / restore (no GGUF).
#include <cstddef>
#include <cstdint>
#include <cstring>

int main() {
    alignas(64) uint8_t weights[2048];
    alignas(64) uint8_t backup[2048];
    std::memset(weights, 0x11, sizeof weights);
    std::memcpy(backup, weights, sizeof weights);
    std::memset(weights, 0xee, sizeof weights);
    std::memcpy(weights, backup, sizeof weights);
    for (std::size_t i = 0; i < sizeof weights; ++i) {
        if (weights[i] != 0x11) {
            return 1;
        }
    }
    return 0;
}
