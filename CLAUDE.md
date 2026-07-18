# TM Advisor

Single-file Tampermonkey userscript (`TM_Advisor.js`) for TrophyManager. All logic lives in one IIFE, organized into numbered `SECTION` blocks (see the file's own header comment for the current table of contents — read that first, don't re-derive structure from scratch).

`TM Guide/` = reference material only (official wiki PDFs + community userscripts). Consult it to confirm game formulas/rules; never edit it, never copy a script wholesale.

## Active Rules

- Read the file's SECTION header comment before editing; jump straight to the relevant section instead of scanning the whole file.
- Don't re-read the whole file after an edit — Edit/Write already error on failure; trust it worked.
- One helper per concept. Grep for an existing function before writing a new one (`ensureR5`, `bucketFor`, `parseMoney`, `money()` formatters etc. already exist — reuse them).
- Game formulas (R5, Sell-to-Agent, Max Sell Price, training/growth) must trace to a source (official wiki page or a named community script) — cite it in a one-line comment. Never invent a formula.
- No speculative features, config toggles, or abstractions beyond what's asked.
- Comments only where the WHY is non-obvious (a game quirk, a confirmed-but-surprising formula, a past bug this prevents). No restating what the code does.
- Keep responses terse: state the change and where it lives, skip preamble and trailing summaries beyond 1-2 lines.
- After any edit, run `node --check TM_Advisor.js` — that's the whole verification loop for this project, no build step, no tests.
- Bump `@version` in the userscript header on every functional change.
- Public repo: https://github.com/Jadax/tm-advisor (main branch). After every change that bumps @version, commit and push automatically — no need to ask each time. Commit message format: `vX.Y.Z: <one-line summary>`. Never commit `TM Guide/` or `.claude/` (gitignored — third-party reference material and local session config).
