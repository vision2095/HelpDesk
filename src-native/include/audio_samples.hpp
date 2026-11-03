#pragma once

// Windows loopback mix-format conversion, kept independent of Win32 for fixture tests.
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <vector>

namespace LensDesk::AudioSamples {

enum class Encoding { Float32, IntegerPcm };
struct Format {
    Encoding encoding;
    unsigned containerBits;
    unsigned validBits;
    unsigned channels;
};

inline bool Supported(const Format& format) {
    if (format.channels == 0 || format.channels > 64) return false;
    if (format.encoding == Encoding::Float32)
        return format.containerBits == 32 && format.validBits == 32;
    return (format.containerBits == 8 || format.containerBits == 16 ||
            format.containerBits == 24 || format.containerBits == 32) &&
           format.validBits > 0 && format.validBits <= format.containerBits;
}

inline bool ToFloat(const uint8_t* bytes, size_t size, const Format& format,
                    std::vector<float>& output) {
    if (!Supported(format) || (!bytes && size)) return false;
    const size_t sampleBytes = format.containerBits / 8;
    const size_t frameBytes = sampleBytes * format.channels;
    if (size % frameBytes) return false;
    output.reserve(output.size() + size / sampleBytes);
    for (size_t offset = 0; offset < size; offset += sampleBytes) {
        float sample = 0;
        if (format.encoding == Encoding::Float32) {
            std::memcpy(&sample, bytes + offset, sizeof(sample));
            if (!std::isfinite(sample)) sample = 0;
        } else {
            uint64_t value = 0;
            for (size_t b = 0; b < sampleBytes; ++b)
                value |= uint64_t(bytes[offset + b]) << (8 * b);
            // WAVE_FORMAT_EXTENSIBLE valid bits are left aligned in the container.
            value >>= format.containerBits - format.validBits;
            const uint64_t sign = uint64_t{1} << (format.validBits - 1);
            int64_t signedValue;
            if (format.containerBits == 8) signedValue = static_cast<int64_t>(value) - static_cast<int64_t>(sign);
            else signedValue = (value & sign) ? static_cast<int64_t>(value) - static_cast<int64_t>(sign * 2) : static_cast<int64_t>(value);
            sample = static_cast<float>(static_cast<double>(signedValue) / static_cast<double>(sign));
        }
        output.push_back(sample);
    }
    return true;
}

inline std::vector<uint8_t> ToPcm16(const std::vector<float>& samples) {
    std::vector<uint8_t> output;
    output.reserve(samples.size() * 2);
    for (float sample : samples) {
        if (!std::isfinite(sample)) sample = 0;
        sample = std::clamp(sample, -1.0f, 1.0f);
        const int value = std::clamp(static_cast<int>(std::lround(sample * 32768.0f)), -32768, 32767);
        const uint16_t bits = static_cast<uint16_t>(static_cast<int16_t>(value));
        output.push_back(static_cast<uint8_t>(bits & 0xff));
        output.push_back(static_cast<uint8_t>(bits >> 8));
    }
    return output;
}
} // namespace LensDesk::AudioSamples
