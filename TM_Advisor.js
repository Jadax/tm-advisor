// ==UserScript==
// @name         TM Advisor — Tactics, Stadium, Scouting & Youth Dashboard
// @namespace    https://tushantsharma.tools/tm-advisor
// @version      3.36.0
// @description  A single visual advisor for TrophyManager. A collapsible dock (bottom-right) that shows exactly ONE tab — whichever is relevant to the page you're on: Dashboard on the homepage, Tactics on the tactics page, Scouting on the transfer/scouts pages, Stadium on stadium/finances. The dock is hidden on /club/ and /players pages, which instead get inline Rou/SI/R5 columns and a compact player-profile stat card; background capture/caching still runs there. Tactics gives you formation, mentality/style/focus, captain/set-piece takers, bench, position-aware conditional substitution orders and the opponent's expected next-fixture tactics. Scouting gives a tiered (Elite/Strong) youth and senior transfer shortlist built ONLY from players actually seen on the /transfer/ list, with confirmed Sell-to-Agent/Max Sell Price valuations and spending guidance. Overlays accurate R5 + team averages on the match page, and captures full match stats and a goal/card/injury timeline. All numbers come from the game's own data or formulas cross-confirmed against multiple independent community scripts — nothing is guessed.
// @author       Tushant Sharma
// @license      MIT
// @match        https://trophymanager.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=trophymanager.com
// @grant        none
// @run-at       document-end
// @homepageURL  https://tushantsharma.tools/tm-advisor
// @supportURL   https://tushantsharma.tools/tm-advisor/support
// @downloadURL  https://raw.githubusercontent.com/Jadax/tm-advisor/main/TM_Advisor.js
// @updateURL    https://raw.githubusercontent.com/Jadax/tm-advisor/main/TM_Advisor.js
// ==/UserScript==

/* ================================================================
 *  TM ADVISOR — © Tushant Sharma. Released under the MIT licence.
 *
 *  Not affiliated with, endorsed by, or connected to Trophy Games A/S.
 *  "TrophyManager" is a trademark of its respective owner. This is an
 *  unofficial, fan-made helper that only reads pages you already have
 *  access to and stores everything locally in your own browser.
 *
 *  TABLE OF CONTENTS  (search for the exact heading to jump there)
 *  ----------------------------------------------------------------
 *   SECTION 0  CONSTANTS / GAME KNOWLEDGE
 *   SECTION 1  CACHE LAYER
 *   SECTION 1B DEVELOPMENT HISTORY   (dated squad snapshots + trends)
 *   SECTION 2  PARSERS               (turn raw HTML -> clean data)
 *   SECTION 2B RATING ENGINE         (R5/R6 formula)
 *   SECTION 2C VALUATION             (numeric category breakdown, exact
 *                                       Sell-to-Agent/Max Sell Price)
 *   SECTION 3  NETWORK REFRESH       (fetch other pages, no nav)
 *   SECTION 4  LIVE-PAGE AUTO CAPTURE (+ Rou/SI/R5 columns on players
 *                                       & transfer tables; Keep/Release
 *                                       verdict badges on youth-development cards ⓘ;
 *                                       player-profile card with
 *                                       breakdown/valuation; match-page R5
 *                                       overlay + full match stats &
 *                                       goal/card/injury timeline)
 *  ⓘ recruit verdicts are graded (STAR/KEEP/MAYBE/RELEASE) with SI-vs-age
 *    and peak-reach detail in the row tooltip
 *   SECTION 5  TACTICS ENGINE        (per-slot R5 x TM's own position penalty,
 *                                       optimal XI per formation, buildMatchPlan:
 *                                       XI/bench/roles/settings/cond orders)
 *   SECTION 5B YOUTH FINDER          (transfer-list-only talent shortlist)
 *   SECTION 5C SENIOR TARGETS        (transfer-list-only, position-need)
 *   SECTION 5D SPENDING GUIDANCE     (cash/wage-aware transfer budget)
 *   SECTION 5E TRAINING RECOMMENDATIONS (weak-primary + plateau + bloom advice)
 *   SECTION 5F LEAGUE STRENGTH       (rank clubs by best-XI R5)
 *   SECTION 5G APPLY TO TACTICS PAGE (Preview/Apply/Undo, read-back verified)
 *   SECTION 5H COPILOT / AUTOPILOT   (on by default; per-job cadence, lock-guarded)
 *   SECTION 5I LEARNING              (division match bank, fitted result model,
 *                                       evidence-gated mentality/style, graded predictions)
 *   SECTION 5J TRAINING GROUPS       (each player in the drill his position needs)
 *   SECTION 5K FACILITY UPGRADES     (copilot step, off by default, rule-based)
 *   SECTION 5L MARKET SCAN           (searches the transfer list itself; never bids)
 *   SECTION 5M CUSTOM TRAINING       (TM Pro: role templates + per-player tweaks)
 *   SECTION 5N RESERVE TEAM          (demote ≤21 non-squad youths, promote, reserve XI)
 *   SECTION 5O YOUTH PULLS           (hire ≥17 potential where needed; acts only on real potential)
 *   SECTION 5P SCOUTING              (keeps 1 youth + 1 senior 20-rated scout; sends free scouts)
 *   SECTION 6  STADIUM ENGINE        (upgrade ROI ranking)
 *   SECTION 7  UI                    (styles, panel; ONE context-relevant
 *                                       tab per page)
 *   SECTION 8  BOOT
 * ================================================================ */

(function () {
  'use strict';

  /* ============================================================
   *  SECTION 0 — CONSTANTS / GAME KNOWLEDGE
   * ============================================================ */

  const MENTALITY = { 1: 'Very Defensive', 2: 'Defensive', 3: 'Slightly Defensive', 4: 'Normal', 5: 'Slightly Attacking', 6: 'Attacking', 7: 'Very Attacking' };
  const ATT_STYLE = { 1: 'Balanced', 2: 'Direct', 3: 'Wings', 4: 'Shortpassing', 5: 'Long Balls', 6: 'Through Balls' };
  const FOCUS_SIDE = { 1: 'Balanced', 2: 'Left', 3: 'Central', 4: 'Right' };

  // Position bucket helpers (favourite-position strings look like "D C", "OM L", "DM/D C", "F" etc.)

  const CACHE_KEY_PREFIX = 'tmAdvisor_';
  const now = () => Date.now();
  // Escape any GAME-SUPPLIED string before it goes into an innerHTML template. Club names and
  // manager names are chosen by other players, so they are attacker-controlled: a club named
  // `<img src=x onerror=...>` would otherwise execute in OUR page context, with our session,
  // the moment they show up as our next opponent. Numbers we compute ourselves don't need it.
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const clubId = (window.SESSION && SESSION.id) ? String(SESSION.id) : 'unknown';
  // Your club's own nation code (e.g. "za"), straight from the game's own SESSION var —
  // used to flag which transfer-list/scouted players are home-nation vs. foreign.
  const MY_COUNTRY = (window.SESSION && SESSION.country) ? String(SESSION.country).toLowerCase() : null;
  const cacheKey = () => CACHE_KEY_PREFIX + clubId;

  const FRESHNESS = { fresh: 6 * 3600e3, stale: 24 * 3600e3 }; // <6h green, <24h amber, else red

  /* ============================================================
   *  SECTION 1 — CACHE LAYER
   * ============================================================ */

  function loadCache() {
    try { return JSON.parse(localStorage.getItem(cacheKey())) || {}; }
    catch (e) { return {}; }
  }
  // `transferSeen` accumulates every player you've ever scrolled past on the transfer list and
  // is never otherwise pruned, so it's the one slice that grows without bound — left alone it
  // eventually blows localStorage's ~5MB quota, at which point EVERY setItem throws and all
  // caching silently stops. Cap it at the most-recently-seen N, and on a quota failure prune
  // hard and retry once rather than losing the whole cache.
  const TRANSFER_SEEN_CAP = 1500;
  function pruneTransferSeen(c, cap) {
    const slice = c.transferSeen;
    if (!slice || !slice.data) return false;
    const entries = Object.entries(slice.data);
    if (entries.length <= cap) return false;
    entries.sort((a, b) => (b[1]._seen || 0) - (a[1]._seen || 0));
    slice.data = Object.fromEntries(entries.slice(0, cap));
    return true;
  }
  function saveCache(c) {
    pruneTransferSeen(c, TRANSFER_SEEN_CAP);
    try {
      localStorage.setItem(cacheKey(), JSON.stringify(c));
    } catch (e) {
      if (pruneTransferSeen(c, Math.floor(TRANSFER_SEEN_CAP / 3))) {
        try { localStorage.setItem(cacheKey(), JSON.stringify(c)); return; } catch (e2) {}
      }
      console.warn('TM Advisor: cache write failed (storage full?)', e);
    }
  }
  function setSlice(name, data) {
    const c = loadCache();
    c[name] = { t: now(), data };
    saveCache(c);
    return c[name];
  }
  function getSlice(name) {
    const c = loadCache();
    return c[name] || null;
  }

  /* ------------------------------------------------------------
   *  SECTION 1B — DEVELOPMENT HISTORY (dated squad snapshots)
   *  We keep a dated snapshot of the squad so we can show how each
   *  player's SI / Routine / R5 is trending over time — data we
   *  already capture,
   *  we just weren't remembering yesterday's values. Stored under
   *  a dedicated 'history' slice keyed by YYYY-MM-DD, one snapshot
   *  per day (later same-day parses overwrite that day's entry so
   *  the store stays compact). Capped to the most recent 60 days.
   * ---------------------------------------------------------- */
  // Training runs once a week (Tuesday, TM guide) — one snapshot per training week, keyed by that
  // week's Tuesday; later parses in the same week overwrite it, so the post-training state wins.
  const HISTORY_MAX_WEEKS = 52;
  function weekKey(ts) {
    const d = new Date(ts || now());
    d.setDate(d.getDate() - ((d.getDay() - 2 + 7) % 7));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function recordSquadSnapshot(players) {
    if (!players || !players.length) return;
    const c = loadCache();
    const hist = c.history && c.history.data ? c.history.data : {};
    // Compact per-player row: only what the trend view needs.
    hist[weekKey()] = players.map(p => {
      ensureR5(p);
      return {
        id: p.id, name: p.name,
        asi: p.asi != null ? Number(p.asi) : null,
        routine: p.routine != null ? Number(p.routine) : null,
        r5: (p._r5 != null && !isNaN(p._r5)) ? Number(Number(p._r5).toFixed(1)) : null,
        ti: p.ti != null ? p.ti : null,
        // Skills too, so custom training can see which dot groups actually produce gains (5M).
        sk: p.skills ? Object.fromEntries(Object.entries(p.skills).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, Number(v) || 0])) : null,
      };
    });
    const weeks = Object.keys(hist).sort();
    while (weeks.length > HISTORY_MAX_WEEKS) delete hist[weeks.shift()];
    c.history = { t: now(), data: hist };
    saveCache(c);
  }

  // Returns { asi, routine, r5 } deltas for a player id between the most recent snapshot
  // and the newest snapshot that is at least `minDaysAgo` older (default: the previous
  // snapshot). Null fields where a baseline isn't available yet.
  function playerTrend(playerId, minDaysAgo) {
    const h = getSlice('history');
    if (!h || !h.data) return null;
    const days = Object.keys(h.data).sort();
    if (days.length < 2) return null;
    const latestDay = days[days.length - 1];
    const latest = (h.data[latestDay] || []).find(p => String(p.id) === String(playerId));
    if (!latest) return null;
    let baseDay = null;
    if (minDaysAgo) {
      const cutoff = Date.now() - minDaysAgo * 86400000;
      for (let i = days.length - 2; i >= 0; i--) { if (new Date(days[i]).getTime() <= cutoff) { baseDay = days[i]; break; } }
    }
    if (!baseDay) baseDay = days[days.length - 2];
    const base = (h.data[baseDay] || []).find(p => String(p.id) === String(playerId));
    if (!base) return null;
    const d = (a, b) => (a != null && b != null) ? +(a - b).toFixed(1) : null;
    return { since: baseDay, asi: d(latest.asi, base.asi), routine: d(latest.routine, base.routine), r5: d(latest.r5, base.r5) };
  }

  const DATA_SOURCES = [
    { key: 'home', label: 'Home / Next Match', url: '/home/', parser: parseHome },
    { key: 'finances', label: 'Finances', url: '/finances/', parser: parseFinances },
    { key: 'maintenance', label: 'Maintenance', url: '/finances/maintenance/', parser: parseMaintenance },
    { key: 'club', label: 'Club', url: '/club/', parser: parseClub },
    { key: 'players', label: 'Squad', url: '/players/', parser: parsePlayers },
    { key: 'stadium', label: 'Stadium', url: '/stadium/', parser: parseStadium },
  ];

  /* ============================================================
   *  SECTION 2 — PARSERS  (operate on a Document — either the live page or
   *     a fetched+DOMParser'd page)
   * ============================================================ */

  function extractVar(doc, varName) {
    const scripts = doc.querySelectorAll('script');
    const re = new RegExp(varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*(\\{[\\s\\S]*?\\});');
    for (const s of scripts) {
      const txt = s.textContent || '';
      const m = txt.match(re);
      if (m) {
        try { return JSON.parse(m[1]); } catch (e) { /* not valid json (js object) -> try eval-safe */ }
        try { return (0, eval)('(' + m[1] + ')'); } catch (e) { /* give up */ }
      }
    }
    return null;
  }
  function extractArrayVar(doc, varName) {
    const scripts = doc.querySelectorAll('script');
    const re = new RegExp(varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*(\\[[\\s\\S]*?\\]);');
    for (const s of scripts) {
      const txt = s.textContent || '';
      const m = txt.match(re);
      if (m) { try { return (0, eval)('(' + m[1] + ')'); } catch (e) {} }
    }
    return null;
  }

  function parseHome(doc) {
    const out = { nextMatch: null };
    const nm = doc.querySelector('.next_match');
    if (nm) {
      const names = [...nm.querySelectorAll('.names .name a')].map(a => a.textContent.trim());
      const links = [...nm.querySelectorAll('.names .name a')].map(a => a.getAttribute('club_link'));
      const leagueLink = nm.querySelector('.event a[league_link]') || nm.querySelector('.event a[href*="/league/"]');
      const dateTxt = nm.querySelector('.event.event_border') ? nm.querySelector('.event.event_border').textContent.trim() : '';
      const matchLink = nm.querySelector('.match_link a');
      out.nextMatch = {
        home: { name: names[0] || null, id: links[0] || null },
        away: { name: names[1] || null, id: links[1] || null },
        when: dateTxt,
        matchUrl: matchLink ? matchLink.getAttribute('href') : null,
        league: leagueLink ? leagueLink.textContent.trim() : null,
        // Actual league path (e.g. "/league/za/2/2/") — this is what was missing before;
        // without it we had no way to know which league table URL belongs to this club,
        // so the League Table row in Data Freshness could never move off "never".
        leaguePath: leagueLink ? leagueLink.getAttribute('href') : null,
      };
    }
    const cash = doc.body.innerHTML.match(/SESSION\["cash"\]\s*=\s*(\d+)/);
    if (cash) out.cash = parseInt(cash[1], 10);
    return out;
  }

  function parseFinances(doc) {
    const out = { weekly: {}, season: {}, balance: null };
    const rowMap = (tableId) => {
      const t = doc.getElementById(tableId);
      const rows = {};
      if (!t) return rows;
      t.querySelectorAll('tr').forEach(tr => {
        const th = tr.querySelector('th');
        const tds = tr.querySelectorAll('td');
        if (th && tds.length >= 1) {
          const label = th.textContent.trim().replace(/\s+/g, ' ');
          rows[label] = [...tds].map(td => td.textContent.trim());
        }
      });
      return rows;
    };
    out.weekly = rowMap('finances');
    out.season = rowMap('finances_year');
    // Broadened from a single exact-phrase regex: tolerate non-breaking spaces / icons
    // between the label and the number, and fall back to a looser "Balance" match if the
    // "Current Balance" phrasing doesn't match exactly on this page variant.
    const txt = doc.body.textContent.replace(/\u00a0/g, ' ');
    const balTxt = txt.match(/Current\s*Balance[:\s]*([\d][\d,]*)/i) || txt.match(/\bBalance[:\s]*([\d][\d,]*)/i);
    if (balTxt) out.balance = parseInt(balTxt[1].replace(/,/g, ''), 10);
    return out;
  }

  // Confirmed from the actual /finances/maintenance/ page source: three tables in order —
  // (1) capacity/attendance-related cost lines, (2) per-facility maintenance breakdown
  // (Name / Level / Cost per Week / Cost per Season), (3) a totals table with "Total
  // Stadium", "Total Maintenance", "Total" rows. We only need tables 2 and 3 here.
  function parseMaintenance(doc) {
    const out = { facilities: [], totals: {} };
    const tables = [...doc.querySelectorAll('table.zebra, table')];
    tables.forEach(table => {
      const headerCells = [...table.querySelectorAll('tr')[0]?.querySelectorAll('th') || []].map(th => th.textContent.trim());
      const isFacilityTable = headerCells.includes('Level') && headerCells.some(h => /Cost.*Week/i.test(h));
      const isTotalsTable = [...table.querySelectorAll('tr')].some(tr => /^Total\b/.test((tr.querySelector('th') || {}).textContent || ''));
      if (isFacilityTable) {
        [...table.querySelectorAll('tr')].slice(1).forEach(tr => {
          const th = tr.querySelector('th'); const tds = tr.querySelectorAll('td');
          if (!th || tds.length < 3) return;
          out.facilities.push({
            name: th.textContent.trim(),
            level: tds[0].textContent.trim(),
            costWeek: parseMoney(tds[1].textContent),
            costSeason: parseMoney(tds[2].textContent),
          });
        });
      } else if (isTotalsTable) {
        [...table.querySelectorAll('tr')].forEach(tr => {
          const th = tr.querySelector('th'); const tds = tr.querySelectorAll('td');
          if (!th || tds.length < 2) return;
          const label = th.textContent.trim();
          if (/^Total/.test(label)) out.totals[label] = { week: parseMoney(tds[0].textContent), season: parseMoney(tds[1].textContent) };
        });
      }
    });
    return out;
  }

  function parseClub(doc) {
    const out = {};
    const nameEl = doc.querySelector('.large a[club_link]');
    out.name = nameEl ? nameEl.textContent.trim() : null;
    const formSpans = [...doc.querySelectorAll('.club_form')];
    out.form = formSpans.map(s => (s.getAttribute('title') || '').trim()).filter(Boolean);
    const info = doc.getElementById('club_info');
    if (info) {
      const txt = info.textContent;
      // Was previously `[^\n]+` which greedily grabbed everything to the next literal
      // newline — but textContent has no real newlines between inline stat labels, so it
      // was concatenating adjacent unrelated text into the value (this is what corrupted
      // the fans figure). Fans/Economy are always immediately followed by their number;
      // capture only the number itself.
      const grabNumber = label => { const r = txt.match(new RegExp(label + ':\\s*([\\d,]+)')); return r ? r[1].trim() : null; };
      const grabWord = label => { const r = txt.match(new RegExp(label + ':\\s*([A-Za-z][A-Za-z\\s]{0,30})')); return r ? r[1].trim() : null; };
      out.economy = grabWord('Economy');
      out.fans = grabNumber('Fans');
      out.stadiumName = grabWord('Stadium');
    }
    return out;
  }

  // players_ar's `age` field encodes "years.MM" — the two digits after the dot are MONTHS
  // (zero-padded), NOT a decimal fraction of a year. Confirmed against the community's
  // "Training Intensity Chart" script, which reads this exact same players_ar global and
  // explicitly documents "26.03" as 26 years + 3 months. Naively parseFloat()-ing it (as this
  // file did before) reads "18.08" as 18.08 decimal years (≈18y 1mo) instead of the correct
  // 18y 8mo (≈18.67) — a real, silent age error feeding every age-based decision (youth/senior
  // cutoffs, the scoutScore age bonus, Max Sell Price/Sell-to-Agent valuation).
  function parseTmAge(raw) {
    if (raw == null || raw === '') return null;
    const str = String(raw);
    const dot = str.indexOf('.');
    if (dot === -1) return parseFloat(str);
    const years = parseInt(str.slice(0, dot), 10) || 0;
    const months = parseInt(str.slice(dot + 1), 10) || 0;
    return years + months / 12;
  }

  function parsePlayers(doc) {
    const arr = extractArrayVar(doc, 'players_ar') || [];
    return arr.map(p => ({
      id: p.id, no: p.no, name: p.name, fp: p.fp, age: parseTmAge(p.age),
      club: p.club != null ? String(p.club) : null, // /players/ lists the reserves too (live: 25 + 19)
      asi: p.asi, rec: parseFloat(p.rec) || 0, rat: parseFloat(p.rat) || 0,
      routine: p.routine !== undefined ? parseFloat(p.routine) : null, // needed for accurate R5
      ti: p.ti != null && p.ti !== '' ? Number(p.ti) : null, // this week's training intensity (plot = its weekly history)
      gp: p.gp, goals: p.goals, assists: p.assists, ban: p.ban, inj: p.inj,
      wage: parseInt(p.wage, 10) || 0,
      plot: Array.isArray(p.plot) ? p.plot.map(Number) : [], // training-intensity history, oldest→newest
      skills: {
        str: p.str, sta: p.sta, pac: p.pac, mar: p.mar, tac: p.tac, wor: p.wor,
        pos: p.pos, pas: p.pas, cro: p.cro, tec: p.tec, hea: p.hea, fin: p.fin,
        lon: p.lon, set: p.set, han: p.han, one: p.one, ref: p.ref, ari: p.ari,
        jum: p.jum, com: p.com, kic: p.kic, thr: p.thr
      }
    }));
  }

  function parseSquadPage(doc) {
    // Used for opponent squad pages: /club/{id}/squad/
    const rows = [...doc.querySelectorAll('#player_table tr')].slice(1);
    const players = rows.map(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 6) return null;
      const nameA = tds[1].querySelector('a');
      const posShort = tds[3].querySelector('.favposition');
      const stars = tds[5].querySelectorAll('img').length;
      const halfStar = [...tds[5].querySelectorAll('img')].some(i => i.src.includes('half_star'));
      return {
        no: tds[0].textContent.trim(),
        name: nameA ? nameA.textContent.trim() : null,
        id: nameA ? (nameA.getAttribute('player_link') || (nameA.getAttribute('href') || '').split('/')[2]) : null,
        age: tds[2].textContent.trim(),
        pos: posShort ? posShort.textContent.trim() : null,
        // Expose the position under `fp` too, so star-estimate opponents flow through the
        // same bucketFor()/sideFor() machinery as real-skills players. Without this every
        // scraped opponent bucketed to midfield (fp was undefined), skewing the formation
        // guess, attack-threat and side-strength maths.
        fp: posShort ? posShort.textContent.trim() : null,
        recStars: stars - (halfStar ? 0.5 : 0), // rough visual rec (0-5 scale)
      };
    }).filter(Boolean);
    const dataBox = doc.querySelector('.column3_a .std');
    let summary = {};
    if (dataBox) {
      const txt = dataBox.textContent;
      const grab = k => { const m = txt.match(new RegExp(k + ':\\s*([^\\n]+)')); return m ? m[1].trim() : null; };
      summary = { size: grab('Squad size'), avgAge: grab('Average age'), avgSkill: grab('Average skill'), totalRec: grab('Total Rec') };
    }
    const nameEl = doc.querySelector('.large a[club_link]') || doc.querySelector('h1, .box_sub_header a');
    const clubName = nameEl ? nameEl.textContent.trim() : null;
    return { players, summary, name: clubName };
  }

  function parseStadium(doc) {
    const facilityData = extractVar(doc, 'facility_data') || {};
    const cashMatch = doc.body.innerHTML.match(/var manager_cash\s*=\s*(\d+)/);
    const cash = cashMatch ? parseInt(cashMatch[1], 10) : null;
    return { facilityData, cash };
  }

  function parseMatchPage(doc) {
    // Extract test_lineup (home/away expected XI + ratings context) if present.
    const lineup = extractVar(doc, 'test_lineup');
    return { lineup };
  }

  // ---- Match report analyser (full stats + event timeline) ----
  // Computes the full stat line and a goal/card/injury timeline from a match's `report`
  // object. Report schema: each minute maps to an array of "chances"; each chance has a
  // `club` id and a `parameters` array whose entries carry one of: goal{player,score[]},
  // shot{team,target}, set_piece(playerId), penalty, yellow(playerId), red(playerId),
  // yellow_red(playerId), injury(playerId).
  // We only read what the match data already contains — nothing is fetched or invented.
  function analyseMatchReport(match) {
    const empty = {
      score: { home: 0, away: 0 },
      stats: { possession: { home: null, away: null }, shots: { home: 0, away: 0 }, shotsOnTarget: { home: 0, away: 0 }, setPieces: { home: 0, away: 0 }, penalties: { home: 0, away: 0 }, yellows: { home: 0, away: 0 }, reds: { home: 0, away: 0 } },
      timeline: [],
    };
    if (!match || !match.report || !match.club) return empty;
    const homeId = String(match.club.home && match.club.home.id);
    const awayId = String(match.club.away && match.club.away.id);
    const lineup = match.lineup || {};
    const nameOf = (pid) => {
      const h = lineup.home && lineup.home[pid], a = lineup.away && lineup.away[pid];
      return (h && h.name) || (a && a.name) || ('Player ' + pid);
    };
    const sideOfPlayer = (pid) => (lineup.home && lineup.home[pid]) ? 'home' : ((lineup.away && lineup.away[pid]) ? 'away' : null);
    const s = JSON.parse(JSON.stringify(empty.stats));
    const timeline = [];
    let lastScore = null;

    Object.keys(match.report).forEach(minute => {
      (match.report[minute] || []).forEach(chance => {
        const chanceSide = String(chance.club) === homeId ? 'home' : (String(chance.club) === awayId ? 'away' : null);
        (chance.parameters || []).forEach(p => {
          if (p.shot && chanceSide) { s.shots[chanceSide]++; if (p.shot.target === 'on') s.shotsOnTarget[chanceSide]++; }
          if (p.set_piece && chanceSide) s.setPieces[chanceSide]++;
          if (p.penalty && chanceSide) s.penalties[chanceSide]++;
          if (p.goal) {
            const pid = p.goal.player, side = sideOfPlayer(pid) || chanceSide;
            if (p.goal.score) lastScore = { home: p.goal.score[0], away: p.goal.score[1] };
            timeline.push({ minute: Number(minute), type: 'goal', side, player: nameOf(pid), playerId: pid, score: p.goal.score ? { home: p.goal.score[0], away: p.goal.score[1] } : null });
          }
          // Cards: a card shown to a player is charged to that player's own side.
          if (p.yellow) { const side = sideOfPlayer(p.yellow); if (side) s.yellows[side]++; timeline.push({ minute: Number(minute), type: 'yellow', side, player: nameOf(p.yellow), playerId: p.yellow }); }
          if (p.red) { const side = sideOfPlayer(p.red); if (side) s.reds[side]++; timeline.push({ minute: Number(minute), type: 'red', side, player: nameOf(p.red), playerId: p.red }); }
          if (p.yellow_red) { const side = sideOfPlayer(p.yellow_red); if (side) { s.yellows[side]++; s.reds[side]++; } timeline.push({ minute: Number(minute), type: 'yellow_red', side, player: nameOf(p.yellow_red), playerId: p.yellow_red }); }
          if (p.injury) { const side = sideOfPlayer(p.injury); timeline.push({ minute: Number(minute), type: 'injury', side, player: nameOf(p.injury), playerId: p.injury }); }
        });
      });
    });
    if (match.match_data && match.match_data.possession) {
      s.possession = { home: match.match_data.possession.home, away: match.match_data.possession.away };
    }
    timeline.sort((a, b) => a.minute - b.minute);
    const score = lastScore || { home: 0, away: 0 };
    return { score, stats: s, timeline };
  }


  // ---- Transfer list parser (live DOM only) ----
  // The /transfer/ page renders its results into #transfer_list as a table whose columns
  // change with the Breakdown/Skills toggle: Breakdown shows Rec + SI, Skills shows the raw
  // skill columns. Neither view shows BOTH SI and skills at once, and the exact R5 formula
  // needs both — so we read whatever the current view exposes and MERGE it per player id
  // into a persistent store, letting SI (from Breakdown) and skills (from Skills) accumulate.
  // We only ever read what the game itself rendered; nothing is fetched or guessed.
  const TL_HEADER_MAP = {
    'name': 'name', 'age': 'age', 'fp': 'fp', 'rec': 'rec', 'si': 'asi', 'routine': 'routine',
    'str': 'str', 'sta': 'sta', 'pac': 'pac', 'mar': 'mar', 'tac': 'tac', 'wor': 'wor', 'pos': 'pos',
    'pas': 'pas', 'cro': 'cro', 'tec': 'tec', 'hea': 'hea', 'fin': 'fin', 'lon': 'lon', 'set': 'set',
    'han': 'han', 'one': 'one', 'ref': 'ref', 'aer': 'ari', 'jum': 'jum', 'com': 'com', 'kic': 'kic', 'thr': 'thr',
    'current bid': 'bid', 'time left': 'time', 'club': 'club_name',
  };
  const TL_SKILL_KEYS = ['str', 'sta', 'pac', 'mar', 'tac', 'wor', 'pos', 'pas', 'cro', 'tec', 'hea', 'fin', 'lon', 'set', 'han', 'one', 'ref', 'ari', 'jum', 'com', 'kic', 'thr'];

  function parseTransferListLive() {
    const table = document.querySelector('#transfer_list table');
    if (!table) return [];
    const headerRow = table.querySelector('tr.header') || [...table.querySelectorAll('tr')].find(r => r.querySelector('th'));
    if (!headerRow) return [];
    const colKeys = [...headerRow.querySelectorAll('th')].map(th => TL_HEADER_MAP[(th.textContent || '').trim().toLowerCase()] || null);
    const store = (getSlice('transferSeen') && getSlice('transferSeen').data) || {};
    const out = [];
    [...table.querySelectorAll('tr')].forEach(row => {
      const idm = (row.id || '').match(/player_row_(\d+)/);
      if (!idm) return;
      const id = idm[1];
      const tds = [...row.querySelectorAll('td')];
      const rec = {};
      colKeys.forEach((k, i) => { if (k && tds[i]) rec[k] = tds[i].textContent.trim(); });
      const nameA = row.querySelector('a[href*="/players/"]') || row.querySelector('.player_name a') || row.querySelector('a');
      // Nationality: the "nat" column has no header text (blank <th> in headers_ar) but is
      // always the FIRST column in both headers_std and headers_skills, so read tds[0]
      // directly rather than via colKeys. The exact markup TM uses for this flag isn't
      // something we could confirm live (the transfer results are injected by the game's own
      // JS, not present in the page's initial HTML), so rather than bet on one class-name
      // convention, inspect the actual element's class/href/src attributes directly and try
      // every convention seen across community scripts (flag-img-XX, flag_XX, a
      // /national-teams/XX/ link, or an <img> whose src path encodes the country code).
      let nat = null;
      const natCell = tds[0];
      const flagEl = natCell && natCell.querySelector('[class*="flag" i], a[href*="/national-teams/"], img, ib, i');
      if (flagEl) {
        const cls = String(flagEl.className || '');
        const clsMatch = cls.match(/flag[-_]?(?:img)?[-_]([a-z]{2,3})\b/i);
        if (clsMatch) nat = clsMatch[1].toLowerCase();
        if (!nat) {
          const href = flagEl.getAttribute && flagEl.getAttribute('href');
          const hrefMatch = href && href.match(/\/national-teams\/([a-z]{2,3})\//i);
          if (hrefMatch) nat = hrefMatch[1].toLowerCase();
        }
        if (!nat) {
          const src = flagEl.getAttribute && (flagEl.getAttribute('src') || flagEl.getAttribute('data-src'));
          const srcMatch = src && src.match(/\/flags?\/(?:[\w-]+\/)?([a-z]{2,3})[_.]/i);
          if (srcMatch) nat = srcMatch[1].toLowerCase();
        }
      }
      // Fall back to a plain regex over the cell's HTML in case the flag element itself
      // doesn't match the selector above but the markup still contains a recognisable pattern.
      if (!nat && natCell) {
        const natHtml = natCell.innerHTML || '';
        const natM = natHtml.match(/flag[-_]?(?:img)?[-_]([a-z]{2,3})\b/i) || natHtml.match(/\/national-teams\/([a-z]{2,3})\//i);
        if (natM) nat = natM[1].toLowerCase();
      }
      const prev = store[id] || { skills: {} };
      const merged = {
        id, name: (nameA ? nameA.textContent.trim() : (rec.name || prev.name || 'Player ' + id)),
        fp: rec.fp || prev.fp || null,
        age: rec.age ? parseFloat(rec.age) : (prev.age != null ? prev.age : null),
        asi: rec.asi ? parseInt(rec.asi.replace(/[^\d]/g, ''), 10) : (prev.asi != null ? prev.asi : null),
        routine: rec.routine ? parseFloat(rec.routine) : (prev.routine != null ? prev.routine : null),
        bid: rec.bid || prev.bid || null, time: rec.time || prev.time || null,
        nat: nat || prev.nat || null,
        skills: Object.assign({}, prev.skills || {}),
        _seen: now(), // recency key for pruneTransferSeen (Section 1)
      };
      TL_SKILL_KEYS.forEach(sk => { if (rec[sk] != null && rec[sk] !== '') { const v = parseInt(rec[sk], 10); if (!isNaN(v)) merged.skills[sk] = v; } });
      store[id] = merged;
      out.push(merged);
    });
    setSlice('transferSeen', store);
    return out;
  }

  /* ============================================================
   *  SECTION 2B — RATING ENGINE
   *  The underlying R5/R6 rating formula
   *  (weight tables + remainder logic). This replaces the old
   *  "just use the site's rec field" approach with the actual
   *  underlying calculation, so ratings stay correct even when a
   *  skill changes mid-week and the page hasn't recomputed rec yet.
   *  If something here looks wrong, this is the only block to check —
   *  it does not touch parsing, caching or UI.
   * ============================================================ */

  // Row order per position group: Str, Sta, Pac, Mar, Tac, Wor, Pos, Pas, Cro, Tec, Hea, Fin, Lon, Set
  // (GK row — index 9 — uses: Str, Sta, Pac, Han, One, Ref, Ari, Jum, Com, Kic, Thr)
  // Weight tables + remainder logic per "RatingR6 ReWrite-6.0.75" / "Trophymanager Squad R5 Value by Brzk" (TM Guide/).
  const WEIGHT_R5 = [
    [0.41029304, 0.18048062, 0.56730138, 1.06344654, 1.02312672, 0.40831256, 0.58235457, 0.12717479, 0.05454137, 0.09089830, 0.42381693, 0.04626272, 0.02199046, 0],
    [0.42126371, 0.18293193, 0.60567629, 0.91904794, 0.89070915, 0.40038476, 0.56146633, 0.15053902, 0.15955429, 0.15682932, 0.42109742, 0.09460329, 0.03589655, 0],
    [0.23412419, 0.32032289, 0.62194779, 0.63162534, 0.63143081, 0.45218831, 0.47370658, 0.55054737, 0.17744915, 0.39932519, 0.26915814, 0.16413124, 0.07404301, 0],
    [0.27276905, 0.26814289, 0.61104798, 0.39865092, 0.42862643, 0.43582015, 0.46617076, 0.44931076, 0.25175412, 0.46446692, 0.29986350, 0.43843061, 0.21494592, 0],
    [0.25219260, 0.25112993, 0.56090649, 0.18230261, 0.18376490, 0.45928749, 0.53498118, 0.59461481, 0.09851189, 0.61601950, 0.31243959, 0.65402884, 0.29982016, 0],
    [0.28155678, 0.24090675, 0.60680245, 0.19068879, 0.20018012, 0.45148647, 0.48230007, 0.42982389, 0.26268609, 0.57933805, 0.31712419, 0.65824985, 0.29885649, 0],
    [0.22029884, 0.29229690, 0.63248227, 0.09904394, 0.10043602, 0.47469498, 0.52919791, 0.77555880, 0.10531819, 0.71048302, 0.27667115, 0.56813972, 0.21537826, 0],
    [0.21151292, 0.35804710, 0.88688492, 0.14391236, 0.13769621, 0.46586605, 0.34446036, 0.51377701, 0.59723919, 0.75126119, 0.16550722, 0.29966502, 0.12417045, 0],
    [0.35479780, 0.14887553, 0.43273380, 0.00023928, 0.00021111, 0.46931131, 0.57731335, 0.41686333, 0.05607604, 0.62121195, 0.45370457, 1.03660702, 0.43205492, 0],
    [0.45462811, 0.30278232, 0.45462811, 0.90925623, 0.45462811, 0.90925623, 0.45462811, 0.45462811, 0.30278232, 0.15139116, 0.15139116] // GK
  ];
  const WEIGHT_RB = [
    [0.10493615, 0.05208547, 0.07934211, 0.14448971, 0.13159554, 0.06553072, 0.07778375, 0.06669303, 0.05158306, 0.02753168, 0.12055170, 0.01350989, 0.02549169, 0.03887550],
    [0.07715535, 0.04943315, 0.11627229, 0.11638685, 0.12893778, 0.07747251, 0.06370799, 0.03830611, 0.10361093, 0.06253997, 0.09128094, 0.01314110, 0.02449199, 0.03726305],
    [0.08219824, 0.08668831, 0.07434242, 0.09661001, 0.08894242, 0.08998026, 0.09281287, 0.08868309, 0.04753574, 0.06042619, 0.05396986, 0.05059984, 0.05660203, 0.03060871],
    [0.06744248, 0.06641401, 0.09977251, 0.08253749, 0.09709316, 0.09241026, 0.08513703, 0.06127851, 0.10275520, 0.07985941, 0.04618960, 0.03927270, 0.05285911, 0.02697852],
    [0.07304213, 0.08174111, 0.07248656, 0.08482334, 0.07078726, 0.09568392, 0.09464529, 0.09580381, 0.04746231, 0.07093008, 0.04595281, 0.05955544, 0.07161249, 0.03547345],
    [0.06527363, 0.06410270, 0.09701305, 0.07406706, 0.08563595, 0.09648566, 0.08651209, 0.06357183, 0.10819222, 0.07386495, 0.03245554, 0.05430668, 0.06572005, 0.03279859],
    [0.07842736, 0.07744888, 0.07201150, 0.06734457, 0.05002348, 0.08350204, 0.08207655, 0.11181914, 0.03756112, 0.07486004, 0.06533972, 0.07457344, 0.09781475, 0.02719742],
    [0.06545375, 0.06145378, 0.10503536, 0.06421508, 0.07627526, 0.09232981, 0.07763931, 0.07001035, 0.11307331, 0.07298351, 0.04248486, 0.06462713, 0.07038293, 0.02403557],
    [0.07738289, 0.05022488, 0.07790481, 0.01356516, 0.01038191, 0.06495444, 0.07721954, 0.07701905, 0.02680715, 0.07759692, 0.12701687, 0.15378395, 0.12808992, 0.03805251],
    [0.07466384, 0.07466384, 0.07466384, 0.14932769, 0.10452938, 0.14932769, 0.10452938, 0.10344411, 0.07512610, 0.04492581, 0.04479831] // GK
  ];
  const POS_MULTIPLIERS = [0.3, 0.3, 0.9, 0.6, 1.5, 0.9, 0.9, 0.6, 0.3];
  const fix2 = v => (Math.round(v * 100) / 100).toFixed(2);

  function getPositionIndex(pos) {
    switch ((pos || '').toLowerCase().replace(/\s+/g, '')) {
      case 'gk': return 9;
      case 'dc': case 'dcl': case 'dcr': return 0;
      case 'dr': case 'dl': return 1;
      case 'dmc': case 'dmcl': case 'dmcr': return 2;
      case 'dmr': case 'dml': return 3;
      case 'mc': case 'mcl': case 'mcr': return 4;
      case 'mr': case 'ml': return 5;
      case 'omc': case 'omcl': case 'omcr': return 6;
      case 'omr': case 'oml': return 7;
      case 'fc': case 'fcl': case 'fcr': case 'f': return 8;
      default: return 0;
    }
  }

  // A player's favposition string can list more than one eligible slot — e.g. "M/OM C"
  // (M C and OM C sharing one side letter) or "OM L, F" (comma-joined, each segment carrying
  // its own side). R5 is a per-position rating, so a dual-eligible player genuinely has TWO
  // different R5s, not one — this parses either format into the short position codes
  // getPositionIndex() expects, for every listed position, not just the first.
  function parseFavPositionCodes(fp) {
    if (!fp) return ['mc'];
    const raw = String(fp).toUpperCase().trim();
    if (raw.includes('GK')) return ['gk'];
    const codes = [];
    raw.split(',').forEach(segRaw => {
      const seg = segRaw.trim();
      if (!seg) return;
      // Side group is 1+ letters: "D LR" is a left AND right back. Reading only one letter made
      // "D LR" parse as "dlr", which fell through to the DC weights.
      const m = seg.match(/^([A-Z/]+?)\s*([LCR]*)$/);
      const posPart = (m ? m[1] : seg).replace(/\s+/g, '');
      const sides = m && m[2] ? m[2].split('') : [''];
      posPart.split('/').filter(Boolean).forEach(part => sides.forEach(side => {
        codes.push(part === 'F' ? 'f' : (part + side).toLowerCase());
      }));
    });
    return codes.length ? [...new Set(codes)] : ['mc'];
  }

  // Tooltip and youth endpoints send position CODES ("mr,ml", "dl,dml", "omc,fc"); everything
  // else (players_ar, the tactics page, tmPositionPenalty) uses TM's display form ("M LR",
  // "D/DM L", "OM C, F"). Read as display strings, codes silently zeroed the out-of-position
  // penalty — seen live: a pure right-back "starting" at centre DM with no penalty.
  const isPositionCodes = fp => /^[a-z]{1,4}(\s*,\s*[a-z]{1,4})*$/.test(String(fp || '').trim());
  function fpFromCodes(codes) {
    const parts = String(codes || '').toLowerCase().split(',').map(c => c.trim()).filter(Boolean);
    if (!parts.length) return '';
    if (parts.includes('gk')) return 'GK';
    const parsed = parts.map(c => {
      if (c.startsWith('f')) return { line: 'F', side: '' };
      const m = c.match(/^(dm|om|d|m)([lcr])/);
      return m ? { line: m[1].toUpperCase(), side: m[2].toUpperCase() } : null;
    }).filter(Boolean);
    const outfield = parsed.filter(x => x.line !== 'F');
    if (!outfield.length) return 'F';
    const lines = [...new Set(outfield.map(x => x.line))];
    const sides = [...new Set(outfield.map(x => x.side))].sort((a, b) => 'LCR'.indexOf(a) - 'LCR'.indexOf(b)).join('');
    return lines.join('/') + ' ' + sides + (outfield.length < parsed.length ? ', F' : ''); // TM writes "D LR", "D/DM L", "OM C, F"
  }
  const displayFp = fp => isPositionCodes(fp) ? fpFromCodes(fp) : fp;

  // Ordered skill arrays the formula expects, per position type.
  function outfieldSkillArray(s) {
    return [s.str, s.sta, s.pac, s.mar, s.tac, s.wor, s.pos, s.pas, s.cro, s.tec, s.hea, s.fin, s.lon, s.set].map(Number);
  }
  function gkSkillArray(s) {
    return [s.str, s.sta, s.pac, s.han, s.one, s.ref, s.ari, s.jum, s.com, s.kic, s.thr].map(Number);
  }

  function calculateRemainders(posIdx, skills, asi) {
    const weight = posIdx === 9 ? 48717927500 : 263533760000;
    const skillSum = skills.reduce((sum, s) => sum + s, 0);
    const remainder = Math.round((Math.pow(2, Math.log(weight * asi) / Math.log(Math.pow(2, 7))) - skillSum) * 10) / 10;
    let rec = 0, ratingR = 0, remainderW1 = 0, remainderW2 = 0, not20 = 0;
    for (let i = 0; i < WEIGHT_RB[posIdx].length; i++) {
      rec += skills[i] * WEIGHT_RB[posIdx][i];
      ratingR += skills[i] * WEIGHT_R5[posIdx][i];
      if (skills[i] != 20) { remainderW1 += WEIGHT_RB[posIdx][i]; remainderW2 += WEIGHT_R5[posIdx][i]; not20++; }
    }
    if (remainder / not20 > 0.9 || !not20) { not20 = posIdx === 9 ? 11 : 14; remainderW1 = 1; remainderW2 = 5; }
    rec = fix2((rec + remainder * remainderW1 / not20 - 2) / 3);
    return { remainder, remainderW2, not20, ratingR, rec };
  }

  // Full R5 rating: base rating + set-piece/dead-ball/heading bonuses for outfield players.
  function calculateR5(posIdx, skills, asi, rou) {
    if (!asi || skills.some(s => isNaN(s))) return null;
    const r = calculateRemainders(posIdx, skills, asi);
    const routineBonus = (3 / 100) * (100 - 100 * Math.pow(Math.E, -(rou || 0) * 0.035));
    let rating = Number(fix2(r.ratingR + (r.remainder * r.remainderW2 / r.not20) + routineBonus * 5));
    if (skills.length !== 11) {
      const goldstar = skills.filter(s => s == 20).length;
      const skillsB = skills.map(s => s == 20 ? 20 : s + r.remainder / (skills.length - goldstar));
      const sr = skillsB.map((s, i) => i === 1 ? s : s + routineBonus);
      const { pow, E } = Math;
      const hb = sr[10] > 12 ? fix2((pow(E, (sr[10] - 10) ** 3 / 1584.77) - 1) * 0.8 + pow(E, sr[0] ** 2 * 0.007 / 8.73021) * 0.15 + pow(E, sr[6] ** 2 * 0.007 / 8.73021) * 0.05) : 0;
      const fk = fix2(pow(E, (sr[13] + sr[12] + sr[9] * 0.5) ** 2 * 0.002) / 327.92526);
      const ck = fix2(pow(E, (sr[13] + sr[8] + sr[9] * 0.5) ** 2 * 0.002) / 983.65770);
      const pk = fix2(pow(E, (sr[13] + sr[11] + sr[9] * 0.5) ** 2 * 0.002) / 1967.31409);
      const ds = sr[0] ** 2 + sr[1] ** 2 * 0.5 + sr[2] ** 2 * 0.5 + sr[3] ** 2 + sr[4] ** 2 + sr[5] ** 2 + sr[6] ** 2;
      const os = sr[0] ** 2 * 0.5 + sr[1] ** 2 * 0.5 + sr[2] ** 2 + sr[3] ** 2 + sr[4] ** 2 + sr[5] ** 2 + sr[6] ** 2;
      const m = POS_MULTIPLIERS[posIdx];
      return Number(fix2(rating + hb * 1 + fk * 1 + ck * 1 + pk * 1 + fix2(ds / 6 / 22.9 ** 2) * m + fix2(os / 6 / 22.9 ** 2) * m));
    }
    return Number(fix2(rating));
  }

  // Convenience wrapper: given one of our captured player objects, compute an accurate
  // R5. Falls back to the site's own `rec` field if skills/asi aren't available (e.g.
  // opponent players, where we only have visible star ratings, not raw skills).
  function playerR5(p) {
    if (!p || !p.skills || !p.asi) return p ? p.rec : 0;
    const posIdx = getPositionIndex((p.fp || '').split(' ')[0] === 'GK' ? 'gk' : bucketToShortPos(p.fp));
    const isGK = posIdx === 9;
    const arr = isGK ? gkSkillArray(p.skills) : outfieldSkillArray(p.skills);
    if (arr.some(v => isNaN(v))) return p.rec;
    const r5 = calculateR5(posIdx, arr, Number(p.asi), p.routine || 0);
    return r5 == null ? p.rec : r5;
  }

  // Safe, idempotent R5 accessor. Sets p._r5 once and NEVER clobbers an already-present
  // value — this matters for star-estimate opponents (source: 'star-estimate'), whose
  // _r5 is a star*22 approximation with no raw skills. Calling playerR5() on those would
  // return their rec (0), silently wiping the estimate — the exact bug that left the
  // opponent formation/side maths blank. Always prefer this over playerR5() in bulk loops.
  function ensureR5(p) {
    // Only compute when unset. A player may legitimately carry NaN as a "cannot compute
    // yet" sentinel (e.g. a transfer-list row where we have skills but not SI, or vice
    // versa) — we must NOT overwrite that with the rec fallback, or it'd show a wrong 0.0.
    if (p && p._r5 == null) p._r5 = playerR5(p);
    return p ? p._r5 : 0;
  }

  // Maps our loose favourite-position string down to the short codes getPositionIndex expects.
  function bucketToShortPos(fp) {
    if (!fp) return 'mc';
    const f = fp.toUpperCase();
    if (f.includes('GK')) return 'gk';
    if (f.startsWith('DM')) return f.includes('R') ? 'dmr' : f.includes('L') ? 'dml' : 'dmc';
    if (f.startsWith('D')) return f.includes('R') ? 'dr' : f.includes('L') ? 'dl' : 'dc';
    if (f.startsWith('OM')) return f.includes('R') ? 'omr' : f.includes('L') ? 'oml' : 'omc';
    if (f.startsWith('M')) return f.includes('R') ? 'mr' : f.includes('L') ? 'ml' : 'mc';
    if (f.startsWith('F')) return 'fc';
    return 'mc';
  }

  /* ------------------------------------------------------------
   *  SECTION 2C — CATEGORY BREAKDOWN & VALUATION
   *  ------------------------------------------------------------
   *  Everything here is cross-confirmed against TWO independent community
   *  scripts ("RatingR6 ReWrite" and "Trophymanager Squad R5 Value by
   *  Brzk") that both derive the same formulas from the game's own
   *  numbers, so these are treated as exact — not estimates.
   * ============================================================ */

  // Same routine-diminishing-returns curve calculateR5() uses inline, factored out so the
  // category breakdown below (and anything else that needs it) doesn't duplicate a magic
  // formula in two places.
  function routineBonusOf(rou) {
    return (3 / 100) * (100 - 100 * Math.pow(Math.E, -(rou || 0) * 0.035));
  }

  // The 5-star category breakdown shown on the game's own player page (Physique / Tactical /
  // Technical, plus Assist/Defence/Shooting for outfield or Saving/Counter for goalkeepers).
  // Formula confirmed from "RatingR6 ReWrite"'s calc_R5REC(): each category is a weighted sub-
  // sum of skills, normalised by a "peak" skill-count, with the same routine bonus curve as R5
  // itself, scaled to a 0-5 range. Returns raw decimals (game rounds to half-stars for display).
  function categoryBreakdown(skills, rou, isGK) {
    const s = skills || {};
    const rb = routineBonusOf(rou);
    const n = (v) => Number(v) || 0;
    if (isGK) {
      const phySum = n(s.str) + n(s.sta) + n(s.pac) + n(s.jum);
      const tacSum = n(s.one) + n(s.ari) + n(s.com);
      const tecSum = n(s.han) + n(s.ref) + n(s.kic) + n(s.thr);
      const saving = (n(s.str) * 0.092691271 + n(s.sta) * 0.007577625 + n(s.pac) * 0.104277679 + n(s.han) * 0.278073812 + n(s.one) * 0.069518453 + n(s.ref) * 0.278073812 + n(s.ari) * 0.069518453 + n(s.jum) * 0.092691271 + n(s.com) * 0.007577625 + rb) / 4;
      const counter = (n(s.str) * 0.046345635 + n(s.sta) * 0.003788813 + n(s.pac) * 0.052138840 + n(s.han) * 0.139036906 + n(s.one) * 0.034759226 + n(s.ref) * 0.139036906 + n(s.ari) * 0.034759226 + n(s.jum) * 0.046345635 + n(s.com) * 0.003788813 + n(s.kic) * 0.25 + n(s.thr) * 0.25 + rb) / 4;
      return {
        Physique: (phySum / 4 + rb) * 5 / 20,
        Tactical: (tacSum / 3 + rb) * 5 / 20,
        Technical: (tecSum / 4 + rb) * 5 / 20,
        Saving: saving, Counter: counter,
      };
    }
    const phySum = n(s.str) + n(s.sta) + n(s.pac) + n(s.hea);
    const tacSum = n(s.mar) + n(s.tac) + n(s.wor) + n(s.pos);
    const tecSum = n(s.pas) + n(s.cro) + n(s.tec) + n(s.fin) + n(s.lon) + n(s.set);
    const assist = (n(s.str) * 0.01 + n(s.sta) * 0.1 + n(s.pac) * 0.2 + n(s.wor) * 0.09 + n(s.pos) * 0.07 + n(s.pas) * 0.22 + n(s.cro) * 0.13 + n(s.tec) * 0.18 + rb) / 4;
    const defence = (n(s.str) * 0.121481481 + n(s.sta) * 0.040740741 + n(s.pac) * 0.111111111 + n(s.mar) * 0.202962963 + n(s.tac) * 0.2 + n(s.wor) * 0.071111111 + n(s.pos) * 0.071111111 + n(s.hea) * 0.181481481 + rb) / 4;
    const shooting = (n(s.str) * 0.082813522 + n(s.pac) * 0.038541421 + n(s.wor) * 0.087757535 + n(s.pos) * 0.126339391 + n(s.tec) * 0.104203341 + n(s.hea) * 0.104949572 + n(s.fin) * 0.301067794 + n(s.lon) * 0.154327424 + rb) / 4;
    return {
      Physique: (phySum / 4 + rb) * 5 / 20,
      Tactical: (tacSum / 4 + rb) * 5 / 20,
      Technical: (tecSum / 6 + rb) * 5 / 20,
      Assist: assist, Defence: defence, Shooting: shooting,
    };
  }

  // "Sell to Agent" (instant guaranteed sale price) and "Max Sell Price" (the ceiling TM lets
  // you list a player for) — the game's own two transfer-listing price points, confirmed
  // identical across "RatingR6 ReWrite" (calc_SellToAgent) and "Trophymanager Squad R5 Value
  // by Brzk" (its Bank Price). ageMonths should be the PRECISE age in months (years*12+months,
  // not a rounded decimal-years guess) — see parseTmAge()/normaliseTooltipPlayer() above.
  function calcSellToAgentPrice(asi, ageMonths, isGK) {
    if (!asi || !ageMonths) return null;
    const v = Number(asi) * 500 * Math.pow(300 / ageMonths, 2.5) * (isGK ? 0.75 : 1);
    return Math.round(v);
  }
  function calcMaxSellPrice(asi, ageMonths, staPrice) {
    if (!asi || !ageMonths) return null;
    let v = Math.round(Number(asi) * (192400 / (ageMonths / 12) - 5200));
    if (staPrice != null && v < staPrice) v = staPrice;
    return v;
  }
  // Best-effort ageMonths for a player object from whichever age precision we happen to have
  // (exact ageMonths from the tooltip endpoint when available, else the decimal age * 12).
  function ageMonthsOf(p) {
    if (p.ageMonths != null) return p.ageMonths;
    if (p.age == null) return null;
    return Math.max(1, Math.round(Number(p.age) * 12));
  }

  /* ============================================================
   *  SECTION 3 — NETWORK REFRESH (same-origin fetch, no navigation needed)
   * ============================================================ */

  // This AJAX endpoint returns
  // FULL real skills for every player at any club_id — not just the visible star rating.
  // This means opponent scouting can now use the exact same accurate R5 math as our own
  // squad, instead of approximating strength from squad-page star icons.
  async function fetchClubPlayersReal(targetClubId) {
    const res = await fetch('/ajax/players_get_select.ajax.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'type=change&club_id=' + encodeURIComponent(targetClubId),
    });
    const data = JSON.parse(await res.text());
    return data && data.post ? data.post : {}; // { playerId: { fp, asi, rutine, strength, stamina, ... } }
  }

  // Maps the AJAX endpoint's full-name skill fields down to our short-key format so the
  // same playerR5() / calculateR5() machinery in Section 2B can be reused unchanged.
  function normaliseAjaxPlayer(raw) {
    return {
      // players_get_select sends `player_name` (no `name`) — reading only name/surname is why
      // every scanned opponent showed as "Unknown".
      id: raw.id, name: raw.player_name || raw.name || raw.lastname || raw.surname || 'Unknown', fp: raw.fp,
      nat: raw.country || raw.player_country || null,
      ban: raw.ban != null ? String(raw.ban) : '0', inj: raw.injury && String(raw.injury) !== '0' ? raw.injury : null,
      // age isn't always present in this endpoint; capture it when it is so the Youth
      // Finder can age-filter players from ANY club we scan, not just our own squad.
      // Unlike players_ar, this endpoint gives whole years in `age` and a SEPARATE `month`
      // field (confirmed by the community's "Squad R5 Value by Brzk" script, which reads
      // this exact endpoint as `age*12 + month` for its Bank Price calc) — add the month
      // fraction back in so age-based decisions (youth/senior cutoffs, valuation) are precise
      // rather than rounded down to the nearest whole year.
      age: (raw.age !== undefined && raw.age !== null && raw.age !== '') ? parseFloat(raw.age) + (parseInt(raw.month, 10) || 0) / 12 : null,
      asi: raw.asi, routine: raw.rutine !== undefined ? parseFloat(raw.rutine) : 0,
      // `rec_count` is the star rating (3.5); `rec` is an unrelated raw figure (≈14) that made
      // every scanned opponent look 4× stronger on the star scale the result model uses.
      rec: parseFloat(raw.rec_count) || 0,
      skills: {
        str: raw.strength, sta: raw.stamina, pac: raw.pace, mar: raw.marking, tac: raw.tackling,
        wor: raw.workrate, pos: raw.positioning, pas: raw.passing, cro: raw.crossing, tec: raw.technique,
        hea: raw.heading, fin: raw.finishing, lon: raw.longshots, set: raw.setpieces,
        han: raw.handling, one: raw.oneonones, ref: raw.reflexes, ari: raw.arialability,
        jum: raw.jumping, com: raw.communication, kic: raw.kicking, thr: raw.throwing,
      },
    };
  }

  async function fetchOpponentSquadReal(targetClubId) {
    const rawMap = await fetchClubPlayersReal(targetClubId);
    const players = Object.values(rawMap).filter(p => p && p.fp).map(normaliseAjaxPlayer);
    players.forEach(p => { p._r5 = playerR5(p); });
    return players;
  }

  // ---- Youth potential scouting ----
  // Uses the game's own /ajax/scouts_get_reports.ajax.php endpoint (confirmed by the actual
  // Scouts page source, not guessed) which returns every player your scouts have filed a
  // report on, including a "potential" figure alongside their current recommendation —
  // exactly the signal needed to flag a promising but currently-unremarkable youngster.
  async function fetchScoutReports() {
    const res = await fetch('/ajax/scouts_get_reports.ajax.php', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '',
    });
    const data = JSON.parse(await res.text());
    if (!data) return [];
    return Object.values(data).map(d => {
      const html = d.player_link || '';
      const idMatch = html.match(/\/players\/(\d+)/);
      const name = html.replace(/<[^>]+>/g, '').trim();
      const rec = parseFloat(d.rec) || 0;
      const potential = parseFloat(d.potential) || 0; // scale confirmed 2x the star display (potential/2 = stars)
      return {
        id: idMatch ? idMatch[1] : null, name: name || 'Unknown',
        date: d.display_time || null, rec, potential,
        growthMultiple: rec > 0 ? (potential / 2) / rec : null,
      };
    }).filter(p => p.id);
  }

  // ---- Bloom-phase estimate (heuristic, clearly labelled) ----
  // TM's own guide: a player can start blooming any time from age 16-24 and the bloom itself
  // lasts ~3 seasons (36 real weeks), always starting on the birthday; ANY player aged 16 to
  // 18 years 11 months also gets a global development bonus that doubles the training drop.
  // We can't read the report's bloom wording from this endpoint reliably, so we infer a rough
  // phase from age + how far potential is above current rec (growthMultiple). This is an
  // estimate to help you decide training intensity — NOT a confirmed game value.
  function bloomEstimate(age, growthMultiple) {
    if (age != null) {
      if (Number(age) < 16) return { phase: 'Pre-bloom', flag: 'dev-bonus', cls: '#b9c4ee', note: 'too young to bloom yet — build skills before it starts (any birthday, 16–24).' };
      if (Number(age) < 19) return { phase: 'Development bonus', flag: 'dev-bonus', cls: '#ffd75e', note: '16–18: global bonus doubles training drop — train hard now.' };
    }
    if (growthMultiple != null && growthMultiple >= 1.4) return { phase: 'Likely in bloom', flag: 'bloom', cls: '#9ece6a', note: 'potential well above current rating — bloom appears active; keep TI high.' };
    if (growthMultiple != null && growthMultiple >= 1.15) return { phase: 'Possible end-of-bloom', flag: 'bloom', cls: '#8a939c', note: 'some growth headroom left — wind down intensity soon.' };
    if (age == null) return null;
    return { phase: 'Bloom likely ended', flag: 'done', cls: '#8a939c', note: 'little headroom left — focus on other youths.' };
  }

  // ---- Opponent match-history scouting (formation, likely XI, tactic tendencies) ----
  // Reads an opponent's recent matches to see
  // what they actually play, not just who's in their squad. Two data sources make this
  // far simpler than the original script's approach:
  //   1. /fixtures/club/{id}/  (HTML) — lists recent match links + results.
  //   2. /ajax/match.ajax.php?id={matchId}  (JSON) — full match_data incl. lineup +
  //      mentality/attacking_style/focus_side per side. No HTML scraping needed here at all.
  // /fixtures/club/<id>/ is built by script (0 match links in the fetched HTML, live 2026-11-02 —
  // every scan read 0 games), so the played list comes from the fixtures endpoint itself.
  // Played but dated in the future = simulated ahead (CLAUDE.md), not yet seen by anyone.
  async function fetchOpponentRecentMatchIds(oppClubId, n) {
    const today = new Date().toISOString().slice(0, 10);
    return (await fixturesOf(oppClubId)).filter(m => m.result && String(m.date) <= today)
      .sort((x, y) => String(x.date).localeCompare(String(y.date))).slice(-n).map(m => String(m.id));
  }

  async function fetchMatchJson(matchId) {
    const res = await fetch('/ajax/match.ajax.php?id=' + matchId, { credentials: 'same-origin' });
    return JSON.parse(await res.text());
  }

  function modeOf(arr) {
    if (!arr.length) return null;
    const counts = {};
    arr.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return { value: sorted[0][0], seenIn: sorted[0][1] };
  }

  // Our record against them: /ajax/match_h2h.ajax.php (as "TM - Random Club HeadToHead" 1.0) →
  // {matches: {season: [{id, date, hometeam, result, matchtype}]}}.
  async function fetchHeadToHead(ourId, oppId) {
    const d = JSON.parse(await (await fetch(`/ajax/match_h2h.ajax.php?home_team=${encodeURIComponent(ourId)}&away_team=${encodeURIComponent(oppId)}`, { credentials: 'same-origin' })).text() || '{}');
    const all = [];
    Object.values((d && d.matches) || {}).forEach(list => (list || []).forEach(m => all.push(m)));
    const h = { w: 0, d: 0, l: 0, gf: 0, ga: 0, last: [] };
    all.filter(m => /^\d+-\d+$/.test(String(m.result))).sort((a, b) => String(b.date).localeCompare(String(a.date))).forEach(m => {
      const [hg, ag] = String(m.result).split('-').map(Number);
      const home = String(m.hometeam) === String(ourId), f = home ? hg : ag, a = home ? ag : hg;
      h.gf += f; h.ga += a;
      if (f > a) h.w++; else if (f === a) h.d++; else h.l++;
      if (h.last.length < 5) h.last.push(f > a ? 'W' : f === a ? 'D' : 'L');
    });
    return h;
  }
  // The other manager's last login: tooltip.ajax.php {club_id} → club.last_seen ("3. November"),
  // as "TM - League Last Login" 2.4 reads it. An inactive manager won't change a thing before kickoff.
  async function fetchManagerLastSeen(clubIdToCheck) {
    const d = JSON.parse(await tmPost('/ajax/tooltip.ajax.php', { club_id: clubIdToCheck }));
    const txt = d && d.club && d.club.last_seen ? String(d.club.last_seen).replace(/<[^>]+>/g, '').trim() : null;
    const m = txt && txt.match(/(\d{1,2})\.?\s*([A-Za-z]+)/);
    let days = null;
    if (m) {
      const t = Date.parse(`${m[1]} ${m[2]} ${new Date().getFullYear()}`);
      if (!isNaN(t)) days = Math.max(0, Math.floor((now() - (t > now() ? Date.parse(`${m[1]} ${m[2]} ${new Date().getFullYear() - 1}`) : t)) / 864e5));
    }
    return { text: txt, days };
  }
  async function buildOpponentScoutingReport(oppClubId, oppSquad, ourId) {
    const matchIds = await fetchOpponentRecentMatchIds(oppClubId, 5);
    const mentalities = [], styles = [], focuses = [];
    const appearances = {}; // playerId -> times featured
    const chase = [], hold = [], subs = [];
    const conceded = {};
    let fetched = 0;
    for (const id of matchIds) {
      try {
        const data = await fetchMatchJson(id);
        if (!data || !data.club || !data.match_data) continue;
        const isHome = String(data.club.home.id) === String(oppClubId);
        const side = isHome ? 'home' : 'away';
        if (data.match_data.mentality) mentalities.push(String(data.match_data.mentality[side]));
        if (data.match_data.attacking_style) {
          const s = data.match_data.attacking_style[side];
          styles.push(String(s === '0' || s === 0 ? '1' : s));
        }
        if (data.match_data.focus_side) focuses.push(String(data.match_data.focus_side[side]));
        const lineup = data.lineup && data.lineup[side];
        if (lineup) Object.keys(lineup).forEach(pid => { appearances[pid] = (appearances[pid] || 0) + 1; });
        const b = opponentInGame(data, String(oppClubId), lineup);
        chase.push(...b.chase); hold.push(...b.hold); subs.push(...b.subs);
        concededByStyle(data, String(oppClubId), conceded);
        fetched++;
      } catch (e) { console.warn('TM Advisor: opponent match fetch failed for', id, e); }
    }
    const squadById = {};
    (oppSquad || []).forEach(p => { squadById[p.id] = p; });
    const likelyXI = Object.entries(appearances)
      .sort((a, b) => b[1] - a[1]).slice(0, 11)
      .map(([pid, count]) => {
        const p = squadById[pid];
        return { id: pid, name: p ? p.name : ('Player ' + pid), fp: p ? p.fp : '?', appearances: count };
      });
    const bucketCounts = { GK: 0, D: 0, DM: 0, M: 0, OM: 0, F: 0 };
    likelyXI.forEach(p => { bucketCounts[bucketFor(p.fp)] = (bucketCounts[bucketFor(p.fp)] || 0) + 1; });
    const defLine = bucketCounts.D + bucketCounts.DM;
    const midLine = bucketCounts.M + bucketCounts.OM;
    const fwdLine = bucketCounts.F;
    return {
      sampleSize: fetched,
      mentality: modeOf(mentalities), style: modeOf(styles), focus: modeOf(focuses),
      // Formation observed across their actual last-N line-ups (proof-backed, not a guess):
      // the count of position buckets among their most-used players over the sampled games.
      likelyXI, recentFormation: fetched ? (defLine + '-' + midLine + '-' + fwdLine) : null,
      inGame: { games: fetched, chase: inGameSummary(chase), hold: inGameSummary(hold), subs: inGameSummary(subs) },
      conceded,
      h2h: await fetchHeadToHead(ourId || clubId, oppClubId).catch(() => null),
      manager: await fetchManagerLastSeen(oppClubId).catch(() => null),
    };
  }
  // What a side did DURING its matches — mentality changes (with the score at that moment) and
  // subs — i.e. its conditional orders as they fired. Report shape: report[minute][] events with
  // parameters [{goal:{player}}, {mentality_change:{team, mentality}}, {sub:{player_in, player_out}}]
  // (as read by the community "TM Match Viewer" script).
  function opponentInGame(data, teamId, lineup) {
    const out = { chase: [], hold: [], subs: [] };
    const md = data.match_data || {}, rpt = data.report || {};
    const isHome = String(data.club.home.id) === teamId;
    const ours = new Set(Object.keys(lineup || {}));
    let ment = Number(md.mentality && md.mentality[isHome ? 'home' : 'away']) || 4, gf = 0, ga = 0;
    Object.keys(rpt).map(Number).sort((a, b) => a - b).forEach(min => (rpt[min] || []).forEach(evt => (evt && evt.parameters || []).forEach(pr => {
      if (pr.goal) { if (ours.has(String(pr.goal.player))) gf++; else ga++; }
      if (pr.mentality_change && String(pr.mentality_change.team) === teamId) {
        const to = Number(pr.mentality_change.mentality);
        if (to > ment && gf < ga) out.chase.push({ min, to });
        if (to < ment && gf > ga) out.hold.push({ min, to });
        ment = to;
      }
      if (pr.sub && (ours.has(String(pr.sub.player_out)) || ours.has(String(pr.sub.player_in)))) out.subs.push({ min });
    })));
    return out;
  }
  // Report events carry `type` (prefix = how the attack was built) and `club` (who attacked);
  // prefixes per "TM - Season Match Analysis" 1.2.0. Keyed by our attacking-style ids.
  const ATTACK_PREFIX_STYLE = { cou: 2, kco: 2, win: 3, sho: 4, klo: 5, lon: 5, thr: 6 };
  function concededByStyle(data, teamId, into) {
    Object.values(data.report || {}).forEach(evts => (evts || []).forEach(evt => {
      if (!evt || !evt.type || evt.club == null || String(evt.club) === teamId) return;
      const st = ATTACK_PREFIX_STYLE[String(evt.type).replace(/[0-9]+.*/, '')];
      if (!st) return;
      const ps = evt.parameters || [], x = into[st] || (into[st] = { a: 0, sh: 0, g: 0 });
      x.a++;
      if (ps.some(q => q.goal)) { x.g++; x.sh++; } else if (ps.some(q => q.shot)) x.sh++;
    }));
  }
  function inGameSummary(list) {
    if (!list.length) return null;
    const mins = list.map(x => x.min).sort((a, b) => a - b);
    return { n: list.length, min: mins[Math.floor(mins.length / 2)] };
  }

  // ---- Next-match EXPECTED line-up (proof-backed, from the actual next-match page) ----
  // The Home page's next-match block links to /matches/{id}/. That match's own data
  // (same /ajax/match.ajax.php?id= JSON we already read for past games) exposes the
  // EXPECTED line-up + mentality + attacking style + focus side each club has set for the
  // upcoming fixture. This is hard data straight from the fixture, so we surface it as the
  // primary opponent read — no squad-strength guessing anywhere.
  function matchIdFromUrl(url) {
    const m = (url || '').match(/\/matches\/(\d+)/);
    return m ? m[1] : null;
  }

  async function fetchNextMatchExpected(matchUrl, oppClubId, oppSquad) {
    const matchId = matchIdFromUrl(matchUrl);
    if (!matchId) return null;
    const data = await fetchMatchJson(matchId);
    if (!data || !data.club) return null;
    const isHome = String(data.club.home.id) === String(oppClubId);
    const side = isHome ? 'home' : 'away';
    const md = data.match_data || {};

    // Try multiple response structures for mentality/style/focus
    let mentality = null, style = null, focus = null;
    if (md.mentality) {
      mentality = typeof md.mentality === 'object' ? String(md.mentality[side] || '') : String(md.mentality);
    }
    if (md.attacking_style) {
      const raw = typeof md.attacking_style === 'object' ? md.attacking_style[side] : md.attacking_style;
      style = raw == null ? null : String(raw === '0' || raw === 0 ? '1' : raw);
    }
    if (md.focus_side) {
      focus = typeof md.focus_side === 'object' ? String(md.focus_side[side] || '') : String(md.focus_side);
    }
    // Also check md.tactics sub-object
    if (!mentality && md.tactics && md.tactics.mentality) mentality = String(md.tactics.mentality);
    if (!style && md.tactics && md.tactics.attacking_style) style = String(md.tactics.attacking_style);
    if (!focus && md.tactics && md.tactics.focus_side) focus = String(md.tactics.focus_side);

    // Expected XI: the player IDs TM lists for this fixture, mapped to the opponent squad.
    // `lineup[pid].position` is the ASSIGNED MATCH SLOT (e.g. "dc", "sub1"), not the player's
    // favourite position — using it as a favposition fallback (as this did before) is why a
    // substitute like "sub1" would silently bucket as a midfielder, and why substitutes were
    // being counted into the formation at all. Confirmed against the community's "TM League
    // Squad Analyzer" script, which excludes any lineup entry whose position contains "sub"
    // before computing a formation from the remaining starters.
    const squadById = {};
    (oppSquad || []).forEach(p => { squadById[String(p.id)] = p; });
    const lineup = data.lineup && data.lineup[side];
    const starterIds = lineup ? Object.keys(lineup).filter(pid => {
      const slot = lineup[pid] && lineup[pid].position;
      return !(slot && String(slot).toLowerCase().includes('sub'));
    }) : [];
    const xi = starterIds.map(pid => {
      const raw = lineup[pid];
      const p = squadById[String(pid)];
      const fp = (p && p.fp) || (raw && (raw.favposition || raw.fp)) || '?';
      // `slot` (their saved position for THIS fixture) lets focus/strength read the XI they'll
      // actually field rather than their whole squad; rec/routine feed the result model (5I).
      return { id: pid, name: p ? p.name : (raw ? (raw.nameLast || raw.name || 'Player ' + pid) : 'Player ' + pid), fp,
        slot: raw && raw.position ? String(raw.position).toLowerCase() : null,
        rec: raw && raw.rec != null ? parseFloat(raw.rec) : null, routine: raw && raw.routine != null ? parseFloat(raw.routine) : null };
    });

    // Only report a formation when the starter count is plausible (9-11 outfield+GK) — a
    // fixture with incomplete/odd lineup data would otherwise still produce a nonsense string
    // like "8-6-1" rather than honestly saying the formation isn't available yet.
    let formation = null;
    if (xi.length >= 9 && xi.length <= 11) {
      const b = { GK: 0, D: 0, DM: 0, M: 0, OM: 0, F: 0 };
      xi.forEach(p => { b[bucketFor(p.fp)] = (b[bucketFor(p.fp)] || 0) + 1; });
      formation = (b.D + b.DM) + '-' + (b.M + b.OM) + '-' + b.F;
    }
    return { matchId, matchUrl, side, formation, mentality, style, focus, xi, xiCount: xi.length };
  }


  async function fetchDoc(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    const txt = await res.text();
    return new DOMParser().parseFromString(txt, 'text/html');
  }

  async function refreshAll(onProgress) {
    for (const src of DATA_SOURCES) {
      onProgress && onProgress(src.key, 'loading');
      try {
        const doc = await fetchDoc(src.url);
        const data = src.parser(doc);
        setSlice(src.key, data);
        if (src.key === 'players') recordSquadSnapshot(data); // daily skill/TI history without a page visit
        onProgress && onProgress(src.key, 'done');
      } catch (e) {
        console.error('TM Advisor refresh failed for', src.key, e);
        onProgress && onProgress(src.key, 'error');
      }
    }
    // Chain: next match opponent squad (real skills) + league table
    try {
      const homeData = getSlice('home');
      const nm = homeData && homeData.data && homeData.data.nextMatch;
      if (nm) {
        const myId = clubId;
        const oppSide = (nm.home.id === myId) ? nm.away : nm.home;
        if (oppSide && oppSide.id) {
          onProgress && onProgress('opponent', 'loading');
          let players = [];
          let source = 'real-skills';
          try {
            players = await fetchOpponentSquadReal(oppSide.id);
          } catch (e) {
            console.warn('TM Advisor: real-skills opponent fetch failed, falling back to star scrape', e);
          }
          if (!players.length) {
            source = 'star-estimate';
            const doc = await fetchDoc('/club/' + oppSide.id + '/squad/');
            const scraped = parseSquadPage(doc);
            players = scraped.players.map(p => ({ ...p, _r5: p.recStars != null ? p.recStars * 22 : null })); // rough R5-scale estimate from stars
          }
          setSlice('opponent', { id: oppSide.id, name: oppSide.name, players, source });
          onProgress && onProgress('opponent', 'done');

          onProgress && onProgress('scouting', 'loading');
          try {
            const report = await buildOpponentScoutingReport(oppSide.id, players);
            setSlice('opponentScouting', report);
            onProgress && onProgress('scouting', 'done');
          } catch (e) {
            console.warn('TM Advisor: opponent scouting report failed', e);
            onProgress && onProgress('scouting', 'error');
          }

          // Primary, proof-backed opponent read: the EXPECTED line-up set for the actual
          // next fixture (formation + mentality + attacking style + focus side).
          onProgress && onProgress('expected', 'loading');
          try {
            const expected = await fetchNextMatchExpected(nm.matchUrl, oppSide.id, players);
            if (expected) { setSlice('opponentExpected', expected); onProgress && onProgress('expected', 'done'); }
            else onProgress && onProgress('expected', 'error');
          } catch (e) {
            console.warn('TM Advisor: next-match expected line-up fetch failed', e);
            onProgress && onProgress('expected', 'error');
          }
        }
      }
    } catch (e) { console.error('TM Advisor opponent refresh failed', e); onProgress && onProgress('opponent', 'error'); }
  }

  /* ============================================================
   *  SECTION 5F — LEAGUE STRENGTH RANKING
   *  ------------------------------------------------------------
   *  Ranks every club in your league by the average R5 of its best
   *  XI (reusing the exact same R5 engine as everything else), so you
   *  can see where you actually sit on squad quality — not points —
   *  and which fixtures ahead are the tough ones. Data comes from the
   *  league table page (club ids + positions) and each club's real
   *  skills via the same AJAX endpoint the opponent scouting uses.
   *  On-demand + short per-club cache, so re-runs are cheap.
   * ============================================================ */
  function parseLeagueTable(doc) {
    // The league table is rendered by the game as a table of rows; we only need each club's
    // id, name and current table position. Selectors are best-effort across TM's markup.
    const rows = [...doc.querySelectorAll('a[href*="/club/"]')]
      .map(a => { const m = (a.getAttribute('href') || '').match(/\/club\/(\d+)/); const row = a.closest('tr'); return row ? { id: m && m[1], name: a.textContent.trim() } : null; })
      .filter(r => r && r.id)
      .filter((r, i, arr) => arr.findIndex(x => x.id === r.id) === i); // dedupe
    return rows.length ? rows : null;
  }

  const LEAGUE_CACHE_HOURS = 24;
  // Fetches the average best-XI R5 for a club, cached to avoid re-hitting the server on every
  // league refresh. Returns { avg, counted, squadSize } or an error marker.
  async function leagueClubStrength(clubId_, cache) {
    const cid = String(clubId_).replace(/\D/g, '');
    if (!cid) return { avg: null };
    if (cache[cid] && (now() - cache[cid].t) < LEAGUE_CACHE_HOURS * 3600e3) return cache[cid];
    try {
      const players = await fetchOpponentSquadReal(cid);
      const vals = players.map(p => p._r5).filter(v => typeof v === 'number' && !isNaN(v)).sort((a, b) => b - a);
      const bestXI = Math.min(11, vals.length);
      const entry = bestXI ? { t: now(), avg: +(vals.slice(0, bestXI).reduce((a, b) => a + b, 0) / bestXI).toFixed(1), counted: bestXI, squadSize: players.length } : { t: now(), avg: null, counted: 0, squadSize: 0 };
      cache[cid] = entry; return entry;
    } catch (e) {
      cache[cid] = { t: now(), avg: null, counted: 0, squadSize: 0, error: true };
      return cache[cid];
    }
  }

  async function buildLeagueRanking() {
    const homeData = getSlice('home');
    let leaguePath = homeData && homeData.data && homeData.data.nextMatch && homeData.data.nextMatch.leaguePath;
    if (!leaguePath) {
      // Fall back: the /league/ page URL pattern from club context.
      leaguePath = (document.querySelector('a[league_link]') && document.querySelector('a[league_link]').getAttribute('href')) || null;
    }
    if (!leaguePath) return { error: 'League not identified yet — visit your Home page (next-match block shows the league link).' };
    const doc = await fetchDoc(leaguePath);
    const table = parseLeagueTable(doc);
    if (!table || !table.length) return { error: 'Could not parse the league table on ' + leaguePath };
    const c = loadCache();
    const cache = (c.leagueStrength && c.leagueStrength.data) || {};
    const names = (c.leagueStrength && c.leagueStrength.names) || {};
    const results = [];
    for (const row of table) {
      const cid = String(row.id).replace(/\D/g, '');
      if (row.name) names[cid] = row.name;
      results.push({ id: row.id, name: row.name, ...(await leagueClubStrength(row.id, cache)) });
    }
    c.leagueStrength = { t: now(), data: cache, names };
    saveCache(c);
    return { leaguePath, results, myId: clubId, builtAt: now() };
  }

  /* ============================================================
   *  SECTION 4 — LIVE-PAGE AUTO CAPTURE
   *     (if the user is already on one of these pages, capture it
   *      immediately from the live DOM — free data, zero cost)
   * ============================================================ */

  // ---- Live-page column injection ----
  // Adds Rou/R5 columns directly onto the real /players/ table, and an R5 column onto
  // opponent squad pages, so you
  // get the numbers on the actual game page, not just inside the floating panel.
  // "SI" here means Skill Index — confirmed to be
  // just ASI (the game's own Ability/Skill Index) — NOT a stress or stamina metric. We
  // already capture ASI directly from the game's own data on every squad we scrape, so no
  // separate formula is needed; this just surfaces it under a clear label on
  // scripts use.
  // Finds the player-row link two ways: TM's custom `player_link` attribute (used on some
  // pages) or a plain href matching /players/<id>/ (used on others) — the earlier version
  // only checked the first, which silently produced zero matches on pages using the second.
  function findPlayerLinkInRow(tr) {
    const link = tr.querySelector('a[player_link]');
    if (link) return { id: link.getAttribute('player_link'), el: link };
    const hrefLink = tr.querySelector('a[href*="/players/"]');
    if (hrefLink) {
      const m = (hrefLink.getAttribute('href') || '').match(/\/players\/(\d+)/);
      if (m) return { id: m[1], el: hrefLink };
    }
    // Transfer-list rows carry their id as `id="player_row_{id}"` even when the name cell's
    // link isn't a plain /players/ href — pick that up so R5/SI columns work there too.
    const rowIdM = (tr.id || '').match(/player_row_(\d+)/);
    if (rowIdM) return { id: rowIdM[1], el: tr };
    return null;
  }

  // Core injector. Idempotent at BOTH the header and the row level:
  //  - header cells are guarded by the `.tma-col-r5` marker class, and
  //  - each data row is stamped with `data-tma-cols` once its cells are appended,
  // so calling this repeatedly (e.g. from the MutationObserver below, after TM re-sorts
  // the table) never produces duplicate columns.
  // Returns the number of data rows it actually decorated this pass — the observer uses
  // that to know whether the real table has rendered yet.
  // The game's own player/squad tables are a fixed-width layout with no horizontal scroll —
  // adding Rou/SI/R5 columns pushes the table wider than its container, so the new columns
  // were getting silently clipped off the right edge with no way to reach them. Wrap the
  // table's parent in a horizontal scroll container the first time we touch each table.
  function ensureScrollableTable(table) {
    if (table.dataset.tmaScrollable === '1') return;
    table.dataset.tmaScrollable = '1';
    const wrapper = table.parentElement;
    if (!wrapper) return;
    wrapper.style.overflowX = 'auto';
    wrapper.style.maxWidth = '100%';
    table.style.minWidth = 'max-content';
  }

  // The two primitives every injected column uses — shared by the players/opponent/transfer
  // tables (injectR5Columns), so an appended cell
  // looks and behaves the same everywhere. `chipHtml` is trusted (always built internally);
  // `text` goes through textContent, never innerHTML.
  function appendHeaderCell(headerRow, label, cls) {
    const th = document.createElement('th');
    th.textContent = label; th.className = cls; th.align = 'center';
    headerRow.appendChild(th);
    return th;
  }
  function appendCell(tr, text, opts) {
    opts = opts || {};
    const td = document.createElement('td');
    td.align = 'center';
    td.textContent = text;
    if (opts.color) { td.style.color = opts.color; td.style.fontWeight = 'bold'; }
    if (opts.chipHtml) td.insertAdjacentHTML('beforeend', opts.chipHtml);
    tr.appendChild(td);
    return td;
  }

  function injectR5Columns(playersData, opts) {
    opts = opts || {};
    const showRou = opts.showRou !== false;
    const showSI = opts.showSI !== false;
    const showTrend = !!opts.showTrend; // append ▲/▼ deltas from the development history

    // Small coloured delta chip, e.g. " ▲1.2" (green up) / " ▼0.4" (red down). Empty when
    // there's no baseline yet or the change is zero.
    const trendChip = (delta) => {
      if (delta == null || delta === 0) return '';
      const up = delta > 0;
      const col = up ? '#5b8fc9' : '#e2726b';
      const arrow = up ? '▲' : '▼';
      return ` <span style="color:${col};font-size:9px;font-weight:600;">${arrow}${Math.abs(delta)}</span>`;
    };
    // Key by String(id) on both sides so a numeric players_ar id and a string DOM
    // attribute id still match (this mismatch was one reason own-squad rows showed "-").
    const byId = {};
    playersData.forEach(p => { byId[String(p.id)] = p; ensureR5(p); });

    const addHeaderCells = (headerRow) => {
      if (headerRow.querySelector('.tma-col-r5')) return; // already done
      if (showRou) appendHeaderCell(headerRow, 'Rou', 'tma-col-rou');
      if (showSI) appendHeaderCell(headerRow, 'SI', 'tma-col-si');
      appendHeaderCell(headerRow, 'R5', 'tma-col-r5');
    };

    let decorated = 0;
    document.querySelectorAll('tr').forEach(tr => {
      const link = findPlayerLinkInRow(tr);
      if (!link) return;
      if (tr.dataset.tmaCols === '1') { decorated++; return; } // already decorated this row

      const table = tr.closest('table');
      if (table) {
        // A table can have more than one header row (e.g. the squad page has a separate
        // "Goalkeepers" sub-header) — decorate every row that has <th> cells.
        [...table.querySelectorAll('tr')].filter(r => r.querySelector('th')).forEach(addHeaderCells);
        if (!opts.compact) ensureScrollableTable(table);
      }

      const p = byId[String(link.id)];
      const trend = (showTrend && p) ? playerTrend(p.id) : null;
      const mkCell = (text, gold, chipHtml) => { const td = appendCell(tr, text, { color: gold ? '#7fb2e0' : null, chipHtml }); td.dataset.tmaC = '1'; return td; };
      if (showRou) mkCell((p && p.routine != null) ? Number(p.routine).toFixed(1) : '-', false, trend ? trendChip(trend.routine) : '');
      if (showSI) mkCell((p && p.asi != null) ? Number(p.asi).toLocaleString() : '-', false, trend ? trendChip(trend.asi) : '');
      mkCell((p && p._r5 != null && !isNaN(p._r5)) ? Number(p._r5).toFixed(1) : '-', true, trend ? trendChip(trend.r5) : '');
      tr.dataset.tmaCols = '1';
      decorated++;
    });
    if (opts.compact) fitTables();
    return decorated;
  }
  // The squad page has no room to its right, so instead of a scrollbar our cells are narrow and
  // TM's fixed 160px name box (a div + a fade overlay at 137px, live) gives up the overflow.
  function fitTables() {
    document.querySelectorAll('th.tma-col-r5').forEach(th => {
      const table = th.closest('table');
      if (!table) return;
      table.querySelectorAll('.tma-col-rou, .tma-col-si, .tma-col-r5, td[data-tma-c]').forEach(c => { c.style.padding = '0 3px'; c.style.fontSize = '11px'; c.style.whiteSpace = 'nowrap'; });
      const row = table.querySelector('tr[data-tma-cols]');
      const link = row && row.querySelector('a[player_link], a[href*="/players/"]');
      const col = link ? [...row.children].indexOf(link.closest('td')) : -1;
      if (col < 0) return;
      if (!table.dataset.tmaNameW) {
        const box = table.parentElement, over = box ? table.offsetWidth - box.clientWidth : 0;
        if (over <= 0) return;
        table.dataset.tmaNameW = String(Math.max(90, row.children[col].offsetWidth - over - 2));
      }
      const w = Number(table.dataset.tmaNameW);
      table.querySelectorAll('tr').forEach(tr => {
        const c = tr.children[col];
        if (!c) return;
        if (c.tagName === 'TH') { c.style.width = w + 'px'; return; }
        const div = c.querySelector('div[style*="width"]:not(.text_fade_overlay)');
        if (div) div.style.width = w + 'px';
        const fade = c.querySelector('.text_fade_overlay');
        if (fade) fade.style.marginLeft = Math.max(0, w - 23) + 'px';
      });
    });
  }

  // Robust wrapper for JS-rendered / re-sortable tables (the OWN /players/ page is built
  // by TM's own script AFTER our document-end pass, and it rebuilds its rows whenever you
  // click a column header to re-sort). A one-shot synchronous inject therefore ran on an
  // empty table and never came back — which is exactly why Rou/SI/R5 showed for opponents
  // (server-rendered squad page) but not for your own players. Here we:
  //   1. inject immediately (covers already-rendered tables),
  //   2. watch the DOM and re-inject (debounced) as rows appear or get rebuilt,
  //   3. auto-disconnect once we've decorated rows and the DOM has settled, to stay light.
  function injectColumnsWhenReady(playersData, opts) {
    if (!playersData || !playersData.length) return;
    let settleTimer = null;
    const run = () => injectR5Columns(playersData, opts);
    run(); // covers tables already present on this pass
    // Stay attached for the page's lifetime so re-sorts (which rebuild rows and drop our
    // per-row marker) are re-decorated. The pass is debounced and cheap: rows already
    // carrying data-tma-cols are skipped, so re-runs do no redundant DOM work and our own
    // cell appends can't cause a feedback loop.
    const observer = new MutationObserver(() => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(run, 150);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Safety valve: release the observer after 5 minutes of a single page view.
    setTimeout(() => observer.disconnect(), 300000);
  }

  // ---- Transfer-list column injection ----
  // Exact R5 for a merged transfer-list player. Returns NaN (a "not yet computable"
  // sentinel ensureR5 will respect) unless we have BOTH the SI and a full skill set for
  // this player's type — i.e. you've seen them in both the Breakdown and Skills views.
  function transferR5(p) {
    if (!p || !p.asi || !p.skills) return NaN;
    const isGK = bucketFor(p.fp) === 'GK';
    const need = isGK
      ? ['str', 'sta', 'pac', 'han', 'one', 'ref', 'ari', 'jum', 'com', 'kic', 'thr']
      : ['str', 'sta', 'pac', 'mar', 'tac', 'wor', 'pos', 'pas', 'cro', 'tec', 'hea', 'fin', 'lon', 'set'];
    if (need.some(k => p.skills[k] == null)) return NaN;
    const r5 = playerR5({ fp: p.fp, asi: p.asi, routine: p.routine || 0, skills: p.skills, rec: 0 });
    return (r5 == null) ? NaN : r5;
  }

  // Adds SI + R5 columns to the live transfer table and keeps them in sync as you search,
  // re-sort or flip Breakdown/Skills. R5 fills in once a player has been seen in both views
  // (SI from Breakdown + skills from Skills); until then it shows "-". Rou isn't a transfer
  // column, so it's omitted here to avoid an always-empty column.
  function enhanceTransferPage() {
    let timer = null;
    const run = () => {
      const players = parseTransferListLive();
      if (!players.length) return 0;
      players.forEach(p => { p._r5 = transferR5(p); }); // number, or NaN sentinel
      return injectR5Columns(players, { showRou: false, showSI: true });
    };
    run();
    const target = document.getElementById('transfer_list') || document.body;
    const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(run, 150); });
    observer.observe(target, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 300000);
  }

  // ---- Youth Development recruit advisor ----
  // The weekly /youth-development/ pull lists newly generated recruits who aren't signed yet.
  // Verdict grading stands on two cited reference points:
  //  - YOUTH_CRITERIA hard floors (Section 5B, shared with the transfer-list Youth Finder):
  //    SI 30 is the base bar for a 16y0m recruit.
  //  - Peak skill-sum ceilings from "TM Player Enhanced 1.7.0" (its PEAK_SUMS table): an
  //    outfield player's physique/tactical sums max at 80 each and technical sum at 120
  //    (GK: 80/60/80). A recruit's current sums as a % of those ceilings shows how developed
  //    each side of their game already is at pull time.
  // The ~30 SI at 16y0m + ~0.5 SI/month maturity drift, and the star-tier ranking that adds
  // +8 SI above expectation, are OUR heuristics - comments below say "approx" and the UI
  // tooltip labels the whole read as approximate. Nothing here is a game formula.
  // Category sums use the exact skill groupings TM Player Enhanced (1.7.0) computes per
  // category (its playerSkillSums block), so our reach% is directly comparable to the
  // community's, and the ceilings are its PEAK_SUMS maxes.
  const YOUTH_PEAK_MAX = { outfield: { phy: 80, tac: 80, tec: 120 }, gk: { phy: 80, tac: 60, tec: 80 } };
  function youthCategorySums(p) {
    const s = p.skills || {}, n = v => Number(v) || 0;
    if (bucketFor(p.fp) === 'GK') {
      return { isGK: true,
        phy: n(s.str) + n(s.sta) + n(s.pac) + n(s.jum),
        tac: n(s.one) + n(s.ari) + n(s.com),
        tec: n(s.han) + n(s.ref) + n(s.kic) + n(s.thr) };
    }
    return { isGK: false,
      phy: n(s.str) + n(s.sta) + n(s.pac) + n(s.hea),
      tac: n(s.mar) + n(s.tac) + n(s.wor) + n(s.pos),
      tec: n(s.pas) + n(s.cro) + n(s.tec) + n(s.fin) + n(s.lon) + n(s.set) };
  }
  // Graded pull verdict from SI vs age + per-category peak reach. Expectation: SI 30 at the
  // 16y0m pull date (YOUTH_CRITERIA.minASI), drifting +0.5 SI per mature month afterwards
  // (approx). Tiers: STAR (≥ +8 above expectation), KEEP (at or above), MAYBE (within 5
  // below), RELEASE (below that). ageMonthsOf handles the tooltip's precise age incl. months.
  function youthPullVerdict(p) {
    const ageMonths = ageMonthsOf(p);
    if (!ageMonths) return null;
    const expectedSI = YOUTH_CRITERIA.minASI + Math.max(0, ageMonths - 192) * 0.5;
    const si = Number(p.asi) || 0;
    const sums = youthCategorySums(p);
    const peaks = sums.isGK ? YOUTH_PEAK_MAX.gk : YOUTH_PEAK_MAX.outfield;
    const reach = ['phy', 'tac', 'tec'].map(k => k + ' ' + Math.round(sums[k] / peaks[k] * 100) + '%');
    let verdict, cls;
    if (si >= expectedSI + 8) { verdict = 'STAR'; cls = '#9ece6a'; }
    else if (si >= expectedSI) { verdict = 'KEEP'; cls = '#6fae7c'; }
    else if (si >= expectedSI - 5) { verdict = 'MAYBE'; cls = '#e0a95f'; }
    else { verdict = 'RELEASE'; cls = '#d97a70'; }
    const y = Math.floor(ageMonths / 12), m = ageMonths % 12;
    return { verdict, cls, isGK: sums.isGK,
      note: 'approx: SI ' + Math.round(si) + ' vs ~' + Math.round(expectedSI) + ' expected at ' + y + 'y' + m + 'm. Peak reach: ' + reach.join(', ') + '. Heuristic, not exact.' };
  }
  // The weekly report arrives via /ajax/youth.ajax.php {type:'get'} (youth.js get_report — the
  // page itself calls it on load) and renders as div#youth_player_<id> cards, NOT table rows,
  // which is why the old row-based version never matched. Skills come in that same reply once
  // revealed; no SI is sent, so SI is derived from the skill sum with the exact relation the R5
  // remainder uses (Section 2B; inverse of skillSumFromSI). Read-only: never hires or fires.
  const YOUTH_SKILL_KEYS = {
    str: ['strength'], sta: ['stamina'], pac: ['pace'], mar: ['marking'], tac: ['tackling'], wor: ['workrate'],
    pos: ['positioning'], pas: ['passing'], cro: ['crossing'], tec: ['technique'], hea: ['heading'], fin: ['finishing'],
    lon: ['longshots'], set: ['setpieces', 'set_pieces'], han: ['handling'], one: ['oneonones', 'one_on_ones'],
    ref: ['reflexes'], ari: ['aerial', 'arialability', 'aerial_ability'], jum: ['jumping'], com: ['communication'],
    kic: ['kicking'], thr: ['throwing'],
  };
  const OUTFIELD_KEYS = ['str', 'sta', 'pac', 'mar', 'tac', 'wor', 'pos', 'pas', 'cro', 'tec', 'hea', 'fin', 'lon', 'set'];
  const GK_KEYS = ['str', 'sta', 'pac', 'han', 'one', 'ref', 'ari', 'jum', 'com', 'kic', 'thr'];
  function gradeYouthRecruit(raw) {
    const fp = fpFromCodes(raw.favposition) || 'M C';
    const isGK = fp === 'GK', keys = isGK ? GK_KEYS : OUTFIELD_KEYS;
    const skills = {};
    keys.forEach(k => { const v = YOUTH_SKILL_KEYS[k].map(n => raw[n]).find(x => x != null && x !== ''); skills[k] = Number(v); });
    if (keys.some(k => isNaN(skills[k]))) return { hidden: true };
    const sum = keys.reduce((a, k) => a + skills[k], 0);
    const asi = Math.pow(sum, 7) / (isGK ? 48717927500 : 263533760000);
    const nums = String(raw.age == null ? '' : raw.age).match(/\d+/g) || [];
    const ageMonths = nums.length ? Number(nums[0]) * 12 + (nums[1] ? Number(nums[1]) : 0) : null;
    const p = { id: raw.id, name: raw.player_name, fp, asi, routine: 0, skills, ageMonths, age: ageMonths ? ageMonths / 12 : null };
    return { verdict: youthPullVerdict(p), r5: playerR5(p), sum };
  }

  let youthReport = null, youthReportAt = 0;
  async function enhanceYouthDevelopmentPage() {
    const cards = [...document.querySelectorAll('div.youth_player[id^="youth_player_"]')].filter(c => c.dataset.tmaYouth !== 'graded');
    if (!cards.length) return;
    // Re-read the report at most every 2 s: a Reveal click mutates the cards and the next pass
    // must see the newly revealed skills.
    if (!youthReport || now() - youthReportAt > 2000) {
      try { youthReport = JSON.parse(await tmPost('/ajax/youth.ajax.php', { type: 'get' })); youthReportAt = now(); }
      catch (e) { console.warn('TM Advisor: youth report read failed', e); return; }
    }
    const players = (youthReport && youthReport.players) || {};
    cards.forEach(card => {
      const id = card.id.replace('youth_player_', '');
      const raw = Object.values(players).find(x => x && String(x.id) === id);
      if (!raw) return;
      let badge = card.querySelector('.tma-youth-verdict');
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'tma-youth-verdict';
        badge.style.cssText = 'margin:0 0 8px;padding:6px 10px;border-radius:8px;background:#1a1a1dcc;font:600 12px -apple-system,Segoe UI,Roboto,Arial,sans-serif;';
        card.insertBefore(badge, card.firstChild);
      }
      const g = gradeYouthRecruit(raw);
      if (g.hidden) { badge.textContent = 'TM Advisor: reveal skills to grade this recruit'; badge.style.color = '#9a9691'; return; }
      const v = g.verdict;
      badge.textContent = `${v ? v.verdict : '?'} · R5 ${g.r5 != null && !isNaN(g.r5) ? Number(g.r5).toFixed(1) : '-'} · ${g.sum} skill pts`;
      badge.style.color = v ? v.cls : '#9a9691';
      badge.title = v ? v.note : 'age not available — cannot grade';
      card.dataset.tmaYouth = 'graded';
    });
  }

  // ---- Player detail page overlay (Rou / SI / R5 for ANY player, not just your squad) ----
  // /ajax/tooltip.ajax.php?player_id=X (confirmed via community scripts that already use it
  // to power their own player-page overlays) returns the full skill set for any player_id —
  // own squad, opponent, or transfer-list — independent of which club they're contracted to.
  // Skill values come back either as a plain number or as "silver star"/"gold star" — a
  // confirmed reading is silver star = 19, gold star = 20 (the two tiers above the raw 1-18
  // range shown as numbers).
  const SKILL_NAME_MAP = {
    'Strength': 'str', 'Stamina': 'sta', 'Pace': 'pac', 'Marking': 'mar', 'Tackling': 'tac',
    'Workrate': 'wor', 'Positioning': 'pos', 'Passing': 'pas', 'Crossing': 'cro', 'Technique': 'tec',
    'Heading': 'hea', 'Finishing': 'fin', 'Longshots': 'lon', 'Set Pieces': 'set',
    'Handling': 'han', 'One on ones': 'one', 'Reflexes': 'ref', 'Aerial Ability': 'ari',
    'Jumping': 'jum', 'Communication': 'com', 'Kicking': 'kic', 'Throwing': 'thr',
  };
  function starAwareSkillValue(v) {
    if (typeof v === 'string' && v.toLowerCase().includes('star')) return v.toLowerCase().includes('gold') ? 20 : 19;
    return parseFloat(v) || 0;
  }
  async function fetchPlayerTooltip(playerId) {
    const res = await fetch('/ajax/tooltip.ajax.php', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'player_id=' + encodeURIComponent(playerId),
    });
    const data = JSON.parse(await res.text());
    return data && data.player ? data.player : null;
  }
  // tooltip.ajax.php returns skill_index/routine/rec_sort as comma-formatted display strings
  // (e.g. "6,272"), not raw numbers. Passing that straight into Number()/the R5 formula
  // silently produces NaN, which calculateR5() then rejects and falls back to the much
  // smaller `rec` value — this was the cause of both the "SI: NaN" and the wildly-wrong
  // "R5: 2.5" (actually the REC value) seen on the player-profile overlay. Strip
  // thousands-separators before parsing, same as parseMoney() does elsewhere.
  const parseNumericString = (v) => (v == null || v === '') ? null : (Number(String(v).replace(/,/g, '')) || 0);
  function normaliseTooltipPlayer(raw) {
    if (!raw) return null;
    const skills = {};
    (raw.skills || []).forEach(s => { const key = SKILL_NAME_MAP[s.name]; if (key) skills[key] = starAwareSkillValue(s.value); });
    // tooltip.ajax.php gives whole years in `age` plus a separate `months` field (confirmed by
    // the community's "TM Player Enhanced" script: `playerAge = age + months/12`) — combine
    // for a precise decimal age rather than rounding down to the nearest year.
    const months = raw.months != null ? parseInt(raw.months, 10) || 0 : 0;
    return {
      id: raw.id, name: raw.name || 'Unknown', fp: displayFp(raw.favposition || ''),
      age: raw.age != null && raw.age !== '' ? parseFloat(raw.age) + months / 12 : null,
      ageMonths: raw.age != null && raw.age !== '' ? Math.round(parseFloat(raw.age) * 12 + months) : null,
      asi: parseNumericString(raw.skill_index), routine: parseNumericString(raw.routine) || 0,
      rec: parseNumericString(raw.rec_sort) || 0,
      // Arrives as HTML ("<span class='coin'>2,511,864</span>"); strip tags before parsing.
      wage: raw.wage != null ? (parseMoney(String(raw.wage).replace(/<[^>]+>/g, '')) || null) : null, // present per "TM Player Enhanced"
      skills,
    };
  }

  let _playerPageDone = false;
  async function enhancePlayerDetailPage(playerId) {
    if (_playerPageDone || document.getElementById('tma-player-card')) return;
    _playerPageDone = true;
    try {
      const raw = await fetchPlayerTooltip(playerId);
      const p = normaliseTooltipPlayer(raw);
      if (!p) { _playerPageDone = false; return; }
      const isGK = bucketFor(p.fp) === 'GK';
      const ageMonths = ageMonthsOf(p);
      const staPrice = p.asi != null && ageMonths ? calcSellToAgentPrice(Number(p.asi), ageMonths, isGK) : null;
      const maxPrice = p.asi != null && ageMonths ? calcMaxSellPrice(Number(p.asi), ageMonths, staPrice) : null;
      const cats = categoryBreakdown(p.skills, p.routine, isGK);

      // A dual/tri-eligible favposition (e.g. "M/OM C") genuinely has a DIFFERENT R5 per
      // position, not one number — compute and show every listed position separately rather
      // than silently picking (or worse, defaulting to) just the first one.
      const posCodes = parseFavPositionCodes(p.fp);
      const skillArr = isGK ? gkSkillArray(p.skills) : outfieldSkillArray(p.skills);
      const r5ByPosition = posCodes.map(code => {
        const posIdx = getPositionIndex(code);
        const r5 = (p.asi && !skillArr.some(isNaN)) ? calculateR5(posIdx, skillArr, Number(p.asi), p.routine || 0) : null;
        return { label: code.toUpperCase(), r5 };
      });

      const box = document.createElement('div');
      box.id = 'tma-player-card';
      box.style.cssText = 'margin:8px 0;padding:10px 12px;background:#1c212788;border:1px solid #2b323b80;border-radius:9px;color:#dfe3e7;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:12px;';
      const stat = (label, val) => `<div><div style="font-size:9.5px;color:#8a94a0;text-transform:uppercase;letter-spacing:.04em;">${label}</div><div style="font-size:14px;font-weight:700;color:#6fa3d8;">${val}</div></div>`;
      const r5Stat = r5ByPosition.length > 1
        ? stat('R5', r5ByPosition.map(x => `${x.label} ${x.r5 != null ? x.r5.toFixed(1) : '-'}`).join(' / '))
        : stat('R5', r5ByPosition[0] && r5ByPosition[0].r5 != null ? r5ByPosition[0].r5.toFixed(1) : '-');
      const statRow = stat('Routine', p.routine != null ? Number(p.routine).toFixed(1) : '-')
        + stat('SI', p.asi != null ? Number(p.asi).toLocaleString() : '-')
        + r5Stat
        + (staPrice ? stat('Sell-to-Agent', Number(staPrice).toLocaleString()) : '')
        + (maxPrice ? stat('Max Sell Price', Number(maxPrice).toLocaleString()) : '');

      // Category breakdown — same categories the game's own player page shows
      // (Physique/Tactical/Technical + role-specific extras), see Section 2C. Numeric only.
      const catChip = (label, val) => {
        const v = Math.max(0, Math.min(5, val || 0));
        return `<div style="min-width:78px;"><div style="font-size:9.5px;color:#8a94a0;">${label}</div><div style="font-size:12px;color:#e4e7ea;font-weight:600;">${v.toFixed(2)}</div></div>`;
      };
      const catRow = Object.entries(cats).map(([k, v]) => catChip(k, v)).join('');
      const SLOTS_SHOWN = ['gk', 'dc', 'dl', 'dr', 'dmc', 'dml', 'dmr', 'mc', 'ml', 'mr', 'omc', 'oml', 'omr', 'fc'];
      const best = SLOTS_SHOWN.map(k => ({ k, v: slotRating(p, k), pen: tmPositionPenalty(p.fp, SLOT_NUM[k]) }))
        .filter(x => x.v > LAST_RESORT_RATING).sort((a, b) => b.v - a.v).slice(0, 4);
      const bestRow = best.map(x => `<span style="margin-right:12px;"><b>${x.k.toUpperCase()}</b> ${x.v.toFixed(1)}${x.pen ? ` <span style="color:#d97a70;">−${x.pen * 10}%</span>` : ''}</span>`).join('');

      box.innerHTML = `
        <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center;">${statRow}</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:1px solid #2b323b80;">${catRow}</div>
        ${bestRow ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #2b323b80;"><span style="font-size:9.5px;color:#8a94a0;text-transform:uppercase;letter-spacing:.04em;margin-right:8px;">Best positions (R5 incl. TM's position penalty)</span>${bestRow}</div>` : ''}
      `;
      const anchor = document.querySelector('.column1_a .std') || document.querySelector('.box_body') || document.querySelector('.main_center');
      if (anchor) anchor.insertBefore(box, anchor.firstChild);
    } catch (e) {
      console.warn('TM Advisor: player detail overlay failed', e);
      _playerPageDone = false;
    }
  }

  function autoCaptureCurrentPage() {
    const path = location.pathname;
    try {
      if (path === '/home/' || path === '/home') setSlice('home', parseHome(document));
      else if (path.startsWith('/finances/maintenance')) setSlice('maintenance', parseMaintenance(document));
      else if (path.startsWith('/finances')) setSlice('finances', parseFinances(document));
      else if (path.startsWith('/club/') && path.includes('/squad/')) {
        const id = path.split('/')[2];
        if (id && id === clubId) {
          // The squad page lists the reserves (B) as well; they come from the B team's own id.
          const b = window.SESSION && SESSION.b_team ? fetchOpponentSquadReal(String(SESSION.b_team)).catch(() => []) : Promise.resolve([]);
          Promise.all([fetchOpponentSquadReal(id), b]).then(([a, bb]) => { const players = a.concat(bb); if (players.length) injectColumnsWhenReady(players, { showRou: true, showSI: true, showTrend: true, compact: true }); })
            .catch(e => console.warn('TM Advisor: own squad columns', e));
        }
        else {
          const scraped = parseSquadPage(document);
          const oppName = scraped.name || null;
          fetchOpponentSquadReal(id).then(players => {
            if (players.length) {
              setSlice('opponent', { id, name: oppName, players, source: 'real-skills' });
              injectColumnsWhenReady(players, { showRou: true, showSI: true, compact: true });
            } else {
              const fallback = scraped.players.map(p => ({ ...p, _r5: p.recStars != null ? p.recStars * 22 : null }));
              setSlice('opponent', { id, name: oppName, players: fallback, source: 'star-estimate' });
              injectColumnsWhenReady(fallback, { showRou: true, showSI: true, compact: true });
            }
          }).catch(() => {
            const fallback = scraped.players.map(p => ({ ...p, _r5: p.recStars != null ? p.recStars * 22 : null }));
            setSlice('opponent', { id, name: oppName, players: fallback, source: 'star-estimate' });
            injectColumnsWhenReady(fallback, { showRou: true, showSI: true, compact: true });
          });
        }
      } else if (path === '/club/' || path === '/club' || (path.startsWith('/club/') && path.split('/').filter(Boolean).length === 2)) { // own club page is bare /club/
        setSlice('club', parseClub(document));
      } else if (/^\/players\/\d+\//.test(path)) {
        // An individual player's profile page (e.g. /players/142683102/Mario-Maimela/) —
        // distinct from the bare /players/ squad-editor list handled below.
        const idm = path.match(/^\/players\/(\d+)\//);
        if (idm) enhancePlayerDetailPage(idm[1]);
      } else if (path.startsWith('/players')) {
        const attemptParse = (retryCount) => {
          const data = parsePlayers(document);
          if (data.length > 0) {
            setSlice('players', data);
            recordSquadSnapshot(data);
            injectColumnsWhenReady(data, { showRou: true, showSI: true, showTrend: true });
          } else if (retryCount < 10) {
            setTimeout(() => attemptParse(retryCount + 1), 500);
          }
        };
        attemptParse(0);
      }
      else if (path.startsWith('/stadium')) setSlice('stadium', parseStadium(document));
      else if (path.startsWith('/transfer')) {
        // Transfer list results load in via the page's own search; enhance them live with
        // SI + R5 columns (proof-backed, read straight from the rendered rows).
        enhanceTransferPage();
      }
      else if (path.startsWith('/youth-development')) {
        // Recruit rows can load in after the initial pass (new week's pull, page re-render);
        // same debounced-observer pattern as enhanceTransferPage.
        let timer = null;
        enhanceYouthDevelopmentPage();
        const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(enhanceYouthDevelopmentPage, 150); });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 300000);
      }
      else if (path.startsWith('/matches/')) {
        const d = parseMatchPage(document);
        const c = loadCache();
        c.lastMatchPage = { t: now(), data: d, url: path };
        saveCache(c);
        // Populate the opponent EXPECTED slice from test_lineup (same 'opponentExpected' key
        // refreshAll/fetchNextMatchExpected write, so Tactics reads one source). test_lineup
        // carries NO club ids, so our side is inferred by overlapping player ids with the
        // cached own-squad; if the squad isn't cached yet we can't tell sides apart and
        // safely skip rather than record the wrong team's XI.
        if (d && d.lineup && d.lineup.home && d.lineup.away) {
          const squad = getSlice('players');
          const myIds = new Set((squad && squad.data ? squad.data : []).map(p => String(p.id)));
          const overlap = (side) => Object.keys(d.lineup[side]).filter(pid => myIds.has(String(pid))).length;
          const homeOverlap = overlap('home'), awayOverlap = overlap('away');
          if (homeOverlap !== awayOverlap && Math.max(homeOverlap, awayOverlap) >= 5) {
            const oppSide = homeOverlap > awayOverlap ? 'away' : 'home';
            const oppLineup = d.lineup[oppSide];
            // Exclude substitutes and never use `p.position` (the assigned match SLOT, e.g.
            // "sub1") as a favposition fallback — same fix as fetchNextMatchExpected above.
            const starterIds = Object.keys(oppLineup).filter(pid => {
              const slot = oppLineup[pid] && oppLineup[pid].position;
              return !(slot && String(slot).toLowerCase().includes('sub'));
            });
            const xi = starterIds.map(pid => {
              const p = oppLineup[pid];
              return { id: pid, name: p.nameLast || p.name || 'Player ' + pid, fp: p.favposition || p.fp || '?' };
            });
            let formation = null;
            if (xi.length >= 9 && xi.length <= 11) {
              const b = { GK: 0, D: 0, DM: 0, M: 0, OM: 0, F: 0 };
              xi.forEach(p => { b[bucketFor(p.fp)] = (b[bucketFor(p.fp)] || 0) + 1; });
              formation = (b.D + b.DM) + '-' + (b.M + b.OM) + '-' + b.F;
            }
            // Merge, don't clobber: a previously fetched mentality/style/focus for this
            // fixture stays valid even though test_lineup can't provide them.
            const prev = (getSlice('opponentExpected') && getSlice('opponentExpected').data) || {};
            setSlice('opponentExpected', { ...prev, ...(formation ? { formation } : {}), xi, side: oppSide, matchUrl: path, capturedAt: now() });
          }
        }
        hookMatchAjax(); // catch match_data once it loads via XHR
        // Before kickoff the page never loads the report, but TM has already played the match
        // (it simulates ahead) — read it ourselves, as "Match stats and actions 51 minutes before
        // match" does, and show the result.
        const mid = (path.match(/\/matches\/(\d+)/) || [])[1];
        if (mid) fetchMatchJson(mid).then(m => { if (m && m.report && Object.keys(m.report).length) { cacheMatchSummary(m); showMatchResultCard(m, mid); } enhanceMatchPageRatings(m); })
          .catch(e => console.warn('TM Advisor: match report', e));
      }
    } catch (e) { console.error('TM Advisor auto-capture error', e); }
  }

  // Intercept the
  // match.ajax.php XHR so we can cache the full match_data (score, stats, events)
  // the moment it loads — works whether we arrive before or after kickoff data is ready.
  let _matchHookInstalled = false;
  function hookMatchAjax() {
    if (typeof match_data !== 'undefined' && match_data && match_data.report) {
      cacheMatchSummary(match_data);
      enhanceMatchPageRatings(match_data);
    }
    if (_matchHookInstalled) return;
    _matchHookInstalled = true;
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) { this._tmaUrl = url; return origOpen.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () {
      const xhr = this;
      if (xhr._tmaUrl && String(xhr._tmaUrl).includes('match.ajax.php')) {
        const orig = xhr.onreadystatechange;
        xhr.onreadystatechange = function () {
          if (orig) orig.apply(this, arguments);
          if (xhr.readyState === 4 && xhr.status === 200) {
            setTimeout(() => {
              let m = null;
              if (typeof match_data !== 'undefined' && match_data && match_data.report) m = match_data;
              else { try { m = JSON.parse(xhr.responseText); } catch (e) {} }
              if (m) { cacheMatchSummary(m); enhanceMatchPageRatings(m); }
            }, 100);
          }
        };
      }
      return origSend.apply(this, arguments);
    };
  }

  // ---- Match-page team ratings overlay ----
  // On a match page, annotate BOTH line-ups with each player's accurate R5 and show a
  // per-team summary (avg R5, avg SI, avg routine, avg age). We pull each club's full real
  // skills in a single players_get_select call (fetchOpponentSquadReal) and reuse
  // playerR5(). All data is the game's own — nothing invented. Runs once per page (guarded).
  let _matchRatingsDone = false;
  async function enhanceMatchPageRatings(match) {
    if (_matchRatingsDone) return;
    if (!match || !match.club || !match.lineup) return;
    const homeId = match.club.home && match.club.home.id;
    const awayId = match.club.away && match.club.away.id;
    if (!homeId || !awayId) return;
    _matchRatingsDone = true;
    try {
      const [homeSquad, awaySquad] = await Promise.all([
        fetchOpponentSquadReal(homeId).catch(() => []),
        fetchOpponentSquadReal(awayId).catch(() => []),
      ]);
      const byId = {};
      homeSquad.concat(awaySquad).forEach(p => { ensureR5(p); byId[String(p.id)] = p; });

      const summarise = (lineupSide) => {
        const ids = lineupSide ? Object.keys(lineupSide) : [];
        const rated = ids.map(id => byId[String(id)]).filter(Boolean);
        if (!rated.length) return null;
        const avg = (fn) => rated.reduce((s, p) => s + (fn(p) || 0), 0) / rated.length;
        return {
          count: rated.length,
          r5: avg(p => Number(p._r5)),
          asi: avg(p => Number(p.asi)),
          routine: avg(p => Number(p.routine)),
        };
      };
      const homeSum = summarise(match.lineup.home);
      const awaySum = summarise(match.lineup.away);

      // Overlay R5 next to each player element on the pitch (player_id attribute), if present.
      document.querySelectorAll('[player_id]').forEach(el => {
        const p = byId[String(el.getAttribute('player_id'))];
        if (!p || p._r5 == null || isNaN(p._r5) || el.querySelector('.tma-match-r5')) return;
        const tag = document.createElement('span');
        tag.className = 'tma-match-r5';
        tag.textContent = 'R5 ' + Number(p._r5).toFixed(1);
        tag.style.cssText = 'display:inline-block;margin-left:4px;padding:0 4px;border-radius:3px;background:#1c2c3d;color:#7fb2e0;font-weight:700;font-size:10px;';
        el.appendChild(tag);
      });

      // A compact summary card, injected once near the top of the match page.
      if ((homeSum || awaySum) && !document.getElementById('tma-match-summary')) {
        const box = document.createElement('div');
        box.id = 'tma-match-summary';
        box.style.cssText = 'margin:8px auto;max-width:640px;background:#161c22;border:1px solid #2f7d3266;border-radius:10px;padding:10px 14px;color:#e4e7ea;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;';
        const col = (s) => s ? `avg R5 <b style="color:#7fb2e0">${s.r5.toFixed(1)}</b> · SI ${Math.round(s.asi).toLocaleString()} · Rou ${s.routine.toFixed(1)}` : 'n/a';
        box.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:12px;">
          <div><b>${esc(match.club.home.club_name || 'Home')}</b><br>${col(homeSum)}</div>
          <div style="text-align:right;"><b>${esc(match.club.away.club_name || 'Away')}</b><br>${col(awaySum)}</div>
        </div><div style="font-size:10px;color:#8a939c;margin-top:4px;">TM Advisor · accurate R5 from each club's real skills</div>`;
        const anchor = document.querySelector('.main_center') || document.body;
        anchor.insertBefore(box, anchor.firstChild);
      }
    } catch (e) { console.warn('TM Advisor: match-page ratings overlay failed', e); _matchRatingsDone = false; }
  }

  // Full result on the match page: score, stats, every event with its minute and player
  // (goals, cards, injuries, subs, mentality changes) and how each side built its attacks.
  function showMatchResultCard(match, matchId) {
    if (document.getElementById('tma-match-result')) return;
    const a = analyseMatchReport(match);
    const H = match.club.home, A = match.club.away, homeId = String(H.id);
    const lineup = match.lineup || {};
    const nameOf = pid => { const x = (lineup.home && lineup.home[pid]) || (lineup.away && lineup.away[pid]); return x ? x.name : 'Player ' + pid; };
    const sideOf = pid => lineup.home && lineup.home[pid] ? 'home' : 'away';
    const extra = [];
    Object.keys(match.report).forEach(min => (match.report[min] || []).forEach(evt => (evt && evt.parameters || []).forEach(pr => {
      if (pr.sub) extra.push({ minute: Number(min), type: 'sub', side: sideOf(pr.sub.player_in), player: `${nameOf(pr.sub.player_in)} on for ${nameOf(pr.sub.player_out)}` });
      if (pr.mentality_change) extra.push({ minute: Number(min), type: 'ment', side: String(pr.mentality_change.team) === homeId ? 'home' : 'away', player: 'Mentality → ' + (MENTALITY[Number(pr.mentality_change.mentality)] || pr.mentality_change.mentality) });
    })));
    const events = a.timeline.concat(extra).sort((x, y) => x.minute - y.minute);
    const icon = { goal: '⚽', yellow: '🟨', red: '🟥', yellow_red: '🟨🟥', injury: '✚', sub: '🔄', ment: '🧭' };
    const styles = { home: {}, away: {} };
    concededByStyle(match, String(A.id), styles.home); // attacks by home = conceded by away
    concededByStyle(match, homeId, styles.away);
    const styleLine = side => Object.entries(styles[side]).sort((x, y) => y[1].a - x[1].a).map(([k, x]) => `${ATT_STYLE[k]} ${x.a} (${x.sh} shots, ${x.g} goals)`).join(' · ') || '—';
    const st = a.stats, row = (label, k) => `<tr><td style="text-align:right;">${st[k].home ?? '–'}</td><td style="text-align:center;color:#8a939c;">${label}</td><td>${st[k].away ?? '–'}</td></tr>`;
    const pred = ((getSlice('predictions') || { data: {} }).data || {})[matchId];
    const box = document.createElement('div');
    box.id = 'tma-match-result';
    box.style.cssText = 'margin:8px auto;max-width:640px;background:#161c22;border:1px solid #2f7d3266;border-radius:10px;padding:10px 14px;color:#e4e7ea;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:12px;';
    box.innerHTML = `
      <details open><summary style="cursor:pointer;font-weight:700;">Result — TM has already played this match</summary>
        <div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0;font-size:15px;font-weight:700;">
          <span>${esc(H.club_name || 'Home')}</span><span style="font-size:20px;color:#7fb2e0;">${a.score.home} – ${a.score.away}</span><span>${esc(A.club_name || 'Away')}</span>
        </div>
        ${(() => { const md = match.match_data || {}; const sd = side => { const st = Object.values((match.lineup || {})[side] || {}).filter(x => x && x.position && !String(x.position).includes('sub')); const pk = k => md[k] && typeof md[k] === 'object' ? md[k][side] : null; const rec = st.length ? st.reduce((a, x) => a + (parseFloat(x.rec) || 0), 0) / st.length : null; return `${esc(shapeLabel(shapeOf(st.map(x => x.position))))}${rec ? ' · ' + rec.toFixed(2) + '★' : ''}${pk('mentality') != null ? ' · ' + esc(MENTALITY[Number(pk('mentality'))] || '') : ''}${pk('attacking_style') != null ? ' / ' + esc(ATT_STYLE[Number(pk('attacking_style')) || 1] || '') : ''}`; }; return `<div style="display:flex;justify-content:space-between;color:#8a939c;margin-bottom:6px;"><span>${sd('home')}</span><span style="text-align:right;">${sd('away')}</span></div>`; })()}
        ${pred ? `<div style="text-align:center;color:#8a939c;margin-bottom:6px;">TM Advisor predicted ${pred.gd >= 0 ? '+' : ''}${pred.gd.toFixed(1)} goals for us</div>` : ''}
        <table style="width:100%;border-collapse:collapse;">
          ${row('Possession %', 'possession')}${row('Shots', 'shots')}${row('On target', 'shotsOnTarget')}${row('Set pieces', 'setPieces')}${row('Penalties', 'penalties')}${row('Yellow cards', 'yellows')}${row('Red cards', 'reds')}
        </table>
        <div style="margin-top:8px;">${events.map(e => `<div style="display:flex;gap:8px;${e.side === 'away' ? 'flex-direction:row-reverse;text-align:right;' : ''}padding:2px 0;border-top:1px solid #2b323b55;"><span style="color:#8a939c;min-width:30px;">${e.minute}'</span><span>${icon[e.type] || ''} ${esc(e.player)}</span></div>`).join('') || '<div style="color:#8a939c;">No events.</div>'}</div>
        <div style="margin-top:8px;color:#8a939c;">Attacks — ${esc(H.club_name || 'Home')}: ${esc(styleLine('home'))}</div>
        <div style="color:#8a939c;">Attacks — ${esc(A.club_name || 'Away')}: ${esc(styleLine('away'))}</div>
      </details>`;
    const anchor = document.querySelector('.main_center') || document.body;
    anchor.insertBefore(box, anchor.firstChild);
  }

  function cacheMatchSummary(match) {
    try {
      const homeClub = match.club && match.club.home, awayClub = match.club && match.club.away;
      // Full stats + timeline via the shared analyser (Section 2) — previously we only
      // captured goals + possession; now we keep shots, shots-on-target, set pieces,
      // penalties, cards and a minute-by-minute goal/card/injury timeline too.
      const a = analyseMatchReport(match);
      const summary = {
        home: homeClub ? homeClub.club_name : 'Home', away: awayClub ? awayClub.club_name : 'Away',
        homeId: homeClub ? homeClub.id : null, awayId: awayClub ? awayClub.id : null,
        homeGoals: a.score.home, awayGoals: a.score.away,
        possession: a.stats.possession,
        stats: a.stats,
        timeline: a.timeline,
        events: a.timeline.length,
      };
      const c = loadCache();
      c.lastMatchResult = { t: now(), data: summary };
      saveCache(c);
    } catch (e) { console.error('TM Advisor: match summary capture failed', e); }
  }

  /* ============================================================
   *  SECTION 5 — TACTICS ENGINE  (heuristic, transparent, explainable)
   * ============================================================ */

  function bucketFor(fp) {
    if (!fp) return 'M';
    fp = fp.toUpperCase();
    if (fp.includes('GK')) return 'GK';
    if (fp.startsWith('DM')) return 'DM';
    if (fp.startsWith('D')) return 'D';
    if (fp.startsWith('OM')) return 'OM';
    if (fp.startsWith('M')) return 'M';
    if (fp.startsWith('F')) return 'F';
    return 'M';
  }
  function sideFor(fp) {
    if (!fp) return 'C';
    if (fp.includes(' L') || fp.includes('L,') || fp.endsWith('L')) return 'L';
    if (fp.includes(' R') || fp.includes('R,') || fp.endsWith('R')) return 'R';
    return 'C';
  }

  // Formations on TM's own slot keys (CLAUDE.md "Tactics page"), so a recommended XI can be
  // posted to /tactics/ exactly as shown. dmc/omc are real keys (seen in match line-ups).
  const FORMATIONS = {
    '4-4-2': 'gk dl dcl dcr dr ml mcl mcr mr fcl fcr',
    '4-5-1': 'gk dl dcl dcr dr ml mcl mc mcr mr fc',
    '4-3-3': 'gk dl dcl dcr dr mcl mc mcr oml omr fc',
    '4-2-3-1': 'gk dl dcl dcr dr dmcl dmcr oml omc omr fc',
    '4-1-4-1': 'gk dl dcl dcr dr dmc ml mcl mcr mr fc',
    '4-2-2-2': 'gk dl dcl dcr dr dmcl dmcr oml omr fcl fcr',
    '3-5-2': 'gk dcl dc dcr ml mcl mc mcr mr fcl fcr',
    '3-4-3': 'gk dcl dc dcr ml mcl mcr mr fcl fc fcr',
    '3-1-4-2': 'gk dcl dc dcr dmc ml mcl mcr mr fcl fcr',
    '5-3-2': 'gk dl dcl dc dcr dr mcl mc mcr fcl fcr',
    '5-4-1': 'gk dl dcl dc dcr dr ml mcl mcr mr fc',
    // Current meta per the user and TM forum posters: three central defenders, two DMCs or a
    // packed midfield, two forwards — plus the 4-5-1 (OMC) shape cited as its counter.
    '3-2-3-2': 'gk dcl dc dcr dmcl dmcr mcl mc mcr fcl fcr',
    '3-2-4-1': 'gk dcl dc dcr dmcl dmcr ml mcl mcr mr fc',
    '3-3-2-2': 'gk dcl dc dcr dml dmc dmr mcl mcr fcl fcr',
    '4-4-1-1': 'gk dl dcl dcr dr ml mcl mcr mr omc fc',
  };
  // TM's position number per slot key (the tactics page's `position_key`).
  const SLOT_NUM = { gk: 0, dl: 1, dcl: 2, dc: 3, dcr: 4, dr: 5, dml: 6, dmcl: 7, dmc: 8, dmcr: 9, dmr: 10,
    ml: 11, mcl: 12, mc: 13, mcr: 14, mr: 15, oml: 16, omcl: 17, omc: 18, omcr: 19, omr: 20, fcl: 21, fc: 22, fcr: 23 };
  const slotLineOf = (n) => n === 0 ? 'GK' : n <= 5 ? 'D' : n <= 10 ? 'DM' : n <= 15 ? 'M' : n <= 20 ? 'OM' : 'F';
  const slotSideOf = (n) => [1, 6, 11, 16].includes(n) ? 'L' : [5, 10, 15, 20].includes(n) ? 'R' : 'C';
  const slotBucket = (key) => slotLineOf(SLOT_NUM[key]);
  const slotSide = (key) => slotSideOf(SLOT_NUM[key]);

  // Port of TM's own out-of-position penalty, retPlayerMood/retPlayerMoodCalc in
  // js/tactics_v2.js: 0-4 steps of 10% each. Its comments: side C<->L/R 20%, L<->R 10%;
  // each line away 10% (D at F 40%); a GK outfield or an outfielder in goal = 4.
  const TM_LINE_PENALTY = {
    D: { D: 0, DM: 1, M: 2, OM: 3, F: 4 },
    DM: { DM: 0, D: 1, M: 1, OM: 2, F: 3 },
    M: { M: 0, DM: 1, OM: 1, D: 2, F: 2 },
    OM: { OM: 0, M: 1, F: 1, DM: 2, D: 3 },
    F: { F: 0, OM: 1, M: 2, DM: 3, D: 4 },
  };
  function tmMoodCalc(line, side, n) {
    const placedSide = slotSideOf(n);
    let pen = side === placedSide ? 0 : (side === 'C' || placedSide === 'C') ? 2 : 1;
    pen += TM_LINE_PENALTY[slotLineOf(n)][line] || 0;
    return Math.min(pen, 4);
  }
  function tmPositionPenalty(fp, n) {
    let fav = String(fp || '').trim();
    if (fav.includes(', F')) { const t = fav.split(' '); fav = t[0] + '/F ' + t[1].split(',')[0]; } // "OM C, F" -> "OM/F C", as TM does
    if (fav === 'GK' || n === 0) return (fav === 'GK' && n === 0) ? 0 : 4;
    const parts = fav.split(' ');
    const lines = parts[0].split('/');
    if (fav === 'F') return tmMoodCalc('F', 'C', n);
    if (lines.includes('F')) return Math.min(tmMoodCalc('F', 'C', n), tmMoodCalc(lines[0], parts[1], n));
    if (lines.length > 1) return Math.min(tmMoodCalc(lines[0], parts[1], n), tmMoodCalc(lines[1], parts[1], n));
    return Math.min(...(parts[1] || 'C').split('').map(s => tmMoodCalc(parts[0], s, n)));
  }

  // A player's value in one slot = R5 on THAT slot's weights × TM's out-of-position penalty.
  // R5 is per-position: a DC at DMC is scored on the DMC weights, not on his DC rating.
  // Players without raw skills (star-estimate opponents) fall back to their single _r5.
  // An empty slot can forfeit the match, so a keeper outfield / an outfielder in goal is a LAST
  // resort rather than impossible: it scores just above nothing, so the optimiser only uses it
  // when no one else can fill the slot — and then picks whoever is missed least elsewhere.
  const LAST_RESORT_RATING = 1;
  function slotRating(p, key) {
    const isGK = bucketFor(p.fp) === 'GK';
    if ((key === 'gk') !== isGK) return LAST_RESORT_RATING;
    const posIdx = getPositionIndex(key);
    if (!p._slotR5) Object.defineProperty(p, '_slotR5', { value: {}, enumerable: false });
    if (p._slotR5[posIdx] === undefined) {
      const asi = Number(String(p.asi == null ? '' : p.asi).replace(/,/g, ''));
      let r5 = null;
      if (p.skills && asi) {
        const arr = isGK ? gkSkillArray(p.skills) : outfieldSkillArray(p.skills);
        if (!arr.some(isNaN)) r5 = calculateR5(posIdx, arr, asi, p.routine || 0);
      }
      p._slotR5[posIdx] = r5 != null ? r5 : (Number(ensureR5(p)) || 0);
    }
    return p._slotR5[posIdx] * (1 - 0.1 * tmPositionPenalty(p.fp, SLOT_NUM[key]));
  }

  // ---- Formation counters (community-sourced meta) ----
  // A qualitative "which formation tends to beat which" map. Meta direction (user-observed
  // over recent seasons, consistent with community discussion): 3-back line-ups currently
  // out-perform 4-back ones, so we counter 4-back opponents with the 3-5-2 wing overload,
  // and counter 3-back opponents with the wide 4-3-3 triangle instead of another 4-back
  // flat shape that would just lose the same meta battle. This is meta-knowledge, NOT a
  // game formula - treat as a nudge on top of the R5-based pick, not an override.
  const FORMATION_COUNTERS = {
    '4-4-2': ['3-5-2'],     // two strikers press a 3-CB line; wide Mids handle the 3-5-2 wings
    '4-5-1': ['3-5-2'],     // 3 wings + 2 F overload the 4-back shape's sparse wings
    '4-3-3': ['3-5-2'],     // 3-5-2 crowds the centre the 4-3-3 trio leaves thin
    '3-5-2': ['4-3-3'],     // width pulls the 3-CB line apart instead of meeting it head-on
    '3-1-4-2': ['4-3-3'],
    '3-2-3-2': ['4-3-3'],
    '3-4-3': ['3-5-2'],     // mirror the wing numbers, keep the meta-favoured 3-back core
  };
  // Difficulty tiers for a fixture, based on the opponent's best-XI R5 vs ours. This reframes
  // the same percentage edge the mentality pick already uses into an at-a-glance "tough week?"
  function fixtureDifficulty(myAvg, oppAvg) {
    if (myAvg == null || oppAvg == null || oppAvg <= 0) return null;
    const diffPct = (myAvg - oppAvg) / oppAvg * 100;
    if (diffPct >= 12) return { label: 'Comfortable', cls: 'goodval', note: `we're clearly stronger (+${diffPct.toFixed(0)}% squad edge)` };
    if (diffPct <= -12) return { label: 'Tough', cls: 'badval', note: `they're clearly stronger (${diffPct.toFixed(0)}% deficit)` };
    if (diffPct >= 4) return { label: 'Slightly favoured', cls: 'goodval', note: `small edge (+${diffPct.toFixed(0)}%)` };
    if (diffPct <= -4) return { label: 'Slightly harder', cls: 'warn', note: `small deficit (${diffPct.toFixed(0)}%)` };
    return { label: 'Even', cls: 'mini', note: `about level (${diffPct.toFixed(0)}%)` };
  }
  // Suggests a roughly-formation-counter when the opponent's formation is known, and returns
  // the fixture difficulty — both surfaced in the Tactics view.
  function formationCounterAndDifficulty(myFormation, oppFormation, myAvg, oppAvg) {
    let counter = null;
    if (oppFormation && FORMATION_COUNTERS[oppFormation]) {
      counter = {
        for: oppFormation,
        suggested: FORMATION_COUNTERS[oppFormation][0],
        note: `community meta: ${FORMATION_COUNTERS[oppFormation][0]} tends to counter ${oppFormation}. Unverified community claim — shown for reference only, NOT used to pick the formation.`,
      };
    }
    return { counter, difficulty: fixtureDifficulty(myAvg, oppAvg) };
  }

  // Hungarian assignment on score[slot][player] (maximised). The old greedy slot-by-slot fill
  // let the first slot grab a player who was worth more somewhere else.
  function assignOptimal(score) {
    const n = score.length, m = score[0].length;
    const u = Array(n + 1).fill(0), v = Array(m + 1).fill(0), p = Array(m + 1).fill(0), way = Array(m + 1).fill(0);
    for (let i = 1; i <= n; i++) {
      p[0] = i;
      let j0 = 0;
      const minv = Array(m + 1).fill(Infinity), used = Array(m + 1).fill(false);
      do {
        used[j0] = true;
        const i0 = p[j0];
        let d = Infinity, j1 = 0;
        for (let j = 1; j <= m; j++) {
          if (used[j]) continue;
          const c = -score[i0 - 1][j - 1] - u[i0] - v[j];
          if (c < minv[j]) { minv[j] = c; way[j] = j0; }
          if (minv[j] < d) { d = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= m; j++) {
          if (used[j]) { u[p[j]] += d; v[j] -= d; } else minv[j] -= d;
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const out = Array(n).fill(-1);
    for (let j = 1; j <= m; j++) if (p[j]) out[p[j] - 1] = j - 1;
    return out;
  }

  const NO_FIT = -1e6;
  // TM's tactics page refuses a 6th foreigner across XI + bench (js/tactics_v2.js: `foreigners
  // >= 5` disables the drop; foreign = the player's show_flag, i.e. not your club's nation).
  const MAX_FOREIGN = 5;
  const isForeign = p => !!p && (p.foreign === true || (!!p.nat && !!MY_COUNTRY && String(p.nat).toLowerCase() !== MY_COUNTRY));
  function pickBestXI(players, formationKey, boost) {
    let xi = pickBestXIUnchecked(players, formationKey, boost);
    // Over the cap: drop the weakest foreign starter from the pool and pick again.
    const out = new Set();
    for (let guard = 0; guard < 11; guard++) {
      const f = xi.lineup.filter(l => isForeign(l.player));
      if (f.length <= MAX_FOREIGN) break;
      out.add(f.sort((a, b) => a.effectiveR5 - b.effectiveR5)[0].player);
      xi = pickBestXIUnchecked(players.filter(p => !out.has(p)), formationKey, boost);
    }
    return xi;
  }
  function pickBestXIUnchecked(players, formationKey, boost) {
    const keys = FORMATIONS[formationKey].split(' ');
    const score = keys.map(k => players.map(p => { const v = slotRating(p, k) * (boost ? boost(p) : 1); return isFinite(v) ? v : NO_FIT; }));
    while (score[0].length < keys.length) score.forEach(r => r.push(NO_FIT)); // fewer players than slots
    const pick = assignOptimal(score);
    const lineup = keys.map((k, i) => {
      const p = players[pick[i]], v = p ? score[i][pick[i]] : NO_FIT;
      const ok = p && v > NO_FIT / 2;
      // A boost only decides who plays; strengths (and so mentality) use the real rating — seen
      // live: the reserves' 1.5x youth boost made them look far stronger and picked Attacking.
      return { slot: k, bucket: slotBucket(k), side: slotSide(k), player: ok ? p : null, effectiveR5: ok ? (boost ? slotRating(p, k) : v) : 0, penalty: ok ? tmPositionPenalty(p.fp, SLOT_NUM[k]) : 0 };
    });
    shareRoutine(lineup);
    return { lineup, totalRec: lineup.reduce((s, l) => s + l.effectiveR5, 0), formation: formationKey };
  }
  // Routine sharing — "TM - League Squad Analyzer" 1.1.0: per line (GK+D / DM+M / OM+F) the
  // lowest-routine starter plays at min(his + 0.25 x the line's highest, the 2nd-lowest, 40).
  // So a youth next to veterans is worth more than his own routine says.
  const ROUTINE_SHARE = 0.25, ROUTINE_SHARE_CAP = 40;
  const lineOf = k => /^(gk|d[lrc]|dc[lr])$/.test(k) ? 'D' : /^(dm|m)/.test(k) ? 'M' : 'F';
  function shareRoutine(lineup) {
    ['D', 'M', 'F'].forEach(line => {
      const g = lineup.filter(l => l.player && lineOf(l.slot) === line).sort((a, b) => (Number(a.player.routine) || 0) - (Number(b.player.routine) || 0));
      if (g.length < 2) return;
      const rou = l => Number(l.player.routine) || 0;
      const low = g[0], min = rou(low);
      if (min >= ROUTINE_SHARE_CAP) return;
      const shared = Math.round(Math.min(min + rou(g[g.length - 1]) * ROUTINE_SHARE, rou(g[1]), ROUTINE_SHARE_CAP) * 10) / 10;
      if (shared <= min) return;
      low.sharedRoutine = shared;
      low.effectiveR5 = slotRating({ ...low.player, routine: shared }, low.slot);
    });
    return lineup;
  }

  // Pure strength pick across every formation. No meta bias or counter nudge: on a real squad
  // the top formations land within ~1% of each other, so a guessed +3-4% bonus silently
  // decided the formation. `alternatives` lists the shapes within 1% — a genuine coin flip.
  function bestFormation(players, boost) {
    players.forEach(ensureR5);
    const all = Object.keys(FORMATIONS).map(key => pickBestXI(players, key, boost)).sort((a, b) => b.totalRec - a.totalRec);
    const best = all[0];
    best.alternatives = all.slice(1).filter(r => r.totalRec >= best.totalRec * 0.99).map(r => r.formation);
    return best;
  }

  // Lines and sides a favourite-position string covers ("D/DM L" -> D+DM, L).
  function fpLinesSides(fp) {
    const lines = new Set(), sides = new Set();
    String(fp || '').toUpperCase().split(',').forEach(seg => {
      const [l, s] = seg.trim().split(/\s+/);
      (l || '').split('/').filter(Boolean).forEach(x => lines.add(x));
      (s || 'C').split('').forEach(x => sides.add(x));
    });
    return { lines, sides };
  }

  // TM's five bench slots in its own order (the page lists sub5 first): FWD, WING, MID, DEF,
  // GK. Each takes the best natural player for the role, rated in the slots he'd cover.
  const BENCH_ROLES = [
    { key: 'sub5', role: 'FWD', slots: ['fc'], fits: f => f.lines.has('F') },
    { key: 'sub4', role: 'WING', slots: ['ml', 'mr', 'oml', 'omr'], fits: f => (f.lines.has('M') || f.lines.has('OM')) && (f.sides.has('L') || f.sides.has('R')) },
    { key: 'sub3', role: 'MID', slots: ['dmc', 'mc', 'omc'], fits: f => (f.lines.has('DM') || f.lines.has('M') || f.lines.has('OM')) && f.sides.has('C') },
    { key: 'sub2', role: 'DEF', slots: ['dcl', 'dl', 'dr'], fits: f => f.lines.has('D') },
    { key: 'sub1', role: 'GK', slots: ['gk'], fits: f => f.lines.has('GK') },
  ];
  function pickBench(remainingPlayers, foreignLeft) {
    const used = new Set();
    let left = foreignLeft != null ? foreignLeft : MAX_FOREIGN;
    const named = BENCH_ROLES.map(r => {
      const rate = p => Math.max(...r.slots.map(k => slotRating(p, k)));
      const free = remainingPlayers.filter(p => !used.has(p.id) && (left > 0 || !isForeign(p)));
      const natural = free.filter(p => r.fits(fpLinesSides(p.fp)));
      // No natural option left: still fill it (an empty bench slot is a wasted option) with the
      // best rated cover, ties going to the better player overall.
      const pool = natural.length ? natural : free;
      const player = pool.sort((a, b) => (rate(b) - rate(a)) || ((Number(ensureR5(b)) || 0) - (Number(ensureR5(a)) || 0)))[0] || null;
      if (player) { used.add(player.id); if (isForeign(player)) left--; }
      return { key: r.key, role: r.role, player, rating: player ? rate(player) : 0 };
    });
    const extras = remainingPlayers.filter(p => !used.has(p.id)).sort((a, b) => (b._r5 || 0) - (a._r5 || 0)).slice(0, 2);
    return { named, extras };
  }

  // Taker ranking = the skill sums the R5 formula itself uses for its free-kick / corner /
  // penalty bonus terms (Section 2B: set + lon | cro | fin + tec/2).
  function setPieceScore(p, type) {
    const s = p.skills || {}, n = k => Number(s[k]) || 0;
    const main = type === 'fk' ? n('lon') : type === 'ck' ? n('cro') : n('fin');
    return n('set') + main + n('tec') * 0.5;
  }

  function pickSquadRoles(startingPlayers) {
    const outfield = startingPlayers.filter(p => bucketFor(p.fp) !== 'GK');
    const rank = type => [...outfield].sort((a, b) => setPieceScore(b, type) - setPieceScore(a, type))[0] || null;
    // Heuristic: TM documents no captain effect; routine (match experience) is our proxy.
    const captain = [...startingPlayers].sort((a, b) => (Number(b.routine) || 0) - (Number(a.routine) || 0))[0] || null;
    return { captain, freeKick: rank('fk'), corner: rank('ck'), penalty: rank('pk') };
  }

  // Opponent XI on the same scale as ours (slot R5 × TM penalty): the XI they've saved for
  // this fixture when the pre-match line-up is out, else their best XI from our own engine.
  // (Was: the top 11 raw R5s of the whole squad — could count three keepers, ignored bans.)
  function opponentXI(opponent, expected) {
    const all = opponent.players || [];
    const byId = Object.fromEntries(all.filter(p => p.id != null).map(p => [String(p.id), p]));
    const saved = expected && Array.isArray(expected.xi) ? expected.xi.filter(x => x.slot && SLOT_NUM[x.slot] != null && byId[String(x.id)]) : [];
    if (saved.length >= 9) {
      const lineup = saved.map(x => ({ slot: x.slot, bucket: slotBucket(x.slot), side: slotSide(x.slot), player: byId[String(x.id)], effectiveR5: slotRating(byId[String(x.id)], x.slot) }))
        .filter(l => isFinite(l.effectiveR5));
      return { source: 'expected', lineup: shareRoutine(lineup) };
    }
    const fit = all.filter(p => (!p.ban || p.ban === '0') && !p.inj);
    const best = bestFormation((fit.length >= 11 ? fit : all).map(p => ({ ...p })));
    return { source: 'best', lineup: best.lineup.filter(l => l.player) };
  }

  function recommendTacticSettings(myXI, opponent, scouting, expected, opts) {
    // Compare our starting XI's average R5 against the opponent's likely-best-XI average R5.
    // Both sides are now on the same R5 scale (real skills when available via the AJAX
    // endpoint, or a rough star*22 estimate as fallback) — see fetchOpponentSquadReal().
    const myAvg = myXI.totalRec / myXI.lineup.filter(l => l.player).length;
    let oppAvg = null, oppSource = null;
    const oppXI = opponent && opponent.players && opponent.players.length ? opponentXI(opponent, expected) : null;
    if (oppXI && oppXI.lineup.length) {
      oppAvg = oppXI.lineup.reduce((a, l) => a + l.effectiveR5, 0) / oppXI.lineup.length;
      oppSource = opponent.source;
    }
    let mentality = 4; // Normal
    let reasoning = [];
    if (oppAvg != null) {
      // R5 scales up with overall player level, so compare as a % difference rather than
      // an absolute point gap — a 5-point gap means very different things at R5 40 vs R5 140.
      const diffPct = (myAvg - oppAvg) / oppAvg * 100;
      const srcNote = oppSource === 'real-skills' ? '(real opponent skills)' : '(estimated from visible star ratings — less precise)';
      if (diffPct > 12) { mentality = 6; reasoning.push('Squad clearly stronger than opponent (R5 edge +' + diffPct.toFixed(1) + '%) ' + srcNote + ' → play Attacking to press the advantage.'); }
      else if (diffPct > 4) { mentality = 5; reasoning.push('Slight quality edge (+' + diffPct.toFixed(1) + '%) ' + srcNote + ' → Slightly Attacking.'); }
      else if (diffPct < -12) { mentality = 2; reasoning.push('Squad clearly weaker (R5 deficit ' + diffPct.toFixed(1) + '%) ' + srcNote + ' → Defensive to limit damage.'); }
      else if (diffPct < -4) { mentality = 3; reasoning.push('Slight quality deficit (' + diffPct.toFixed(1) + '%) ' + srcNote + ' → Slightly Defensive.'); }
      else { reasoning.push('Evenly matched squads ' + srcNote + ' → Normal mentality, adjust live on the scoreline.'); }
    } else {
      reasoning.push('No opponent squad data cached yet — defaulting to Normal. Press ⚡ Prepare match once your next match is known.');
    }

    // Counter-nudge based on the opponent's mentality. PRIMARY source is the EXPECTED
    // mentality they've actually set for THIS fixture (from the next-match page — hard
    // data). We only fall back to the last-N-match average if the expected value isn't
    // available. Either way it's a small, one-step adjustment; the R5 comparison stays the
    // main driver.
    let oppMent = null, mentBasis = null;
    if (expected && expected.mentality) {
      oppMent = Number(expected.mentality);
      mentBasis = 'set for this fixture (from the match page)';
    } else if (scouting && scouting.mentality && scouting.sampleSize >= 3) {
      oppMent = Number(scouting.mentality.value);
      mentBasis = 'their usual over the last ' + scouting.sampleSize + ' matches (' + scouting.mentality.seenIn + '/' + scouting.sampleSize + ')';
    }
    if (oppMent != null && !isNaN(oppMent)) {
      if (oppMent >= 6 && mentality < 5) {
        mentality += 1;
        reasoning.push('Opponent mentality is ' + MENTALITY[oppMent] + ' — ' + mentBasis + '. Nudged ours up a notch to exploit the space they leave in behind.');
      } else if (oppMent <= 2 && mentality > 3) {
        mentality -= 1;
        reasoning.push('Opponent mentality is ' + MENTALITY[oppMent] + ' — ' + mentBasis + '. Nudged ours down a notch since they\'ll likely sit deep and punish overcommitment.');
      } else {
        reasoning.push('Opponent mentality ' + MENTALITY[oppMent] + ' (' + mentBasis + ') doesn\'t clearly favour a further adjustment.');
      }
    }

    // Attacking style from squad profile: compare average crossing/wing-side players vs technique/passing central players
    const outfield = myXI.lineup.filter(l => l.player && bucketFor(l.player.fp) !== 'GK').map(l => l.player);
    const avgSkill = (key) => outfield.reduce((s, p) => s + (Number(p.skills[key]) || 0), 0) / (outfield.length || 1);
    const cro = avgSkill('cro'), pas = avgSkill('pas'), tec = avgSkill('tec'), lon = avgSkill('lon'), pac = avgSkill('pac');
    // Heuristic (TM publishes no style formula). Each style is scored on the weighted MEAN of
    // the skills it leans on. The old raw sums made two-skill styles beat one-skill styles by
    // construction, so Shortpassing (pas + tec) won for every squad. No clear leader → Balanced.
    const STYLE_SKILLS = { 2: { pac: 1, lon: 0.5 }, 3: { cro: 1, pac: 0.5 }, 4: { pas: 1, tec: 1 }, 5: { lon: 1, pas: 0.5 }, 6: { tec: 1, pas: 0.5 } };
    const styleFit = w => Object.entries(w).reduce((t, [k, x]) => t + avgSkill(k) * x, 0) / Object.values(w).reduce((a, b) => a + b, 0);
    const styleRank = Object.entries(STYLE_SKILLS).map(([k, w]) => [Number(k), styleFit(w)]).sort((a, b) => b[1] - a[1]);
    let style = styleRank[0][1] - styleRank[1][1] >= 0.5 ? styleRank[0][0] : 1;
    reasoning.push('Attacking style "' + ATT_STYLE[style] + '" (own heuristic) — ' + (style === 1
      ? 'no style clearly fits the XI better than another (top two within 0.5 skill points), so Balanced.'
      : 'clearest fit for the XI\'s skills') + ' (Cro ' + cro.toFixed(1) + ', Pas ' + pas.toFixed(1) + ', Tec ' + tec.toFixed(1) + ', Lon ' + lon.toFixed(1) + ', Pac ' + pac.toFixed(1) + ').');
    // Heuristic: attack the way they leak. A style they concede shots from clearly more often
    // (≥8 attacks seen, ≥1.4x their average shot rate) wins if our XI suits it nearly as well.
    const conc = scouting && scouting.conceded;
    if (conc) {
      const tot = Object.values(conc).reduce((t, x) => ({ a: t.a + x.a, sh: t.sh + x.sh }), { a: 0, sh: 0 });
      const avgRate = tot.a ? tot.sh / tot.a : 0;
      const fitOf = Object.fromEntries(styleRank);
      const weak = Object.entries(conc).map(([k, x]) => ({ k: Number(k), a: x.a, g: x.g, rate: x.a ? x.sh / x.a : 0 }))
        .filter(x => x.a >= 8 && avgRate > 0 && x.rate >= 1.4 * avgRate && fitOf[x.k] != null && styleRank[0][1] - fitOf[x.k] <= 1)
        .sort((x, y) => y.rate - x.rate)[0];
      if (weak && weak.k !== style) {
        reasoning.push(`They concede most against ${ATT_STYLE[weak.k]}: ${Math.round(weak.rate * 100)}% of those attacks became shots (${weak.g} goals in ${weak.a}) vs ${Math.round(avgRate * 100)}% overall in their recent games → ${ATT_STYLE[weak.k]} (own heuristic).`);
        style = weak.k;
      }
    }

    // Focus side: which flank to attack down. This is NOT just "which of our sides is
    // stronger" — attacking down our left means attacking INTO their right-back/right-DM
    // area, so what matters is our side strength minus THEIR defensive strength on the
    // side we'd be attacking into. A strong side of ours facing an even stronger opposing
    // flank is not automatically the right side to focus.
    const leftPlayers = myXI.lineup.filter(l => l.player && l.side === 'L');
    const rightPlayers = myXI.lineup.filter(l => l.player && l.side === 'R');
    const leftAvg = leftPlayers.length ? leftPlayers.reduce((s, l) => s + l.effectiveR5, 0) / leftPlayers.length : null;
    const rightAvg = rightPlayers.length ? rightPlayers.reduce((s, l) => s + l.effectiveR5, 0) / rightPlayers.length : null;

    const oppDefSideAvg = (side) => {
      if (oppXI && oppXI.source === 'expected') {
        const vals = oppXI.lineup.filter(l => l.side === side && (l.bucket === 'D' || l.bucket === 'DM')).map(l => l.effectiveR5);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      }
      if (!opponent || !opponent.players) return null;
      const defenders = opponent.players.filter(p => { const b = bucketFor(p.fp); return b === 'D' || b === 'DM'; });
      const vals = defenders.filter(p => sideFor(p.fp) === side).map(p => p._r5).filter(v => typeof v === 'number' && !isNaN(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const oppLeftDef = oppDefSideAvg('L');   // faces our right-side attack
    const oppRightDef = oppDefSideAvg('R');  // faces our left-side attack

    let focus = 1;
    if (leftAvg == null && rightAvg == null) {
      reasoning.push('Focus side: Balanced — no clear left/right players identified in the starting XI.');
    } else {
      // Without both opposing flanks known, compare our own flanks. (The old fallback subtracted
      // each side's own average from itself, so with no opponent data focus was always Balanced.)
      const oppKnown = oppLeftDef != null && oppRightDef != null;
      // Their flank counts half: focus only steers 25% of assist chances to that side (developer
      // quote, /forum/int/general/476927/) and a winger meets his nearest defenders only ~50% of
      // the time (same thread) — so OUR quality on a side matters more than theirs.
      const netLeft = (leftAvg ?? 0) - (oppKnown ? oppRightDef * 0.5 : 0);   // our left attack vs their right defence
      const netRight = (rightAvg ?? 0) - (oppKnown ? oppLeftDef * 0.5 : 0);  // our right attack vs their left defence
      const gap = netLeft - netRight;
      if (Math.abs(gap) > 8) focus = gap > 0 ? 2 : 4; else focus = 1;
      const oppNote = (oppLeftDef != null && oppRightDef != null)
        ? ` Their defensive R5 — left ${oppLeftDef.toFixed(1)}, right ${oppRightDef.toFixed(1)}.`
        : ' (opponent side-by-side defensive strength not available — scout their squad for a sharper read.)';
      reasoning.push('Focus side: ' + FOCUS_SIDE[focus] + '. Our left avg R5 ' + (leftAvg != null ? leftAvg.toFixed(1) : 'n/a')
        + ' vs our right avg R5 ' + (rightAvg != null ? rightAvg.toFixed(1) : 'n/a') + '.' + oppNote);
      if (focus !== 1 && oppLeftDef != null && oppRightDef != null) {
        const attackedSideDef = focus === 2 ? oppRightDef : oppLeftDef;
        const strongerOppSide = oppRightDef > oppLeftDef ? 'right' : 'left';
        if ((focus === 2 && strongerOppSide === 'right') || (focus === 4 && strongerOppSide === 'left')) {
          reasoning.push('Heads up: their ' + strongerOppSide + ' side (defensive R5 ' + attackedSideDef.toFixed(1) + ') is actually their stronger flank — we\'re still favoured there based on current numbers, but it\'s close enough to double-check in-game before committing.');
        }
      }
    }

    const fcDiff = formationCounterAndDifficulty(
      myXI.formation,
      expected && expected.formation ? expected.formation : (scouting && scouting.recentFormation ? scouting.recentFormation : null),
      myAvg,
      oppAvg
    );
    // Evidence from the division's own results (Section 5I) may replace the heuristic picks.
    // The reserves play another league: the first team's division model doesn't apply to them.
    const model = opts && opts.noEvidence ? { ready: false, n: 0 } : fitResultModel();
    const nmNext = getSlice('home') && getSlice('home').data && getSlice('home').data.nextMatch;
    const weAreHome = opts && opts.weAreHome != null ? opts.weAreHome : !!(nmNext && nmNext.home && String(nmNext.home.id) === clubId);
    const savedXI = expected && Array.isArray(expected.xi) && expected.xi.filter(x => x.rec).length >= 9 ? expected.xi : null; // their real XI's rec/routine, straight from the match page
    const oppPlayers = savedXI || (oppXI ? oppXI.lineup.map(l => l.player) : []);
    const predictedGD = predictGoalDiff(model, myXI.lineup.filter(l => l.player).map(l => l.player), oppPlayers, weAreHome);
    let evidence = { n: model.n, ready: model.ready };
    if (predictedGD != null) {
      const context = contextOf(predictedGD);
      const m = evidencePick(model, 'ment', context, mentality), st = evidencePick(model, 'style', context, style);
      if (m.switched) { reasoning.push(`Results evidence: as ${context === 'underdog' ? 'the underdog' : context === 'favourite' ? 'favourite' : 'an even match'}, ${MENTALITY[m.value]} beat ${MENTALITY[mentality]} by ${m.gain.toFixed(2)} goals/match against expectation in this division → ${MENTALITY[m.value]}.`); mentality = m.value; }
      if (st.switched) { reasoning.push(`Results evidence: ${ATT_STYLE[st.value]} beat ${ATT_STYLE[style]} by ${st.gain.toFixed(2)} goals/match against expectation → ${ATT_STYLE[st.value]}.`); style = st.value; }
      evidence = { n: model.n, ready: true, context, coef: model.coef, rmse: model.rmse, teamFactor: model.teamFactor, mentality: m, style: st };
    }
    return { mentality, style, focus, reasoning, counter: fcDiff.counter, difficulty: fcDiff.difficulty, predictedGD, evidence, weAreHome };
  }

  // Conditional orders in TM's own codes (CLAUDE.md "Tactics page"): one event + one score
  // state + one order each, max 5. A sub comes on in a FREE slot of his own line, so he plays
  // his natural position and the shape changes on purpose (extra striker / back five).
  const CO_EVENT = { MINUTE: 1, RED_CARD: 4 };
  const CO_SCORE = { WINNING: 1, LOSING: 3, ANY: 4 };
  const CO_ORDER = { SUB: 1, MENTALITY: 2 };
  // Own heuristic, opponent-aware (said so in the UI): an underdog holds a lead early and chases
  // late, a favourite chases early and protects late; an attacking opponent (6+) means shutting a
  // lead down 5 minutes sooner. [minute, mentality steps] — refine once results data allows.
  const CO_PLAN = {
    underdog: { chase1: [75, 1], chase2: 70, hold1: 65, hold2: 60, red: 2 },
    even: { chase1: [70, 2], chase2: 75, hold1: 75, hold2: 70, red: 2 },
    favourite: { chase1: [60, 2], chase2: 65, hold1: 80, hold2: 75, red: 1 },
  };
  function matchContext(settings, expected, scouting) {
    const d = settings && settings.difficulty && settings.difficulty.label;
    const context = settings && settings.predictedGD != null ? contextOf(settings.predictedGD)
      : /Tough|harder/.test(d || '') ? 'underdog' : /Comfortable|favoured/.test(d || '') ? 'favourite' : 'even';
    const ig = scouting && scouting.inGame;
    return { context, oppMent: expected && expected.mentality ? Number(expected.mentality) : null,
      oppChase: ig && ig.chase, oppHold: ig && ig.hold };
  }
  function buildCondOrders(best, bench, ment, ctx) {
    const base = CO_PLAN[(ctx && ctx.context) || 'even'];
    // Heuristic: when they've been seen pushing forward while behind (our lead), protect it 5'
    // before they usually do; when they shut up shop while ahead, chase before they do.
    const before = (ours, theirs) => theirs && theirs.n >= 2 ? Math.max(45, Math.min(ours, theirs.min - 5)) : ours;
    const c = { ...base, chase1: [before(base.chase1[0], ctx && ctx.oppHold), base.chase1[1]], hold1: before(base.hold1, ctx && ctx.oppChase), hold2: before(base.hold2, ctx && ctx.oppChase) };
    const early = ctx && ctx.oppMent >= 6 ? 5 : 0;
    const used = new Set(best.lineup.map(l => l.slot));
    const freeSlot = prefs => prefs.find(k => !used.has(k)) || null;
    const weakest = buckets => best.lineup.filter(l => l.player && buckets.includes(l.bucket)).sort((a, b) => a.effectiveR5 - b.effectiveR5)[0] || null;
    const benchOf = role => (bench.named.find(b => b.role === role && b.player) || {}).player || null;
    const m = v => Math.max(1, Math.min(7, v));
    const mentality = (min, condId, condPar, to) => ({ eventId: CO_EVENT.MINUTE, eventPar: min, condId, condPar, orderId: CO_ORDER.MENTALITY, par1: to });
    const sub = (min, condId, condPar, inP, off, slot) => (inP && off && slot)
      ? { eventId: CO_EVENT.MINUTE, eventPar: min, condId, condPar, orderId: CO_ORDER.SUB, par1: off.player.id, par2: inP.id, par3: slot, inName: inP.name, outName: off.player.name }
      : null;
    return [
      mentality(c.chase1[0], CO_SCORE.LOSING, -1, m(ment + c.chase1[1])),
      sub(c.chase2, CO_SCORE.LOSING, -2, benchOf('FWD'), weakest(['M', 'DM']), freeSlot(['fc', 'fcl', 'fcr'])) || mentality(c.chase2, CO_SCORE.LOSING, -2, m(ment + 3)),
      mentality(c.hold1 - early, CO_SCORE.WINNING, 1, m(ment - 1)),
      sub(c.hold2 - early, CO_SCORE.WINNING, 2, benchOf('DEF'), weakest(['OM', 'F']), freeSlot(['dc', 'dcl', 'dcr'])) || mentality(c.hold2 - early, CO_SCORE.WINNING, 2, m(ment - 2)),
      { eventId: CO_EVENT.RED_CARD, eventPar: 0, condId: CO_SCORE.ANY, condPar: 0, orderId: CO_ORDER.MENTALITY, par1: m(ment - c.red) },
    ];
  }
  function describeCondOrder(o) {
    return {
      event: o.eventId === CO_EVENT.RED_CARD ? 'Red card (any player)' : `Minute ${o.eventPar}'`,
      score: o.condId === CO_SCORE.ANY ? 'Any score' : (o.condId === CO_SCORE.WINNING ? 'Winning by ' : 'Losing by ') + Math.abs(o.condPar),
      order: o.orderId === CO_ORDER.SUB ? `${o.inName} ON for ${o.outName}, at ${o.par3.toUpperCase()}` : 'Mentality → ' + MENTALITY[o.par1],
    };
  }

  // The whole match plan — what the Tactics view shows AND what Apply posts to /tactics/ —
  // built in one place, so roles and orders can never be picked for a different XI.
  // opts.restBanRisk leaves out players one yellow card from a ban (tactics-page squads only
  // carry that flag) — a per-match call: today's points vs a ban for the next fixture.
  // Shape effects from results: goals vs the strength model's expectation, per shape, other
  // teams only (as settingEffects). The meta flag is grouped too, so its claim gets tested.
  function shapeEffects(model, key) {
    const groups = {};
    model.samples.forEach(x => { const v = x.s[key]; if (v != null && x.team !== clubId) (groups[v] = groups[v] || []).push(x.res); });
    return Object.entries(groups).map(([v, r]) => {
      const mean = r.reduce((a, b) => a + b, 0) / r.length;
      const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, r.length - 1));
      return { value: v, n: r.length, mean, se: sd / Math.sqrt(r.length) };
    }).sort((a, b) => b.mean - a.mean);
  }
  // Formation: the strongest XI, unless a shape within FORMATION_WINDOW of it is worth more.
  // What a shape is worth: its measured effect once n ≥ LEARN_MIN_SAMPLES, else for meta
  // shapes the user/forum-reported edge (META_PRIOR_GOALS — a heuristic prior) — and none at
  // all once the results show the meta isn't ahead.
  // Measured shape effects are shrunk toward 0 by n/(n + SHAPE_SHRINK): results miss the
  // strength model by ±2.3 goals (live, 180 division matches), so 18 lucky matches of 4-5-1
  // (+1.21 ±0.88) mustn't decide the formation on their own. k is a heuristic.
  const FORMATION_WINDOW = 0.03, META_PRIOR_GOALS = 0.15, SHAPE_SHRINK = 30;
  // 3-1-4-2 (DMC, ML, 2 MC, MR): user's pick 2026-11-09, and its group measured best in the za
  // top division (+0.22 ±0.20, n125). Loss cap is a heuristic.
  const META_PREFERRED = '3-1-4-2', META_MAX_LOSS = 0.08;
  function chooseFormation(players, boost) {
    players.forEach(ensureR5);
    const all = Object.keys(FORMATIONS).map(key => pickBestXI(players, key, boost)).sort((a, b) => b.totalRec - a.totalRec);
    const top = all[0];
    const model = fitResultModel();
    const shapeRows = model.ready ? shapeEffects(model, 'shape') : [];
    const metaRows = model.ready ? shapeEffects(model, 'meta') : [];
    const metaYes = metaRows.find(r => r.value === 'true'), metaNo = metaRows.find(r => r.value === 'false');
    const metaTested = metaYes && metaNo && metaYes.n >= LEARN_MIN_SAMPLES && metaNo.n >= LEARN_MIN_SAMPLES;
    const metaN = metaTested ? Math.min(metaYes.n, metaNo.n) : 0;
    const metaEdge = metaTested ? (metaYes.mean - metaNo.mean) * metaN / (metaN + SHAPE_SHRINK) : META_PRIOR_GOALS;
    const worth = r => {
      const sh = shapeOf(r.lineup.map(l => l.slot)), label = shapeLabel(sh), row = shapeRows.find(x => x.value === label);
      if (row && row.n >= LEARN_MIN_SAMPLES) { const v = row.mean * row.n / (row.n + SHAPE_SHRINK); return { v, why: `${label}: ${row.mean >= 0 ? '+' : ''}${row.mean.toFixed(2)} ±${row.se.toFixed(2)} goals vs expectation in ${row.n} division sides (counted as ${v >= 0 ? '+' : ''}${v.toFixed(2)})` }; }
      return isMetaShape(sh) ? { v: Math.max(0, metaEdge), why: metaTested ? `3 DC + 2 FC shapes: ${metaEdge >= 0 ? '+' : ''}${metaEdge.toFixed(2)} goals vs the rest in your division (${metaYes.n} sides)` : 'the 3 DC + 2 FC meta (user/forum-reported — a heuristic until your division has enough results to test it)' } : { v: 0, why: null };
    };
    // User rule (2026-11-08): the meta is the default — 3-2-3-2 first, another meta shape if
    // the squad fits it clearly better — unless it costs over META_MAX_LOSS of raw strength or
    // the division's results clearly show the meta doing worse (auto-learned, 1.5 SE).
    const metaWorse = metaTested && (metaYes.mean - metaNo.mean) < -1.5 * Math.sqrt(metaYes.se ** 2 + metaNo.se ** 2);
    const metas = all.filter(r => isMetaShape(shapeOf(r.lineup.map(l => l.slot))) && r.totalRec >= top.totalRec * (1 - META_MAX_LOSS));
    let chosen = null, chosenWhy = null;
    if (!metaWorse && metas.length) {
      // Among meta shapes within 2% of the strongest one, the best measured (shrunk) result
      // wins; untested shapes fall back to the user's 3-2-3-2, then raw strength.
      const bestMeta = metas[0];
      const close = metas.filter(r => r.totalRec >= bestMeta.totalRec * 0.98).map(r => ({ r, w: worth(r) }));
      const measured = close.filter(x => /division sides/.test(x.w.why || ''));
      chosen = measured.length ? measured.sort((x, y) => y.w.v - x.w.v)[0].r : (close.find(x => x.r.formation === META_PREFERRED) || close[0]).r;
      chosenWhy = `the meta (3 DC, 2 DMC/packed midfield, 2 FC — your default${metaTested ? `; division results: ${metaEdge >= 0 ? '+' : ''}${metaEdge.toFixed(2)} goals vs other shapes` : ''})`;
    }
    const window = all.filter(r => r.totalRec >= top.totalRec * (1 - FORMATION_WINDOW)).map(r => ({ r, w: worth(r) }));
    const pickW = window.sort((a, b) => b.w.v - a.w.v || b.r.totalRec - a.r.totalRec)[0];
    if (!chosen) { chosen = pickW.w.v > 0 ? pickW.r : top; chosenWhy = pickW.w.why; }
    if (metaWorse) chosenWhy = `the meta is clearly behind in your division's results, so the strongest shape is used${chosenWhy ? ' — ' + chosenWhy : ''}`;
    chosen.alternatives = all.filter(r => r !== chosen && r.totalRec >= top.totalRec * 0.99).map(r => r.formation);
    chosen.shape = shapeLabel(shapeOf(chosen.lineup.map(l => l.slot)));
    chosen.why = chosen !== top ? `${chosen.formation} over ${top.formation} (${((1 - chosen.totalRec / top.totalRec) * 100).toFixed(1)}% less raw strength): ${chosenWhy}` : (chosenWhy && isMetaShape(shapeOf(chosen.lineup.map(l => l.slot))) ? `${chosen.formation}: ${chosenWhy}` : null);
    chosen.shapeRows = shapeRows; chosen.metaRows = metaRows;
    return chosen;
  }
  function buildMatchPlan(squad, opponent, scouting, expected, opts) {
    const players = squad.filter(p => (!p.ban || p.ban === '0') && !p.inj && !(opts && opts.restBanRisk && p.banRisk));
    const best = chooseFormation(players, opts && opts.boost);
    const settings = recommendTacticSettings(best, opponent, scouting, expected, opts);
    const starters = best.lineup.filter(l => l.player).map(l => l.player);
    const ids = new Set(starters.map(p => p.id));
    const bench = pickBench(players.filter(p => !ids.has(p.id)), MAX_FOREIGN - starters.filter(isForeign).length);
    const roles = pickSquadRoles(starters);
    const ctx = matchContext(settings, expected, scouting);
    return { players, best, settings, bench, roles, ctx, condOrders: buildCondOrders(best, bench, settings.mentality, ctx) };
  }

  // Tiny inline sparkline for a player's training-intensity trend (last 6 months),
  // condensed
  // to a small trend glyph rather than a full chart, since it's shown per-lineup-slot.
  function trainingSparkline(plot) {
    if (!plot || plot.length < 2) return '';
    const recent = plot.slice(-6).map(Number).filter(v => !isNaN(v));
    if (recent.length < 2) return '';
    const w = 46, h = 14, pad = 2;
    const min = Math.min(...recent), max = Math.max(...recent);
    const range = (max - min) || 1;
    const pts = recent.map((v, i) => {
      const x = pad + (i / (recent.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const trendUp = recent[recent.length - 1] >= recent[0];
    const color = trendUp ? '#5b8fc9' : '#e2726b';
    return `<svg width="${w}" height="${h}" style="vertical-align:middle;margin-left:4px;"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6"/></svg>`;
  }

  /* ============================================================
   *  SECTION 5B — YOUTH FINDER  (age / Rou / SI / R5 talent shortlist)
   *  ------------------------------------------------------------
   *  Builds a shortlist of young talents from every squad we already
   *  have REAL skills for (your own squad + any club you've scanned/
   *  played), scores each with the same R5 engine as everything else,
   *  filters on the criteria below, ranks best-first, and saves the
   *  result so it persists between visits.
   *
   *  >>> TUNE THE FINDER HERE — this is the ONE place to change it. <<<
   *  All four floors are deliberately inclusive by default so nothing
   *  promising is hidden; the list is always ranked best-first and the
   *  standout youngsters are badged automatically. Raise a floor to
   *  narrow the list. Use the new Rou / SI / R5 columns now shown on the
   *  in-game players table to read real values for your league and set
   *  these to whatever "top talent" means at your level.
   * ============================================================ */
  const YOUTH_CRITERIA = {
    maxAge: 20,          // the market lists nobody under 18 (live), so "youth" there is 18-20
    minRoutine: 0,       // routine comes from matches played — near 0 for most youths
    minASI: 30,
    minR5: 10,
    highPotentialGrowth: 1.5,
  };

  // ---- Shared valuation + scoring engine (youth AND senior use the same logic) ----
  // "Sell to Agent" price when a player ISN'T currently on the transfer list (so there's no
  // live bid to show) — see calcSellToAgentPrice (Section 2C) for the confirmed formula and
  // sourcing. This is the game's own instant-sale price, not a heuristic estimate; a live
  // transfer-list bid is still preferred when one is known (see rankSenior/rankYouth below),
  // since a real auction can settle above or below this floor.
  function estimateBankPrice(p) {
    if (p.asi == null) return null;
    const asi = Number(p.asi);
    if (!asi || isNaN(asi)) return null;
    const ageMonths = ageMonthsOf(p);
    if (!ageMonths) return null;
    return calcSellToAgentPrice(asi, ageMonths, bucketFor(p.fp) === 'GK');
  }

  // Is a listed player actually a good buy? Compares the live transfer-list bid against the
  // game's own two confirmed price points (Sell-to-Agent = instant guaranteed floor, Max Sell
  // Price = ceiling you could list him for — SECTION 2C). A bid near/below the Sell-to-Agent
  // floor is a genuine bargain (you could almost instantly resell at that price); a bid at or
  // past Max Price means you'd struggle to ever turn a profit. Age/position/quality still
  // matter (see scoutScore), so this verdict is a price-only sanity check, not the final word.
  function marketVerdict(price, estValue, maxValue) {
    if (price == null || price <= 0) return null;
    const ev = estValue || 0, mv = maxValue || 0;
    if (ev > 0 && price < ev * 0.85) return { label: 'Underpriced', cls: 'goodval', note: 'bid is below his guaranteed Sell-to-Agent price' };
    if (mv > 0 && price > mv * 1.08) return { label: 'Overpriced', cls: 'badval', note: 'bid exceeds his Max Sell Price — hard to profit' };
    if (ev > 0 && mv > 0) return { label: 'Fair', cls: 'mini', note: 'bid sits within his Sell-to-Agent / Max price range' };
    return null;
  }

  // A single composite score used to rank AND tier every shortlist candidate (youth and
  // senior alike), combining every signal you asked for: R5, age, routine, SI, wage, and
  // cost (live bid if listed, else the estimated Bank Price above). R5 dominates since it's
  // the proof-backed overall quality number; SI and routine add a modest bonus for players
  // who are already developed/proven; a youth pool gets an explicit age bonus (younger for
  // the same R5 = more resale/development upside); and cost is a soft efficiency penalty —
  // an expensive player isn't disqualified, just ranked behind an equally-good cheaper one.
  // R5 needs BOTH SI and full skills, and the transfer list only ever shows one at a time
  // (Breakdown = SI, Skills = skills) — most listed players you've only seen once will have
  // SI but no skills yet, so p._r5 is unset. Rather than score them as 0 (which silently
  // buried every such player at the bottom, no matter how good their SI), fall back to a
  // proxy scaled from SI alone: 15 x log10(SI) lands in the same rough numeric range as real
  // R5 (calibrated against a confirmed example: SI 6,272 -> real R5 50.94, proxy 15*log10(6272)
  // = 56.9). It's clearly a rougher signal than real R5 and is only ever used when real R5
  // isn't available yet.
  function effectiveR5(p) {
    if (p._r5 != null && !isNaN(p._r5)) return Number(p._r5);
    const asi = Number(p.asi) || 0;
    return asi > 0 ? 15 * Math.log10(1 + asi) : 0;
  }

  // Skill points implied by SI — the exact inverse of the ASI relation the R5 remainder uses
  // (Section 2B: skillSum = (weight·ASI)^(1/7)). SI 30 ≈ 70 points outfield (avg 5 a skill).
  function skillSumFromSI(asi, isGK) {
    const w = isGK ? 48717927500 : 263533760000;
    return asi > 0 ? Math.pow(w * asi, 1 / 7) : null;
  }
  // Development pace: skill points gained per year since the 16y0m pull, measured from the
  // SI-30 pull baseline (YOUTH_CRITERIA.minASI). A fact about the player so far, not a
  // projection — nothing here guesses how fast he'll grow next.
  function youthPace(p) {
    const isGK = bucketFor(p.fp) === 'GK';
    const sum = skillSumFromSI(Number(p.asi) || 0, isGK), ageMonths = ageMonthsOf(p);
    if (sum == null || !ageMonths) return null;
    const years = Math.max(0.25, (ageMonths - 192) / 12);
    return { sum, pace: (sum - skillSumFromSI(YOUTH_CRITERIA.minASI, isGK)) / years };
  }

  // Youth ranking: development pace, scaled by the scout's growth headroom when a report
  // exists (potential/rec, capped 2×), less a soft cost term. Own heuristic combination.
  function scoutScore(p, opts) {
    opts = opts || {};
    const pace = youthPace(p);
    let score = pace ? pace.pace : effectiveR5(p) / 4;
    const g = opts.growth != null ? Number(opts.growth) : (p.growthMultiple != null ? Number(p.growthMultiple) : null);
    if (g != null && g > 1) score *= Math.min(g, 2);
    const cost = p._cost != null ? p._cost : (p._price || estimateBankPrice(p) || 0);
    if (cost > 0) score -= Math.log10(1 + cost / 1e6) * 2;
    return score;
  }

  // Ranks a pool by scoutScore (best-first) and buckets it into Elite (top 20%) / Strong
  // (next 30%) / filtered out (bottom 50% — dropped entirely, not just deprioritised). This
  // is what turns a raw "everyone who clears a low floor" list into "who's actually worth
  // your attention", and is why an opponent's decent-but-unremarkable youngster no longer
  // sits at the top of the list just because they were the most recently scanned squad.
  function tierAndFilter(rankedByScore) {
    const n = rankedByScore.length;
    const eliteCut = Math.max(1, Math.ceil(n * 0.2));
    const strongCut = Math.max(eliteCut, Math.ceil(n * 0.5));
    return rankedByScore
      .map((p, i) => ({ ...p, _tier: i < eliteCut ? 'elite' : (i < strongCut ? 'strong' : 'out') }))
      .filter(p => p._tier !== 'out');
  }

  // Both shortlists exist to answer "who's signable" — so the pool is ONLY players you've
  // actually seen on the /transfer/ page (accumulated into transferSeen as you browse it; see
  // parseTransferListLive, Section 2). This deliberately excludes your own squad, scanned
  // clubs and the cached next-opponent squad: those aren't for sale, and including them was
  // exactly why an opponent's youngster could show up at the top of a "who should I buy"
  // list. If you want a specific club's players considered, search for them on the transfer
  // page (or wait for them to be listed) so they land in transferSeen like everyone else.
  function collectYouthPool() {
    const seen = {};
    const add = (p, srcLabel) => {
      if (!p || p.id == null) return;
      const key = String(p.id);
      if (seen[key]) return;
      const fixed = { ...p, fp: displayFp(p.fp) };
      if (fixed.fp !== p.fp) delete fixed._r5; // R5 was computed for the misread position
      ensureR5(fixed);
      seen[key] = { ...fixed, _src: srcLabel };
    };
    const transferSeen = getSlice('transferSeen');
    if (transferSeen && transferSeen.data) Object.values(transferSeen.data).forEach(p => add(p, 'Transfer list'));
    return Object.values(seen);
  }

  // Full R5 needs skills, but browsing the transfer list only ever gives you SI (Breakdown)
  // OR skills (Skills view) per visit, never both. Rather than blasting /ajax/tooltip.ajax.php
  // (Section 4) for the entire seen-pool speculatively, this only fetches R5/Routine/SI for
  // players already on a built shortlist (ids passed in) — keeping request volume tied to
  // what you're actually deciding on, not everyone you've ever glanced at.
  const FULL_STATS_FETCH_CAP = 60;
  async function fetchFullStatsForPool(ids, onProgress) {
    const c = loadCache();
    const store = (c.transferSeen && c.transferSeen.data) || {};
    const incomplete = ids.filter(id => store[id] && isNaN(transferR5(store[id]))).slice(0, FULL_STATS_FETCH_CAP);
    let done = 0;
    for (const id of incomplete) {
      done++;
      onProgress && onProgress(done, incomplete.length, store[id].name);
      try {
        const raw = await fetchPlayerTooltip(id);
        const norm = normaliseTooltipPlayer(raw);
        if (norm) {
          const prev = store[id];
          store[id] = {
            ...prev,
            name: norm.name || prev.name,
            fp: norm.fp || prev.fp,
            age: norm.age != null ? norm.age : prev.age,
            asi: norm.asi != null ? norm.asi : prev.asi,
            routine: norm.routine != null ? norm.routine : prev.routine,
            skills: { ...(prev.skills || {}), ...norm.skills },
          };
        }
      } catch (e) { console.warn('TM Advisor: full-stats fetch failed for player', id, e); }
    }
    const cc = loadCache();
    cc.transferSeen = { t: now(), data: store };
    saveCache(cc);
    const stillIncomplete = ids.filter(id => store[id] && isNaN(transferR5(store[id]))).length;
    return { fetched: incomplete.length, remaining: stillIncomplete, totalPool: ids.length };
  }

  // Apply the YOUTH_CRITERIA floors. Age is REQUIRED and must be known — we never guess an
  // age, so a candidate with no age is excluded rather than assumed young.
  function filterYouth(pool, criteria) {
    const c = criteria || YOUTH_CRITERIA;
    return pool.filter(p =>
      p.age != null && !isNaN(p.age) && p.age <= c.maxAge &&
      (p.routine == null || Number(p.routine) >= c.minRoutine) &&
      (p.asi == null || Number(p.asi) >= c.minASI) &&
      (p._r5 == null || Number(p._r5) >= c.minR5)
    );
  }

  // User-tunable filters shared by both shortlists — a max cost (since your affordable budget
  // changes as cash comes in, this MUST be a live input, not a hardcoded constant) and a
  // foreign-player toggle. OFF matches TM's own transfer-list default (no /for/ in the URL):
  // home nation ONLY, which means a player whose flag we couldn't parse does NOT pass through
  // — an unconfirmed nationality is not a confirmed home-nation player. ON matches TM's /for/
  // URL: everyone, home and foreign alike. Persisted per shortlist so they survive a reload.
  const SHORTLIST_PREFS_KEY = { youth: 'tmAdvisor_youthPrefs', senior: 'tmAdvisor_seniorPrefs' };
  function loadShortlistPrefs(which) {
    try { return JSON.parse(localStorage.getItem(SHORTLIST_PREFS_KEY[which])) || {}; } catch (e) { return {}; }
  }
  function saveShortlistPrefs(which, prefs) {
    try { localStorage.setItem(SHORTLIST_PREFS_KEY[which], JSON.stringify(prefs)); } catch (e) {}
  }
  // If the user hasn't typed an explicit cap, default to what Spending Guidance (Section 5D)
  // says is actually affordable right now — not "no limit". There's no point shortlisting a
  // player you can't afford; a blank field shouldn't silently mean "show everyone regardless
  // of price," it should mean "use my current budget." An explicit number always overrides it.
  function effectiveMaxCost(prefs) {
    if (prefs && prefs.maxCost != null) return Number(prefs.maxCost);
    const budget = budgetGuidance();
    return budget ? budget.recommendedMax : null;
  }

  function applyUserPrefs(list, prefs) {
    prefs = prefs || {};
    const maxCost = effectiveMaxCost(prefs);
    return list.filter(p => {
      // Toggle OFF must mean "home nation only" — matching TM's own transfer-list default
      // (no /for/ in the URL). That means a player whose nationality we couldn't read is
      // NOT automatically included: an unconfirmed nationality is not a confirmed home-nation
      // player. (The previous version let unknown-nationality players through either way,
      // which is why the toggle looked broken — most rows have `nat` unset.)
      if (prefs.includeForeign === false) {
        if (!MY_COUNTRY || p.nat !== MY_COUNTRY) return false;
      }
      if (maxCost) {
        const cost = p._cost != null ? p._cost : (p._price != null ? p._price : p._estValue);
        if (cost != null && cost > maxCost) return false;
      }
      return true;
    });
  }

  // Rank by the composite scoutScore (youth-weighted), tier into Elite/Strong (filtering out
  // the rest), and tag high-potential growth from scout reports where available. `scoutById`
  // maps a player id -> its scout report.
  function rankYouth(candidates, scoutById, criteria, prefs) {
    const c = criteria || YOUTH_CRITERIA;
    const withMeta = candidates.map(p => {
      const sc = scoutById ? scoutById[String(p.id)] : null;
      const growth = sc && sc.growthMultiple != null ? sc.growthMultiple : (p.growthMultiple != null ? p.growthMultiple : null);
      const cost = p.bid ? parseMoney(p.bid) : null;
      const estValue = estimateBankPrice(p);
      const ageMonths = ageMonthsOf(p);
      const maxValue = (p.asi != null && ageMonths) ? calcMaxSellPrice(Number(p.asi), ageMonths, estValue) : null;
      return {
        ...p, _cost: cost, _price: cost, _estValue: estValue, _maxValue: maxValue,
        _highPotential: growth != null && growth >= c.highPotentialGrowth,
        _growth: growth, _potential: sc ? sc.potential : (p.potential != null ? p.potential : null),
      };
    });
    const filtered = applyUserPrefs(withMeta, prefs);
    const scored = filtered.map(p => ({ ...p, _score: scoutScore(p, { youth: true, growth: p._growth }) }));
    scored.sort((a, b) => b._score - a._score);
    return tierAndFilter(scored).map(p => ({ ...p, _topTalent: p._tier === 'elite' }));
  }

  // Persist the compiled shortlist so it survives page navigation. De-duped by id; stores a
  // compact snapshot (enough to render + link) rather than the full skill blob.
  function saveYouthShortlist(rankedList) {
    const compact = rankedList.map(p => ({
      id: p.id, name: p.name, age: p.age, fp: p.fp,
      r5: p._r5 != null ? Number(Number(p._r5).toFixed(1)) : null,
      asi: p.asi != null ? Number(p.asi) : null,
      routine: p.routine != null ? Number(Number(p.routine).toFixed(1)) : null,
      potential: p._potential != null ? p._potential : null,
      growth: p._growth != null ? Number(Number(p._growth).toFixed(2)) : null,
      pace: youthPace(p) ? Number(youthPace(p).pace.toFixed(1)) : null,
      xiGain: p._xi && p._xi.gain >= SENIOR_CRITERIA.minXiGain ? Number(p._xi.gain.toFixed(1)) : null, xiSlot: p._xi ? p._xi.slot : null,
      price: p._price || null, estValue: p._estValue || null, maxValue: p._maxValue || null,
      tier: p._tier, topTalent: !!p._topTalent, highPotential: !!p._highPotential,
      src: p._src || null, addedAt: now(),
    }));
    setSlice('youthShortlist', compact);
    return compact;
  }

  // One-call convenience used by the UI button: gather -> filter -> rank -> save.
  function buildYouthShortlist(prefs) {
    const pool = collectYouthPool();
    const scout = getSlice('scoutReports');
    const scoutById = {};
    if (scout && scout.data) scout.data.forEach(r => { if (r.id) scoutById[String(r.id)] = r; });
    const youth = filterYouth(pool, YOUTH_CRITERIA);
    const ctx = ownSquadForImpact();
    if (ctx) youth.forEach(c => { if (c._r5 != null && !isNaN(c._r5) && c.skills && Object.keys(c.skills).length >= 11) c._xi = xiImpact(c, ctx); });
    const ranked = rankYouth(youth, scoutById, YOUTH_CRITERIA, prefs || loadShortlistPrefs('youth'));
    saveYouthShortlist(ranked);
    return { ranked, poolSize: pool.length };
  }

  /* ------------------------------------------------------------
   *  SECTION 5C — SENIOR TRANSFER TARGETS  (position-need scouting)
   *  ------------------------------------------------------------
   *  Companion to the Youth Finder above, but for signable seniors: instead
   *  of an age ceiling, a candidate must be a genuine upgrade over the
   *  weakest starter in their own position bucket in YOUR best XI (see
   *  Section 5, bestFormation) by at least SENIOR_CRITERIA.minEdgePct.
   *  Same pool (transfer list you've browsed, scanned clubs, scouted
   *  opponents), same R5 engine, no separate valuation invented.
   *
   *  FOREIGN PLAYERS: TM's tactics page allows at most 5 foreigners across XI +
   *  bench (js/tactics_v2.js) — enforced by pickBestXI/pickBench (MAX_FOREIGN),
   *  so a foreign signing only shows a gain while there's room for him.
   * ============================================================ */
  // maxAge default of 27 is straight from TM's own user guide (Player Development): base
  // training tapers to its TI-1 floor by 26-27, and "from age 28 and onwards player skills
  // begin to deteriorate, with increasing speed for every year that passes" — 28 is the
  // game's own stated start of decline, so 27 is the last age still confirmed pre-decline.
  // It's exposed as a live, user-tunable input (like Max cost) since some managers may want
  // a short-term "win now" signing past that age — the wiki number is just a sane default.
  const SENIOR_CRITERIA = {
    minAge: YOUTH_CRITERIA.maxAge + 1, // seniors = anyone the youth list doesn't already cover
    maxAgeDefault: 27,   // last age confirmed pre-decline per TM's own Player Development guide
    minEdgePct: 5,       // must beat your weakest same-bucket starter's R5 by at least this %
    minEdgePctSI: 15,     // SI-only fallback needs a bigger edge — it's a cruder signal than R5
    minR5Fallback: 20,   // used only when we don't have a same-bucket starter to compare against
    // XI-impact gates (own heuristics, in summed slot-R5 points of your best XI):
    minXiGain: 1,        // he must make your best XI better at all
    eliteXiGain: 5,      // a clear upgrade on whoever he replaces
  };

  // What a signing does to YOUR best XI: rerun the optimal XI (Section 5) with him added.
  // One number covers his position, your current depth there and TM's position penalty —
  // a D/DM L who'd be your best left-back is judged as one, not as a DM.
  const firstTeamOnly = list => (list || []).filter(p => !p.club || String(p.club) === clubId);
  function ownSquadForImpact() {
    const sl = getSlice('players');
    if (!sl || !sl.data || !sl.data.length) return null;
    const squad = firstTeamOnly(sl.data).map(p => ({ ...p }));
    return { squad, base: bestFormation(squad) };
  }
  function xiImpact(candidate, ctx) {
    const c = { ...candidate, id: 'cand-' + candidate.id };
    const withHim = bestFormation(ctx.squad.concat([c]));
    const spot = withHim.lineup.find(l => l.player === c);
    if (!spot) return { gain: 0, slot: null, replaces: null };
    const ids = new Set(withHim.lineup.filter(l => l.player).map(l => String(l.player.id)));
    const out = ctx.base.lineup.find(l => l.player && !ids.has(String(l.player.id)));
    return { gain: withHim.totalRec - ctx.base.totalRec, slot: spot.slot, replaces: out ? out.player.name : null };
  }

  // Weakest starting R5 per position bucket (GK/D/DM/M/OM/F) in your OWN best XI right now —
  // the bar a transfer target has to clear. Reuses the exact same formation/penalty engine
  // Tactics uses (Section 5), so "better than my team" means the same thing everywhere in
  // this script, not a separately-invented threshold.
  function ownWeakestByBucket() {
    const playersSlice = getSlice('players');
    if (!playersSlice || !playersSlice.data || !playersSlice.data.length) return null;
    const players = playersSlice.data.map(p => ({ ...p }));
    players.forEach(ensureR5);
    const best = bestFormation(players);
    const map = {};
    best.lineup.forEach(l => {
      if (!l.player) return;
      const b = l.bucket;
      if (map[b] == null || l.effectiveR5 < map[b]) map[b] = l.effectiveR5;
    });
    return map;
  }

  // Same idea as ownWeakestByBucket, but on raw SI — needed because most transfer-list
  // players will only have SI captured (Breakdown view), not full skills, so R5 isn't
  // computable for them yet. Comparing SI directly lets a genuinely better player still
  // surface even before you've flipped to the Skills view for them.
  function ownWeakestSIByBucket() {
    const playersSlice = getSlice('players');
    if (!playersSlice || !playersSlice.data || !playersSlice.data.length) return null;
    const players = playersSlice.data.map(p => ({ ...p }));
    players.forEach(ensureR5);
    const best = bestFormation(players);
    const map = {};
    best.lineup.forEach(l => {
      if (!l.player || l.player.asi == null) return;
      const b = l.bucket;
      const si = Number(l.player.asi);
      if (map[b] == null || si < map[b]) map[b] = si;
    });
    return map;
  }

  // A candidate passes if EITHER signal shows a genuine upgrade over your weakest same-bucket
  // starter: real R5 (preferred, when both SI and skills have been captured) OR raw SI alone
  // (when only Breakdown has been seen) — R5 needing skills you may not have captured yet
  // must never silently exclude someone whose SI already shows they're clearly better.
  function filterSenior(pool, weakestMap, weakestSIMap, criteria) {
    const c = criteria || SENIOR_CRITERIA;
    const maxAge = c.maxAge != null ? c.maxAge : c.maxAgeDefault;
    return pool.filter(p => {
      if (p.age == null || isNaN(p.age) || p.age < c.minAge) return false;
      if (maxAge != null && p.age > maxAge) return false;
      const bucket = bucketFor(p.fp);
      const r5Known = p._r5 != null && !isNaN(p._r5);
      const siKnown = p.asi != null && !isNaN(Number(p.asi)) && Number(p.asi) > 0;
      if (!r5Known && !siKnown) return false;
      if (r5Known) {
        if (p._xi) return p._xi.gain >= c.minXiGain;
        const baseline = weakestMap && weakestMap[bucket] != null ? weakestMap[bucket] : null;
        const threshold = baseline != null ? baseline * (1 + c.minEdgePct / 100) : c.minR5Fallback;
        if (p._r5 >= threshold) return true;
      }
      if (siKnown) {
        const baseSI = weakestSIMap && weakestSIMap[bucket] != null ? weakestSIMap[bucket] : null;
        if (baseSI != null && Number(p.asi) >= baseSI * (1 + c.minEdgePctSI / 100)) return true;
      }
      return false;
    }).map(p => ({
      ...p,
      _baseline: weakestMap ? weakestMap[bucketFor(p.fp)] : null,
      _r5Known: p._r5 != null && !isNaN(p._r5),
    }));
  }

  // Rank by the same composite scoutScore as the youth list (R5, SI, routine, age, cost —
  // see Section 5B), using the live transfer-list bid as cost when listed, otherwise falling
  // back to the estimated Bank Price. Then tier into Elite/Strong and drop the rest — this is
  // what stops "merely eligible" candidates (e.g. a scanned opponent's squad-filler who just
  // barely clears the R5 baseline) from cluttering the list.
  function rankSenior(candidates, prefs) {
    const withCost = candidates.map(p => {
      const bidPrice = p.bid ? parseMoney(p.bid) : null;
      const estValue = estimateBankPrice(p);
      const ageMonths = ageMonthsOf(p);
      const maxValue = (p.asi != null && ageMonths) ? calcMaxSellPrice(Number(p.asi), ageMonths, estValue) : null;
      return { ...p, _price: bidPrice, _estValue: estValue, _maxValue: maxValue, _cost: bidPrice != null ? bidPrice : estValue };
    });
    const filtered = applyUserPrefs(withCost, prefs);
    // Known XI impact first, biggest gain first; SI-only candidates (skills not seen yet) after,
    // by SI. Tiers are the gain itself (SENIOR_CRITERIA), not a share of the list.
    const gainOf = p => p._xi ? p._xi.gain : -Infinity;
    return filtered.sort((a, b) => (gainOf(b) - gainOf(a)) || ((Number(b.asi) || 0) - (Number(a.asi) || 0)))
      .map(p => ({ ...p, _tier: p._xi ? (p._xi.gain >= SENIOR_CRITERIA.eliteXiGain ? 'elite' : 'strong') : 'skills' }));
  }

  function saveSeniorShortlist(rankedList) {
    const compact = rankedList.map(p => ({
      id: p.id, name: p.name, age: p.age, fp: p.fp,
      r5: p._r5 != null ? Number(Number(p._r5).toFixed(1)) : null,
      r5Known: !!p._r5Known,
      baseline: p._baseline != null ? Number(Number(p._baseline).toFixed(1)) : null,
      asi: p.asi != null ? Number(p.asi) : null,
      routine: p.routine != null ? Number(Number(p.routine).toFixed(1)) : null,
      price: p._price || null, estValue: p._estValue || null, maxValue: p._maxValue || null, wage: p.wage || null,
      tier: p._tier, nat: p.nat || null,
      xiGain: p._xi ? Number(p._xi.gain.toFixed(1)) : null, xiSlot: p._xi ? p._xi.slot : null, replaces: p._xi ? p._xi.replaces : null,
      src: p._src || null, addedAt: now(),
    }));
    setSlice('seniorShortlist', compact);
    return compact;
  }

  function buildSeniorShortlist(prefs) {
    const p = prefs || loadShortlistPrefs('senior');
    const pool = collectYouthPool(); // same multi-source pool; name is historical, content is all ages
    const weakestMap = ownWeakestByBucket();
    const weakestSIMap = ownWeakestSIByBucket();
    const criteria = { ...SENIOR_CRITERIA, maxAge: p.maxAge != null ? p.maxAge : SENIOR_CRITERIA.maxAgeDefault };
    const ctx = ownSquadForImpact();
    if (ctx) pool.forEach(c => { if (c._r5 != null && !isNaN(c._r5) && c.skills && Object.keys(c.skills).length >= 11) c._xi = xiImpact(c, ctx); });
    const ranked = rankSenior(filterSenior(pool, weakestMap, weakestSIMap, criteria), p);
    saveSeniorShortlist(ranked);
    return { ranked, poolSize: pool.length, weakestMap, maxAge: criteria.maxAge };
  }

  // Buy lists (own heuristics, labelled in the UI), per team: first team and reserves.
  // Every candidate must be an upgrade TWICE: to that team's best XI today, and still a year
  // from now with both him and your squad projected forward (projectPlayer) — so a player who
  // only looks good because he's peaked, or who your own youngsters will outgrow, drops out.
  // Best buys rank by now + next year; value buys rank that by price. Reserves exist to develop
  // youths (≤ RESERVE_MAX_AGE), so next year counts double there. One budget (Spending
  // Guidance) for both; the bid is current — an auction can still go higher.
  const BUY_LIST_LEN = 8;
  const BUY_VALUE_MIN_SCORE = 8;
  const MIN_LINEUP_R5 = 75; // user: no starter below R5 75
  const BUY_OVERPRICE = 1.3; // heuristic: more than 30% over the market rate for his R5 and age is out // heuristic: value buys must still be a real upgrade, not +1 for nothing
  const PROJECT_YEARS = 1;
  // Growth projection, from YOUR club's measured training (so it reflects your training
  // ground, academy and custom plans): players_ar `plot` is each player's weekly TI; TM's
  // guide (Player Development): "one point of TI typically equals 0.1 skill point"; a season —
  // one year of age — is 12 training weeks ("TM - Squad Viewer": SEASON_DAYS = 84).
  // Talent scales it: TI is set by hidden talent and age (same guide), and talent shows in a
  // player's career pace (youthPace) relative to your own players of the same age.
  const TI_SKILL = 0.1, SEASON_WEEKS = 12;
  const GROWTH_BANDS = [[15, 18], [18, 20], [20, 22], [22, 24], [24, 26], [26, 28], [28, 30], [30, 99]];
  // Fallback TI per band (own heuristic) shaped by the same guide — base TI doubled 15-18,
  // dealt out to 26, TI 1 at 27, decline from 28 — used where your squad has nobody that age.
  const GROWTH_FALLBACK_TI = [20, 12, 6, 4, 3, 2, 1, -2];
  const bandOf = age => GROWTH_BANDS.findIndex(([lo, hi]) => age >= lo && age < hi);
  const median = xs => { const v = xs.filter(x => x != null && isFinite(x)).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const recentTi = p => { const v = (p.plot || []).map(Number).filter(x => !isNaN(x)).slice(-6); return v.length >= 3 ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  let _growth = null, _growthKey = null;
  function clubGrowth() {
    const sl = getSlice('players');
    const key = sl ? sl.t : null;
    if (_growth && _growthKey === key) return _growth;
    const players = (sl && sl.data) || [];
    const bands = GROWTH_BANDS.map((_, i) => {
      // Fillers (SI < 1000 veterans parked in the reserves) say nothing about training.
      const ps = players.filter(p => bandOf(Number(p.age)) === i && Number(String(p.asi).replace(/,/g, '')) >= 1000 && recentTi(p) != null);
      const pace = median(ps.map(p => { const y = youthPace(p); return y && y.pace; }));
      return { n: ps.length, ti: ps.length >= 2 ? median(ps.map(recentTi)) : null, pace };
    });
    _growth = { bands }; _growthKey = key;
    return _growth;
  }
  // This season's TI for ANY player, ours or not ("TM - Squad Viewer" / "TM - Shortlist"):
  // TM sets the wage from the SI at season start, so skill sum(SI now) − skill sum(wage /
  // 15.8079) is what he has trained since; ÷ training weeks so far = TI per week. Season
  // calendar: first training 2023-01-16 23:00 UTC, 84-day seasons, wages under 30k unusable.
  const WAGE_RATE = 15.8079, TRAINING1 = Date.UTC(2023, 0, 16, 23), SEASON_DAYS = 84;
  function seasonWeek() {
    let day = (now() - TRAINING1) / 864e5;
    while (day > SEASON_DAYS - 16 / 24) day -= SEASON_DAYS;
    const w = Math.floor(day / 7) + 1;
    return w <= 0 ? 12 : w;
  }
  function wageTi(p) {
    const asi = Number(String(p.asi || '').replace(/,/g, '')), wage = Number(p.wage) || 0;
    if (!asi || wage <= 30000) return null;
    const isGK = bucketFor(p.fp) === 'GK';
    const a = skillSumFromSI(asi, isGK), b = skillSumFromSI(wage / WAGE_RATE, isGK);
    if (a == null || b == null) return null;
    const ti = Math.round((a - b) * 10) / seasonWeek();
    return isFinite(ti) && ti > -20 && ti < 60 ? ti : null;
  }
  // Skill points a player should gain over the coming season at `age`.
  function seasonGain(p, age, own) {
    const g = clubGrowth(), i = bandOf(age), band = g.bands[i] || {};
    const ti = own != null ? own : band.ti != null ? band.ti : GROWTH_FALLBACK_TI[i] || 0;
    let talent = 1;
    if (own == null && ti > 0 && band.pace) { const y = youthPace(p); if (y && y.pace > 0) talent = Math.max(0.5, Math.min(2, y.pace / band.pace)); }
    return ti * TI_SKILL * SEASON_WEEKS * talent;
  }
  // TM guide, "Allocation of TI" (hill-shaped): per TI a skill rises 0.1 (+50% chance of
  // another 0.1) below 5, 0.1 at 5-14.9, 0.1 half the time at 15-17.9, 40% of the time at 18-20.
  const trainEff = v => v < 5 ? 1.5 : v < 15 ? 1 : v < 18 ? 0.5 : 0.4;
  function addTrained(v, pts) {
    let x = v, rem = pts;
    while (rem > 1e-6 && x < 20) { const step = Math.min(rem, 0.25); x += step * trainEff(x); rem -= step; }
    return Math.min(20, x);
  }
  const SKILL_KEYS_GK = ['str', 'sta', 'pac', 'han', 'one', 'ref', 'ari', 'jum', 'com', 'kic', 'thr'];
  const SKILL_KEYS_OUT = ['str', 'sta', 'pac', 'mar', 'tac', 'wor', 'pos', 'pas', 'cro', 'tec', 'hea', 'fin', 'lon', 'set'];
  // Projects a player `years` seasons ahead; your own players use their own measured TI for the
  // first season. Points spread evenly over his not-yet-20 skills (TM's real split depends on
  // hidden peaks — an approximation), SI follows from the new skill sum.
  function projectPlayer(p, years) {
    const age0 = Number(p.age) || 0, isGK = bucketFor(p.fp) === 'GK';
    if (!p.skills || !p.asi) return p;
    const sum0 = skillSumFromSI(Number(String(p.asi).replace(/,/g, '')), isGK);
    if (!sum0) return p;
    let gain = 0;
    const tiNow = recentTi(p) != null ? recentTi(p) : wageTi(p); // measured beats estimated
    for (let y = 0; y < years; y++) gain += seasonGain(p, age0 + y, y === 0 ? tiNow : null);
    if (gain > 0 && p.scout && p.scout.dev && DEV_LEFT[p.scout.dev] != null) gain *= DEV_LEFT[p.scout.dev];
    const out = { ...p, age: age0 + years };
    if (Math.abs(gain) < 0.05) return out;
    const keys = (isGK ? SKILL_KEYS_GK : SKILL_KEYS_OUT).filter(k => p.skills[k] != null && (gain > 0 ? Number(p.skills[k]) < 20 : true));
    if (!keys.length) return out;
    out.skills = { ...p.skills };
    let applied = 0;
    keys.forEach(k => { const v0 = Number(out.skills[k]); const v1 = gain > 0 ? addTrained(v0, gain / keys.length) : Math.max(1, v0 + gain / keys.length); out.skills[k] = v1; applied += v1 - v0; });
    // A scouted peak caps that group's skill sum ("TM - Players Scout" v9 peak sums); TM
    // reassigns training on peaked skills elsewhere, but we simply stop at the cap.
    if (gain > 0 && p.scout && p.scout.peaks) {
      const groups = isGK ? { phy: ['str', 'sta', 'pac', 'jum'], tac: ['one', 'ari', 'com'], tec: ['han', 'ref', 'kic', 'thr'] }
        : { phy: ['str', 'sta', 'pac', 'hea'], tac: ['mar', 'tac', 'wor', 'pos'], tec: ['pas', 'cro', 'tec', 'fin', 'lon', 'set'] };
      Object.entries(p.scout.peaks).forEach(([g, lvl]) => {
        const cap = PEAK_SUMS[isGK ? 'gk' : 'out'][g][lvl - 1];
        const ks = groups[g], sumNew = ks.reduce((t, k) => t + Number(out.skills[k] || 0), 0), sumOld = ks.reduce((t, k) => t + Number(p.skills[k] || 0), 0);
        if (cap == null || sumNew <= cap || sumNew <= sumOld) return;
        const keep = Math.max(0, (cap - sumOld) / (sumNew - sumOld));
        ks.forEach(k => { const v0 = Number(p.skills[k] || 0), v1 = Number(out.skills[k] || 0); const v = v0 + (v1 - v0) * keep; applied -= v1 - v; out.skills[k] = v; });
      });
    }
    const w = isGK ? 48717927500 : 263533760000;
    out.asi = Math.round(Math.pow(Math.max(1, sum0 + applied), 7) / w); // inverse of skillSumFromSI
    out.plot = null; // measured TI belongs to today's player, not the projected one
    delete out._r5; delete out._slotR5;
    ensureR5(out);
    return out;
  }
  // R5 at his last pre-decline age (27: TI drops to 1 then, decline from 28 — TM guide).
  const PEAK_AGE = 27;
  // Horizon = the Max age you buy up to (user): "R5 at 30" for a 30 cap, decline included —
  // beyond 27 your club's measured TI (negative from ~30) takes over. Default PEAK_AGE.
  function projectionAge() {
    const a = Number(loadShortlistPrefs('senior').maxAge);
    return a >= 18 && a <= 40 ? a : PEAK_AGE;
  }
  function peakProjection(p, toAge) {
    const age = Number(p.age) || 0, target = toAge || projectionAge();
    if (age < 15 || age >= target) return null; // unknown age would project a career from birth
    const q = projectPlayer({ ...p }, Math.max(1, Math.round(target - age)));
    return q && q._r5 != null ? Number(Number(q._r5).toFixed(1)) : null;
  }
  function teamContext(squad) {
    if (!squad || squad.length < 11) return null;
    const now0 = squad.map(p => ({ ...p })), next = squad.map(p => projectPlayer({ ...p }, PROJECT_YEARS));
    return { now: { squad: now0, base: bestFormation(now0) }, next: { squad: next, base: bestFormation(next) } };
  }
  function solve3(A, y) { // Gaussian elimination for the 3x3 normal equations
    const M = A.map((r, i) => [...r, y[i]]);
    for (let i = 0; i < 3; i++) {
      const piv = M.slice(i).reduce((bi, r, k) => Math.abs(r[i]) > Math.abs(M[bi][i]) ? i + k : bi, i);
      [M[i], M[piv]] = [M[piv], M[i]];
      if (Math.abs(M[i][i]) < 1e-12) return null;
      for (let k = 0; k < 3; k++) if (k !== i) { const f = M[k][i] / M[i][i]; for (let j = i; j < 4; j++) M[k][j] -= f * M[i][j]; }
    }
    return M.map((r, i) => r[3] / r[i]);
  }
  function ownSquadsWithHistory() {
    const own = (getSlice('ownSquads') || {}).data || {};
    const all = ((getSlice('players') || {}).data) || [];
    const byId = Object.fromEntries(all.map(p => [String(p.id), p]));
    const scouted = (getSlice('scoutSummaries') || {}).data || {};
    // players_get_select has no wage or TI history; the Players page (players_ar) has both.
    const withPlot = list => (list || []).map(p => { const x = byId[String(p.id)] || {}; return { ...p, plot: p.plot || x.plot || null, wage: p.wage || x.wage || null, scout: p.scout || scouted[String(p.id)] || null }; });
    return { A: withPlot(own.A), B: withPlot(own.B) };
  }

  // Sell recommendations (own heuristics, labelled in the UI). Never sold: first-team starters
  // he'd be missed from, the bench, youths projected to reach first-team level by PEAK_AGE, and
  // youths starting for the reserves. Everyone else is surplus, least future use first — the
  // agent price falls with age^2.5 (calcSellToAgentPrice), so ageing surplus loses value
  // every season it's kept. Squad floors keep both teams able to field a matchday 16.
  const SELL_MIN_A = 18, SELL_MIN_B = 16, SELL_MIN_GK = 2;
  function buildSellList() {
    const own = ownSquadsWithHistory();
    if (!own.A.length) return null;
    const A = own.A.filter(p => p.skills), B = own.B.filter(p => p.skills);
    const ctx = teamContext(A);
    if (!ctx) return null;
    const base = ctx.now.base, starters = new Set(base.lineup.filter(l => l.player).map(l => String(l.player.id)));
    const bench = new Set(pickBench(A.filter(p => !starters.has(String(p.id)))).named.filter(b => b.player).map(b => String(b.player.id)));
    const bXi = B.length >= 11 ? new Set(bestFormation(B.map(p => ({ ...p })), p => (Number(p.age) || 99) < RESERVE_MAX_AGE + 1 ? RESERVE_YOUTH_BOOST : 1).lineup.filter(l => l.player).map(l => String(l.player.id))) : new Set();
    const bar = Math.max(MIN_LINEUP_R5, Math.min(...base.lineup.filter(l => l.player).map(l => l.effectiveR5)));
    const rows = A.map(p => ({ p, team: 'A' })).concat(B.map(p => ({ p, team: 'B' }))).map(({ p, team }) => {
      const id = String(p.id), age = Number(p.age) || 0, isGK = bucketFor(p.fp) === 'GK';
      const r5 = Number(ensureR5(p)) || 0, peak = peakProjection(p), ceiling = Math.max(r5, peak || 0);
      const ageM = ageMonthsOf(p), sta = p.asi && ageM ? calcSellToAgentPrice(Number(String(p.asi).replace(/,/g, '')), ageM, isGK) : null;
      const q = projectPlayer({ ...p }, 1), staNext = q.asi && ageM ? calcSellToAgentPrice(Number(q.asi), ageM + 12, isGK) : null;
      const ti = recentTi(p);
      let keep = null;
      if (team === 'A' && starters.has(id)) {
        const without = bestFormation(A.filter(x => String(x.id) !== id).map(x => ({ ...x })));
        const loss = base.totalRec - without.totalRec;
        if (loss >= SENIOR_CRITERIA.minXiGain) keep = `starts (${loss.toFixed(1)} R5 points lost without him)`;
      }
      if (!keep && team === 'A' && bench.has(id)) keep = 'on the bench';
      if (!keep && age < 24 && peak != null && peak >= bar) keep = `prospect — projected R5 ${peak.toFixed(1)} at ${projectionAge()}`;
      if (!keep && team === 'B' && bXi.has(id) && age < RESERVE_MAX_AGE + 1) keep = 'youth starting for the reserves';
      const why = keep ? null : [
        team === 'A' ? 'not in your XI or bench' : 'not developing toward the first team',
        peak != null ? `ceiling R5 ${ceiling.toFixed(1)} (below ${bar.toFixed(1)})` : `R5 ${r5.toFixed(1)}, done developing`,
        ti != null && ti < 0 ? `already declining (TI ${ti.toFixed(1)}/wk)` : null,
      ].filter(Boolean).join(' · ');
      return { id, name: p.name, age, fp: p.fp, team, isGK, r5: Number(r5.toFixed(1)), peak, keep, why,
        sta, staDrop: sta != null && staNext != null ? sta - staNext : null, wage: Number(p.wage) || null, ti };
    });
    // Least future use first; among equals the older (losing value faster) goes first.
    const sellable = rows.filter(r => !r.keep).sort((x, y) => Math.max(x.r5, x.peak || 0) - Math.max(y.r5, y.peak || 0) || y.age - x.age);
    const left = { A: A.length, B: B.length }, gk = { A: A.filter(p => bucketFor(p.fp) === 'GK').length, B: B.filter(p => bucketFor(p.fp) === 'GK').length };
    const sell = [], hold = [];
    sellable.forEach(r => {
      const min = r.team === 'A' ? SELL_MIN_A : SELL_MIN_B;
      if (left[r.team] <= min || (r.isGK && gk[r.team] <= SELL_MIN_GK)) { hold.push({ ...r, why: r.why + ' — kept for squad numbers' }); return; }
      left[r.team]--; if (r.isGK) gk[r.team]--;
      sell.push(r);
    });
    const out = { t: now(), sell, hold, keep: rows.filter(r => r.keep).length, size: { A: A.length, B: B.length }, after: left, bar: Number(bar.toFixed(1)),
      income: sell.reduce((t, r) => t + (r.sta || 0), 0), wages: sell.reduce((t, r) => t + (r.wage || 0), 0) };
    setSlice('sellList', out);
    return out;
  }

  function buildBuyLists() {
    const prefs = loadShortlistPrefs('senior');
    const maxAge = prefs.maxAge != null ? prefs.maxAge : SENIOR_CRITERIA.maxAgeDefault;
    const budget = budgetGuidance();
    const cap = budget ? budget.recommendedMax : null;
    const own = (getSlice('ownSquads') || {}).data;
    const sl = getSlice('players');
    const all = sl && sl.data ? sl.data : [];
    if (own) { const o = ownSquadsWithHistory(); own.A = o.A; own.B = o.B; }
    const ctxA = teamContext(own && own.A && own.A.length ? own.A : firstTeamOnly(all));
    if (!ctxA) return null;
    // Likely price (heuristic): a bid under his Sell-to-Agent price rarely survives — anyone can
    // outbid and still resell to the agent at a profit — unless the auction ends within the hour.
    const minPrice = c => c.nextBid != null ? c.nextBid : parseMoney(c.bid);
    const likelyPrice = c => { const m = minPrice(c), sta = estimateBankPrice(c); return c.ends && c.ends - now() < 3600e3 ? m : Math.max(m, sta || 0); };
    const pool = applyUserPrefs(collectYouthPool().filter(p => p.age != null && p.age < maxAge + 1 && p._r5 != null && !isNaN(p._r5) && p.skills && Object.keys(p.skills).length >= 11 && (p.bid != null || p.nextBid != null) && !(p.ends && p.ends < now())), { includeForeign: prefs.includeForeign, maxCost: Number.MAX_SAFE_INTEGER })
      .filter(p => cap == null || likelyPrice(p) <= cap);
    const judge = (c, ctx) => {
      const nowX = xiImpact(c, ctx.now);
      if (nowX.gain < SENIOR_CRITERIA.minXiGain) return null;
      const nextX = xiImpact(projectPlayer(c, PROJECT_YEARS), ctx.next);
      if (nextX.gain < SENIOR_CRITERIA.minXiGain) return null; // won't still be an upgrade next year
      return { now: nowX, next: nextX };
    };
    const row = (c, j, nextWeight) => {
      const price = likelyPrice(c), sta = estimateBankPrice(c), ageMonths = ageMonthsOf(c);
      const score = j.now.gain + nextWeight * j.next.gain;
      return { id: c.id, name: c.name, age: c.age, fp: c.fp, nat: c.nat || null, r5: Number(Number(c._r5).toFixed(1)),
        routine: c.routine != null ? Number(Number(c.routine).toFixed(1)) : null, asi: c.asi != null ? Number(c.asi) : null, wage: c.wage || null,
        price, minBid: minPrice(c), ends: c.ends || null, estValue: sta, fair: fairPrice(c), scout: c.scout || null, maxValue: c.asi != null && ageMonths ? calcMaxSellPrice(Number(c.asi), ageMonths, sta) : null,
        gain: Number(j.now.gain.toFixed(1)), gainNext: Number(j.next.gain.toFixed(1)), slot: j.now.slot, replaces: j.now.replaces,
        pace: c.age < 26 ? Math.round(seasonGain(c, c.age, wageTi(c))) : null, ti: wageTi(c), peak: peakProjection(c),
        score: Number(score.toFixed(1)), perM: score / Math.max(0.1, price / 1e6), steal: sta != null && minPrice(c) < sta * 0.85 && !!c.ends && c.ends - now() < 3600e3 };
    };
    const lists = (rows, ctx) => {
      // One per position (the starter he'd replace), nobody in both lists.
      const taken = new Set();
      const onePer = (arr, key) => { const out = [], used = new Set(); [...arr].sort(key).forEach(r => { const pos = r.replaces || r.slot; if (out.length < BUY_LIST_LEN && !used.has(pos) && !taken.has(r.id)) { used.add(pos); taken.add(r.id); out.push(r); } }); return out; };
      const best = onePer(rows, (x, y) => y.score - x.score || x.price - y.price);
      const value = onePer(rows.filter(r => r.score >= BUY_VALUE_MIN_SCORE), (x, y) => y.perM - x.perM || y.score - x.score);
      const bySlot = ctx.now.base.lineup.filter(l => l.player).sort((x, y) => x.effectiveR5 - y.effectiveR5).map(l => {
        // By who he'd replace: in his own best formation the same spot can carry another slot name.
        const here = rows.filter(r => r.replaces ? r.replaces === l.player.name : r.slot === l.slot);
        const top = [...here].sort((x, y) => y.score - x.score)[0] || null;
        const val = [...here].sort((x, y) => y.perM - x.perM)[0] || null;
        const pk = peakProjection(l.player);
        return { slot: l.slot, id: l.player.id, name: l.player.name, r5: Number(l.effectiveR5.toFixed(1)), peak: pk, below: l.effectiveR5 < MIN_LINEUP_R5, best: top, value: val && (!top || val.id !== top.id) ? val : null };
      });
      return { best, value, bySlot, upgrades: rows.length, belowFloor: bySlot.filter(x => x.below).length, foreignXi: ctx.now.base.lineup.filter(l => isForeign(l.player)).length };
    };
    // What the market charges for a given R5 and age (heuristic): least squares of ln(price) on
    // R5 and age over every listing in budget. A buy priced well above that is overpriced for
    // what he is, however much he'd help — "at 190M he should be 100+", as the user put it.
    const fit = (() => {
      const pts = pool.map(c => [Number(c._r5), Number(c.age), Math.log(Math.max(1e5, likelyPrice(c)))]).filter(x => x.every(isFinite));
      if (pts.length < 30) return null;
      const n = pts.length, X = pts.map(([r, a]) => [1, r, a]), y = pts.map(x => x[2]);
      const XtX = [0, 1, 2].map(i => [0, 1, 2].map(j => X.reduce((t, r) => t + r[i] * r[j], 0)));
      const Xty = [0, 1, 2].map(i => X.reduce((t, r, k) => t + r[i] * y[k], 0));
      const b = solve3(XtX, Xty);
      return b ? { b, n } : null;
    })();
    const fairPrice = c => fit ? Math.exp(fit.b[0] + fit.b[1] * Number(c._r5) + fit.b[2] * Number(c.age)) : null;
    // User rules: every first-team buy is at least R5 75 — or, while still growing (< 24),
    // projected to reach 75 next season; youth (≤ 21) are bought for the reserves to develop,
    // judged by where they'll be at 27, not by today's XI.
    const r5Next = c => { const q = projectPlayer(c, PROJECT_YEARS); return q && q._r5 != null ? Number(q._r5) : Number(c._r5); };
    const seniorOk = c => Number(c._r5) >= MIN_LINEUP_R5 || (c.age < 24 && r5Next(c) >= MIN_LINEUP_R5);
    const xiBar = Math.min(...ctxA.now.base.lineup.filter(l => l.player).map(l => l.effectiveR5));
    const prospectBar = Math.max(MIN_LINEUP_R5, xiBar);
    const rowsA = [], rowsY = [];
    pool.forEach(c => {
      const fair = fairPrice(c);
      if (fair != null && likelyPrice(c) > fair * BUY_OVERPRICE) return; // pays well over the going rate
      if (seniorOk(c)) { const ja = judge(c, ctxA); if (ja) { rowsA.push(row(c, ja, 1)); return; } }
      if (c.age < RESERVE_MAX_AGE + 1) {
        const pk = peakProjection(c);
        if (pk == null || pk < prospectBar) return;
        const r = row(c, { now: { gain: 0, slot: null, replaces: null }, next: { gain: 0 } }, 0);
        r.score = Number((pk - prospectBar).toFixed(1)); r.perM = r.score / Math.max(0.1, r.price / 1e6);
        rowsY.push(r);
      }
    });
    const youth = { best: [...rowsY].sort((x, y) => y.peak - x.peak || x.price - y.price).slice(0, BUY_LIST_LEN),
      value: [...rowsY].sort((x, y) => y.perM - x.perM).slice(0, BUY_LIST_LEN), count: rowsY.length, bar: Number(prospectBar.toFixed(1)) };
    const out = { cap, maxAge, considered: pool.length, minR5: MIN_LINEUP_R5, A: lists(rowsA, ctxA), Y: youth };
    setSlice('marketBuys', out);
    return out;
  }

  /* ------------------------------------------------------------
   *  SECTION 5D — SPENDING GUIDANCE
   *  ------------------------------------------------------------
   *  A simple, clearly-labelled heuristic (not a game rule): keep roughly
   *  12 weeks of wage bill in reserve, then treat a quarter of whatever cash
   *  is left over as this window's transfer budget. Tune the two constants
   *  below if that reserve doesn't match your risk tolerance.
   * ============================================================ */
  const BUDGET_WAGE_WEEKS_RESERVE = 12;
  const BUDGET_SPEND_FRACTION = 0.25; // user: half (~190M) was far too much for one window

  function budgetGuidance() {
    const homeSlice = getSlice('home');
    const finSlice = getSlice('finances');
    const cash = (homeSlice && homeSlice.data && homeSlice.data.cash != null) ? homeSlice.data.cash
      : (finSlice && finSlice.data && finSlice.data.balance != null ? finSlice.data.balance : null);
    const cashNow = window.SESSION && SESSION.cash != null ? Number(SESSION.cash) : cash; // live on every page; cached slices can be days old
    if (cashNow == null) return null;
    let weeklyWage = null;
    if (finSlice && finSlice.data && finSlice.data.weekly) {
      const row = Object.entries(finSlice.data.weekly).find(([k]) => /wage/i.test(k));
      // Finances lists wages as a negative ("-5,035,686"); a negative reserve used to INFLATE the
      // budget by 24 weeks of wages (seen live: 304M cap instead of 244M).
      if (row && row[1] && row[1].length) weeklyWage = Math.abs(parseMoney(row[1][row[1].length - 1]));
    }
    const buffer = weeklyWage != null ? weeklyWage * BUDGET_WAGE_WEEKS_RESERVE : 0;
    const spendable = Math.max(0, cashNow - buffer);
    const bp = loadShortlistPrefs('senior');
    const share = bp.buyPct != null ? Number(bp.buyPct) : BUDGET_SPEND_FRACTION;
    const recommendedMax = bp.budget != null && Number(bp.budget) > 0 ? Math.round(Number(bp.budget)) : Math.round(spendable * share);
    return { cash: cashNow, weeklyWage, buffer, spendable, recommendedMax, share, custom: bp.budget != null && Number(bp.budget) > 0 };
  }

  /* ============================================================
   *  SECTION 5E — TRAINING RECOMMENDATIONS
   *  ------------------------------------------------------------
   *  Turns the raw squad skill data into actionable training advice:
   *  for each player's natural position we know which skills matter
   *  most (from the same per-position R5 weight rows the rating is
   *  built on — SECTION 2B), so we can flag weak "primary" skills to
   *  train next, call out players whose R5 has stopped improving
   *  (plateaued), and remind you that youths in the development bonus
   *  window (under ~18, per TM's own guide) train fastest so they
   *  deserve the high training intensity. Clearly heuristic, but every
   *  signal traces to a game-confirmed source.
   * ============================================================ */
  // Primary skills per position bucket, drawn from the highest-weighted skills in each
  // corresponding R5 row. "Primary" = skills that contribute the most to that position's
  // rating, so a weak primary skill is the single highest-ROI thing to train.
  const TRAIN_PRIMARY = {
    GK: ['han', 'one', 'ref', 'ari', 'com', 'kic', 'thr', 'jum', 'sta', 'pac'],
    D: ['mar', 'tac', 'pos', 'hea', 'sta', 'str'],
    DM: ['mar', 'tac', 'pas', 'wor', 'pos', 'sta', 'pac'],
    M: ['pas', 'tec', 'pos', 'wor', 'fin', 'sta', 'pac'],
    OM: ['pas', 'tec', 'fin', 'cro', 'pos', 'pac', 'lon'],
    F: ['fin', 'tec', 'pos', 'hea', 'pac', 'lon', 'wor'],
  };
  const TRAIN_WEAK = 11;       // a primary skill at/below this is a real weak spot to fix
  const TRAIN_DEV_BONUS_MIN = 16; // TM guide: global development bonus doubles training drop
  const TRAIN_DEV_BONUS_MAX = 19; //   for ages 16 up to 18y11m only — not younger, not older

  // Per-player training advice. Returns a sorted list with a short human readout each.
  function generateTrainingRecommendations(players) {
    if (!players || !players.length) return [];
    const recs = [];
    players.forEach(p => {
      if (!p.skills || p._r5 == null) return;
      const bucket = bucketFor(p.fp);
      const primaries = TRAIN_PRIMARY[bucket] || TRAIN_PRIMARY.M;
      const weak = primaries.filter(k => (Number(p.skills[k]) || 0) <= TRAIN_WEAK);
      const ageNum = p.age != null ? Number(p.age) : null;
      const isYouth = ageNum != null && ageNum <= YOUTH_CRITERIA.maxAge;
      const inDevBonus = ageNum != null && ageNum >= TRAIN_DEV_BONUS_MIN && ageNum < TRAIN_DEV_BONUS_MAX;
      // Plateau check: compare current R5 against an earlier snapshot (roughly a month back).
      const trend = playerTrend(p.id, 30);
      const plateaued = trend && trend.r5 != null && trend.r5 <= 0.1;
      const focus = weak.length ? weak
        .sort((a, b) => (Number(p.skills[a]) || 0) - (Number(p.skills[b]) || 0))
        .map(k => k.toUpperCase()).slice(0, 3).join(' / ') : null;
      recs.push({
        id: p.id, name: p.name, bucket, fp: p.fp, age: p.age,
        r5: p._r5, weak, isYouth, plateaued, focus,
        priority: isYouth || focus ? 'high' : (plateaued ? 'medium' : 'low'),
        note: (focus ? `Weak primary: train ${focus}.` : '') +
              (inDevBonus ? ' Development-bonus window (16–18) — train hard now.' : '') +
              (isYouth && !inDevBonus ? ' Young player — worth extra training focus.' : '') +
              (plateaued ? ' R5 has plateaued — check TI/coaches.' : ''),
      });
    });
    return recs.sort((a, b) => (b.priority === 'high') - (a.priority === 'high') || (b.priority === 'medium') - (a.priority === 'medium') || (Number(b.r5) || 0) - (Number(a.r5) || 0));
  }

  /* ============================================================
   *  SECTION 5G — APPLY TO TACTICS PAGE  (Preview / Apply / Undo)
   *  ------------------------------------------------------------
   *  Saves a match plan with the exact requests /tactics/ itself sends
   *  (protocol: CLAUDE.md "Tactics page"), then reloads and reads every
   *  value back. Nothing here runs without a click.
   * ============================================================ */

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const POSITION_KEYS = Object.keys(SLOT_NUM).concat(['sub1', 'sub2', 'sub3', 'sub4', 'sub5']);
  const TACTIC_KEYS = POSITION_KEYS.concat(['captain', 'corner', 'penalty', 'freekick']);
  const ORDER_FIELDS = ['EVENT_ID', 'EVENT_PAR', 'COND_ID', 'COND_PAR', 'ORDER_ID', 'ORDER_PAR1', 'ORDER_PAR2', 'ORDER_PAR3'];
  const REST_BAN_RISK_KEY = 'tmAdvisor_restBanRisk';
  const PENDING_VERIFY_KEY = 'tmAdvisor_pendingVerify';

  // TM fills its `players` / `on_field_assoc` globals asynchronously (tactics_init posts
  // tactics_get.ajax.php after load), so at document-end they are still empty — a read-back
  // that trusted them saw every filled slot as empty. We fetch the same endpoint ourselves.
  const onTacticsPage = () => location.pathname.startsWith('/tactics') && !!window.jQuery;
  let tacticsPageData = null; // last tactics_get.ajax.php reply: { players, formation_assoc, ... }
  let tacticsPageFailed = false; // one failed read → fall back to the cached squad, never loop
  async function loadTacticsPage() {
    const txt = await tmPost('/ajax/tactics_get.ajax.php', tmBase());
    const data = JSON.parse(txt);
    if (!data || !data.players) throw new Error('tactics_get returned no squad');
    tacticsPageData = data;
    return data;
  }
  const restBanRisk = () => { try { return localStorage.getItem(REST_BAN_RISK_KEY) === '1'; } catch (e) { return false; } };

  // The tactics page's own `players` global in our squad shape. It is the freshest source for
  // THIS match: bans, injuries and the yellow-card "ban risk" icon all live on it.
  const TP_SKILL = {
    strength: 'str', stamina: 'sta', pace: 'pac', marking: 'mar', tackling: 'tac', workrate: 'wor', positioning: 'pos',
    passing: 'pas', crossing: 'cro', technique: 'tec', heading: 'hea', finishing: 'fin', longshots: 'lon', set_pieces: 'set',
    handling: 'han', one_on_ones: 'one', reflexes: 'ref', aerial_ability: 'ari', jumping: 'jum', communication: 'com', kicking: 'kic', throwing: 'thr',
  };
  function tacticsPageSquad() { return tacticsPageData ? squadFromTacticsData(tacticsPageData) : null; }
  function squadFromTacticsData(data) {
    if (!data || !data.players) return [];
    const star = v => typeof v === 'number' ? v : Number((String(v).match(/alt='(\d+)'/) || [])[1] || v); // star skills are <img alt='19|20'>
    return Object.values(data.players).map(p => {
      const skills = {};
      (p.skills || []).forEach(s => { if (TP_SKILL[s.key]) skills[TP_SKILL[s.key]] = star(s.value); });
      return {
        id: String(p.player_id), name: p.name, fp: p.fp, age: Number(p.age) + (Number(p.months) || 0) / 12,
        asi: Number(String(p.skill_index).replace(/,/g, '')), routine: Number(p.routine) || 0,
        ban: p.banned ? '1' : '0', inj: String(p.injury) === '0' ? null : p.injury,
        banRisk: /yellow_card/.test(p.status_no_check || ''), rec: Number(p.rec_sort) || 0, skills, plot: [],
        nat: p.country || null, foreign: !!p.show_flag,
      };
    });
  }

  function lineupOnField(best, bench, roles) {
    const onField = Object.fromEntries(TACTIC_KEYS.map(k => [k, '0']));
    best.lineup.forEach(l => { if (l.player) onField[l.slot] = String(l.player.id); });
    bench.named.forEach(b => { if (b.player) onField[b.key] = String(b.player.id); });
    [['captain', roles.captain], ['corner', roles.corner], ['penalty', roles.penalty], ['freekick', roles.freeKick]].forEach(([k, p]) => { if (p) onField[k] = String(p.id); });
    return onField;
  }
  function planToTactic(plan) {
    const onField = lineupOnField(plan.best, plan.bench, plan.roles);
    const orders = plan.condOrders.map(o => ({
      EVENT_ID: String(o.eventId), EVENT_PAR: String(o.eventPar), COND_ID: String(o.condId), COND_PAR: String(o.condPar),
      ORDER_ID: String(o.orderId), ORDER_PAR1: String(o.par1), ORDER_PAR2: String(o.par2 != null ? o.par2 : 0), ORDER_PAR3: o.par3 != null ? String(o.par3) : null,
    }));
    return { onField, mentality: String(plan.settings.mentality), style: String(plan.settings.style), focus: String(plan.settings.focus), orders };
  }

  const tmPost = (url, data) => new Promise((resolve, reject) =>
    window.jQuery.post(url, data, resolve, 'text').fail((x, status, err) => reject(new Error(url + ': ' + (err || status)))));
  // Main team = 0/0/0. Off /tactics/ these page vars don't exist (and `window.national` could
  // even resolve to a DOM element by id), so only plain digits are trusted.
  const pageNum = v => /^\d+$/.test(String(v)) && typeof v !== 'object' ? String(v) : '0';
  // res = 1 targets the reserve team (TM's own `reserves` flag on every tactics endpoint).
  const tmBase = (res) => ({ reserves: res != null ? (res ? '1' : '0') : pageNum(window.reserves), national: pageNum(window.national), miniGameId: pageNum(window.miniGameId) });

  // Saved orders come from the endpoint, not the page global, which can lag behind a save.
  async function fetchCondOrders(res) {
    const txt = await tmPost('/ajax/tactics_co_get.ajax.php', { get: 'cond_orders', ...tmBase(res) });
    try { return JSON.parse(txt) || []; } catch (e) { return window.cond_orders || []; }
  }
  // Reads the SERVER's copy from any page: positions via tactics_get, the three settings from
  // a fetched /tactics/ (its <option selected> is the saved value), orders via tactics_co_get.
  async function readSavedTactic(res) {
    const data = res ? JSON.parse(await tmPost('/ajax/tactics_get.ajax.php', tmBase(1))) : await loadTacticsPage();
    const assoc = data.formation_assoc || {};
    const doc = await fetchDoc(res ? '/tactics/reserves/' : '/tactics/'); // reserves page: var reserves = 1 (live)
    const sel = id => { const o = doc.querySelector('#' + id + ' option[selected]'); return o ? String(o.value) : '0'; };
    return {
      onField: Object.fromEntries(TACTIC_KEYS.map(k => [k, String(assoc[k] || '0')])),
      mentality: sel('mentality_select'), style: sel('attacking_select'), focus: sel('focus_side_select'),
      orders: (await fetchCondOrders(res)).slice(0, 5),
    };
  }

  async function writeTactic(state, current, res) {
    const placed = new Set(POSITION_KEYS.map(k => state.onField[k]).filter(v => v !== '0'));
    const moves = {};
    POSITION_KEYS.forEach(k => { if (state.onField[k] !== '0') moves[state.onField[k]] = k; });
    POSITION_KEYS.forEach(k => { const old = current.onField[k]; if (old !== '0' && !placed.has(old)) moves[old] = 'out'; });
    // One post carries XI + bench + roles: the server takes the roles from `on_field`.
    await tmPost('/ajax/tactics_post.ajax.php', { on_field: state.onField, players: moves, ...tmBase(res) });
    // Roles go one per request, as TM's own page drops them — the reserves ignored roles sent
    // only inside on_field (live: captain/corner/penalty/freekick all stayed 0).
    for (const role of ['captain', 'corner', 'penalty', 'freekick']) {
      const pid = state.onField[role];
      if (!pid || pid === '0') continue;
      await sleep(150);
      await tmPost('/ajax/tactics_post.ajax.php', { on_field: state.onField, players: { [pid]: role }, ...tmBase(res) });
    }
    if (state.mentality == null) return; // positions-only save
    for (const [save, value] of [['mentality', state.mentality], ['attacking', state.style], ['focus', state.focus]]) {
      await sleep(150);
      await tmPost('/ajax/tactics_post.ajax.php', { save, value, club_id: SESSION.id, ...tmBase(res) });
    }
    for (let i = 0; i < state.orders.length; i++) {
      await sleep(150);
      // Keep the slot's existing record (its ID) so TM updates it in place.
      const slot = current.orders[i] || { TEAM_ID: String(SESSION.id), COND_ORDER_NUM: String(i) };
      await tmPost('/ajax/tactics_co_post.ajax.php', { ...slot, ...state.orders[i], ...tmBase(res) });
    }
  }

  function tacticMismatches(state, saved) {
    const out = [];
    TACTIC_KEYS.forEach(k => { if (saved.onField[k] !== state.onField[k]) out.push(k); });
    ['mentality', 'style', 'focus'].forEach(k => { if (saved[k] !== state[k]) out.push(k); });
    state.orders.forEach((o, i) => {
      const s = saved.orders[i] || {};
      if (ORDER_FIELDS.some(f => String(s[f] == null ? '' : s[f]) !== String(o[f] == null ? '' : o[f]))) out.push('order ' + (i + 1));
    });
    return out;
  }

  // Apply (or undo): back up what's saved now, write, then reload — the check runs on the
  // fresh page (verifyPendingApply), so it reads what TM really stored, not our own variables.
  async function saveTacticAndVerify(state, label, backup) {
    const current = await readSavedTactic();
    if (backup) setSlice('tacticsBackup', current);
    await writeTactic(state, current);
    sessionStorage.setItem(PENDING_VERIFY_KEY, JSON.stringify({ state, label, t: now() }));
    location.reload();
  }

  async function verifyPendingApply() {
    let pending = null;
    try { pending = JSON.parse(sessionStorage.getItem(PENDING_VERIFY_KEY)); } catch (e) {}
    if (!pending) return;
    // A stale marker (page left mid-check, edits since) would compare against an old plan.
    if (!pending.t || now() - pending.t > 10 * 60e3) { sessionStorage.removeItem(PENDING_VERIFY_KEY); return; }
    for (let i = 0; i < 20 && !window.jQuery; i++) await sleep(250);
    let mismatches;
    try { mismatches = onTacticsPage() ? tacticMismatches(pending.state, await readSavedTactic()) : ['tactics page did not load']; }
    catch (e) { mismatches = ['read-back failed: ' + e.message]; }
    setSlice('tacticsApplied', { label: pending.label, ok: !mismatches.length, mismatches });
    // Cleared only once the result is stored: navigating away mid-check retries next load.
    sessionStorage.removeItem(PENDING_VERIFY_KEY);
    if (document.getElementById('tma-body') && document.querySelector('.tma-tab.active')?.dataset.tab === 'tactics') renderTactics();
  }

  // Human-readable differences between what's saved and the plan, for the Preview list.
  function tacticDiff(state, saved) {
    const nameOf = id => { const p = tacticsPageData && Object.values(tacticsPageData.players).find(x => String(x.player_id) === String(id)); return p ? p.name : (id === '0' ? '—' : id); };
    const rows = [];
    TACTIC_KEYS.forEach(k => {
      if (saved.onField[k] !== state.onField[k]) rows.push([k.toUpperCase(), nameOf(saved.onField[k]), nameOf(state.onField[k])]);
    });
    [['Mentality', 'mentality', MENTALITY], ['Style', 'style', ATT_STYLE], ['Focus', 'focus', FOCUS_SIDE]].forEach(([label, k, names]) => {
      if (saved[k] !== state[k]) rows.push([label, names[saved[k]] || saved[k], names[state[k]] || state[k]]);
    });
    const desc = o => {
      if (!o || !Number(o.ORDER_ID)) return '—';
      const d = describeCondOrder({ eventId: Number(o.EVENT_ID), eventPar: o.EVENT_PAR, condId: Number(o.COND_ID), condPar: Number(o.COND_PAR), orderId: Number(o.ORDER_ID), par1: o.ORDER_PAR1, par3: o.ORDER_PAR3, inName: nameOf(o.ORDER_PAR2), outName: nameOf(o.ORDER_PAR1) });
      return `${d.event}, ${d.score}: ${d.order}`;
    };
    state.orders.forEach((o, i) => {
      const s = saved.orders[i] || {};
      if (ORDER_FIELDS.some(f => String(s[f] == null ? '' : s[f]) !== String(o[f] == null ? '' : o[f]))) rows.push(['Order ' + (i + 1), desc(s), desc(o)]);
    });
    return rows;
  }

  /* ============================================================
   *  SECTION 5H — AUTOPILOT  (off by default)
   *  ------------------------------------------------------------
   *  When switched on, opening any TM page applies the match plan for the
   *  next fixture: once per match, at most one attempt per 20 min, never
   *  within an hour of kickoff, and only against the opponent we actually
   *  play. Same write + read-back as Apply (Section 5G). Dry run logs the
   *  plan without saving.
   * ============================================================ */

  const AUTOPILOT_KEY = 'tmAdvisor_autopilot'; // { enabled, dryRun }
  const AUTOPILOT_GAP_MS = 20 * 60e3;
  // Tactics lock ~1 h before kickoff: TM simulates the match ahead of time — the community script
  // "Match stats and actions 51 minutes before match" (TM Guide/) already reads the finished
  // report 51 min out. 60 min is the user-reported lock; the autopilot keeps 10 min on top.
  const TACTICS_LOCK_MS = 60 * 60e3;
  const AUTOPILOT_SAFETY_MS = 10 * 60e3;
  // On unless the user switched it off (user, 2026-11-01: "auto-does the tactics before every match").
  const autopilotPrefs = () => { let p = {}; try { p = JSON.parse(localStorage.getItem(AUTOPILOT_KEY)) || {}; } catch (e) {} return { ...p, enabled: p.enabled !== false, dryRun: !!p.dryRun }; };
  function setAutopilotPrefs(p) {
    try { localStorage.setItem(AUTOPILOT_KEY, JSON.stringify(p)); } catch (e) {}
    const st = getSlice('autopilot');
    setSlice('autopilot', { ...(st && st.data), doneMatchKey: null, trainingWeek: null, scoutDay: null, facilitiesWeek: null, lastTry: 0 }); // a changed switch earns a fresh run
  }

  // TM shows every time in ITS zone (live 2026-11-01: an hour behind South Africa). Each page
  // renders the server clock as static text in #tm_clock, so (that clock − ours) at render time
  // is the offset, rounded to the 15-minute grid real time zones use.
  function measureTmOffset(doc) {
    const el = doc && doc.getElementById ? doc.getElementById('tm_clock') : null;
    const m = el && el.textContent.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (!m) return null;
    const d = new Date();
    let diff = (+m[1] * 60 + +m[2] + +m[3] / 60) - (d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60);
    if (diff > 720) diff -= 1440;
    if (diff <= -720) diff += 1440;
    const offsetMin = Math.round(diff / 15) * 15;
    setSlice('tmClock', { offsetMin });
    return offsetMin;
  }
  const tmOffsetMin = () => { const s = getSlice('tmClock'); return s && s.data && typeof s.data.offsetMin === 'number' ? s.data.offsetMin : null; };

  // Home page shows e.g. "National First Division Group 2, 1. November 19:00" (no year), in TM
  // time. Returns a real timestamp, or null: an unknown offset or unreadable text means callers
  // must not act on a kickoff they can't place.
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  function parseKickoff(when) {
    const m = String(when || '').match(/(\d{1,2})\.\s*([A-Za-z]+)\s+(\d{1,2}):(\d{2})/);
    const month = m ? MONTHS.indexOf(m[2].toLowerCase()) : -1;
    const offset = tmOffsetMin();
    if (month < 0 || offset == null) return null;
    const today = new Date();
    const d = new Date(today.getFullYear(), month, +m[1], +m[3], +m[4]);
    if (today - d > 180 * 864e5) d.setFullYear(d.getFullYear() + 1); // a January fixture seen in December
    return d.getTime() - offset * 60e3; // TM wall clock -> real instant
  }
  const tmTimeOf = when => (String(when || '').match(/\d{1,2}:\d{2}/) || [''])[0];

  function autopilotLog(msg, ok, extra) {
    const entry = { t: now(), msg, ok, ...(extra || {}) };
    const prev = (getSlice('autopilotLog') || { data: [] }).data;
    setSlice('autopilotLog', [entry].concat(prev).slice(0, 30));
    return entry;
  }

  const COPILOT_STEPS_KEY = 'tmAdvisor_copilotSteps'; // { training, tactics, facilities }
  function copilotSteps() {
    let st = {};
    try { st = JSON.parse(localStorage.getItem(COPILOT_STEPS_KEY)) || {}; } catch (e) {}
    return { training: st.training !== false, tactics: st.tactics !== false, reserves: st.reserves !== false, youth: st.youth !== false, scouting: st.scouting !== false, facilities: st.facilities === true };
  }
  function setCopilotSteps(st) {
    try { localStorage.setItem(COPILOT_STEPS_KEY, JSON.stringify(st)); } catch (e) {}
    setAutopilotPrefs(autopilotPrefs()); // a changed step earns a fresh run for this match
  }

  // Tactics step: the match plan (XI, bench, roles, settings, orders), saved and read back.
  async function applyMatchPlanStep(nm, dryRun) {
    const kickoff = parseKickoff(nm.when);
    if (!kickoff) return { ok: false, text: `kickoff time unreadable ("${nm.when}")` };
    if (kickoff - now() < TACTICS_LOCK_MS + AUTOPILOT_SAFETY_MS) return { ok: true, text: `skipped — the ${tmTimeOf(nm.when)} match locks an hour before kickoff` };
    const ready = opponentReadiness();
    if (!ready.ready) return { ok: false, text: ready.text };
    await loadTacticsPage();
    const sl = k => { const x = getSlice(k); return x && x.data; };
    const plan = buildMatchPlan(tacticsPageSquad(), sl('opponent'), sl('opponentScouting'), sl('opponentExpected'), { restBanRisk: restBanRisk() });
    const target = planToTactic(plan);
    const saved = await readSavedTactic();
    const changes = tacticDiff(target, saved);
    const settings = `${MENTALITY[plan.settings.mentality]} / ${ATT_STYLE[plan.settings.style]} / ${FOCUS_SIDE[plan.settings.focus]}`;
    if (dryRun) {
      if (!changes.length) recordPrediction(plan); // nothing to write: what's saved IS the plan, so the chip may say so
      return { ok: true, text: changes.length ? `would change ${changes.length} (${changes.map(c => c[0]).join(', ')}) — ${settings}` : 'already matches the plan' };
    }
    if (changes.length) { setSlice('tacticsBackup', saved); await writeTactic(target, saved); }
    const mismatches = tacticMismatches(target, await readSavedTactic());
    if (mismatches.length) return { ok: false, text: `saved, but these didn't stick: ${mismatches.join(', ')}` };
    recordPrediction(plan);
    return { ok: true, text: (changes.length ? `${changes.length} change(s) saved and verified` : 'already matched the plan') + ` — ${settings}` };
  }

  // One run = everything the next match needs: opponent scan → training groups → tactics, bench,
  // roles & orders → facility upgrade. Each step obeys its own switch; one step failing is logged
  // and the rest still run. "Prepare match" runs it now; the autopilot runs it once per match.
  // Each job on its own cadence (forced runs do everything): match prep once per fixture PAIR
  // (first team + reserves, so a reserve-only fixture still gets prepared), training once per
  // training week, the youth report whenever one is waiting, scouting daily, facilities weekly.
  async function runCopilot(force, onProgress) {
    const prefs = autopilotPrefs(), steps = copilotSteps(), dry = !!prefs.dryRun;
    if (!prefs.enabled && !force) return null;
    if (!window.SESSION || !SESSION.id) return force ? { ok: false, msg: 'Sign in to TrophyManager first' } : null;
    const state = (getSlice('autopilot') || { data: {} }).data || {};
    if (!force && state.lastTry && now() - state.lastTry < AUTOPILOT_GAP_MS) return null;
    setSlice('autopilot', { ...state, lastTry: now() }); // claimed first, so a second open tab backs off
    const say = t => { if (onProgress) onProgress(t); };
    const lines = [], done = {};
    let allOk = true;
    const step = async (key, label, fn) => {
      say(label + '…');
      try {
        const r = await fn();
        if (!(r.idle && !force)) lines.push(`${r.ok ? '✔' : '⚠'} ${label}: ${r.text}`);
        if (!r.ok) allOk = false; else done[key] = true;
      } catch (e) { lines.push(`⚠ ${label}: failed — ${e.message}`); allOk = false; }
    };
    try {
      say('Reading the next fixtures…');
      await refreshOwnPlayers().catch(e => console.warn('TM Advisor: players', e));
      const homeDoc = await fetchDoc('/home/');
      measureTmOffset(homeDoc); // fresh render = an exact clock reading
      const home = parseHome(homeDoc);
      setSlice('home', home);
      const nm = home.nextMatch;
      const matchId = nm && nm.matchUrl ? (nm.matchUrl.match(/\/matches\/(\d+)/) || [])[1] : null;
      const bFix = steps.reserves && SESSION.b_team ? await nextFixtureOf(SESSION.b_team).catch(() => null) : null;
      const matchKey = `${matchId || '-'}|${bFix ? bFix.id : '-'}`;
      const week = weekKey(), today = new Date().toDateString();
      const vs = nm && nm.home ? (String(nm.home.id) === clubId ? nm.away.name : nm.home.name) : null;
      if ((matchId || bFix) && (force || state.doneMatchKey !== matchKey)) {
        let matchOk = true;
        const mark = async (k, l, f) => { await step(k, l, f); if (!done[k]) matchOk = false; };
        say('Reading new results…');
        // Results first: the plan below is fitted on every division match played so far.
        const learned = await crawlDivision(60).catch(() => null);
        if (learned) setSlice('matchBankCrawl', learned);
        if (matchId) await mark('scan', 'Opponent scan', async () => {
          await refreshAll();
          const r = opponentReadiness(), sc = getSlice('opponentScouting') && getSlice('opponentScouting').data, ig = sc && sc.inGame;
          const habits = ig && ig.games ? ([ig.chase && `chase from ~${ig.chase.min}' when behind`, ig.hold && `sit back from ~${ig.hold.min}' when ahead`].filter(Boolean).join(', ')
            || `made no mentality changes in their last ${ig.games}${ig.subs ? '' : ' (no subs either)'}`) : '';
          return { ok: r.ready, text: r.text + (learned ? ` · ${learned.added} new result(s) learned (${learned.total} in bank)` : '') + (habits ? ` · they ${habits}` : '') };
        });
        // Reserves before the first team: a promotion changes who the first-team plan can pick.
        if (steps.reserves) await mark('reserves', 'Reserves', () => manageReserves(dry));
        if (steps.tactics && matchId) await mark('tactics', 'Tactics & orders', () => applyMatchPlanStep(nm, dry));
        if (matchOk) done.match = true;
      }
      if (steps.training && (force || state.trainingWeek !== week)) await step('training', 'Training', () => trainingStep(dry));
      if (steps.youth) await step('youth', 'Youth pull', () => handleYouthPull(dry));
      if (steps.scouting && (force || state.scoutDay !== today)) await step('scouting', 'Scouting', () => scoutingStep(dry));
      if (steps.facilities && (force || state.facilitiesWeek !== week)) await step('facilities', 'Facilities', () => applyFacilityUpgrade(dry));
      if (!dry) {
        const st = getSlice('autopilot').data;
        setSlice('autopilot', { ...st,
          doneMatchKey: done.match ? matchKey : st.doneMatchKey,
          trainingWeek: done.training ? week : st.trainingWeek,
          scoutDay: done.scouting ? today : st.scoutDay,
          facilitiesWeek: done.facilities ? week : st.facilitiesWeek });
      }
      if (!lines.length) return null; // nothing was due this pass
      return autopilotLog(`${dry ? 'Dry run' : force ? 'Prepared' : 'Autopilot'}${vs ? ' v ' + vs : ''}`, allOk, { matchId, lines });
    } catch (e) {
      return autopilotLog('Copilot failed: ' + e.message, false, { lines });
    }
  }

  /* ============================================================
   *  SECTION 5I — LEARNING FROM RESULTS  (match bank + fitted result model)
   *  ------------------------------------------------------------
   *  Crawls your division's played matches (both XIs' TM rec + routine, each
   *  side's mentality/style/focus, the score) and fits ONE goal-difference model
   *  on strength. Each setting is then judged by how sides using it did against
   *  what the strength gap predicted, per context (underdog / even / favourite).
   *  A setting replaces the heuristic only when the data clearly favours it.
   *  Observational data: teams pick settings for reasons, so effects are
   *  associations, and the UI says so.
   * ============================================================ */

  const MATCH_BANK_CAP = 1000; // own division + the country's top division
  const LEARN_MIN_MATCHES = 30;  // below this the model isn't fitted at all
  const LEARN_MIN_SAMPLES = 12;  // per setting, per context, before it can override
  const LEARN_CRAWL_GAP_MS = 20 * 3600e3;

  // A side's shape from its starters' slots: central D, wide D, DM, M, OM, F.
  function shapeOf(slots) {
    const c = { dc: 0, dw: 0, dm: 0, m: 0, mw: 0, om: 0, f: 0 };
    slots.forEach(k => { k = String(k).toLowerCase(); if (k === 'gk') return; if (/^dc[lr]?$/.test(k)) c.dc++; else if (/^d[lr]$/.test(k)) c.dw++; else if (/^dm/.test(k)) c.dm++; else if (/^om/.test(k)) c.om++; else if (/^m/.test(k)) { c.m++; if (/^m[lr]$/.test(k)) c.mw++; } else if (/^f/.test(k)) c.f++; });
    return c;
  }
  // TM-style notation, lines without players dropped (3-1-4-2, 3-2-3-2, 4-4-2), plus how many
  // of the midfielders are wide — "DMC, ML, 2 MC, MR" and "DMC, 4 MC" are different shapes.
  const shapeLabel = c => [c.dc + c.dw, c.dm, c.m, c.om, c.f].filter((v, i) => v || i === 0 || i === 4).join('-') + (c.m ? ` (${c.mw} wide)` : '');
  const SHAPE_V = 2; // bump when shapeLabel changes: the crawl re-reads older entries
  // The meta the user reports: 3+ central defenders, no full-backs, 2 forwards, 4+ in midfield.
  const isMetaShape = c => c.dc >= 3 && c.dw === 0 && c.f >= 2 && c.dm + c.m + c.om >= 4;
  function matchSide(md, lineup, side) {
    const starters = Object.values(lineup || {}).filter(p => p && p.position && !String(p.position).toLowerCase().includes('sub'));
    const shape = shapeOf(starters.map(p => p.position));
    const avg = k => starters.length ? starters.reduce((a, p) => a + (parseFloat(p[k]) || 0), 0) / starters.length : null;
    const pick = k => { const v = md[k]; const x = v && typeof v === 'object' ? v[side] : null; return x == null || x === '' ? null : Number(x); };
    const style = pick('attacking_style');
    return { n: starters.length, rec: avg('rec'), rou: avg('routine'), ment: pick('mentality'), style: style === 0 ? 1 : style, focus: pick('focus_side'), shape: shapeLabel(shape), shapeV: SHAPE_V, meta: isMetaShape(shape) }; // style 0 = Balanced, as fetchNextMatchExpected treats it
  }

  let crawling = false;
  async function crawlDivision(maxNew, onProgress) {
    if (crawling) throw new Error('already reading match reports');
    crawling = true;
    try { return await crawlDivisionOnce(maxNew, onProgress); } finally { crawling = false; }
  }
  async function crawlDivisionOnce(maxNew, onProgress) {
    const home = getSlice('home');
    const path = home && home.data && home.data.nextMatch && home.data.nextMatch.leaguePath;
    const lp = path && path.match(/\/league\/([a-z]+)\/(\d+)\/(\d+)/i);
    if (!lp) throw new Error('league unknown — open the Home page once');
    // Your division plus your country's top division (user, 2026-11-08): the most active
    // managers play there, so it shows best what the match engine rewards.
    const leagues = [[lp[1], lp[2], lp[3]]];
    if (!(lp[2] === '1' && lp[3] === '1')) leagues.push([lp[1], '1', '1']);
    const played = [];
    for (const [c, dv, g] of leagues) {
      const res = await fetch('/ajax/fixtures.ajax.php', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `type=league&var1=${c}&var2=${dv}&var3=${g}` });
      const fx = JSON.parse(await res.text()) || {};
      Object.values(fx).forEach(mo => (mo && mo.matches || []).forEach(x => { if (x.result && /^\d+-\d+$/.test(x.result)) played.push({ ...x, lg: `${dv}.${g}` }); }));
    }
    played.sort((a, b) => String(b.date).localeCompare(String(a.date))); // newest first, both leagues
    const bank = (getSlice('matchBank') || { data: {} }).data || {};
    // Entries crawled before shapes were recorded are read again (once).
    const todo = played.filter(x => !bank[x.id] || (!bank[x.id].skip && bank[x.id].h && bank[x.id].h.shapeV !== SHAPE_V)).slice(0, maxNew);
    let done = 0;
    for (const x of todo) {
      onProgress && onProgress(++done, todo.length);
      try {
        const data = await fetchMatchJson(x.id);
        const md = (data && data.match_data) || {};
        const [hg, ag] = x.result.split('-').map(Number);
        const h = matchSide(md, data && data.lineup && data.lineup.home, 'home');
        const a = matchSide(md, data && data.lineup && data.lineup.away, 'away');
        bank[x.id] = (h.n >= 9 && a.n >= 9 && h.rec && a.rec)
          ? { d: x.date, lg: x.lg, hid: String(x.hometeam), aid: String(x.awayteam), h: { ...h, g: hg }, a: { ...a, g: ag } }
          : { d: x.date, skip: true };
      } catch (e) { console.warn('TM Advisor: match crawl failed', x.id, e); }
      await sleep(150);
    }
    Object.keys(bank).sort((p, q) => String(bank[q].d).localeCompare(String(bank[p].d))).slice(MATCH_BANK_CAP).forEach(id => delete bank[id]);
    setSlice('matchBank', bank);
    return { added: todo.length, total: Object.keys(bank).length, remaining: played.filter(x => !bank[x.id] || (!bank[x.id].skip && bank[x.id].h && bank[x.id].h.shapeV !== SHAPE_V)).length };
  }

  // Daily, read-only, capped: the bank grows by itself whenever you play.
  async function backgroundCrawl() {
    const st = getSlice('matchBankCrawl');
    if (crawling || (st && now() - st.t < LEARN_CRAWL_GAP_MS)) return;
    setSlice('matchBankCrawl', { claimed: true });
    try { setSlice('matchBankCrawl', await crawlDivision(60)); } catch (e) { console.warn('TM Advisor: background crawl', e); }
  }

  // Strength inputs: the gap in average TM rec, and in log routine (routine's own R5 bonus is a
  // saturating curve, Section 2B, so log keeps one veteran-heavy XI from dominating).
  const strengthRow = (s, o) => [1, s.rec - o.rec, Math.log1p(s.rou || 0) - Math.log1p(o.rou || 0)];
  function solveLinear(A, b) {
    const n = b.length, M = A.map((r, i) => r.concat(b[i]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-9) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((r, i) => r[n] / r[i]);
  }

  // GD(home view) = c0 + c1·Δrec + c2·Δlog-routine; c0 is home advantage. Least squares.
  function fitResultModel() {
    const games = Object.values((getSlice('matchBank') || { data: {} }).data || {}).filter(m => !m.skip);
    if (games.length < LEARN_MIN_MATCHES) return { n: games.length, ready: false };
    const X = games.map(m => strengthRow(m.h, m.a)), y = games.map(m => m.h.g - m.a.g);
    const XtX = [0, 1, 2].map(r => [0, 1, 2].map(c => X.reduce((a, x) => a + x[r] * x[c], 0)));
    const Xty = [0, 1, 2].map(r => X.reduce((a, x, i) => a + x[r] * y[i], 0));
    const coef = solveLinear(XtX, Xty);
    if (!coef) return { n: games.length, ready: false };
    const predict = x => coef[0] * x[0] + coef[1] * x[1] + coef[2] * x[2];
    const samples = [];
    let sq = 0;
    games.forEach((m, i) => {
      const p = predict(X[i]), e = y[i] - p;
      sq += e * e;
      samples.push({ s: m.h, team: m.hid, exp: p, res: e }, { s: m.a, team: m.aid, exp: -p, res: -e }); // a sample per side
    });
    // How far OUR results run above/below what our ratings predict. Kept out of the setting
    // effects: we played one setting all season, so our own over-performance would otherwise
    // be credited to that setting. Shrunk toward 0 (k = 10 matches) so a few games can't swing it.
    const own = samples.filter(x => x.team === clubId).map(x => x.res);
    const ownMean = own.length ? own.reduce((a, b) => a + b, 0) / own.length : 0;
    const teamFactor = { n: own.length, raw: ownMean, shrunk: ownMean * own.length / (own.length + 10) };
    return { n: games.length, ready: true, coef, rmse: Math.sqrt(sq / games.length), samples, teamFactor };
  }

  // Own heuristic: within ¾ of a goal either way counts as an even match.
  const contextOf = gd => gd < -0.75 ? 'underdog' : gd > 0.75 ? 'favourite' : 'even';

  function settingEffects(model, field, context) {
    const groups = {};
    model.samples.forEach(x => { const v = x.s[field]; if (v && x.team !== clubId && contextOf(x.exp) === context) (groups[v] = groups[v] || []).push(x.res); });
    return Object.entries(groups).map(([v, r]) => {
      const mean = r.reduce((a, b) => a + b, 0) / r.length;
      const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, r.length - 1));
      return { value: Number(v), n: r.length, mean, se: sd / Math.sqrt(r.length) };
    }).sort((a, b) => b.mean - a.mean);
  }

  // Switch from the heuristic only when the best-supported setting beats it by more than
  // 1.5 standard errors of the difference — with a few hundred matches most gaps are noise.
  function evidencePick(model, field, context, heuristic) {
    const rows = settingEffects(model, field, context);
    const ok = rows.filter(r => r.n >= LEARN_MIN_SAMPLES);
    const best = ok[0], cur = rows.find(r => r.value === heuristic);
    if (!best || best.value === heuristic || !cur || cur.n < LEARN_MIN_SAMPLES) return { value: heuristic, rows, switched: false };
    const gain = best.mean - cur.mean;
    return gain > 1.5 * Math.sqrt(best.se ** 2 + cur.se ** 2) ? { value: best.value, rows, switched: true, gain } : { value: heuristic, rows, switched: false };
  }

  const avgOf = (arr, k) => { const v = arr.map(x => Number(x[k])).filter(x => !isNaN(x) && x > 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  // Our expected goal difference v the next opponent, from the fitted model.
  function predictGoalDiff(model, myPlayers, oppPlayers, weAreHome) {
    const me = { rec: avgOf(myPlayers, 'rec'), rou: avgOf(myPlayers, 'routine') };
    const them = { rec: avgOf(oppPlayers, 'rec'), rou: avgOf(oppPlayers, 'routine') };
    if (!model.ready || me.rec == null || them.rec == null) return null;
    const x = strengthRow(me, them);
    return (weAreHome ? model.coef[0] : -model.coef[0]) + model.coef[1] * x[1] + model.coef[2] * x[2] + model.teamFactor.shrunk;
  }

  function recordPrediction(plan) {
    const nm = getSlice('home') && getSlice('home').data && getSlice('home').data.nextMatch;
    const matchId = nm && nm.matchUrl ? (nm.matchUrl.match(/\/matches\/(\d+)/) || [])[1] : null;
    if (!matchId || plan.settings.predictedGD == null) return;
    const all = (getSlice('predictions') || { data: {} }).data || {};
    all[matchId] = { t: now(), gd: plan.settings.predictedGD, ment: plan.settings.mentality, style: plan.settings.style, focus: plan.settings.focus };
    const keep = Object.entries(all).sort((a, b) => b[1].t - a[1].t).slice(0, 60);
    setSlice('predictions', Object.fromEntries(keep));
  }
  // Predictions whose match is now in the bank, graded from our side.
  function gradedPredictions() {
    const preds = (getSlice('predictions') || { data: {} }).data || {};
    const bank = (getSlice('matchBank') || { data: {} }).data || {};
    return Object.entries(preds).filter(([id]) => bank[id] && !bank[id].skip).map(([id, p]) => {
      const m = bank[id], home = m.hid === clubId;
      const actual = home ? m.h.g - m.a.g : m.a.g - m.h.g;
      return { id, ...p, actual, score: home ? `${m.h.g}-${m.a.g}` : `${m.a.g}-${m.h.g}`, d: m.d };
    }).sort((a, b) => String(b.d).localeCompare(String(a.d)));
  }

  /* ============================================================
   *  SECTION 5J — TRAINING GROUPS
   *  ------------------------------------------------------------
   *  Puts each player in the standard group that trains what matters for
   *  his position. Focus skills are TM's own (training page `team_tooltips`,
   *  read live 2026-11-01). Per TM's guide (/user-guide/advanced/training/)
   *  25% of standard training goes to the focus skills, 75% at random, and a
   *  skill at 20 passes its share back to the pool. Custom programmes need
   *  TM Pro — out of scope.
   * ============================================================ */
  const TRAINING_GROUPS = {
    1: { name: 'Technical', skills: ['tec', 'pas', 'set'] },
    2: { name: 'Fitness', skills: ['str', 'sta', 'pac', 'wor'] },
    3: { name: 'Tactical', skills: ['wor', 'pos', 'pas'] },
    4: { name: 'Finishing', skills: ['fin', 'lon', 'hea'] },
    5: { name: 'Defending', skills: ['mar', 'tac', 'pos', 'hea'] },
    6: { name: 'Winger', skills: ['cro', 'pac', 'tec'] },
    7: { name: 'Goalkeeping', skills: null },
  };
  const OUTFIELD_ORDER = ['str', 'sta', 'pac', 'mar', 'tac', 'wor', 'pos', 'pas', 'cro', 'tec', 'hea', 'fin', 'lon', 'set']; // R5 weight-column order (outfieldSkillArray)
  // Value of a group's focus share for one player at one position: the mean R5 weight of its
  // focus skills; a skill already at 20 counts at the row's average (its share goes random).
  function trainingGroupValue(p, posIdx, group) {
    const w = WEIGHT_R5[posIdx];
    const avg = w.reduce((a, b) => a + b, 0) / w.length;
    const vals = group.skills.map(k => (Number(p.skills && p.skills[k]) || 0) >= 20 ? avg : w[OUTFIELD_ORDER.indexOf(k)]);
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  // Each player is trained for his slot in the current best XI, else his best natural position.
  function trainingPlan(squad) {
    const players = squad.map(p => ({ ...p }));
    const xi = bestFormation(players.filter(p => (!p.ban || p.ban === '0') && !p.inj));
    const slotOf = {};
    xi.lineup.forEach(l => { if (l.player) slotOf[String(l.player.id)] = l.slot; });
    return players.map(p => {
      if (bucketFor(p.fp) === 'GK') return { p, group: 7, slot: 'gk', starter: !!slotOf[String(p.id)] };
      const slot = slotOf[String(p.id)] || parseFavPositionCodes(p.fp).map(c => c === 'f' ? 'fc' : c)
        .filter(k => SLOT_NUM[k] != null).sort((a, b) => slotRating(p, b) - slotRating(p, a))[0] || 'mc';
      const posIdx = getPositionIndex(slot);
      const ranked = [1, 2, 3, 4, 5, 6].map(g => ({ g, v: trainingGroupValue(p, posIdx, TRAINING_GROUPS[g]) })).sort((a, b) => b.v - a.v);
      return { p, group: ranked[0].g, slot, starter: !!slotOf[String(p.id)] };
    });
  }
  async function readTrainingGroups() {
    const d = JSON.parse(await tmPost('/ajax/training_get.ajax.php', { type: 'get' }));
    return Object.fromEntries((d.players_list || []).map(x => [String(x.id), String(x.training)]));
  }
  // Moves only the players whose group is wrong, then re-reads the server to confirm.
  async function applyTrainingGroups(dryRun) {
    const current = await readTrainingGroups();
    await loadTacticsPage();
    const plan = trainingPlan(tacticsPageSquad()).filter(x => current[String(x.p.id)] != null);
    const moves = plan.filter(x => current[String(x.p.id)] !== String(x.group));
    const label = m => `${m.p.name.split(' ').pop()} → ${TRAINING_GROUPS[m.group].name}`;
    if (dryRun || !moves.length) return { ok: true, text: moves.length ? `would move ${moves.length}: ${moves.map(label).join(', ')}` : 'all groups already right', moves };
    for (const m of moves) {
      await sleep(150);
      await tmPost('/ajax/training_post.ajax.php', { type: 'player_pos', player_id: m.p.id, team_id: m.group });
    }
    const after = await readTrainingGroups();
    const wrong = moves.filter(m => after[String(m.p.id)] !== String(m.group));
    return { ok: !wrong.length, text: wrong.length ? `${wrong.length} of ${moves.length} moves didn't stick: ${wrong.map(label).join(', ')}` : `moved ${moves.length}, verified: ${moves.map(label).join(', ')}`, moves };
  }

  /* ============================================================
   *  SECTION 5K — FACILITY UPGRADES  (copilot step, off by default)
   *  ------------------------------------------------------------
   *  "Required" = the Stadium tab's own ranking (analyseStadium): training/
   *  youth tier first, then income facilities paying back within
   *  FACILITY_MAX_PAYBACK_WEEKS. Own guard rails: never a facility already
   *  building, never one with a maintenance warning, never the seat count,
   *  one per run, and only from cash beyond the wage reserve (budgetGuidance).
   * ============================================================ */
  const FACILITY_MAX_PAYBACK_WEEKS = 26; // own heuristic: about two TM seasons
  function pickFacilityUpgrade(stadiumData) {
    const ctx = stadiumContext(stadiumData);
    const budget = budgetGuidance();
    if (!ctx.fd || !budget) return { pick: null, why: 'cash or wage data missing' };
    const eligible = analyseStadium(ctx.fd, ctx.cash, ctx.attendanceRef, ctx.financials).filter(r =>
      r.key !== 'stadium' && !(ctx.fd[r.key] && ctx.fd[r.key].building) && !r.sustainabilityWarning && r.cost <= budget.spendable
      && (r.tier === 0 || (r.tier === 1 && r.paybackWeeks != null && r.paybackWeeks <= FACILITY_MAX_PAYBACK_WEEKS)));
    return { pick: eligible[0] || null, building: Object.values(ctx.fd).filter(f => f && f.building).map(f => f.title) };
  }
  async function applyFacilityUpgrade(dryRun) {
    const before = parseStadium(await fetchDoc('/stadium/'));
    setSlice('stadium', before);
    const { pick, why, building } = pickFacilityUpgrade(before);
    const busy = building && building.length ? ` (building: ${building.join(', ')})` : '';
    if (!pick) return { ok: true, text: (why || 'nothing required right now') + busy };
    const what = `${pick.title} → level ${pick.nextLevel} for ${fmtMoney(pick.cost)}`;
    if (dryRun) return { ok: true, text: 'would build ' + what };
    const res = JSON.parse(await tmPost('/ajax/stadium_change.ajax.php', { facility: pick.key, session_id: SESSION.id, level: pick.nextLevel }));
    if (!res || !res.success) return { ok: false, text: `${what} refused: ${res && res.error ? res.error : 'no reply'}` };
    const after = parseStadium(await fetchDoc('/stadium/'));
    setSlice('stadium', after);
    const f = after.facilityData && after.facilityData[pick.key];
    const verified = !!f && (f.building || f.level >= pick.nextLevel);
    return { ok: verified, text: (verified ? 'started ' : 'sent but not confirmed: ') + what };
  }

  /* ============================================================
   *  SECTION 5L — MARKET SCAN
   *  ------------------------------------------------------------
   *  Searches the transfer list itself via the page's own search
   *  (transfer.ajax.php; filter string = the page's URL-hash format) instead
   *  of waiting for you to browse. A reply holds ≤100 listings WITH full
   *  skills, ASI, age, bid — so it runs as narrow searches (position group ×
   *  age band). Listings start at 18, and without /for/ only home-nation
   *  players come back (1 v 100+ defenders, live). Routine is the one missing
   *  input: fetched per player for the shortlist tops, then re-ranked.
   *  Read-only: it never bids.
   * ============================================================ */
  const MARKET_GROUPS = ['gk', 'de', 'dm', 'mf', 'om', 'fw'];
  const MARKET_BANDS = [[18, 20], [21, 24], [25, 27]];
  const MARKET_ROUTINE_FETCH = 40;
  const MARKET_STALE_MS = 3 * 864e5; // listings run for days; older sightings are gone
  // TM writes ages as years.months: 18.11 = 18 years 11 months, 29.1 = 29 years 10 months.
  const ageMonthsFromTm = a => { const n = Number(a); if (!n) return null; const y = Math.floor(n); return y * 12 + Math.round((n - y) * 100); };
  function marketRow(x) {
    const skills = {};
    ['str', 'sta', 'pac', 'mar', 'tac', 'wor', 'pos', 'pas', 'cro', 'tec', 'hea', 'fin', 'lon', 'set', 'han', 'one', 'ref', 'ari', 'jum', 'com', 'kic', 'thr']
      .forEach(k => { if (x[k] != null && x[k] !== '') skills[k] = Number(x[k]); });
    const ageMonths = ageMonthsFromTm(x.age);
    return {
      id: String(x.id), name: x.name, fp: displayFp(x.fp_format || ''), age: ageMonths ? ageMonths / 12 : null, ageMonths,
      asi: Number(x.asi) || null, routine: x.routine != null ? Number(x.routine) : null, bid: x.bid != null ? String(x.bid) : null,
      // next_bid = the least you can bid right now (the asking price while nobody has bid — bid
      // is then 0); time = seconds left on the auction.
      nextBid: x.next_bid != null ? parseMoney(String(x.next_bid)) : null, ends: Number(x.time) > 0 ? now() + Number(x.time) * 1000 : null,
      time: x.time, nat: x.nat || null, rec: Number(x.rec) / 2 || null, skills, _seen: now(), _scan: true,
    };
  }
  // The Players page carries every player's weekly TI (plot) — read it on each run so the
  // training history and growth curve don't depend on you opening that page.
  async function refreshOwnPlayers() {
    const data = parsePlayers(await fetchDoc('/players/'));
    if (!data.length) return null;
    setSlice('players', data);
    recordSquadSnapshot(data);
    return data;
  }
  async function marketScan(onProgress) {
    const prefs = loadShortlistPrefs('senior');
    // Judge against today's squads and wage bill, read now — not whatever pages happen to be
    // cached (a fresh browser had neither, and the lists came out empty).
    onProgress && onProgress('Reading your squads and finances…');
    try {
      const [A, B] = await Promise.all([fetchOpponentSquadReal(clubId), SESSION.b_team ? fetchOpponentSquadReal(String(SESSION.b_team)) : Promise.resolve([])]);
      if (A.length) setSlice('ownSquads', { A, B });
    } catch (e) { console.warn('TM Advisor: own squads', e); }
    try { setSlice('finances', parseFinances(await fetchDoc('/finances/'))); } catch (e) { console.warn('TM Advisor: finances', e); }
    try { await refreshOwnPlayers(); } catch (e) { console.warn('TM Advisor: players', e); }
    const foreign = prefs.includeForeign !== false ? 'for/' : '';
    const searches = [];
    MARKET_GROUPS.forEach(g => MARKET_BANDS.forEach(([a, b]) => searches.push(`/${g}/${foreign}amin/${a}/amax/${b}/`)));
    const c = loadCache();
    const store = (c.transferSeen && c.transferSeen.data) || {};
    Object.keys(store).forEach(id => { if (!store[id]._seen || now() - store[id]._seen > MARKET_STALE_MS) delete store[id]; });
    let listings = 0, done = 0;
    for (const h of searches) {
      onProgress && onProgress(`Searching the market ${++done}/${searches.length}…`);
      try {
        const d = JSON.parse(await tmPost('/ajax/transfer.ajax.php', { search: h, club_id: SESSION.id }));
        const list = d && d.list ? (Array.isArray(d.list) ? d.list : Object.values(d.list)) : [];
        list.forEach(x => { if (x && x.id) { const r = marketRow(x); const prev = store[r.id]; store[r.id] = { ...prev, ...r, routine: r.routine != null ? r.routine : (prev ? prev.routine : null), wage: prev && prev.wage }; listings++; } });
      } catch (e) { console.warn('TM Advisor: market search failed', h, e); }
      await sleep(150);
    }
    setSlice('transferSeen', store);
    // Routine is worth up to ~15 R5 points, and the listing omits it — so rank once without it,
    // fetch it for the tops, then rank again.
    let senior = buildSeniorShortlist(prefs).ranked, youth = buildYouthShortlist().ranked;
    const need = senior.slice(0, MARKET_ROUTINE_FETCH).concat(youth.slice(0, 15)).filter(p => store[p.id] && store[p.id].routine == null).map(p => p.id);
    let fetched = 0;
    for (const id of need) {
      onProgress && onProgress(`Checking routine & wage ${++fetched}/${need.length}…`);
      try {
        const t = normaliseTooltipPlayer(await fetchPlayerTooltip(id));
        if (t) { store[id].routine = t.routine; store[id].wage = t.wage; delete store[id]._r5; }
      } catch (e) { console.warn('TM Advisor: routine fetch failed', id, e); }
      await sleep(120);
    }
    setSlice('transferSeen', store);
    senior = buildSeniorShortlist(prefs).ranked; youth = buildYouthShortlist().ranked;
    buildBuyLists();
    // Read any scout reports on the listed candidates, then rank again with them.
    const listed = new Set();
    const lb = (getSlice('marketBuys') || {}).data;
    ['A', 'Y'].forEach(t => lb && lb[t] && ['best', 'value'].forEach(k => lb[t][k].forEach(r => listed.add(String(r.id)))));
    let read = 0;
    for (const id of listed) {
      onProgress && onProgress(`Reading scout reports ${++read}/${listed.size}…`);
      try { const sm = scoutSummary(await scoutInfo(id)); if (store[id]) store[id].scout = sm; } catch (e) { console.warn('TM Advisor: scout report', id, e); }
      await sleep(120);
    }
    if (listed.size) { setSlice('transferSeen', store); buildBuyLists(); }
    try { buildSellList(); } catch (e) { console.warn('TM Advisor: sell list', e); }
    const summary = { t: now(), searches: searches.length, listings, unique: Object.keys(store).length, seniors: senior.filter(p => p._xi).length, youth: youth.length, foreign: !!foreign };
    setSlice('marketScan', summary);
    return summary;
  }

  /* ============================================================
   *  SECTION 5M — CUSTOM TRAINING  (TM Pro)
   *  ------------------------------------------------------------
   *  Per player, 12 dots over 6 custom groups (max 4 each). Starts from the
   *  user's role templates — identical to the "basic training regimes" in
   *  Sunshine United's forum guide "Tm's Best Youngsters & how to train them"
   *  (/forum/int/general/414096/, post #3) — then tweaks per player:
   *   • up to 2 dots move from the group with the least remaining need to
   *     the one with the most, need = the user's key skills (primary ×2,
   *     secondary ×1) × points left to 20; a group stalled for 3+ weeks
   *     counts half (likely peaked — guide post #2);
   *   • fully developed players (28+, or TI ≤ 0 for 4 weeks from 22) go
   *     2-2-2-2-2-2, the full 102/102 (guide: "if all three are peaked …
   *     continue the training at max 102/102").
   *  Goalkeepers are left alone (user: GK — nothing).
   * ============================================================ */
  // Group contents as TM sends them (players_get_info type:'training' → custom.teamN.skills).
  const CUSTOM_GROUPS = [['str', 'wor', 'sta'], ['mar', 'tac'], ['cro', 'pac'], ['pas', 'tec', 'set'], ['hea', 'pos'], ['fin', 'lon']];
  const CUSTOM_TEMPLATES = { DEF: [2, 3, 2, 2, 3, 0], MID: [2, 1, 2, 3, 2, 2], WING: [2, 1, 3, 2, 2, 2], FWD: [2, 0, 2, 2, 3, 3] };
  const CUSTOM_BALANCED = [2, 2, 2, 2, 2, 2];
  // The user's key skills per position: [primary, secondary].
  const KEY_SKILLS = {
    dlr: [['mar', 'tac'], ['str', 'sta', 'pac', 'wor', 'pos', 'pas', 'cro', 'tec', 'hea']],
    dc: [['mar', 'tac'], ['str', 'sta', 'pac', 'pos', 'wor', 'hea']],
    dmlr: [['mar', 'tac', 'pas', 'cro'], ['str', 'sta', 'pac', 'wor', 'pos', 'tec', 'hea']],
    dmc: [['mar', 'tac', 'pas', 'tec'], ['str', 'sta', 'pac', 'wor', 'pos', 'hea']],
    mc: [['pas', 'tec'], ['str', 'sta', 'pac', 'mar', 'tac', 'wor', 'pos', 'hea', 'fin']],
    mlr: [['pas', 'cro', 'tec'], ['str', 'sta', 'pac', 'mar', 'tac', 'wor', 'pos', 'hea', 'fin']],
    omc: [['pas', 'tec', 'hea', 'fin'], ['str', 'sta', 'pac', 'wor', 'pos', 'lon']],
    omlr: [['pas', 'cro', 'tec', 'fin'], ['str', 'sta', 'pac', 'wor', 'pos', 'hea']],
    f: [['hea', 'fin'], ['str', 'sta', 'pac', 'wor', 'pos', 'pas', 'tec', 'lon']],
  };
  const keySkillsFor = slot => slot === 'dl' || slot === 'dr' ? 'dlr' : slot.startsWith('dm') ? (slot === 'dml' || slot === 'dmr' ? 'dmlr' : 'dmc')
    : slot.startsWith('dc') ? 'dc' : slot.startsWith('om') ? (slot === 'oml' || slot === 'omr' ? 'omlr' : 'omc')
    : slot.startsWith('m') ? (slot === 'ml' || slot === 'mr' ? 'mlr' : 'mc') : 'f';
  const ROLE_OF_KEY = { dlr: 'DEF', dc: 'DEF', dmlr: 'DEF', dmc: 'DEF', mc: 'MID', omc: 'MID', mlr: 'WING', omlr: 'WING', f: 'FWD' };
  const CUSTOM_AGE_BALANCED = 28;   // own heuristic: TM decline starts at 29 (TM guide, basics/training)
  const CUSTOM_STALL_DAYS = 21;

  // Skill gain per custom group over the last CUSTOM_STALL_DAYS, from the daily history.
  function groupGains(playerId) {
    const h = getSlice('history');
    if (!h || !h.data) return null;
    const days = Object.keys(h.data).sort();
    const latest = days.length && (h.data[days[days.length - 1]] || []).find(x => String(x.id) === String(playerId));
    const cutoff = now() - CUSTOM_STALL_DAYS * 864e5;
    const baseDay = [...days].reverse().find(d => new Date(d).getTime() <= cutoff);
    const base = baseDay && (h.data[baseDay] || []).find(x => String(x.id) === String(playerId));
    if (!latest || !base || !latest.sk || !base.sk) return null;
    return CUSTOM_GROUPS.map(g => g.reduce((a, k) => a + ((latest.sk[k] || 0) - (base.sk[k] || 0)), 0));
  }

  // Points a custom group earns per dot count (0-4) — "TM - Players Train" v10 calculatePoint();
  // 2-2-2-2-2-2 = 102, matching the guide's "max 102/102".
  const DOT_POINTS = [0, 10, 17, 23, 25];
  const planPoints = dots => dots.reduce((a, d) => a + DOT_POINTS[d], 0);
  function customPlan(p, slot, tiHistory) {
    const key = keySkillsFor(slot), role = ROLE_OF_KEY[key];
    const age = Number(p.age) || 0;
    const recentTi = (tiHistory || []).slice(-4).map(Number).filter(v => !isNaN(v));
    if (age >= CUSTOM_AGE_BALANCED) return { dots: [...CUSTOM_BALANCED], role, why: `age ${Math.floor(age)}: development is done — balanced 2-2-2-2-2-2 keeps TI at the full 102/102` };
    if (age >= 22 && recentTi.length >= 4 && recentTi.every(v => v <= 0)) return { dots: [...CUSTOM_BALANCED], role, why: 'TI ≤ 0 for 4 weeks: looks fully peaked — balanced at 102/102 (guide)' };
    const [prim, sec] = KEY_SKILLS[key];
    // Non-key skills still count a little (they still feed R5 and SI): at 0 a group of them
    // looked free to strip, and dots piled into 4th-dot slots worth 2 points (88/102 TI).
    const weight = k => prim.includes(k) ? 2 : sec.includes(k) ? 1 : 0.25;
    const sk = k => Number(p.skills && p.skills[k]) || 0;
    const gains = groupGains(p.id);
    const dots = [...CUSTOM_TEMPLATES[role]];
    const need = CUSTOM_GROUPS.map((g, i) => {
      const n = g.reduce((a, k) => a + weight(k) * Math.max(0, 20 - sk(k)), 0);
      return gains && dots[i] >= 3 && gains[i] <= 0 ? n / 2 : n; // trained hard, nothing gained: likely peaked
    });
    const moves = [];
    for (let m = 0; m < 2; m++) {
      // Value of a dot = the group's need x the points that dot adds (or removes).
      const from = dots.map((d, i) => ({ i, r: d > 0 ? need[i] * (DOT_POINTS[d] - DOT_POINTS[d - 1]) : Infinity })).filter(x => dots[x.i] > 0).sort((a, b) => a.r - b.r)[0];
      const to = dots.map((d, i) => ({ i, r: d < 4 ? need[i] * (DOT_POINTS[d + 1] - DOT_POINTS[d]) : -1 })).sort((a, b) => b.r - a.r)[0];
      if (!from || !to || from.i === to.i || to.r < from.r * 1.5) break; // only clearly better moves
      dots[from.i]--; dots[to.i]++;
      moves.push(`${CUSTOM_GROUPS[from.i].join('/')} → ${CUSTOM_GROUPS[to.i].join('/')}`);
    }
    return { dots, role, why: `${role} template${moves.length ? '; moved ' + moves.join(', ') : ''} — ${planPoints(dots)}/102 training points` };
  }

  // Training slot per player: his slot in the first team's best XI, else his best natural slot.
  function trainingSlots(squadA, extra) {
    const players = squadA.map(p => ({ ...p }));
    const xi = bestFormation(players.filter(p => (!p.ban || p.ban === '0') && !p.inj));
    const slotOf = {};
    xi.lineup.forEach(l => { if (l.player) slotOf[String(l.player.id)] = l.slot; });
    const natural = p => parseFavPositionCodes(p.fp).map(c => c === 'f' ? 'fc' : c).filter(k => SLOT_NUM[k] != null)
      .sort((a, b) => slotRating(p, b) - slotRating(p, a))[0] || 'mc';
    return squadA.concat(extra || []).map(p => ({ p, slot: slotOf[String(p.id)] || natural(p) }));
  }

  async function readCustomTraining(playerId) {
    const d = JSON.parse(await tmPost('/ajax/players_get_info.ajax.php', { player_id: playerId, type: 'training', show_non_pro_graphs: true }));
    return d && d.custom ? d.custom : null;
  }
  // Same fields TM's own player page posts (mirrored by "TM Player Enhanced" 1.7.0).
  function customPayload(playerId, cur, dots) {
    const d = { type: 'custom', on: 1, player_id: playerId, 'custom[points_spend]': 0, 'custom[player_id]': playerId, 'custom[saved]': '' };
    for (let i = 0; i < 6; i++) {
      const t = cur.custom['team' + (i + 1)] || {};
      const p = `custom[team${i + 1}]`;
      d[`${p}[num]`] = i + 1; d[`${p}[label]`] = t.label || `Team ${i + 1}`; d[`${p}[points]`] = dots[i]; d[`${p}[skills][]`] = t.skills || [];
    }
    return d;
  }

  // Every player is on custom training (Pro), so the standard groups are never touched (user).
  async function trainingStep(dryRun) {
    return applyCustomTraining(dryRun);
  }

  async function applyCustomTraining(dryRun) {
    await loadTacticsPage();
    const squadA = tacticsPageSquad();
    const squadB = squadFromTacticsData(JSON.parse(await tmPost('/ajax/tactics_get.ajax.php', tmBase(1))));
    const tiOf = Object.fromEntries(((getSlice('players') || { data: [] }).data || []).map(p => [String(p.id), p.plot || []]));
    const rows = trainingSlots(squadA, squadB).filter(x => bucketFor(x.p.fp) !== 'GK');
    const changes = [], failed = [], plans = [];
    const bIds = new Set(squadB.map(x => String(x.id)));
    for (const { p, slot } of rows) {
      const plan = customPlan(p, slot, tiOf[String(p.id)]);
      plans.push({ id: String(p.id), name: p.name, age: p.age, team: bIds.has(String(p.id)) ? 'B' : 'A', slot, dots: plan.dots, why: plan.why });
      let cur;
      try { cur = await readCustomTraining(p.id); } catch (e) { failed.push(p.name); continue; }
      if (!cur || !cur.custom) { failed.push(p.name); continue; }
      const now6 = [1, 2, 3, 4, 5, 6].map(i => Number(cur.custom['team' + i] && cur.custom['team' + i].points) || 0);
      if (cur.custom_on && now6.join() === plan.dots.join()) continue;
      changes.push({ p, from: now6, plan, off: !cur.custom_on });
      if (dryRun) continue;
      await sleep(150);
      await tmPost('/ajax/training_post.ajax.php', customPayload(p.id, cur, plan.dots));
      await sleep(120);
      const after = await readCustomTraining(p.id);
      const got = [1, 2, 3, 4, 5, 6].map(i => Number(after && after.custom && after.custom['team' + i] && after.custom['team' + i].points) || 0);
      if (!after || !after.custom_on || got.join() !== plan.dots.join()) failed.push(p.name);
    }
    if (!dryRun) setSlice('trainingPlans', plans);
    const label = c => `${c.p.name.split(' ').pop()} ${c.off && c.from.join('') === c.plan.dots.join('') ? 'custom training switched on' : c.from.join('') + '→' + c.plan.dots.join('')}`;
    if (!changes.length && !failed.length) return { ok: true, text: `all ${rows.length} outfield plans already right` };
    return { ok: !failed.length, text: (dryRun ? 'would change ' : 'changed ') + `${changes.length}: ${changes.map(label).join(', ')}` + (failed.length ? ` — not saved/verified: ${failed.join(', ')}` : ''), changes };
  }

  /* ============================================================
   *  SECTION 5N — RESERVE TEAM
   *  ------------------------------------------------------------
   *  The reserves exist to give youths minutes (routine). Players ≤ 21 who
   *  aren't in the first team's best XI or its 5 subs are demoted (TM's own
   *  `check` first; a demotion ties a player down for ≥3 games — TM's text);
   *  a reserve youth who'd make the first XI better is promoted. Then the
   *  reserves get a full plan for THEIR next opponent (XI with youths ahead
   *  of veterans, bench, roles, settings, conditional orders), lock-guarded.
   * ============================================================ */
  const RESERVE_MAX_AGE = 21;
  const RESERVE_YOUTH_BOOST = 1.5; // own heuristic: youths start for the reserves unless badly out of position

  async function playersMove(playerId, move) {
    return JSON.parse(await tmPost('/ajax/players_move.ajax.php', { player_id: playerId, move }));
  }

  async function manageReserves(dryRun) {
    await loadTacticsPage();
    const squadA = tacticsPageSquad();
    const resData = JSON.parse(await tmPost('/ajax/tactics_get.ajax.php', tmBase(1)));
    const squadB = squadFromTacticsData(resData);
    const sl = k => { const x = getSlice(k); return x && x.data; };
    const planA = buildMatchPlan(squadA, sl('opponent'), sl('opponentScouting'), sl('opponentExpected'), { restBanRisk: restBanRisk() });
    const keep = new Set(planA.best.lineup.filter(l => l.player).map(l => String(l.player.id)).concat(planA.bench.named.filter(b => b.player).map(b => String(b.player.id))));
    const down = squadA.filter(p => (Number(p.age) || 99) < RESERVE_MAX_AGE + 1 && !keep.has(String(p.id)));
    const ctx = { squad: squadA.map(p => ({ ...p })), base: bestFormation(squadA.map(p => ({ ...p }))) };
    const up = squadB.filter(p => (Number(p.age) || 99) < RESERVE_MAX_AGE + 1 && xiImpact(p, ctx).gain >= SENIOR_CRITERIA.minXiGain);
    // XI + 5 subs = 16: below that the first team can't name a full bench, so the best fit B
    // players (any age) go up, by how much they'd add to the XI.
    const fit = p => (!p.ban || p.ban === '0') && !p.inj;
    const downIds = new Set(down.map(p => String(p.id)));
    const short16 = 16 - squadA.filter(p => fit(p) && !downIds.has(String(p.id))).length - up.filter(fit).length;
    if (short16 > 0) {
      const upIds = new Set(up.map(p => String(p.id)));
      squadB.filter(p => fit(p) && !upIds.has(String(p.id)))
        .map(p => ({ p, g: xiImpact(p, ctx).gain })).sort((x, y) => y.g - x.g)
        .slice(0, short16).forEach(x => up.push(x.p));
    }
    const lines = [];
    const short = p => p.name.split(' ').pop();
    for (const p of down) {
      const chk = await playersMove(p.id, 'check');
      if (chk && chk.error) { lines.push(`${short(p)} can't go down (${String(chk.error).replace(/\[player\]/g, short(p)).replace(/<[^>]+>/g, '')})`); continue; }
      if (dryRun) { lines.push(`would demote ${short(p)}`); continue; }
      await sleep(150);
      const r = await playersMove(p.id, 'down');
      lines.push(r && r.success ? `demoted ${short(p)}` : `${short(p)} not demoted: ${r && r.error ? String(r.error).replace(/<[^>]+>/g, '') : 'no reply'}`);
    }
    for (const p of up) {
      if (dryRun) { lines.push(`would promote ${short(p)}`); continue; }
      await sleep(150);
      const r = await playersMove(p.id, 'up');
      lines.push(r && !r.error ? `promoted ${short(p)}` : `${short(p)} not promoted: ${r && r.error ? String(r.error).replace(/<[^>]+>/g, '') : 'no reply'}`);
    }
    const tactic = await applyReservePlan(dryRun);
    lines.push(tactic.text);
    return { ok: tactic.ok, text: lines.join('; ') || 'nothing to move' };
  }

  // Next reserve fixture + its real kickoff. match.ajax gives the time of day in SERVER time (the
  // first team's says 19:00 while its home page shows 20:00, live), so it's anchored to the first
  // team's known kickoff instant rather than to any time zone.
  async function fixturesOf(teamId) {
    const fx = JSON.parse(await (await fetch('/ajax/fixtures.ajax.php', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'type=club&var1=' + teamId })).text()) || {};
    const ms = [];
    Object.values(fx).forEach(mo => (mo && mo.matches || []).forEach(m => ms.push(m)));
    return ms;
  }
  // TM simulates matches ahead of kickoff, so a match that's locked already carries its result
  // here (live) — "next unplayed" is then the following fixture, which is what we want to prepare.
  async function nextFixtureOf(teamId) {
    return (await fixturesOf(teamId)).filter(m => !m.result).sort((x, y) => String(x.date).localeCompare(String(y.date)))[0] || null;
  }
  async function nextReserveFixture() {
    const club = nextFixtureOf;
    const b = await club(SESSION.b_team);
    if (!b) return null;
    const bJson = await fetchMatchJson(b.id);
    const nm = getSlice('home') && getSlice('home').data && getSlice('home').data.nextMatch;
    const aKick = nm ? parseKickoff(nm.when) : null;
    // Anchor on the SAME match the home page shows (by id) — not "first unplayed", which skips a
    // match TM has already simulated and shifted the reserve kickoff by days (seen live).
    const aId = nm && nm.matchUrl ? (nm.matchUrl.match(/\/matches\/(\d+)/) || [])[1] : null;
    const a = aKick && aId ? (await fixturesOf(clubId)).find(m => String(m.id) === String(aId)) || null : null;
    const aJson = a ? await fetchMatchJson(a.id) : null;
    const wall = (date, tod) => { const [y, mo, d] = String(date).split('-').map(Number); const [h, mi] = String(tod || '').split(':').map(Number); return isNaN(h) ? null : new Date(y, mo - 1, d, h, mi).getTime(); };
    const aWall = a && aJson && aJson.match_data ? wall(a.date, aJson.match_data.match_time_of_day) : null;
    const bWall = bJson && bJson.match_data ? wall(b.date, bJson.match_data.match_time_of_day) : null;
    const weAreHome = String(b.hometeam) === String(SESSION.b_team);
    return {
      id: String(b.id), matchUrl: '/matches/' + b.id + '/', weAreHome,
      oppId: String(weAreHome ? b.awayteam : b.hometeam), oppName: weAreHome ? b.awayteam_name : b.hometeam_name,
      kickoff: aKick && aWall != null && bWall != null ? bWall + (aKick - aWall) : null,
    };
  }

  // Full reserve plan for their next opponent: youths-first XI, bench, roles, mentality/style/
  // focus and conditional orders — the first-team engine, with the reserves' own fixture.
  async function applyReservePlan(dryRun) {
    const fix = await nextReserveFixture();
    if (!fix) return { ok: true, text: 'no reserve fixture coming up' };
    const data = JSON.parse(await tmPost('/ajax/tactics_get.ajax.php', tmBase(1)));
    const squad = squadFromTacticsData(data);
    if (squad.filter(p => (!p.ban || p.ban === '0') && !p.inj).length < 11) return { ok: true, text: `reserve tactic skipped: only ${squad.length} players` };
    const opp = await fetchOpponentSquadReal(fix.oppId).catch(() => []);
    const opponent = opp.length ? { id: fix.oppId, name: fix.oppName, players: opp, source: 'real-skills' } : null;
    const expected = opponent ? await fetchNextMatchExpected(fix.matchUrl, fix.oppId, opp).catch(() => null) : null;
    const boost = p => (Number(p.age) || 99) < RESERVE_MAX_AGE + 1 ? RESERVE_YOUTH_BOOST : 1;
    const scouting = opponent ? await buildOpponentScoutingReport(fix.oppId, opp, SESSION.b_team).catch(() => null) : null;
    const plan = buildMatchPlan(squad, opponent, scouting, expected, { boost, weAreHome: fix.weAreHome, noEvidence: true, restBanRisk: restBanRisk() });
    const youths = plan.best.lineup.filter(l => l.player && boost(l.player) > 1).length;
    const record = ok => setSlice('reservePlan', {
      matchId: fix.id, matchUrl: fix.matchUrl, opp: fix.oppName, weAreHome: fix.weAreHome, kickoff: fix.kickoff,
      formation: plan.best.formation, settings: plan.settings, youths, scouted: !!scouting, orders: (plan.condOrders || []).length,
      xi: plan.best.lineup.filter(l => l.player).map(l => ({ slot: l.slot, id: String(l.player.id), name: l.player.name, age: l.player.age })),
      ok,
    });
    const what = `reserves v ${fix.oppName}: ${plan.best.formation}, ${MENTALITY[plan.settings.mentality]} / ${ATT_STYLE[plan.settings.style]} / ${FOCUS_SIDE[plan.settings.focus]}, ${youths} youths starting`;
    if (!fix.kickoff) return { ok: false, text: `${what} — reserve kickoff unknown, nothing saved` };
    if (fix.kickoff - now() < TACTICS_LOCK_MS + AUTOPILOT_SAFETY_MS) return { ok: true, text: `${what} — skipped: that match locks an hour before kickoff` };
    const target = planToTactic(plan);
    const saved = await readSavedTactic(1);
    const changes = tacticDiff(target, saved);
    if (dryRun) { record(!changes.length); return { ok: true, text: `would set ${what} (${changes.length} change(s))` }; }
    if (changes.length) await writeTactic(target, saved, 1);
    const mismatches = tacticMismatches(target, await readSavedTactic(1));
    record(!mismatches.length);
    return { ok: !mismatches.length, text: mismatches.length ? `${what} — these didn't stick: ${mismatches.join(', ')}` : `set ${what} — verified` };
  }

  /* ============================================================
   *  SECTION 5O — YOUTH PULLS  (weekly youth-academy report)
   *  ------------------------------------------------------------
   *  User rule: hire potential ≥ 17 where the position is needed, fire the
   *  rest. Potential at pull is the "real" one (forum guide, post #2: 17-20
   *  at pull ≈ 100k-500k peak SI). The report's documented fields carry no
   *  potential (youth.js shows rec_stars only), so the engine acts ONLY when
   *  a potential value is actually present — otherwise it grades and
   *  recommends, and never fires on a guess. Never hires past TM's 70-man cap.
   * ============================================================ */
  const YOUTH_PULL_MIN_POT = 17;
  const YOUTH_PULL_ALWAYS_POT = 19; // own heuristic: too good to pass whatever the position
  const SQUAD_CAP = 70;             // TM's youth page: < 70 players when not in debt
  function recruitPotential(raw) {
    for (const k of ['old_pot', 'potential', 'pot', 'youth_potential']) {
      const v = Number(raw && raw[k]);
      if (raw && raw[k] != null && raw[k] !== '' && !isNaN(v) && v > 0) return v <= 10 ? v * 2 : v; // ≤10 = half-stars (YD report 'potential' 9 ↔ old_pot 17-18)
    }
    return null;
  }
  // Depth per line v the XI's needs: 2 natural players per XI slot (own heuristic), +1 where the
  // first XI's weakest starter plays.
  function positionNeeds(squad) {
    const best = bestFormation(squad.map(p => ({ ...p })));
    const slots = {}, have = {};
    best.lineup.forEach(l => { slots[l.bucket] = (slots[l.bucket] || 0) + 1; });
    squad.forEach(p => { const b = bucketFor(p.fp); have[b] = (have[b] || 0) + 1; });
    const need = {};
    Object.keys(slots).forEach(b => { need[b] = slots[b] * 2 - (have[b] || 0); });
    const weakest = best.lineup.filter(l => l.player).sort((a, b) => a.effectiveR5 - b.effectiveR5)[0];
    if (weakest) need[weakest.bucket] = (need[weakest.bucket] || 0) + 1;
    return need;
  }

  async function handleYouthPull(dryRun) {
    const rep = JSON.parse(await tmPost('/ajax/youth.ajax.php', { type: 'get' }));
    const recruits = Object.values((rep && rep.players) || {}).filter(Boolean);
    if (!recruits.length) return { ok: true, idle: true, text: 'no youth report waiting (they arrive on Saturdays)' };
    await loadTacticsPage();
    const need = positionNeeds(tacticsPageSquad());
    let size = Number(rep.squad_size) || 0;
    const lines = [];
    for (const raw of recruits) {
      const fp = fpFromCodes(raw.favposition) || 'M C', bucket = bucketFor(fp);
      const pot = recruitPotential(raw);
      const g = gradeYouthRecruit(raw);
      const label = `${String(raw.player_name || raw.id).split(' ').pop()} (${fp}${pot ? ', pot ' + pot : ''})`;
      if (pot == null) { lines.push(`${label}: no potential in the report — ${g.hidden ? 'reveal skills' : (g.verdict ? g.verdict.verdict : '?')}; left for you`); continue; }
      const hire = pot >= YOUTH_PULL_ALWAYS_POT || (pot >= YOUTH_PULL_MIN_POT && (need[bucket] || 0) > 0);
      if (hire && size >= SQUAD_CAP) { lines.push(`${label}: would hire, but the squad is at ${size}`); continue; }
      if (dryRun) { lines.push(`${label}: would ${hire ? 'hire' : 'fire'}`); continue; }
      await sleep(200);
      const r = await tmPost('/ajax/youth.ajax.php', { type: 'act', player_id: raw.id, action: hire ? 'hire' : 'fire' });
      if (hire) size++;
      lines.push(`${label}: ${hire ? 'hired' : 'fired'}${/error/i.test(r) ? ' — reply: ' + r.slice(0, 80) : ''}`);
    }
    const after = JSON.parse(await tmPost('/ajax/youth.ajax.php', { type: 'get' }));
    const left = Object.values((after && after.players) || {}).filter(Boolean).length;
    const acted = lines.filter(l => /: (hired|fired)/.test(l)).length;
    return { ok: dryRun || acted === 0 || left <= recruits.length - acted, text: lines.join('; ') };
  }

  /* ============================================================
   *  SECTION 5P — SCOUTING
   *  ------------------------------------------------------------
   *  Keeps ONE youth scout (20 Yth AND 20 Dev — development is what a youth
   *  report is for) and ONE senior scout (20 Sen) — user rule:
   *  anything less isn't worth the wage, and a scout with 20 in both is a waste
   *  (one player at a time, inflated wage). The guide: Yth judges players ≤19,
   *  Sen 20+, Dev the bloom, Phy/Tac/Tec the specialist peaks, Psy the hidden
   *  traits. Free scouts then go to own players without a fresh report: the
   *  youth scout to the ≤19s, the senior scout to the 20+ (youngest first).
   * ============================================================ */
  const SCOUT_MIN = 20;
  const SCOUT_REPORT_FRESH_MS = 8 * 7 * 864e5;
  const SCOUT_COLS = ['sen', 'yth', 'phy', 'tac', 'tec', 'dev', 'psy'];
  const SCOUT_BUDGET_SHARE = 0.05; // heuristic: sign-on fee + 26 weeks' wage within 5% of cash
  // A player's scout reports, reduced to what a projection can use. Reliability and the peak
  // sums are "TM - Players Scout" v9's: potential only from Yth (age < 20) or Sen (20+) ≥ 19 with
  // Dev ≥ 19; development/bloom from Dev ≥ 19; each peak from that skill ≥ 19.
  const SCOUT_RELIABLE = 19;
  const PEAK_SUMS = { out: { phy: [64, 70, 74, 80], tac: [64, 70, 74, 80], tec: [96, 105, 111, 120] }, gk: { phy: [64, 70, 74, 80], tac: [50, 55, 60], tec: [68, 74, 80] } };
  // Development left after the report (heuristic multipliers on projected growth).
  const DEV_LEFT = { 'Mostly ahead': 1.2, 'Middle': 1, 'Mostly done': 0.5, 'Done': 0.1 };
  function scoutSummary(info) {
    const reports = Object.values((info && info.reports) || {}).filter(r => r && String(r.scoutid) !== '0');
    if (!reports.length) return null;
    const scouts = (info && info.scouts) || {};
    const ok = (r, k) => { const sc = scouts[r.scoutid] || Object.values(scouts).find(x => String(x.id) === String(r.scoutid)); return sc && Number(sc[k]) >= SCOUT_RELIABLE; };
    const out = { done: null };
    reports.sort((a, b) => new Date(b.done) - new Date(a.done)).forEach(r => {
      out.done = out.done || r.done;
      const age = Number(r.report_age);
      if (out.potential == null && ok(r, 'development') && ok(r, age < 20 ? 'youths' : 'seniors')) { out.potential = Number(r.old_pot); out.potRec = Number(r.potential) / 2; }
      if (out.dev == null && ok(r, 'development') && r.dev_status) { out.dev = String(r.dev_status).trim(); out.bloom = r.bloom_status_txt ? String(r.bloom_status_txt).trim() : null; }
      [['phy', 'physical', 'peak_phy_txt'], ['tac', 'tactical', 'peak_tac_txt'], ['tec', 'technical', 'peak_tec_txt']].forEach(([k, sk, f]) => {
        const lvl = r[f] && (String(r[f]).match(/\((\d)\/4\)/) || [])[1];
        if (lvl && (out.peaks || {})[k] == null && ok(r, sk)) (out.peaks = out.peaks || {})[k] = Number(lvl);
      });
    });
    return out.potential != null || out.dev || out.peaks ? out : null;
  }
  async function scoutInfo(playerId) {
    return JSON.parse(await tmPost('/ajax/players_get_info.ajax.php', { player_id: playerId, type: 'scout', show_non_pro_graphs: true }));
  }
  // Rows of /scouts/ (yours) and /scouts/hire/ share the layout: name (+ "Wage: 76,868, Sign-on
  // fee: 6 Mil" on the hire list), then Sen Yth Phy Tac Tec Dev Psy. A blank cell reads as 0.
  function parseScoutRows(doc) {
    const out = [];
    doc.querySelectorAll('tr').forEach(tr => {
      const td = [...tr.querySelectorAll('td')];
      if (td.length < 8) return;
      const nameEl = td[0].querySelector('span') || td[0];
      const sub = td[0].textContent;
      const wage = sub.match(/Wage:\s*([\d,]+)/), fee = sub.match(/Sign-on fee:\s*([\d.]+)\s*(Mil|K)?/i);
      const btn = tr.querySelector('a[href*="hire_scout_pop"]');
      const s = { name: nameEl.textContent.replace(/\(\d+ Years\)/, '').replace(/\s+/g, ' ').trim(),
        id: btn ? ((btn.getAttribute('href') || '').match(/,\s*(\d+)\s*\)/) || [])[1] : null,
        wage: wage ? Number(wage[1].replace(/,/g, '')) : 0,
        fee: fee ? Number(fee[1]) * (/mil/i.test(fee[2] || '') ? 1e6 : /k/i.test(fee[2] || '') ? 1e3 : 1) : 0 };
      SCOUT_COLS.forEach((k, i) => { s[k] = Number(td[i + 1].textContent.trim()) || 0; });
      out.push(s);
    });
    return out;
  }
  // Scout value per role (user rule + guide): the role's own skill at 20 is required (Yth for
  // youths, Sen for 20+) plus at least one more useful 20. What each extra skill is worth comes
  // from the guide's scouting page — Dev judges bloom/development (what a youth report is for),
  // Phy/Tac/Tec the specialist peaks, Psy the hidden traits; the other age skill is wasted.
  // "TM - Players Scout" v9 trusts 19s as well, so a 19 counts part (weights are heuristics).
  const SCOUT_SKILL_VALUE = {
    youth: { dev: 3, phy: 1, tac: 1, tec: 1, psy: 1 },
    senior: { dev: 1.5, phy: 1.5, tac: 1.5, tec: 1.5, psy: 1 },
  };
  const SCOUT_COST_WEEKS = 26; // heuristic horizon: sign-on fee + half a year of wages
  const scoutLevel = v => v >= SCOUT_MIN ? 1 : v >= 19 ? 0.6 : 0;
  const scoutKey = role => role === 'youth' ? 'yth' : 'sen';
  function scoutValue(s, role) {
    if (s[scoutKey(role)] < SCOUT_MIN) return null;
    const w = SCOUT_SKILL_VALUE[role];
    const extras = Object.keys(w).filter(k => s[k] >= SCOUT_MIN);
    if (!extras.length) return null; // a bare Yth/Sen 20 reads ability, not what the player will become
    return 3 + Object.entries(w).reduce((t, [k, x]) => t + x * scoutLevel(s[k]), 0);
  }
  const scoutCost = s => (s.fee || 0) + SCOUT_COST_WEEKS * (s.wage || 0);
  const scoutRoi = (s, role) => { const v = scoutValue(s, role); return v == null ? null : v / Math.max(0.1, scoutCost(s) / 1e6); };
  const scoutRole = s => scoutValue(s, 'youth') != null && s.sen < SCOUT_MIN ? 'youth' : scoutValue(s, 'senior') != null && s.yth < SCOUT_MIN ? 'senior' : s.sen >= SCOUT_MIN && s.yth >= SCOUT_MIN ? 'both' : null;
  // Best value for money among the qualifiers; a Sen+Yth double-20 only when nothing else is.
  function bestScoutFor(list, role) {
    const ok = list.filter(s => scoutValue(s, role) != null);
    const single = ok.filter(s => scoutRole(s) === role);
    const pool = single.length ? single : ok;
    if (!pool.length) return null;
    // Value for money decides; within 10% of the best, the more capable scout wins (heuristic).
    const top = Math.max(...pool.map(s => scoutRoi(s, role)));
    return pool.filter(s => scoutRoi(s, role) >= top * 0.9).sort((x, y) => scoutValue(y, role) - scoutValue(x, role) || scoutRoi(y, role) - scoutRoi(x, role))[0];
  }
  async function hireMissingScouts(mine, dryRun) {
    const covered = r => mine.some(s => scoutRole(s) === r || scoutRole(s) === 'both');
    const need = ['youth', 'senior'].filter(r => !covered(r));
    if (!need.length) return [];
    const market = parseScoutRows(await fetchDoc('/scouts/hire/'));
    const cash = Number(SESSION.cash) || 0;
    const lines = [];
    for (const role of need) {
      const s = bestScoutFor(market, role);
      if (!s) { lines.push(`no ${role} scout with 20 ${role === 'youth' ? 'Yth' : 'Sen'} + another useful 20 on the hire list yet`); continue; }
      const stats = SCOUT_COLS.map(k => k[0].toUpperCase() + k.slice(1) + ' ' + s[k]).join('/') + ` · value ${scoutValue(s, role).toFixed(1)} for ${fmtMoney(scoutCost(s))} over ${SCOUT_COST_WEEKS}wk`;
      if (!s.id) { lines.push(`${s.name} qualifies as ${role} scout but has no Hire button`); continue; }
      if (scoutCost(s) > SCOUT_BUDGET_SHARE * cash) { lines.push(`${s.name} (${role}, ${stats}) is too dear: ${fmtMoney(s.fee)} fee + ${fmtMoney(s.wage)}/wk`); continue; }
      if (dryRun) { lines.push(`would hire ${s.name} as ${role} scout (${stats}; ${fmtMoney(s.fee)} + ${fmtMoney(s.wage)}/wk)`); continue; }
      await tmPost('/scouts/hire/', { session_id: SESSION.id, scout_hire: 1, scout: s.id }); // the page's own hire form
      await sleep(300);
      const after = parseScoutRows(await fetchDoc('/scouts/'));
      const got = after.some(x => x.name === s.name);
      if (got) { mine.push(s); market.splice(market.indexOf(s), 1); }
      lines.push(got ? `hired ${s.name} as ${role} scout (${stats}; ${fmtMoney(s.fee)} + ${fmtMoney(s.wage)}/wk)` : `${s.name} not hired — not on your scouts page after the post`);
    }
    return lines;
  }
  async function scoutingStep(dryRun) {
    const mine = parseScoutRows(await fetchDoc('/scouts/'));
    const lines = await hireMissingScouts(mine, dryRun);
    await loadTacticsPage();
    const squadA = tacticsPageSquad();
    const squadB = squadFromTacticsData(JSON.parse(await tmPost('/ajax/tactics_get.ajax.php', tmBase(1))));
    const info = await scoutInfo(squadA[0].id);
    const scouts = Object.values((info && info.scouts) || {});
    if (!scouts.length) return { ok: true, text: lines.join('; ') || 'no scouts hired' };
    const roleOf = sc => { const row = mine.find(m => m.name === `${sc.name} ${sc.surname}`.trim()); return row ? scoutRole(row) : null; };
    const free = scouts.filter(sc => !sc.away);
    if (!free.length) return { ok: true, text: lines.concat(`all ${scouts.length} scout(s) out (${scouts.map(sc => sc.returns || 'away').join(', ')})`).join('; ') };
    const summaries = (getSlice('scoutSummaries') || {}).data || {};
    const fresh = async p => {
      await sleep(120);
      const inf = await scoutInfo(p.id);
      const sm = scoutSummary(inf);
      if (sm) summaries[String(p.id)] = sm;
      const reports = Object.values((inf || {}).reports || {});
      return reports.some(r => String(r.scoutid) !== '0' && r.done && now() - new Date(r.done).getTime() < SCOUT_REPORT_FRESH_MS);
    };
    const all = squadA.concat(squadB).sort((x, y) => (Number(x.age) || 99) - (Number(y.age) || 99));
    // Before you bid: the best transfer candidates without a report, whose auction runs long
    // enough for the scout to come back (heuristic: over 2 days left).
    const buys = (getSlice('marketBuys') || {}).data;
    const targets = [];
    ['A', 'Y'].forEach(t => buys && buys[t] && buys[t].best.slice(0, 3).concat(buys[t].value.slice(0, 2)).forEach(r => {
      if (!r.scout && r.ends && r.ends - now() > 2 * 864e5 && !targets.some(x => x.id === r.id)) targets.push({ id: r.id, name: r.name, age: r.age, target: true });
    }));
    const taken = new Set();
    for (const sc of free) {
      const role = roleOf(sc);
      const fits = p => role === 'senior' ? Number(p.age) >= 20 : role === 'youth' ? Number(p.age) < 20 : Number(p.age) <= RESERVE_MAX_AGE;
      const pool = targets.filter(p => !taken.has(String(p.id)) && fits(p)).concat(all.filter(p => !taken.has(String(p.id)) && fits(p)));
      let target = null;
      for (const p of pool) { if (!(await fresh(p))) { target = p; break; } }
      if (!target) { lines.push(`${sc.name} ${sc.surname}: everyone in range has a recent report`); continue; }
      taken.add(String(target.id));
      if (dryRun) { lines.push(`would send ${sc.name} ${sc.surname} to ${target.name}`); continue; }
      await sleep(200);
      await tmPost('/ajax/players_get_info.ajax.php', { player_id: target.id, type: 'scout', scout_id: sc.id, show_non_pro_graphs: true });
      lines.push(`sent ${sc.name} ${sc.surname}${role ? ` (${role})` : ''} to ${target.name}${target.target ? ' (transfer target)' : ''}`);
    }
    setSlice('scoutSummaries', summaries);
    return { ok: true, text: lines.join('; ') };
  }

  /* ============================================================
   *  SECTION 6 — STADIUM ENGINE
   * ============================================================ */

  function parseMoney(s) {
    if (s == null) return 0;
    const str = String(s).trim();
    // Was previously /-/.test(str), which matches a hyphen ANYWHERE in the string —
    // including ones from unrelated concatenated text, which is exactly what silently
    // flipped the fans-based seat target negative. Only a leading minus or a parenthetical
    // (common accounting negative notation) actually means "negative" here.
    const neg = /^-/.test(str) || /^\(.*\)$/.test(str);
    const n = parseFloat(str.replace(/[^\d.]/g, '')) || 0;
    return neg ? -n : n;
  }

  // Priority tiering per the user's own community-sourced tip: push Youth Academy / Training
  // Ground facilities first (they compound — better youth intake and training every week
  // from here on), THEN income-generating facilities (fastest cash payback), THEN everything
  // else (attendance/quality-of-life). This is a stated community heuristic we can't verify
  // against TM's actual mechanics from scraped data alone — flagged in the UI, not silently
  // treated as fact.
  const PRIORITY0_KEYWORDS = ['youth', 'academy', 'training', 'coach'];
  const MONEY_FACILITIES = ['fastfood', 'merc_stand', 'merc_store', 'restaurant', 'sausage'];
  const ATTENDANCE_FACILITIES = ['parking', 'toilets', 'lights'];

  function priorityTier(key, title) {
    const t = (key + ' ' + (title || '')).toLowerCase();
    if (PRIORITY0_KEYWORDS.some(k => t.includes(k))) return 0;
    if (MONEY_FACILITIES.includes(key)) return 1;
    return 2;
  }

  // financials: { weeklyIncome, weeklyMaintenance } — both optional; when present we flag
  // any upgrade whose maintenance increase would eat more than half the current headroom
  // (income minus existing maintenance), since a "profitable on paper" upgrade can still be
  // reckless if it leaves no buffer for a bad run of attendances.
  function analyseStadium(facilityData, cash, attendanceRef, financials) {
    if (!facilityData) return [];
    const results = [];
    const headroom = financials && financials.weeklyIncome != null && financials.weeklyMaintenance != null
      ? financials.weeklyIncome - financials.weeklyMaintenance : null;
    Object.entries(facilityData).forEach(([key, f]) => {
      if (!f || typeof f.level !== 'number') return;
      const nextLevel = f.level + 1;
      if (!f.level_cost || f.level_cost[nextLevel] === undefined) return; // maxed
      const cost = f.level_cost[nextLevel];
      const maintNow = f.maintenance ? (f.maintenance[f.level - 1] || 0) : 0;
      const maintNext = f.maintenance ? (f.maintenance[nextLevel - 1] || 0) : 0;
      const maintDelta = maintNext - maintNow;
      let weeklyGain = null, note = '';
      const tier = priorityTier(key, f.title);
      if (MONEY_FACILITIES.includes(key) && attendanceRef) {
        const strip = s => { const m = (s || '').match(/(\d+(\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
        const perSpecNow = strip(f.level_effect[f.level]);
        const perSpecNext = strip(f.level_effect[nextLevel]);
        weeklyGain = (perSpecNext - perSpecNow) * attendanceRef - maintDelta;
        note = '+' + (perSpecNext - perSpecNow).toFixed(1) + ' income/spectator, ~' + attendanceRef + ' attendance assumed.';
      } else if (ATTENDANCE_FACILITIES.includes(key)) {
        note = 'Indirectly boosts attendance (' + (f.level_effect[nextLevel] || '') + ') → higher gate & merchandise revenue across the board.';
      } else if (tier === 0) {
        note = 'Youth Academy / Training Ground-type facility — community tip says prioritise these ahead of pure income facilities since their benefit compounds over every future week, not just this one.';
      } else {
        note = f.entity ? ('Improves: ' + f.entity) : 'Quality-of-life / performance facility (injury reduction, training boost, etc).';
      }
      const paybackWeeks = weeklyGain && weeklyGain > 0 ? (cost / weeklyGain) : null;
      let sustainabilityWarning = null;
      if (headroom != null && maintDelta > 0 && maintDelta > headroom * 0.5) {
        sustainabilityWarning = 'Tight: this upgrade\'s maintenance increase (' + maintDelta.toLocaleString() + '/wk) would eat over half your current income-minus-maintenance headroom (~' + headroom.toLocaleString() + '/wk). Fine if you have cash reserves as a buffer, risky if you don\'t.';
      }
      results.push({
        key, title: f.title, level: f.level, nextLevel, cost, maintDelta, weeklyGain, paybackWeeks, note, tier,
        affordable: cash != null ? cost <= cash : null,
        sustainabilityWarning,
      });
    });
    // Rank: affordable first, then by priority tier (YA/TG > income > rest), then fastest payback within tier.
    results.sort((a, b) => {
      if (a.affordable !== b.affordable) return a.affordable ? -1 : 1;
      if (a.tier !== b.tier) return a.tier - b.tier;
      const pa = a.paybackWeeks == null ? Infinity : a.paybackWeeks;
      const pb = b.paybackWeeks == null ? Infinity : b.paybackWeeks;
      return pa - pb;
    });
    return results;
  }

  // Inputs analyseStadium needs — one place, shared by the Stadium tab and the copilot's facility
  // step, so "pays back" means the same thing in both.
  function stadiumContext(stadiumData) {
    const financesSlice = getSlice('finances'), homeSlice = getSlice('home'), maintenanceSlice = getSlice('maintenance');
    const stadiumSlice = { data: stadiumData || {} };
    // Cash source priority: Finances balance (confirmed reliable — regex matches "Current
    // Balance:" text directly) > Home page inline var > Stadium page inline var. The inline
    // SESSION["cash"]/manager_cash regexes are best-effort since the exact JS var name can
    // change; Finances is the one place we're always sure of the number.
    let cash = null;
    if (financesSlice && financesSlice.data.balance != null) cash = financesSlice.data.balance;
    else if (homeSlice && homeSlice.data.cash != null) cash = homeSlice.data.cash;
    else if (stadiumSlice.data.cash != null) cash = stadiumSlice.data.cash;
    const fd = stadiumSlice.data.facilityData;
    const stadiumSeats = fd && fd.stadium ? fd.stadium.level : null;
    const attendanceRef = stadiumSeats ? Math.round(stadiumSeats * 0.65) : 15000; // rough fill-rate assumption

    // Weekly income/maintenance for the sustainability check. Maintenance now prefers the
    // dedicated Maintenance page's own "Total" row (exact, per-facility-summed figure) over
    // the Finances tab's weekly aggregate, falling back to the latter if that page hasn't
    // been visited/fetched yet.
    let financials = null;
    if (financesSlice && financesSlice.data.weekly) {
      const w = financesSlice.data.weekly;
      const get = (label, idx) => w[label] ? parseMoney(w[label][idx || 0]) : 0;
      const weeklyIncome = get('Attendance') + get('TV Money') + get('Sponsors') + get('Merchandise') + get('Food');
      let weeklyMaintenance = Math.abs(get('Maintenance'));
      if (maintenanceSlice && maintenanceSlice.data.totals && maintenanceSlice.data.totals['Total']) {
        weeklyMaintenance = maintenanceSlice.data.totals['Total'].week;
      }
      financials = { weeklyIncome, weeklyMaintenance };
    }
    return { cash, fd, stadiumSeats, attendanceRef, financials };
  }

  /* ============================================================
   *  SECTION 7 — UI
   * ============================================================ */

  const STYLE = `
  /* ---- Design tokens (change the theme in ONE place) ----
     Warm-neutral dark base (slightly brown-grey, easier on the eyes than pure blue-black)
     with a soft amber accent for warmth and a blue accent kept for links/positive values. */
  #tma-panel {
    --tma-bg:#1a1a1d; --tma-bg-2:#202024; --tma-card:#25252a80; --tma-line:#33333a80;
    --tma-gold:#e0a95f; --tma-lime:#6fae7c; --tma-text:#f1efec; --tma-mute:#9a9691;
    --tma-red:#d97a70; --tma-amber:#e0a95f; --tma-accent:#7fb2e0;
    --tma-ease:cubic-bezier(.4,0,.2,1);
  }
  /* ---- Panel shell: the ONLY floating element — always present, docked bottom-right.
     Collapsed by default down to just its header; expands in place, nothing else to summon. ---- */
  #tma-panel { position:fixed; right:22px; bottom:22px; z-index:999999; width:412px; max-height:78vh; overflow:hidden;
    background:var(--tma-bg); color:var(--tma-text); border-radius:14px;
    border:1px solid #38383f80; box-shadow:0 18px 44px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.3);
    font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif; display:flex; flex-direction:column;
    transition:max-height .2s var(--tma-ease), box-shadow .2s var(--tma-ease); }
  #tma-panel:not(.tma-collapsed) { box-shadow:0 22px 52px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.35); }
  /* ---- Collapsed = compact pill, not a full-width bar: shrink-wraps to just
     "TM Advisor ›" (~90px wide), so the minimized state takes almost no pitch. ---- */
  #tma-panel.tma-collapsed { max-height:44px; width:auto; opacity:.92; }
  #tma-panel.tma-collapsed .tma-head-row { width:max-content; }
  #tma-panel.tma-collapsed .tma-tabs, #tma-panel.tma-collapsed .tma-body, #tma-panel.tma-collapsed .tma-sub, #tma-panel.tma-collapsed .tma-prep { display:none; }
  .tma-prep { padding:0 0 10px; cursor:default; }
  .tma-prep .tma-btn { margin-top:0; }
  #tma-panel.tma-collapsed .tma-head { padding:10px 14px; border-bottom:none; }
  #tma-panel.tma-collapsed .tma-head:hover { background:#242428; opacity:1; }
  /* ---- Header (sticky, draggable, doubles as the expand/collapse target) ---- */
  .tma-head { padding:12px 14px 0; background:var(--tma-bg-2); border-bottom:1px solid #33333a80;
    cursor:move; user-select:none; position:relative; z-index:2; flex:0 0 auto; transition:background .15s var(--tma-ease); }
  .tma-head-row { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .tma-title { font-size:15px; font-weight:700; color:var(--tma-text); letter-spacing:.1px; display:flex; align-items:center; gap:6px; }
  .tma-title .tma-mini { font-weight:400; }
  .tma-head-actions { display:flex; align-items:center; gap:2px; flex-shrink:0; }
  .tma-icon-btn { cursor:pointer; width:24px; height:24px; display:flex; align-items:center; justify-content:center;
    color:var(--tma-mute); font-size:13px; border-radius:6px; transition:color .15s var(--tma-ease), background .15s var(--tma-ease), transform .1s var(--tma-ease); }
  .tma-icon-btn:hover { color:var(--tma-text); background:#ffffff12; }
  .tma-icon-btn:active { transform:scale(.9); }
  .tma-chevron { display:inline-block; transition:transform .2s var(--tma-ease); }
  #tma-panel.tma-collapsed .tma-chevron { transform:rotate(-90deg); }
  .tma-status { font-size:10.5px; font-weight:600; padding:2px 8px; border-radius:20px; margin-left:6px; white-space:nowrap; letter-spacing:0; }
  .tma-status.ok { background:#6fae7c26; color:var(--tma-lime); }
  .tma-status.warn { background:#e0a95f26; color:var(--tma-amber); }
  .tma-sub { font-size:11px; color:var(--tma-mute); margin-top:2px; padding-bottom:10px; display:flex; align-items:center; gap:6px; }
  .tma-ctx-dot { width:6px; height:6px; border-radius:50%; background:var(--tma-lime); box-shadow:0 0 0 0 #6fae7c66;
    animation:tma-pulse 2s infinite; display:inline-block; flex-shrink:0; }
  @keyframes tma-pulse { 0%{box-shadow:0 0 0 0 #6fae7c66;} 70%{box-shadow:0 0 0 5px #6fae7c00;} 100%{box-shadow:0 0 0 0 #6fae7c00;} }
  .tma-tabs { display:flex; gap:2px; padding:0 8px; overflow-x:auto; scrollbar-width:none; }
  .tma-tabs::-webkit-scrollbar { display:none; }
  .tma-tab { flex:1 0 auto; min-width:64px; text-align:center; padding:8px 6px; font-size:11.5px; border-radius:8px 8px 0 0; cursor:pointer;
    background:transparent; color:var(--tma-mute); font-weight:600; position:relative; transition:color .15s var(--tma-ease), background .15s var(--tma-ease); white-space:nowrap; }
  .tma-tab:hover { color:var(--tma-text); background:#ffffff0a; }
  .tma-tab.active { background:var(--tma-bg); color:var(--tma-gold); font-weight:700; }
  .tma-tab.active:after { content:""; position:absolute; left:18%; right:18%; bottom:-1px; height:2px; border-radius:2px; background:var(--tma-gold); }
  /* ---- Scrollable body ---- */
  .tma-body { padding:12px 14px 16px; overflow-y:auto; flex:1 1 auto; scrollbar-width:thin; scrollbar-color:#7a7a8266 transparent;
    animation:tma-fade-in .16s var(--tma-ease); }
  @keyframes tma-fade-in { from{ opacity:0; transform:translateY(2px);} to{ opacity:1; transform:translateY(0);} }
  .tma-body::-webkit-scrollbar { width:7px; }
  .tma-body::-webkit-scrollbar-thumb { background:#7a7a8255; border-radius:4px; }
  .tma-body::-webkit-scrollbar-thumb:hover { background:#7a7a8299; }
  /* ---- Cards ---- */
  .tma-buy { padding:6px 0; border-top:1px solid var(--tma-line); }
  .tma-seg { display:inline-flex; gap:2px; }
  .tma-segbtn { background:#161a1f; border:1px solid #2b323b80; color:#c7cdd3; border-radius:5px; padding:2px 7px; font-size:11px; cursor:pointer; }
  .tma-segbtn.on { background:var(--tma-gold, #c9a227); color:#14171a; font-weight:700; }
  table.tma-pos { width:100%; border-collapse:collapse; font-size:11.5px; margin-top:4px; }
  table.tma-pos th { text-align:left; color:#8a939c; font-weight:600; padding:3px 4px; }
  table.tma-pos td { vertical-align:top; padding:4px; border-top:1px solid var(--tma-line); }
  .tma-buy:first-of-type { border-top:0; }
  details.tma-card > summary { list-style:none; }
  details.tma-card > summary::before { content:'▸ '; color:var(--tma-text-dim, #8a939c); }
  details.tma-card[open] > summary::before { content:'▾ '; }
  details.tma-sub { margin-top:8px; }
  details.tma-sub > summary { list-style:none; }
  details.tma-sub > summary::before { content:'▸ '; color:var(--tma-text-dim, #8a939c); }
  details.tma-sub[open] > summary::before { content:'▾ '; }
  .tma-card { background:var(--tma-card); border:1px solid var(--tma-line); border-radius:11px;
    padding:12px 13px; margin-bottom:9px; transition:border-color .15s var(--tma-ease), transform .15s var(--tma-ease), box-shadow .15s var(--tma-ease); }
  .tma-card:hover { border-color:#e0a95f4d; transform:translateY(-1px); box-shadow:0 4px 14px rgba(0,0,0,.25); }
  .tma-card h4 { margin:0 0 8px; font-size:12.5px; color:var(--tma-text); display:flex; justify-content:space-between; align-items:center; gap:8px; font-weight:700; letter-spacing:.1px; }
  .tma-row { display:flex; justify-content:space-between; align-items:center; font-size:12.5px; padding:5px 0; border-bottom:1px solid #ffffff0a; gap:8px; }
  .tma-row:last-child { border-bottom:none; }
  .tma-dot { width:8px; height:8px; border-radius:50%; display:inline-block; margin-right:6px; flex-shrink:0; }
  .dot-green{ background:var(--tma-lime); } .dot-amber{ background:var(--tma-amber); } .dot-red{ background:var(--tma-red); } .dot-grey{ background:#57575e; }
  /* ---- Buttons ---- */
  .tma-btn { background:linear-gradient(180deg,#d99a4e,#c98a3e); color:#241a0d; border:1px solid #e0a95f66; border-radius:8px;
    padding:9px 12px; font-size:12.5px; cursor:pointer; font-weight:700; width:100%; margin-top:8px; letter-spacing:.1px;
    transition:filter .15s var(--tma-ease), transform .1s var(--tma-ease), box-shadow .15s var(--tma-ease); }
  .tma-btn:hover { filter:brightness(1.08); box-shadow:0 3px 10px rgba(224,169,95,.25); transform:translateY(-1px); }
  .tma-btn:active { transform:translateY(1px); filter:brightness(.97); }
  .tma-btn:disabled { opacity:.5; cursor:not-allowed; filter:none; transform:none; box-shadow:none; }
  .tma-btn.secondary { background:#24242a; color:var(--tma-mute); font-weight:600; border-color:#3a3a42; }
  .tma-btn.secondary:hover { color:var(--tma-text); background:#2c2c33; box-shadow:none; }
  /* ---- Pitch ---- */
  .tma-pitch { display:flex; flex-direction:column; gap:7px; border-radius:11px; padding:13px 8px; position:relative;
    background:linear-gradient(180deg,#0d260f,#102a13);
    background-image:repeating-linear-gradient(180deg, rgba(255,255,255,.02) 0 40px, rgba(255,255,255,.045) 40px 41px);
    box-shadow:inset 0 0 26px rgba(0,0,0,.35); }
  .tma-pitch-row { display:flex; justify-content:center; gap:6px; flex-wrap:wrap; }
  .tma-slot { background:#1a4a1e; border:1px solid #2f7d3260; border-radius:8px; padding:6px 4px;
    text-align:center; font-size:10.4px; flex:1 1 0; min-width:70px; max-width:106px; }
  .tma-slot b { display:block; font-size:11.4px; color:var(--tma-gold); margin:2px 0; font-weight:700; }
  .tma-bench-card { display:flex; justify-content:space-between; align-items:center; font-size:12px; padding:6px 0; border-bottom:1px solid #ffffff08; }
  .tma-bench-card:last-child { border-bottom:none; }
  .tma-role-tag { font-size:9.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--tma-mute); width:42px; flex-shrink:0; }
  .tma-pos { font-size:9.5px; color:var(--tma-mute); text-transform:uppercase; letter-spacing:.03em; }
  .tma-empty { color:var(--tma-red); font-style:italic; }
  .tma-reason { font-size:11.4px; color:#c9c4bd; margin:5px 0; padding-left:14px; position:relative; line-height:1.45; }
  .tma-reason:before { content:"–"; position:absolute; left:0; color:var(--tma-mute); }
  .tma-badge { font-size:9.5px; padding:2px 7px; border-radius:20px; background:#2a2530; color:var(--tma-accent); white-space:nowrap; font-weight:600; }
  .tma-progress { font-size:11px; color:var(--tma-mute); margin-top:6px; }
  .tma-mini { font-size:10.6px; color:var(--tma-mute); line-height:1.45; }
  .tma-goodval { color:var(--tma-lime); font-weight:700; }
  /* ---- Empty-state helper ---- */
  .tma-empty-state { text-align:center; padding:24px 14px; color:var(--tma-mute); animation:tma-fade-in .2s var(--tma-ease); }
  .tma-empty-state .tma-es-icon { font-size:26px; opacity:.6; display:block; margin-bottom:8px; }
  `;

  function injectStyle() {
    const s = document.createElement('style');
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function freshnessDot(slice) {
    if (!slice) return 'dot-grey';
    const age = now() - slice.t;
    if (age < FRESHNESS.fresh) return 'dot-green';
    if (age < FRESHNESS.stale) return 'dot-amber';
    return 'dot-red';
  }
  function ago(ts) {
    if (!ts) return 'never';
    const diff = now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }
  // ---- Shared UI helpers (avoid redefining these in every render function) ----
  const fmtMoney = (n) => n == null ? '—' : Number(n).toLocaleString();     // currency-ish
  const bindBtn = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  const playerLink = (p) => `https://trophymanager.com/players/${p.id}/`;
  // Tier/potential badges shared by the scouting cards.
  const tierBadge = (p) => p.tier === 'elite'
    ? ' <span class="tma-badge" style="background:#3d3524;color:#e8cfa0;">elite</span>'
    : (p.tier === 'strong' ? ' <span class="tma-badge" style="background:#28323d;color:#a8c8e0;">strong</span>' : '');
  const badge = (p) => {
    let out = tierBadge(p);
    if (p.highPotential) out += ' <span class="tma-badge" style="background:#2a2f42;color:#b9c4ee;">high potential</span>';
    return out;
  };
  const natBadge = (p) => {
    if (!p.nat) return '';
    const home = MY_COUNTRY && p.nat === MY_COUNTRY;
    return ` <span class="tma-badge" style="background:${home ? '#1c2c3d' : '#2c313780'};color:${home ? '#9fc3e0' : '#c7cdd3'};">${p.nat.toUpperCase()}${home ? ' · home' : ''}</span>`;
  };
  // Cost block shared by youth + senior cards: live bid, the game's two confirmed price
  // points, and the market-verdict (Section 5B) on whether the bid looks like good value.
  const costRow = (p) => {
    let out = p.price ? `<div class="tma-row"><span>Current bid</span><span class="tma-goodval">${fmtMoney(p.price)}</span></div>` : '';
    if (p.estValue) out += `<div class="tma-row"><span>Sell-to-Agent</span><span>${fmtMoney(p.estValue)}</span></div>`;
    if (p.maxValue && p.maxValue !== p.estValue) out += `<div class="tma-row"><span>Max Sell Price</span><span>${fmtMoney(p.maxValue)}</span></div>`;
    const verdict = marketVerdict(p.price, p.estValue, p.maxValue);
    if (verdict) {
      const vColor = verdict.cls === 'goodval' ? '#9ece6a' : (verdict.cls === 'badval' ? '#e05555' : '#8a939c');
      out += `<div class="tma-row"><span>Verdict</span><span style="color:${vColor};font-weight:700;">${verdict.label} <span class="tma-mini" style="font-weight:400;">— ${verdict.note}</span></span></div>`;
    }
    return out;
  };

  // Drag-to-move: the panel defaults to bottom-right, which can sit over game controls on
  // narrower layouts. Dragging by the header switches it to an absolute left/top position
  // and remembers where you left it for next time.
  // Generic drag-to-move helper, reused for both the panel (drag by header) and the FAB
  // button itself (drag by the button). Remembers position per-element in localStorage.
  function makeElementDraggable(el, handle, storageKey, onMove) {
    let dragging = false, startX, startY, startLeft, startTop;
    const saved = (() => { try { return JSON.parse(localStorage.getItem(storageKey)); } catch (e) { return null; } })();
    if (saved && typeof saved.left === 'number') {
      el.style.left = saved.left + 'px'; el.style.top = saved.top + 'px';
      el.style.right = 'auto'; el.style.bottom = 'auto';
    }
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('#tma-collapse-toggle')) return;
      dragging = true;
      const rect = el.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY; startLeft = rect.left; startTop = rect.top;
      el.style.left = startLeft + 'px'; el.style.top = startTop + 'px';
      el.style.right = 'auto'; el.style.bottom = 'auto';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const newLeft = startLeft + (e.clientX - startX);
      const newTop = startTop + (e.clientY - startY);
      el.style.left = Math.max(0, Math.min(window.innerWidth - 60, newLeft)) + 'px';
      el.style.top = Math.max(0, Math.min(window.innerHeight - 40, newTop)) + 'px';
      if (onMove) onMove();
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      try {
        localStorage.setItem(storageKey, JSON.stringify({ left: parseInt(el.style.left, 10), top: parseInt(el.style.top, 10) }));
      } catch (e) {}
    });
  }

  // The panel IS the advisor — no separate floating button. It sits docked bottom-right,
  // starts collapsed to a compact pill (~44px), and expands in place when you click the header
  // or the chevron. Nothing else to summon, nothing else floating on the page.
  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'tma-panel';
    panel.innerHTML = `
      <div class="tma-head" id="tma-drag-handle">
        <div class="tma-head-row">
          <div class="tma-title">TM Advisor <span id="tma-status-slot">${matchStatusHtml()}${reserveStatusHtml()}</span></div>
          <div class="tma-head-actions">
            <span class="tma-icon-btn" id="tma-collapse-toggle" title="Collapse / expand"><span class="tma-chevron">▾</span></span>
          </div>
        </div>
        <div class="tma-sub">Cached club intelligence · club ${clubId}</div>
        <div class="tma-prep"><button class="tma-btn" id="tma-prep-btn">⚡ Prepare match</button><div class="tma-progress" id="tma-prep-status"></div></div>
        <div class="tma-tabs" id="tma-tabs"></div>
      </div>
      <div class="tma-body" id="tma-body"></div>
    `;
    document.body.appendChild(panel);
    makeElementDraggable(panel, document.getElementById('tma-drag-handle'), 'tmAdvisor_panelPos');

    // ALWAYS start minimized on every page load - expanding is a deliberate click, never
    // a carried-over state. Nothing persists whether it was open, so the panel can never
    // ambush game content you're trying to play on.
    panel.classList.add('tma-collapsed');

    const setCollapsed = (collapsed) => {
      panel.classList.toggle('tma-collapsed', collapsed);
      if (!collapsed) openTab(document.querySelector('.tma-tab.active')?.dataset.tab || contextTabForPath());
    };
    // The single action: everything both teams need for their next matches (runCopilot, 5H).
    panel.querySelector('#tma-prep-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const btn = e.currentTarget, st = document.getElementById('tma-prep-status');
      btn.disabled = true;
      const entry = await runCopilot(true, t => { st.textContent = t; }).catch(err => ({ ok: false, msg: err.message }));
      st.textContent = !entry ? '' : entry.msg && !entry.lines ? '⚠ ' + entry.msg : `${entry.ok ? '✔ Done' : '⚠ Done with warnings'} — details on the Dashboard`;
      btn.disabled = false;
      refreshMatchStatus();
      const active = document.querySelector('.tma-tab.active');
      renderTab(active ? active.dataset.tab : contextTabForPath());
    });
    panel.querySelector('#tma-collapse-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      setCollapsed(!panel.classList.contains('tma-collapsed'));
    });
    // Clicking anywhere on the header (outside the tabs, once expanded) also toggles it —
    // a bigger, easier target than just the chevron.
    document.getElementById('tma-drag-handle').addEventListener('click', (e) => {
      if (e.target.closest('.tma-tabs, #tma-collapse-toggle')) return;
      setCollapsed(!panel.classList.contains('tma-collapsed'));
    });
    if (!panel.classList.contains('tma-collapsed')) openTab(contextTabForPath());
    setInterval(refreshMatchStatus, 60e3); // keeps the kickoff countdown honest
  }

  // Match-day status for the header — visible even with the dock collapsed: who's next, when,
  // and whether a plan was applied for THAT match (Apply/autopilot record a prediction per id).
  function nextMatchInfo() {
    const nm = getSlice('home') && getSlice('home').data && getSlice('home').data.nextMatch;
    if (!nm || !nm.home || !nm.away) return null;
    const opp = String(nm.home.id) === clubId ? nm.away : nm.home;
    const matchId = nm.matchUrl ? (nm.matchUrl.match(/\/matches\/(\d+)/) || [])[1] : null;
    const preds = (getSlice('predictions') || { data: {} }).data || {};
    const kickoff = parseKickoff(nm.when);
    return { opp, matchId, kickoff, lockAt: kickoff ? kickoff - TACTICS_LOCK_MS : null, tmTime: tmTimeOf(nm.when), home: opp === nm.away, applied: !!(matchId && preds[matchId]), prediction: matchId ? preds[matchId] : null };
  }
  // "19:00 · locks in 4h 50m": the game's own kickoff time, counting down to the lock.
  function kickoffText(m) {
    if (!m || !m.kickoff) return m && m.tmTime ? m.tmTime : '';
    const toLock = Math.round((m.lockAt - now()) / 60e3);
    let rest;
    if (now() >= m.kickoff) rest = 'kicked off';
    else if (toLock <= 0) rest = 'locked';
    else if (toLock < 60) rest = `locks in ${toLock}m`;
    else if (toLock < 24 * 60) rest = `locks in ${Math.floor(toLock / 60)}h ${toLock % 60}m`;
    else rest = new Date(m.kickoff).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    return (m.tmTime ? m.tmTime + ' · ' : '') + rest;
  }
  function matchStatusHtml() {
    const m = nextMatchInfo();
    if (!m) return '';
    const name = m.opp.name && m.opp.name.length > 18 ? m.opp.name.slice(0, 17) + '…' : (m.opp.name || '?');
    const when = kickoffText(m);
    return `<span class="tma-status ${m.applied ? 'ok' : 'warn'}" title="${m.applied ? 'A plan was applied for this match' : 'No plan applied for this match yet — open Tactics'}">v ${esc(name)}${when ? ' · ' + when : ''} · ${m.applied ? '✔ tactic set' : '⚠ tactic not set'}</span>`;
  }
  function reserveStatus() {
    const r = getSlice('reservePlan') && getSlice('reservePlan').data;
    if (!r || (r.kickoff && now() > r.kickoff + 2 * 3600e3)) return null;
    return r;
  }
  function reserveStatusHtml() {
    const r = reserveStatus();
    if (!r) return '';
    return `<span class="tma-status ${r.ok ? 'ok' : 'warn'}" title="Reserves v ${esc(r.opp || '?')}">B · ${r.ok ? '✔ set' : '⚠ not set'}</span>`;
  }
  function refreshMatchStatus() {
    const slot = document.getElementById('tma-status-slot');
    if (slot) slot.innerHTML = matchStatusHtml() + reserveStatusHtml();
  }

  // Human-readable label per advisor tab, used to render the single relevant tab for
  // whatever page you're on — see contextTabForPath() below.
  const TAB_LABELS = { dash: 'Dashboard', tactics: 'Tactics', stadium: 'Stadium', scouting: 'Scouting', league: 'League' };

  // Sets the active tab, renders it, and rebuilds the tab bar to show ONLY that one tab —
  // the advisor now surfaces exactly the section relevant to the page you're on (Tactics on
  // the tactics/players pages, Scouting on the transfer/scouts pages, Stadium on
  // stadium/finances, Dashboard everywhere else including the homepage) rather than a row of
  // mostly-irrelevant tabs to click through.
  function openTab(tab) {
    const panel = document.getElementById('tma-panel');
    if (!panel) return;
    if (!TAB_LABELS[tab]) tab = 'dash';
    const tabsEl = panel.querySelector('#tma-tabs');
    if (tabsEl) tabsEl.innerHTML = `<div class="tma-tab active" data-tab="${tab}">${TAB_LABELS[tab]}</div>`;
    // Reflect the current page in the header subtitle so it's obvious what the advisor is
    // showing and why this tab opened.
    const sub = panel.querySelector('.tma-sub');
    if (sub) sub.innerHTML = `<span class="tma-ctx-dot"></span>${contextLabel()} · club ${clubId}`;
    renderTab(tab);
  }

  // Short human label for the page you're currently on (used in the header subtitle).
  function contextLabel() {
    const p = location.pathname;
    if (p.startsWith('/matches/')) return 'Viewing a match';
    if (p.startsWith('/stadium')) return 'Stadium page';
    if (p.startsWith('/finances')) return 'Finances page';
    if (p.startsWith('/transfer')) return 'Transfer market';
    if (p.startsWith('/shortlist')) return 'Shortlist';
    if (p.startsWith('/scouts')) return 'Scouts';
    if (p.startsWith('/youth-development')) return 'Youth development';
    if (/^\/players\/\d+/.test(p)) return 'Player profile';
    if (p.startsWith('/players')) return 'Your players';
    if (p.startsWith('/tactics')) return 'Tactics page';
    if (p.startsWith('/club/') && p.includes('/squad')) return p.includes('/' + clubId + '/') ? 'Your squad' : 'Opponent squad';
    if (p.startsWith('/fixtures')) return 'Fixtures';
    if (p.startsWith('/statistics')) return 'Statistics';
    if (p.startsWith('/history')) return 'Club history';
    if (p.startsWith('/sponsors')) return 'Sponsors';
    if (p === '/home/' || p === '/home') return 'Home';
    return 'Club intelligence';
  }

  // Maps the current TrophyManager page to the single most useful advisor tab.
  function contextTabForPath() {
    const p = location.pathname;
    if (p.startsWith('/matches/')) return 'dash';           // last-match stats live on the dashboard
    if (p.startsWith('/stadium')) return 'stadium';
    if (p.startsWith('/finances') || p.startsWith('/sponsors')) return 'stadium'; // money pages feed the stadium ROI view
    if (p.startsWith('/transfer') || p.startsWith('/shortlist') || p.startsWith('/scouts')) return 'scouting';
    if (p.startsWith('/league')) return 'league';
    // An individual player's profile page (e.g. /players/142683102/...) isn't your squad —
    // the Rou/SI/R5/breakdown card is already injected directly onto that page (Section 4),
    // so the side panel has nothing specific to show; fall through to the Dashboard default
    // rather than incorrectly opening Tactics, which only makes sense for YOUR squad.
    if (/^\/players\/\d+/.test(p)) return 'dash';
    if (p.startsWith('/players') || p.startsWith('/tactics')) return 'tactics';
    if (p.startsWith('/club/') && p.includes('/squad')) return 'tactics'; // opponent squad → tactics/scouting
    return 'dash';
  }

  function renderTab(tab) {
    refreshMatchStatus();
    if (tab === 'dash') renderDashboard();
    else if (tab === 'tactics') renderTactics();
    else if (tab === 'stadium') renderStadiumTab();
    else if (tab === 'scouting') renderScouting();
    else if (tab === 'league') renderLeague();
  }

  function renderDashboard() {
    const body = document.getElementById('tma-body');
    const c = loadCache();
    const rows = DATA_SOURCES.concat([{ key: 'opponent', label: 'Opponent Squad' }, { key: 'opponentExpected', label: 'Next-Match Expected XI' }, { key: 'opponentScouting', label: 'Opponent Scouting (last 5)' }, { key: 'history', label: 'Development History' }])
      .map(src => {
        const slice = c[src.key];
        const dot = freshnessDot(slice);
        return `<div class="tma-row"><span><span class="tma-dot ${dot}"></span>${src.label}</span><span class="tma-mini">${ago(slice && slice.t)}</span></div>`;
      }).join('');

    const nm = c.home && c.home.data && c.home.data.nextMatch;
    const nmi = nextMatchInfo();
    const nmHtml = nm ? `
      <div class="tma-row" style="font-weight:700;"><span>${esc(nm.home.name)}</span><span class="tma-mini">vs</span><span>${esc(nm.away.name)}</span></div>
      <div class="tma-row"><span class="tma-mini">${esc(nm.when || '')}</span><span class="tma-mini">${nmi ? esc(kickoffText(nmi)) : ''}</span></div>
      ${nmi && nmi.prediction ? `<div class="tma-row"><span>Expected (model)</span><span class="tma-goodval">${nmi.prediction.gd >= 0 ? '+' : ''}${nmi.prediction.gd.toFixed(1)} goals</span></div>` : ''}
      <div class="tma-row"><span>Tactic</span><span style="color:${nmi && nmi.applied ? 'var(--tma-lime)' : 'var(--tma-amber)'};font-weight:700;">${nmi && nmi.applied ? '✔ applied for this match' : '⚠ not applied yet'}</span></div>
      ${reserveRowHtml()}
      ` : `<div class="tma-mini">No data yet.</div>`;

    const lastResult = c.lastMatchResult;
    const lastResultHtml = lastResult ? (() => {
      const d = lastResult.data;
      const st = d.stats;
      const statRow = (label, h, a) => (h != null || a != null) ? `<div class="tma-row"><span class="tma-goodval">${h != null ? h : '–'}</span><span class="tma-mini">${label}</span><span class="tma-goodval">${a != null ? a : '–'}</span></div>` : '';
      const statsBlock = st ? `
        <div class="tma-row" style="font-weight:700;"><span>${esc(d.home)}</span><span class="tma-mini">vs</span><span>${esc(d.away)}</span></div>
        ${statRow('Possession %', st.possession && st.possession.home, st.possession && st.possession.away)}
        ${statRow('Shots', st.shots.home, st.shots.away)}
        ${statRow('On target', st.shotsOnTarget.home, st.shotsOnTarget.away)}
        ${statRow('Set pieces', st.setPieces.home, st.setPieces.away)}
        ${statRow('Penalties', st.penalties.home, st.penalties.away)}
        ${statRow('Yellow cards', st.yellows.home, st.yellows.away)}
        ${statRow('Red cards', st.reds.home, st.reds.away)}` : '';
      const glyph = { goal: '⚽', yellow: '🟨', red: '🟥', yellow_red: '🟨🟥', injury: '🚑' };
      const timelineBlock = (d.timeline && d.timeline.length) ? `
        <div class="tma-mini" style="margin-top:6px;">Timeline</div>
        ${d.timeline.map(ev => `<div class="tma-row"><span class="tma-mini">${esc(ev.minute)}'</span><span>${glyph[ev.type] || '•'} ${esc(ev.player)}${ev.score ? ' <span class="tma-goodval">(' + esc(ev.score.home) + '-' + esc(ev.score.away) + ')</span>' : ''}</span><span class="tma-mini">${esc(ev.side || '')}</span></div>`).join('')}` : '';
      return `<div class="tma-card"><h4>Last Match Seen <span class="tma-mini">(${ago(lastResult.t)})</span></h4>
        <div class="tma-mini" style="text-align:center;font-size:14px;color:#7fb2e0;margin-bottom:4px;">${esc(d.home)} ${esc(d.homeGoals)} – ${esc(d.awayGoals)} ${esc(d.away)}</div>
        ${statsBlock}${timelineBlock}</div>`;
    })() : '';

    body.innerHTML = `
      <div class="tma-card">
        <h4>Data Freshness</h4>
        ${rows}
        <div class="tma-progress" id="tma-progress"></div>
      </div>
      ${lastResultHtml}
      <div class="tma-card">
        <h4>Next Match</h4>
        ${nmHtml}
      </div>
      ${autopilotCardHtml()}
    `;
    bindAutopilotCard();
  }

  function autopilotCardHtml() {
    const ap = autopilotPrefs(), st = copilotSteps();
    const entries = ((getSlice('autopilotLog') || { data: [] }).data || []).slice(0, 3);
    const toggle = (id, on, text) => `<label class="tma-mini" style="display:flex;gap:6px;align-items:flex-start;margin:4px 0;cursor:pointer;color:var(--tma-text);"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} style="margin-top:2px;"> <span>${text}</span></label>`;
    const entryHtml = e => `<div style="margin-top:8px;"><div class="tma-row"><span style="color:${e.ok ? 'var(--tma-lime)' : 'var(--tma-amber)'};font-weight:600;">${e.ok ? '✔' : '⚠'} ${esc(e.msg)}</span><span class="tma-mini">${ago(e.t)}</span></div>${(e.lines || []).map(l => `<div class="tma-mini" style="padding:1px 0 1px 8px;">${esc(l)}</div>`).join('')}</div>`;
    return `
      <div class="tma-card">
        <h4>Copilot <span class="tma-badge">${ap.enabled ? (ap.dryRun ? 'autopilot · dry run' : 'autopilot on') : 'manual'}</span></h4>
        <div class="tma-mini">What ⚡ Prepare match (top of this panel) and the autopilot do, and what they did last:</div>
        <div class="tma-mini" style="margin:10px 0 2px;text-transform:uppercase;letter-spacing:.04em;">Steps</div>
        ${toggle('tma-step-reserves', st.reserves, 'Reserves — youths (≤21) outside the first XI + bench go down for minutes, promoted when they\'d start; full tactic + conditional orders for the reserves\' own opponent, youths first')}
        ${toggle('tma-step-tactics', st.tactics, 'Opponent scan → XI, bench, captain &amp; set pieces, mentality/style/focus, conditional orders')}
        ${toggle('tma-step-training', st.training, 'Custom training — your role templates, tweaked per player toward his weakest key skills; balanced once fully developed')}
        ${toggle('tma-step-youth', st.youth, 'Youth pull — hire potential ≥17 where the position is needed, fire the rest (only when the report shows potential)')}
        ${toggle('tma-step-scouting', st.scouting, 'Scouting — free scouts to your youths first; flags 20-rated scouts on the hire list')}
        ${toggle('tma-step-facilities', st.facilities, 'Facility upgrades <b>(spends cash)</b> — training/youth first, else income that pays back within 26 weeks; one per run, never into the wage reserve')}
        <div class="tma-mini" style="margin:10px 0 2px;text-transform:uppercase;letter-spacing:.04em;">Automation</div>
        ${toggle('tma-ap-on', ap.enabled, 'Run by itself before each match (whenever you open a TM page) — once per match, never inside the tactics lock')}
        ${toggle('tma-ap-dry', ap.dryRun, 'Dry run — plan and log, save nothing')}
        ${entries.map(entryHtml).join('')}
      </div>`;
  }
  function bindAutopilotCard() {
    const flip = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('change', () => { if (fn(el.checked) === false) el.checked = !el.checked; renderDashboard(); }); };
    flip('tma-ap-on', v => setAutopilotPrefs({ ...autopilotPrefs(), enabled: v }));
    flip('tma-ap-dry', v => setAutopilotPrefs({ ...autopilotPrefs(), dryRun: v }));
    flip('tma-step-training', v => setCopilotSteps({ ...copilotSteps(), training: v }));
    flip('tma-step-reserves', v => setCopilotSteps({ ...copilotSteps(), reserves: v }));
    flip('tma-step-youth', v => {
      if (v && !window.confirm('Youth pulls hire (fee + wage) and FIRE recruits — firing is permanent. Let the copilot act on each report?')) return false;
      setCopilotSteps({ ...copilotSteps(), youth: v });
    });
    flip('tma-step-scouting', v => setCopilotSteps({ ...copilotSteps(), scouting: v }));
    flip('tma-step-tactics', v => setCopilotSteps({ ...copilotSteps(), tactics: v }));
    flip('tma-step-facilities', v => {
      if (v && !window.confirm('Facility upgrades spend club cash and take weeks to build. Let the copilot start one when the rules say it is needed?')) return false;
      setCopilotSteps({ ...copilotSteps(), facilities: v });
    });
  }

  function reserveRowHtml() {
    const r = reserveStatus();
    if (!r) return '<div class="tma-row"><span>Reserves</span><span class="tma-mini">not prepared yet — ⚡ Prepare match</span></div>';
    return `<div class="tma-row"><span>Reserves v ${esc(r.opp || '?')}</span><span style="color:${r.ok ? 'var(--tma-lime)' : 'var(--tma-amber)'};font-weight:700;">${r.ok ? '✔ ' : '⚠ '}${esc(r.formation)}${r.kickoff ? ' · ' + esc(kickoffText({ kickoff: r.kickoff, lockAt: r.kickoff - TACTICS_LOCK_MS })) : ''}</span></div>`;
  }
  function reservePlanHtml() {
    const r = reserveStatus();
    if (!r) return '';
    const st = r.settings || {};
    const rows = (r.xi || []).map(x => `<div class="tma-row"><span class="tma-mini">${esc(String(x.slot).toUpperCase())}</span><span>${esc(x.name)}${Number(x.age) <= RESERVE_MAX_AGE ? ' <span class="tma-badge">youth</span>' : ''}</span></div>`).join('');
    return `
      <div class="tma-card">
        <h4>Reserves v ${esc(r.opp || '?')} <span class="tma-badge">${r.ok ? 'saved ✔' : 'not saved'}</span></h4>
        <div class="tma-mini" style="margin-bottom:6px;">${esc(r.formation)} · ${esc(MENTALITY[st.mentality] || '?')} / ${esc(ATT_STYLE[st.style] || '?')} / ${esc(FOCUS_SIDE[st.focus] || '?')} · ${r.youths} youths starting · ${r.orders} conditional orders · ${r.scouted ? 'opponent scouted' : 'no opponent history'} · ${r.weAreHome ? 'home' : 'away'}</div>
        ${rows}
      </div>`;
  }
  function renderTactics() {
    const body = document.getElementById('tma-body');
    const playersSlice = getSlice('players');
    const oppSlice = getSlice('opponent');
    const scoutSlice = getSlice('opponentScouting');
    const expectedSlice = getSlice('opponentExpected');
    if (onTacticsPage() && !tacticsPageData && !tacticsPageFailed) {
      body.innerHTML = `<div class="tma-card"><h4>Reading your tactics page…</h4></div>`;
      loadTacticsPage().catch(e => { tacticsPageFailed = true; console.warn('TM Advisor: tactics_get failed', e); }).then(() => {
        if (document.querySelector('.tma-tab.active')?.dataset.tab === 'tactics') renderTactics();
      });
      return;
    }
    const squad = tacticsPageSquad() || (playersSlice && firstTeamOnly(playersSlice.data));
    if (!squad) {
      body.innerHTML = `<div class="tma-card"><h4>No squad data yet</h4><div class="tma-mini">Open your Players or Tactics page once.</div></div>`;
      return;
    }
    const plan = buildMatchPlan(squad, oppSlice && oppSlice.data, scoutSlice && scoutSlice.data, expectedSlice && expectedSlice.data, { restBanRisk: restBanRisk() });
    const { players, best, settings, bench, roles } = plan;
    const startingPlayers = best.lineup.filter(l => l.player).map(l => l.player);

    // Pitch rows top to bottom; within a row TM's slot numbers already run left to right.
    // A red "−N%" marks a slot where TM's own out-of-position penalty applies.
    const pitchRowsHtml = ['F', 'OM', 'M', 'DM', 'D', 'GK']
      .map(row => best.lineup.filter(l => l.bucket === row).sort((a, b) => SLOT_NUM[a.slot] - SLOT_NUM[b.slot]))
      .filter(cells => cells.length)
      .map(cells => `<div class="tma-pitch-row">${cells.map(l => l.player
        ? `<div class="tma-slot"><div class="tma-pos">${l.slot.toUpperCase()}${l.penalty ? ` <span style="color:#d97a70;">−${l.penalty * 10}%</span>` : ''}</div><b>${esc(l.player.name)}</b><span class="tma-mini">R5 ${l.effectiveR5.toFixed(1)}${trainingSparkline(l.player.plot)}</span></div>`
        : `<div class="tma-slot"><div class="tma-pos">${l.slot.toUpperCase()}</div><b class="tma-empty">— empty —</b></div>`).join('')}</div>`)
      .join('');

    const benchHtml = bench.named.map(b => b.player
      ? `<div class="tma-bench-card"><span class="tma-role-tag">${b.role}</span><span>${esc(b.player.name)} <span class="tma-badge">${esc(b.player.fp)}</span></span><span class="tma-mini">R5 ${b.rating.toFixed(1)}</span></div>`
      : `<div class="tma-bench-card"><span class="tma-role-tag">${b.role}</span><span class="tma-mini">no eligible player left</span></div>`).join('');
    const benchExtrasHtml = bench.extras.length ? `<div class="tma-mini" style="margin-top:6px;">Also available: ${bench.extras.map(p => esc(p.name) + ' (' + esc(p.fp) + ')').join(', ')}</div>` : '';

    const rolesHtml = `
      <div class="tma-row"><span>Captain</span><span class="tma-goodval">${roles.captain ? esc(roles.captain.name) : '—'}</span></div>
      <div class="tma-row"><span>Corner taker</span><span class="tma-goodval">${roles.corner ? esc(roles.corner.name) : '—'}</span></div>
      <div class="tma-row"><span>Penalty taker</span><span class="tma-goodval">${roles.penalty ? esc(roles.penalty.name) : '—'}</span></div>
      <div class="tma-row"><span>Free-kick taker</span><span class="tma-goodval">${roles.freeKick ? esc(roles.freeKick.name) : '—'}</span></div>
    `;

    const condOrdersHtml = plan.condOrders.map((o, i) => {
      const c = describeCondOrder(o);
      return `
      <div class="tma-card" style="margin-bottom:8px;">
        <div class="tma-mini" style="text-transform:uppercase;letter-spacing:.04em;color:#8a939c;">Order ${i + 1}</div>
        <div class="tma-row"><span>Event</span><span>${esc(c.event)}</span></div>
        <div class="tma-row"><span>Score</span><span>${esc(c.score)}</span></div>
        <div class="tma-row"><span>Order</span><span class="tma-goodval">${esc(c.order)}</span></div>
      </div>`;
    }).join('');

    // Expected (this fixture) tactics — the primary, proof-backed read from the match page,
    // with the substitute-inclusion bug fixed (see fetchNextMatchExpected, Section 3) so the
    // formation string is either a real 9-11-player read or honestly blank, never garbage.
    const expectedTacticsHtml = (expectedSlice && expectedSlice.data && (expectedSlice.data.mentality || expectedSlice.data.style || expectedSlice.data.focus || expectedSlice.data.formation)) ? (() => {
      const e = expectedSlice.data;
      const line = (label, val) => val ? `<div class="tma-row"><span>${label}</span><span class="tma-goodval">${val}</span></div>` : '';
      return `
        <div class="tma-card">
          <h4>Opponent Expected Tactics <span class="tma-badge">this fixture · from match page</span></h4>
          ${line('Formation', e.formation)}
          ${line('Mentality', e.mentality ? MENTALITY[e.mentality] : null)}
          ${line('Attacking style', e.style ? ATT_STYLE[e.style] : null)}
          ${line('Focus side', e.focus ? FOCUS_SIDE[e.focus] : null)}
        </div>`;
    })() : '';

    const intelHtml = (() => {
      const sc = scoutSlice && scoutSlice.data;
      if (!sc) return '';
      const rows = [];
      const h = sc.h2h;
      if (h && h.w + h.d + h.l) rows.push(['Head to head', `W${h.w} D${h.d} L${h.l} · goals ${h.gf}-${h.ga}${h.last.length ? ' · last ' + h.last.join('') : ''}`]);
      if (sc.manager && sc.manager.text) rows.push(['Their manager', `last seen ${sc.manager.days != null ? (sc.manager.days === 0 ? 'today' : sc.manager.days === 1 ? 'yesterday' : sc.manager.days + ' days ago') : sc.manager.text}${sc.manager.days >= 14 ? ' — inactive: their saved XI and tactics won\'t change' : ''}`]);
      const conc = sc.conceded ? Object.entries(sc.conceded).filter(([, x]) => x.a >= 4).map(([k, x]) => ({ k, ...x, r: x.sh / x.a })).sort((a, b) => b.r - a.r) : [];
      if (conc.length) rows.push(['They concede to', conc.slice(0, 3).map(x => `${ATT_STYLE[x.k]} ${Math.round(x.r * 100)}% shots (${x.g} goals / ${x.a})`).join(' · ')]);
      const ig = sc.inGame;
      if (ig && ig.games) rows.push(['In-game changes', [ig.chase && `attack from ~${ig.chase.min}' when behind`, ig.hold && `defend from ~${ig.hold.min}' when ahead`].filter(Boolean).join(', ') || `none in their last ${ig.games}`]);
      if (!rows.length) return '';
      return `<div class="tma-card"><h4>Opponent intel <span class="tma-badge">last ${sc.sampleSize || 0} games</span></h4>${rows.map(([k, v]) => `<div class="tma-row"><span>${k}</span><span>${esc(v)}</span></div>`).join('')}</div>`;
    })();

    // Training recommendations (SECTION 5E): weak primary skills to train, plateau flags,
    // and priority youths in their development-bonus window. Shown even without an opponent.
    const trainingRecs = generateTrainingRecommendations(players);
    const trainingHtml = trainingRecs.length ? `
      <div class="tma-card">
        <h4>Training Priorities <span class="tma-mini">(${trainingRecs.length} players)</span></h4>
        <div class="tma-mini" style="margin-bottom:8px;">Weak "primary" skills for each player's natural position, plus who's plateaued. Ages 16–18 are in TM's development-bonus window — train those hardest.</div>
        ${trainingRecs.slice(0, 12).map(r => `
          <div class="tma-row">
            <span>${esc(r.name)} <span class="tma-badge">${esc(r.bucket)}</span>${r.isYouth ? ' <span class="tma-badge" style="background:#2a2f42;color:#b9c4ee;">youth</span>' : ''}</span>
            <span class="tma-mini">${r.focus ? `<span style="color:#e8cfa0;">${r.focus}</span> · ` : ''}${r.plateaued ? '<span style="color:#e05555;">plateaued</span>' : ''}${r.note ? ' <span class="tma-mini">' + esc(r.note) + '</span>' : ''}</span>
          </div>`).join('')}
      </div>` : '';

    const ev = settings.evidence || {};
    const signed = v => (v >= 0 ? '+' : '') + v.toFixed(1);
    const effectRows = (pick, names) => pick.rows.slice(0, 4).map(x => `<div class="tma-row"><span>${names[x.value] || x.value}${x.value === pick.value ? ' ✓' : ''}</span><span class="tma-mini">${x.mean >= 0 ? '+' : ''}${x.mean.toFixed(2)} ±${x.se.toFixed(2)} goals · n ${x.n}${x.n < LEARN_MIN_SAMPLES ? ' (too few)' : ''}</span></div>`).join('');
    const graded = gradedPredictions().slice(0, 5);
    const learnHtml = `
      <div class="tma-card">
        <h4>What the results say <span class="tma-badge">${ev.n || 0} league matches · your division + top division</span></h4>
        ${!ev.ready ? `<div class="tma-mini">Needs ${LEARN_MIN_MATCHES}+ played matches from your division before it judges anything — until then mentality and style above are heuristics.</div>` : `
          <div class="tma-mini" style="margin-bottom:6px;">Fitted on your division: +1★ of average XI rating ≈ ${signed(ev.coef[1])} goals, home ≈ ${signed(ev.coef[0])}, typical miss ±${ev.rmse.toFixed(1)} goals.${ev.teamFactor && ev.teamFactor.n ? ` You've played ${signed(ev.teamFactor.raw)} goals/match vs your ratings (${ev.teamFactor.n} matches; ${signed(ev.teamFactor.shrunk)} counted).` : ''}</div>
          ${settings.predictedGD != null ? `<div class="tma-row"><span>Expected (strength only, ${settings.weAreHome ? 'home' : 'away'})</span><span class="tma-goodval">${signed(settings.predictedGD)} goals · ${ev.context}</span></div>` : ''}
          ${ev.mentality ? `<div class="tma-mini" style="margin:6px 0 2px;">Mentality — sides in your situation (${ev.context}), goals vs expectation:</div>${effectRows(ev.mentality, MENTALITY)}` : ''}
          ${ev.style ? `<div class="tma-mini" style="margin:6px 0 2px;">Attacking style:</div>${effectRows(ev.style, ATT_STYLE)}` : ''}
          ${best.shapeRows && best.shapeRows.length ? `<div class="tma-mini" style="margin:6px 0 2px;">Formations (all situations), goals vs expectation:</div>${best.shapeRows.slice(0, 6).map(x => `<div class="tma-row"><span>${esc(x.value)}${x.value === best.shape ? ' ✓' : ''}</span><span class="tma-mini">${x.mean >= 0 ? '+' : ''}${x.mean.toFixed(2)} ±${x.se.toFixed(2)} · n ${x.n}${x.n < LEARN_MIN_SAMPLES ? ' (too few)' : ''}</span></div>`).join('')}${(() => { const y = (best.metaRows || []).find(r => r.value === 'true'), n = (best.metaRows || []).find(r => r.value === 'false'); return y && n ? `<div class="tma-row"><span>3 DC + 2 FC meta vs the rest</span><span class="tma-mini">${(y.mean - n.mean) >= 0 ? '+' : ''}${(y.mean - n.mean).toFixed(2)} goals · ${y.n} v ${n.n} sides</span></div>` : ''; })()}` : (ev.ready ? '<div class="tma-mini" style="margin-top:6px;">Formation effects appear once matches are re-read with their shapes (Learn from more matches).</div>' : '')}
          <div class="tma-mini" style="margin-top:6px;">Other teams' matches only, and associations rather than experiments — a setting only overrides the heuristic when it clearly beats it.</div>`}
        ${graded.length ? `<div class="tma-mini" style="margin:8px 0 2px;">How our predictions did:</div>${graded.map(g => `<div class="tma-row"><span>${esc(g.d)} · ${esc(g.score)}</span><span class="tma-mini">predicted ${signed(g.gd)} · actual ${signed(g.actual)}</span></div>`).join('')}` : ''}
        <button class="tma-btn secondary" id="tma-learn">Learn from more matches</button>
        <div class="tma-progress" id="tma-learn-status"></div>
      </div>`;

    const progressHtml = trainingProgressHtml();

    body.innerHTML = `
      ${applyCardHtml(squad)}
      <div class="tma-card">
        <h4>Recommended Formation: ${best.formation} <span class="tma-badge">Avg R5 ${(best.totalRec / startingPlayers.length).toFixed(1)}</span></h4>
        ${best.why ? `<div class="tma-mini" style="margin-bottom:6px;">Chosen ${esc(best.why)}.</div>` : ''}
        ${best.alternatives.length ? `<div class="tma-mini" style="margin-bottom:6px;">${best.alternatives.join(', ')} ${best.alternatives.length > 1 ? 'are' : 'is'} within 1% on raw strength.</div>` : ''}
        <div class="tma-pitch">${pitchRowsHtml}</div>
      </div>
      <div class="tma-card">
        <h4>Suggested Tactic Settings</h4>
        ${settings.difficulty ? `<div class="tma-row"><span>Fixture difficulty</span><span style="color:${settings.difficulty.cls === 'badval' ? '#e05555' : (settings.difficulty.cls === 'warn' ? '#ff9800' : (settings.difficulty.cls === 'goodval' ? '#9ece6a' : '#8a939c'))};font-weight:700;">${settings.difficulty.label}</span></div>` : ''}
        <div class="tma-row"><span>Mentality</span><span class="tma-goodval">${MENTALITY[settings.mentality]}</span></div>
        <div class="tma-row"><span>Attacking Style</span><span class="tma-goodval">${ATT_STYLE[settings.style]}</span></div>
        <div class="tma-row"><span>Focus Side</span><span class="tma-goodval">${FOCUS_SIDE[settings.focus]}</span></div>
        ${settings.counter ? `<div class="tma-mini" style="margin-top:6px;">⚔ ${esc(settings.counter.note)}</div>` : ''}
        <details style="margin-top:6px;"><summary class="tma-mini" style="cursor:pointer;">Why these settings</summary>${settings.reasoning.map(r => `<div class="tma-reason">${esc(r)}</div>`).join('')}</details>
      </div>
      ${learnHtml}
      <div class="tma-card">
        <h4>Captain &amp; Set-Piece Takers</h4>
        ${rolesHtml}
      </div>
      <div class="tma-card">
        <h4>Bench</h4>
        ${benchHtml}
        ${benchExtrasHtml}
      </div>
      <div class="tma-card">
        <h4>Conditional Orders (set before kickoff) <span class="tma-badge">5 / 5 used</span></h4>
        <div class="tma-mini" style="margin-bottom:8px;">Timed for ${plan.ctx.context === 'underdog' ? 'an underdog — hold a lead early, chase late' : plan.ctx.context === 'favourite' ? 'a favourite — chase early, protect late' : 'an even match'}${plan.ctx.oppMent >= 6 ? ', 5 minutes sooner against their attacking mentality' : ''} ${plan.ctx.oppChase && plan.ctx.oppChase.n >= 2 ? `, a lead protected before their usual push (~${plan.ctx.oppChase.min}')` : ''}${plan.ctx.oppHold && plan.ctx.oppHold.n >= 2 ? `, chasing before they usually sit back (~${plan.ctx.oppHold.min}')` : ''} (own heuristic). ${onTacticsPage() ? 'Saved by Apply above.' : 'Apply saves these for you on the Tactics page.'} Substitutes come on in a free slot of their own line.</div>
        ${condOrdersHtml}
      </div>
      ${expectedTacticsHtml}
      ${intelHtml}
      ${reservePlanHtml()}
      ${progressHtml}
      ${trainingHtml}
    `;
    bindApplyCard(plan);
    bindBtn('tma-learn', async () => {
      const st = document.getElementById('tma-learn-status'), btn = document.getElementById('tma-learn');
      btn.disabled = true;
      try {
        const r = await crawlDivision(400, (i, n) => { st.textContent = `Reading match report ${i} / ${n}…`; });
        setSlice('matchBankCrawl', r);
      } catch (e) { st.textContent = 'Could not crawl: ' + e.message; btn.disabled = false; return; }
      renderTactics();
    });
  }

  // Mentality, focus and the orders all hinge on the opponent, so Apply is only offered once
  // the scanned squad is the one we actually play next — otherwise mentality silently falls
  // back to Normal (seen live: it would have flipped Defensive → Normal v a much stronger side).
  function opponentReadiness() {
    const opp = getSlice('opponent');
    const nm = getSlice('home') && getSlice('home').data && getSlice('home').data.nextMatch;
    const nextOpp = nm ? (String(nm.home.id) === clubId ? nm.away : nm.home) : null;
    if (!opp || !opp.data) return { ready: false, text: 'No opponent scanned — the plan would assume an even match.' };
    if (nextOpp && String(nextOpp.id) !== String(opp.data.id)) return { ready: false, text: `Scanned ${opp.data.name || 'an old opponent'}, but you play ${nextOpp.name} next.` };
    if (!nextOpp) return { ready: false, text: `Scanned ${opp.data.name || 'an opponent'}, but your next fixture isn't known yet.` };
    return { ready: true, text: `Planned against ${opp.data.name} · scanned ${ago(opp.t)}` + (opp.data.source === 'star-estimate' ? ' (star estimate)' : '') };
  }

  // Top card of the Tactics view. On /tactics/ it previews and applies the plan; elsewhere it
  // just points there. The diff needs the saved orders (an AJAX read), so it fills in after.
  // Skill points gained over the last ~`days`, from the weekly history (Section 1B).
  function recentSkillGain(playerId, days) {
    const h = getSlice('history');
    if (!h || !h.data) return null;
    const keys = Object.keys(h.data).sort();
    const latest = keys.length && (h.data[keys[keys.length - 1]] || []).find(x => String(x.id) === String(playerId));
    const cutoff = now() - days * 864e5;
    const baseKey = [...keys].reverse().find(k => new Date(k).getTime() <= cutoff) || keys[0];
    const base = (h.data[baseKey] || []).find(x => String(x.id) === String(playerId));
    if (!latest || !base || !latest.sk || !base.sk || baseKey === keys[keys.length - 1]) return null;
    const gain = Object.keys(latest.sk).reduce((a, k) => a + ((latest.sk[k] || 0) - (base.sk[k] || 0)), 0);
    return { gain, weeks: Math.max(1, Math.round((new Date(keys[keys.length - 1]) - new Date(baseKey)) / 6048e5)) };
  }
  // Every player on both teams: this week's TI, its 4-week average, skill points gained since
  // ~4 weeks ago, and the custom plan the copilot set (with its reason).
  function trainingProgressHtml() {
    const plans = (getSlice('trainingPlans') || { data: [] }).data || [];
    if (!plans.length) return '';
    const tiOf = Object.fromEntries(((getSlice('players') || { data: [] }).data || []).map(p => [String(p.id), p]));
    const rows = plans.map(pl => {
      const p = tiOf[pl.id] || {};
      const plot = (p.plot || []).slice(-4).map(Number).filter(v => !isNaN(v));
      const avg = plot.length ? plot.reduce((a, b) => a + b, 0) / plot.length : null;
      return { ...pl, ti: p.ti, avg, g: recentSkillGain(pl.id, 28), total: recentSkillGain(pl.id, 3650), r5: p._r5 != null ? Number(p._r5) : null, peak: p.skills ? peakProjection(p) : null };
    }).sort((a, b) => (a.team === b.team ? 0 : a.team === 'A' ? -1 : 1) || ((a.age || 0) - (b.age || 0)));
    return `
      <div class="tma-card">
        <h4>Training progress <span class="tma-badge">${plans.length} players · both teams</span></h4>
        <div class="tma-mini" style="margin-bottom:6px;">TI this week / 4-week average, skill points gained in ~4 weeks and since tracking began (weekly snapshots after Tuesday's training), R5 now → projected at ${projectionAge()} (your Max age on the Scouting tab — TM's decline starts at 28; from your club's own training curve), and the custom plan (groups: str·wor·sta – mar·tac – cro·pac – pas·tec·set – hea·pos – fin·lon).</div>
        ${(() => { const g = clubGrowth(); const parts = g.bands.map((b, i) => b.ti != null ? `${GROWTH_BANDS[i][0]}${GROWTH_BANDS[i][1] < 99 ? '–' + (GROWTH_BANDS[i][1] - 1) : '+'}: TI ${b.ti.toFixed(1)} (≈${(b.ti * TI_SKILL * SEASON_WEEKS).toFixed(0)} pts/season)` : null).filter(Boolean); return parts.length ? `<div class="tma-mini" style="margin-bottom:6px;">Your club's training by age — ${parts.join(' · ')}</div>` : ''; })()}
        ${rows.map(r => `<div class="tma-row"><span>${r.team === 'B' ? '<span class="tma-badge">res</span> ' : ''}${esc(r.name)} <span class="tma-mini">${r.age ? Math.floor(r.age) : '?'} · ${esc(String(r.slot).toUpperCase())}</span></span><span class="tma-mini" title="${esc(r.why)}">TI ${r.ti != null ? r.ti : '–'}${r.avg != null ? ' / ' + r.avg.toFixed(1) : ''} · ${r.g ? (r.g.gain >= 0 ? '+' : '') + r.g.gain + ' pts / ' + r.g.weeks + 'w' : 'tracking…'}${r.total && r.total.weeks > (r.g ? r.g.weeks : 0) ? ' (' + (r.total.gain >= 0 ? '+' : '') + r.total.gain + ' / ' + r.total.weeks + 'w)' : ''}${r.r5 != null ? ' · R5 ' + r.r5.toFixed(1) + (r.peak != null ? ' → ' + r.peak.toFixed(1) : '') : ''} · <b>${r.dots.join('-')}</b></span></div>`).join('')}
      </div>`;
  }

  function applyCardHtml(squad) {
    if (!onTacticsPage()) {
      return `<div class="tma-card"><h4>Apply this plan</h4><div class="tma-mini">Open the <a href="/tactics/" style="color:var(--tma-gold);">Tactics page</a> to preview and save it in one click.</div></div>`;
    }
    const last = getSlice('tacticsApplied');
    const recent = last && now() - last.t < 10 * 60e3;
    const result = !recent ? '' : last.data.ok
      ? `<div class="tma-row"><span class="tma-goodval">✔ ${esc(last.data.label)} — saved and verified</span><span class="tma-mini">${ago(last.t)}</span></div>`
      : `<div class="tma-row" style="color:var(--tma-red);">⚠ ${esc(last.data.label)}: not saved — ${esc(last.data.mismatches.join(', '))}</div>`;
    const nmi = nextMatchInfo();
    const lockedLine = nmi && nmi.lockAt && now() >= nmi.lockAt && now() < nmi.kickoff + 3 * 3600e3
      ? `<div class="tma-row" style="color:var(--tma-amber);">⚠ Tactics for the ${esc(nmi.tmTime)} match are locked: TM simulates it about an hour before kickoff. Saving now only affects later matches.</div>` : '';
    const opp = opponentReadiness();
    const oppLine = `<div class="tma-row"><span class="${opp.ready ? 'tma-mini' : ''}" style="${opp.ready ? '' : 'color:var(--tma-amber);'}">${opp.ready ? '' : '⚠ '}${esc(opp.text)}</span>
      <button class="tma-btn secondary" id="tma-scan-opp" style="width:auto;margin:0;padding:4px 10px;">${opp.ready ? 'Rescan' : 'Scan next opponent'}</button></div>`;
    const risky = squad.filter(p => p.banRisk && p.ban !== '1');
    const restToggle = risky.length ? `
      <label class="tma-mini" style="display:flex;gap:6px;align-items:center;margin:6px 0;cursor:pointer;">
        <input type="checkbox" id="tma-restban" ${restBanRisk() ? 'checked' : ''}>
        Rest players one card from a ban (${risky.map(p => esc(p.name.split(' ').pop())).join(', ')})
      </label>` : '';
    return `
      <div class="tma-card" id="tma-apply-card">
        <h4>This match's plan <span class="tma-badge" id="tma-apply-count">checking…</span></h4>
        <div class="tma-mini" style="margin-bottom:4px;">⚡ Prepare match saves it (with the reserves, training and youth pull).</div>
        ${result}
        ${lockedLine}
        ${oppLine}
        ${restToggle}
        <details id="tma-apply-preview"><summary class="tma-mini" style="cursor:pointer;">Preview changes</summary><div id="tma-apply-diff" class="tma-mini">Reading what's saved…</div></details>
        ${getSlice('tacticsBackup') ? '<button class="tma-btn secondary" id="tma-undo">Undo last apply</button>' : ''}
        <div class="tma-progress" id="tma-apply-status"></div>
      </div>`;
  }

  function bindApplyCard(plan) {
    if (!onTacticsPage()) return;
    const state = planToTactic(plan);
    const status = document.getElementById('tma-apply-status');
    const restBox = document.getElementById('tma-restban');
    if (restBox) restBox.addEventListener('change', () => { try { localStorage.setItem(REST_BAN_RISK_KEY, restBox.checked ? '1' : '0'); } catch (e) {} renderTactics(); });
    readSavedTactic().then(saved => {
      const rows = tacticDiff(state, saved);
      const count = document.getElementById('tma-apply-count'), diff = document.getElementById('tma-apply-diff');
      if (!count) return; // view was re-rendered meanwhile
      count.textContent = rows.length ? rows.length + ' change' + (rows.length > 1 ? 's' : '') : 'up to date';
      diff.innerHTML = rows.length
        ? rows.map(([what, from, to]) => `<div class="tma-row"><span>${esc(what)}</span><span>${esc(from)} → <b>${esc(to)}</b></span></div>`).join('')
        : 'The saved tactic already matches this plan.';
    }).catch(e => { status.textContent = 'Could not read the saved tactic: ' + e.message; });
    const run = (label, fn) => async () => {
      document.querySelectorAll('#tma-apply-card .tma-btn').forEach(b => { b.disabled = true; });
      status.textContent = label + '…';
      try { await fn(); } catch (e) { status.textContent = label + ' failed: ' + e.message + ' — reload the page to see what was saved.'; }
    };
    bindBtn('tma-scan-opp', run('Scanning next opponent', async () => {
      await refreshAll((key, st) => { status.textContent = 'Scanning: ' + key + ' ' + st; });
      renderTactics();
    }));
    bindBtn('tma-undo', run('Undoing', () => {
      const b = getSlice('tacticsBackup').data;
      return saveTacticAndVerify({ ...b, orders: b.orders.map(o => Object.fromEntries(ORDER_FIELDS.map(f => [f, o[f]]))) }, 'Undo', false);
    }));
  }

  function renderStadiumTab() {
    const body = document.getElementById('tma-body');
    const stadiumSlice = getSlice('stadium');
    const homeSlice = getSlice('home');
    const financesSlice = getSlice('finances');
    const maintenanceSlice = getSlice('maintenance');
    const clubSlice = getSlice('club');
    if (!stadiumSlice) {
      body.innerHTML = `<div class="tma-card"><h4>No stadium data yet</h4></div>`;
      return;
    }
    const { cash, fd, stadiumSeats, attendanceRef, financials } = stadiumContext(stadiumSlice.data);

    // Fan-based seat target: user's own tip — capacity should be roughly 2.5x club fans.
    let seatTargetHtml = '';
    if (clubSlice && clubSlice.data.fans) {
      const fansNum = parseMoney(clubSlice.data.fans);
      if (fansNum) {
        const target = Math.round(fansNum * 2.5);
        seatTargetHtml = `<div class="tma-row"><span>Fan-based seat target</span><span class="tma-goodval">${target.toLocaleString()}</span></div>
          <div class="tma-mini">${fansNum.toLocaleString()} fans × 2.5. ${stadiumSeats ? 'Current stadium facility level reads ' + stadiumSeats.toLocaleString() + ' — compare against this target manually since we can\'t confirm the exact level→seats mapping from scraped data alone.' : ''}</div>`;
      }
    }

    const results = analyseStadium(fd, cash, attendanceRef, financials);
    const TIER_LABEL = { 0: 'Youth/Training priority', 1: 'Income generator', 2: 'Other' };
    const TIER_COLOR = { 0: 'background:#3d2d1d;color:#ffd9a8', 1: 'background:#1f5023;color:#bfe6bf', 2: 'background:#153618;color:#8a939c' };

    const rowsHtml = results.slice(0, 12).map(r => {
      const afford = r.affordable ? '<span class="tma-badge">affordable</span>' : '<span class="tma-badge" style="background:#4a1d1d;color:#f8b4b4">too costly</span>';
      const stadiumTierBadge = `<span class="tma-badge" style="${TIER_COLOR[r.tier]}">${TIER_LABEL[r.tier]}</span>`;
      const payback = r.paybackWeeks ? r.paybackWeeks.toFixed(0) + ' wks payback' : (r.weeklyGain != null ? 'no clear ROI' : '');
      const warnHtml = r.sustainabilityWarning ? `<div class="tma-reason" style="color:#f8dca8;">⚠ ${r.sustainabilityWarning}</div>` : '';
      return `<div class="tma-card">
        <h4>${r.title} → Lvl ${r.nextLevel}</h4>
        <div style="margin:-4px 0 6px;">${stadiumTierBadge} ${afford}</div>
        <div class="tma-row"><span>Cost</span><span>${r.cost.toLocaleString()}</span></div>
        <div class="tma-row"><span>Maintenance Δ/wk</span><span>${r.maintDelta ? '+' + r.maintDelta.toLocaleString() : '0'}</span></div>
        ${r.weeklyGain != null ? `<div class="tma-row"><span>Est. income Δ/wk</span><span class="tma-goodval">${r.weeklyGain.toFixed(0)}</span></div>` : ''}
        <div class="tma-mini">${r.note}${payback ? ' · ' + payback : ''}</div>
        ${warnHtml}
      </div>`;
    }).join('');

    body.innerHTML = `
      <div class="tma-card">
        <h4>Cash on hand</h4>
        <div class="tma-row"><span>Available</span><span class="tma-goodval">${cash != null ? cash.toLocaleString() : '—'}</span></div>
        ${financials ? `<div class="tma-row"><span>Weekly income (approx.)</span><span>${financials.weeklyIncome.toLocaleString()}</span></div>
          <div class="tma-row"><span>Weekly maintenance (current)</span><span>${financials.weeklyMaintenance.toLocaleString()}</span></div>
          <div class="tma-row"><span>Headroom</span><span class="${financials.weeklyIncome - financials.weeklyMaintenance > 0 ? 'tma-goodval' : ''}">${(financials.weeklyIncome - financials.weeklyMaintenance).toLocaleString()}/wk</span></div>` : ''}
        ${seatTargetHtml}
      </div>
      <h4 style="margin:4px 2px;color:#7fb2e0;">Ranked Upgrades</h4>
      ${rowsHtml || '<div class="tma-mini">All facilities maxed, or no cost data found.</div>'}
    `;
  }

  function renderLeague() {
    const body = document.getElementById('tma-body');
    const c = loadCache();
    const slice = c.leagueStrength;
    const saved = slice && slice.data;
    const names = (slice && slice.names) || {};
    // Sort by best-XI R5 descending, with unranked (no data) teams sinking to the bottom.
    const entries = saved ? Object.entries(saved).map(([id, e]) => ({ id, ...e }))
      .sort((a, b) => (b.avg == null ? -1 : b.avg) - (a.avg == null ? -1 : a.avg)) : [];
    const myRank = clubId && entries.findIndex(e => e.id === clubId) >= 0 ? entries.findIndex(e => e.id === clubId) + 1 : null;
    const myEntry = clubId ? entries.find(e => e.id === clubId) : null;
    const myAvg = myEntry && myEntry.avg != null ? myEntry.avg : null;
    const rowHtml = (e) => {
      const isMe = String(e.id) === String(clubId);
      const diff = (myAvg != null && e.avg != null && !isMe) ? (e.avg - myAvg).toFixed(1) : null;
      return `<div class="tma-row" style="${isMe ? 'background:#1d242e;' : ''}">
        <span>${isMe ? '<span class="tma-badge">you</span> ' : ''}${esc(names[String(e.id)] || 'Club ' + e.id)}</span>
        <span class="tma-mini">${e.avg != null ? `<span class="tma-goodval">${e.avg}</span>${diff != null ? ` <span class="tma-mini">(${diff > 0 ? '+' : ''}${diff})</span>` : ''}` : 'no data'}</span>
      </div>`;
    };
    body.innerHTML = `
      <div class="tma-card">
        <h4>League Squad Strength <span class="tma-badge">best-XI R5 avg</span></h4>
        <div class="tma-mini" style="margin-bottom:8px;">Ranks every club in your league by the average R5 of its best 11, so you can see where you sit on squad quality (not points) and which remaining fixtures are toughest.</div>
        ${saved && entries.length ? entries.filter(e => e.avg != null).map(rowHtml).join('') : '<div class="tma-mini">Not built yet — tap Build below.</div>'}
        <button class="tma-btn" id="tma-league-build">🏆 Build League Strength</button>
        <div class="tma-mini" id="tma-league-status">${myRank ? 'You rank #' + myRank + ' by squad strength.' : 'Not ranked yet'}</div>
      </div>
    `;
    const bind = bindBtn;
    bind('tma-league-build', async () => {
      const status = document.getElementById('tma-league-status');
      status.textContent = 'Building… (fetching each club\'s squad — may take a moment)';
      try {
        const rank = await buildLeagueRanking();
        if (rank.error) { status.textContent = rank.error; return; }
        status.textContent = 'Built from ' + rank.leaguePath + ' (' + rank.results.filter(r => r.avg != null).length + '/' + rank.results.length + ' clubs rated).';
      } catch (e) {
        status.textContent = 'Build failed — see console.';
        console.error('TM Advisor: league build failed', e);
      }
      renderLeague();
    });
  }

  let marketAutoScanned = false;
  const MARKET_AUTO_SCAN_MS = 12 * 3600e3;
  function renderScouting() {
    const body = document.getElementById('tma-body');
    const c = loadCache();
    const scoutData = c.scoutReports ? c.scoutReports.data : null;
    const scoutAge = c.scoutReports ? ago(c.scoutReports.t) : null;

    // ---- 1. The compiled youth shortlist (age/Rou/SI/R5), from Section 5B ----
    const shortlistSlice = getSlice('youthShortlist');
    const shortlist = shortlistSlice ? shortlistSlice.data : null;
    const poolNow = collectYouthPool();
    const seniorPrefs = loadShortlistPrefs('senior');
    const fmtAge = a => a == null ? '?' : `${Math.floor(a)}y ${Math.round((a % 1) * 12)}m`;

    // ---- 2. Scout-report potential view (secondary source; no age/skills from endpoint) ----
    const scoutListHtml = (scoutData && scoutData.length) ? (() => {
      const ranked = [...scoutData].sort((a, b) => (b.potential || 0) - (a.potential || 0));
      return ranked.slice(0, 20).map(p => {
        const gem = p.growthMultiple != null && p.growthMultiple >= YOUTH_CRITERIA.highPotentialGrowth;
        const bloom = bloomEstimate(p.age, p.growthMultiple);
        return `<div class="tma-card">
          <h4><a href="${playerLink(p)}" target="_blank" style="color:#79a8d6;text-decoration:none;">${esc(p.name)} ↗</a> ${gem ? '<span class="tma-badge" style="background:#2a2f42;color:#b9c4ee;">high potential</span>' : ''}${bloom ? ` <span class="tma-badge" style="background:#2a2f42;color:${bloom.cls};">${bloom.phase}</span>` : ''}</h4>
          <div class="tma-row"><span>Current Rec</span><span>${(p.rec || 0).toFixed(1)}</span></div>
          <div class="tma-row"><span>Potential</span><span class="tma-goodval">${(p.potential / 2).toFixed(1)} / 5</span></div>
          ${bloom ? `<div class="tma-mini" style="color:${bloom.cls};">${esc(bloom.note)}</div>` : ''}
        </div>`;
      }).join('');
    })() : '<div class="tma-mini">No scout reports cached yet.</div>';

    const ms = getSlice('marketScan');
    const buys = (getSlice('marketBuys') || {}).data || null;
    const endsIn = t => { const m = Math.round((t - now()) / 60e3); return m < 60 ? `in ${Math.max(0, m)}m` : m < 1440 ? `in ${Math.round(m / 60)}h` : `in ${Math.round(m / 1440)}d`; };
    const buyRow = r => `
      <div class="tma-buy">
        <div class="tma-row"><span><a href="${playerLink(r)}" target="_blank" style="color:#79a8d6;text-decoration:none;font-weight:600;">${esc(r.name)} ↗</a>${r.steal ? ' <span class="tma-badge" title="Ends within the hour at a bid below his Sell-to-Agent price — you could sell him straight back to the agent for more">steal</span>' : ''}${natBadge(r)}</span><span class="tma-goodval" title="${r.slot ? 'What he adds to your XI now → in a year' : 'Projected R5 at ' + projectionAge()}">${r.slot ? '+' + r.gain.toFixed(1) + ' → +' + r.gainNext.toFixed(1) : 'R5 ' + r.r5.toFixed(1) + ' → ' + (r.peak != null ? r.peak.toFixed(1) : '?')}</span></div>
        <div class="tma-mini">${fmtAge(r.age)} · ${esc(r.fp || '?')} · R5 ${r.r5.toFixed(1)}${r.routine != null ? ' · Rou ' + r.routine.toFixed(1) : ''}${r.ti != null ? ' · training TI ' + r.ti.toFixed(1) + '/wk' : ''}${r.pace ? ' · ~' + r.pace + ' skill pts next season' : ''}${r.peak != null ? ' · R5 at ' + projectionAge() + ' ≈ ' + r.peak.toFixed(1) : ''}</div>
        ${r.scout ? `<div class="tma-mini">🔍 Scouted${r.scout.potential != null ? ' · potential ' + r.scout.potential + '/20' : ''}${r.scout.dev ? ' · development ' + esc(r.scout.dev) : ''}${r.scout.peaks ? ' · peaks ' + ['phy', 'tac', 'tec'].map(k => (r.scout.peaks[k] || '?')).join('/') + ' (phy/tac/tec of 4)' : ''}</div>` : ''}
        <div class="tma-mini">${r.slot ? `Starts at <b>${esc(String(r.slot).toUpperCase())}</b>${r.replaces ? ' for ' + esc(r.replaces) : ''} · ` : ''}next bid ${fmtMoney(r.minBid)}${r.price > r.minBid ? ' · likely <b>' + fmtMoney(r.price) + '</b>' : ''}${r.fair ? ' · market rate ' + fmtMoney(Math.round(r.fair)) : ''}${r.ends ? ' · ends ' + endsIn(r.ends) : ''}${r.wage ? ' · wage ' + fmtMoney(r.wage) + '/wk' : ''}</div>
      </div>`;
    const bucket = (title, list, open, empty) => `
      <details class="tma-sub" ${open ? 'open' : ''}><summary style="cursor:pointer;"><b>${title}</b> <span class="tma-badge">${list ? list.length : 0}</span></summary>
        ${list && list.length ? list.map(buyRow).join('') : `<div class="tma-mini">${empty}</div>`}
      </details>`;
    const pick = e => e ? `<a href="${playerLink(e)}" target="_blank" style="color:#79a8d6;text-decoration:none;font-weight:600;">${esc(e.name)}</a> <span class="tma-goodval">+${e.gain.toFixed(1)}</span><div class="tma-mini">${Math.floor(e.age)}y · R5 ${e.r5.toFixed(1)} · ${fmtMoney(e.price)}</div>` : '<span class="tma-mini">—</span>';
    const slotMap = t => t && t.bySlot && t.bySlot.length ? `
      <details class="tma-sub" open><summary style="cursor:pointer;"><b>By position</b> <span class="tma-mini">weakest starter first</span></summary>
        <table class="tma-pos"><tr><th>Pos</th><th>Starter</th><th>Best</th><th>Value</th></tr>
        ${t.bySlot.map(x => `<tr><td><b>${esc(x.slot.toUpperCase())}</b></td><td>${esc(x.name)}<div class="tma-mini" style="${x.below ? 'color:var(--tma-amber);font-weight:700;' : ''}">${x.r5.toFixed(1)}${x.peak != null ? ' → ' + x.peak.toFixed(1) : ''}${x.below ? ' ⚠' : ''}</div></td><td>${pick(x.best)}</td><td>${pick(x.value)}</td></tr>`).join('')}
        </table>
      </details>` : '';
    const teamSection = (title, t, open, note) => `
      <details class="tma-card" ${open ? 'open' : ''}><summary style="cursor:pointer;"><h4 style="display:inline;">${title} <span class="tma-badge">${t ? t.upgrades : 0} upgrades</span></h4></summary>
        <div class="tma-mini" style="margin:4px 0;">${note}${t && t.belowFloor ? ` <b style="color:var(--tma-amber);">${t.belowFloor} starter(s) below R5 ${MIN_LINEUP_R5} ⚠</b> — fix those first.` : ''}${t ? ` Foreign players in this XI: <b>${t.foreignXi}/${MAX_FOREIGN}</b> — TM allows ${MAX_FOREIGN} across XI + bench, so a foreign signing only counts while there's room; home-nation players are unlimited.` : ''}</div>
        ${t ? slotMap(t) + bucket('Best buys', t.best, true, 'Nobody on the market is an upgrade now and next year within budget.') + bucket('Value buys', t.value, false, 'No value upgrades right now.') : '<div class="tma-mini">Run a market scan.</div>'}
      </details>`;
    const budget0 = budgetGuidance();
    const scanHtml = `
      <div class="tma-card">
        <h4>Transfer market <span class="tma-badge">${ms ? 'scanned ' + ago(ms.t) : 'not scanned yet'}</span></h4>
        ${budget0 ? `<div class="tma-row"><span>Cash</span><span>${fmtMoney(budget0.cash)}</span></div>
        ${budget0.weeklyWage != null ? `<div class="tma-row"><span>Kept back (${BUDGET_WAGE_WEEKS_RESERVE} wks of wages)</span><span>${fmtMoney(budget0.buffer)}</span></div>` : ''}
        <div class="tma-row"><span>Transfer budget</span><span class="tma-goodval">${fmtMoney(budget0.recommendedMax)}</span></div>
        <div class="tma-row"><span class="tma-mini">Share of cash above the reserve</span><span class="tma-seg">${[0.1, 0.25, 0.5, 0.75].map(x => `<button class="tma-segbtn${!budget0.custom && Math.abs(budget0.share - x) < 1e-6 ? ' on' : ''}" data-buypct="${x}">${Math.round(x * 100)}%</button>`).join('')}</span></div>
        <div class="tma-row"><span class="tma-mini">…or an exact amount</span><input type="number" id="tma-buy-budget" min="0" step="1000000" placeholder="${fmtMoney(Math.round(budget0.spendable * budget0.share))}" value="${budget0.custom ? budget0.recommendedMax : ''}" style="width:120px;background:#161a1f;border:1px solid #2b323b80;color:#e6e9ec;border-radius:5px;padding:3px 6px;text-align:right;"></div>` : `<div class="tma-mini">Cash not read yet — open Home or Finances once.</div>`}
        <div class="tma-row"><span>Max age</span><input type="number" id="tma-buy-maxage" min="18" max="40" value="${seniorPrefs.maxAge != null ? seniorPrefs.maxAge : SENIOR_CRITERIA.maxAgeDefault}" style="width:70px;background:#161a1f;border:1px solid #2b323b80;color:#e6e9ec;border-radius:5px;padding:3px 6px;text-align:right;"></div>
        <label class="tma-row" style="cursor:pointer;"><span>Include foreign players</span><input type="checkbox" id="tma-market-foreign" ${seniorPrefs.includeForeign !== false ? 'checked' : ''}></label>
        <button class="tma-btn" id="tma-market-scan">🔎 Scan the transfer market</button>
        <div class="tma-progress" id="tma-market-status">${ms && ms.data ? `${ms.data.unique} listings${buys && buys.A ? ` · ${buys.considered} in budget` : ''}` : ''}</div>
        <div class="tma-mini" style="margin-top:4px;">Gains are what a player adds to that team's best XI (R5 with TM's position penalty and routine sharing), now → in a year. Budget = your chosen share of cash above the wage reserve (or an exact amount); each list holds one player per position; players priced over 30% above the market rate for their R5 and age are left out; growth projection by age (own heuristics). Price = the next bid, or his Sell-to-Agent price if higher unless the auction ends within the hour (others will outbid a bargain) — own heuristic. Never bids for you.</div>
      </div>`;
    body.innerHTML = `
      ${scanHtml}
      ${teamSection('First team', buys && buys.A, true, `R5 ≥ ${MIN_LINEUP_R5} (or under 24 and reaching it next season) <b>and</b> an upgrade to your best XI now and in a year (both sides projected). Best = biggest total gain; value = gain per million.`)}
      ${buys && buys.Y ? `
      <details class="tma-card"><summary style="cursor:pointer;"><h4 style="display:inline;">Youth prospects 🌱 <span class="tma-badge">${buys.Y.count}</span></h4></summary>
        <div class="tma-mini" style="margin:4px 0;">Aged ≤ ${RESERVE_MAX_AGE}: they develop in the reserves. Listed only if projected to reach R5 ${buys.Y.bar.toFixed(1)} by ${projectionAge()} (your ${MIN_LINEUP_R5} floor, or your weakest starter if higher) — growth from his own training this season where his wage shows it, else your club's curve × his talent.</div>
        ${bucket('Highest ceiling', buys.Y.best, true, 'No youth on the market is projected to reach that level within budget.')}
        ${bucket('Best value', buys.Y.value, false, 'None right now.')}
      </details>` : ''}
      ${(() => {
        const sl = (getSlice('sellList') || {}).data;
        if (!sl) return '';
        const line = r => `<div class="tma-buy"><div class="tma-row"><span><a href="${playerLink(r)}" target="_blank" style="color:#79a8d6;text-decoration:none;font-weight:600;">${esc(r.name)} ↗</a> <span class="tma-badge">${r.team === 'B' ? 'reserves' : 'first team'}</span></span><span>${r.sta ? fmtMoney(r.sta) : '—'}</span></div>
          <div class="tma-mini">${fmtAge(r.age)} · ${esc(r.fp || '?')} · R5 ${r.r5.toFixed(1)}${r.peak != null ? ' → ' + r.peak.toFixed(1) + ' at ' + projectionAge() : ''}${r.wage ? ' · wage ' + fmtMoney(r.wage) + '/wk' : ''}</div>
          <div class="tma-mini">${esc(r.why)}${r.staDrop > 0 ? ` · agent price falls ~${fmtMoney(Math.round(r.staDrop))} by next season` : ''}</div></div>`;
        return `<details class="tma-card"><summary style="cursor:pointer;"><h4 style="display:inline;">Sell recommendations <span class="tma-badge">${sl.sell.length}</span></h4></summary>
          <div class="tma-mini" style="margin:4px 0;">Squad ${sl.size.A} + ${sl.size.B} reserves → ${sl.after.A} + ${sl.after.B} after these sales · about ${fmtMoney(sl.income)} from the agent · ${fmtMoney(sl.wages)}/wk in wages saved. Kept: your XI and bench, youths projected to reach R5 ${sl.bar.toFixed(1)} by ${projectionAge()}, and youths starting for the reserves; at least ${SELL_MIN_A} + ${SELL_MIN_B} players and ${SELL_MIN_GK} keepers per team stay (own heuristics). Price shown = Sell-to-Agent now — listing him can fetch more. Never sells for you.</div>
          ${sl.sell.map(line).join('') || '<div class="tma-mini">Nothing surplus right now.</div>'}
          ${sl.hold.length ? `<details class="tma-sub"><summary style="cursor:pointer;"><b>Surplus kept for numbers</b> <span class="tma-badge">${sl.hold.length}</span></summary>${sl.hold.map(line).join('')}</details>` : ''}
        </details>`;
      })()}
      <details class="tma-card"><summary style="cursor:pointer;"><h4 style="display:inline;">Scouts' potential board <span class="tma-badge">${scoutData ? scoutData.length : 0}</span></h4></summary>
        <button class="tma-btn secondary" id="tma-scout-refresh">🔍 Refresh scout reports</button>
        <div class="tma-mini" id="tma-scout-status">${scoutData ? scoutData.length + ' reports cached (' + scoutAge + ')' : 'Not fetched yet'}</div>
        ${scoutListHtml}
      </details>
    `;

    const bind = bindBtn;

    const saveFilters = () => {
      const fb = document.getElementById('tma-market-foreign'), ageEl = document.getElementById('tma-buy-maxage');
      ['senior', 'youth'].forEach(w => saveShortlistPrefs(w, { ...loadShortlistPrefs(w), includeForeign: !!(fb && fb.checked), ...(w === 'senior' && ageEl && ageEl.value ? { maxAge: Number(ageEl.value) } : {}) }));
      buildBuyLists();
      try { buildSellList(); } catch (e) { console.warn('TM Advisor: sell list', e); }
      renderScouting();
    };
    ['tma-market-foreign', 'tma-buy-maxage'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('change', saveFilters); });
    const setBudget = patch => { saveShortlistPrefs('senior', { ...loadShortlistPrefs('senior'), ...patch }); buildBuyLists(); renderScouting(); };
    document.querySelectorAll('[data-buypct]').forEach(b => b.addEventListener('click', () => setBudget({ buyPct: Number(b.dataset.buypct), budget: null })));
    const be = document.getElementById('tma-buy-budget');
    if (be) be.addEventListener('change', () => setBudget({ budget: be.value ? Number(be.value) : null }));
    const runScan = async () => {
      const st = document.getElementById('tma-market-status'), btn = document.getElementById('tma-market-scan');
      if (btn) btn.disabled = true;
      try { await marketScan(t => { const s2 = document.getElementById('tma-market-status'); if (s2) s2.textContent = t; }); }
      catch (e) { if (st) st.textContent = 'Scan failed: ' + e.message; if (btn) btn.disabled = false; return; }
      if (document.getElementById('tma-market-scan')) renderScouting();
    };
    bind('tma-market-scan', runScan);
    // Opening the Scouting tab with a stale (or no) scan starts one: the lists are the point.
    if (!marketAutoScanned && window.SESSION && SESSION.id && (!ms || now() - ms.t > MARKET_AUTO_SCAN_MS)) { marketAutoScanned = true; runScan(); }
    else if (ms && (!buys || buys.Y === undefined) && buildBuyLists()) { renderScouting(); return; }
    else if (!getSlice('sellList') && (getSlice('ownSquads') || {}).data && buildSellList()) { renderScouting(); return; }

    bind('tma-scout-refresh', async () => {
      const status = document.getElementById('tma-scout-status');
      status.textContent = 'Fetching…';
      try {
        const reports = await fetchScoutReports();
        const cc = loadCache();
        cc.scoutReports = { t: now(), data: reports };
        saveCache(cc);
        renderScouting();
      } catch (e) {
        status.textContent = 'Failed to fetch scout reports — see console for details.';
        console.error('TM Advisor: scout report fetch failed', e);
      }
    });

  }

  /* ============================================================
   *  SECTION 8 — BOOT
   * ============================================================ */

  // The dock is skipped entirely on /club/* and /players* pages — those already get their
  // own inline injected UI (Rou/SI/R5 columns, the player-detail card) directly on the game
  // page itself, so the floating dock would just be redundant chrome in the way. Background
  // capture/parsing/caching (autoCaptureCurrentPage, column injection) still runs regardless.
  function dockDisabledHere() {
    const p = location.pathname;
    return p.startsWith('/club/') || p.startsWith('/players') || p.startsWith('/youth-development');
  }
  function boot() {
    measureTmOffset(document); // #tm_clock was rendered moments ago
    injectStyle();
    if (!dockDisabledHere()) buildPanel();
    autoCaptureCurrentPage();
    if (location.pathname.startsWith('/tactics')) verifyPendingApply();
    // Top window only (not TM's iframes), after the page has settled.
    if (window.top === window) {
      setTimeout(() => { runCopilot().catch(e => console.warn('TM Advisor: copilot', e)); }, 4000);
      setTimeout(() => { backgroundCrawl(); }, 15000); // after the autopilot, never competing with it
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') boot();
  else document.addEventListener('DOMContentLoaded', boot);

})();
