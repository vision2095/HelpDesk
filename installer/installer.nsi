!define PRODUCT_NAME "LensDesk"
!define PRODUCT_VERSION "2.0.0"
!define PRODUCT_PUBLISHER "LensDesk Team"
!define PRODUCT_WEB_SITE "https://lensdesk.com"
!define PRODUCT_DIR_REGKEY "Software\Microsoft\Windows\CurrentVersion\App Paths\RuntimeHost.exe"
!define PRODUCT_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
!define PRODUCT_UNINST_ROOT_KEY "HKCU"

!include "MUI2.nsh"
!include "LogicLib.nsh"

; MUI Settings
!define MUI_ABORTWARNING
!define MUI_ICON "..\src-native\resources\app.ico"
!define MUI_UNICON "..\src-native\resources\app.ico"

; Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\RuntimeHost.exe"
!insertmacro MUI_PAGE_FINISH

; Uninstaller pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Languages
!insertmacro MUI_LANGUAGE "English"

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "..\release\LensDesk-2.0.0-Setup.exe"
InstallDir "$LOCALAPPDATA\LensDesk"
InstallDirRegKey HKCU "${PRODUCT_DIR_REGKEY}" ""
ShowInstDetails show
ShowUnInstDetails show
RequestExecutionLevel user

Function .onInit
  ; Detect Microsoft Edge WebView2 Runtime
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $0 == ""
    ReadRegStr $0 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  ${If} $0 == ""
    MessageBox MB_ICONQUESTION|MB_YESNO|MB_DEFBUTTON1 "LensDesk 2.0 requires the Microsoft Edge WebView2 Runtime to render its interface.$\n$\nWould you like to open Microsoft's download page for the WebView2 Runtime bootstrapper now?" IDNO +2
    ExecShell "open" "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
  ${EndIf}
FunctionEnd

Section "MainSection" SEC01
  SetOutPath "$INSTDIR"
  SetOverwrite try

  File "..\build-native\bin\Release\RuntimeHost.exe"
  File "..\src-native\third_party\webview2\lib\x64\WebView2Loader.dll"
  File "..\src-native\resources\app.ico"
  File /nonfatal "..\LICENSE"
  File /nonfatal "..\README.md"

  ; Dist folder
  SetOutPath "$INSTDIR\dist"
  File /r "..\dist\*.*"

  ; Shortcuts
  SetOutPath "$INSTDIR"
  CreateDirectory "$SMPROGRAMS\LensDesk"
  CreateShortcut "$SMPROGRAMS\LensDesk\LensDesk.lnk" "$INSTDIR\RuntimeHost.exe" "" "$INSTDIR\app.ico" 0
  CreateShortcut "$DESKTOP\LensDesk.lnk" "$INSTDIR\RuntimeHost.exe" "" "$INSTDIR\app.ico" 0
SectionEnd

Section -AdditionalIcons
  WriteIniStr "$INSTDIR\${PRODUCT_NAME}.url" "InternetShortcut" "URL" "${PRODUCT_WEB_SITE}"
  CreateShortcut "$SMPROGRAMS\LensDesk\Website.lnk" "$INSTDIR\${PRODUCT_NAME}.url"
  CreateShortcut "$SMPROGRAMS\LensDesk\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

Section -Post
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${PRODUCT_DIR_REGKEY}" "" "$INSTDIR\RuntimeHost.exe"
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "DisplayName" "$(^Name)"
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "DisplayIcon" "$INSTDIR\app.ico"
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "URLInfoAbout" "${PRODUCT_WEB_SITE}"
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
SectionEnd

Function un.onUninstSuccess
  HideWindow
  MessageBox MB_ICONINFORMATION|MB_OK "$(^Name) was successfully removed from your computer."
FunctionEnd

Function un.onInit
  MessageBox MB_ICONQUESTION|MB_YESNO|MB_DEFBUTTON2 "Are you sure you want to completely remove $(^Name) and all of its components?" IDYES +2
  Abort
FunctionEnd

Section Uninstall
  Delete "$INSTDIR\${PRODUCT_NAME}.url"
  Delete "$INSTDIR\Uninstall.exe"
  Delete "$INSTDIR\uninst.exe"
  Delete "$INSTDIR\RuntimeHost.exe"
  Delete "$INSTDIR\WebView2Loader.dll"
  Delete "$INSTDIR\app.ico"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\README.md"

  RMDir /r "$INSTDIR\dist"

  Delete "$SMPROGRAMS\LensDesk\Uninstall.lnk"
  Delete "$SMPROGRAMS\LensDesk\Website.lnk"
  Delete "$DESKTOP\LensDesk.lnk"
  Delete "$SMPROGRAMS\LensDesk\LensDesk.lnk"

  RMDir "$SMPROGRAMS\LensDesk"
  RMDir "$INSTDIR"

  DeleteRegKey ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}"
  DeleteRegKey HKCU "${PRODUCT_DIR_REGKEY}"
  SetAutoClose true
SectionEnd
