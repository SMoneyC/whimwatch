# Changelog notes

One file per change, so two pull requests never edit the same line of
`CHANGELOG.md` and never conflict over it.

Name the file `<section>-<what-it-is>.md`, where the section is one of
`added`, `changed`, `deprecated`, `removed`, `fixed` or `security`, and write
the note as the bullets you want in the changelog:

```
changes/fixed-loverslab-dates.md

- LoversLab files updated today no longer show yesterday's date.
```

Write for someone using WhimWatch, not for someone reading the code: what
changed for them, in a sentence. Several bullets in one file are fine when one
change needs them. Changes nobody using the app would notice (refactors, test
tidying, CI) don't need a note at all.

Releasing folds every note here into a new `CHANGELOG.md` section and empties
this folder — see `docs/maintainer/releasing.md`.
