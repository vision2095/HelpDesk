#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#ifndef NOMINMAX
#define NOMINMAX
#endif

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#endif

#include <windows.h>
#include <windowsx.h>
#include <wrl/client.h>
#include <d3d11_1.h>
#include <dxgi1_3.h>
#include <dcomp.h>
#include <dwmapi.h>
#include <shellapi.h>
#include <shlobj.h>
#include <wincodec.h>
#include <wincrypt.h>
#include <dpapi.h>

#include <string>
#include <string_view>
#include <vector>
#include <memory>
#include <functional>
#include <chrono>
#include <filesystem>
#include <iostream>
#include <fstream>
#include <sstream>
#include <atomic>
#include <mutex>
#include <thread>
#include <map>
#include <unordered_map>
#include <optional>
#include <stdexcept>

#include "../third_party/webview2/include/WebView2.h"
#include "../third_party/webview2/include/WebView2EnvironmentOptions.h"
#include "../third_party/nlohmann/json.hpp"

namespace LensDesk {

using json = nlohmann::json;
using Microsoft::WRL::ComPtr;

// Application version and metadata
constexpr const wchar_t* APP_NAME = L"";
constexpr const wchar_t* APP_VERSION = L"2.0.0";
constexpr const wchar_t* WINDOW_CLASS_NAME = L"LensDesk_Overlay_Host_Class";
#ifdef LENSDESK_ENABLE_TEST_AUTH
constexpr const wchar_t* SINGLE_INSTANCE_MUTEX = L"Local\\LensDesk_TestFixture_SingleInstance_Mutex";
#else
constexpr const wchar_t* SINGLE_INSTANCE_MUTEX = L"Local\\LensDesk_SingleInstance_Mutex";
#endif

// Custom window messages
constexpr UINT WM_LENSDESK_TRAY = WM_USER + 101;
constexpr UINT WM_LENSDESK_IPC_DISPATCH = WM_USER + 102;
constexpr UINT WM_LENSDESK_HOTKEY_TRIGGERED = WM_USER + 103;

// Windows capture affinity constant (Windows 10 2004+)
#ifndef WDA_EXCLUDEFROMCAPTURE
#define WDA_EXCLUDEFROMCAPTURE 0x00000011
#endif

// Utilities for UTF-8 / UTF-16 conversion
inline std::wstring Utf8ToWide(std::string_view utf8Str) {
    if (utf8Str.empty()) return std::wstring();
    int count = MultiByteToWideChar(CP_UTF8, 0, utf8Str.data(), static_cast<int>(utf8Str.size()), nullptr, 0);
    if (count <= 0) return std::wstring();
    std::wstring wideStr(count, 0);
    MultiByteToWideChar(CP_UTF8, 0, utf8Str.data(), static_cast<int>(utf8Str.size()), wideStr.data(), count);
    return wideStr;
}

inline std::string WideToUtf8(std::wstring_view wideStr) {
    if (wideStr.empty()) return std::string();
    int count = WideCharToMultiByte(CP_UTF8, 0, wideStr.data(), static_cast<int>(wideStr.size()), nullptr, 0, nullptr, nullptr);
    if (count <= 0) return std::string();
    std::string utf8Str(count, 0);
    WideCharToMultiByte(CP_UTF8, 0, wideStr.data(), static_cast<int>(wideStr.size()), utf8Str.data(), count, nullptr, nullptr);
    return utf8Str;
}

// Path helpers
inline std::filesystem::path GetExecutableDirectory() {
    wchar_t path[MAX_PATH];
    GetModuleFileNameW(nullptr, path, MAX_PATH);
    return std::filesystem::path(path).parent_path();
}

inline std::filesystem::path GetAppDataDirectory() {
#ifdef LENSDESK_ENABLE_TEST_AUTH
    // Fixture builds must never fall back to a real user's LensDesk data.
    DWORD size = GetEnvironmentVariableW(L"LENSDESK_FIXTURE_DATA_DIR", nullptr, 0);
    if (size == 0) throw std::runtime_error("Fixture data directory is required");
    std::wstring value(size, L'\0');
    DWORD written = GetEnvironmentVariableW(L"LENSDESK_FIXTURE_DATA_DIR", value.data(), size);
    if (written == 0 || written >= size) throw std::runtime_error("Invalid fixture data directory");
    value.resize(written);
    std::filesystem::path dir(value);
    if (!dir.is_absolute()) throw std::runtime_error("Fixture data directory must be absolute");
    std::filesystem::create_directories(dir);
    return dir;
#else
    wchar_t path[MAX_PATH];
    if (SUCCEEDED(SHGetFolderPathW(nullptr, CSIDL_APPDATA, nullptr, 0, path))) {
        std::filesystem::path dir = std::filesystem::path(path) / L"LensDesk";
        std::filesystem::create_directories(dir);
        return dir;
    }
    return GetExecutableDirectory();
#endif
}

// Base64 helper
inline std::vector<unsigned char> Base64Decode(std::string_view text) {
    static int table[256];
    static bool initialized = false;
    if (!initialized) {
        for (int& value : table) value = -1;
        const char* alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        for (int i = 0; i < 64; ++i) table[static_cast<unsigned char>(alphabet[i])] = i;
        initialized = true;
    }
    std::vector<unsigned char> out;
    out.reserve(text.size() * 3 / 4);
    int buffer = 0;
    int bits = 0;
    for (unsigned char c : text) {
        if (c == '=') break;
        const int value = table[c];
        if (value < 0) continue;
        buffer = (buffer << 6) | value;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back(static_cast<unsigned char>((buffer >> bits) & 0xFF));
        }
    }
    return out;
}

