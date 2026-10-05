/* ===== E7sebha Sah tournament engine (pure functions, no DOM) ===== */
const SIZES = [4, 16, 32, 64];
const GAMES = {
  fc27: { id: 'fc27', name: 'FC 27', short: 'FC 27', icon: '🎮', deviceType: 'PS', deviceName: 'PlayStation', deviceOptions: [4, 3, 2, 1], defaultDevices: 4 },
  lol:  { id: 'lol',  name: 'League of Legends', short: 'LoL', icon: '🖥️', deviceType: 'PC', deviceName: 'PC', deviceOptions: [16, 8, 4], defaultDevices: 16 }
};

function roundName(size, r) {
  const totalRounds = Math.log2(size);
  const left = totalRounds - r; // 1 = final
  if (left === 1) return 'Final';
  if (left === 2) return 'Semifinals';
  if (left === 3) return 'Quarterfinals';
  return 'Round of ' + (size / Math.pow(2, r));
}

function blankEntrants(size, format) {
  const arr = [];
  for (let i = 0; i < size; i++) {
    arr.push({ id: 'e' + (i + 1), name: '', players: format === '2v2' ? ['', ''] : [] });
  }
  return arr;
}

/* Build the bracket structure for any power-of-two size. */
function buildMatches(size) {
  const R = Math.log2(size);
  const ms = [];
  for (let r = 0; r < R; r++) {
    const n = size / Math.pow(2, r + 1);
    for (let i = 0; i < n; i++) {
      const m = { id: 'R' + r + 'M' + i, kind: 'main', round: r, idx: i, sa: null, sb: null, status: 'upcoming', winner: null, loser: null, tie: false, decider: null, a: null, b: null, slot: 0, device: 1 };
      if (r === 0) { m.srcA = { seed: 2 * i }; m.srcB = { seed: 2 * i + 1 }; }
      else { m.srcA = { m: 'R' + (r - 1) + 'M' + (2 * i), t: 'w' }; m.srcB = { m: 'R' + (r - 1) + 'M' + (2 * i + 1), t: 'w' }; }
      ms.push(m);
    }
  }
  // third place match, fed by the semifinal losers (placed in the final round)
  ms.push({ id: 'T', kind: 'third', round: R - 1, idx: 0, sa: null, sb: null, status: 'upcoming', winner: null, loser: null, tie: false, decider: null, a: null, b: null, slot: 0, device: 1,
    srcA: { m: 'R' + (R - 2) + 'M0', t: 'l' }, srcB: { m: 'R' + (R - 2) + 'M1', t: 'l' } });
  return ms;
}

function orderMatches(t) {
  // schedule/play order: by round, third place before the final
  return t.matches.slice().sort((x, y) => {
    if (x.round !== y.round) return x.round - y.round;
    if (x.kind !== y.kind) return x.kind === 'third' ? -1 : 1;
    return x.idx - y.idx;
  });
}

function numberMatches(t) {
  orderMatches(t).forEach((m, i) => { m.num = i + 1; });
}

function newTournament(opts) {
  const g = GAMES[opts.game];
  const t = {
    v: 1, id: opts.game, game: opts.game, size: opts.size, format: opts.format,
    devices: opts.devices || g.defaultDevices, startTime: opts.startTime || '10:00', duration: opts.duration || 30,
    started: false, createdAt: Date.now(), updatedAt: Date.now(),
    entrants: blankEntrants(opts.size, opts.format),
    matches: buildMatches(opts.size)
  };
  numberMatches(t);
  buildSchedule(t);
  resolve(t);
  return t;
}

function byId(t, id) { return t.matches.find(m => m.id === id); }
function entrant(t, id) { return id ? t.entrants.find(e => e.id === id) : null; }

function srcEntrantId(t, src) {
  if (src.seed !== undefined) return t.entrants[src.seed] ? t.entrants[src.seed].id : null;
  const m = byId(t, src.m);
  if (!m || m.status !== 'done') return null;
  return src.t === 'w' ? m.winner : m.loser;
}

