# Working on WhimWatch

Conventions for coding agents. [`CONTRIBUTING.md`](CONTRIBUTING.md) has the full picture; these are
the ones that are easy to break without noticing.

## Never put a real creator's name in the repository

Code, tests, fixtures, comments, changelog notes and commit messages use the neutral cast:
**Moonberry**, **Amberlily**, **EchoSims**, with pack names like **Juniper Petal** or **thornwood**.

A creator's name in a public repository associates a real creator with that, without their having 
asked — so a name that arrives while debugging against real data must be swapped before it is written 
down, including in a test that only reproduces a reported problem.

Two files are exempt, because there the real name *is* the data:

- `catalog/overrides.json` — the community catalogue of creators and their pages.
- `src/main/smoke.ts` — checks live pages, so it needs real addresses.

Nowhere else. When taking a reproduction from a real state file or scan cache, keep the *shape* —
the dates, the counts, the ordering — and rename everything else.

## Bug reports carry shapes, not paths

Diagnostics must contain no creator names, no page addresses and no folder paths. Mods folders are
reported as a count and a kind (`2 · the default Documents location, another drive or folder`), never
as a path — `redact()` swapping `$HOME` for `~` is not enough, because a network share, a work
OneDrive, another drive, or a Windows drive mounted under WSL each keeps a name in it.

`test/report-hygiene.test.ts` asserts the output contains no path separator at all. If a change makes
that test fail, the change is wrong, not the test.

## Don't commit or push unless asked

Leave work in the working tree. The maintainer reads the diff before it becomes history. When a
change is ready, say what the commits should be and give the commands rather than running them.

## Privacy and Security are our core tenets

Ensure any change is cross-examined against its impact on preserving a WhimWatch user's privacy and
hardened against anyone abusing the feature for malicious purposes or the user inadvertently exposing
their app, PII, or machine to threats.

## Verify against the real app

Green tests have historically covered logic that was wired wrong. For anything touching the UI, the
main process or Electron's own behaviour, drive the real app (the Electron harness over CDP, or a small
probe script against real Electron) rather than reasoning about the code. Real state files under
`~/.config/WhimWatch` and `%APPDATA%\WhimWatch` beat invented fixtures for reproducing a report.

### Keep live runs few and small

A check contacts wicked.cc, LoversLab and Patreon for every page of every creator in the folders it
is pointed at. The maintainer's real mods folders hold dozens of creators, so each check against them
is a burst of traffic that can get their connection or accounts flagged, and takes minutes.

- Never run a check against the real mods folders. Copy the state file into a scratch
  `--user-data-dir` and point its `dirs` at a scratch folder holding only the files the reproduction
  needs — one to three creators.
- Prefer no network at all. Test the core with `FakeFetcher` (`test/check.test.ts`), or stand in for
  the sites in the real app with `session.protocol.handle('https', …)`. Marking as seen, turning sites
  off and removing pages can be driven against a saved result without running a check.
- When a live check really is needed, run one to show the problem and one to show the fix, not one
  per hypothesis. Ask the maintainer before running more.

## Before handing back

`npm run lint`, `npm run typecheck`, `npm test`. Add a note in `changes/` for anything a user would
notice.