inline std::string Base64Encode(const unsigned char* data, size_t len) {
    static const char encodingTable[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string encoded;
    encoded.reserve(((len + 2) / 3) * 4);
    for (size_t i = 0; i < len; i += 3) {
        uint32_t b = (data[i] << 16) | ((i + 1 < len ? data[i + 1] : 0) << 8) | (i + 2 < len ? data[i + 2] : 0);
        encoded.push_back(encodingTable[(b >> 18) & 0x3F]);
        encoded.push_back(encodingTable[(b >> 12) & 0x3F]);
        encoded.push_back(i + 1 < len ? encodingTable[(b >> 6) & 0x3F] : '=');
        encoded.push_back(i + 2 < len ? encodingTable[b & 0x3F] : '=');
    }
    return encoded;
}

inline std::string Base64UrlEncode(const unsigned char* data, size_t len) {
    std::string b64 = Base64Encode(data, len);
    std::string b64url;
    b64url.reserve(b64.size());
    for (char c : b64) {
        if (c == '+') b64url.push_back('-');
        else if (c == '/') b64url.push_back('_');
        else if (c != '=') b64url.push_back(c);
    }
    return b64url;
}

inline std::vector<uint8_t> Sha256(const uint8_t* data, size_t len) {
    auto rotr = [](uint32_t x, uint32_t n) -> uint32_t { return (x >> n) | (x << (32 - n)); };
    auto ch   = [](uint32_t x, uint32_t y, uint32_t z) -> uint32_t { return (x & y) ^ (~x & z); };
    auto maj  = [](uint32_t x, uint32_t y, uint32_t z) -> uint32_t { return (x & y) ^ (x & z) ^ (y & z); };
    auto s0   = [&](uint32_t x) -> uint32_t { return rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22); };
    auto s1   = [&](uint32_t x) -> uint32_t { return rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25); };
    auto g0   = [&](uint32_t x) -> uint32_t { return rotr(x, 7) ^ rotr(x, 18) ^ (x >> 3); };
    auto g1   = [&](uint32_t x) -> uint32_t { return rotr(x, 17) ^ rotr(x, 19) ^ (x >> 10); };

    static const uint32_t K[64] = {
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    };

    uint32_t H[8] = {
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    };

    uint64_t totalBits = static_cast<uint64_t>(len) * 8;
    std::vector<uint8_t> msg(data, data + len);
    msg.push_back(0x80);
    while ((msg.size() % 64) != 56) {
        msg.push_back(0x00);
    }
    for (int i = 7; i >= 0; --i) {
        msg.push_back(static_cast<uint8_t>((totalBits >> (i * 8)) & 0xFF));
    }

    for (size_t chunk = 0; chunk < msg.size(); chunk += 64) {
        uint32_t W[64];
        for (int t = 0; t < 16; ++t) {
            W[t] = (static_cast<uint32_t>(msg[chunk + t * 4]) << 24) |
                   (static_cast<uint32_t>(msg[chunk + t * 4 + 1]) << 16) |
                   (static_cast<uint32_t>(msg[chunk + t * 4 + 2]) << 8) |
                   (static_cast<uint32_t>(msg[chunk + t * 4 + 3]));
        }
        for (int t = 16; t < 64; ++t) {
            W[t] = g1(W[t - 2]) + W[t - 7] + g0(W[t - 15]) + W[t - 16];
        }

        uint32_t a = H[0], b = H[1], c = H[2], d = H[3];
        uint32_t e = H[4], f = H[5], g = H[6], h = H[7];

        for (int t = 0; t < 64; ++t) {
            uint32_t T1 = h + s1(e) + ch(e, f, g) + K[t] + W[t];
            uint32_t T2 = s0(a) + maj(a, b, c);
            h = g; g = f; f = e; e = d + T1;
            d = c; c = b; b = a; a = T1 + T2;
        }

        H[0] += a; H[1] += b; H[2] += c; H[3] += d;
        H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }

    std::vector<uint8_t> digest(32);
    for (int i = 0; i < 8; ++i) {
        digest[i * 4]     = static_cast<uint8_t>((H[i] >> 24) & 0xFF);
        digest[i * 4 + 1] = static_cast<uint8_t>((H[i] >> 16) & 0xFF);
        digest[i * 4 + 2] = static_cast<uint8_t>((H[i] >> 8) & 0xFF);
        digest[i * 4 + 3] = static_cast<uint8_t>(H[i] & 0xFF);
    }
    return digest;
}

