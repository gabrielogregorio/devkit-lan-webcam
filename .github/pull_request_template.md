## What changes

<!-- one or two lines: what the user notices -->

## Changelog

[...autoGenerate]

## Checklist

- [ ] On a `release/x.x.x` branch, `VERSION` bumped (merging into `main` creates the tag `vX.Y.Z` and the release)
- [ ] `./run-tests.sh` ends with `ALL GREEN` (`RUN_E2E=1` when the page changed)
- [ ] New page text is English (`t('…')`) with its line in every catalog in `web/src/lib/locales/`
- [ ] Changed `pyproject.toml`? Ran `uv lock` and exported both `requirements*.txt`
- [ ] Tested with a real device on the LAN when the page, the server or the module setup changed
