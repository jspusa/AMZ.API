{
  "targets": [
    {
      "target_name": "windows_hello",
      "sources": ["windows_hello.cc"],
      "defines": [
        "NAPI_VERSION=8",
        "UNICODE",
        "_UNICODE",
        "WINVER=0x0A00",
        "_WIN32_WINNT=0x0A00"
      ],
      "libraries": ["runtimeobject.lib"],
      "win_delay_load_hook": "true",
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": ["/std:c++20", "/EHsc"]
        }
      }
    }
  ]
}
