# Security policy

WhimWatch unpacks downloaded archives into your Mods folder and keeps sign-in cookies for LoversLab
and Patreon, so security reports are very welcome.

## Supported versions

Only the latest release gets fixes. Please update before reporting.

## Reporting a vulnerability

Report privately through
[GitHub security advisories](https://github.com/forthewhimsy/whimwatch/security/advisories/new). Please
don't open a public issue. Include the steps to reproduce, and a sample file or page if it's needed
(no real credentials or cookies). You should get a reply within a week.

## In scope

- Archive handling: path traversal, links, executables, size limits (`src/core/archive.ts`)
- Where downloads come from: the host allowlist and redirects (`src/core/downloads.ts`, `src/main/downloads.ts`)
- The installer writing outside the Mods folders, or backup/undo losing files (`src/core/installer.ts`)
- The site browser windows: permissions, navigation, cookie storage (`src/main/browser.ts`, `src/main/auth.ts`)
- The app window and IPC: sandboxing, trusted senders, content security policy (`src/main/index.ts`, `src/main/ipc.ts`, `scripts/csp.ts`)
- The community catalog (`catalog/overrides.json`) being used to point users at unexpected sites

## Out of scope

- Whether automated downloads are allowed by a site's terms (see the README's account-risk note)
- The content of third-party mods
