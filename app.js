/* ===================== APP ===================== */
const $ = (s, r) => (r || document).querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const G = id => GAMES[id];

const S = {
  ts: {}, ready: false, sync: 'connecting', canWrite: true, storeMode: 'cloud',
  mode: 'home', agame: 'fc27', atab: 'participants', pgame: null,
  scene: null, pinned: false, auto: true, sceneAt: Date.now(), lastScene: null,
  modal: null, editing: {}, showWaiting: false, fxRound: 'all', fxStatus: 'all', brSide: 'L',
  form: { game: 'fc27', size: 16, format: '1v1', devices: 4, start: '10:00', dur: 30 },
  sform: null, drafts: {}, pasteText: ''
};
try { const m = sessionStorage.getItem('e7s-mode'); if (m === 'admin' || m === 'public') S.mode = m; } catch (e) {}
if (/public/i.test(location.hash)) S.mode = 'public'; else if (/admin/i.test(location.hash)) S.mode = 'admin';

/* ---------- storage: shared cloud db (realtime) with local fallback ---------- */
const store = { save: async () => {}, remove: async () => {} };
let pending = 0, saveQ = Promise.resolve();
const tomb = {};

async function initStore() {
  async function api(method, id, body) {
    const r = await fetch('/api/db' + (id ? '?id=' + id : ''), { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error('Server error ' + r.status);
    return r.json();
  }
  store.save = (id, data) => api('POST', id, data);
  store.remove = id => api('DELETE', id);
  const sig = x => Object.keys(x).sort().map(k => k + ':' + x[k].updatedAt).join();
  const pull = async () => {
    try {
      const v = await api('GET');
      const o = {};
      Object.keys(v).forEach(k => { const cur = S.ts[k]; o[k] = (pending > 0 && cur && (cur.updatedAt || 0) > (v[k].updatedAt || 0)) ? cur : v[k]; });
      if (pending > 0) Object.keys(S.ts).forEach(k => { if (!o[k] && S.ts[k]) o[k] = S.ts[k]; });
      Object.keys(tomb).forEach(k => { delete o[k]; });
      const changed = sig(o) !== sig(S.ts) || !S.ready || S.sync !== 'live';
      S.ts = o; S.ready = true; S.sync = 'live'; S.storeMode = 'cloud';
      if (changed) schedule();
    } catch (e) {
      if (S.sync !== 'error' || !S.ready) { S.sync = 'error'; S.ready = true; schedule(); }
    }
  };
  /* poll gently to stay inside the free database quota: public screen 3s, admin 10s, paused while the tab is hidden */
  const loop = async () => {
    if (!document.hidden) await pull();
    setTimeout(loop, S.mode === 'public' ? 3000 : 10000);
  };
  await pull();
  setTimeout(loop, 3000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
}

function commit(t) {
  t.updatedAt = Date.now();
  S.ts[t.id] = t;
  pending++;
  const copy = clone(t);
  saveQ = saveQ.then(() => store.save(t.id, copy)).catch(e => { S.sync = 'error'; toast('Could not save: ' + ((e && (e.message || e.code)) || 'unknown error')); })
    .then(() => { pending--; });
  schedule();
}
function mutate(id, fn) {
  const cur = S.ts[id]; if (!cur) return false;
  const t = clone(cur);
  const r = fn(t);
  if (r === false) return false;
  commit(t); return r === undefined ? true : r;
}
function removeT(id) {
  delete S.ts[id]; pending++; tomb[id] = 1;
  saveQ = saveQ.then(() => store.remove(id)).catch(() => {}).then(() => { pending--; delete tomb[id]; });
  schedule();
}

/* ---------- helpers ---------- */
function toast(msg) {
  let c = $('.toasts'); if (!c) { c = document.createElement('div'); c.className = 'toasts'; document.body.appendChild(c); }
  const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg; c.appendChild(d);
  setTimeout(() => { d.remove(); }, 3800);
}
function confirmBox(title, msg, okLabel, danger) {
  return new Promise(res => { S.modal = { type: 'confirm', title, msg, okLabel: okLabel || 'Confirm', danger, res }; schedule(); });
}
function nm(t, id, src, short) {
  const e = entrant(t, id);
  if (e) return e.name || ('Entry ' + (t.entrants.indexOf(e) + 1));
  if (!src) return 'TBD';
  if (src.seed !== undefined) return 'TBD';
  const m = byId(t, src.m);
  return short ? ((src.t === 'w' ? 'W' : 'L') + ' · M' + m.num) : ((src.t === 'w' ? 'Winner' : 'Loser') + ' of Match ' + m.num);
}
function plyr(t, id) { const e = entrant(t, id); return e && t.format === '2v2' ? e.players.filter(Boolean).join(' · ') : ''; }
function mRound(t, m) { return m.kind === 'third' ? 'Third Place Match' : roundName(t.size, m.round); }
function mStatus(m) { return m.status === 'done' ? 'done' : (m.status === 'live' ? 'live' : 'up'); }
function statusLabel(m, ready) { return m.status === 'done' ? 'Completed' : m.tie ? 'Draw' : m.status === 'live' ? 'Live' : ready ? 'Upcoming' : 'Waiting'; }
function nextOf(t, m) {
  const x = t.matches.find(o => (o.srcA.m === m.id && o.srcA.t === 'w' && m.kind === 'main') || (o.srcB.m === m.id && o.srcB.t === 'w' && m.kind === 'main'));
  const y = t.matches.find(o => (o.srcA.m === m.id && o.srcA.t === 'l') || (o.srcB.m === m.id && o.srcB.t === 'l'));
  return { win: x, lose: y };
}
function progressOf(t) { const d = t.matches.filter(m => m.status === 'done').length; return { d, n: t.matches.length }; }
function anyT() { return Object.values(S.ts); }
function tstatus(t) { return t ? tournamentStatus(t) : null; }
function curGame() { return S.pgame || autoGame(); }
function autoGame() {
  const l = ['fc27', 'lol'].find(g => S.ts[g] && tstatus(S.ts[g]) === 'live');
  if (l) return l;
  const e = ['fc27', 'lol'].filter(g => S.ts[g]);
  return e.length ? e[0] : 'fc27';
}
function metaChips(t) {
  const g = G(t.game);
  return `<span class="chip">${t.size} ${t.format === '2v2' ? 'teams' : 'players'}</span><span class="chip">${t.format === '2v2' ? '2 vs 2' : '1 vs 1'}</span><span class="chip">${t.devices} ${g.deviceName}${t.devices > 1 ? 's' : ''}</span><span class="chip">Starts ${fmtTime(t.startTime, 0)}</span><span class="chip">${t.duration} min / match</span>`;
}

/* ---------- render scheduling ---------- */
let rafId = 0;
function schedule() { if (rafId) return; rafId = requestAnimationFrame(() => { rafId = 0; render(); }); }

/* ===================== BRACKET RENDERER ===================== */
function bracketHTML(t, o) {
  const R = Math.log2(t.size), cols = R - 1, W = o.W, H = o.H, Y0 = o.Y0 == null ? 46 : o.Y0, g = o.g || 34;
  const half = o.mode === 'half', centerW = o.centerW || 340;
  const sides = half ? [o.side] : ['L', 'R'];
  let cw = half ? (W - centerW) / cols - g : (W - centerW) / (2 * cols) - g;
  cw = Math.min(cw, o.maxCw || 330);
  const total = (half ? 1 : 2) * cols * (cw + g) + centerW;
  const ox = (W - total) / 2;
  const n0 = t.size / 4;
  const ch = Math.max(30, Math.min(o.maxCh || 96, Math.floor(H / n0) - 8));
  const bf = Math.max(13, Math.min(o.maxFont || 26, Math.floor(ch / 2 * 0.64)));
  const colX = (side, r) => {
    if (half || side === 'L') return ox + r * (cw + g);
    return ox + total - cw - r * (cw + g);
  };
  const centerX = ox + cols * (cw + g);
  const cur = t.matches.filter(m => m.status !== 'done').reduce((a, m) => Math.min(a, m.round), 99);
  let out = `<div class="br" style="width:${W}px;height:${H + Y0}px;--bf:${bf}px;--bhf:${o.hf || 22}px">`;
  let lines = '', cards = '', heads = '';
  const yOf = (r, j) => { const nHalf = t.size / Math.pow(2, r + 2); return Y0 + (j + 0.5) * H / nHalf; };
  const card = (m, x, y, w, h, extra) => {
    const ready = matchReady(m);
    const st = m.status === 'done' ? 'done' : m.status === 'live' ? 'live' : 'up';
    const row = which => {
      const id = m[which], src = which === 'a' ? m.srcA : m.srcB, sc = which === 'a' ? m.sa : m.sb;
      const e = entrant(t, id);
      const w = m.status === 'done' && m.winner === id, l = m.status === 'done' && m.winner && m.winner !== id;
      const tag = (extra && extra.tags && m.status === 'done') ? (w ? '<span class="tag">3RD</span>' : '<span class="tag l">4TH</span>') : '';
      return `<div class="bs ${e ? '' : 't'} ${w ? 'w' : ''} ${l ? 'l' : ''}"><span class="nm" dir="auto">${tag}${esc(nm(t, id, src, true))}</span>${sc != null ? `<b>${sc}</b>` : ''}</div>`;
    };
    const act = o.click ? ` data-act="openMatch" data-id="${m.id}"` : '';
    return `<div class="bm st-${st} ${extra && extra.cls || ''}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"${act}>${extra && extra.label ? `<div class="bl">${extra.label}</div>` : ''}${row('a')}${row('b')}<span class="bn">M${m.num}</span></div>`;
  };
  sides.forEach(side => {
    for (let r = 0; r < cols; r++) {
      const nTot = t.size / Math.pow(2, r + 1), nHalf = nTot / 2, x = colX(side, r);
      heads += `<div class="bh ${r === cur ? 'cur' : ''}" style="left:${x}px;top:0;width:${cw}px">${esc(roundName(t.size, r))}</div>`;
      for (let j = 0; j < nHalf; j++) {
        const idx = (side === 'R' ? nHalf : 0) + j, m = byId(t, 'R' + r + 'M' + idx), yc = yOf(r, j);
        cards += card(m, x, yc - ch / 2, cw, ch);
        if (r > 0) {
          const xs = colX(side, r - 1);
          [2 * j, 2 * j + 1].forEach(cj => {
            const cm = byId(t, 'R' + (r - 1) + 'M' + ((side === 'R' ? nHalf * 2 : 0) + cj));
            const y1 = yOf(r - 1, cj);
            const mirrored = !half && side === 'R';
            const x1 = mirrored ? xs : xs + cw, x2 = mirrored ? x + cw : x, xm = (x1 + x2) / 2;
            lines += `<path class="${cm.status === 'done' ? 'on' : ''}" d="M${x1},${y1} H${xm} V${yc} H${x2}"/>`;
          });
        }
      }
    }
  });
  // final column
  const fh = Math.min(150, H * 0.2), fy = Y0 + H / 2, fm = byId(t, 'R' + (R - 1) + 'M0'), tm = byId(t, 'T');
  const fw = centerW;
  heads += `<div class="bh ${cur === R - 1 ? 'cur' : ''}" style="left:${centerX}px;top:0;width:${fw}px">Final</div>`;
  const sfLeft = byId(t, 'R' + (R - 2) + 'M0'), sfRight = byId(t, 'R' + (R - 2) + 'M1');
  const xl = centerX - g;
  lines += `<path class="${sfLeft.status === 'done' ? 'on' : ''}" d="M${xl},${fy} H${centerX}"/>`;
  if (!half) lines += `<path class="${sfRight.status === 'done' ? 'on' : ''}" d="M${centerX + fw + g},${fy} H${centerX + fw}"/>`;
  cards += card(fm, centerX, fy - fh / 2, fw, fh, { cls: 'big', label: 'Grand Final' });
  const st = standings(t);
  const champName = st.first ? nm(t, st.first) : null;
  cards += `<div class="bchamp" style="left:${centerX}px;width:${fw}px;top:${fy - fh / 2 - 190}px;height:180px"><div class="tr">🏆</div><div class="cl">CHAMPION</div><div class="cn ${champName ? '' : 'tbd'}" dir="auto">${champName ? esc(champName) : 'TO BE DECIDED'}</div></div>`;
  const ty = fy + fh / 2 + 54, th = Math.min(120, H * 0.17);
  cards += `<div class="bsub" style="left:${centerX}px;width:${fw}px;top:${ty - 28}px">Playing for 3rd place</div>`;
  cards += card(tm, centerX, ty, fw, th, { cls: 'big third', label: 'Third Place', tags: true });
  out += heads + `<svg width="${W}" height="${H + Y0}">${lines}</svg>` + cards + '</div>';
  return out;
}

/* ===================== PUBLIC DISPLAY ===================== */
const SCENE_DUR = { now: 15, bracket: 20, bracketL: 14, bracketR: 14, fixtures: 15, champion: 22 };
function scenesFor(t) {
  if (!t) return ['splash'];
  const s = tstatus(t);
  const br = t.size >= 32 ? ['bracketL', 'bracketR'] : ['bracket'];
  if (s === 'setup') return ['now', ...br];
  if (s === 'completed') return ['champion', ...br, 'fixtures'];
  return ['now', ...br, 'fixtures'];
}
const SCENE_NAME = { now: 'Live', bracket: 'Bracket', bracketL: 'Bracket · Upper', bracketR: 'Bracket · Lower', fixtures: 'Fixtures', champion: 'Champion', splash: '' };

function pmCard(t, m, size, opt) {
  opt = opt || {};
  const ready = matchReady(m), st = mStatus(m);
  const side = which => {
    const id = m[which], src = which === 'a' ? m.srcA : m.srcB, sc = which === 'a' ? m.sa : m.sb;
    const e = entrant(t, id), w = m.status === 'done' && m.winner === id, l = m.status === 'done' && m.winner && m.winner !== id;
    const p = plyr(t, id);
    return `<div class="ps-s ${e ? '' : 'tbd'} ${w ? 'w' : ''} ${l ? 'l' : ''}"><div class="nmw"><span class="nm" dir="auto">${w ? '<span class="wb">👑 </span>' : ''}${esc(nm(t, id, src))}</span>${p ? `<span class="pl" dir="auto">${esc(p)}</span>` : ''}</div>${sc != null ? `<div class="sc">${sc}</div>` : (m.status === 'live' ? '<div class="sc" style="color:var(--dim);font-size:.6em">–</div>' : '')}</div>`;
  };
  const lab = m.status === 'done' ? 'Completed' : m.tie ? 'Draw · decider' : m.status === 'live' ? '● Live' : ready ? 'Up next' : 'Waiting';
  return `<div class="pm ${size} ${st}"><div class="pm-h"><span>#${m.num}</span><span>${esc(mRound(t, m))}</span><span class="sp"></span><span class="pd">${deviceLabel(t, m.device)}</span><span class="pt">${slotTime(t, m.slot)}</span><span class="ps">${lab}</span></div>${side('a')}${side('b')}</div>`;
}

function sortedBySlot(arr) { return arr.slice().sort((a, b) => a.slot - b.slot || a.device - b.device); }

function sceneNow(t) {
  const s = tstatus(t);
  if (s === 'setup') {
    const cnt = t.entrants.length, cols = cnt > 32 ? 4 : cnt > 16 ? 3 : cnt > 8 ? 2 : 1;
    const fs = cnt > 32 ? 22 : cnt > 16 ? 26 : 30;
    const first = sortedBySlot(t.matches.filter(m => m.slot === 0));
    const wall = t.entrants.map((e, i) => `<div class="wn" style="font-size:${fs}px"><small>${i + 1}</small><span dir="auto">${esc(e.name || '—')}</span>${t.format === '2v2' && e.players.some(Boolean) ? `<span class="pl" dir="auto">${esc(e.players.filter(Boolean).join(' · '))}</span>` : ''}</div>`).join('');
    return `<div class="pcols"><div class="pcol"><div class="ptitle">${t.format === '2v2' ? 'Teams' : 'Players'} <small>${cnt} competing</small></div><div class="wall" style="grid-template-columns:repeat(${cols},1fr);grid-auto-rows:min-content">${wall}</div></div>
    <div class="pcol"><div class="ptitle">Kick-off</div><div class="kick" style="margin:6px 0 26px">${fmtTime(t.startTime, 0)}<small>${t.size} ${t.format === '2v2' ? 'TEAMS' : 'PLAYERS'} · ${t.format === '2v2' ? '2V2' : '1V1'}</small></div>
    <div class="ptitle" style="font-size:32px;margin-bottom:14px">Opening fixtures</div>${first.slice(0, 7).map(m => `<div class="lrow"><span class="tm">${slotTime(t, m.slot)}</span><span class="dv">${deviceLabel(t, m.device)}</span><span class="tx" dir="auto">${esc(nm(t, m.a, m.srcA))}<span class="vs">VS</span>${esc(nm(t, m.b, m.srcB))}</span></div>`).join('')}${first.length > 7 ? `<div class="more">+ ${first.length - 7} more opening matches</div>` : ''}</div></div>`;
  }
  const live = sortedBySlot(t.matches.filter(m => m.status === 'live'));
  const waiting = t.matches.filter(m => m.status === 'upcoming');
  const minSlot = waiting.length ? Math.min(...waiting.map(m => m.slot)) : null;
  let next = minSlot == null ? [] : sortedBySlot(waiting.filter(m => m.slot === minSlot));
  const nextAfterLive = next;
  const done = t.matches.filter(m => m.status === 'done').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const sizeFor = n => n <= 2 ? 'xl' : n <= 4 ? 'lg' : n <= 8 ? 'md' : 'sm';
  const gclass = n => n <= 1 ? 'g1' : n <= 2 ? 'g1' : n <= 4 ? 'g2' : n <= 8 ? 'g8' : 'g16';
  let left;
  if (live.length) {
    left = `<div class="ptitle">On the ${G(t.game).deviceName === 'PC' ? 'PCs' : 'consoles'} now <small>${live.length} live</small></div><div class="lgrid ${gclass(live.length)}">${live.map(m => pmCard(t, m, sizeFor(live.length))).join('')}</div>`;
  } else if (next.length) {
    const ready = next.filter(matchReady);
    const showing = (ready.length ? ready : next).slice(0, 16);
    left = `<div class="ptitle">Up next <small>${slotTime(t, minSlot)}</small></div><div class="lgrid ${gclass(showing.length)}">${showing.map(m => pmCard(t, m, sizeFor(showing.length))).join('')}</div>`;
    next = [];
  } else {
    left = `<div class="ptitle">Tournament</div><div class="empty">All matches complete</div>`;
  }
  const upList = next.length ? next : (live.length ? [] : []);
  const nextRows = upList.slice(0, 6).map(m => `<div class="lrow"><span class="tm">${slotTime(t, m.slot)}</span><span class="dv">${deviceLabel(t, m.device)}</span><span class="tx" dir="auto">${matchReady(m) ? esc(nm(t, m.a)) + '<span class="vs">VS</span>' + esc(nm(t, m.b)) : '<i>' + esc(nm(t, m.a, m.srcA, true)) + '</i><span class="vs">VS</span><i>' + esc(nm(t, m.b, m.srcB, true)) + '</i>'}</span></div>`).join('');
  const upHtml = upList.length ? `<div class="ptitle" style="font-size:34px;margin-bottom:12px">Up next <small style="font-size:20px">${slotTime(t, minSlot)}</small></div>${nextRows}${upList.length > 6 ? `<div class="more">+ ${upList.length - 6} more</div>` : ''}` : '';
  const resN = upHtml ? 4 : 8;
  const resRows = done.slice(0, resN).map(m => {
    const w = entrant(t, m.winner), l = entrant(t, m.loser);
    const nx = nextOf(t, m);
    const adv = m.kind === 'third' ? '🥉 3rd place' : (nx.win ? '▸ ' + roundName(t.size, nx.win.round) : '🏆 Champion');
    const aW = m.winner === m.a;
    return `<div class="rrow"><span class="mn">M${m.num}</span><span class="tx" dir="auto"><b>${esc(w ? w.name : '')}</b> <span class="scr">${aW ? m.sa : m.sb}–${aW ? m.sb : m.sa}</span> <s>${esc(l ? l.name : '')}</s></span><span class="ad">${adv}</span></div>`;
  }).join('');
  const resHtml = `<div class="ptitle" style="font-size:34px;margin:${upHtml ? '26px' : '0'} 0 12px">Latest results</div>${resRows || '<div class="more">No results yet — first matches are underway.</div>'}`;
  return `<div class="pcols"><div class="pcol">${left}</div><div class="pcol">${upHtml}${resHtml}</div></div>`;
}

function sceneBracket(t, side) {
  const half = t.size >= 32;
  const H = t.size === 64 ? 800 : t.size === 32 ? 790 : 770;
  const html = bracketHTML(t, { W: 1808, H, mode: half ? 'half' : 'full', side: side || 'L', centerW: 360, g: 34, maxCh: 96, maxFont: 28, hf: t.size === 64 ? 19 : 22, maxCw: 350 });
  return `<div style="position:absolute;left:0;top:0">${html}</div>`;
}

function sceneFixtures(t) {
  const rounds = [...new Set(t.matches.map(m => m.round))].sort((a, b) => a - b);
  let cur = rounds.find(r => t.matches.some(m => m.round === r && m.status !== 'done'));
  if (cur == null) cur = rounds[rounds.length - 1];
  const groups = [];
  let used = 0;
  for (const r of rounds.filter(x => x >= cur)) {
    const ms = orderMatches(t).filter(m => m.round === r);
    if (groups.length && used + ms.length + 1 > 22) break;
    groups.push({ r, ms }); used += ms.length + 1;
  }
  if (groups.length === 1 && groups[0].r > 0 && groups[0].ms.length <= 4) { // final round alone: show semis played just before
    const prev = orderMatches(t).filter(m => m.round === groups[0].r - 1);
    groups.unshift({ r: groups[0].r - 1, ms: prev }); used += prev.length + 1;
  }
  const items = [];
  groups.forEach(g => { items.push({ h: g.r }); g.ms.forEach(m => items.push({ m })); });
  const n = items.length;
  const colsN = n <= 12 ? 1 : n <= 24 ? 2 : 3;
  const perCol = Math.ceil(n / colsN);
  const rowH = Math.min(84, Math.floor((866 - 80 - (perCol - 1) * 8) / perCol));
  const fs = Math.max(15, Math.min(28, Math.floor(rowH * 0.36) + (colsN === 1 ? 2 : 0)));
  const rows = items.map(it => {
    if (it.h !== undefined) return `<div class="fh" style="height:${rowH}px">${esc(roundName(t.size, it.h))}${it.h === Math.log2(t.size) - 1 ? ' · Final & Third Place' : ''}</div>`;
    const m = it.m;
    const aW = m.status === 'done' && m.winner === m.a, bW = m.status === 'done' && m.winner === m.b;
    return `<div class="frow ${mStatus(m)}" style="height:${rowH}px"><span class="mn">#${m.num}</span><span class="tm">${slotTime(t, m.slot)}</span><span class="dv">${deviceLabel(t, m.device)}</span>
    <span class="a ${aW ? 'w' : bW ? 'l' : ''} ${m.a ? '' : 't'}" dir="auto">${esc(nm(t, m.a, m.srcA, true))}</span>
    <span class="sc ${m.sa == null ? 'up' : ''}">${m.sa != null ? m.sa + ' – ' + m.sb : (m.status === 'live' ? '● LIVE' : 'VS')}</span>
    <span class="b ${bW ? 'w' : aW ? 'l' : ''} ${m.b ? '' : 't'}" dir="auto">${esc(nm(t, m.b, m.srcB, true))}</span></div>`;
  }).join('');
  const dn = t.matches.filter(m => m.status === 'done').length;
  return `<div class="ptitle">Fixtures <small>${dn}/${t.matches.length} played</small></div><div class="fx" style="margin-top:20px;--ffs:${fs}px;grid-template-columns:repeat(${colsN},1fr);grid-template-rows:repeat(${perCol},${rowH}px)">${rows}</div>`;
}

function sceneChampion(t) {
  const st = standings(t);
  const cn = nm(t, st.first), cp = plyr(t, st.first);
  let cf = '';
  const cols = ['#ffcd00', '#00aae8', '#ffffff', '#ff3d5a', '#2cf08a'];
  for (let i = 0; i < 46; i++) cf += `<i class="cf" style="left:${(i * 41) % 1900}px;background:${cols[i % 5]};animation-duration:${4 + (i % 7) * 0.7}s;animation-delay:${-(i % 11) * 0.6}s"></i>`;
  const pod = (k, cls, id, medal) => `<div class="${cls}"><div class="pk">${medal} ${k}</div><div class="pn" dir="auto">${esc(nm(t, id))}</div>${plyr(t, id) ? `<div class="pp" dir="auto">${esc(plyr(t, id))}</div>` : ''}</div>`;
  return `<div class="champ">${cf}<div class="tr">🏆</div><div class="cl">CHAMPION</div><div class="cn" dir="auto">${esc(cn)}</div>${cp ? `<div class="cp" dir="auto">${esc(cp)}</div>` : ''}
  <div class="pod4">${pod('2ND PLACE', 's2', st.second, '🥈')}${pod('3RD PLACE', 's3', st.third, '🥉')}${pod('4TH PLACE', 's4', st.fourth, '')}</div></div>`;
}

function renderPublic() {
  const gm = curGame();
  const t = S.ts[gm];
  const gdef = G(gm);
  const scenes = scenesFor(t);
  if (!S.scene || !scenes.includes(S.scene)) { S.scene = scenes[0]; S.sceneAt = Date.now(); }
  const changed = S.lastScene !== gm + ':' + S.scene;
  S.lastScene = gm + ':' + S.scene;
  const stt = t ? tstatus(t) : null;
  const tabs = ['fc27', 'lol'].map(g => `<button class="pgt ${g === gm ? 'on' : ''} ${S.ts[g] ? '' : 'off'}" data-act="pgame" data-id="${g}" data-game="${g}"><span>${G(g).icon}</span>${esc(G(g).name)}</button>`).join('');
  let body = '';
  if (!t) {
    body = `<div class="splash"><div class="logo"></div><h2>Tournament coming soon</h2><p>${esc(gdef.name)} bracket will appear here</p></div>`;
  } else if (S.scene === 'now') body = sceneNow(t);
  else if (S.scene === 'bracket') body = sceneBracket(t);
  else if (S.scene === 'bracketL') body = sceneBracket(t, 'L');
  else if (S.scene === 'bracketR') body = sceneBracket(t, 'R');
  else if (S.scene === 'fixtures') body = sceneFixtures(t);
  else if (S.scene === 'champion') body = sceneChampion(t);
  const pills = scenes.filter(s => s !== 'splash').map(s => `<button class="pill ${s === S.scene ? 'on' : ''}" data-act="pscene" data-id="${s}">${SCENE_NAME[s]}<span class="pg" data-pg="${s}"></span></button>`).join('');
  const sLab = stt === 'live' ? '<span class="dot"></span>&nbsp;LIVE' : stt === 'completed' ? '🏆 COMPLETE' : 'STARTING SOON';
  const sub = t ? `${t.size} ${t.format === '2v2' ? 'teams' : 'players'} · ${t.format === '2v2' ? '2 vs 2' : '1 vs 1'} · single elimination` : 'No tournament yet';
  $('#app').innerHTML = `<div class="pwrap ${S.idle ? 'idle' : ''}" data-game="${gm}"><div class="stage" id="stage">
    <div class="ph"><div class="logo"></div><div class="gt">${tabs}</div><div class="meta"><div class="l1">${t ? `<span class="status ${stt}"><span>${sLab}</span></span>` : ''}<span class="clock" id="clock">${clockStr()}</span></div><small>${esc(sub)}</small></div></div>
    <div class="pmain"><div class="scene ${changed ? 'enter' : ''}">${body}</div></div>
    <div class="pf"><div class="ctl" style="display:flex;gap:10px">${pills}</div><div class="sp"></div><span class="hint ctl">${S.pinned ? 'PINNED' : S.auto ? 'AUTO' : 'PAUSED'} · space = pause · F = fullscreen</span>
    <button class="pill ctl" data-act="ptoggle">${S.auto && !S.pinned ? '⏸' : '▶'}</button><button class="pill ctl" data-act="fullscreen">⛶</button><button class="pill ctl" data-act="home">✕</button></div>
  </div></div>`;
  fitStage();
}
function clockStr() { const d = new Date(); return fmtTime(String(d.getHours()) + ':' + String(d.getMinutes()), 0); }
function fitStage() {
  const st = $('#stage'); if (!st) return;
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  st.style.transform = `scale(${s})`;
  st.style.left = Math.max(0, (innerWidth - 1920 * s) / 2) + 'px';
  st.style.top = Math.max(0, (innerHeight - 1080 * s) / 2) + 'px';
}
window.addEventListener('resize', fitStage);

/* rotate scenes + live clock */
setInterval(() => {
  if (S.mode !== 'public') return;
  const c = $('#clock'); if (c) c.textContent = clockStr();
  const gm = curGame(), t = S.ts[gm], scenes = scenesFor(t);
  const dur = (SCENE_DUR[S.scene] || 15) * 1000, el = Date.now() - S.sceneAt;
  const bar = $('[data-pg="' + S.scene + '"]'); if (bar) bar.style.width = (S.auto && !S.pinned ? Math.min(100, el / dur * 100) : 0) + '%';
  if (S.auto && !S.pinned && scenes.length > 1 && el >= dur) {
    S.scene = scenes[(scenes.indexOf(S.scene) + 1) % scenes.length]; S.sceneAt = Date.now(); schedule();
  }
  if (S.idle !== (Date.now() - lastMove > 4000)) { S.idle = Date.now() - lastMove > 4000; const w = $('.pwrap'); if (w) w.classList.toggle('idle', S.idle); }
}, 500);
let lastMove = Date.now();
window.addEventListener('mousemove', () => { lastMove = Date.now(); if (S.idle) { S.idle = false; const w = $('.pwrap'); if (w) w.classList.remove('idle'); } });
window.addEventListener('keydown', e => {
  if (S.mode !== 'public') return;
  if (e.key === ' ') { e.preventDefault(); ACT.ptoggle(); }
  else if (e.key.toLowerCase() === 'f') ACT.fullscreen();
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const gm = curGame(), sc = scenesFor(S.ts[gm]); const i = sc.indexOf(S.scene);
    S.scene = sc[(i + (e.key === 'ArrowRight' ? 1 : sc.length - 1)) % sc.length]; S.sceneAt = Date.now(); schedule();
  }
});

/* ===================== ADMIN ===================== */
function renderHome() {
  const tc = anyT().map(t => `<span class="chip ${tstatus(t) === 'live' ? 'live' : tstatus(t) === 'completed' ? 'y' : 'b'}">${G(t.game).icon} ${G(t.game).short} · ${tstatus(t) === 'setup' ? 'Not started' : tstatus(t) === 'live' ? 'Live' : 'Completed'}</span>`).join('');
  const syncTxt = S.storeMode === 'local' ? 'Local mode — changes stay in this browser only (open the shared page signed in to sync across screens).' : S.sync === 'live' ? 'Realtime sync connected' : S.sync === 'error' ? 'Sync problem — check your connection' : 'Connecting…';
  $('#app').innerHTML = `<div class="home"><div class="logo"></div><h1>Tournament <em>Manager</em></h1>
  <div class="choices"><button class="choice a" data-act="goAdmin"><b>Admin</b><span>Create tournaments, enter names, schedule matches and save scores.</span></button>
  <button class="choice p" data-act="goPublic"><b>Public Display</b><span>The big-screen view for the venue: live fixtures, bracket, results and champion.</span></button></div>
  <div class="tcards">${tc}</div><div class="sync">${esc(syncTxt)}</div></div>`;
}

function renderAdmin() {
  const g = S.agame, t = S.ts[g];
  const gtabs = ['fc27', 'lol'].map(x => {
    const tt = S.ts[x];
    return `<button class="gtab ${x === g ? 'on' : ''}" data-act="agame" data-id="${x}" data-game="${x}"><i class="${tt ? tstatus(tt) : ''}"></i>${G(x).icon} ${esc(G(x).name)}</button>`;
  }).join('');
  const syncCls = S.storeMode === 'local' ? 'local' : S.sync === 'error' ? 'err' : '';
  const syncTxt = S.storeMode === 'local' ? 'Local only' : S.sync === 'live' ? 'Realtime synced' : S.sync === 'error' ? 'Sync error' : 'Connecting…';
  const head = `<div class="topbar" data-game="${g}"><div class="logo" style="height:54px"></div><div class="ttl">Tournament Manager<small>ADMIN</small></div>
    <div class="gtabs">${gtabs}</div><div class="sync-pill ${syncCls}"><b></b>${syncTxt}</div>
    <button class="btn blue sm" data-act="goPublic">Public display ↗</button><button class="btn ghost sm" data-act="home">Menu</button></div>`;
  let banner = '';
  if (!S.canWrite) banner = `<div class="banner">You are viewing this page without edit permission — changes cannot be saved. Open it from the account that owns the page.</div>`;
  else if (S.storeMode === 'local') banner = `<div class="banner">Shared database not available (not signed in). Tournaments are stored in this browser only and will not appear on another screen.</div>`;
  const body = t ? adminTournament(t) : adminCreate(g);
  $('#app').innerHTML = `<div class="adm" data-game="${g}">${head}${banner}${body}</div>${modalHTML()}`;
}

function sel(id, opts, val, chg, key) {
  return `<select class="in" data-k="${key}" data-o="${val}" data-chg="${chg}" id="${id}">${opts.map(o => `<option value="${o[0]}" ${String(o[0]) === String(val) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
}
function formFields(f, prefix, chg, locked) {
  const g = G(f.game);
  const devOpts = g.deviceOptions.map(n => [n, n + ' ' + g.deviceName + (n > 1 ? 's' : '')]);
  return `<div class="form">
   ${prefix === 'cf' ? `<label class="f">Game${sel(prefix + '-game', [['fc27', '🎮 FC 27'], ['lol', '🖥️ League of Legends']], f.game, chg, prefix + 'game')}</label>` : ''}
   <label class="f">${f.format === '2v2' ? 'Teams' : 'Players'}${locked ? '' : ''}${sel(prefix + '-size', SIZES.map(n => [n, n + (f.format === '2v2' ? ' teams' : ' players')]), f.size, chg, prefix + 'size').replace('<select', locked ? '<select disabled' : '<select')}</label>
   <label class="f">Match format${sel(prefix + '-format', [['1v1', '1 vs 1'], ['2v2', '2 vs 2']], f.format, chg, prefix + 'format').replace('<select', locked ? '<select disabled' : '<select')}</label>
   <label class="f">Devices${sel(prefix + '-devices', devOpts, f.devices, chg, prefix + 'devices').replace('<select', locked ? '<select disabled' : '<select')}</label>
   <label class="f">Starting time<input class="in" type="time" id="${prefix}-start" value="${f.start}" data-chg="${chg}" data-k="${prefix}start" data-o="${f.start}"></label>
   <label class="f">Match duration (min)<input class="in" type="number" min="5" max="180" step="5" id="${prefix}-dur" value="${f.dur}" data-chg="${chg}" data-k="${prefix}dur" data-o="${f.dur}"></label></div>`;
}
function adminCreate(g) {
  if (S.form.game !== g) { const d = G(g); S.form = { ...S.form, game: g, devices: d.defaultDevices }; }
  const f = S.form, gd = G(f.game);
  return `<div class="panel" style="margin-top:28px"><h2>Create ${esc(gd.name)} tournament</h2>
    ${formFields(f, 'cf', 'cform', false)}
    <div class="row" style="margin-top:22px"><button class="btn pri" data-act="create">Create tournament</button>
    <button class="btn" data-act="demo">⚡ Quick demo (sample names)</button><span class="muted small">Single elimination + third-place match. Matches are scheduled across the available ${gd.deviceName}s automatically.</span></div></div>`;
}

function adminTournament(t) {
  const g = G(t.game), s = tstatus(t), pr = progressOf(t), st = standings(t);
  const tabs = [['participants', 'Participants'], ['schedule', 'Schedule'], ['fixtures', 'Fixtures'], ['bracket', 'Bracket'], ['results', 'Results'], ['settings', 'Settings']];
  const liveN = t.matches.filter(m => m.status === 'live').length;
  const stLab = s === 'setup' ? 'Not started' : s === 'live' ? 'Live' : 'Completed';
  let html = `<div class="panel"><div class="thead"><div class="gi">${g.icon}</div><div class="grow"><h2>${esc(g.name)} Tournament</h2><div class="meta">${metaChips(t)}</div></div>
   <span class="status ${s}"><span>${stLab}</span></span>
   ${s === 'setup' ? `<button class="btn pri" data-act="start">Start tournament</button>` : ''}</div>
   <div class="prog"><i style="width:${pr.d / pr.n * 100}%"></i></div><div class="small muted" style="margin-top:6px">${pr.d} of ${pr.n} matches played${liveN ? ` · ${liveN} live` : ''}</div></div>`;
  if (s === 'completed') {
    const p = (cls, medal, lab, id) => `<div class="pod ${cls}"><div class="md">${medal}</div><small>${lab}</small><b dir="auto">${esc(nm(t, id))}</b><small dir="auto">${esc(plyr(t, id))}</small></div>`;
    html += `<div class="panel"><h3>Final standings</h3><div class="podium-a">${p('g', '🏆', 'CHAMPION', st.first)}${p('', '🥈', 'SECOND PLACE', st.second)}${p('', '🥉', 'THIRD PLACE', st.third)}${p('', '', '4TH PLACE', st.fourth)}</div></div>`;
  }
  html += `<div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${S.atab === k ? 'on' : ''}" data-act="atab" data-id="${k}">${l}${k === 'results' && liveN ? `<sup>●</sup>` : ''}</button>`).join('')}</div><div style="margin-top:20px">`;
  if (S.atab === 'participants') html += tabParticipants(t, s);
  else if (S.atab === 'schedule') html += tabSchedule(t, s);
  else if (S.atab === 'fixtures') html += tabFixtures(t);
  else if (S.atab === 'bracket') html += tabBracket(t);
  else if (S.atab === 'results') html += tabResults(t, s);
  else html += tabSettings(t, s);
  return html + '</div>';
}

function tabParticipants(t, s) {
  const is2 = t.format === '2v2', miss = missingNames(t), dups = duplicateNames(t);
  const filled = t.size - miss.length;
  const rows = t.entrants.map((e, i) => {
    const dup = dups.has(e.name.trim().toLowerCase());
    if (!is2) return `<div class="pent ${dup ? 'dup' : ''}"><span class="n">${i + 1}</span><input class="in" dir="auto" placeholder="Player ${i + 1}" value="${esc(e.name)}" data-k="n${i}" data-o="${esc(e.name)}" data-chg="setName" data-i="${i}" data-f="name" data-next="1"></div>`;
    return `<div class="pent ${dup ? 'dup' : ''}"><span class="n">${i + 1}</span><div class="tm"><input class="in" dir="auto" placeholder="Team ${i + 1} name" value="${esc(e.name)}" data-k="n${i}" data-o="${esc(e.name)}" data-chg="setName" data-i="${i}" data-f="name" data-next="1"><input class="in" dir="auto" placeholder="Player A" value="${esc(e.players[0])}" data-k="a${i}" data-o="${esc(e.players[0])}" data-chg="setName" data-i="${i}" data-f="p0" data-next="1"><input class="in" dir="auto" placeholder="Player B" value="${esc(e.players[1])}" data-k="b${i}" data-o="${esc(e.players[1])}" data-chg="setName" data-i="${i}" data-f="p1" data-next="1"></div></div>`;
  }).join('');
  return `<div class="panel" style="margin-top:0"><div class="row" style="margin-bottom:16px"><h2 style="margin:0">${is2 ? 'Teams' : 'Players'}</h2><span class="chip ${miss.length ? 'y' : 'done'}">${filled}/${t.size} filled</span>${dups.size ? '<span class="warn">⚠ duplicate names</span>' : ''}<span class="sp"></span>
   <button class="btn sm" data-act="openPaste">Paste list</button><button class="btn sm" data-act="fillSample">Sample names</button>${s === 'setup' ? '<button class="btn sm" data-act="shuffle">🔀 Shuffle draw</button><button class="btn sm danger" data-act="clearNames">Clear</button>' : ''}</div>
   <div class="muted small" style="margin-bottom:14px">Seeds are matched in order: 1 vs 2, 3 vs 4 … Press Enter to jump to the next box.${s !== 'setup' ? ' Tournament has started — renaming is safe, draw is locked.' : ''}</div>
   <div class="pgrid ${is2 ? 't2' : ''}">${rows}</div></div>`;
}

function tabSchedule(t, s) {
  const bad = scheduleConflicts(t), nSlots = slotCount(t);
  const slotOpts = Array.from({ length: nSlots + 3 }, (_, i) => [i, `${slotTime(t, i)} · slot ${i + 1}`]);
  const devOpts = Array.from({ length: t.devices }, (_, i) => [i + 1, deviceLabel(t, i + 1)]);
  const bySlot = {};
  t.matches.forEach(m => { (bySlot[m.slot] = bySlot[m.slot] || []).push(m); });
  const cur = Math.min(...t.matches.filter(m => m.status !== 'done').map(m => m.slot), 999);
  const cards = Object.keys(bySlot).map(Number).sort((a, b) => a - b).map(sl => {
    const ms = sortedBySlot(bySlot[sl]);
    const canStart = s === 'live' && ms.some(m => m.status === 'upcoming' && matchReady(m));
    return `<div class="slot ${sl === cur && s === 'live' ? 'now' : ''}"><h4>${slotTime(t, sl)} <small>SLOT ${sl + 1} · ${ms.length} MATCH${ms.length > 1 ? 'ES' : ''}</small><span class="sp"></span>${canStart ? `<button class="btn sm pri" data-act="startSlot" data-id="${sl}">Start slot</button>` : ''}</h4>
    ${ms.map(m => `<div class="srow ${bad.has(m.id) ? 'bad' : ''}"><span class="dev" data-game="${t.game}">${deviceLabel(t, m.device)}</span>
      <div class="mm"><b dir="auto">${esc(nm(t, m.a, m.srcA))}<span class="vs">vs</span>${esc(nm(t, m.b, m.srcB))}</b><small>Match ${m.num} · ${esc(mRound(t, m))} · ${statusLabel(m, matchReady(m))}${m.sa != null ? ` · ${m.sa}–${m.sb}` : ''}</small></div>
      <div class="mv">${m.status === 'done' ? '' : `${sel('', slotOpts, m.slot, 'moveSlot', 'ms' + m.id).replace('<select', `<select data-id="${m.id}"`)}${sel('', devOpts, m.device, 'moveDev', 'md' + m.id).replace('<select', `<select data-id="${m.id}"`)}`}</div></div>`).join('')}</div>`;
  }).join('');
  return `<div class="panel" style="margin-top:0"><div class="row" style="margin-bottom:16px"><h2 style="margin:0">Schedule</h2><span class="chip">${t.devices} ${G(t.game).deviceName}${t.devices > 1 ? 's' : ''} reused every slot</span><span class="chip">${nSlots} time slots</span>${bad.size ? '<span class="warn">⚠ device clash highlighted in red</span>' : ''}<span class="sp"></span><button class="btn sm" data-act="regen">Regenerate schedule</button></div>
  <div class="muted small" style="margin-bottom:14px">Each ${G(t.game).deviceName} plays one match per slot. Later rounds start only after the previous round's slots. Use the dropdowns to move a match to another time or device.</div>
  <div class="slots">${cards}</div></div>`;
}

function tabFixtures(t) {
  const rounds = [...new Set(orderMatches(t).map(m => m.kind === 'third' ? 'T' : String(m.round)))];
  const rOpts = `<option value="all">All rounds</option>${rounds.map(r => `<option value="${r}" ${S.fxRound === r ? 'selected' : ''}>${r === 'T' ? 'Third Place' : roundName(t.size, +r)}</option>`).join('')}`;
  const list = orderMatches(t).filter(m => (S.fxRound === 'all' || (S.fxRound === 'T' ? m.kind === 'third' : (m.kind === 'main' && String(m.round) === S.fxRound))) && (S.fxStatus === 'all' || mStatus(m) === S.fxStatus));
  const rows = list.map(m => {
    const a = nm(t, m.a, m.srcA), b = nm(t, m.b, m.srcB);
    const w = m.winner ? nm(t, m.winner) : '—';
    return `<tr><td><b>${m.num}</b></td><td>${esc(mRound(t, m))}</td><td>${slotTime(t, m.slot)}</td><td><span class="chip b">${deviceLabel(t, m.device)}</span></td>
    <td dir="auto" class="${m.a ? '' : 'tbd'} ${m.winner && m.winner === m.a ? 'w' : ''}">${esc(a)}</td><td dir="auto" class="${m.b ? '' : 'tbd'} ${m.winner && m.winner === m.b ? 'w' : ''}">${esc(b)}</td>
    <td class="sc">${m.sa != null ? m.sa + ' – ' + m.sb : '—'}</td><td><span class="chip ${m.status === 'done' ? 'done' : m.status === 'live' ? 'live' : ''}">${statusLabel(m, matchReady(m))}</span></td><td dir="auto" class="w">${esc(w)}</td></tr>`;
  }).join('');
  return `<div class="panel" style="margin-top:0"><div class="row" style="margin-bottom:14px"><h2 style="margin:0">Fixtures</h2><span class="sp"></span>
  <select class="in" style="width:auto" data-chg="fxRound" data-k="fxr" data-o="${S.fxRound}">${rOpts}</select>
  <select class="in" style="width:auto" data-chg="fxStatus" data-k="fxs" data-o="${S.fxStatus}">${[['all', 'All statuses'], ['up', 'Upcoming'], ['live', 'Live'], ['done', 'Completed']].map(o => `<option value="${o[0]}" ${S.fxStatus === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></div>
  <div class="tblwrap"><table class="tbl"><thead><tr><th>Match</th><th>Round</th><th>Time</th><th>Device</th><th>Participant 1</th><th>Participant 2</th><th>Score</th><th>Status</th><th>Winner</th></tr></thead><tbody>${rows || '<tr><td colspan="9" class="muted">No fixtures match the filter.</td></tr>'}</tbody></table></div></div>`;
}

function tabBracket(t) {
  const big = t.size >= 32;
  const H = t.size === 64 ? 880 : t.size === 32 ? 700 : t.size === 16 ? 560 : 300;
  const toggle = big ? `<div class="row"><button class="btn sm ${S.brSide === 'L' ? 'pri' : ''}" data-act="brSide" data-id="L">Upper half</button><button class="btn sm ${S.brSide === 'R' ? 'pri' : ''}" data-act="brSide" data-id="R">Lower half</button></div>` : '';
  return `<div class="panel" style="margin-top:0"><div class="row" style="margin-bottom:10px"><h2 style="margin:0">Bracket</h2><span class="muted small">Click a match to enter or edit its score.</span><span class="sp"></span>${toggle}</div>
  <div class="adm-bracket">${bracketHTML(t, { W: big ? 1450 : 1480, H, mode: big ? 'half' : 'full', side: S.brSide, centerW: 320, g: 30, maxCh: 80, maxFont: 20, hf: 16, click: true, maxCw: 300 })}</div></div>`;
}

function entryCard(t, m) {
  const ready = matchReady(m), editing = !!S.editing[m.id], done = m.status === 'done';
  const nx = nextOf(t, m);
  const head = `<div class="eh" data-game="${t.game}"><b>MATCH ${m.num}</b><span class="chip">${esc(mRound(t, m))}</span><span class="chip">${slotTime(t, m.slot)}</span><span class="dev" style="padding:0 10px;font-size:15px">${deviceLabel(t, m.device)}</span><span class="sp"></span><span class="chip ${done ? 'done' : m.status === 'live' ? 'live' : ''}">${statusLabel(m, ready)}</span></div>`;
  const who = (which) => {
    const id = m[which], src = which === 'a' ? m.srcA : m.srcB, e = entrant(t, id);
    return `<div class="who"><b dir="auto" class="${e ? '' : 'tbd'}">${esc(nm(t, id, src))}</b>${plyr(t, id) ? `<small dir="auto">${esc(plyr(t, id))}</small>` : ''}</div>`;
  };
  if (done && !editing) {
    const wa = m.winner === m.a;
    const row = (id, w, sc, isWin) => `<div class="erow ${isWin ? 'w' : 'l'}"><div class="who"><b dir="auto">${isWin ? '<span class="tag">WINNER</span>' : ''}${esc(nm(t, id))}</b>${plyr(t, id) ? `<small dir="auto">${esc(plyr(t, id))}</small>` : ''}</div><div class="big">${sc}</div></div>`;
    const advTxt = m.kind === 'third' ? '🥉 Third place' : (nx.win ? `▸ ${esc(nm(t, m.winner))} advances to ${roundName(t.size, nx.win.round)} (Match ${nx.win.num})` : '🏆 Tournament champion');
    return `<div class="ec done">${head}<div class="eb">${row(m.winner, true, wa ? m.sa : m.sb, true)}${row(m.loser, false, wa ? m.sb : m.sa, false)}
      <div class="adv">${advTxt}${m.decider ? ' · decided by tie-break' : ''}</div><div class="acts"><button class="btn sm" data-act="editMatch" data-id="${m.id}">Edit result</button></div></div></div>`;
  }
  const inp = (which, v) => `<input class="sc" type="number" inputmode="numeric" min="0" step="1" value="${v == null ? '' : v}" ${ready ? '' : 'disabled'} data-k="s:${m.id}:${which}" data-o="${v == null ? '' : v}" data-enter="${m.id}" aria-label="Score">`;
  const tieBox = m.tie ? `<div class="tiebox">⚠ <b>Draw ${m.sa}–${m.sb}</b> — a winner can't be determined from the score, so nobody advances. Change the score above, or pick the winner of the tie-break:<div class="acts" style="margin-top:8px"><button class="btn sm pri" data-act="tieWin" data-id="${m.id}" data-side="a">${esc(nm(t, m.a))} wins</button><button class="btn sm pri" data-act="tieWin" data-id="${m.id}" data-side="b">${esc(nm(t, m.b))} wins</button></div></div>` : '';
  return `<div class="ec ${m.status === 'live' ? 'live' : ''} ${ready ? '' : 'tbdm'}">${head}<div class="eb">
    <div class="erow">${who('a')}${inp('a', m.sa)}</div><div class="erow">${who('b')}${inp('b', m.sb)}</div>${tieBox}
    ${ready ? `<div class="acts"><button class="btn pri sm" data-act="saveResult" data-id="${m.id}">Save result</button>${m.status === 'upcoming' ? `<button class="btn sm" data-act="startMatch" data-id="${m.id}">Start match</button>` : ''}${editing ? `<button class="btn sm ghost" data-act="cancelEdit" data-id="${m.id}">Cancel</button><button class="btn sm danger" data-act="reopen" data-id="${m.id}">Clear result</button>` : ''}</div>` : `<div class="muted small">Waiting for earlier results.</div>`}
  </div></div>`;
}

function tabResults(t, s) {
  if (s === 'setup') return `<div class="panel" style="margin-top:0"><h2>Results</h2><p class="muted">Start the tournament to begin entering scores.</p><button class="btn pri" data-act="start">Start tournament</button></div>`;
  const ord = orderMatches(t);
  const live = ord.filter(m => m.status === 'live');
  const ready = ord.filter(m => m.status === 'upcoming' && matchReady(m));
  const wait = ord.filter(m => m.status === 'upcoming' && !matchReady(m));
  const done = ord.filter(m => m.status === 'done').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const sec = (title, sub, arr) => arr.length ? `<div class="sec-h">${title} <small>${sub || ''}</small></div><div class="ecs">${arr.map(m => entryCard(t, m)).join('')}</div>` : '';
  return sec('Live now', `${live.length} match${live.length > 1 ? 'es' : ''} on the ${G(t.game).deviceName}s`, live) +
    sec('Ready to play', 'enter the score when the match ends', ready.slice(0, 24)) + (ready.length > 24 ? `<div class="muted small" style="margin-top:8px">+ ${ready.length - 24} more ready matches (see Fixtures)</div>` : '') +
    (wait.length ? `<div class="sec-h">Waiting for earlier rounds <small>${wait.length} matches</small><button class="btn sm ghost" data-act="toggleWait">${S.showWaiting ? 'Hide' : 'Show'}</button></div>${S.showWaiting ? `<div class="ecs">${wait.map(m => entryCard(t, m)).join('')}</div>` : ''}` : '') +
    sec('Completed', 'newest first — click Edit result to correct a score', done);
}

function tabSettings(t, s) {
  if (!S.sform || S.sform.id !== t.id) S.sform = { id: t.id, game: t.game, size: t.size, format: t.format, devices: t.devices, start: t.startTime, dur: t.duration };
  const f = S.sform, locked = s !== 'setup';
  return `<div class="panel" style="margin-top:0"><h2>Settings</h2>${formFields(f, 'sf', 'sform', locked)}
   <div class="muted small" style="margin-top:12px">${locked ? 'Size, format and device count are locked once the tournament starts. Start time and match duration can still be adjusted — all times update.' : 'Changing size, format or devices rebuilds the bracket and schedule; entered names are kept.'}</div>
   <div class="row" style="margin-top:16px"><button class="btn pri" data-act="saveSettings">Save settings</button></div></div>
   <div class="panel"><h3>Demo & reset</h3><div class="row">
    ${s !== 'setup' && s !== 'completed' ? '<button class="btn" data-act="randomRound">🎲 Auto-play next matches (random scores)</button>' : ''}
    <button class="btn" data-act="newSample">Replace with sample tournament</button>
    <button class="btn danger" data-act="resetT">Delete this tournament</button></div>
    <p class="muted small" style="margin:12px 0 0">Delete removes participants, results and schedule for ${esc(G(t.game).name)} only, so you can create the real one.</p></div>`;
}

/* ---------- modals ---------- */
function modalHTML() {
  const m = S.modal; if (!m) return '';
  if (m.type === 'confirm') return `<div class="ov"><div class="modal wide"><h3>${esc(m.title)}</h3><p>${esc(m.msg)}</p><div class="row"><button class="btn ${m.danger ? 'danger' : 'pri'}" data-act="modalOk">${esc(m.okLabel)}</button><button class="btn ghost" data-act="modalCancel">Cancel</button></div></div></div>`;
  if (m.type === 'paste') {
    const t = S.ts[S.agame];
    return `<div class="ov"><div class="modal"><h3>Paste ${t.format === '2v2' ? 'teams' : 'names'}</h3><p>${t.format === '2v2' ? 'One team per line: <b>Team name: Player A, Player B</b> (team name optional).' : 'One name per line.'} Up to ${t.size} lines are used, starting from entry 1.</p><textarea class="in" dir="auto" id="pastebox" data-k="paste" placeholder="${t.format === '2v2' ? 'Falcons: Ahmed, Omar&#10;Wolves: Youssef, Karim' : 'Ahmed&#10;Omar&#10;Mohamed'}">${esc(S.pasteText)}</textarea><div class="row" style="margin-top:14px"><button class="btn pri" data-act="doPaste">Import</button><button class="btn ghost" data-act="modalCancel">Cancel</button></div></div></div>`;
  }
  if (m.type === 'match') {
    const t = S.ts[S.agame], mm = t && byId(t, m.id);
    if (!mm) return '';
    return `<div class="ov" data-act="modalBg"><div class="modal wide">${entryCard(t, mm)}<div class="row" style="margin-top:14px"><button class="btn ghost" data-act="modalCancel">Close</button></div></div></div>`;
  }
  if (m.type === 'missing') return `<div class="ov"><div class="modal wide"><h3>Names missing</h3><p>${m.n} ${m.n === 1 ? 'entry has' : 'entries have'} no name yet. Fill every box, or auto-fill the empty ones with placeholders (you can rename them any time).</p><div class="row"><button class="btn pri" data-act="autofillStart">Auto-fill & start</button><button class="btn ghost" data-act="modalCancel">Go back</button></div></div></div>`;
  return '';
}

/* ===================== ACTIONS ===================== */
function readScores(id) {
  const root = document.querySelector('.modal') || document;
  const a = root.querySelector(`[data-k="s:${id}:a"]`), b = root.querySelector(`[data-k="s:${id}:b"]`);
  return [a ? a.value : '', b ? b.value : ''];
}
const ACT = {
  home() { setMode('home'); },
  goAdmin() { setMode('admin'); },
  goPublic() { setMode('public'); },
  agame(id) { S.agame = id; S.atab = S.ts[id] && tstatus(S.ts[id]) !== 'setup' ? 'results' : 'participants'; S.sform = null; S.form.game = id; S.form.devices = G(id).defaultDevices; },
  atab(id) { S.atab = id; },
  toggleWait() { S.showWaiting = !S.showWaiting; },
  brSide(id) { S.brSide = id; },
  create(demo) {
    const f = S.form, id = f.game;
    const go = () => {
      const t = newTournament({ game: id, size: +f.size, format: f.format, devices: +f.devices, startTime: f.start || '10:00', duration: +f.dur || 30 });
      if (demo) fillSample(t);
      delete tomb[id]; commit(t); S.atab = 'participants'; S.sform = null;
    };
    go();
  },
  demo() { ACT.create(true); },
  async start() {
    const t = S.ts[S.agame], miss = missingNames(t);
    if (miss.length) { S.modal = { type: 'missing', n: miss.length }; schedule(); return; }
    mutate(t.id, x => { x.started = true; autoStart(x); });
    S.atab = 'results'; toast('Tournament started — public display is live');
  },
  autofillStart() {
    const t = S.ts[S.agame];
    S.modal = null;
    mutate(t.id, x => { x.entrants.forEach((e, i) => { if (!e.name.trim()) e.name = (x.format === '2v2' ? 'Team ' : 'Player ') + (i + 1); if (x.format === '2v2') { if (!e.players[0].trim()) e.players[0] = 'Player A'; if (!e.players[1].trim()) e.players[1] = 'Player B'; } }); resolve(x); x.started = true; autoStart(x); });
    S.atab = 'results'; toast('Tournament started');
  },
  setName(el) {
    const i = +el.dataset.i, f = el.dataset.f, v = el.value.trim();
    mutate(S.agame, t => { const e = t.entrants[i]; if (f === 'name') e.name = v; else e.players[f === 'p0' ? 0 : 1] = v; resolve(t); });
  },
  fillSample() { mutate(S.agame, t => { fillSample(t); }); toast('Sample names filled'); },
  shuffle() { mutate(S.agame, t => { shuffleEntrants(t); }); toast('Bracket drawn randomly'); },
  async clearNames() {
    if (!await confirmBox('Clear all names?', 'Every participant name in this tournament will be erased.', 'Clear', true)) return;
    mutate(S.agame, t => { t.entrants.forEach(e => { e.name = ''; e.players = t.format === '2v2' ? ['', ''] : []; }); resolve(t); });
  },
  openPaste() { S.pasteText = ''; S.modal = { type: 'paste' }; },
  doPaste() {
    const el = $('#pastebox'); const txt = el ? el.value : '';
    let n = 0; mutate(S.agame, t => { n = applyPaste(t, txt); });
    S.modal = null; toast(n + ' entries imported');
  },
  async saveResult(id) {
    const t = S.ts[S.agame], m = byId(t, id), [a, b] = readScores(id);
    if (a === '' || b === '') { toast('Enter a score for both sides'); return; }
    const sa = +a, sb = +b;
    if (!Number.isInteger(sa) || !Number.isInteger(sb) || sa < 0 || sb < 0) { toast('Scores must be whole numbers'); return; }
    if (m.status === 'done') {
      const lost = impactOf(t, id, sa, sb);
      if (lost > 0 && !await confirmBox('Change this result?', `This changes who advances, so ${lost} later result${lost > 1 ? 's' : ''} that depended on it will be cleared and need to be re-entered.`, 'Change result', true)) return;
    }
    let r;
    mutate(t.id, x => { r = saveResult(x, id, sa, sb); if (!r.ok) return false; autoStart(x); });
    delete S.editing[id];
    if (r && !r.ok) toast(r.error);
    else if (r && r.tie) toast('Draw — pick the winner of the tie-break or fix the score');
    else { toast('Result saved'); if (S.modal && S.modal.type === 'match') S.modal = null; checkDone(); }
  },
  startMatch(id) { mutate(S.agame, t => { if (!startMatch(t, id)) return false; }); },
  editMatch(id) { S.editing[id] = true; },
  cancelEdit(id) { delete S.editing[id]; },
  async reopen(id) {
    const t = S.ts[S.agame], lost = impactOf(t, id, null);
    if (!await confirmBox('Clear this result?', lost > 0 ? `${lost} later result${lost > 1 ? 's' : ''} depend on it and will also be cleared.` : 'The match goes back to upcoming.', 'Clear result', true)) return;
    mutate(t.id, x => { reopenMatch(x, id); }); delete S.editing[id];
  },
  async tieWin(id, side) {
    mutate(S.agame, t => { const r = resolveTie(t, id, side); if (!r.ok) return false; autoStart(t); });
    toast('Winner recorded'); if (S.modal && S.modal.type === 'match') S.modal = null; checkDone();
  },
  startSlot(sl) { mutate(S.agame, t => { t.matches.forEach(m => { if (m.slot === +sl) startMatch(t, m.id); }); }); toast('Slot started'); },
  moveSlot(el) { mutate(S.agame, t => { byId(t, el.dataset.id).slot = +el.value; }); },
  moveDev(el) { mutate(S.agame, t => { byId(t, el.dataset.id).device = +el.value; }); },
  async regen() {
    if (!await confirmBox('Regenerate schedule?', 'Manual changes to times and devices will be replaced by the automatic schedule.', 'Regenerate')) return;
    mutate(S.agame, t => { buildSchedule(t); });
  },
  fxRound(el) { S.fxRound = el.value; }, fxStatus(el) { S.fxStatus = el.value; },
  cform(el) {
    const f = S.form, k = el.id.replace('cf-', '');
    if (k === 'game') { f.game = el.value; f.devices = G(f.game).defaultDevices; S.agame = f.game; }
    else if (k === 'size') f.size = +el.value; else if (k === 'format') f.format = el.value; else if (k === 'devices') f.devices = +el.value; else if (k === 'start') f.start = el.value; else if (k === 'dur') f.dur = +el.value;
  },
  sform(el) { const k = el.id.replace('sf-', ''); S.sform[k] = (el.type === 'number' || k === 'size' || k === 'devices') ? +el.value : el.value; },
  async saveSettings() {
    const t = S.ts[S.agame], f = S.sform; if (!f) return;
    const structural = f.size !== t.size || f.format !== t.format || f.devices !== t.devices;
    if (structural && t.started) { toast('Size, format and devices are locked after start'); return; }
    mutate(t.id, x => {
      if (structural) rebuild(x, { size: f.size, format: f.format, devices: f.devices });
      x.startTime = f.start || '10:00'; x.duration = Math.max(5, +f.dur || 30);
    });
    toast('Settings saved');
  },
  async randomRound() {
    mutate(S.agame, t => { randomRound(t, null, true); autoStart(t); }); checkDone();
  },
  async newSample() {
    const t = S.ts[S.agame];
    if (!await confirmBox('Replace with sample?', 'This replaces the current tournament with a sample one (same settings, sample names).', 'Replace', true)) return;
    const n = newTournament({ game: t.game, size: t.size, format: t.format, devices: t.devices, startTime: t.startTime, duration: t.duration });
    fillSample(n); commit(n); S.atab = 'participants';
  },
  async resetT() {
    if (!await confirmBox('Delete this tournament?', 'All participants, results and the schedule for this game will be permanently removed.', 'Delete', true)) return;
    removeT(S.agame); S.sform = null; S.atab = 'participants';
  },
  openMatch(id) { S.modal = { type: 'match', id }; },
  modalOk() { const m = S.modal; S.modal = null; if (m && m.res) m.res(true); },
  modalCancel() { const m = S.modal; S.modal = null; if (m && m.res) m.res(false); },
  modalBg() { },
  pgame(id) { S.pgame = id; S.scene = null; },
  pscene(id) { S.scene = id; S.sceneAt = Date.now(); S.pinned = true; },
  ptoggle() { if (S.pinned) { S.pinned = false; S.auto = true; } else S.auto = !S.auto; S.sceneAt = Date.now(); },
  fullscreen() { try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (e) {} }
};
function checkDone() {
  const t = S.ts[S.agame]; if (t && tstatus(t) === 'completed') { S.atab = 'results'; toast('🏆 Tournament complete!'); }
}
function setMode(m) {
  S.mode = m; S.scene = null; S.sceneAt = Date.now();
  try { sessionStorage.setItem('e7s-mode', m === 'home' ? '' : m); } catch (e) {}
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.dataset.act === 'modalBg' && e.target !== el) return;
  const fn = ACT[el.dataset.act]; if (!fn) return;
  const a = el.dataset.act;
  if (a === 'modalBg') { ACT.modalCancel(); schedule(); return; }
  fn(el.dataset.id, el.dataset.side);
  schedule();
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-chg]'); if (!el) return;
  const fn = ACT[el.dataset.chg]; if (!fn) return;
  fn(el); schedule();
});
document.addEventListener('keydown', e => {
  const el = e.target;
  if (e.key === 'Enter' && el.dataset) {
    if (el.dataset.enter) { e.preventDefault(); ACT.saveResult(el.dataset.enter); return; }
    if (el.dataset.next) {
      e.preventDefault();
      const all = [...document.querySelectorAll('[data-next]')], i = all.indexOf(el);
      el.blur(); if (all[i + 1]) all[i + 1].focus();
    }
  }
  if (e.key === 'Escape' && S.modal) { ACT.modalCancel(); schedule(); }
});