function clearResult(m) {
  m.sa = null; m.sb = null; m.status = 'upcoming'; m.winner = null; m.loser = null; m.tie = false; m.decider = null;
  delete m.startedAt; delete m.doneAt;
}

/* Recompute who plays where from the results. Any match whose participants changed has its result cleared,
   which cascades down the tree, so edits never leave stale/duplicate participants. */
function resolve(t) {
  const ordered = orderMatches(t);
  for (const m of ordered) {
    const a = srcEntrantId(t, m.srcA), b = srcEntrantId(t, m.srcB);
    if (m.a !== a || m.b !== b) {
      const had = m.status === 'done' || m.sa !== null;
      m.a = a; m.b = b;
      if (had || m.status === 'live') clearResult(m);
    }
    if (m.status === 'done') { m.loser = m.winner === m.a ? m.b : m.a; }
  }
  t.updatedAt = Date.now();
  return t;
}

function matchReady(m) { return !!(m.a && m.b); }

/* Save a score. Winner is derived from the score. Draw => nobody advances. */
function saveResult(t, matchId, sa, sb) {
  const m = byId(t, matchId);
  if (!m) return { ok: false, error: 'Match not found' };
  if (!matchReady(m)) return { ok: false, error: 'Both participants are not decided yet' };
  sa = Number(sa); sb = Number(sb);
  if (!Number.isInteger(sa) || !Number.isInteger(sb) || sa < 0 || sb < 0) return { ok: false, error: 'Enter whole-number scores for both sides' };
  m.sa = sa; m.sb = sb; m.decider = null;
  if (sa === sb) {
    m.tie = true; m.winner = null; m.loser = null; m.status = 'live';
    m.startedAt = m.startedAt || Date.now();
  } else {
    m.tie = false; m.status = 'done'; m.winner = sa > sb ? m.a : m.b; m.loser = sa > sb ? m.b : m.a; m.doneAt = Date.now();
  }
  resolve(t);
  return { ok: true, tie: m.tie };
}

/* A drawn match decided by penalties / golden goal / admin decision. */
function resolveTie(t, matchId, side) {
  const m = byId(t, matchId);
  if (!m || !m.tie || m.sa !== m.sb) return { ok: false, error: 'Match is not a draw' };
  m.winner = side === 'a' ? m.a : m.b; m.loser = side === 'a' ? m.b : m.a;
  m.status = 'done'; m.tie = false; m.decider = 'tiebreak'; m.doneAt = Date.now();
  resolve(t);
  return { ok: true };
}

function reopenMatch(t, matchId) {
  const m = byId(t, matchId);
  if (!m) return;
  clearResult(m);
  resolve(t);
}

function startMatch(t, matchId) {
  const m = byId(t, matchId);
  if (!m || !matchReady(m) || m.status === 'done') return false;
  m.status = 'live'; m.startedAt = m.startedAt || Date.now();
  t.updatedAt = Date.now();
  return true;
}

/* Keep the venue moving: when nothing is live, put the next ready slot of matches on the devices. */
function autoStart(t) {
  if (!t.started) return 0;
  if (t.matches.some(m => m.status === 'live')) return 0;
  const r = t.matches.filter(m => m.status === 'upcoming' && matchReady(m));
  if (!r.length) return 0;
  const s = Math.min(...r.map(m => m.slot));
  let n = 0; r.filter(m => m.slot === s).forEach(m => { startMatch(t, m.id); n++; });
  return n;
}

/* How many already-entered results would be wiped if this edit is applied? */
function impactOf(t, matchId, sa, sb) {
  const copy = JSON.parse(JSON.stringify(t));
  const before = copy.matches.filter(m => m.status === 'done' && m.id !== matchId).map(m => m.id);
  if (sa === null) reopenMatch(copy, matchId); else saveResult(copy, matchId, sa, sb);
  return before.filter(id => byId(copy, id).status !== 'done').length;
}

/* Schedule: matches grouped into time slots by device count. Devices are reused every slot.
   Rounds never overlap; third place plays first, the Final gets its own closing slot. */
