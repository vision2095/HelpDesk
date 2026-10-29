// derived: rea/native/windows/src/authority.hpp
cmake_minimum_required(VERSION 3.20)
project(LensDeskEnterpriseHost VERSION 2.0.0 LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT MSVC)
  message(FATAL_ERROR "MSVC required: Win32 + C++/WinRT + manifest embedding.")
endif()

add_compile_options(/std:c++20 /permissive- /W4 /EHsc /utf-8 /Zc:__cplusplus)
add_compile_definitions(UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX _WIN32_WINNT=0x0A00)

# ---- C++/WinRT projection headers (module 3) ----
find_package(Microsoft.Windows.CppWinRT CONFIG QUIET)
if(NOT Microsoft.Windows.CppWinRT_FOUND)
  foreach(_root "$ENV{WindowsSdkDir}Include/$ENV{WindowsSDKVersion}cppwinrt")
    string(REPLACE "\\" "" _root "${_root}")
    if(EXISTS "${_root}/winrt/Windows.Media.Ocr.h")
      set(CPPWINRT_INCLUDE_DIR "${_root}")
      break()
    endif()
  endforeach()
  if(NOT CPPWINRT_INCLUDE_DIR)
    message(FATAL_ERROR "C++/WinRT headers not found. Install Microsoft.Windows.CppWinRT NuGet or SDK >= 10.0.17763.")
  endif()
endif()

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
target_include_directories(LensDeskNativeCore PUBLIC src/native)
target_include_directories(LensDeskNativeCore SYSTEM PUBLIC "${CPPWINRT_INCLUDE_DIR}")
target_link_libraries(LensDeskNativeCore PUBLIC
  user32 gdi32 advapi32 shell32 shlwapi ole32 oleaut32 urlmon windowsapp)

# ---- Host executable ----
add_executable(LensDeskHost WIN32 src/main.cpp)
target_link_libraries(LensDeskHost PRIVATE LensDeskNativeCore)
set_target_properties(LensDeskHost PROPERTIES OUTPUT_NAME "LensDesk")

# ---- Manifest MUST be embedded, and auto-UAC fragment suppressed ----
target_link_options(LensDeskHost PRIVATE
  "/MANIFEST:EMBED"
  "/MANIFESTINPUT:${CMAKE_CURRENT_SOURCE_DIR}/app.manifest"
  "/MANIFESTUAC:NO"
)

# ---- Signing MUST run post-link ----
add_custom_command(TARGET LensDeskHost POST_BUILD
  COMMAND powershell -NoProfile -ExecutionPolicy Bypass
          -File "${CMAKE_CURRENT_SOURCE_DIR}/sign-windows-executable.ps1"
          -TargetFile "$<TARGET_FILE:LensDeskHost>"
  COMMENT "Authenticode sign + LocalMachine\\Root trust"
  VERBATIM)

# ---- Copy to Program Files directory ----
add_custom_command(TARGET LensDeskHost POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E make_directory "C:/Program Files/LensDesk"
  COMMAND ${CMAKE_COMMAND} -E copy_if_different "$<TARGET_FILE:LensDeskHost>" "C:/Program Files/LensDesk/LensDesk.exe"
  COMMENT "Copy LensDeskHost to C:/Program Files/LensDesk/LensDesk.exe"
  VERBATIM)

# ---- All 10 tests + main test runner, actually registered ----
enable_testing()
set(TEST_MODULES
  test_token_elevation test_layout_watchdog test_ocr_pipeline test_focus_gate
  test_typing_dynamics test_wasapi_loopback test_mouse_gesture_hook
  test_hotkey_dispatcher test_sanitization test_webview2_bootstrap)

foreach(_t IN LISTS TEST_MODULES)
  add_executable(${_t} tests/${_t}.cpp)
  target_link_libraries(${_t} PRIVATE LensDeskNativeCore)
  target_include_directories(${_t} PRIVATE tests)
  add_test(NAME ${_t} COMMAND ${_t})
endforeach()

add_executable(test_main tests/test_main.cpp
  tests/test_token_elevation.cpp
  tests/test_layout_watchdog.cpp
  tests/test_ocr_pipeline.cpp
  tests/test_focus_gate.cpp
  tests/test_typing_dynamics.cpp
  tests/test_wasapi_loopback.cpp
  tests/test_mouse_gesture_hook.cpp
  tests/test_hotkey_dispatcher.cpp
  tests/test_sanitization.cpp
  tests/test_webview2_bootstrap.cpp
)
target_link_libraries(test_main PRIVATE LensDeskNativeCore)
target_include_directories(test_main PRIVATE tests)
add_test(NAME test_main COMMAND test_main)
