cmake_minimum_required(VERSION 3.20)
project(LensDeskNative VERSION 2.0.0 LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Standardize output directory
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/bin/Release")
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/bin/Debug")

# This option builds RuntimeHost with UIAccess=true accessibility manifest for signed elevation integration
option(LENSDESK_BUILD_UIACCESS "Build RuntimeHost with UIAccess=true accessibility manifest" OFF)

if(LENSDESK_BUILD_UIACCESS)
    set(APP_MANIFEST_FILE "${CMAKE_CURRENT_SOURCE_DIR}/resources/app-accessibility.manifest")
    add_compile_definitions(LENSDESK_UIACCESS_BUILD=1)
else()
    set(APP_MANIFEST_FILE "${CMAKE_CURRENT_SOURCE_DIR}/resources/app.manifest")
endif()

if(MSVC)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
    add_compile_options(/W3 /WX- /wd4100 /permissive- /Zc:preprocessor /utf-8 /EHsc)
    add_compile_definitions(UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX _CRT_SECURE_NO_WARNINGS _WINSOCK_DEPRECATED_NO_WARNINGS)
    if(LENSDESK_BUILD_UIACCESS)
        add_link_options(/MANIFESTUAC:level='asInvoker' /MANIFESTUAC:uiAccess='true')
    else()
        add_link_options(/MANIFESTUAC:NO)
    endif()
endif()

# The Windows host lives under apps/windows, while shared native code and
# Vite assets are owned by the repository root.
get_filename_component(LENSDESK_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../.." ABSOLUTE)

# Include directories
include_directories(
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${LENSDESK_ROOT}/src/native
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party/imgui
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party/webview2/include
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party/nlohmann
)

# Native sources
set(SOURCES
    src/main.cpp
    src/window_manager.cpp
    src/d3d11_renderer.cpp
    src/dcomp_engine.cpp
    src/imgui_overlay.cpp
    src/webview2_host.cpp
    src/browser_tabs.cpp
    src/focus_manager.cpp
    src/input_manager.cpp
    src/capture_service.cpp
    src/storage_manager.cpp
    src/cloud_client.cpp
    src/service_dispatcher.cpp
    src/audio_capture.cpp
    ${LENSDESK_ROOT}/src/native/ocr_pipeline.cpp
    ${LENSDESK_ROOT}/src/native/focus_gate.cpp
    ${LENSDESK_ROOT}/src/native/typing_dynamics.cpp
    ${LENSDESK_ROOT}/src/native/wasapi_loopback.cpp
    ${LENSDESK_ROOT}/src/native/websocket_audio_sink.cpp
    ${LENSDESK_ROOT}/src/native/mouse_gesture_hook.cpp
    ${LENSDESK_ROOT}/src/native/hotkey_dispatcher.cpp
    ${LENSDESK_ROOT}/src/native/sanitization.cpp
    ${LENSDESK_ROOT}/src/native/webview2_bootstrap.cpp
    third_party/imgui/imgui.cpp
    third_party/imgui/imgui_draw.cpp
    third_party/imgui/imgui_tables.cpp
    third_party/imgui/imgui_widgets.cpp
    third_party/imgui/imgui_impl_win32.cpp
    third_party/imgui/imgui_impl_dx11.cpp
    resources/app.rc
    ${APP_MANIFEST_FILE}
)

# This option is for an isolated CI fixture only. Release builds default to OFF.
option(LENSDESK_ENABLE_TEST_AUTH "Build an explicitly named test host with fixture authentication" OFF)

# Executable target
add_executable(RuntimeHost WIN32 ${SOURCES})
if(LENSDESK_ENABLE_TEST_AUTH)
    target_compile_definitions(RuntimeHost PRIVATE LENSDESK_ENABLE_TEST_AUTH=1)
    set(LENSDESK_HOST_OUTPUT_NAME "RuntimeHostTest")
else()
    set(LENSDESK_HOST_OUTPUT_NAME "RuntimeHost")
endif()

# Windows system libraries
set(LENSDESK_SYSTEM_LIBRARIES
    user32
    gdi32
    d3d11
    dxgi
    dcomp
    dwmapi
    ole32
    shell32
    shlwapi
    windowscodecs
    crypt32
    winhttp
    bcrypt
    version
    d3dcompiler
    urlmon
    advapi32
    oleaut32
    mmdevapi
    runtimeobject
    windowsapp
    ws2_32
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party/webview2/lib/x64/WebView2LoaderStatic.lib
)

# Set output name
set_target_properties(RuntimeHost PROPERTIES
    OUTPUT_NAME "${LENSDESK_HOST_OUTPUT_NAME}"
    VS_DEBUGGER_WORKING_DIRECTORY "${CMAKE_RUNTIME_OUTPUT_DIRECTORY}"
)
target_link_libraries(RuntimeHost PRIVATE ${LENSDESK_SYSTEM_LIBRARIES})

# Post-build copy of WebView2Loader.dll and frontend dist
add_custom_command(TARGET RuntimeHost POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${CMAKE_CURRENT_SOURCE_DIR}/third_party/webview2/lib/x64/WebView2Loader.dll"
        "$<TARGET_FILE_DIR:RuntimeHost>/WebView2Loader.dll"
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        "${LENSDESK_ROOT}/dist"
        "$<TARGET_FILE_DIR:RuntimeHost>/dist"
    COMMENT "Copying WebView2 runtime DLL and built web assets to target output directory"
)

# Dedicated Signed Accessibility target (uiAccess="true")
set(SOURCES_UIACCESS ${SOURCES})
list(REMOVE_ITEM SOURCES_UIACCESS "${APP_MANIFEST_FILE}")
list(APPEND SOURCES_UIACCESS "${CMAKE_CURRENT_SOURCE_DIR}/resources/app-accessibility.manifest")

add_executable(RuntimeHostAccessibility WIN32 ${SOURCES_UIACCESS})
set_target_properties(RuntimeHostAccessibility PROPERTIES
    OUTPUT_NAME "RuntimeHostAccessibility"
    VS_DEBUGGER_WORKING_DIRECTORY "${CMAKE_RUNTIME_OUTPUT_DIRECTORY}"
)
target_compile_definitions(RuntimeHostAccessibility PRIVATE LENSDESK_UIACCESS_BUILD=1)
target_link_libraries(RuntimeHostAccessibility PRIVATE ${LENSDESK_SYSTEM_LIBRARIES})
if(MSVC)
    target_link_options(RuntimeHostAccessibility PRIVATE /MANIFESTUAC:level='asInvoker' /MANIFESTUAC:uiAccess='true')
endif()

add_custom_command(TARGET RuntimeHostAccessibility POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${CMAKE_CURRENT_SOURCE_DIR}/third_party/webview2/lib/x64/WebView2Loader.dll"
        "$<TARGET_FILE_DIR:RuntimeHostAccessibility>/WebView2Loader.dll"
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        "${LENSDESK_ROOT}/dist"
        "$<TARGET_FILE_DIR:RuntimeHostAccessibility>/dist"
    COMMENT "Copying WebView2 runtime DLL and built web assets to accessibility target output directory"
)
