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

### ⚡ Match Copilot

One **Prepare match** button on the Dashboard does everything the next match needs — each step behind its own switch, every save read back from the game:

| Step | What it does |
|---|---|
| Opponent scan | Their squad with real skills, the XI they've saved for this fixture, their last 5 matches' tactics |
| Reserves | Youths (≤21) outside the first XI + bench go down for minutes and routine; promoted back when they'd start. The reserves get their own full plan for *their* next opponent — youths first, settings, conditional orders |
| Tactics & orders | XI, bench, captain & set-piece takers, mentality/style/focus and all 5 conditional orders |
| Custom training *(TM Pro)* | Starts from the community-standard role templates (DEF 2-3-2-2-3-0, MID 2-1-2-3-2-2, WING 2-1-3-2-2-2, FWD 2-0-2-2-3-3), then moves up to 2 dots per player toward his weakest key skills; groups that stalled for 3 weeks count half; fully developed players go 2-2-2-2-2-2. Without Pro it sets the standard drill groups instead |
| Youth pull | On each weekly youth report: hire potential ≥17 where the squad needs that position, fire the rest — only when the report actually shows potential |
| Scouting | Sends free scouts to your youths first; flags any scout with 20s in the key stats on the hire list (never hires) |
| Facilities *(off until you enable it — spends cash)* | Training ground / youth academy first, else an income facility that pays back within 26 weeks; never one already building, one per run, never into your wage reserve |

**Autopilot is on by default** (switch it off on the Dashboard): whenever a TM page is open in your browser it prepares both teams for every fixture, runs training once per training week, handles each weekly youth report, scouts daily — never inside a match's tactics lock. It can only run while TM is open in a browser with the script installed, so open TM at least once before each match locks. A dry run shows exactly what it would change.

No slot is ever left empty (an empty slot can forfeit a match): if a position has no natural player, the best available player with the smallest out-of-position penalty takes it — even an outfielder in goal as a last resort. Conditional orders are timed to the matchup: as the underdog the team holds a lead early and chases late, as the favourite it chases early and protects late.

### 🧠 Tactics Engine

