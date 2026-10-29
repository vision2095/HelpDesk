// derived: rea/native/windows/src/filesystem.cc
#include "sanitization.h"

namespace LensDesk::Native {

std::vector<std::filesystem::path> Sanitization::GetTargetDirectories() {
    std::vector<std::filesystem::path> targets;

#if defined(_WIN32)
    wchar_t* localAppData = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &localAppData))) {
        std::filesystem::path base(localAppData);
        CoTaskMemFree(localAppData);
        targets.push_back(base / L"LensDesk");
        targets.push_back(base / L"Hintlens");
        targets.push_back(base / L"RuntimeHost");
    }
#else
    const char* home = std::getenv("HOME");
    std::filesystem::path base = home ? home : "/tmp";
    targets.push_back(base / ".lensdesk_test");
#endif

    return targets;
}

size_t Sanitization::TerminateScopedWebViewProcesses(const std::wstring& targetSubdir) {
    size_t terminatedCount = 0;

#if defined(_WIN32)
    ScopedHandle snapshot;
    HANDLE hSnap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (hSnap == INVALID_HANDLE_VALUE) {
        return 0;
    }
    snapshot.reset(hSnap);

    PROCESSENTRY32W pe{ sizeof(PROCESSENTRY32W) };
    if (Process32FirstW(snapshot.get(), &pe)) {
        DWORD currentPid = GetCurrentProcessId();
        do {
            if (pe.th32ProcessID != currentPid && _wcsicmp(pe.szExeFile, L"msedgewebview2.exe") == 0) {
                ScopedHandle procHandle;
                HANDLE hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE, FALSE, pe.th32ProcessID);
                if (hProc) {
                    procHandle.reset(hProc);
                    wchar_t fullPath[MAX_PATH]{};
                    DWORD size = MAX_PATH;
                    // Query full process path to safely isolate only instances running from target user data directory
                    if (QueryFullProcessImageNameW(procHandle.get(), 0, fullPath, &size)) {
                        std::wstring pathStr(fullPath);
                        if (targetSubdir.empty() || pathStr.find(targetSubdir) != std::wstring::npos) {
                            if (TerminateProcess(procHandle.get(), 0)) {
                                terminatedCount++;
                            }
                        }
                    }
                }
            }
        } while (Process32NextW(snapshot.get(), &pe));
    }
#else
    (void)targetSubdir;
#endif

    return terminatedCount;
}

bool Sanitization::WipeRegistryKeys() {
#if defined(_WIN32)
    RegDeleteTreeW(HKEY_CURRENT_USER, L"Software\\LensDesk");
    RegDeleteTreeW(HKEY_CURRENT_USER, L"Software\\Hintlens");
#endif
    return true;
}

bool Sanitization::PerformAtomicPurge(bool exitProcessOnComplete) {
    // 1. Isolate and terminate scoped child webview processes locking the cache directory
    TerminateScopedWebViewProcesses(L"LensDesk");

    // 2. 3-pass delete loop with 50ms backoff to bypass transient ERROR_SHARING_VIOLATION
    auto targets = GetTargetDirectories();
    for (const auto& dir : targets) {
        std::error_code ec;
        for (int pass = 0; pass < 3; ++pass) {
            if (std::filesystem::exists(dir, ec)) {
                std::filesystem::remove_all(dir, ec);
            }
            if (!std::filesystem::exists(dir, ec)) {
                break;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
        }
    }

    // 3. Purge registry trees
    WipeRegistryKeys();

#if defined(_WIN32)
    if (exitProcessOnComplete) {
        ExitProcess(0);
    }
#else
    (void)exitProcessOnComplete;
#endif

    return true;
}

} // namespace LensDesk::Native
