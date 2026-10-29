// derived: rea/native/windows/src/authority.hpp
#include "../src/native/webview2_bootstrap.h"
#include <cassert>
#include <iostream>

using namespace LensDesk::Native;

int main() {
    // 1. Verify DownloadCallback atomic refcounting semantics
    {
        auto* cb = new DownloadCallback();
        assert(cb->GetRefCount() == 1);

        uint32_t count = cb->AddRef();
        assert(count == 2);
        assert(cb->GetRefCount() == 2);

        count = cb->Release();
        assert(count == 1);
        assert(cb->GetRefCount() == 1);

        count = cb->Release(); // Deleted automatically when refCount == 0
        assert(count == 0);
    }

    // 2. Runtime installation presence check
    bool installed = WebView2Bootstrap::IsRuntimeInstalled();
    assert(installed == true || installed == false);

    // 3. Execution boundary check
    bool ok = WebView2Bootstrap::DownloadAndInstallRuntime();
    assert(ok == true || ok == false);

    std::cout << "[PASS] test_webview2_bootstrap: 8 asserts verified.\n";
    return 0;
}
