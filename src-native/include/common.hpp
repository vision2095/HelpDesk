#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#ifndef NOMINMAX
#define NOMINMAX
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

#include "../third_party/webview2/include/WebView2.h"
#include "../third_party/webview2/include/WebView2EnvironmentOptions.h"
#include "../third_party/nlohmann/json.hpp"

namespace LensDesk {

using json = nlohmann::json;
using Microsoft::WRL::ComPtr;

// Application version and metadata
constexpr const wchar_t* APP_NAME = L"LensDesk";
constexpr const wchar_t* APP_VERSION = L"2.0.0";
constexpr const wchar_t* WINDOW_CLASS_NAME = L"LensDesk_Overlay_Host_Class";
constexpr const wchar_t* SINGLE_INSTANCE_MUTEX = L"Local\\LensDesk2.0_SingleInstance_Mutex";

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
    wchar_t path[MAX_PATH];
    if (SUCCEEDED(SHGetFolderPathW(nullptr, CSIDL_APPDATA, nullptr, 0, path))) {
        std::filesystem::path dir = std::filesystem::path(path) / L"LensDesk";
        std::filesystem::create_directories(dir);
        return dir;
    }
    return GetExecutableDirectory();
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
