// derived: rea/native/windows/src/authority.hpp
#pragma once
#include <iostream>
#include <cstdlib>
#include <atomic>

namespace LensDesk::Test {

inline std::atomic<int>& AssertionCounter() noexcept {
    static std::atomic<int> s_counter{0};
    return s_counter;
}

inline void ResetAssertionCounter() noexcept {
    AssertionCounter().store(0);
}

inline int GetAssertionCount() noexcept {
    return AssertionCounter().load();
}

} // namespace LensDesk::Test

#define CHECK(expr) do { \
    ::LensDesk::Test::AssertionCounter().fetch_add(1, std::memory_order_relaxed); \
    if (!(expr)) { \
        std::cerr << "CHECK FAILED: " #expr " at " << __FILE__ << ":" << __LINE__ << std::endl; \
        std::abort(); \
    } \
} while(0)
