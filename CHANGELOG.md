# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-09-16

First public version.

### Added

- Scans Mods folders and identifies WickedWhims creator packages by the creator named inside each file.
- Finds creators' pages through the WickedWhims download page, wicked.cc, LoversLab and Patreon, plus a
  community catalog and links you add yourself.
- Checks for updates when the app opens or on demand, with cancel. Shows WickedWhims' latest version and
  supported game versions.
- Warns when mods or script mods are turned off in the game, or when an EA patch is newer than WickedWhims supports.
- One-click and "Update all" updates, choosing the newest source you can download from (most files on
  ties), with a preview, per-file choices, backups and undo.
- Detects downloads identical to what's installed ("Already up to date"), and "Mark all as seen". When another
  site was updated later, it's named, with a button to open it.
- Sites to check: turn off wicked.cc, LoversLab or Patreon for every creator (Settings → General) or for one creator
  (their row), and WhimWatch doesn't contact it for them or show its updates. Choices are kept between runs, and
  creators only found on a turned-off site show as "Not checked" instead of needing a look.
- Removing a creator's Patreon page ("Not this creator's page") also covers its other address forms, so it doesn't
  come back as `/cw/name` or `/c/name`.
- Optional sign-in to LoversLab and Patreon on the sites' own pages; cookies are encrypted at rest.
- Patreon downloads come from files attached to the release post, from a post it links to by the same creator (for
  creators who keep one "download files" post and replace its file each release), or from a single Mega or Google
  Drive link, including in posts written with Patreon's newer editor.
- Privacy: browsing data from the built-in site browser is wiped on exit, or never written to disk when
  sign-ins aren't kept; checking windows load nothing from third parties; links can open in a private
  window; notifications don't name creators unless enabled; a "discreet settings" preset.
- Storage settings: backup retention, deleting backups, clearing downloads, browsing data and the log, and
  removing all WhimWatch data (the Windows uninstaller also offers this).
- Notice when a newer WhimWatch release is available (can be turned off).
- Diagnostics for bug reports, previewed before copying or saving. Logs never contain page addresses.
- History: every update and "mark as seen", with undo.
- Privacy levels (Standard, Discreet, Custom), a privacy screen that blurs the window and keeps it out of
  screenshots, an opt-in quick-hide shortcut, and hidden post titles.
- Theme setting (dark, light or system).
- Help menu and Settings → Help & about: the guide, bug reports (with a diagnostics preview), site problems, creator
  links, feature ideas and private security reports on GitHub; Support WhimWatch (Buy Me a Coffee); and Licences, with the full licence text of everything WhimWatch includes (generated at build time;
  the build fails on a dependency licence nobody has reviewed).
- Continuous integration on every pull request and push to `main` (tests on Windows, macOS and Linux, plus a
  packaging check), and tagged releases that build Windows, macOS and Linux installers, a source archive and
  checksums into a draft release.
- Linux `.rpm` package; the Windows installer is now one click and per-user, without a desktop shortcut.

### Changed

- WhimWatch checks for updates only when you click Check now. Checking automatically when it opens is an option
  (in setup and Settings → General), off by default.
- New interface: status counts that filter the list, a "safe to play?" card that shows your game version next to
  the one WickedWhims supports, one Update button per row, full-page Settings with sections, a three-step setup, and
  a dark-first look with bundled Manrope and JetBrains Mono fonts.
- The list keeps its last results while a check runs, and rows update in place.
- Update preview: a one-line summary, colour-coded file changes, and Install disabled while The Sims 4 is open.
- Update all: select all or none, runs in the background with taskbar progress, and ends with a summary and Undo all.
- In-app confirmations, toasts with undo, keyboard support (Escape, focus kept in dialogs, `/` to search, Ctrl+R to
  check), and spelled-out times and numbers.
- The package description no longer names WickedWhims, since it shows in Start menu shortcuts and app lists.

### Fixed

- Installers no longer include the project's source code, tests and documents, only the built app.
- Turning on Quick hide now switches the privacy level to Custom, like every other privacy setting.