- **Best XI picker** — rates every player in every slot with that slot's own R5 weights, applies TM's own out-of-position penalty (10% per step, read from the game's tactics code), and finds the optimal XI across 11 formations. Tells you when formations are a near-tie, so you know the shape barely matters and who plays where does.
- **Mentality & style** — compares your squad strength vs your opponent's as a percentage, then recommends mentality, attacking style, and focus side with reasoning you can verify.
- **Formation counters** — when the opponent's formation is known, shows the community's counter suggestion for reference only (unverified, never used to pick the formation).
- **Fixture difficulty** — rates each upcoming match Comfortable / Even / Tough from the opponent's best-XI R5, so you know which weeks deserve real prep.
- **One-click Apply** — on the Tactics page, preview every change (XI, bench, captain/set-piece takers, mentality/style/focus, all 5 conditional orders) and save it in one click. The script then reloads the page and reads every value back to confirm it really saved; **Undo** restores the previous tactic. Apply stays disabled until the opponent you've scanned is your actual next fixture, and a toggle rests players who are one yellow card from a ban.
- **Learns from your division's results** — reads every played match report in your division (both line-ups, each side's mentality/style/focus, the score) and fits one result model on strength. Mentality and style only change from the built-in rules when other teams' results in *your* situation (underdog / even / favourite) clearly favour something else; the card shows the evidence, your predicted result, and how past predictions turned out.
- **Autopilot (off by default)** — switch it on from the Dashboard and the script applies the match plan before each match whenever you open any TM page: once per match, never once tactics are about to lock (TM locks them roughly an hour before kickoff; times are read on the game's own clock, whatever your time zone), only after scanning the actual next opponent, and every save is read back. A dry-run mode logs what it would change without saving anything.
- **Captain & set pieces** — picked from the XI you'll actually field: takers ranked by the same skill sums the R5 formula uses for its set-piece bonuses; captain = most experienced (highest routine, a labelled heuristic).
- **Conditional orders** — generates 5 position-aware substitution orders with exact timing and what to assign on the TM sub screen.
- **Opponent scouting** — reads the next match's expected formation and tactics from the game's own data. Also compiles the opponent's usual formation/mentality/style from their last 5 matches.

### 📊 Inline Data Columns

Adds **Routine**, **Skill Index**, and **R5** columns directly to the game's own tables:

| Page | What's Added |
|------|-------------|
| `/players/` (your squad) | Rou, SI, R5 with trend arrows (▲/▼) |
| `/club/*/squad` (opponent) | Rou, SI, R5 |
| `/transfer/` | SI, R5 |
| Player profile pages | Stat card with R5 breakdown + Sell-to-Agent / Max Sell Price |

### 🔍 Scouting & Transfers

- **Market Scan** — one click searches the whole transfer list itself (every position, ages 18–27, foreign players included by default — the home market alone is tiny), checks routine for the top candidates, and ranks the **top seniors** and **top youth** below. Read-only: it never bids.
- **Youth Finder** — ranks youngsters (18–20, the youngest the market lists) by **development pace**: skill points gained per year since 16, read from their SI with the same formula the R5 engine uses — boosted when a scout report shows growth headroom. Flags any who'd already start for you.
- **Senior Targets** — every candidate is judged by what he does to **your best XI**: the script re-picks your optimal XI with him added and shows the gain, the slot he'd take and who he'd replace — so position, your depth there and TM's out-of-position penalty all count.
- **Market-value verdict** — for every shortlisted player, compares the live bid against the game's Sell-to-Agent / Max Sell Price to flag it **Underpriced / Fair / Overpriced** at a glance.
- **Bloom-phase estimate** — grades each scout report's youth by bloom phase (from age + potential headroom) so you know who to train hard before it ends.
- **Spending Guidance** — calculates a recommended transfer budget based on your cash, wage bill, and a 12-week reserve buffer.
- **Valuation** — shows exact Sell-to-Agent and Max Sell Price for any player with known skills.

### 🏆 League Squad Strength

A dedicated **League tab** ranks every club in your division by the average R5 of its best 11 (not points), highlighting where you sit and which remaining fixtures are toughest.

### 🎯 Training Recommendations

On the Tactics tab, flags each squad player's weak **primary skills** for their natural position to train next, calls out players whose R5 has **plateaued**, and reminds you which youths are still in their **development-bonus window** (train them hard).

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

1. **Set your club** — visit your squad page (`/club/{id}/squad/`). The script detects your club automatically via the game's own `SESSION.id`.
2. **Browse the transfer list** — each player you see gets cached for the Youth/Senior shortlists. The more you browse, the better the recommendations.
3. **Visit a match page** — opponent expected tactics are captured from the game's own `test_lineup` data.
4. **Open the dock** — the panel sits bottom-right (collapsed by default); click its header to expand the tab relevant to whatever page you're on.

That's it. No configuration needed.

---

## How the Context-Aware Dock Works

The floating panel shows **one tab at a time** — whichever matches the page you're on:

| Page | Tab |
|------|-----|
| Home / Fixtures / Statistics / History | Dashboard |
| Tactics | Tactics — Apply, the match plan, results evidence, training priorities |
| Transfer / Scouts | Scouting |
| Stadium / Finances / Maintenance / Wages / Sponsors | Stadium |
| League | League squad strength |
| Match pages | Dashboard (with match stats) |

**Match-day status, always visible** — even collapsed, the dock's header reads e.g. *"v Mashau · 19:00 · locks in 4h 54m · ✔ tactic set"* (game time), turning amber (*"⚠ tactic not set"*) when no plan has been applied for the next match.

The dock hides itself on `/players/`, `/club/` and `/youth-development/`, where the game page itself is enhanced instead: Rou/SI/R5 columns on your Players page and on every squad overview (yours included), a stat card on player profiles, and a **STAR / KEEP / MAYBE / RELEASE** badge on each youth-report recruit once its skills are revealed.

**Dragging** — drag by the header to reposition. The panel remembers where you left it.

---

## Configuration

TM Advisor works out of the box with sensible defaults. No settings file, no JSON config.

The few tunable values live in `YOUTH_CRITERIA` near the top of the script:

```js
const YOUTH_CRITERIA = {
  maxAge: 20,             // Youth shortlist age cap (the market lists nobody under 18)
  minRoutine: 0,          // Minimum routine (youths have played few matches, so ~0 is normal)
  minASI: 30,             // Minimum Skill Index
  minR5: 10,              // Minimum R5 rating
  highPotentialGrowth: 1.5, // potential ≥ this × current rec = "high potential" badge
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

- **Everything stays in your browser.** All data is stored in `localStorage` — nothing is sent anywhere except trophymanager.com itself.
- **It does fetch TM pages in the background** — your next fixture, the opponent's squad and recent matches, your division's match reports (daily, capped), and transfer-list searches when you press Market Scan. Requests are sequential with short pauses, never in bursts.
- **It only changes your club when you ask it to:** Apply / Undo on the Tactics page, Prepare match, or autopilot — and only the steps you've switched on. It never bids, buys or sells players.
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