/* ===================== MAIN RENDER ===================== */
function render() {
  const app = $('#app');
  if (!S.ready) { app.innerHTML = '<div class="home"><div class="logo"></div><div class="sync">Connecting…</div></div>'; return; }
  if (S.mode === 'public') { document.body.style.overflow = 'hidden'; renderPublic(); return; }
  document.body.style.overflow = '';
  if (S.mode === 'home') { renderHome(); return; }
  // admin: keep focus + unsaved typing across live re-renders
  const act = document.activeElement, key = act && act.dataset ? act.dataset.k : null;
  const sel0 = act && act.selectionStart != null ? [act.selectionStart, act.selectionEnd] : null;
  const scrollY = window.scrollY;
  const drafts = {};
  document.querySelectorAll('[data-k][data-o]').forEach(i => { if (i.tagName === 'INPUT' && i.value !== i.dataset.o && i.type !== 'time') drafts[i.dataset.k] = i.value; });
  const ta = $('#pastebox'); if (ta) S.pasteText = ta.value;
  renderAdmin();
  document.querySelectorAll('[data-k][data-o]').forEach(i => { if (i.tagName === 'INPUT' && drafts[i.dataset.k] !== undefined) i.value = drafts[i.dataset.k]; });
  if (key) { const n = document.querySelector('[data-k="' + key + '"]'); if (n) { n.focus(); if (sel0 && n.setSelectionRange && n.type !== 'number') try { n.setSelectionRange(sel0[0], sel0[1]); } catch (e) {} } }
  window.scrollTo(0, scrollY);
  const pb = $('#pastebox'); if (pb && !key) pb.focus();
}

initStore().then(() => { S.ready = true; schedule(); });
S.agame = (S.ts.fc27 || !S.ts.lol) ? 'fc27' : 'lol';
schedule();
window.__S = S; window.__ACT = ACT; window.__go = (fn) => { fn(); schedule(); };
