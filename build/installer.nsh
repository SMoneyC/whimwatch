; Included by electron-builder's NSIS installer (build/installer.nsh is picked up automatically).

; Uninstalling asks whether to remove WhimWatch's data too. Skipped when an update
; reinstalls the app (--updated) and in silent uninstalls, which keep the data.
!macro customUnInstall
  ${ifNot} ${isUpdated}
  ${andIfNot} ${Silent}
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
!macroend
