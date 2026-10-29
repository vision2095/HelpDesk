// derived: rea/native/windows/src/authority.hpp
#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <memory>
#include <mutex>
#include <random>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
#include <utility>
#include <vector>

#if defined(_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <tlhelp32.h>
#include <shlobj.h>
#include <urlmon.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <wrl/client.h>
using Microsoft::WRL::ComPtr;
#else
// Standard cross-platform Win32 type definitions for isolated unit testing
using DWORD = uint32_t;
using UINT = uint32_t;
using BOOL = int;
using BYTE = uint8_t;
using WORD = uint16_t;
using USHORT = uint16_t;
using ULONG = uint32_t;
using LONG = int32_t;
using ULONGLONG = uint64_t;
using HANDLE = void*;
using HWND = void*;
using HDC = void*;
using HBITMAP = void*;
using HHOOK = void*;
using WPARAM = uintptr_t;
using LPARAM = intptr_t;
using LRESULT = intptr_t;
using HRESULT = int32_t;
using REFIID = const void*;

#ifndef TRUE
#define TRUE 1
#endif
#ifndef FALSE
#define FALSE 0
#endif
#ifndef S_OK
#define S_OK ((HRESULT)0)
#endif
#ifndef E_FAIL
#define E_FAIL ((HRESULT)0x80004005)
#endif
#ifndef E_POINTER
#define E_POINTER ((HRESULT)0x80004003)
#endif
#ifndef E_NOINTERFACE
#define E_NOINTERFACE ((HRESULT)0x80004002)
#endif
#ifndef INVALID_HANDLE_VALUE
#define INVALID_HANDLE_VALUE ((HANDLE)(intptr_t)-1)
#endif

#ifndef HWND_TOPMOST
#define HWND_TOPMOST ((HWND)(intptr_t)-1)
#endif
#ifndef SWP_NOSIZE
#define SWP_NOSIZE 0x0001
#endif
#ifndef SWP_NOMOVE
#define SWP_NOMOVE 0x0002
#endif
#ifndef SWP_NOACTIVATE
#define SWP_NOACTIVATE 0x0010
#endif
#ifndef SWP_SHOWWINDOW
#define SWP_SHOWWINDOW 0x0040
#endif
#ifndef WDA_EXCLUDEFROMCAPTURE
#define WDA_EXCLUDEFROMCAPTURE 0x00000011
#endif

#ifndef MOD_CONTROL
#define MOD_CONTROL 0x0002
#endif
#ifndef MOD_SHIFT
#define MOD_SHIFT 0x0004
#endif
#ifndef WM_HOTKEY
#define WM_HOTKEY 0x0312
#endif
#ifndef WM_DESTROY
#define WM_DESTROY 0x0002
#endif
#ifndef WM_MBUTTONDOWN
#define WM_MBUTTONDOWN 0x0207
#endif
#ifndef WM_MBUTTONUP
#define WM_MBUTTONUP 0x0208
#endif
#ifndef WM_MOUSEMOVE
#define WM_MOUSEMOVE 0x0200
#endif
#ifndef WH_MOUSE_LL
#define WH_MOUSE_LL 14
#endif
#ifndef AUDCLNT_E_DEVICE_INVALIDATED
#define AUDCLNT_E_DEVICE_INVALIDATED ((HRESULT)0x88890004)
#endif

struct RECT {
    LONG left = 0;
    LONG top = 0;
    LONG right = 0;
    LONG bottom = 0;
};

struct POINT {
    LONG x = 0;
    LONG y = 0;
};

template <typename T>
class ComPtr {
    T* ptr_ = nullptr;
public:
    ComPtr() = default;
    explicit ComPtr(T* p) : ptr_(p) { if (ptr_) ptr_->AddRef(); }
    ~ComPtr() { Reset(); }
    ComPtr(const ComPtr& o) : ptr_(o.ptr_) { if (ptr_) ptr_->AddRef(); }
    ComPtr& operator=(const ComPtr& o) {
        if (this != &o) {
            Reset();
            ptr_ = o.ptr_;
            if (ptr_) ptr_->AddRef();
        }
        return *this;
    }
    ComPtr(ComPtr&& o) noexcept : ptr_(o.ptr_) { o.ptr_ = nullptr; }
    ComPtr& operator=(ComPtr&& o) noexcept {
        if (this != &o) {
            Reset();
            ptr_ = o.ptr_;
            o.ptr_ = nullptr;
        }
        return *this;
    }
    T* Get() const { return ptr_; }
    T** GetAddressOf() { return &ptr_; }
    T* operator->() const { return ptr_; }
    explicit operator bool() const { return ptr_ != nullptr; }
    void Reset() {
        if (ptr_) {
            ptr_->Release();
            ptr_ = nullptr;
        }
    }
};
#endif

namespace LensDesk::Native {

// ScopedHandle: Strict RAII Win32 handle encapsulation deriving from rea::Handle
class ScopedHandle {
    HANDLE handle_ = INVALID_HANDLE_VALUE;
public:
    ScopedHandle() = default;
    explicit ScopedHandle(HANDLE h) : handle_(h) {}
    ~ScopedHandle() { reset(); }

    ScopedHandle(const ScopedHandle&) = delete;
    ScopedHandle& operator=(const ScopedHandle&) = delete;

    ScopedHandle(ScopedHandle&& other) noexcept : handle_(other.release()) {}
    ScopedHandle& operator=(ScopedHandle&& other) noexcept {
        reset(other.release());
        return *this;
    }

    HANDLE get() const noexcept { return handle_; }
    bool valid() const noexcept {
        return handle_ != INVALID_HANDLE_VALUE && handle_ != nullptr;
    }

    HANDLE release() noexcept {
        HANDLE tmp = handle_;
        handle_ = INVALID_HANDLE_VALUE;
        return tmp;
    }

    void reset(HANDLE next = INVALID_HANDLE_VALUE) noexcept {
        if (valid()) {
#if defined(_WIN32)
            CloseHandle(handle_);
#endif
        }
        handle_ = next;
    }
};

} // namespace LensDesk::Native
