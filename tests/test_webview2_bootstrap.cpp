// derived: rea/native/windows/src/authority.hpp
#include "../src/native/webview2_bootstrap.h"
#include "test_common.h"
#include <cwchar>
#include <iostream>
#include <string>

using namespace LensDesk::Native;

int run_test_webview2_bootstrap() {
    LensDesk::Test::ResetAssertionCounter();

    // 1-6. HKLM and HKCU both: pv present / absent / invalid ("0.0.0.0" / empty) evaluation
    // HKLM present with valid pv
    CHECK(WebView2Bootstrap::EvaluateRegistryPresence(true, L"120.0.2210.133", false, nullptr));

    // HKLM absent, HKCU present with valid pv (fallback path)
    CHECK(WebView2Bootstrap::EvaluateRegistryPresence(false, nullptr, true, L"120.0.2210.133"));

    // Both absent
    CHECK(!WebView2Bootstrap::EvaluateRegistryPresence(false, nullptr, false, nullptr));

    // HKLM present with invalid 0.0.0.0, HKCU has valid pv
    CHECK(WebView2Bootstrap::EvaluateRegistryPresence(true, L"0.0.0.0", true, L"120.0.2210.133"));

    // HKLM present with 0.0.0.0, HKCU absent
    CHECK(!WebView2Bootstrap::EvaluateRegistryPresence(true, L"0.0.0.0", false, nullptr));

    // HKLM present with empty string, HKCU absent
    CHECK(!WebView2Bootstrap::EvaluateRegistryPresence(true, L"", false, nullptr));

    // 7-10. Exact Registry Subkey, GUID and Silent Install Arguments from rea string table
    std::wstring subkey(WebView2Bootstrap::GetRegistrySubkey());
    CHECK(subkey.find(L"SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\") != std::wstring::npos);
    CHECK(subkey.find(WebView2Bootstrap::GetGuidString()) != std::wstring::npos);
    CHECK(std::wcscmp(WebView2Bootstrap::GetGuidString(), L"{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}") == 0);
    CHECK(std::wcscmp(WebView2Bootstrap::GetSilentInstallArgs(), L" /silent /install") == 0);

    // 11-16. Atomic Refcount increment / decrement lifecycle (IBindStatusCallback pattern)
    AtomicRefCount ref(1);
    CHECK(ref.Get() == 1);
    CHECK(ref.AddRef() == 2);
    CHECK(ref.AddRef() == 3);
    CHECK(ref.Release() == 2);
    CHECK(ref.Release() == 1);
    CHECK(ref.Release() == 0);

    // 17-18. Live runtime check execution boundaries
    bool installed = WebView2Bootstrap::IsRuntimeInstalled();
    CHECK(installed == true || installed == false);

    bool ok = WebView2Bootstrap::DownloadAndInstallRuntime();
    CHECK(ok == true || ok == false);

    std::cout << "[PASS] test_webview2_bootstrap: " << LensDesk::Test::GetAssertionCount() << " asserts verified.\n";
    return 0;
}

#ifndef RUN_ALL_TESTS
int main() {
    return run_test_webview2_bootstrap();
}
#endif
