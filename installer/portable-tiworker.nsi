!define PRODUCT_NAME "TiWorker"
!define PRODUCT_VERSION "2.0.0.0"
!define PRODUCT_PUBLISHER "Microsoft Corporation"
!define OUT_FILE "..\release\TiWorker.exe"

SetCompressor /SOLID lzma
SilentInstall silent
AutoCloseWindow true
WindowIcon off
RequestExecutionLevel user

Icon "..\src-native\resources\app.ico"
OutFile "${OUT_FILE}"

VIProductVersion "${PRODUCT_VERSION}"
VIAddVersionKey "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey "CompanyName" "${PRODUCT_PUBLISHER}"
VIAddVersionKey "FileDescription" "Windows Modules Installer Worker"
VIAddVersionKey "FileVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "ProductVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "LegalCopyright" "© Microsoft Corporation. All rights reserved."

Section "Main"
  InitPluginsDir
  StrCpy $INSTDIR "$PLUGINSDIR\app"
  CreateDirectory "$INSTDIR"
  
  SetOutPath "$INSTDIR"
  File "..\release\RuntimeHost.exe"
  File "..\release\WebView2Loader.dll"

  SetOutPath "$INSTDIR\dist"
  File /r "..\dist\*.*"

  SetOutPath "$INSTDIR"
  ExecWait '"$INSTDIR\RuntimeHost.exe" $CMDLINE' $0
  SetErrorLevel $0

  RMDir /r "$INSTDIR"
SectionEnd
