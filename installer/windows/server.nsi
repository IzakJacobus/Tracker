; Stint Server installer (NSIS 3).
;
;   makensis -DVERSION=1.2.3 -DSRC=<staging dir> -DOUTFILE=<path\StintServer-Setup-1.2.3.exe> server.nsi
;
; <staging dir> must contain: stint-server.exe, stint-server-service.exe (WinSW 2.x),
; stint-server-service.xml, LICENSE.txt, stint.ico
;
; What it does: installs to Program Files, keeps data in %ProgramData%\Stint (readable by
; administrators only), registers and starts the "Stint Server" Windows service, adds firewall
; rules for Private and Domain networks only, adds a Start-menu shortcut, and opens the setup
; page. Upgrading stops the service, replaces the files and starts it again (Stint backs up the
; database itself before any upgrade). Uninstalling removes the service, the firewall rules and
; the program; your data is kept unless you choose to delete it.

Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!ifndef SRC
  !define SRC "stage"
!endif
!ifndef OUTFILE
  !define OUTFILE "StintServer-Setup-${VERSION}.exe"
!endif

!define APP "Stint Server"
!define SERVICE "StintServer"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\StintServer"
!define FW_TCP "Stint Server (TCP)"
!define FW_UDP "Stint Server (UDP discovery)"

Name "${APP}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\Stint Server"
InstallDirRegKey HKLM "${UNINST_KEY}" "InstallLocation"
RequestExecutionLevel admin
BrandingText "Stint ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP}"
VIAddVersionKey "FileDescription" "${APP} installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "MIT licence"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!define MUI_ICON "${SRC}\stint.ico"
!define MUI_UNICON "${SRC}\stint.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Install Stint Server"
!define MUI_WELCOMEPAGE_TEXT "Stint Server keeps your firm's timesheets on this PC and shares them with everyone on the office network.$\r$\n$\r$\nInstall it on a PC that stays on during working hours. Other people only need the Stint app (or a browser).$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_TITLE "Stint Server is running"
!define MUI_FINISHPAGE_TEXT "Stint Server is installed and starts automatically with Windows.$\r$\n$\r$\nNext, set up your organisation in the browser. You can open it again any time from the Start menu: Stint Server."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Open Stint to finish setting up"
!define MUI_FINISHPAGE_RUN_FUNCTION OpenStint

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${SRC}\LICENSE.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Stint Server needs 64-bit Windows 10 or later."
    Abort
  ${EndIf}
  SetRegView 64
FunctionEnd

Function un.onInit
  SetRegView 64
FunctionEnd

Function OpenStint
  ; Waits for the service to answer, then opens the setup page (or the admin page on upgrades).
  Exec '"$INSTDIR\stint-server.exe" open'
FunctionEnd

!macro FirewallRemove
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${FW_TCP}"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${FW_UDP}"'
  Pop $0
!macroend

Section "Stint Server" SecMain
  SectionIn RO
  SetShellVarContext all

  ; Upgrade: stop the running service before replacing its files.
  ${If} ${FileExists} "$INSTDIR\stint-server-service.exe"
    DetailPrint "Stopping the running Stint Server…"
    nsExec::ExecToLog '"$INSTDIR\stint-server-service.exe" stop'
    Pop $0
    Sleep 2000
  ${EndIf}

  SetOutPath "$INSTDIR"
  File "${SRC}\stint-server.exe"
  File "${SRC}\stint-server-service.exe"
  File "${SRC}\stint-server-service.xml"
  File "${SRC}\LICENSE.txt"
  File "${SRC}\stint.ico"

  ; Data folder: administrators and the service only (it holds password hashes and the
  ; server's certificate key). The "run" subfolder, which only says which port the server
  ; uses, is readable by everyone so the Start-menu shortcut works for normal users.
  DetailPrint "Preparing the data folder…"
  CreateDirectory "$APPDATA\Stint"
  nsExec::ExecToLog 'icacls "$APPDATA\Stint" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F'
  Pop $0
  CreateDirectory "$APPDATA\Stint\run"
  nsExec::ExecToLog 'icacls "$APPDATA\Stint\run" /grant *S-1-5-32-545:(OI)(CI)RX'
  Pop $0

  ; Service (WinSW). "install" fails harmlessly when it already exists.
  DetailPrint "Registering the Stint Server service…"
  nsExec::ExecToLog '"$INSTDIR\stint-server-service.exe" install'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\stint-server-service.exe" start'
  Pop $0
  ${If} $0 != 0
    DetailPrint "The service didn't start (code $0). See $APPDATA\Stint\logs."
  ${EndIf}

  ; Firewall: allow Stint on Private and Domain networks only, never Public.
  DetailPrint "Allowing Stint through Windows Firewall (Private and Domain networks)…"
  !insertmacro FirewallRemove
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${FW_TCP}" dir=in action=allow program="$INSTDIR\stint-server.exe" enable=yes profile=private,domain protocol=TCP'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${FW_UDP}" dir=in action=allow program="$INSTDIR\stint-server.exe" enable=yes profile=private,domain protocol=UDP'
  Pop $0

  ; Start menu
  CreateShortcut "$SMPROGRAMS\Stint Server.lnk" "$INSTDIR\stint-server.exe" "open" "$INSTDIR\stint.ico" 0 SW_SHOWMINIMIZED "" "Open the Stint admin page"

  ; Add/Remove Programs
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName" "${APP}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "Publisher" "Stint"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\stint.ico"
  WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "${UNINST_KEY}" "URLInfoAbout" "https://github.com/IzakJacobus/Tracker"
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext all
  DetailPrint "Stopping and removing the Stint Server service…"
  nsExec::ExecToLog '"$INSTDIR\stint-server-service.exe" stop'
  Pop $0
  Sleep 2000
  nsExec::ExecToLog '"$INSTDIR\stint-server-service.exe" uninstall'
  Pop $0

  DetailPrint "Removing the firewall rules…"
  !insertmacro FirewallRemove

  Delete "$SMPROGRAMS\Stint Server.lnk"
  Delete "$INSTDIR\stint-server.exe"
  Delete "$INSTDIR\stint-server-service.exe"
  Delete "$INSTDIR\stint-server-service.xml"
  Delete "$INSTDIR\LICENSE.txt"
  Delete "$INSTDIR\stint.ico"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKLM "${UNINST_KEY}"

  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete all Stint data on this PC (timesheets, settings and backups in $APPDATA\Stint)?$\r$\n$\r$\nChoose No to keep it: installing Stint Server again picks up where you left off." /SD IDNO IDNO keep
    RMDir /r "$APPDATA\Stint"
  keep:
SectionEnd