function buildSchedule(t) {
  const D = t.devices;
  const ordered = orderMatches(t);
  const R = Math.log2(t.size);
  let slot = 0;
  for (let r = 0; r < R; r++) {
    const round = ordered.filter(m => m.round === r);
    if (r === R - 1) {
      const third = round.find(m => m.kind === 'third'), fin = round.find(m => m.kind === 'main');
      third.slot = slot; third.device = 1; slot++;
      fin.slot = slot; fin.device = 1; slot++;
    } else {
      round.forEach((m, i) => { m.slot = slot + Math.floor(i / D); m.device = (i % D) + 1; });
      slot += Math.ceil(round.length / D);
    }
  }
  return t;
}

function slotCount(t) { return Math.max(...t.matches.map(m => m.slot)) + 1; }

function fmtTime(startTime, addMinutes) {
  const [h, mi] = (startTime || '10:00').split(':').map(Number);
  let tot = (h * 60 + mi + addMinutes) % (24 * 60);
  const hh = Math.floor(tot / 60), mm = tot % 60;
  const ap = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return h12 + ':' + String(mm).padStart(2, '0') + ' ' + ap;
}
function slotTime(t, slot) { return fmtTime(t.startTime, slot * t.duration); }
function deviceLabel(t, n) { return GAMES[t.game].deviceType + ' ' + n; }

/* Scheduling problems (two matches on one device in one slot, over capacity) */
function scheduleConflicts(t) {
  const seen = {}, bad = new Set();
  t.matches.forEach(m => {
    const k = m.slot + ':' + m.device;
    if (seen[k]) { bad.add(m.id); bad.add(seen[k]); } else seen[k] = m.id;
    if (m.device > t.devices) bad.add(m.id);
  });
  return bad;
}

function standings(t) {
  const fin = t.matches.find(m => m.kind === 'main' && m.round === Math.log2(t.size) - 1);
  const th = byId(t, 'T');
  return {
    first: fin.status === 'done' ? fin.winner : null,
    second: fin.status === 'done' ? fin.loser : null,
    third: th.status === 'done' ? th.winner : null,
    fourth: th.status === 'done' ? th.loser : null
  };
}

function tournamentStatus(t) {
  if (!t.started) return 'setup';
  const s = standings(t);
  return (s.first && s.third) ? 'completed' : 'live';
}

function describeSource(t, src) {
  if (src.seed !== undefined) return 'TBD';
  const m = byId(t, src.m);
  return (src.t === 'w' ? 'Winner' : 'Loser') + ' of Match ' + m.num;
}

function displayName(t, id, fallbackSrc) {
  const e = entrant(t, id);
  if (e) return e.name || ('Entry ' + (t.entrants.indexOf(e) + 1));
  return fallbackSrc ? describeSource(t, fallbackSrc) : 'TBD';
}

function missingNames(t) {
  const out = [];
  t.entrants.forEach((e, i) => {
    if (!e.name.trim()) out.push(i + 1);
    else if (t.format === '2v2' && (!e.players[0].trim() || !e.players[1].trim())) out.push(i + 1);
  });
  return out;
}

function duplicateNames(t) {
  const seen = {}, dups = new Set();
  t.entrants.forEach(e => { const k = e.name.trim().toLowerCase(); if (!k) return; if (seen[k]) dups.add(k); seen[k] = 1; });
  return dups;
}

function shuffleEntrants(t) {
  const a = t.entrants.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  t.entrants = a;
  t.matches.forEach(m => { if (m.status !== 'upcoming') clearResult(m); });
  resolve(t);
}

/* Change structural settings before the tournament starts, keeping entered names where possible. */
function rebuild(t, opts) {
  const old = t.entrants;
  t.size = opts.size; t.format = opts.format; t.devices = opts.devices;
  t.entrants = blankEntrants(t.size, t.format);
  old.slice(0, t.size).forEach((e, i) => {
    t.entrants[i].name = e.name;
    if (t.format === '2v2') t.entrants[i].players = [e.players[0] || '', e.players[1] || ''];
  });
  t.matches = buildMatches(t.size);
  numberMatches(t); buildSchedule(t); resolve(t);
  return t;
}

