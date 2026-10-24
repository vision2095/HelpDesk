cmake_minimum_required(VERSION 3.20)
project(LensDeskNative VERSION 2.0.0 LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Standardize output directory
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/bin/Release")
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/bin/Debug")

if(MSVC)
    add_compile_options(/W3 /WX- /wd4100 /permissive- /Zc:preprocessor /utf-8 /EHsc)
    add_compile_definitions(UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
endif()

# Include directories
include_directories(
    ${CMAKE_CURRENT_SOURCE_DIR}/include
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
    src/service_dispatcher.cpp
    third_party/imgui/imgui.cpp
    third_party/imgui/imgui_draw.cpp
    third_party/imgui/imgui_tables.cpp
    third_party/imgui/imgui_widgets.cpp
    third_party/imgui/imgui_impl_win32.cpp
    third_party/imgui/imgui_impl_dx11.cpp
    resources/app.rc
    resources/app.manifest
)

# Executable target
add_executable(RuntimeHost WIN32 ${SOURCES})

# Windows system libraries
target_link_libraries(RuntimeHost PRIVATE
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
    version
    d3dcompiler
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party/webview2/lib/x64/WebView2LoaderStatic.lib
)

# Set output name
set_target_properties(RuntimeHost PROPERTIES
    OUTPUT_NAME "RuntimeHost"
    VS_DEBUGGER_WORKING_DIRECTORY "${CMAKE_RUNTIME_OUTPUT_DIRECTORY}"
)

# Post-build copy of WebView2Loader.dll and frontend dist
add_custom_command(TARGET RuntimeHost POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${CMAKE_CURRENT_SOURCE_DIR}/third_party/webview2/lib/x64/WebView2Loader.dll"
        "$<TARGET_FILE_DIR:RuntimeHost>/WebView2Loader.dll"
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        "${CMAKE_CURRENT_SOURCE_DIR}/../dist"
        "$<TARGET_FILE_DIR:RuntimeHost>/dist"
    COMMENT "Copying WebView2 runtime DLL and built web assets to target output directory"
)
