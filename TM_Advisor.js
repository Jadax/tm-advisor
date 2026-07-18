// ==UserScript==
// @name         TM Advisor — Tactics, Stadium, Scouting & Youth Dashboard
// @namespace    https://tushantsharma.tools/tm-advisor
// @version      3.2.0
// @description  A single visual advisor for TrophyManager. A single collapsible dock (bottom-right, no separate button) that shows exactly ONE tab — whichever is relevant to the page you're on: Dashboard (data freshness + next/last match) on the homepage, Tactics on the tactics/players pages, Scouting on the transfer/scouts pages, Stadium on stadium/finances. Tactics gives you formation, mentality/style/focus, captain/set-piece takers, bench, position-aware conditional substitution orders and the opponent's expected next-fixture tactics. Scouting gives a tiered (Elite/Strong) youth and senior transfer shortlist built ONLY from players actually seen on the /transfer/ list, with confirmed Sell-to-Agent/Max Sell Price valuations and spending guidance. Surfaces Rou / SI / R5 columns (with development trend arrows) on the game's own player and transfer tables, and on any individual player's profile page a Physique/Tactical/Technical star breakdown, exact sale-price figures and a training-growth projector. Overlays accurate R5 + team averages on the match page, and captures full match stats and a goal/card/injury timeline. All numbers come from the game's own data or formulas cross-confirmed against multiple independent community scripts — nothing is guessed.
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
 *  TM ADVISOR  —  © Tushant Sharma. Released under the MIT licence.
 *
 *  Not affiliated with, endorsed by, or connected to Trophy Games A/S.
 *  "TrophyManager" is a trademark of its respective owner. This is an
 *  unofficial, fan-made helper that only reads pages you already have
 *  access to and stores everything locally in your own browser.
 *
 *  DISTRIBUTION NOTE (Chrome Web Store / Greasy Fork):
 *   - This is authored as a Tampermonkey userscript. To ship it as a
 *     standalone Chrome extension, wrap this file as a content script
 *     in a manifest v3 package (matches: https://trophymanager.com/*).
 *   - Keep @version in sync with the store listing version.
 * ================================================================
 *
 *  TABLE OF CONTENTS  (search for the exact heading to jump there)
 *  ----------------------------------------------------------------
 *   SECTION 0  CONSTANTS / GAME KNOWLEDGE
 *   SECTION 1  CACHE LAYER
 *   SECTION 1B DEVELOPMENT HISTORY   (dated squad snapshots + trends)
 *   SECTION 2  PARSERS               (turn raw HTML -> clean data)
 *   SECTION 2B RATING ENGINE         (R5/R6 formula)
 *   SECTION 2C VALUATION & GROWTH    (star-category breakdown, exact
 *                                       Sell-to-Agent/Max Sell Price,
 *                                       training-growth SI projector)
 *   SECTION 3  NETWORK REFRESH       (fetch other pages, no nav)
 *   SECTION 4  LIVE-PAGE AUTO CAPTURE (+ Rou/SI/R5 columns on players
 *                                       & transfer tables; player-profile
 *                                       card with breakdown/valuation/
 *                                       growth projector; match-page R5
 *                                       overlay + full match stats &
 *                                       goal/card/injury timeline)
 *   SECTION 5  TACTICS ENGINE        (formation + settings picker;
 *                                       position-aware substitution orders)
 *   SECTION 5B YOUTH FINDER          (transfer-list-only talent shortlist)
 *   SECTION 5C SENIOR TARGETS        (transfer-list-only, position-need)
 *   SECTION 5D SPENDING GUIDANCE     (cash/wage-aware transfer budget)
 *   SECTION 6  STADIUM ENGINE        (upgrade ROI ranking)
 *   SECTION 7  UI                    (styles, panel; ONE context-relevant
 *                                       tab per page, no League tab)
 *   SECTION 8  BOOT
 *  If something looks off, tell me the section number/name and I'll
 *  only need to touch that block.
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
  const POS_BUCKETS = ['GK', 'D', 'DM', 'M', 'OM', 'F'];

  const CACHE_KEY_PREFIX = 'tmAdvisor_';
  const now = () => Date.now();
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
  function saveCache(c) { localStorage.setItem(cacheKey(), JSON.stringify(c)); }
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
  const HISTORY_MAX_DAYS = 60;
  const dayKey = (ts) => new Date(ts || now()).toISOString().slice(0, 10);

  function recordSquadSnapshot(players) {
    if (!players || !players.length) return;
    const c = loadCache();
    const hist = c.history && c.history.data ? c.history.data : {};
    // Compact per-player row: only what the trend view needs.
    hist[dayKey()] = players.map(p => {
      ensureR5(p);
      return {
        id: p.id, name: p.name,
        asi: p.asi != null ? Number(p.asi) : null,
        routine: p.routine != null ? Number(p.routine) : null,
        r5: (p._r5 != null && !isNaN(p._r5)) ? Number(Number(p._r5).toFixed(1)) : null,
      };
    });
    // Prune to the most recent HISTORY_MAX_DAYS days.
    const days = Object.keys(hist).sort();
    while (days.length > HISTORY_MAX_DAYS) delete hist[days.shift()];
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
      asi: p.asi, rec: parseFloat(p.rec) || 0, rat: parseFloat(p.rat) || 0,
      routine: p.routine !== undefined ? parseFloat(p.routine) : null, // needed for accurate R5
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
      const m = seg.match(/^([A-Z/]+?)\s*([LCR])?$/);
      const posPart = (m ? m[1] : seg).replace(/\s+/g, '');
      const side = m && m[2] ? m[2] : '';
      posPart.split('/').filter(Boolean).forEach(part => {
        codes.push(part === 'F' ? 'f' : (part + side).toLowerCase());
      });
    });
    return codes.length ? codes : ['mc'];
  }

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
   *  SECTION 2C — CATEGORY BREAKDOWN, VALUATION & GROWTH PROJECTION
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

  // Training-growth projection ("Trader's Calculator" in the community's "RX6 Full" script):
  // given a player's current SI and a training plan (N weeks at a weekly Training Intensity),
  // project their SI after that training. Self-consistent with our own R5 remainder formula —
  // it's the same weight*SI <-> total-skill-points relationship inverted and re-applied, not a
  // separate guess. Positive TI grows SI; the game applies this every week regardless of age.
  function projectFutureASI(asi, weeks, weeklyTI, isGK) {
    if (!asi || !weeks) return asi;
    const weight = isGK ? 48717927500 : 263533760000;
    const totalSkillPoints = Math.pow(weight * asi, 1 / 7);
    const projected = totalSkillPoints + (weeks * weeklyTI / 10);
    return Math.max(0, Math.pow(projected, 7) / weight);
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
      id: raw.id, name: raw.name || raw.surname || 'Unknown', fp: raw.fp,
      // age isn't always present in this endpoint; capture it when it is so the Youth
      // Finder can age-filter players from ANY club we scan, not just our own squad.
      // Unlike players_ar, this endpoint gives whole years in `age` and a SEPARATE `month`
      // field (confirmed by the community's "Squad R5 Value by Brzk" script, which reads
      // this exact endpoint as `age*12 + month` for its Bank Price calc) — add the month
      // fraction back in so age-based decisions (youth/senior cutoffs, valuation) are precise
      // rather than rounded down to the nearest whole year.
      age: (raw.age !== undefined && raw.age !== null && raw.age !== '') ? parseFloat(raw.age) + (parseInt(raw.month, 10) || 0) / 12 : null,
      asi: raw.asi, routine: raw.rutine !== undefined ? parseFloat(raw.rutine) : 0,
      rec: parseFloat(raw.rec) || 0,
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

  // ---- Opponent match-history scouting (formation, likely XI, tactic tendencies) ----
  // Reads an opponent's recent matches to see
  // what they actually play, not just who's in their squad. Two data sources make this
  // far simpler than the original script's approach:
  //   1. /fixtures/club/{id}/  (HTML) — lists recent match links + results.
  //   2. /ajax/match.ajax.php?id={matchId}  (JSON) — full match_data incl. lineup +
  //      mentality/attacking_style/focus_side per side. No HTML scraping needed here at all.
  async function fetchOpponentRecentMatchIds(oppClubId, n) {
    const doc = await fetchDoc('/fixtures/club/' + oppClubId + '/');
    const seen = new Set();
    const completed = [];
    doc.querySelectorAll('a[href*="/matches/"]').forEach(a => {
      const m = (a.getAttribute('href') || '').match(/\/matches\/(\d+)/);
      if (!m) return;
      const id = m[1];
      if (seen.has(id)) return;
      const row = a.closest('tr') || a.closest('li') || a.parentElement;
      const rowText = row ? row.textContent : '';
      if (/\d+\s*-\s*\d+/.test(rowText)) { seen.add(id); completed.push(id); } // has a score => played
    });
    return completed.slice(-n); // document order ≈ chronological; take the most recent n
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

  async function buildOpponentScoutingReport(oppClubId, oppSquad) {
    const matchIds = await fetchOpponentRecentMatchIds(oppClubId, 5);
    const mentalities = [], styles = [], focuses = [];
    const appearances = {}; // playerId -> times featured
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
    };
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
      return { id: pid, name: p ? p.name : (raw ? (raw.nameLast || raw.name || 'Player ' + pid) : 'Player ' + pid), fp };
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
      const col = up ? '#5fc98a' : '#e2726b';
      const arrow = up ? '▲' : '▼';
      return ` <span style="color:${col};font-size:9px;font-weight:600;">${arrow}${Math.abs(delta)}</span>`;
    };
    // Key by String(id) on both sides so a numeric players_ar id and a string DOM
    // attribute id still match (this mismatch was one reason own-squad rows showed "-").
    const byId = {};
    playersData.forEach(p => { byId[String(p.id)] = p; ensureR5(p); });

    const addHeaderCells = (headerRow) => {
      if (headerRow.querySelector('.tma-col-r5')) return; // already done
      const mk = (label, cls) => { const th = document.createElement('th'); th.textContent = label; th.className = cls; th.align = 'center'; headerRow.appendChild(th); };
      if (showRou) mk('Rou', 'tma-col-rou');
      if (showSI) mk('SI', 'tma-col-si');
      mk('R5', 'tma-col-r5');
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
        ensureScrollableTable(table);
      }

      const p = byId[String(link.id)];
      const trend = (showTrend && p) ? playerTrend(p.id) : null;
      const mkCell = (text, gold, chipHtml) => {
        const td = document.createElement('td');
        td.align = 'center';
        if (gold) { td.style.color = '#7fb2e0'; td.style.fontWeight = 'bold'; }
        // chipHtml is trusted (built internally); text is escaped by using textContent first.
        td.textContent = text;
        if (chipHtml) td.insertAdjacentHTML('beforeend', chipHtml);
        tr.appendChild(td);
      };
      if (showRou) mkCell((p && p.routine != null) ? Number(p.routine).toFixed(1) : '-', false, trend ? trendChip(trend.routine) : '');
      if (showSI) mkCell((p && p.asi != null) ? Number(p.asi).toLocaleString() : '-', false, trend ? trendChip(trend.asi) : '');
      mkCell((p && p._r5 != null && !isNaN(p._r5)) ? Number(p._r5).toFixed(1) : '-', true, trend ? trendChip(trend.r5) : '');
      tr.dataset.tmaCols = '1';
      decorated++;
    });
    return decorated;
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
      id: raw.id, name: raw.name || 'Unknown', fp: raw.favposition || '',
      age: raw.age != null && raw.age !== '' ? parseFloat(raw.age) + months / 12 : null,
      ageMonths: raw.age != null && raw.age !== '' ? Math.round(parseFloat(raw.age) * 12 + months) : null,
      asi: parseNumericString(raw.skill_index), routine: parseNumericString(raw.routine) || 0,
      rec: parseNumericString(raw.rec_sort) || 0,
      wage: parseNumericString(raw.wage), // confirmed present on tooltip.ajax.php by "TM Player Enhanced"
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
      box.style.cssText = 'margin:8px 0;padding:12px 14px;background:#20242988;border:1px solid #2c313780;border-radius:10px;color:#e4e7ea;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:12.5px;';
      const stat = (label, val) => `<div><div style="font-size:10px;color:#8a939c;text-transform:uppercase;letter-spacing:.04em;">${label}</div><div style="font-size:15px;font-weight:700;color:#7fb2e0;">${val}</div></div>`;
      const r5Stat = r5ByPosition.length > 1
        ? stat('R5', r5ByPosition.map(x => `${x.label} ${x.r5 != null ? x.r5.toFixed(1) : '-'}`).join(' / '))
        : stat('R5', r5ByPosition[0] && r5ByPosition[0].r5 != null ? r5ByPosition[0].r5.toFixed(1) : '-');
      const statRow = stat('Routine', p.routine != null ? Number(p.routine).toFixed(1) : '-')
        + stat('SI', p.asi != null ? Number(p.asi).toLocaleString() : '-')
        + r5Stat
        + (staPrice ? stat('Sell-to-Agent', Number(staPrice).toLocaleString()) : '')
        + (maxPrice ? stat('Max Sell Price', Number(maxPrice).toLocaleString()) : '')
        + '<div style="margin-left:auto;font-size:10px;color:#8a939c;align-self:center;">TM Advisor</div>';

      // Category breakdown — same 5-6 star categories the game's own player page shows
      // (Physique/Tactical/Technical + role-specific extras), see Section 2C. Shows the
      // numeric rating alongside the stars, not stars alone.
      const catChip = (label, val) => {
        const v = Math.max(0, Math.min(5, val || 0));
        const full = Math.floor(v), half = v - full >= 0.5;
        const stars = '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(Math.max(0, 5 - full - (half ? 1 : 0)));
        return `<div style="min-width:100px;"><div style="font-size:10px;color:#8a939c;">${label}</div><div style="font-size:12px;color:#e0be6b;"><span style="letter-spacing:1px;">${stars}</span> <span style="color:#e4e7ea;">${v.toFixed(2)}</span></div></div>`;
      };
      const catRow = Object.entries(cats).map(([k, v]) => catChip(k, v)).join('');

      box.innerHTML = `
        <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:center;">${statRow}</div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid #2c313780;">${catRow}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:10px;padding-top:10px;border-top:1px solid #2c313780;">
          <div style="font-size:10px;color:#8a939c;text-transform:uppercase;letter-spacing:.04em;margin-right:4px;">Growth projection</div>
          <label style="font-size:10px;color:#8a939c;">Weeks<br><input id="tma-proj-weeks" type="number" min="1" value="12" style="width:52px;background:#181b1f;border:1px solid #2c313780;color:#e4e7ea;border-radius:5px;padding:3px 5px;"></label>
          <label style="font-size:10px;color:#8a939c;">Weekly TI<br><input id="tma-proj-ti" type="number" value="0" style="width:64px;background:#181b1f;border:1px solid #2c313780;color:#e4e7ea;border-radius:5px;padding:3px 5px;"></label>
          <button id="tma-proj-go" style="background:#2c7a30;color:#fff4d6;border:1px solid #7fb2e040;border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;font-weight:700;">Project</button>
          <span id="tma-proj-result" style="font-size:11.5px;color:#7fb2e0;"></span>
        </div>
        <div style="font-size:10px;color:#8a939c;margin-top:6px;">Training Intensity (TI) is read off this player's own weekly training report — enter what your training ground/coaches currently produce for them. Projection uses the same weight*SI ↔ skill-points relationship as the R5 engine, inverted (Section 2C) — not a separate guess.</div>
      `;
      const anchor = document.querySelector('.column1_a .std') || document.querySelector('.box_body') || document.querySelector('.main_center');
      if (anchor) anchor.insertBefore(box, anchor.firstChild);

      const goBtn = box.querySelector('#tma-proj-go');
      if (goBtn) goBtn.addEventListener('click', () => {
        const weeks = Number(box.querySelector('#tma-proj-weeks').value) || 0;
        const ti = Number(box.querySelector('#tma-proj-ti').value) || 0;
        const result = box.querySelector('#tma-proj-result');
        if (!weeks || p.asi == null) { result.textContent = 'Need weeks and a known SI.'; return; }
        const newAsi = projectFutureASI(Number(p.asi), weeks, ti, isGK);
        const projSt = calcSellToAgentPrice(newAsi, (ageMonths || 0) + weeks, isGK);
        result.innerHTML = `SI → <b>${Math.round(newAsi).toLocaleString()}</b>${projSt ? ' · Sell-to-Agent → <b>' + Number(projSt).toLocaleString() + '</b>' : ''}`;
      });
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
        if (id && id === clubId) { /* own squad overview page - not the players editor, skip */ }
        else {
          const scraped = parseSquadPage(document);
          const oppName = scraped.name || null;
          fetchOpponentSquadReal(id).then(players => {
            if (players.length) {
              setSlice('opponent', { id, name: oppName, players, source: 'real-skills' });
              injectColumnsWhenReady(players, { showRou: true, showSI: true });
            } else {
              const fallback = scraped.players.map(p => ({ ...p, _r5: p.recStars != null ? p.recStars * 22 : null }));
              setSlice('opponent', { id, name: oppName, players: fallback, source: 'star-estimate' });
              injectColumnsWhenReady(fallback, { showRou: true, showSI: true });
            }
          }).catch(() => {
            const fallback = scraped.players.map(p => ({ ...p, _r5: p.recStars != null ? p.recStars * 22 : null }));
            setSlice('opponent', { id, name: oppName, players: fallback, source: 'star-estimate' });
            injectColumnsWhenReady(fallback, { showRou: true, showSI: true });
          });
        }
      } else if (path.startsWith('/club/') && path.split('/').filter(Boolean).length === 2) {
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
      else if (path.startsWith('/matches/')) {
        const d = parseMatchPage(document);
        const c = loadCache();
        c.lastMatchPage = { t: now(), data: d, url: path };
        saveCache(c);
        // Populate opponent expected data from test_lineup if available
        if (d && d.lineup) {
          const myId = clubId;
          const isHome = d.lineup.home && Object.keys(d.lineup.home).some(pid => {
            const p = d.lineup.home[pid];
            return p && String(p.club_id || '') === String(myId);
          });
          const oppSide = isHome ? 'away' : 'home';
          const oppLineup = d.lineup[oppSide];
          if (oppLineup) {
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
            setSlice('nextOpponentExpected', { formation, xi, side: oppSide, matchUrl: path, capturedAt: now() });
          }
        }
        hookMatchAjax(); // catch match_data once it loads via XHR
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
        tag.style.cssText = 'display:inline-block;margin-left:4px;padding:0 4px;border-radius:3px;background:#1b4d1e;color:#7fb2e0;font-weight:700;font-size:10px;';
        el.appendChild(tag);
      });

      // A compact summary card, injected once near the top of the match page.
      if ((homeSum || awaySum) && !document.getElementById('tma-match-summary')) {
        const box = document.createElement('div');
        box.id = 'tma-match-summary';
        box.style.cssText = 'margin:8px auto;max-width:640px;background:#0f1f11;border:1px solid #2f7d3266;border-radius:10px;padding:10px 14px;color:#e4e7ea;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;';
        const col = (s) => s ? `avg R5 <b style="color:#7fb2e0">${s.r5.toFixed(1)}</b> · SI ${Math.round(s.asi).toLocaleString()} · Rou ${s.routine.toFixed(1)}` : 'n/a';
        box.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:12px;">
          <div><b>${match.club.home.club_name || 'Home'}</b><br>${col(homeSum)}</div>
          <div style="text-align:right;"><b>${match.club.away.club_name || 'Away'}</b><br>${col(awaySum)}</div>
        </div><div style="font-size:10px;color:#8a939c;margin-top:4px;">TM Advisor · accurate R5 from each club's real skills</div>`;
        const anchor = document.querySelector('.main_center') || document.body;
        anchor.insertBefore(box, anchor.firstChild);
      }
    } catch (e) { console.warn('TM Advisor: match-page ratings overlay failed', e); _matchRatingsDone = false; }
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

  // A 4-4-2-ish flexible formation slot template based on typical TM formations.
  // We pick the formation that best fits the available R5-strength distribution.
  // Rows top-to-bottom: GK, Defence, Midfield, Attack — used both for slot-matching and
  // for rendering an actual pitch-shaped layout instead of a flat grid.
  const FORMATION_ROWS = {
    '4-4-2': [['GK'], ['D-L', 'D-C', 'D-C', 'D-R'], ['M-L', 'M-C', 'M-C', 'M-R'], ['F', 'F']],
    '4-5-1': [['GK'], ['D-L', 'D-C', 'D-C', 'D-R'], ['M-L', 'M-C', 'M-C', 'M-R', 'OM-C'], ['F']],
    '3-5-2': [['GK'], ['D-C', 'D-C', 'D-C'], ['M-L', 'DM-C', 'M-C', 'M-C', 'M-R'], ['F', 'F']],
    '4-3-3': [['GK'], ['D-L', 'D-C', 'D-C', 'D-R'], ['DM-C', 'M-C', 'M-C'], ['OM-L', 'F', 'OM-R']],
  };
  const FORMATIONS = Object.fromEntries(Object.entries(FORMATION_ROWS).map(([k, rows]) => [k, rows.flat()]));

  // ---- Position-penalty system ----
  // Real off-position penalties matter: a central midfielder shoved out to M-R shouldn't
  // just silently count at full strength (or worse, be excluded from side-strength maths
  // entirely, which was the root cause of the earlier "Right R5 0.0" bug). We apply a
  // multiplicative penalty based on how far the player's own bucket/side (from bucketFor/
  // sideFor, Section 5) sits from the slot being filled, using the same GK→D→DM→M→OM→F
  // ordering already used for the pitch rows.
  const BUCKET_ORDER = ['D', 'DM', 'M', 'OM', 'F'];
  function positionPenaltyMultiplier(playerBucket, playerSide, slotBucket, slotSide) {
    if (slotBucket === 'GK' || playerBucket === 'GK') return playerBucket === slotBucket ? 1.0 : 0.1;
    const pIdx = BUCKET_ORDER.indexOf(playerBucket), sIdx = BUCKET_ORDER.indexOf(slotBucket);
    const dist = (pIdx >= 0 && sIdx >= 0) ? Math.abs(pIdx - sIdx) : 3;
    const base = dist === 0 ? 1.0 : dist === 1 ? 0.85 : dist === 2 ? 0.65 : 0.45;
    let sideFactor = 1.0;
    if (slotSide) {
      if (playerSide === slotSide) sideFactor = 1.0;
      else if (playerSide === 'C') sideFactor = 0.95;
      else sideFactor = 0.9; // opposite named side (e.g. trained L, played R)
    }
    return base * sideFactor;
  }

  // NOTE: opponent formation is NOT guessed from squad strength. It comes only from hard
  // data — the next-match page's expected line-up (fetchNextMatchExpected) and their actual
  // last-N line-ups (buildOpponentScoutingReport). See Section 3.

  // How strong is the opponent's attack, on average, across their forwards + attacking
  // mids? Used to scale how much a defender's Marking/Tackling should matter beyond raw
  // R5 — against a weak attack it barely matters, against a strong one it should.
  function opponentAttackThreat(opponentData) {
    if (!opponentData || !opponentData.players) return null;
    const attackers = opponentData.players.filter(p => { const b = bucketFor(p.fp); return b === 'F' || b === 'OM'; });
    const vals = attackers.map(p => p._r5).filter(v => typeof v === 'number' && !isNaN(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }

  function pickBestXI(players, formationKey, opponentData) {
    const slots = FORMATIONS[formationKey];
    const used = new Set();
    const lineup = [];
    const attackThreat = opponentAttackThreat(opponentData);
    // Greedy: for each slot, pick the unused player with the highest penalised R5 — plus,
    // for defensive slots, a matchup bonus scaled by the opponent's attacking strength so a
    // strong marker/tackler is favoured specifically against a dangerous attack, not just
    // picked on raw R5 in isolation.
    slots.forEach(slot => {
      const [slotBucket, slotSide] = slot.split('-');
      let best = null, bestScore = -Infinity, bestPenalty = 0;
      players.forEach(p => {
        if (used.has(p.id)) return;
        const pb = bucketFor(p.fp), ps = sideFor(p.fp);
        if ((slotBucket === 'GK') !== (pb === 'GK')) return; // GKs only in goal, outfielders never in goal
        const mult = positionPenaltyMultiplier(pb, ps, slotBucket, slotSide);
        let score = (p._r5 || 0) * mult;
        if (attackThreat != null && (slotBucket === 'D' || slotBucket === 'DM') && p.skills) {
          const markTac = ((Number(p.skills.mar) || 0) + (Number(p.skills.tac) || 0)) / 2;
          score += markTac * (attackThreat / 100) * 0.5; // bounded, secondary factor — R5 still dominates
        }
        if (score > bestScore) { bestScore = score; best = p; bestPenalty = (p._r5 || 0) - score; }
      });
      if (best) {
        used.add(best.id);
        lineup.push({ slot, player: best, effectiveR5: bestScore, penalty: bestPenalty });
      } else {
        lineup.push({ slot, player: null, effectiveR5: 0, penalty: 0 });
      }
    });
    const subs = players.filter(p => !used.has(p.id)).sort((a, b) => b._r5 - a._r5).slice(0, 7);
    const totalRec = lineup.reduce((s, l) => s + (l.effectiveR5 || 0), 0);
    return { lineup, subs, totalRec, formation: formationKey };
  }

  // Community consensus (per user's own match-history observation) is that 352 variants
  // are currently over-performing relative to what the match engine's public numbers would
  // suggest. We apply a small, clearly-labelled nudge rather than silently overriding pure
  // R5 math — remove FORMATION_BIAS['3-5-2'] below if the meta shifts back.
  const FORMATION_BIAS = { '3-5-2': 1.04 };

  function bestFormation(players, opponentData) {
    players.forEach(ensureR5); // idempotent: won't overwrite star-estimate R5s
    let best = null;
    Object.keys(FORMATIONS).forEach(key => {
      const res = pickBestXI(players, key, opponentData);
      const biased = res.totalRec * (FORMATION_BIAS[key] || 1);
      if (!best || biased > best._biasedRec) { res._biasedRec = biased; best = res; }
    });
    best.rows = FORMATION_ROWS[best.formation];
    return best;
  }

  // A specific, sensible bench shape rather than "next 7 best regardless of role":
  // one GK, one defender, one midfielder, one winger, one striker — using the same
  // bucketFor/sideFor classification as the rest of the script. The DEF pick also leans
  // toward Marking/Tackling when the opponent's attack is strong, same logic as the XI.
  function pickBench(remainingPlayers, opponentData) {
    const used = new Set();
    const attackThreat = opponentAttackThreat(opponentData);
    const take = (predicate, matchupAware) => {
      const candidates = remainingPlayers.filter(p => !used.has(p.id) && predicate(p));
      candidates.sort((a, b) => {
        let sa = a._r5 || 0, sb = b._r5 || 0;
        if (matchupAware && attackThreat != null) {
          sa += (((Number(a.skills?.mar) || 0) + (Number(a.skills?.tac) || 0)) / 2) * (attackThreat / 100) * 0.5;
          sb += (((Number(b.skills?.mar) || 0) + (Number(b.skills?.tac) || 0)) / 2) * (attackThreat / 100) * 0.5;
        }
        return sb - sa;
      });
      if (candidates[0]) { used.add(candidates[0].id); return candidates[0]; }
      return null;
    };
    const gk = take(p => bucketFor(p.fp) === 'GK');
    const wing = take(p => sideFor(p.fp) !== 'C' && bucketFor(p.fp) !== 'GK' && bucketFor(p.fp) !== 'F');
    const def = take(p => (bucketFor(p.fp) === 'D' || bucketFor(p.fp) === 'DM'), true);
    const mid = take(p => (bucketFor(p.fp) === 'M' || bucketFor(p.fp) === 'OM') && sideFor(p.fp) === 'C');
    const fc = take(p => bucketFor(p.fp) === 'F');
    const named = [
      { role: 'GK', player: gk }, { role: 'DEF', player: def }, { role: 'MID', player: mid },
      { role: 'WING', player: wing }, { role: 'FC', player: fc },
    ];
    const extras = remainingPlayers.filter(p => !used.has(p.id)).sort((a, b) => b._r5 - a._r5).slice(0, 2);
    return { named, extras };
  }

  // Set-piece taker scoring — same skill combinations the R5 formula itself uses for the
  // free-kick/corner/penalty bonus terms (Section 2B), so the "best taker" ranking is
  // consistent with what actually earns bonus rating in-game, not a separate guess.
  // Rebalanced from an earlier equal-weight version: giving "Set" the same weight as the
  // specialised skill let one high-Set all-rounder sweep captain/FK/CK/PK together, which
  // doesn't reflect real specialisation (a good penalty taker isn't automatically your best
  // free-kick taker). Finishing/Longshots/Crossing now carry the majority weight for their
  // respective role, with Set and Technique as secondary contributors.
  function setPieceScore(p, type) {
    const s = p.skills || {};
    const set = Number(s.set) || 0, tec = Number(s.tec) || 0;
    if (type === 'fk') return (Number(s.lon) || 0) * 1.2 + tec * 0.5 + set * 0.4;
    if (type === 'ck') return (Number(s.cro) || 0) * 1.2 + tec * 0.4 + set * 0.4;
    if (type === 'pk') return (Number(s.fin) || 0) * 1.4 + tec * 0.4 + set * 0.3;
    return 0;
  }

  function pickSquadRoles(startingPlayers) {
    const rank = type => [...startingPlayers].sort((a, b) => setPieceScore(b, type) - setPieceScore(a, type))[0];
    // TrophyManager doesn't expose a "leadership" skill via any scraped source we have —
    // ASI (ability/experience index) is the best available proxy for on-pitch authority.
    const captain = [...startingPlayers].sort((a, b) => (Number(b.asi) || 0) - (Number(a.asi) || 0))[0];
    return { captain, freeKick: rank('fk'), corner: rank('ck'), penalty: rank('pk') };
  }

  function recommendTacticSettings(myXI, opponent, scouting, expected) {
    // Compare our starting XI's average R5 against the opponent's likely-best-XI average R5.
    // Both sides are now on the same R5 scale (real skills when available via the AJAX
    // endpoint, or a rough star*22 estimate as fallback) — see fetchOpponentSquadReal().
    const myAvg = myXI.totalRec / myXI.lineup.filter(l => l.player).length;
    let oppAvg = null, oppSource = null;
    if (opponent && opponent.players && opponent.players.length) {
      const vals = opponent.players.map(p => p._r5).filter(v => typeof v === 'number' && !isNaN(v)).sort((a, b) => b - a);
      const bestXICount = Math.min(11, vals.length);
      if (bestXICount) { oppAvg = vals.slice(0, bestXICount).reduce((a, b) => a + b, 0) / bestXICount; oppSource = opponent.source; }
    }
    let mentality = 4; // Normal
    let reasoning = [];
    if (myXI.formation === '3-5-2') {
      reasoning.push('Formation nudged toward 3-5-2: recent results suggest it is currently over-performing versus what raw R5 math alone would predict — worth re-checking this bias periodically.');
    }
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
      reasoning.push('No opponent squad data cached yet — defaulting to Normal. Visit the opponent squad page or hit "Update All" once your next match is known.');
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
    let style = 1; // Balanced
    const scores = {
      2: pac + lon * 0.5,               // Direct — pace & long shots/passes forward fast
      3: cro,                           // Wings — crossing ability
      4: pas + tec,                     // Shortpassing — passing & technique
      5: lon,                           // Long balls
      6: tec + pas * 0.5,               // Through balls — technique/vision
    };
    let bestStyle = 1, bestScore = -1;
    Object.entries(scores).forEach(([k, v]) => { if (v > bestScore) { bestScore = v; bestStyle = Number(k); } });
    style = bestStyle;
    reasoning.push('Attacking style "' + ATT_STYLE[style] + '" chosen from squad\'s strongest attribute profile (Cro ' + cro.toFixed(1) + ', Pas ' + pas.toFixed(1) + ', Tec ' + tec.toFixed(1) + ', Lon ' + lon.toFixed(1) + ', Pac ' + pac.toFixed(1) + ').');

    // Focus side: which flank to attack down. This is NOT just "which of our sides is
    // stronger" — attacking down our left means attacking INTO their right-back/right-DM
    // area, so what matters is our side strength minus THEIR defensive strength on the
    // side we'd be attacking into. A strong side of ours facing an even stronger opposing
    // flank is not automatically the right side to focus.
    const leftPlayers = myXI.lineup.filter(l => l.player && l.slot.split('-')[1] === 'L');
    const rightPlayers = myXI.lineup.filter(l => l.player && l.slot.split('-')[1] === 'R');
    const leftAvg = leftPlayers.length ? leftPlayers.reduce((s, l) => s + l.effectiveR5, 0) / leftPlayers.length : null;
    const rightAvg = rightPlayers.length ? rightPlayers.reduce((s, l) => s + l.effectiveR5, 0) / rightPlayers.length : null;

    const oppDefSideAvg = (side) => {
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
      const netLeft = (leftAvg ?? 0) - (oppRightDef ?? leftAvg ?? 0);   // our left attack vs their right defence
      const netRight = (rightAvg ?? 0) - (oppLeftDef ?? rightAvg ?? 0); // our right attack vs their left defence
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

    return { mentality, style, focus, reasoning };
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
    const color = trendUp ? '#5fc98a' : '#e2726b';
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
    maxAge: 18,
    minRoutine: 2,
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

  function scoutScore(p, opts) {
    opts = opts || {};
    const r5 = effectiveR5(p);
    const age = p.age != null ? Number(p.age) : 25;
    const routine = Number(p.routine) || 0;
    const asi = Number(p.asi) || 0;
    let score = r5 + Math.log10(1 + asi) * 2 + Math.min(routine, 20) * 0.1;
    if (opts.youth) score += Math.max(0, 18 - age) * 1.5;
    const cost = p._cost != null ? p._cost : (p._price || estimateBankPrice(p) || 0);
    if (cost > 0) score -= Math.log10(1 + cost / 1e6) * (opts.youth ? 1 : 2);
    const wage = Number(p.wage) || 0;
    if (!opts.youth && wage > 0) score -= Math.log10(1 + wage / 1e4) * 0.5; // ongoing cost, senior signings only
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
      ensureR5(p);
      seen[key] = { ...p, _src: srcLabel };
    };
    const transferSeen = getSlice('transferSeen');
    if (transferSeen && transferSeen.data) Object.values(transferSeen.data).forEach(p => add(p, 'Transfer list'));
    return Object.values(seen);
  }

  // Ranking and filtering both shortlists needs full skills (for R5) and wage (for the cost
  // side of scoutScore) — but browsing the transfer list only ever gives you SI (Breakdown) OR
  // skills (Skills view) per visit, never both, and never wage at all. Rather than requiring
  // you to manually flip through both views and open every player's profile for wage, this
  // fetches everything at once via /ajax/tooltip.ajax.php (Section 4) — the same endpoint the
  // player-profile card uses — for whichever pool players are still missing data, and merges
  // the result straight into the transferSeen store so it's available for THIS build and every
  // one after. Capped per run so a large pool doesn't fire off hundreds of requests at once.
  const FULL_STATS_FETCH_CAP = 60;
  async function fetchFullStatsForPool(onProgress) {
    const c = loadCache();
    const store = (c.transferSeen && c.transferSeen.data) || {};
    const ids = Object.keys(store);
    const incomplete = ids.filter(id => {
      const p = store[id];
      const r5 = transferR5(p);
      return isNaN(r5) || p.wage == null;
    }).slice(0, FULL_STATS_FETCH_CAP);
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
            wage: norm.wage != null ? norm.wage : prev.wage,
            skills: { ...(prev.skills || {}), ...norm.skills },
          };
        }
      } catch (e) { console.warn('TM Advisor: full-stats fetch failed for player', id, e); }
    }
    const cc = loadCache();
    cc.transferSeen = { t: now(), data: store };
    saveCache(cc);
    const stillIncomplete = ids.filter(id => { const p = store[id]; return isNaN(transferR5(p)) || p.wage == null; }).length;
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
      if (!prefs.includeForeign) {
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
    const scored = filtered.map(p => ({ ...p, _score: scoutScore(p, { youth: true }) }));
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
    const ranked = rankYouth(filterYouth(pool, YOUTH_CRITERIA), scoutById, YOUTH_CRITERIA, prefs || loadShortlistPrefs('youth'));
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
   *  NOTE ON THE "5 FOREIGN PLAYERS" RULE: we searched the official TM user
   *  guide (all 10 PDF chapters) and every community userscript in TM Guide/
   *  for a hard non-national squad/matchday cap and found NONE — no
   *  wiki page or working script enforces or even mentions one. Nationality
   *  below is therefore shown as an informational badge only (home nation vs.
   *  foreign), never used to filter or exclude a target. Verify any roster
   *  rule directly in-game (Club > Squad rules) before treating it as fact.
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
  };

  // Weakest starting R5 per position bucket (GK/D/DM/M/OM/F) in your OWN best XI right now —
  // the bar a transfer target has to clear. Reuses the exact same formation/penalty engine
  // Tactics uses (Section 5), so "better than my team" means the same thing everywhere in
  // this script, not a separately-invented threshold.
  function ownWeakestByBucket() {
    const playersSlice = getSlice('players');
    if (!playersSlice || !playersSlice.data || !playersSlice.data.length) return null;
    const players = playersSlice.data.map(p => ({ ...p }));
    players.forEach(ensureR5);
    const best = bestFormation(players, null);
    const map = {};
    best.lineup.forEach(l => {
      if (!l.player) return;
      const b = l.slot.split('-')[0];
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
    const best = bestFormation(players, null);
    const map = {};
    best.lineup.forEach(l => {
      if (!l.player || l.player.asi == null) return;
      const b = l.slot.split('-')[0];
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
    const scored = filtered.map(p => ({ ...p, _score: scoutScore(p, { youth: false }) }));
    scored.sort((a, b) => b._score - a._score);
    return tierAndFilter(scored);
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
    const ranked = rankSenior(filterSenior(pool, weakestMap, weakestSIMap, criteria), p);
    saveSeniorShortlist(ranked);
    return { ranked, poolSize: pool.length, weakestMap, maxAge: criteria.maxAge };
  }

  /* ------------------------------------------------------------
   *  SECTION 5D — SPENDING GUIDANCE
   *  ------------------------------------------------------------
   *  A simple, clearly-labelled heuristic (not a game rule): keep roughly
   *  12 weeks of wage bill in reserve, then treat half of whatever cash is
   *  left over as this window's transfer budget. Tune the two constants
   *  below if that reserve doesn't match your risk tolerance.
   * ============================================================ */
  const BUDGET_WAGE_WEEKS_RESERVE = 12;
  const BUDGET_SPEND_FRACTION = 0.5;

  function budgetGuidance() {
    const homeSlice = getSlice('home');
    const finSlice = getSlice('finances');
    const cash = (homeSlice && homeSlice.data && homeSlice.data.cash != null) ? homeSlice.data.cash
      : (finSlice && finSlice.data && finSlice.data.balance != null ? finSlice.data.balance : null);
    if (cash == null) return null;
    let weeklyWage = null;
    if (finSlice && finSlice.data && finSlice.data.weekly) {
      const row = Object.entries(finSlice.data.weekly).find(([k]) => /wage/i.test(k));
      if (row && row[1] && row[1].length) weeklyWage = parseMoney(row[1][row[1].length - 1]);
    }
    const buffer = weeklyWage != null ? weeklyWage * BUDGET_WAGE_WEEKS_RESERVE : 0;
    const spendable = Math.max(0, cash - buffer);
    const recommendedMax = Math.round(spendable * BUDGET_SPEND_FRACTION);
    return { cash, weeklyWage, buffer, spendable, recommendedMax };
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

  /* ============================================================
   *  SECTION 7 — UI
   * ============================================================ */

  const STYLE = `
  /* ---- Design tokens (change the theme in ONE place) ---- */
  #tma-panel {
    --tma-bg:#181b1f; --tma-bg-2:#1e2227; --tma-card:#20242980; --tma-line:#2c313780;
    --tma-gold:#7fb2e0; --tma-lime:#5fc98a; --tma-text:#e4e7ea; --tma-mute:#8a939c;
    --tma-red:#e2726b; --tma-amber:#d1a355;
  }
  /* ---- Panel shell: the ONLY floating element — always present, docked bottom-right.
     Collapsed by default down to just its header; expands in place, nothing else to summon. ---- */
  #tma-panel { position:fixed; right:22px; bottom:22px; z-index:999999; width:412px; max-height:78vh; overflow:hidden;
    background:var(--tma-bg); color:var(--tma-text); border-radius:14px;
    border:1px solid #2c313780; box-shadow:0 16px 40px rgba(0,0,0,.45);
    font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif; display:flex; flex-direction:column;
    transition:max-height .22s ease; }
  #tma-panel.tma-collapsed { max-height:60px; }
  #tma-panel.tma-collapsed .tma-tabs, #tma-panel.tma-collapsed .tma-body { display:none; }
  /* ---- Header (sticky, draggable, doubles as the expand/collapse target) ---- */
  .tma-head { padding:12px 14px 0; background:var(--tma-bg-2); border-bottom:1px solid #2c313780;
    cursor:move; user-select:none; position:relative; z-index:2; flex:0 0 auto; }
  .tma-head-row { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .tma-title { font-size:15px; font-weight:700; color:var(--tma-text); letter-spacing:.1px; display:flex; align-items:center; gap:6px; }
  .tma-title .tma-mini { font-weight:400; }
  .tma-head-actions { display:flex; align-items:center; gap:2px; flex-shrink:0; }
  .tma-icon-btn { cursor:pointer; width:24px; height:24px; display:flex; align-items:center; justify-content:center;
    color:var(--tma-mute); font-size:13px; border-radius:6px; transition:color .15s, background .15s; }
  .tma-icon-btn:hover { color:var(--tma-text); background:#ffffff10; }
  .tma-chevron { display:inline-block; transition:transform .2s ease; }
  #tma-panel.tma-collapsed .tma-chevron { transform:rotate(-90deg); }
  .tma-sub { font-size:11px; color:var(--tma-mute); margin-top:2px; padding-bottom:10px; display:flex; align-items:center; gap:6px; }
  .tma-ctx-dot { width:6px; height:6px; border-radius:50%; background:var(--tma-lime); box-shadow:0 0 0 0 #5fc98a66;
    animation:tma-pulse 2s infinite; display:inline-block; flex-shrink:0; }
  @keyframes tma-pulse { 0%{box-shadow:0 0 0 0 #5fc98a66;} 70%{box-shadow:0 0 0 5px #5fc98a00;} 100%{box-shadow:0 0 0 0 #5fc98a00;} }
  .tma-tabs { display:flex; gap:2px; padding:0 8px; overflow-x:auto; scrollbar-width:none; }
  .tma-tabs::-webkit-scrollbar { display:none; }
  .tma-tab { flex:1 0 auto; min-width:64px; text-align:center; padding:8px 6px; font-size:11.5px; border-radius:8px 8px 0 0; cursor:pointer;
    background:transparent; color:var(--tma-mute); font-weight:600; position:relative; transition:color .15s, background .15s; white-space:nowrap; }
  .tma-tab:hover { color:var(--tma-text); background:#ffffff08; }
  .tma-tab.active { background:var(--tma-bg); color:var(--tma-gold); font-weight:700; }
  .tma-tab.active:after { content:""; position:absolute; left:18%; right:18%; bottom:-1px; height:2px; border-radius:2px; background:var(--tma-gold); }
  /* ---- Scrollable body ---- */
  .tma-body { padding:12px 14px 16px; overflow-y:auto; flex:1 1 auto; scrollbar-width:thin; scrollbar-color:#2f7d32 transparent; }
  .tma-body::-webkit-scrollbar { width:7px; }
  .tma-body::-webkit-scrollbar-thumb { background:#2f7d3266; border-radius:4px; }
  .tma-body::-webkit-scrollbar-thumb:hover { background:#2f7d32aa; }
  /* ---- Cards ---- */
  .tma-card { background:var(--tma-card); border:1px solid var(--tma-line); border-radius:11px;
    padding:12px 13px; margin-bottom:9px; transition:border-color .15s; }
  .tma-card:hover { border-color:#2f7d3255; }
  .tma-card h4 { margin:0 0 8px; font-size:12.5px; color:var(--tma-text); display:flex; justify-content:space-between; align-items:center; gap:8px; font-weight:700; letter-spacing:.1px; }
  .tma-row { display:flex; justify-content:space-between; align-items:center; font-size:12.5px; padding:5px 0; border-bottom:1px solid #ffffff08; gap:8px; }
  .tma-row:last-child { border-bottom:none; }
  .tma-dot { width:8px; height:8px; border-radius:50%; display:inline-block; margin-right:6px; flex-shrink:0; }
  .dot-green{ background:var(--tma-lime); } .dot-amber{ background:var(--tma-amber); } .dot-red{ background:var(--tma-red); } .dot-grey{ background:#4a5a4c; }
  /* ---- Buttons ---- */
  .tma-btn { background:#2c7a30; color:#fff4d6; border:1px solid #7fb2e040; border-radius:8px;
    padding:9px 12px; font-size:12.5px; cursor:pointer; font-weight:700; width:100%; margin-top:8px; letter-spacing:.1px;
    transition:filter .15s, transform .1s; }
  .tma-btn:hover { filter:brightness(1.12); }
  .tma-btn:active { transform:translateY(1px); }
  .tma-btn:disabled { opacity:.5; cursor:not-allowed; filter:none; }
  .tma-btn.secondary { background:#16281a; color:var(--tma-mute); font-weight:600; }
  .tma-btn.secondary:hover { color:var(--tma-text); background:#1c3320; }
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
  .tma-reason { font-size:11.4px; color:#c3e0c3; margin:5px 0; padding-left:14px; position:relative; line-height:1.45; }
  .tma-reason:before { content:"–"; position:absolute; left:0; color:var(--tma-mute); }
  .tma-badge { font-size:9.5px; padding:2px 7px; border-radius:20px; background:#1c3a20; color:#a9d6a9; white-space:nowrap; font-weight:600; }
  .tma-progress { font-size:11px; color:var(--tma-mute); margin-top:6px; }
  .tma-mini { font-size:10.6px; color:var(--tma-mute); line-height:1.45; }
  .tma-goodval { color:var(--tma-lime); font-weight:700; }
  /* ---- Empty-state helper ---- */
  .tma-empty-state { text-align:center; padding:24px 14px; color:var(--tma-mute); }
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

  const COLLAPSE_KEY = 'tmAdvisor_panelCollapsed';

  // The panel IS the advisor — no separate floating button. It sits docked bottom-right,
  // starts collapsed to just its header bar, and expands in place when you click the header
  // or the chevron. Nothing else to summon, nothing else floating on the page.
  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'tma-panel';
    panel.innerHTML = `
      <div class="tma-head" id="tma-drag-handle">
        <div class="tma-head-row">
          <div class="tma-title">TM Advisor</div>
          <div class="tma-head-actions">
            <span class="tma-icon-btn" id="tma-collapse-toggle" title="Collapse / expand"><span class="tma-chevron">▾</span></span>
          </div>
        </div>
        <div class="tma-sub">Cached club intelligence · club ${clubId}</div>
        <div class="tma-tabs" id="tma-tabs"></div>
      </div>
      <div class="tma-body" id="tma-body"></div>
    `;
    document.body.appendChild(panel);
    makeElementDraggable(panel, document.getElementById('tma-drag-handle'), 'tmAdvisor_panelPos');

    // Collapsed by default on first load so the panel never covers game content unasked;
    // remembers whatever state you leave it in.
    const savedCollapsed = localStorage.getItem(COLLAPSE_KEY);
    if (savedCollapsed === null || savedCollapsed === '1') panel.classList.add('tma-collapsed');

    const setCollapsed = (collapsed) => {
      panel.classList.toggle('tma-collapsed', collapsed);
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
      if (!collapsed) openTab(document.querySelector('.tma-tab.active')?.dataset.tab || contextTabForPath());
    };
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
  }

  // Human-readable label per advisor tab, used to render the single relevant tab for
  // whatever page you're on — see contextTabForPath() below.
  const TAB_LABELS = { dash: 'Dashboard', tactics: 'Tactics', stadium: 'Stadium', scouting: 'Scouting' };

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
    if (p.startsWith('/club/') && p.includes('/squad')) return 'Opponent squad';
    if (p === '/home/' || p === '/home') return 'Home';
    return 'Club intelligence';
  }

  // Maps the current TrophyManager page to the single most useful advisor tab.
  function contextTabForPath() {
    const p = location.pathname;
    if (p.startsWith('/matches/')) return 'dash';           // last-match stats live on the dashboard
    if (p.startsWith('/stadium')) return 'stadium';
    if (p.startsWith('/finances')) return 'stadium';         // finances feed the stadium ROI view
    if (p.startsWith('/transfer') || p.startsWith('/shortlist') || p.startsWith('/scouts') || p.startsWith('/youth-development')) return 'scouting';
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
    if (tab === 'dash') renderDashboard();
    else if (tab === 'tactics') renderTactics();
    else if (tab === 'stadium') renderStadiumTab();
    else if (tab === 'scouting') renderScouting();
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
    const nmHtml = nm ? `<div class="tma-mini">${nm.home.name} vs ${nm.away.name}<br>${nm.when || ''}</div>` : `<div class="tma-mini">Visit the home page once, then hit "Update All".</div>`;

    const lastResult = c.lastMatchResult;
    const lastResultHtml = lastResult ? (() => {
      const d = lastResult.data;
      const st = d.stats;
      const statRow = (label, h, a) => (h != null || a != null) ? `<div class="tma-row"><span class="tma-goodval">${h != null ? h : '–'}</span><span class="tma-mini">${label}</span><span class="tma-goodval">${a != null ? a : '–'}</span></div>` : '';
      const statsBlock = st ? `
        <div class="tma-row" style="font-weight:700;"><span>${d.home}</span><span class="tma-mini">vs</span><span>${d.away}</span></div>
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
        ${d.timeline.map(ev => `<div class="tma-row"><span class="tma-mini">${ev.minute}'</span><span>${glyph[ev.type] || '•'} ${ev.player}${ev.score ? ' <span class="tma-goodval">(' + ev.score.home + '-' + ev.score.away + ')</span>' : ''}</span><span class="tma-mini">${ev.side || ''}</span></div>`).join('')}` : '';
      return `<div class="tma-card"><h4>Last Match Seen <span class="tma-mini">(${ago(lastResult.t)})</span></h4>
        <div class="tma-mini" style="text-align:center;font-size:14px;color:#7fb2e0;margin-bottom:4px;">${d.home} ${d.homeGoals} – ${d.awayGoals} ${d.away}</div>
        ${statsBlock}${timelineBlock}</div>`;
    })() : '';

    body.innerHTML = `
      <div class="tma-card">
        <h4>Next Match</h4>
        ${nmHtml}
      </div>
      ${lastResultHtml}
      <div class="tma-card">
        <h4>Data Freshness</h4>
        ${rows}
        <button class="tma-btn" id="tma-refresh">🔄 Update All Now</button>
        <div class="tma-progress" id="tma-progress"></div>
      </div>
    `;
    document.getElementById('tma-refresh').addEventListener('click', async () => {
      const prog = document.getElementById('tma-progress');
      await refreshAll((key, status) => {
        prog.textContent = 'Refreshing ' + key + '… ' + status;
      });
      prog.textContent = 'Done ✔';
      renderDashboard();
    });
  }

  function renderTactics() {
    const body = document.getElementById('tma-body');
    const playersSlice = getSlice('players');
    const oppSlice = getSlice('opponent');
    const scoutSlice = getSlice('opponentScouting');
    const expectedSlice = getSlice('opponentExpected');
    if (!playersSlice) {
      body.innerHTML = `<div class="tma-card"><h4>No squad data yet</h4><div class="tma-reason">Visit your Players page once (or hit Update All on the Dashboard tab).</div></div>`;
      return;
    }
    const players = playersSlice.data.filter(p => !p.ban || p.ban === '0').filter(p => !p.inj);
    const best = bestFormation(players, oppSlice && oppSlice.data);
    const settings = recommendTacticSettings(best, oppSlice && oppSlice.data, scoutSlice && scoutSlice.data, expectedSlice && expectedSlice.data);
    const startingPlayers = best.lineup.filter(l => l.player).map(l => l.player);
    const usedIds = new Set(startingPlayers.map(p => p.id));
    const remaining = players.filter(p => !usedIds.has(p.id));
    const bench = pickBench(remaining, oppSlice && oppSlice.data);
    const roles = pickSquadRoles(startingPlayers);

    // Render the pitch using six fixed canonical rows — GK, Defence, DM, Midfield, OM,
    // Forward — rather than the formation's own row grouping. This way the layout always
    // reads as a real pitch shape and rows a formation doesn't use (e.g. no DM in 4-4-2)
    // just don't appear, instead of being squashed into a neighbouring row.
    const ROW_ORDER = ['F', 'OM', 'M', 'DM', 'D', 'GK'];
    const SIDE_ORDER = { L: 0, C: 1, R: 2 };
    const rowGroups = { GK: [], D: [], DM: [], M: [], OM: [], F: [] };
    best.lineup.forEach(l => {
      const slotPos = l.slot.split('-')[0];
      const bucket = ROW_ORDER.includes(slotPos) ? slotPos : (l.player ? bucketFor(l.player.fp) : 'M');
      (rowGroups[bucket] || rowGroups.M).push(l);
    });
    Object.values(rowGroups).forEach(row => row.sort((a, b) => {
      const sa = SIDE_ORDER[a.slot.split('-')[1]] ?? 1, sb = SIDE_ORDER[b.slot.split('-')[1]] ?? 1;
      return sa - sb;
    }));
    const pitchRowsHtml = ROW_ORDER.filter(k => rowGroups[k].length).map(k => {
      const cells = rowGroups[k].map(l => {
        if (!l.player) return `<div class="tma-slot"><div class="tma-pos">${l.slot}</div><b class="tma-empty">— empty —</b></div>`;
        // Position-penalty is still factored into effectiveR5 and drives who gets picked —
        // it's just not surfaced as a separate number here, per request.
        return `<div class="tma-slot"><div class="tma-pos">${l.slot}</div><b>${l.player.name}</b><span class="tma-mini">R5 ${l.effectiveR5.toFixed(1)}${trainingSparkline(l.player.plot)}</span></div>`;
      }).join('');
      return `<div class="tma-pitch-row">${cells}</div>`;
    }).join('');

    const benchHtml = bench.named.map(b => {
      if (!b.player) return `<div class="tma-bench-card"><span class="tma-role-tag">${b.role}</span><span class="tma-mini">no eligible player left</span></div>`;
      return `<div class="tma-bench-card"><span class="tma-role-tag">${b.role}</span><span>${b.player.name} <span class="tma-badge">${b.player.fp}</span></span><span class="tma-mini">R5 ${(b.player._r5||b.player.rec).toFixed(1)}</span></div>`;
    }).join('');
    const benchExtrasHtml = bench.extras.length ? `<div class="tma-mini" style="margin-top:6px;">Also available: ${bench.extras.map(p => p.name + ' (' + p.fp + ')').join(', ')}</div>` : '';

    const rolesHtml = `
      <div class="tma-row"><span>Captain</span><span class="tma-goodval">${roles.captain ? roles.captain.name : '—'}</span></div>
      <div class="tma-row"><span>Free-kick taker</span><span class="tma-goodval">${roles.freeKick ? roles.freeKick.name : '—'}</span></div>
      <div class="tma-row"><span>Corner taker</span><span class="tma-goodval">${roles.corner ? roles.corner.name : '—'}</span></div>
      <div class="tma-row"><span>Penalty taker</span><span class="tma-goodval">${roles.penalty ? roles.penalty.name : '—'}</span></div>
    `;

    // Conditional orders in TM are exactly: one Event + one Score state + one Order,
    // configured before kickoff, max 5 total. Event types: specific time, player injured,
    // player booked, player sent off, a goal is scored. Score types: winning by 1-4,
    // losing by 1-4, drawn, doesn't matter. Order types: substitution, mentality change,
    // attacking style change, reposition a player — only ONE of these per row, not several
    // combined (the earlier version wrongly bundled a mentality change AND a substitution
    // into a single order).
    const defBenchName = bench.named.find(b => b.role === 'DEF' && b.player);
    const fcBenchName = bench.named.find(b => b.role === 'FC' && b.player);
    const weakestIn = (buckets) => {
      const pool = buckets.flatMap(b => rowGroups[b] || []).filter(l => l.player);
      if (!pool.length) return null;
      return pool.reduce((min, l) => l.effectiveR5 < min.effectiveR5 ? l : min, pool[0]);
    };
    const weakestAttacker = weakestIn(['OM', 'F']);
    const weakestMid = weakestIn(['M', 'DM']);

    // Human-readable position label from a bucket + optional side (e.g. "D","L" -> "Left
    // Defender"; "F" -> "Forward"). Used to spell out repositioning in substitution orders.
    const POS_BUCKET_LABEL = { GK: 'Goalkeeper', D: 'Defender', DM: 'Defensive Mid', M: 'Midfielder', OM: 'Attacking Mid', F: 'Forward' };
    const SIDE_LABEL = { L: 'Left', C: 'Central', R: 'Right' };
    const posLabel = (bucket, side) => {
      const b = POS_BUCKET_LABEL[bucket] || bucket;
      if (!side || side === 'C') return b;            // central/no-side reads cleaner without "Central"
      return (SIDE_LABEL[side] || '') + ' ' + b;
    };

    // Substitution order text that ALSO states which pitch position to give the incoming
    // player on TM's sub screen. Leaving him on the vacated slot's position by default
    // (e.g. subbing on a natural FC for a MR and just leaving him at MR) eats the off-position
    // penalty that pickBestXI/positionPenaltyMultiplier already accounts for when picking the
    // starting XI — so a substitute should get the SAME treatment: play him in his own
    // natural position whenever it differs from the slot he's replacing, not the vacated one.
    //   • same bucket + same side  -> already the vacated slot, nothing to change
    //   • same bucket, other flank -> same role, just a flank switch
    //   • different bucket         -> explicitly place him in his OWN position, not the vacated one
    const subOrder = (benchPick, offPlayer) => {
      if (!benchPick || !offPlayer || !benchPick.player || !offPlayer.player) return null;
      const inP = benchPick.player, out = offPlayer.player;
      const [slotBucket, slotSideRaw] = offPlayer.slot.split('-');
      const slotSide = slotSideRaw || 'C';
      const inBucket = bucketFor(inP.fp), inSide = sideFor(inP.fp);
      const vacated = posLabel(slotBucket, slotSide);
      const natural = posLabel(inBucket, inSide);
      let posNote;
      if (inBucket === slotBucket && inSide === slotSide) {
        posNote = ' — plays ' + vacated + ' (his natural position, nothing to change on the sub screen)';
      } else if (inBucket === slotBucket) {
        posNote = ' — plays ' + vacated + ' (same role, change flank: ' + (SIDE_LABEL[inSide] || 'Central') + ' → ' + (SIDE_LABEL[slotSide] || 'Central') + ')';
      } else {
        posNote = ' — on the sub screen, set his position to ' + natural + ' (his own natural role), NOT the vacated ' + vacated + ': leaving him at ' + vacated + ' plays him off-position and costs rating';
      }
      return 'Substitution: ' + inP.name + ' ON for ' + out.name + ' OFF' + posNote;
    };

    // Exactly 5 slots, each a single {event, score, order} triple:
    const condOrders = [
      { event: 'Time reaches 70\'', score: 'Losing by 1+', order: 'Change mentality to ' + MENTALITY[Math.min(7, settings.mentality + 2)] },
      { event: 'Time reaches 75\'', score: 'Losing by 2+', order: subOrder(fcBenchName, weakestMid) || ('Change mentality to ' + MENTALITY[Math.min(7, settings.mentality + 3)]) },
      { event: 'Time reaches 75\'', score: 'Winning by 1', order: 'Change mentality to ' + MENTALITY[Math.max(1, settings.mentality - 1)] },
      { event: 'Time reaches 70\'', score: 'Winning by 2+', order: subOrder(defBenchName, weakestAttacker) || ('Change mentality to ' + MENTALITY[Math.max(1, settings.mentality - 2)]) },
      { event: 'Player sent off (yours)', score: 'Doesn\'t matter', order: 'Change mentality to ' + MENTALITY[Math.max(1, settings.mentality - 2)] },
    ];
    const condOrdersHtml = condOrders.map((c, i) => `
      <div class="tma-card" style="margin-bottom:8px;">
        <div class="tma-mini" style="text-transform:uppercase;letter-spacing:.04em;color:#8a939c;">Order ${i + 1}</div>
        <div class="tma-row"><span>Event</span><span>${c.event}</span></div>
        <div class="tma-row"><span>Score</span><span>${c.score}</span></div>
        <div class="tma-row"><span>Order</span><span class="tma-goodval">${c.order}</span></div>
      </div>`).join('');

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

    body.innerHTML = `
      <div class="tma-card">
        <h4>Recommended Formation: ${best.formation} <span class="tma-badge">Avg R5 ${(best.totalRec / startingPlayers.length).toFixed(1)}</span></h4>
        <div class="tma-pitch">${pitchRowsHtml}</div>
      </div>
      <div class="tma-card">
        <h4>Suggested Tactic Settings</h4>
        <div class="tma-row"><span>Mentality</span><span class="tma-goodval">${MENTALITY[settings.mentality]}</span></div>
        <div class="tma-row"><span>Attacking Style</span><span class="tma-goodval">${ATT_STYLE[settings.style]}</span></div>
        <div class="tma-row"><span>Focus Side</span><span class="tma-goodval">${FOCUS_SIDE[settings.focus]}</span></div>
      </div>
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
        <div class="tma-mini" style="margin-bottom:8px;">Enter these in TM's Conditional Order screen exactly as shown — each is one Event, one Score state, and one single Order. For substitutions, the note after the players tells you which position to select on the sub screen — his own natural role, not just the slot he's replacing, so he isn't played out of position.</div>
        ${condOrdersHtml}
      </div>
      ${expectedTacticsHtml}
    `;
  }

  function renderStadiumTab() {
    const body = document.getElementById('tma-body');
    const stadiumSlice = getSlice('stadium');
    const homeSlice = getSlice('home');
    const financesSlice = getSlice('finances');
    const maintenanceSlice = getSlice('maintenance');
    const clubSlice = getSlice('club');
    if (!stadiumSlice) {
      body.innerHTML = `<div class="tma-card"><h4>No stadium data yet</h4><div class="tma-reason">Visit the Stadium page once (or hit Update All on Dashboard).</div></div>`;
      return;
    }
    // Cash source priority: Finances balance (confirmed reliable — regex matches "Current
    // Balance:" text directly) > Home page inline var > Stadium page inline var. The inline
    // SESSION["cash"]/manager_cash regexes are best-effort since the exact JS var name can
    // change; Finances is the one place we're always sure of the number.
    let cash = null, cashSource = null;
    if (financesSlice && financesSlice.data.balance != null) { cash = financesSlice.data.balance; cashSource = 'Finances page'; }
    else if (homeSlice && homeSlice.data.cash != null) { cash = homeSlice.data.cash; cashSource = 'Home page'; }
    else if (stadiumSlice.data.cash != null) { cash = stadiumSlice.data.cash; cashSource = 'Stadium page'; }
    const fd = stadiumSlice.data.facilityData;
    const stadiumSeats = fd && fd.stadium ? fd.stadium.level : null;
    const attendanceRef = stadiumSeats ? Math.round(stadiumSeats * 0.65) : 15000; // rough fill-rate assumption

    // Weekly income/maintenance for the sustainability check. Maintenance now prefers the
    // dedicated Maintenance page's own "Total" row (exact, per-facility-summed figure) over
    // the Finances tab's weekly aggregate, falling back to the latter if that page hasn't
    // been visited/fetched yet.
    let financials = null, maintenanceSource = null;
    if (financesSlice && financesSlice.data.weekly) {
      const w = financesSlice.data.weekly;
      const get = (label, idx) => w[label] ? parseMoney(w[label][idx || 0]) : 0;
      const weeklyIncome = get('Attendance') + get('TV Money') + get('Sponsors') + get('Merchandise') + get('Food');
      let weeklyMaintenance = Math.abs(get('Maintenance'));
      maintenanceSource = 'Finances tab (aggregate)';
      if (maintenanceSlice && maintenanceSlice.data.totals && maintenanceSlice.data.totals['Total']) {
        weeklyMaintenance = maintenanceSlice.data.totals['Total'].week;
        maintenanceSource = 'Maintenance page (exact)';
      }
      financials = { weeklyIncome, weeklyMaintenance };
    }

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
      const tierBadge = `<span class="tma-badge" style="${TIER_COLOR[r.tier]}">${TIER_LABEL[r.tier]}</span>`;
      const payback = r.paybackWeeks ? r.paybackWeeks.toFixed(0) + ' wks payback' : (r.weeklyGain != null ? 'no clear ROI' : '');
      const warnHtml = r.sustainabilityWarning ? `<div class="tma-reason" style="color:#f8dca8;">⚠ ${r.sustainabilityWarning}</div>` : '';
      return `<div class="tma-card">
        <h4>${r.title} → Lvl ${r.nextLevel}</h4>
        <div style="margin:-4px 0 6px;">${tierBadge} ${afford}</div>
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
        <div class="tma-row"><span>Available</span><span class="tma-goodval">${cash != null ? cash.toLocaleString() : 'unknown — visit Finances page once'}</span></div>
        ${cash != null ? `<div class="tma-mini">Source: ${cashSource}</div>` : ''}
        ${financials ? `<div class="tma-row"><span>Weekly income (approx.)</span><span>${financials.weeklyIncome.toLocaleString()}</span></div>
          <div class="tma-row"><span>Weekly maintenance (current)</span><span>${financials.weeklyMaintenance.toLocaleString()}</span></div>
          <div class="tma-mini">Maintenance source: ${maintenanceSource}${!maintenanceSlice ? ' — visit /finances/maintenance/ once for the exact figure' : ''}</div>
          <div class="tma-row"><span>Headroom</span><span class="${financials.weeklyIncome - financials.weeklyMaintenance > 0 ? 'tma-goodval' : ''}">${(financials.weeklyIncome - financials.weeklyMaintenance).toLocaleString()}/wk</span></div>` : ''}
        <div class="tma-mini">Attendance assumption for ROI math: ~${attendanceRef.toLocaleString()} (65% of ${stadiumSeats ? stadiumSeats.toLocaleString() : '?'} seats). Refine by checking recent Attendance income on the Finances tab.</div>
        ${seatTargetHtml}
      </div>
      <div class="tma-card">
        <h4>Upgrade Priority Order</h4>
        <div class="tma-reason"><b>1. Youth Academy / Training Ground</b> — per community advice: push these first since their benefit compounds every week going forward.</div>
        <div class="tma-reason"><b>2. Income generators</b> (Fast Food, Merchandise, Restaurant, Sausage Stand) — ranked below by fastest payback.</div>
        <div class="tma-reason"><b>3. Everything else</b> (attendance/quality-of-life facilities).</div>
        <div class="tma-reason">This ordering is a stated community heuristic we haven't independently verified against TM's actual mechanics — apply your own judgement, especially if your Youth Academy is already high-level relative to your league.</div>
      </div>
      <h4 style="margin:4px 2px;color:#7fb2e0;">Ranked Upgrades (priority tier, then value)</h4>
      ${rowsHtml || '<div class="tma-mini">All facilities maxed, or no cost data found.</div>'}
    `;
  }

  function renderScouting() {
    const body = document.getElementById('tma-body');
    const c = loadCache();
    const scoutData = c.scoutReports ? c.scoutReports.data : null;
    const scoutAge = c.scoutReports ? ago(c.scoutReports.t) : null;

    // ---- 1. The compiled youth shortlist (age/Rou/SI/R5), from Section 5B ----
    const shortlistSlice = getSlice('youthShortlist');
    const shortlist = shortlistSlice ? shortlistSlice.data : null;
    const poolNow = collectYouthPool();
    const youthPrefs = loadShortlistPrefs('youth');
    const seniorPrefs = loadShortlistPrefs('senior');

    const money = (n) => n == null ? '—' : Number(n).toLocaleString();
    // Max-cost input + foreign toggle, shared markup for both shortlists. Max cost is a live
    // input (not a constant) since it changes as your cash on hand changes; a blank field
    // doesn't mean "no limit" — it means "use my current affordable budget" (effectiveMaxCost,
    // Section 5B), so the field is pre-filled with that number rather than left empty, and the
    // placeholder makes clear where an untouched value is coming from. Foreign defaults OFF
    // (home-nation only) and, when on, includes players whose nationality is unknown too.
    const prefsControlsHtml = (which, prefs) => {
      const auto = effectiveMaxCost({}); // what an empty field resolves to right now
      const hint = prefs.maxCost != null
        ? `fixed at your typed cap — clear the field to switch back to auto`
        : (auto ? `blank = auto, currently ${money(auto)} (tracks your affordable budget live)` : 'blank = no cap yet — visit /home/ or /finances/ so a budget is known');
      // Senior-only: max age. 27 is straight from TM's own Player Development guide — skills
      // are confirmed to start deteriorating from 28 onward — not an invented cutoff, but
      // still a live input since a short-term "win now" signing might justify going older.
      const ageRow = which === 'senior'
        ? `<div class="tma-row"><span>Max age</span><input type="number" id="tma-${which}-maxage" min="${SENIOR_CRITERIA.minAge}" max="45" value="${prefs.maxAge != null ? prefs.maxAge : SENIOR_CRITERIA.maxAgeDefault}" style="width:130px;background:#181b1f;border:1px solid #2c313780;color:#e4e7ea;border-radius:5px;padding:4px 7px;text-align:right;"></div>
           <div class="tma-mini" style="margin:-2px 0 6px;">Default ${SENIOR_CRITERIA.maxAgeDefault} — TM's own guide confirms skills begin deteriorating from age 28.</div>`
        : '';
      return `
      ${ageRow}
      <div class="tma-row"><span>Max cost</span><input type="number" id="tma-${which}-maxcost" placeholder="${auto ? money(auto) : 'no limit'}" min="0" step="100000" value="${prefs.maxCost != null ? prefs.maxCost : ''}" style="width:130px;background:#181b1f;border:1px solid #2c313780;color:#e4e7ea;border-radius:5px;padding:4px 7px;text-align:right;"></div>
      <div class="tma-mini" style="margin:-2px 0 6px;">${hint}</div>
      <label class="tma-row" style="cursor:pointer;"><span>Include foreign players</span><input type="checkbox" id="tma-${which}-foreign" ${prefs.includeForeign ? 'checked' : ''}></label>
    `;
    };
    const readPrefsFromInputs = (which) => {
      const costEl = document.getElementById(`tma-${which}-maxcost`);
      const foreignEl = document.getElementById(`tma-${which}-foreign`);
      const ageEl = document.getElementById(`tma-${which}-maxage`);
      const prefs = {
        maxCost: costEl && costEl.value ? Number(costEl.value) : null,
        includeForeign: !!(foreignEl && foreignEl.checked),
      };
      if (ageEl) prefs.maxAge = ageEl.value ? Number(ageEl.value) : null;
      saveShortlistPrefs(which, prefs);
      return prefs;
    };
    // Tier badge — Elite (top 20% by composite score) / Strong (next 30%). Everything below
    // that bar is dropped before it ever reaches the UI (see tierAndFilter, Section 5B).
    const tierBadge = (p) => p.tier === 'elite'
      ? ' <span class="tma-badge" style="background:#3d3524;color:#e8cfa0;">elite</span>'
      : (p.tier === 'strong' ? ' <span class="tma-badge" style="background:#28323d;color:#a8c8e0;">strong</span>' : '');
    const badge = (p) => {
      let out = tierBadge(p);
      if (p.highPotential) out += ' <span class="tma-badge" style="background:#2a2f42;color:#b9c4ee;">high potential</span>';
      return out;
    };
    // Home-nation vs. foreign badge (informational only — see the note in Section 5C on why
    // this is never used to filter/exclude a target).
    const natBadge = (p) => {
      if (!p.nat) return '';
      const home = MY_COUNTRY && p.nat === MY_COUNTRY;
      return ` <span class="tma-badge" style="background:${home ? '#1c3a20' : '#2c313780'};color:${home ? '#a9d6a9' : '#c7cdd3'};">${p.nat.toUpperCase()}${home ? ' · home' : ''}</span>`;
    };
    const playerLink = (p) => `https://trophymanager.com/players/${p.id}/`;
    // Cost row shared by youth + senior cards: a live transfer-list bid when we've seen one
    // (a real auction can settle above OR below it), plus the game's own two confirmed price
    // points always shown when known — Sell-to-Agent (instant guaranteed sale) and Max Sell
    // Price (the ceiling TM lets you list the player for). See Section 2C for the formulas.
    const costRow = (p) => {
      let out = p.price ? `<div class="tma-row"><span>Current bid</span><span class="tma-goodval">${money(p.price)}</span></div>` : '';
      if (p.estValue) out += `<div class="tma-row"><span>Sell-to-Agent</span><span>${money(p.estValue)}</span></div>`;
      if (p.maxValue && p.maxValue !== p.estValue) out += `<div class="tma-row"><span>Max Sell Price</span><span>${money(p.maxValue)}</span></div>`;
      return out;
    };

    const shortlistHtml = (shortlist && shortlist.length) ? shortlist.map(p => `
      <div class="tma-card">
        <h4><a href="${playerLink(p)}" target="_blank" style="color:#7fb2e0;text-decoration:none;">${p.name} ↗</a>${badge(p)}${natBadge(p)}</h4>
        <div class="tma-row"><span>Age</span><span class="tma-goodval">${p.age != null ? p.age : '?'}</span></div>
        <div class="tma-row"><span>Position</span><span>${p.fp || '?'}</span></div>
        <div class="tma-row"><span>R5</span><span class="tma-goodval">${p.r5 != null ? p.r5.toFixed(1) : '—'}</span></div>
        <div class="tma-row"><span>SI</span><span>${p.asi != null ? p.asi.toLocaleString() : '—'}</span></div>
        <div class="tma-row"><span>Routine</span><span>${p.routine != null ? p.routine.toFixed(1) : '—'}</span></div>
        ${costRow(p)}
        ${p.potential != null ? `<div class="tma-row"><span>Scout potential</span><span class="tma-goodval">${(p.potential / 2).toFixed(1)} / 5${p.growth != null ? ' · ' + p.growth.toFixed(1) + '× rec' : ''}</span></div>` : ''}
        <div class="tma-mini">Seen on the transfer list ${ago(shortlistSlice ? shortlistSlice.t : null)}</div>
      </div>`).join('')
      : `<div class="tma-mini">No shortlist built yet. There ${poolNow.length === 1 ? 'is' : 'are'} <b>${poolNow.length}</b> player(s) seen on the transfer list so far. Hit “Fetch full stats” to pull R5/Routine/SI/Wage for them automatically, then “Build / Refresh Shortlist”.</div>`;

    // ---- Senior transfer targets (Section 5C) ----
    const seniorSlice = getSlice('seniorShortlist');
    const seniorList = seniorSlice ? seniorSlice.data : null;
    const weakestMap = ownWeakestByBucket();
    const weakestRowsHtml = weakestMap ? Object.entries(weakestMap).map(([b, v]) => `<div class="tma-row"><span>${b}</span><span>${v.toFixed(1)}</span></div>`).join('') : '';
    const seniorHtml = (seniorList && seniorList.length) ? seniorList.map(p => `
      <div class="tma-card">
        <h4><a href="${playerLink(p)}" target="_blank" style="color:#7fb2e0;text-decoration:none;">${p.name} ↗</a>${tierBadge(p)}${natBadge(p)}</h4>
        <div class="tma-row"><span>Age</span><span>${p.age != null ? p.age : '?'}</span></div>
        <div class="tma-row"><span>Position</span><span>${p.fp || '?'}</span></div>
        <div class="tma-row"><span>R5</span><span class="tma-goodval">${p.r5Known ? p.r5.toFixed(1) : '—'}${p.baseline != null ? ` <span class="tma-mini">(your weakest ${bucketFor(p.fp)}: ${p.baseline.toFixed(1)})</span>` : ''}</span></div>
        ${!p.r5Known ? `<div class="tma-mini" style="margin:-2px 0 4px;">R5 pending — skills not seen yet on the transfer list (flip to Skills view); qualified here on SI alone.</div>` : ''}
        <div class="tma-row"><span>SI</span><span>${p.asi != null ? p.asi.toLocaleString() : '—'}</span></div>
        <div class="tma-row"><span>Routine</span><span>${p.routine != null ? p.routine.toFixed(1) : '—'}</span></div>
        ${p.wage ? `<div class="tma-row"><span>Wage</span><span>${money(p.wage)}/wk</span></div>` : ''}
        ${costRow(p)}
        <div class="tma-mini">Source: ${p.src || 'transfer list'}${p.price ? ' · current bid, not a guaranteed sale price' : ''}</div>
      </div>`).join('')
      : `<div class="tma-mini">No senior shortlist built yet. Hit “Fetch full stats” to pull R5/Routine/SI/Wage for the transfer-list pool automatically (SI alone from Breakdown still qualifies a candidate before that finishes), then “Build / Refresh Senior Targets”.</div>`;

    // ---- Budget guidance (Section 5D) ----
    const budget = budgetGuidance();
    const budgetHtml = budget ? `
      <div class="tma-card">
        <h4>Spending Guidance</h4>
        <div class="tma-row"><span>Cash on hand</span><span>${money(budget.cash)}</span></div>
        ${budget.weeklyWage != null ? `<div class="tma-row"><span>Weekly wage bill</span><span>${money(budget.weeklyWage)}</span></div>
        <div class="tma-row"><span>Reserve kept back (${BUDGET_WAGE_WEEKS_RESERVE}wk wages)</span><span>${money(budget.buffer)}</span></div>` : `<div class="tma-mini">Weekly wage bill not read yet — visit /finances/ once for a wage-aware reserve instead of the raw cash figure.</div>`}
        <div class="tma-row"><span>Recommended transfer budget</span><span class="tma-goodval">${money(budget.recommendedMax)}</span></div>
        <div class="tma-reason">Heuristic, not a game rule: keeps ${BUDGET_WAGE_WEEKS_RESERVE} weeks of wages in reserve, then treats ${Math.round(BUDGET_SPEND_FRACTION * 100)}% of what's left as this window's budget (tune BUDGET_WAGE_WEEKS_RESERVE / BUDGET_SPEND_FRACTION in Section 5D). Split it across your highest-value senior targets below rather than one big bid.</div>
      </div>` : `<div class="tma-mini">Cash not read yet — visit /home/ or /finances/ (or hit Update All on the Dashboard) for spending guidance.</div>`;

    // ---- 2. Scout-report potential view (secondary source; no age/skills from endpoint) ----
    const scoutListHtml = (scoutData && scoutData.length) ? (() => {
      const ranked = [...scoutData].sort((a, b) => (b.potential || 0) - (a.potential || 0));
      return ranked.slice(0, 20).map(p => {
        const gem = p.growthMultiple != null && p.growthMultiple >= YOUTH_CRITERIA.highPotentialGrowth;
        return `<div class="tma-card">
          <h4><a href="${playerLink(p)}" target="_blank" style="color:#7fb2e0;text-decoration:none;">${p.name} ↗</a> ${gem ? '<span class="tma-badge" style="background:#2a2f42;color:#b9c4ee;">high potential</span>' : ''}</h4>
          <div class="tma-row"><span>Current Rec</span><span>${(p.rec || 0).toFixed(1)}</span></div>
          <div class="tma-row"><span>Potential</span><span class="tma-goodval">${(p.potential / 2).toFixed(1)} / 5</span></div>
          <div class="tma-mini">Scouted ${p.date || 'recently'}${p.growthMultiple != null ? ' · potential is ' + p.growthMultiple.toFixed(1) + '× current rec' : ''}. Age not returned by the scouts endpoint — open the profile to age-check.</div>
        </div>`;
      }).join('');
    })() : '<div class="tma-mini">No scout reports cached yet — click "Refresh Scout Reports" below to pull them in for the high-potential view.</div>';

    body.innerHTML = `
      <div class="tma-card">
        <h4>Senior Transfer Targets</h4>
        <div class="tma-mini">From players seen on the <b>Transfer</b> list, players ${SENIOR_CRITERIA.minAge}-${seniorPrefs.maxAge != null ? seniorPrefs.maxAge : SENIOR_CRITERIA.maxAgeDefault} who beat the weakest starter in their own position bucket in <b>your current best XI</b> — by R5 when both SI and skills are known, or by SI alone (a bigger ${SENIOR_CRITERIA.minEdgePctSI}% edge required) when only Breakdown has been seen. Ranked Elite (top 20%) to Strong (next 30%); the rest are filtered out.</div>
        ${weakestMap ? `<div class="tma-mini" style="margin-top:4px;">Your weakest starter per bucket right now:</div>${weakestRowsHtml}` : `<div class="tma-mini">Your squad isn't cached yet — visit /players/ once so we know what "better than my team" means per position.</div>`}
        ${prefsControlsHtml('senior', seniorPrefs)}
        <button class="tma-btn secondary" id="tma-senior-fetchstats">📡 Fetch full stats (R5 · Rou · SI · Wage)</button>
        <button class="tma-btn" id="tma-senior-build">🎯 Build / Refresh Senior Targets</button>
        ${seniorList && seniorList.length ? `<button class="tma-btn secondary" id="tma-senior-clear">🗑 Clear shortlist</button>` : ''}
        <div class="tma-mini" id="tma-senior-status">${seniorList ? seniorList.length + ' target(s) shortlisted (' + ago(seniorSlice.t) + ')' : 'Not built yet'}</div>
      </div>
      ${seniorHtml}
      <div class="tma-card">
        <h4>Youth Talent Shortlist 🌱</h4>
        <div class="tma-mini">Built ONLY from players you've seen on the <b>Transfer</b> list — never your own squad or a scanned/opponent club — scored by a composite of R5, SI, routine, age and cost (Section 5B). Only the <b>Elite</b> (top 20%) and <b>Strong</b> (next 30%) tiers are shown, the rest are filtered out.</div>
        <div class="tma-row"><span>Hard floors</span><span class="tma-mini">age ≤ ${YOUTH_CRITERIA.maxAge}, Rou ≥ ${YOUTH_CRITERIA.minRoutine}, SI ≥ ${YOUTH_CRITERIA.minASI}, R5 ≥ ${YOUTH_CRITERIA.minR5}</span></div>
        <div class="tma-mini">Pool right now: ${poolNow.length} player(s) seen on the transfer list. Tune the floors in YOUTH_CRITERIA and the scoring in scoutScore (Section 5B).</div>
        ${prefsControlsHtml('youth', youthPrefs)}
        <button class="tma-btn secondary" id="tma-youth-fetchstats">📡 Fetch full stats (R5 · Rou · SI · Wage)</button>
        <button class="tma-btn" id="tma-youth-build">🧮 Build / Refresh Shortlist</button>
        ${shortlist && shortlist.length ? `<button class="tma-btn secondary" id="tma-youth-copy">📋 Copy shortlist (name · age · R5 · link)</button><button class="tma-btn secondary" id="tma-youth-clear">🗑 Clear shortlist</button>` : ''}
        <div class="tma-mini" id="tma-youth-status">${shortlist ? shortlist.length + ' player(s) shortlisted (' + ago(shortlistSlice.t) + ')' : 'Not built yet'}</div>
      </div>
      ${shortlistHtml}
      <div class="tma-card">
        <h4>Scouts' High-Potential Board <span class="tma-badge">by potential</span></h4>
        <div class="tma-mini">From your own scouts' reports — current rec vs. flagged potential, to catch youngsters who look ordinary now but should develop well.</div>
        <button class="tma-btn secondary" id="tma-scout-refresh">🔍 Refresh Scout Reports</button>
        ${scoutData && scoutData.length ? `<button class="tma-btn secondary" id="tma-scout-clear">🗑 Clear scout reports</button>` : ''}
        <div class="tma-mini" id="tma-scout-status">${scoutData ? scoutData.length + ' reports cached (' + scoutAge + ')' : 'Not fetched yet'}</div>
      </div>
      ${scoutListHtml}
      <div class="tma-card">
        <h4>How to calibrate for “top talent”</h4>
        <div class="tma-reason">The floors ship low so nothing is hidden. Open your Players page, read the <b>SI</b> and <b>R5</b> columns for a youngster you rate, then set <b>minASI</b>/<b>minR5</b> in Section 5B just below those numbers to filter the list to your level.</div>
        <div class="tma-reason">On the <b>Transfer</b> page, SI + R5 columns are added to the results automatically. R5 needs both SI and skills, so flip once through <b>Breakdown</b> (shows SI) and <b>Skills</b> (shows skills) — R5 then fills in for every listed player, and browsing the page is also what fills the pool for both shortlists above. A player only ever seen in Breakdown still qualifies on SI alone, just with a bigger required edge.</div>
        <div class="tma-reason">"Include foreign players" defaults OFF, matching TM's own transfer-list default (no /for/ in the URL) — home nation only, and a player whose flag we couldn't read does NOT pass through either. Flip it on to search everyone, matching TM's /for/ URL. If the youth/senior lists look emptier than expected with it off, that's usually a sign the flag-parsing pattern needs tuning for this page — try toggling it on temporarily as a sanity check. We could not find a hard "non-national squad limit" game rule anywhere in TM's own user guide or in any community script reviewed — this toggle is purely a search preference, not modelling a game rule.</div>
      </div>
      ${budgetHtml}
    `;

    const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };

    bind('tma-youth-build', () => {
      const status = document.getElementById('tma-youth-status');
      const prefs = readPrefsFromInputs('youth');
      const { ranked, poolSize } = buildYouthShortlist(prefs);
      status.textContent = ranked.length + ' shortlisted from a pool of ' + poolSize + '.';
      renderScouting();
    });

    // Fetches R5/Routine/SI/Wage for the whole transfer-list pool via tooltip.ajax.php
    // (Section 5B) then immediately rebuilds this shortlist with prefs read live from the
    // inputs — one click takes you from "half-known SI-only rows" to an accurately ranked and
    // filtered list without ever needing to flip Breakdown/Skills manually. Both fetch buttons
    // hit the SAME underlying pool, so running it from either card benefits both shortlists.
    const bindFetchStats = (which, buttonId, statusId, build) => {
      bind(buttonId, async () => {
        const status = document.getElementById(statusId);
        const btn = document.getElementById(buttonId);
        if (btn) btn.disabled = true;
        try {
          const result = await fetchFullStatsForPool((done, total, name) => {
            if (status) status.textContent = `Fetching ${done}/${total}: ${name || '…'}`;
          });
          if (status) status.textContent = `Fetched ${result.fetched} player(s)` + (result.remaining ? ` — ${result.remaining} more still incomplete, click again to continue` : ' — pool fully up to date') + '. Rebuilding…';
          const prefs = readPrefsFromInputs(which);
          build(prefs);
        } catch (e) {
          if (status) status.textContent = 'Fetch failed — see console for details.';
          console.error('TM Advisor: full-stats fetch failed', e);
        }
        renderScouting();
      });
    };
    bindFetchStats('youth', 'tma-youth-fetchstats', 'tma-youth-status', buildYouthShortlist);
    bindFetchStats('senior', 'tma-senior-fetchstats', 'tma-senior-status', buildSeniorShortlist);

    bind('tma-youth-copy', () => {
      const text = (shortlist || []).map(p => `${p.name} · age ${p.age != null ? p.age : '?'} · R5 ${p.r5 != null ? p.r5.toFixed(1) : '—'} · ${playerLink(p)}`).join('\n');
      navigator.clipboard.writeText(text).then(() => {
        const status = document.getElementById('tma-youth-status');
        if (status) status.textContent = 'Copied ' + (shortlist || []).length + ' players to clipboard.';
      }).catch(() => {});
    });

    bind('tma-youth-clear', () => {
      const cc = loadCache();
      delete cc.youthShortlist;
      saveCache(cc);
      renderScouting();
    });

    bind('tma-senior-build', () => {
      const status = document.getElementById('tma-senior-status');
      const prefs = readPrefsFromInputs('senior');
      const { ranked, poolSize } = buildSeniorShortlist(prefs);
      status.textContent = ranked.length + ' target(s) shortlisted from a pool of ' + poolSize + '.';
      renderScouting();
    });

    bind('tma-senior-clear', () => {
      const cc = loadCache();
      delete cc.seniorShortlist;
      saveCache(cc);
      renderScouting();
    });

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

    bind('tma-scout-clear', () => {
      const cc = loadCache();
      delete cc.scoutReports;
      saveCache(cc);
      renderScouting();
    });
  }

  /* ============================================================
   *  SECTION 8 — BOOT
   * ============================================================ */

  // An individual player's profile page (/players/{id}/...) already gets its own inline
  // Rou/SI/R5/breakdown card injected directly into the page (enhancePlayerDetailPage,
  // Section 4) — the separate advisor dock has nothing squad-specific to add there and would
  // just be a floating box in the way, so it's skipped entirely on this page type. Data
  // capture (autoCaptureCurrentPage) still runs regardless.
  function boot() {
    injectStyle();
    if (!/^\/players\/\d+/.test(location.pathname)) buildPanel();
    autoCaptureCurrentPage();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') boot();
  else document.addEventListener('DOMContentLoaded', boot);

})();
