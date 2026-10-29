// derived: rea/native/windows/src/authority.hpp
#pragma once
#include "common.h"

namespace LensDesk::Native {

class WebView2Bootstrap {
public:
    static bool IsRuntimeInstalled();
    static bool DownloadAndInstallRuntime();
};

} // namespace LensDesk::Native
