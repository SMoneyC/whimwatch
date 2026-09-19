# Contributing to WhimWatch

Thanks for helping! There are several ways to contribute, and most don't need any code.

## Reporting a bug or suggesting a feature

Use the repository's **Issues** tab: **New issue**, then pick a form.

- **Bug report:** something doesn't work. Attach Settings → Help & about → **Diagnostics…**; it has versions,
  settings and the end of the log, without creator names or page addresses.
- **A site changed:** a source (wicked.cc, LoversLab, Patreon, the WickedWhims page) stopped being read.
- **Add or fix a creator link:** WhimWatch misses a creator or uses the wrong page.
- **Feature idea:** anything you'd like WhimWatch to do.

Search existing issues first, and please keep adult content, explicit titles and personal details out
of issues. Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Submitting a pull request

You don't need write access: work in your own fork.

1. **Fork** the repository on GitHub, then clone your fork:
   ```bash
   git clone https://github.com/<you>/<fork>.git
   cd <fork>
   ```
2. **Install** the Node.js version in `.nvmrc` (22), then the dependencies:
   ```bash
   npm ci
   npm run dev        # the app with hot reload
   ```
   On Linux/WSL, Electron needs GUI libraries:
   `sudo apt-get install libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libxtst6`.
3. **Branch** from `main` and make your change:
   ```bash
   git switch -c fix-loverslab-dates
   ```
4. **Check** it before pushing:
   ```bash
   npm run lint && npm run typecheck && npm test
   ```
   Add or update tests for what you changed. If someone using WhimWatch would notice the change, add a
   note for it in [`changes/`](changes/README.md): one small file per change, so pull requests never
   collide over the changelog. The release folds them into [CHANGELOG.md](CHANGELOG.md).
5. **Push** the branch to your fork and open a **pull request against `main`**. Fill in the template and
   link the issue it addresses (`Fixes #123`).

For bigger changes (a new source, a redesign, new dependencies), open an issue first so we can agree on
the approach before you spend time on it.

### What happens next

- **CI** runs on every pull request: lint and typecheck, the tests on Windows, macOS and Linux, and a
  packaging check that builds the app on each system. GitHub may ask a maintainer to approve the first
  run for a new contributor. A pull request can be merged once CI passes and it's been reviewed.
- Nothing is released on merge. Maintainers release by tagging a version, which builds the installers.

### Licensing of contributions

WhimWatch is under the [MIT License](LICENSE). By opening a pull request, you agree that your contribution
is licensed under it too.

- Only add dependencies, fonts, icons or images whose licences allow that (MIT, ISC, BSD, Apache-2.0,
  SIL OFL and similar). The build checks dependency licences and fails on any it doesn't know;
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists what's included.
- Don't add anything copied from WickedWhims, creators' packs or the supported sites beyond the small,
  hand-written page fixtures the tests need.

## Adding or fixing a creator

Most creators are found automatically through the
[WickedWhims download page](https://wickedwhimsmod.com/download) and wicked.cc. For anyone missing,
edit [`catalog/overrides.json`](catalog/overrides.json):

```json
{
  "version": 1,
  "aliases": { "willowbank": "willow" },
  "creators": {
    "pineglen": { "name": "Pine Glen", "links": ["https://www.patreon.com/PineGlen"] }
  }
}
```

- **Keys are normalized names:** lowercase, letters and digits only. `Grey Harbor` becomes `greyharbor`
  and `!Northwind` becomes `northwind`.
- **Where the name comes from:** it's what the creator puts in their package (`animation_author`).
  In the app, it's the creator name shown in the list.
- **`aliases`** merges spellings: `"willowbank": "willow"` groups packages credited to "Willow Bank" with
  "Willow".
- **Supported links:** wicked.cc pages, LoversLab file pages (`/files/file/…`) and Patreon creator
  pages.
- **Only pages the creator runs or chose to publish on.** Sites that re-upload creators' packs,
  Patreon-only ones especially, aren't accepted in the catalog or as a supported source.

## Fixing a source after a site redesign

Each source lives in `src/core/sources/` and is tested against small hand-written pages in
`test/fixtures/pages.ts`. When a site changes:

1. Run `npm run smoke` (wicked.cc, WickedWhims) or `npm run smoke:app` (all sources) to see what broke.
2. Update the fixture so it mirrors the new structure. Keep it minimal and don't paste whole pages.
3. Fix the parser until `npm test` passes, then re-run the smoke check.

## Adding a new source

1. Add the site to `classifyUrl` in `src/core/sources/urls.ts` and to `SourceId` in `src/shared/types.ts`.
2. Write a `SourceChecker` in `src/core/sources/<site>.ts` that returns `updatedAt` (and `version`/`title` if available).
3. Register it in `CHECKERS` in `src/core/check.ts` and in `runSmoke` (`src/main/smoke.ts`).
4. If the site sits behind Cloudflare, use `fetcher.browserGet` rather than `fetcher.get`.
5. Add fixtures and tests.

Downloads are separate. Public downloads go in `src/core/downloads.ts` and must be added to
`isAllowedDownloadHost`. Downloads that need a signed-in session go in `src/main/downloads.ts`.

## Ground rules

- Never commit `.package`, `.ts4script` or any other creator's files. Tests build synthetic packages
  in memory (`test/helpers/dbpf-builder.ts`).
- Be gentle with the sites: keep the per-host pacing in `HostQueue`, and don't add background polling.
- Never touch a user's real Mods folder in tests or scripts. Work on temporary copies.
- Keep real creator names out of the repository. Code, tests, fixtures, comments, changelog notes
  and commit messages use the neutral cast — Moonberry, Amberlily, EchoSims, and pack names like Juniper Petal. Two
  files are exempt because the real name *is* the data: [`catalog/overrides.json`](catalog/overrides.json)
  and [`src/main/smoke.ts`](src/main/smoke.ts), which checks live pages.
- Diagnostics and anything else built for a bug report carry no creator names, page addresses or
  folder paths — only the shape of things. `test/report-hygiene.test.ts` enforces this.
- Before opening a pull request, run `npm run lint`, `npm run typecheck` and `npm test`.
