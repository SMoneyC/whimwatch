# Third-party notices

WhimWatch's own code is under the [MIT License](LICENSE). The app also includes the software below,
each under its own licence. Every licence here allows redistribution in an MIT-licensed app, as long as
its notice ships with the app, which the build takes care of:

- The renderer build writes `licenses/LICENSE.txt` and `licenses/THIRD_PARTY_LICENSES.txt` with the full text of every
  licence below (`scripts/third-party-licenses.ts`). Settings → Help & about → **Licences** shows them.
- electron-builder adds Electron's and Chromium's licences (`LICENSE.electron.txt`,
  `LICENSES.chromium.html`) next to the app.
- The build fails if a dependency's licence isn't on the reviewed allowlist, so an incompatible licence
  can't arrive through a dependency update.

| Component | Used for | Licence |
|---|---|---|
| [Electron](https://www.electronjs.org) and [Chromium](https://www.chromium.org) | The app runtime | MIT; Chromium's components under their own licences (BSD and others) |
| [Manrope](https://github.com/sharanda/manrope) (via `@fontsource-variable/manrope`) | Interface font | SIL Open Font License 1.1 |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) (via `@fontsource-variable/jetbrains-mono`) | File names and versions | SIL Open Font License 1.1 |
| [Lucide](https://lucide.dev) (`lucide-react`) | Icons | ISC |
| [React](https://react.dev) (`react`, `react-dom`, `scheduler`) | Interface | MIT |
| [7-Zip](https://www.7-zip.org) `7za` (via `7zip-bin`, MIT) | Unpacking `.7z` downloads | GNU LGPL 2.1 or later (some parts BSD). The unmodified executable ships; source: [7-zip.org](https://www.7-zip.org), [p7zip](https://github.com/p7zip-project/p7zip) |
| [UnRAR](https://www.rarlab.com/rar_add.htm) (compiled to WebAssembly by `node-unrar-js`, MIT) | Unpacking `.rar` downloads | UnRAR licence: free to use and redistribute; may not be used to re-create the RAR compression algorithm |
| `cheerio`, `yauzl`, `megajs` and their dependencies | Reading pages, zip files, Mega downloads | MIT, ISC, BSD-2-Clause |

The fonts are used unmodified under their original names, as the SIL Open Font License requires for
bundling. The OFL doesn't extend to the software that uses them.

The 7-Zip and UnRAR licence texts are kept in [`build/licenses/`](build/licenses), because the npm
packages that bundle those binaries don't include them.
