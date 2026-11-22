; Removes the updater's folder, with the copy of the installer that every install
; keeps and any downloaded update, and asks whether to delete the user's projects
; when they uninstall CDK themselves. Upgrades keep both, and silent uninstalls
; (/S) keep the projects without asking.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    RMDir /r "$LOCALAPPDATA\cdk-desktop-updater"

    ClearErrors
    ${GetParameters} $R0
    ${GetOptions} $R0 "/S" $R1
    ${if} ${Errors}
      ${if} ${Cmd} `MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Do you also want to delete your CDK projects and builds?$\r$\n$\r$\nThey are stored in $LOCALAPPDATA\CDK. If you also run CDK from its source code on this computer, its projects are there too.$\r$\n$\r$\nSelect No to keep them." IDYES`
        RMDir /r "$LOCALAPPDATA\CDK"
      ${endIf}
    ${endIf}
  ${endIf}
!macroend
