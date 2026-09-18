; Included by electron-builder's NSIS installer (build/installer.nsh is picked up automatically).

; Always install for the current user, without asking.
;
; The assisted installer shows an "install for me / for everyone" page whenever perMachine is false.
; WhimWatch is per-user by design — it installs under %LOCALAPPDATA% and needs no administrator
; rights — so the page has one right answer and only adds a step. Forcing the choice here makes the
; page skip itself, leaving Install → Finish.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; The Start menu entry, which electron-builder's own template can quietly fail to create.
;
; Its addStartMenuLink only calls CreateShortCut while $keepShortcuts is "false". The first install
; writes KeepShortcuts="true" under HKCU\Software\<app guid>, and from then on every install takes
; the other branch, which merely *renames* an existing shortcut — creating nothing when there is
; none. So once the shortcut has been deleted, no later install ever brings it back. Combined with
; no desktop shortcut, that leaves a successful install with nothing to show for itself; it also
; costs the user their update notifications, which Windows attaches to the Start menu entry.
;
; customInstall runs after addStartMenuLink, so this only fills a gap the template left.
!macro customInstall
  ${ifNot} ${FileExists} "$newStartMenuLink"
    !ifdef MENU_FILENAME
      CreateDirectory "$SMPROGRAMS\${MENU_FILENAME}"
      ClearErrors
    !endif
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ; Clear the error a shortcut that already exists would set.
    ClearErrors
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ; $launchLink was chosen before this existed. "Run WhimWatch now" should start it through the
    ; shortcut, so the running app carries the same identity Windows files its notifications under.
    StrCpy $launchLink "$newStartMenuLink"
  ${endIf}
!macroend

; The finish page. Its real job is to say the install worked: the one-click installer closed in
; silence whether or not anything had gone right, which is what people reported.
!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function StartAppAfterFinish
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartAppAfterFinish"
  !endif

  ; MUI's "show readme" checkbox, used for the desktop shortcut instead. Left unticked on purpose:
  ; WhimWatch tracks adult mods, so putting its name on the desktop of a shared computer is
  ; something to be asked for rather than assumed. createDesktopShortcut stays false in
  ; electron-builder.yml, so this checkbox is the only thing that ever makes one.
  Function CreateDesktopShortcutAfterFinish
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  FunctionEnd

  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Create a desktop shortcut"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "CreateDesktopShortcutAfterFinish"

  !insertmacro MUI_PAGE_FINISH
!macroend

; Uninstalling asks whether to remove WhimWatch's data too. Skipped when an update
; reinstalls the app (--updated) and in silent uninstalls, which keep the data.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; The desktop shortcut comes from the finish-page checkbox above, which is outside the template's
    ; own desktop handling — with createDesktopShortcut false its uninstaller never looks for one, so
    ; without this the shortcut would outlive the app.
    WinShell::UninstShortcut "$newDesktopLink"
    Delete "$newDesktopLink"
    ${if} $oldDesktopLink != $newDesktopLink
      WinShell::UninstShortcut "$oldDesktopLink"
      Delete "$oldDesktopLink"
    ${endIf}

    ${ifNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete WhimWatch's settings, sign-ins, logs and backups of replaced mod files?$\r$\n$\r$\nYour Mods folder isn't changed either way." IDNO whimwatch_keep_data
        ; Electron keeps data per user, even for a per-machine install.
        SetShellVarContext current
        RMDir /r "$APPDATA\${PRODUCT_FILENAME}"
        RMDir /r "$TEMP\whimwatch"
        ${if} $installMode == "all"
          SetShellVarContext all
        ${endif}
      whimwatch_keep_data:
    ${endIf}
  ${endIf}
!macroend
