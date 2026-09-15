## Download

| System | File |
|---|---|
| Windows 10 and 11 | **`WhimWatch-Setup-{{version}}.exe`**: installs for your user account, no administrator rights needed. Or `WhimWatch-{{version}}-portable.exe` to run without installing. |
| macOS on Apple silicon (M1 and later) | **`WhimWatch-{{version}}-arm64.dmg`** |
| macOS on Intel | `WhimWatch-{{version}}-x64.dmg` |
| Ubuntu, Debian, Linux Mint | **`WhimWatch-{{version}}-amd64.deb`** |
| Fedora, openSUSE | `WhimWatch-{{version}}-x86_64.rpm` |
| Other Linux | `WhimWatch-{{version}}-x86_64.AppImage` (make it executable, then run it) |

**First launch:** if this release isn't code-signed, Windows shows "Windows protected your PC" (click
**More info → Run anyway**), and macOS says it can't check the app (open **System Settings → Privacy &
Security** and click **Open Anyway**). This happens once.

**Verify a download:** compare its SHA-256 with `SHA256SUMS.txt` (`sha256sum <file>` on Linux,
`shasum -a 256 <file>` on macOS, `Get-FileHash <file>` in PowerShell). The source code is in
`WhimWatch-{{version}}-source.tar.gz`.
