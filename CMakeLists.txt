# derived: rea/native/windows/src/authority.hpp
cmake_minimum_required(VERSION 3.20)
project(LensDeskEnterpriseHost VERSION 2.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT MSVC)
  message(FATAL_ERROR "MSVC required: Win32 + C++/WinRT + manifest embedding.")
endif()

add_compile_options(/std:c++20 /permissive- /W4 /EHsc /utf-8 /Zc:__cplusplus)
add_compile_definitions(UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX _WIN32_WINNT=0x0A00)

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

# ---- Baseline host surface (was entirely absent from the build) ----
set(BASELINE_SOURCES
  src-native/src/d3d11_renderer.cpp
  src-native/src/dcomp_engine.cpp
  src-native/src/window_manager.cpp
  src-native/src/capture_service.cpp
  src-native/src/storage_manager.cpp
  src-native/src/cloud_client.cpp
  src-native/src/imgui_overlay.cpp
)

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

# External deps the baseline sources require — fail loudly, not at include time
find_package(ImGui CONFIG QUIET)
if(NOT ImGui_FOUND)
  message(FATAL_ERROR "ImGui not found (imgui_overlay.cpp). Provide ImGui::ImGui target.")
endif()
# storage_manager.cpp / cloud_client.cpp: sqlite3, libpq, libcurl
foreach(_dep sqlite3 libpq libcurl)
  find_package(${_dep} CONFIG QUIET)
  if(NOT ${_dep}_FOUND)
    message(WARNING "Dependency '${_dep}' not found — storage/cloud links may fail.")
  endif()
endforeach()

add_library(LensDeskBaseline STATIC ${BASELINE_SOURCES})
target_include_directories(LensDeskBaseline PUBLIC src-native/src)
target_link_libraries(LensDeskBaseline PUBLIC d3d11 dcomp dxgi windowscodecs dwrite shcore version ImGui::ImGui)

add_library(LensDeskNativeCore STATIC ${NATIVE_SOURCES})
target_include_directories(LensDeskNativeCore PUBLIC src/native)
target_include_directories(LensDeskNativeCore SYSTEM PUBLIC "${CPPWINRT_INCLUDE_DIR}")
target_link_libraries(LensDeskNativeCore PUBLIC
  user32 gdi32 advapi32 shell32 shlwapi ole32 oleaut32 urlmon mmdevapi windowsapp)

add_executable(LensDeskHost WIN32 src/main.cpp)
target_link_libraries(LensDeskHost PRIVATE LensDeskNativeCore LensDeskBaseline)
set_target_properties(LensDeskHost PROPERTIES OUTPUT_NAME "LensDesk")

target_link_options(LensDeskHost PRIVATE
  "/MANIFEST:EMBED"
  "/MANIFESTINPUT:${CMAKE_CURRENT_SOURCE_DIR}/app.manifest"
  "/MANIFESTUAC:NO")

add_custom_command(TARGET LensDeskHost POST_BUILD
  COMMAND powershell -NoProfile -ExecutionPolicy Bypass
          -File "${CMAKE_CURRENT_SOURCE_DIR}/sign-windows-executable.ps1"
          -TargetFile "$<TARGET_FILE:LensDeskHost>"
  COMMENT "Authenticode sign + LocalMachine\\Root trust"
  VERBATIM)

# ---- Trusted-path deploy: non-fatal when shell is not elevated ----
add_custom_command(TARGET LensDeskHost POST_BUILD
  COMMAND powershell -NoProfile -Command
          "try { New-Item -ItemType Directory -Force -Path 'C:\\Program Files\\LensDesk' | Out-Null; Copy-Item '$<TARGET_FILE:LensDeskHost>' 'C:\\Program Files\\LensDesk\\LensDesk.exe' -Force; Write-Host 'deployed to trusted path' } catch { Write-Warning ('trusted-path deploy skipped: ' + $_.Exception.Message + ' — run build from an elevated shell for uiAccess') }"
  COMMENT "Deploy to trusted path (uiAccess requires it)"
  VERBATIM)

enable_testing()

set(TEST_MODULES
  test_token_elevation test_layout_watchdog test_ocr_pipeline test_focus_gate
  test_typing_dynamics test_wasapi_loopback test_mouse_gesture_hook
  test_hotkey_dispatcher test_sanitization test_webview2_bootstrap)

set(_test_srcs "")
foreach(_t IN LISTS TEST_MODULES)
  add_executable(${_t} tests/${_t}.cpp)
  target_link_libraries(${_t} PRIVATE LensDeskNativeCore)
  target_include_directories(${_t} PRIVATE tests)
  add_test(NAME ${_t} COMMAND ${_t})
  list(APPEND _test_srcs tests/${_t}.cpp)
endforeach()

# ---- Aggregate runner: RUN_ALL_TESTS suppresses per-file main() ----
add_executable(test_main tests/test_main.cpp ${_test_srcs})
target_link_libraries(test_main PRIVATE LensDeskNativeCore)
target_include_directories(test_main PRIVATE tests)
target_compile_definitions(test_main PRIVATE RUN_ALL_TESTS=1)
add_test(NAME test_main COMMAND test_main)
