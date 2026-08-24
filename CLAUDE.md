# TM Advisor

Single-file Tampermonkey userscript (`TM_Advisor.js`) for trophymanager.com. One IIFE, numbered `SECTION` blocks — the file's header comment holds the authoritative table of contents. Jump straight to the section you need; never scan the whole file.

`TM Guide/` is third-party reference material (official wiki PDFs + community userscripts). Read-only: consult it to confirm formulas, never copy a script wholesale.

## Rules

- Reuse before adding: grep for an existing helper first (`ensureR5`, `bucketFor`, `sideFor`, `parseMoney`, `fmtMoney`, `bindBtn`, `esc`, `badge`, `costRow`, `playerLink`, `ago`, `fetchDoc`, `fetchMatchJson`). One helper per concept.
- Game formulas (R5, Sell-to-Agent, Max Sell Price, training/growth) must trace to a cited source — official wiki page or named community script, in a one-line comment. Never invent numbers. Heuristics must be labelled as heuristics in both comments and UI copy.
- Escape every game-supplied string with `esc()` before it enters an innerHTML template — club/player names are attacker-controlled.
- Comments only for non-obvious WHY (game quirks, confirmed-surprising formulas, past bugs prevented). No restating code.
- After any edit run `node --check TM_Advisor.js` — that is the entire verification loop. No build step, no tests.
- Bump `@version` in the userscript header on every functional change.
- Public repo: https://github.com/Jadax/tm-advisor (branch `main`; user-facing docs live in `README.md`). After any change that bumps `@version`, commit and push automatically — no need to ask. Format: `vX.Y.Z: <one-line summary>`. Never commit `TM Guide/` or `.claude/` (gitignored).
- Keep replies terse: the change and where it lives, ≤2 lines of summary.

## Data sources (all same-origin, game's own endpoints)

- `/ajax/players_get_select.ajax.php` — full real skills for any club's squad
- `/ajax/match.ajax.php?id=` — lineups + mentality/style/focus per side, full match_data
- `/ajax/scouts_get_reports.ajax.php` — scout rec/potential for your reported players
- `/ajax/tooltip.ajax.php` — per-player skills/SI/routine/wage (precise age incl. months)
- Page globals: `players_ar` (/players/), `test_lineup` (/matches/), facility JS on /stadium/

## Cache keys (`tmAdvisor_<clubId>` single JSON blob)

Core slices: `home finances maintenance club players stadium opponent opponentExpected opponentScouting history transferSeen youthShortlist seniorShortlist scoutReports leagueStrength lastMatchResult lastMatchPage`. Write via `setSlice` only — it goes through the quota-guarded `saveCache`.
