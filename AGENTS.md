# Frostline — WeeWX v5 Skin

**Stack:** Python 3.12 | WeeWX v5 skin | Cheetah3 templates (encoding = utf8) | vanilla HTML/CSS/JS (Chart.js v4 CDN + SRI + offline Canvas 2D fallback)

**Layout:**
`frostline/` — skin source (`skin.conf`, `*.html.tmpl`, `assets/css`, `assets/js`, `assets/icons`, `data/`) | `tests/` — Python unittest | `scripts/` — build tools | `docs/screenshots/` | `.github/workflows/pages.yml` — GitHub Pages deploy

**Verify:**
- `./scripts/run_tests.sh` — runs `python -m unittest discover -s tests -p test_*.py -v` + `build_preview.py`
- `./scripts/build_release.sh <version>` — creates `dist/weewx-frostline-v<ver>.tar.gz`

**Hard Rules:**
- `skin.conf` must NOT hardcode `group_temperature`, `group_speed`, or `group_pressure` — inherit from `weewx.conf`.
- Always run `./scripts/run_tests.sh` after any template or config change.
- Default `HTML_ROOT` is `public_html/frostline`; do not deploy to root web directory.
- No build toolchain (Webpack, etc.) — everything is hand-written HTML/CSS/JS.
- All `*.html.tmpl` templates must include the `chart-fallback.js` offline Canvas 2D fallback for Chart.js CDN failures.
- MIT licensed (see `LICENSE`); derivative works must retain copyright notice.

## Release
- Version files: `install.py`, `changelog`
- Build/package: `python3 -m pytest tests/test_skin.py` (attach release zip if applicable)