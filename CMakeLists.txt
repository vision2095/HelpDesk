# derived: rea/native/windows/src/authority.hpp
cmake_minimum_required(VERSION 3.20)
project(LensDeskEnterpriseHost VERSION 2.0.0 LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(MSVC)
    add_compile_options(/std:c++20 /permissive- /W4 /EHsc /utf-8)
    add_compile_definitions(UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
else()
    add_compile_options(-std=c++20 -Wall -Wextra -Wpedantic)
endif()

include_directories(
    ${CMAKE_CURRENT_SOURCE_DIR}/src/native
)

# Core Native Subsystem Library
set(NATIVE_SOURCES
    src/native/token_elevation.cpp
    src/native/layout_watchdog.cpp
    src/native/ocr_pipeline.cpp
    src/native/focus_gate.cpp
    src/native/typing_dynamics.cpp
    src/native/wasapi_loopback.cpp
    src/native/mouse_gesture_hook.cpp
    src/native/hotkey_dispatcher.cpp
    src/native/sanitization.cpp
    src/native/webview2_bootstrap.cpp
)

add_library(LensDeskNativeCore STATIC ${NATIVE_SOURCES})

if(WIN32)
    target_link_libraries(LensDeskNativeCore PUBLIC
        user32
        gdi32
        advapi32
        shell32
        ole32
        urlmon
    )
endif()

# Module Tests
enable_testing()

set(TEST_MODULES
    test_token_elevation
    test_layout_watchdog
    test_ocr_pipeline
    test_focus_gate
    test_typing_dynamics
    test_wasapi_loopback
    test_mouse_gesture_hook
    test_hotkey_dispatcher
    test_sanitization
    test_webview2_bootstrap
)

foreach(MODULE ${TEST_MODULES})
    add_executable(${MODULE} tests/${MODULE}.cpp)
    target_link_libraries(${MODULE} PRIVATE LensDeskNativeCore)
    add_test(NAME ${MODULE} COMMAND ${MODULE})
endforeach()
