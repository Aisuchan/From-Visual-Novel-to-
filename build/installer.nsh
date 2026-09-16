; Custom NSIS include for From Visual Novel.
;
; electron-builder auto-loads build/installer.nsh and prepends it to the shared
; header, which is compiled *before* the template includes MUI2.nsh — and it does
; so for both the installer and the (separately built) uninstaller. So:
;
;   * LogicLib / nsDialogs are included here rather than relied on from MUI2;
;     they carry include-once guards, so MUI2 pulling them in again is harmless.
;   * MUI macros (e.g. MUI_HEADER_TEXT) are not used — they are not defined yet
;     at this point — so the page's explanation lives in the page body.
;   * Everything uninstaller-specific is wrapped in !ifdef BUILD_UNINSTALLER.
;     Left ungated, the un.-prefixed page code would sit in the installer, which
;     has no WriteUninstaller (NSIS warning 6020), and its variables would be
;     unused there (warning 6001) — and this build treats warnings as errors.
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!ifdef BUILD_UNINSTALLER

; The uninstaller's own welcome page is replaced with one carrying a single
; choice: whether to also delete the app's user data. Unchecked (the default)
; keeps the library the way the standard uninstall always has, so a reinstall
; picks it up again; checked removes it.
Var DeleteUserDataCheckbox
Var DeleteUserData

!macro customUnWelcomePage
  UninstPage custom un.DataChoicePage un.DataChoicePageLeave
!macroend

Function un.DataChoicePage
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 40u "From Visual Novel to をこのパソコンからアンインストールします。$\r$\n$\r$\n削除する範囲を選んでください。"
  Pop $0

  ${NSD_CreateCheckbox} 0 52u 100% 12u "アプリのデータ（ライブラリ・画像・設定）も削除する"
  Pop $DeleteUserDataCheckbox

  ${NSD_CreateLabel} 16u 66u 100% 30u "チェックしない場合、ライブラリや画像・設定は残るため、再インストール時にそのまま引き継げます。チェックすると完全に削除され、元に戻せません。"
  Pop $0

  nsDialogs::Show
FunctionEnd

Function un.DataChoicePageLeave
  ${NSD_GetState} $DeleteUserDataCheckbox $DeleteUserData
FunctionEnd

; Runs after the program files themselves have been removed. The user data lives
; in the current user's roaming AppData under the app's own name
; (app.getName() === "from-visual-novel"), which is where the SQLite database,
; the gallery copies (game-images), the Home pictures, the icons and the audio
; all sit. It is removed only when the choice above asked for it.
!macro customUnInstall
  ${If} $DeleteUserData == 1
    RMDir /r "$APPDATA\from-visual-novel"
  ${EndIf}
!macroend

!endif
