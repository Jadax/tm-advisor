# ⚽ TM Advisor

> If this project saved you time or made your life a little easier, consider buying me a coffee. ☕ Your support helps me maintain this project, fix bugs, and build new features. Support is always appreciated but never expected.
>
> ❤️ https://ko-fi.com/jadax

A smarter way to play TrophyManager. One script that reads the game's own data and tells you exactly what to do — formation, mentality, style, captain, set pieces, transfers, stadium upgrades — all backed by the R5 rating engine the community trusts.

No guessing. No spreadsheets. Just install and play better.

---

## Why This Exists

TrophyManager is deep, but the in-game UI doesn't connect the dots. You end up tabbing between squad pages, transfer lists, stadium screens, and external calculators trying to figure out:

- *Which formation suits my squad?*
- *What mentality should I use against this opponent?*
- *Who should take corners and free kicks?*
- *Which youth players on the transfer list are actually worth signing?*
- *What should I upgrade in my stadium first?*

TM Advisor answers all of these — automatically, on every page — using only data the game already gives you.

---

## Key Features

### 🧠 Tactics Engine

- **Best XI picker** — evaluates formations (4-4-2, 4-5-1, 3-5-2, 4-3-3) using position-aware R5 scores. Penalises players played out of position so you see who *actually* fits where.
- **Mentality & style** — compares your squad strength vs your opponent's as a percentage, then recommends mentality, attacking style, and focus side with reasoning you can verify.
- **Captain & set pieces** — picks captain (highest ASI), corner/free-kick/penalty takers based on the specific skills each role needs.
- **Conditional orders** — generates 5 position-aware substitution orders with exact timing and what to assign on the TM sub screen.
- **Opponent scouting** — reads the next match's expected formation and tactics from the game's own data.

### 📊 Inline Data Columns

Adds **Routine**, **Skill Index**, and **R5** columns directly to the game's own tables:

| Page | What's Added |
|------|-------------|
| `/players/` (your squad) | Rou, SI, R5 with trend arrows (▲/▼) |
| `/club/*/squad` (opponent) | Rou, SI, R5 |
| `/transfer/` | SI, R5 |
| Player profile pages | Stat card with R5 breakdown + Sell-to-Agent / Max Sell Price |

### 🔍 Scouting & Transfers

- **Youth Finder** — scans players you've seen on the transfer list and ranks them by a composite score (R5, SI, routine, age upside). Shows Elite / Strong tiers with sell prices and budget guidance.
- **Senior Targets** — same pool, but filters for players who'd be a genuine upgrade over your weakest starter in their position.
- **Spending Guidance** — calculates a recommended transfer budget based on your cash, wage bill, and a 12-week reserve buffer.
- **Valuation** — shows exact Sell-to-Agent and Max Sell Price for any player with known skills.

### 🏟 Stadium Upgrade Advisor

Ranks every upgradeable facility by ROI — payback period, income gain, maintenance cost. Prioritises youth/training facilities first, then income generators, then everything else. Flags sustainability warnings before you overspend.

### ⚔ Match Page Enhancement

- **R5 overlay** — computes and displays R5 for every player on both teams, with per-team averages.
- **Full match stats** — possession, shots, set pieces, cards, all broken down by side.
- **Event timeline** — minute-by-minute log of goals, cards, and injuries with running score.

### 📈 Development Tracking

Dated squad snapshots track each player's SI, Routine, and R5 over time — so you can see who's improving, who's plateauing, and who's declining.

---

## Installation

**Requires [Tampermonkey](https://www.tampermonkey.net/)** (Chrome, Firefox, Edge, Opera).

### Option A: One-Click Install

[**Install TM Advisor**](https://raw.githubusercontent.com/Jadax/tm-advisor/main/TM_Advisor.js)

Tampermonkey will open a confirmation page. Click **Install**.

### Option B: Manual

1. Open Tampermonkey dashboard → **Utilities** tab
2. Paste the raw script URL or the full script text
3. Click **Import**

---

## Getting Started

1. **Set your club** — visit your squad page (`/club/{id}/squad/`). The script detects your club automatically via `SESSION.main_id`.
2. **Browse the transfer list** — each player you see gets cached for the Youth/Senior shortlists. The more you browse, the better the recommendations.
3. **Visit a match page** — opponent expected tactics are captured from the game's own `test_lineup` data.
4. **Open the dock** — click the ⚽ icon (bottom-right) to see the tab relevant to whatever page you're on.

That's it. No configuration needed.

---

## How the Context-Aware Dock Works

The floating panel shows **one tab at a time** — whichever matches the page you're on:

| Page | Tab |
|------|-----|
| Home | Dashboard |
| Tactics / Players | Tactics |
| Transfer / Scouts / Youth Dev | Scouting |
| Stadium / Finances | Stadium |
| Match pages | Dashboard (with match stats) |

The dock hides itself on `/players/` and `/club/` pages where the inline columns do the work instead.

**Dragging** — drag by the header to reposition. The panel remembers where you left it.

---

## Configuration

TM Advisor works out of the box with sensible defaults. No settings file, no JSON config.

The few tunable values live in `YOUTH_CRITERIA` near the top of the script:

```js
const YOUTH_CRITERIA = {
  maxAge: 18,        // Maximum age for youth shortlist
  minRoutine: 2,     // Minimum routine to qualify
  minASI: 30,        // Minimum Skill Index
  minR5: 10,         // Minimum R5 rating
};
```

Adjust these if you're in a higher division and want to filter more aggressively.

---

## How R5 Works

R5 is the community-validated rating formula. It computes a single number from a player's 14 skills, weighted by position, with a routine bonus that follows a diminishing-returns curve.

TM Advisor's R5 engine is based on two independent community scripts (RatingR6 ReWrite and Brzk's Squad R5 Value) — both derive the same formulas from the game's own data. The weights are per-position (DC, DMC, MC, FC, GK, etc.), and multi-position players get a separate R5 for each eligible position.

No skills are invented. No ratings are guessed. Everything comes from what the game shows you or what the game's own AJAX endpoints return.

---

## Data & Privacy

- **Everything stays in your browser.** All data is stored in `localStorage` — nothing is sent to any external server.
- **Only reads pages you visit.** The script never navigates away or fetches pages you haven't opened.
- **No tracking, no analytics, no cookies.**

---

## FAQ

**The R5 columns don't appear on my players page.**
TM's own JS renders the table after the page loads. The script retries automatically for a few seconds. If columns still don't appear, try a hard refresh (Ctrl+Shift+R).

**Youth shortlist is empty.**
You need to browse the `/transfer/` page first. The shortlist only shows players you've actually seen on the transfer list — it doesn't fetch players on its own.

**Opponent tactics show "Unknown".**
Visit the upcoming match page (`/matches/{id}/`) at least once. The script captures formation and tactics from the game's own data on that page.

**Can I use this on Firefox?**
Yes — Tampermonkey works on Firefox, Chrome, Edge, and Opera.

---

## Contributing

Contributions are welcome. If you find a bug or want to add a feature:

1. Fork the repo
2. Create a branch (`git checkout -b feature/my-thing`)
3. Make your changes — keep it to one file (`TM_Advisor.js`)
4. Run `node --check TM_Advisor.js` to verify syntax
5. Open a PR with a clear description

If you're adding a game formula, cite your source (official wiki or named community script).

---

## License

[MIT](https://opensource.org/licenses/MIT) — use it, modify it, ship it. Just don't claim it's affiliated with Trophy Games.

---

<p align="center"><em>Not affiliated with, endorsed by, or connected to Trophy Games A/S. "TrophyManager" is a trademark of its respective owner.</em></p>