const SAMPLE_1V1 = ['Ahmed', 'Omar', 'Mohamed', 'Karim', 'Youssef', 'Peter', 'Adam', 'Mark', 'John', 'Ali', 'Hassan', 'Mostafa', 'Khaled', 'Tarek', 'Mina', 'Kyrillos',
  'Samir', 'Fady', 'Bishoy', 'Nour', 'Ziad', 'Hady', 'Marwan', 'Sherif', 'Ramy', 'Amr', 'Wael', 'Moaz', 'George', 'Beshoy', 'Hesham', 'Yassin',
  'Seif', 'Anthony', 'Abanoub', 'Zeyad', 'Malak', 'Joseph', 'Eyad', 'Rafik', 'Kareem', 'Mahmoud', 'Basem', 'Daniel', 'Ehab', 'Fares', 'Gerges', 'Hazem',
  'Ibrahim', 'Jirjis', 'Lotfy', 'Medhat', 'Nabil', 'Osama', 'Philo', 'Qais', 'Rami', 'Sameh', 'Tony', 'Usama', 'Victor', 'Wagdy', 'Yehia', 'Zakaria'];
const SAMPLE_TEAMS = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Phoenix', 'Falcons', 'Titans', 'Vipers', 'Wolves', 'Raptors', 'Spartans', 'Storm', 'Ninjas', 'Legends', 'Rebels', 'Comets'];

function fillSample(t) {
  t.entrants.forEach((e, i) => {
    if (t.format === '1v1') e.name = SAMPLE_1V1[i % SAMPLE_1V1.length];
    else {
      e.name = 'Team ' + (SAMPLE_TEAMS[i % SAMPLE_TEAMS.length]) + (i >= SAMPLE_TEAMS.length ? ' ' + (Math.floor(i / SAMPLE_TEAMS.length) + 1) : '');
      e.players = [SAMPLE_1V1[(2 * i) % SAMPLE_1V1.length], SAMPLE_1V1[(2 * i + 1) % SAMPLE_1V1.length]];
    }
  });
  resolve(t);
}

/* Parse pasted lines. 1v1: one name per line. 2v2: "Team: A, B" or "A, B" */
function applyPaste(t, text) {
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  lines.slice(0, t.size).forEach((ln, i) => {
    const e = t.entrants[i];
    if (t.format === '1v1') { e.name = ln.replace(/^\d+[\).\-\s]+/, ''); return; }
    let team = '', rest = ln;
    const ci = ln.indexOf(':');
    if (ci > -1) { team = ln.slice(0, ci).trim(); rest = ln.slice(ci + 1); }
    const parts = rest.split(/[,،&+\/|]| - /).map(s => s.trim()).filter(Boolean);
    e.name = team || ('Team ' + (i + 1));
    e.players = [parts[0] || '', parts[1] || ''];
  });
  resolve(t);
  return Math.min(lines.length, t.size);
}

/* Demo helper: random scores for the matches that are ready right now (one wave) */
function randomRound(t, rng) {
  rng = rng || Math.random;
  const wave = orderMatches(t).filter(m => m.status !== 'done' && matchReady(m)).map(m => m.id);
  wave.forEach(id => {
    let a = Math.floor(rng() * 5), b = Math.floor(rng() * 5);
    if (a === b) a++;
    saveResult(t, id, a, b);
  });
  return wave.length;
}

if (typeof module !== 'undefined') module.exports = { autoStart, SIZES, GAMES, roundName, newTournament, buildMatches, buildSchedule, resolve, saveResult, resolveTie, reopenMatch, startMatch, impactOf, standings, tournamentStatus, scheduleConflicts, slotCount, slotTime, fillSample, applyPaste, randomRound, rebuild, byId, orderMatches, matchReady, missingNames, shuffleEntrants, fmtTime, entrant, displayName };