inline std::string GeneratePkceVerifier(size_t length = 64) {
    static const char charset[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    std::string result;
    result.resize(length);
    std::vector<uint8_t> randomBytes(length);
#if defined(_WIN32)
    HCRYPTPROV hProv = 0;
    if (CryptAcquireContextW(&hProv, nullptr, nullptr, PROV_RSA_FULL, CRYPT_VERIFYCONTEXT | CRYPT_SILENT)) {
        CryptGenRandom(hProv, static_cast<DWORD>(length), randomBytes.data());
        CryptReleaseContext(hProv, 0);
    } else {
        for (size_t i = 0; i < length; ++i) randomBytes[i] = static_cast<uint8_t>(rand() & 0xFF);
    }
#else
    std::ifstream urandom("/dev/urandom", std::ios::binary);
    if (urandom.is_open()) {
        urandom.read(reinterpret_cast<char*>(randomBytes.data()), length);
    } else {
        for (size_t i = 0; i < length; ++i) randomBytes[i] = static_cast<uint8_t>(rand() & 0xFF);
    }
#endif
    for (size_t i = 0; i < length; ++i) {
        result[i] = charset[randomBytes[i] % (sizeof(charset) - 1)];
    }
    return result;
}

inline std::string GeneratePkceChallenge(const std::string& verifier) {
    const auto hash = Sha256(reinterpret_cast<const uint8_t*>(verifier.data()), verifier.size());
    return Base64UrlEncode(hash.data(), hash.size());
}

inline std::string GenerateRandomState(size_t length = 32) {
    return GeneratePkceVerifier(length);
}

inline std::string GetIsoTimestamp() {
    auto now = std::chrono::system_clock::now();
    std::time_t t = std::chrono::system_clock::to_time_t(now);
    std::tm tmBuf{};
#if defined(_WIN32)
    gmtime_s(&tmBuf, &t);
#else
    gmtime_r(&t, &tmBuf);
#endif
    char buf[64];
    std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tmBuf);
    return std::string(buf);
}

inline bool IsHeadlessOrCI() {
#if defined(_WIN32)
    wchar_t buf[32];
    if (GetEnvironmentVariableW(L"CI", buf, 32) > 0) return true;
    if (GetEnvironmentVariableW(L"GITHUB_ACTIONS", buf, 32) > 0) return true;
#endif
    return false;
}

} // namespace LensDesk
