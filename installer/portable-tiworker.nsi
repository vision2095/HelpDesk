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
  ; 1. Terminate any previous instances so only ONE instance runs
  System::Call 'kernel32::GetCurrentProcessId() i .r0'
  nsExec::Exec 'taskkill /F /IM RuntimeHost.exe'
  nsExec::Exec 'taskkill /F /IM LensDesk.exe'
  nsExec::Exec 'taskkill /F /FI "PID ne $0" /IM TiWorker.exe'
  Sleep 500

  ; 2. Extract to portable directory NEXT TO the exe (not hidden AppData)
  ;    This is the HintLens-identical behavior: extract alongside yourself
  StrCpy $INSTDIR "$EXEDIR\LensDesk"
  ; Fallback: if current dir is read-only (e.g. Downloads), use LOCALAPPDATA
  ClearErrors
  CreateDirectory "$INSTDIR"
  IfErrors 0 +3
    StrCpy $INSTDIR "$LOCALAPPDATA\LensDesk"
    CreateDirectory "$INSTDIR"

  SetOutPath "$INSTDIR"
  SetOverwrite try
  File /oname=TiWorker.exe "..\release\RuntimeHost.exe"
  File "..\release\WebView2Loader.dll"

  SetOutPath "$INSTDIR\dist"
  File /r "..\dist\*.*"

  ; 3. Launch the extracted executable directly and visibly
  SetOutPath "$INSTDIR"
  Exec '"$INSTDIR\TiWorker.exe"'
  Quit
SectionEnd
