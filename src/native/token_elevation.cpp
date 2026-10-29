// derived: rea/native/windows/src/authority.hpp
#include "token_elevation.h"

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
    if (!SetTokenInformation(dupToken.get(), TokenUIAccess, &enable, sizeof(enable))) {
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
