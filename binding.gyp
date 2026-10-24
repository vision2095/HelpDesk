{
  "targets": [
    {
      "target_name": "win_diagnostic",
      "sources": ["native/win_diagnostic.cc"],
      "include_dirs": ["node_modules/node-addon-api"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "cflags_cc": ["-fexceptions", "-std=c++17"],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "MACOSX_DEPLOYMENT_TARGET": "11.0"
      },
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": ["/std:c++17"]
        }
      },
      "conditions": [
        ["OS=='win'", {
          "libraries": ["user32.lib", "dwmapi.lib", "psapi.lib"]
        }]
      ]
    }
  ]
}
