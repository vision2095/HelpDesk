// Deterministic Windows loopback conversion fixtures. This tests sample math only;
// a real WASAPI endpoint and device-recovery behavior require native Windows tests.
#include "audio_samples.hpp"
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <vector>

using namespace LensDesk::AudioSamples;

static std::vector<float> convert(std::vector<uint8_t> bytes, Format f) {
    std::vector<float> out;
    assert(ToFloat(bytes.data(), bytes.size(), f, out));
    return out;
}

int main() {
    const auto u8 = convert({0, 128, 255}, {Encoding::IntegerPcm, 8, 8, 1});
    assert(u8[0] == -1.0f && u8[1] == 0.0f && u8[2] == 127.0f / 128.0f);
    const std::vector<uint8_t> pcm16{0x00,0x80, 0x00,0x00, 0xff,0x7f, 0x01,0x00, 0xff,0xff};
    assert(ToPcm16(convert(pcm16, {Encoding::IntegerPcm, 16, 16, 1})) == pcm16);
    const auto pcm24 = convert({0,0,0x80, 0,0,0, 0xff,0xff,0x7f}, {Encoding::IntegerPcm, 24, 24, 1});
    assert(pcm24[0] == -1.0f && pcm24[1] == 0.0f && pcm24[2] > 0.9999f);
    const auto pcm32 = convert({0,0,0,0x80, 0,0,0,0, 0xff,0xff,0xff,0x7f}, {Encoding::IntegerPcm, 32, 32, 1});
    assert(pcm32[0] == -1.0f && pcm32[1] == 0.0f && pcm32[2] > 0.9999f);
    const auto packed24 = convert({0,0,0,0x80, 0,0xff,0xff,0x7f}, {Encoding::IntegerPcm, 32, 24, 1});
    assert(packed24[0] == -1.0f && packed24[1] > 0.9999f);
    const float input[] = {-2.0f, -1.0f, -0.5f, 0.0f, 0.5f, 1.0f, 2.0f, std::numeric_limits<float>::quiet_NaN()};
    std::vector<uint8_t> bytes(sizeof(input));
    std::memcpy(bytes.data(), input, bytes.size());
    const auto floats = convert(bytes, {Encoding::Float32, 32, 32, 2});
    assert(floats[0] == -2.0f && floats[6] == 2.0f && floats[7] == 0.0f);
    assert((ToPcm16(floats) == std::vector<uint8_t>{0,0x80, 0,0x80, 0,0xc0, 0,0, 0,0x40, 0xff,0x7f, 0xff,0x7f, 0,0}));
    std::vector<float> out{0.25f};
    assert(!ToFloat(pcm16.data(), 3, {Encoding::IntegerPcm, 16, 16, 2}, out));
    assert(!ToFloat(pcm16.data(), pcm16.size(), {Encoding::IntegerPcm, 20, 20, 1}, out));
    assert(!ToFloat(pcm16.data(), pcm16.size(), {Encoding::Float32, 32, 24, 1}, out));
    assert(out.size() == 1 && out[0] == 0.25f);
}
