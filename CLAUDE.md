# TM Advisor

Single-file Tampermonkey userscript (`TM_Advisor.js`) for trophymanager.com. One IIFE, numbered `SECTION` blocks — the file's header comment holds the authoritative table of contents. Jump straight to the section you need; never scan the whole file.

`TM Guide/` is third-party reference material (official wiki PDFs + community userscripts). Read-only: consult it to confirm formulas, never copy a script wholesale.

## Rules

- Reuse before adding: grep for an existing helper first (`ensureR5`, `slotRating`, `bestFormation`, `buildMatchPlan`, `xiImpact`, `youthPace`, `bucketFor`, `sideFor`, `parseMoney`, `fmtMoney`, `bindBtn`, `esc`, `badge`, `costRow`, `playerLink`, `ago`, `fetchDoc`, `fetchMatchJson`, `tmPost`, `sleep`). One helper per concept.
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
- Favourite positions arrive in TWO formats: display (`players_ar`, tactics page, players_get_select: "D/DM L", "M LR", "OM C, F") and codes (tooltip.ajax, youth.ajax: "dl,dml", "mr,ml"). Engine code expects display — convert at ingestion with `displayFp`. Codes read as display silently zero TM's position penalty (seen live).
- `players_get_select` field traps: name is `player_name` (no `name`); stars are `rec_count` — `rec` is an unrelated raw ≈14 figure. Match-report line-ups (`match.ajax.php`) carry `rec` in stars + `routine` + `position` (slot) per player, also pre-match for the next fixture.
- `/ajax/fixtures.ajax.php` POST `type=club&var1=<clubId>` (or `type=league&var1=<country>&var2=<div>&var3=<group>`) — `{ "YYYY-MM": { matches: [{id, date, hometeam, awayteam, result, matchtype}] } }`; unplayed = no `result`
- `/ajax/youth.ajax.php` POST `{type:'get'}` (the page's own load call, read-only) → `{players: {id: {player_name, favposition 'dc'|'gk'…, age, wage, fee, strength…/handling…/aerial/oneonones}}, cash, squad_size}`; skills are hidden until revealed; NO SI. Cards render as `div.youth_player#youth_player_<id>` (not table rows). Reports arrive weekly (Saturday).
- Page globals: `players_ar` (/players/), `test_lineup` (/matches/), facility JS on /stadium/

## Tactics page (`/tactics/`, `js/tactics_v2.js` — read + written live 2026-11-01)

- `players` / `on_field_assoc` are filled ASYNCHRONOUSLY (`tactics_init` posts `/ajax/tactics_get.ajax.php` → `{players, formation_assoc, formation, formation_subs, positions}`); at document-end they are still `{}`. Never read them — fetch that endpoint yourself (`loadTacticsPage`). The mentality/attacking/focus `<select>`s are server-rendered and safe to read.
- Squad fields (`players`: `skills[]` keyed `strength…set_pieces` / GK `handling…throwing`, star skills are `<img alt='20'>` strings, `skill_index` comma string, `routine`, `fp` "D/DM L" / "OM C, F", `injury`, `banned`, `status_no_check` holds the yellow-card ban-risk icon), `on_field_assoc` (key → player_id, "0" = empty), `cond_orders`, `reserves`, `national`, `miniGameId`.
- Slot keys + TM's position numbers: `gk`0 · `dl dcl dc dcr dr` 1-5 · `dml dmcl dmc dmcr dmr` 6-10 · `ml mcl mc mcr mr` 11-15 · `oml omcl omc omcr omr` 16-20 · `fcl fc fcr` 21-23. Bench `sub1`=GK `sub2`=DEF `sub3`=MID `sub4`=WING `sub5`=FWD (UI lists sub5 first). Roles `captain corner penalty freekick`.
- Out-of-position penalty is TM's own: `retPlayerMood(fp, posNumber)` → 0-4, each step = 10% (source comments: side C↔L/R 20%, L↔R 10%; one line 10%, D→F 40%; non-GK in goal 40%; capped 4).
- Save XI + bench + roles in ONE post: `$.post('/ajax/tactics_post.ajax.php', {on_field: <full 33-key map>, players: {pid: slotKey | 'out'}, reserves, national, miniGameId})` — roles are taken from `on_field`. Reply is HTML, not JSON (request `'text'`). Settings: same URL, `{save: 'mentality'|'attacking'|'focus', value, club_id, reserves, national, miniGameId}` → `[true, clubId, "0"]`.
- Conditional orders: `/ajax/tactics_co_post.ajax.php` with one `cond_orders[i]` record (keep its `ID`) + reserves/national/miniGameId → `{saved:true}`. EVENT 1=minute (PAR), 4=red card; COND 1=winning by PAR, 3=losing by PAR (negative), 4=any; ORDER 2=mentality (PAR1), 1=sub (PAR1 out, PAR2 in, PAR3 slot key). The page's own `co_save(0)` is a no-op (falsy guard) — post directly.
- Always read back after a reload (`tactics_get` `formation_assoc`, the three selects, `tactics_co_get`); `node --check` can't see any of this. Apply/Undo live in SECTION 5G and do exactly that (`saveTacticAndVerify` → reload → `verifyPendingApply`).
- Learning (SECTION 5I): `matchBank` = compact per-side features of every played division match (cap 600); `fitResultModel` = least squares GD ~ home + Δrec(stars) + Δlog-routine. Setting effects are residuals vs that model, per context, from OTHER teams only — we played one setting all season, so our own over-performance (`teamFactor`, shrunk k=10) would otherwise be credited to it (seen live). A setting overrides the heuristic only with n ≥ 12 per context and a gap > 1.5 SE.
- Autopilot (SECTION 5H, `runAutopilot`) works from ANY page — reads/writes are plain same-origin posts, settings are read from a fetched `/tactics/` (`<option selected>`). Guards: off by default, once per match id, ≥20 min between attempts, never <1 h before the home page's kickoff (`parseKickoff`, refuses unparseable times), only when `opponentReadiness()` says the scanned opponent is the next fixture.
- Test changes on the live page without installing: push the work tree to a throwaway branch (`git commit-tree` + `git push origin <sha>:refs/heads/wip-x`, HEAD untouched), then in the signed-in browser pane `(0, eval)(await fetch('https://raw.githubusercontent.com/Jadax/tm-advisor/<sha>/TM_Advisor.js').then(r => r.text()))`. Delete the branch after.

## Cache keys (`tmAdvisor_<clubId>` single JSON blob)

Core slices: `home finances maintenance club players stadium opponent opponentExpected opponentScouting history transferSeen youthShortlist seniorShortlist scoutReports leagueStrength lastMatchResult lastMatchPage tacticsBackup tacticsApplied autopilot autopilotLog matchBank matchBankCrawl predictions`. Prefs live in their own keys: `tmAdvisor_autopilot` `{enabled, dryRun}`, `tmAdvisor_restBanRisk`. Write via `setSlice` only — it goes through the quota-guarded `saveCache`.
