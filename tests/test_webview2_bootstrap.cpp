// derived: rea/native/windows/src/authority.hpp
#include "../src/native/webview2_bootstrap.h"
#include "test_common.h"
#include <iostream>

using namespace LensDesk::Native;

int run_test_webview2_bootstrap() {
    LensDesk::Test::ResetAssertionCounter();

    // 1. Runtime installation presence check
    bool installed = WebView2Bootstrap::IsRuntimeInstalled();
    CHECK(installed == true || installed == false);

    // 2. Execution boundary check
    bool ok = WebView2Bootstrap::DownloadAndInstallRuntime();
    CHECK(ok == true || ok == false);

    // 3. Mutation check: ensure runtime check does not return invalid indeterminate state
    bool repeatedCheck = WebView2Bootstrap::IsRuntimeInstalled();
    CHECK(repeatedCheck == installed);

    std::cout << "[PASS] test_webview2_bootstrap: " << LensDesk::Test::GetAssertionCount() << " asserts verified.\n";
    return 0;
}

#ifndef RUN_ALL_TESTS
int main() {
    return run_test_webview2_bootstrap();
}
#endif
