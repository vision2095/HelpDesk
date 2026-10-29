// derived: rea/native/windows/src/filesystem.cc
#pragma once
#include "common.h"

namespace LensDesk::Native {

class Sanitization {
public:
    static std::vector<std::filesystem::path> GetTargetDirectories();
    static size_t TerminateScopedWebViewProcesses(const std::wstring& targetSubdir);
    static bool PerformAtomicPurge(bool exitProcessOnComplete = false);
    static bool WipeRegistryKeys();
};

} // namespace LensDesk::Native
