// derived: rea/native/windows/src/authority.hpp
#include "token_elevation.h"
#if defined(_WIN32)
#include <tlhelp32.h>
#endif

namespace LensDesk::Native {

bool TokenElevation::IsUIAccessEnabled() {
#if defined(_WIN32)
    ScopedHandle token;
    HANDLE rawToken = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &rawToken)) {
        return false;
    }
    token.reset(rawToken);

    DWORD uia = 0;
    DWORD retLen = 0;
    if (GetTokenInformation(token.get(), TokenUIAccess, &uia, sizeof(uia), &retLen)) {
        return uia != 0;
    }
    return false;
#else
    return false;
#endif
}

bool TokenElevation::ElevateAndRelaunchSelf() {
#if defined(_WIN32)
    if (IsUIAccessEnabled()) {
        return true;
    }

    ScopedHandle processToken;
    HANDLE rawToken = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY | TOKEN_DUPLICATE | TOKEN_ASSIGN_PRIMARY, &rawToken)) {
        return false;
    }
    processToken.reset(rawToken);

    ScopedHandle dupToken;
    HANDLE rawDupToken = nullptr;
    if (!DuplicateTokenEx(
            processToken.get(),
            MAXIMUM_ALLOWED,
            nullptr,
            SecurityImpersonation,
            TokenPrimary,
            &rawDupToken)) {
        return false;
    }
    dupToken.reset(rawDupToken);

    DWORD enable = 1;
    bool tokenConfigured = SetTokenInformation(dupToken.get(), TokenUIAccess, &enable, sizeof(enable));

    if (!tokenConfigured) {
        // Fallback: Attempt token duplication from winlogon.exe (1:1 HintLens parity)
        HANDLE hSnapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (hSnapshot != INVALID_HANDLE_VALUE) {
            PROCESSENTRY32W pe{ sizeof(PROCESSENTRY32W) };
            DWORD winlogonPid = 0;
            if (Process32FirstW(hSnapshot, &pe)) {
                do {
                    if (_wcsicmp(pe.szExeFile, L"winlogon.exe") == 0) {
                        winlogonPid = pe.th32ProcessID;
                        break;
                    }
                } while (Process32NextW(hSnapshot, &pe));
            }
            CloseHandle(hSnapshot);

            if (winlogonPid != 0) {
                HANDLE hWinlogon = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_DUP_HANDLE, FALSE, winlogonPid);
                if (hWinlogon) {
                    HANDLE hWinlogonToken = nullptr;
                    if (OpenProcessToken(hWinlogon, TOKEN_DUPLICATE | TOKEN_ASSIGN_PRIMARY | TOKEN_QUERY, &hWinlogonToken)) {
                        HANDLE hWinlogonDup = nullptr;
                        if (DuplicateTokenEx(hWinlogonToken, MAXIMUM_ALLOWED, nullptr, SecurityImpersonation, TokenPrimary, &hWinlogonDup)) {
                            if (SetTokenInformation(hWinlogonDup, TokenUIAccess, &enable, sizeof(enable))) {
                                dupToken.reset(hWinlogonDup);
                                tokenConfigured = true;
                            } else {
                                CloseHandle(hWinlogonDup);
                            }
                        }
                        CloseHandle(hWinlogonToken);
                    }
                    CloseHandle(hWinlogon);
                }
            }
        }
    }

    if (!tokenConfigured) {
        return false;
    }

    wchar_t exePath[MAX_PATH]{};
    if (!GetModuleFileNameW(nullptr, exePath, MAX_PATH)) {
        return false;
    }

    STARTUPINFOW si{};
    si.cb = sizeof(si);
    PROCESS_INFORMATION pi{};

    // Relaunch self using duplicated token containing active TokenUIAccess authorization
    if (CreateProcessAsUserW(
            dupToken.get(),
            exePath,
            GetCommandLineW(),
            nullptr,
            nullptr,
            FALSE,
            0,
            nullptr,
            nullptr,
            &si,
            &pi)) {
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
        ExitProcess(0);
        return true;
    }
    return false;
#else
    return false;
#endif
}

} // namespace LensDesk::Native
