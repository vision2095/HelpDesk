cmake_minimum_required(VERSION 3.20)
project(LensDeskEnterpriseHost VERSION 2.0.0 LANGUAGES CXX C)

# The supported Windows product is the native host in src-native (MSVC C++20,
# Win32, Direct3D 11, DirectComposition, WebView2). Keep this root entry point
# as a thin alias so older local commands cannot compile retired prototype
# modules such as token elevation, layout watchdogs, or proctor target lists.
add_subdirectory(src-native)
