'use strict';
/* ==========================================================================
   聆听 MUSIC — 桌面播放器渲染层
   设计：D:\音乐 UI 毛玻璃版.html（glassmorphism + 琥珀金）
   数据：真实酷我后端（window.L IPC），歌词走网易云
   ========================================================================== */
const API = window.L;
const audio = document.getElementById('audio');

/* ---------------- 全局状态 ---------------- */
const state = {
  view: 'discover',
  histStack: ['discover'],
  histIndex: 0,
  current: null,
  queue: [],
  queueIndex: -1,
  viewList: [],
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  playMode: 'sequential',
  volume: 0.9,
  muted: false,
  quality: '320k',
  speed: 1,
  lyricsOpen: false,
  queueOpen: false,
  ambientGlowOn: true,
  search: '',
  searchTab: 'song',
  searchResults: [],
  searchTotal: 0,
  searchPage: 0,
  plResults: [],
  plTotal: 0,
  plPage: 0,
  plOpen: null,
  searchHistory: [],
  charts: [],
  chartSelId: '16',
  chartCache: {},
  favorites: [],
  history: [],
  library: [],
  settings: {},
};
window.__state = state;

const REG = new Map();
const Q_LABEL = { flac: 'FLAC', '320k': '320K', '128k': '128K' };
const Q_FULL = { flac: '无损 FLAC', '320k': '高品质 320K', '128k': '标准 128K' };
const Q_ORDER = ['320k', 'flac', '128k'];
const Q_EXT = { flac: 'flac', '320k': 'mp3', '128k': 'mp3' };
const VIEW_TITLE = {
  discover: '酷我热歌榜', charts: '排行榜', playlists: '推荐榜单',
  favorites: '我的收藏', downloads: '已下载', recent: '最近播放', settings: '设置',
};

const $ = (id) => document.getElementById(id);
const contentEl = () => $('content');

/* ---------------- 工具 ---------------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function escAttr(s) { return esc(s).replace(/`/g, '&#96;'); }
function fmtTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function baseName(p) { return String(p || '').split(/[\\/]/).pop(); }
function gradFor(seed) {
  const grads = [
    ['#8B4513', '#2B1508'], ['#243B55', '#141E30'], ['#3E6B6B', '#16282C'],
    ['#4B2C5E', '#1B1126'], ['#B84A27', '#2B120C'], ['#3D1E6D', '#121830'],
    ['#B32D1B', '#2E0C08'], ['#485563', '#1E242B'], ['#2A4B7C', '#0F1A2B'],
    ['#5C4418', '#14110B'],
  ];
  let h = 0; const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const g = grads[h % grads.length];
  return `linear-gradient(140deg, ${g[0]}, ${g[1]})`;
}

/* ---------------- 模型 ---------------- */
function toTrack(s) {
  const rid = s.rid || (s.id ? 'MUSIC_' + s.id : '');
  const rawCovers = Array.isArray(s.cover) ? s.cover.slice() : (s.cover ? [s.cover] : []);
  return {
    key: rid || String(s.id || Math.random()),
    rid, source: s.source || 'kuwo',
    title: s.name || s.title || '未知歌曲',
    artist: s.artist || s.artistName || '未知歌手',
    album: s.album || '', albumId: s.albumId || '', artistId: s.artistId || '',
    duration: Number(s.duration) || 0, formats: s.formats || '',
    rawCovers, rank: s.rank,
  };
}
function plain(t) {
  return {
    source: t.source, id: String(t.rid).replace(/^MUSIC_/, ''), rid: t.rid, name: t.title,
    artist: t.artist, album: t.album, albumId: t.albumId, artistId: t.artistId,
    duration: t.duration, cover: t.rawCovers, formats: t.formats,
  };
}
function reg(list) { (list || []).forEach((t) => REG.set(t.key, t)); }
function isFav(t) { return !!t && state.favorites.some((f) => f.key === t.key); }
function isDl(t) {
  const want = `${t.title} - ${t.artist}`;
  return state.library.some((x) => x.title === want || x.title === t.title);
}
function lossless(t) { return /FLAC|APE|WAV|无损/i.test(t.formats || ''); }

/* ---------------- 封面 ---------------- */
function covInner(t) {
  const ch = esc(((t.title || '♪').trim()[0]) || '♪');
  const cands = (t.rawCovers || []).filter((u) => u && !String(u).startsWith('rid:'));
  const rid = String(t.rid || '').replace(/^MUSIC_/, '');
  return `<span class="cch" style="background:${gradFor(t.title)}">${ch}</span>` +
    `<img class="cimg" data-rid="${escAttr(rid)}" data-cands="${escAttr(cands.join('|'))}" alt="">`;
}
const cwHTML = (t) => `<div class="cw cwrap">${covInner(t)}</div>`;

function hydrateCovers(root) {
  const scope = root || document;
  scope.querySelectorAll('img.cimg:not([data-hyd])').forEach((img) => {
    img.dataset.hyd = '1';
    const cands = (img.dataset.cands || '').split('|').filter(Boolean);
    let i = 0;
    const viaRid = async () => {
      const rid = img.dataset.rid;
      if (rid && !img.dataset.riddone) {
        img.dataset.riddone = '1';
        try {
          const r = await API.mCover('MUSIC_' + rid);
          if (r && r.ok && r.data) { img.src = r.data; return; }
        } catch (e) {}
      }
      img.style.display = 'none';
    };
    const step = () => { if (i < cands.length) img.src = cands[i++]; else viaRid(); };
    img.onload = () => { img.style.opacity = '1'; };
    img.onerror = () => step();
    step();
  });
}
function swapCover(el, t) {
  if (!el) return;
  el.innerHTML = covInner(t);
  hydrateCovers(el.parentNode || el);
}

/* ---------------- Toast ---------------- */
function showToast(msg) {
  const box = $('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<i></i><span>${esc(msg)}</span>`;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; setTimeout(() => el.remove(), 260); }, 2200);
}

/* ==========================================================================
   数据
   ========================================================================== */
async function getCharts() {
  if (state.charts.length) return state.charts;
  const r = await API.mChartNodes();
  state.charts = (r && r.ok && r.data) ? r.data : [];
  return state.charts;
}
async function getChart(id) {
  if (state.chartCache[id]) return state.chartCache[id];
  const r = await API.mChartSongs(id, 0, 100);
  if (!r || !r.ok) throw new Error((r && r.error) || '榜单加载失败');
  const list = (r.data.list || []).map(toTrack);
  reg(list);
  const pack = { name: r.data.name || '', total: r.data.total || list.length, list };
  state.chartCache[id] = pack;
  return pack;
}
async function cardCover(id) {
  try {
    const r = await API.mChartSongs(id, 0, 1);
    if (!r || !r.ok) return '';
    const s = (r.data && r.data.list && r.data.list[0]) || null;
    if (!s) return '';
    let c = (s.cover && s.cover[0]) || '';
    if (c && c.indexOf('rid:') === 0) {
      const rr = await API.mCover(c.slice(4));
      c = (rr && rr.ok && rr.data) ? rr.data : '';
    }
    return c || '';
  } catch (e) { return ''; }
}
async function singerCovers(n) {
  try {
    const s = await API.mSearch('孙燕姿', 0, 30);
    const list = (s && s.ok && s.data && s.data.list) || [];
    const aid = (list[0] && list[0].artistId) || '';
    let songs = [];
    if (aid) {
      const ar = await API.mArtistSongs(aid, 0, 40);
      songs = (ar && ar.ok && ar.data) || [];
    }
    if (!songs.length) songs = list;
    const seen = new Set(), out = [];
    for (const t of songs) {
      let c = (t.cover && t.cover[0]) || '';
      if (!c) continue;
      let url = c;
      if (c.indexOf('rid:') === 0) {
        const rr = await API.mCover(c.slice(4));
        url = (rr && rr.ok && rr.data) || '';
      }
      if (url && !seen.has(url)) { seen.add(url); out.push(url); if (out.length >= n) break; }
    }
    return out;
  } catch (e) { return []; }
}

/* ==========================================================================
   公共片段
   ========================================================================== */
function secHead(title, opts = {}) {
  const { playAll = false, more = '', sub = '' } = opts;
  return `<div class="sec-head">
    <h2>${esc(title)}</h2>
    ${playAll ? `<button class="play-all" data-act="playall"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.8v14.4L19 12 7 4.8Z"/></svg>播放全部</button>` : ''}
    ${more ? `<button class="more" data-act="${more.act}">${esc(more.label)} <span aria-hidden="true">›</span></button>` : ''}
  </div>${sub ? `<div class="sec-sub">${esc(sub)}</div>` : ''}`;
}

function emptyBox(title, desc, btn) {
  return `<div class="empty"><b>${esc(title)}</b><span>${esc(desc)}</span>${
    btn ? `<div><button class="btn" data-act="${btn.act}">${esc(btn.label)}</button></div>` : ''}</div>`;
}

function trackRows(list, opts = {}) {
  const { showRank = true, emptyTitle = '暂无歌曲', emptyDesc = '去发现页探索更多音乐吧', emptyBtn = null } = opts;
  if (!list || !list.length) return emptyBox(emptyTitle, emptyDesc, emptyBtn);
  return list.map((t, i) => {
    const on = state.current && state.current.key === t.key;
    const liked = isFav(t);
    const dl = isDl(t);
    return `<div class="row${on ? ' playing' : ''}" data-key="${escAttr(t.key)}" data-act="row" role="button" tabindex="0" aria-label="播放 ${escAttr(t.title)}">
      <div class="idx"><span class="idx-num num">${showRank ? (t.rank || i + 1) : i + 1}</span><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span></div>
      <div class="song">${cwHTML(t)}
        <div class="t"><b><span class="tt">${esc(t.title)}</span><span class="hq${lossless(t) ? ' flac' : ''}">${lossless(t) ? 'FLAC' : 'HQ'}</span></b><span>${esc(t.artist)}</span></div>
      </div>
      <div class="album">${esc(t.album || '—')}</div>
      <div class="dur num">${t.duration ? fmtTime(t.duration) : '--:--'}</div>
      <div class="ops">
        <button class="op-btn${liked ? ' liked' : ''}" data-act="fav" data-key="${escAttr(t.key)}" aria-label="收藏">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.7C6.4 17 3 13.6 3 9.7 3 7.2 5 5 7.6 5c1.7 0 3.4.9 4.4 2.4C13 5.9 14.7 5 16.4 5 19 5 21 7.2 21 9.7c0 3.9-3.4 7.3-9 11Z"/></svg>
        </button>
        <button class="op-btn" data-act="dl" data-key="${escAttr(t.key)}" aria-label="下载" style="${dl ? 'color:var(--gold-2)' : ''}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11m0 0 4-4m-4 4-4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
        </button>
      </div>
      <div class="row-progress" aria-hidden="true"><i></i></div>
    </div>`;
  }).join('');
}

function panel(list, opts) {
  return `<section class="panel glass">${trackRows(list, opts)}</section>`;
}

/* ==========================================================================
   页面
   ========================================================================== */
let RTOKEN = 0;
async function renderMain() {
  const token = ++RTOKEN;
  const c = contentEl();
  try {
    if (state.search && state.plOpen) return await openPlaylist(state.plOpen.id);
    if (state.search) return renderSearch(token);
    if (state.view === 'discover') return await renderDiscover(token);
    if (state.view === 'charts') return await renderCharts(token);
    if (state.view === 'playlists') return await renderPlaylists(token);
    if (state.view === 'favorites') return renderFavorites();
    if (state.view === 'downloads') return renderDownloads();
    if (state.view === 'recent') return renderRecent();
    if (state.view === 'settings') return renderSettings();
    return await renderDiscover(token);
  } catch (e) {
    if (token === RTOKEN && c) c.innerHTML = emptyBox('加载失败', e.message || String(e));
  }
}

async function renderDiscover(token) {
  const c = contentEl();
  c.innerHTML = secHead('为你推荐', { more: { act: 'gocharts', label: '更多榜单' } }) +
    `<div class="cards" id="cards"></div><div class="sec-sub" style="padding:26px 0 0">加载中…</div>`;
  const charts = await getCharts();
  const hot = await getChart('16');
  if (token !== RTOKEN) return;
  state.viewList = hot.list.slice(0, 30);
  if (hot.list[0]) prefetchTrackObj(hot.list[0]);
  if (hot.list[1]) prefetchTrackObj(hot.list[1]);

  const picks = (charts.length ? charts : [{ id: '16', name: '酷我热歌榜' }]).slice(0, 4);
  const sy = await singerCovers(4);
  const covers = await Promise.all(picks.map((ch, i) => (sy[i] ? Promise.resolve(sy[i]) : cardCover(ch.id))));
  if (token !== RTOKEN) return;

  const cards = picks.map((ch, i) => {
    const img = covers[i];
    return `<button class="card" data-act="chart" data-id="${escAttr(ch.id)}" aria-label="打开${escAttr(ch.name)}">
      <div class="cover" style="background:${gradFor(ch.name)}">
        <span class="ch">${esc((ch.name || '榜')[0])}</span>
        ${img ? `<img src="${escAttr(img)}" alt="" onerror="this.style.display='none'">` : ''}
        <span class="tag">榜单精选</span>
        <span class="go"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.2v13.6L18.5 12 8 5.2Z"/></svg></span>
      </div>
      <div class="meta"><b>${esc(ch.name)}</b><span>酷我实时热榜 · 高品质畅听</span></div>
    </button>`;
  }).join('');

  c.innerHTML = `
    <section id="recommendSec">
      ${secHead('为你推荐', { more: { act: 'gocharts', label: '更多榜单' } })}
      <div class="cards" id="cards">${cards}</div>
    </section>
    ${secHead('酷我热歌榜', { playAll: true, more: { act: 'gocharts', label: '全部' }, sub: `实时热榜 TOP30 · 共 ${hot.total} 首` })}
    ${panel(state.viewList, {})}`;
  hydrateCovers(c);
}

async function renderCharts(token) {
  const c = contentEl();
  c.innerHTML = secHead('排行榜') + `<div class="sec-sub">加载中…</div>`;
  const charts = await getCharts();
  if (token !== RTOKEN) return;
  const sel = charts.find((x) => x.id === state.chartSelId) || charts[0];
  if (!sel) { c.innerHTML = emptyBox('暂无榜单', '稍后再试'); return; }
  state.chartSelId = sel.id;
  const pack = await getChart(sel.id);
  if (token !== RTOKEN) return;
  state.viewList = pack.list;

  const chips = charts.map((ch) =>
    `<button class="chip${ch.id === sel.id ? ' on' : ''}" data-act="chip" data-id="${escAttr(ch.id)}">${esc(ch.name)}</button>`).join('');

  const top3 = pack.list.slice(0, 3).map((t, i) => `
    <div class="pod" data-act="pod" data-key="${escAttr(t.key)}" data-idx="${i}">
      ${cwHTML(t)}
      <div style="min-width:0;flex:1">
        <span class="no">TOP ${i + 1}</span>
        <b>${esc(t.title)}</b>
        <span>${esc(t.artist)}</span>
      </div>
    </div>`).join('');

  c.innerHTML = `
    ${secHead(pack.name || sel.name, { playAll: true, sub: `共 ${pack.total} 首 · 数据来自酷我实时榜单` })}
    <div class="chips">${chips}</div>
    <div class="podium">${top3}</div>
    ${panel(pack.list, {})}`;
  hydrateCovers(c);
}

async function renderPlaylists(token) {
  const c = contentEl();
  const charts = await getCharts();
  if (token !== RTOKEN) return;
  const cards = charts.map((ch) => `
    <button class="card" data-act="chart" data-id="${escAttr(ch.id)}">
      <div class="cover" style="background:${gradFor(ch.name)}">
        <span class="ch">${esc((ch.name || '榜')[0])}</span>
        <span class="tag">榜单</span>
        <span class="go"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.2v13.6L18.5 12 8 5.2Z"/></svg></span>
      </div>
      <div class="meta"><b>${esc(ch.name)}</b><span>点击进入畅听</span></div>
    </button>`).join('');
  c.innerHTML = `${secHead('推荐榜单', { sub: `共 ${charts.length} 个酷我榜单` })}<div class="cards" id="cards">${cards}</div>`;
}

function renderFavorites() {
  const c = contentEl();
  state.viewList = state.favorites;
  c.innerHTML = `
    ${secHead('我的收藏', { playAll: state.favorites.length > 0, sub: `共收藏 ${state.favorites.length} 首 · 点亮红心即可添加` })}
    ${panel(state.favorites, { showRank: false, emptyTitle: '还没有收藏任何歌曲', emptyDesc: '点击歌曲右侧的爱心图标，把喜欢的曲目收进来', emptyBtn: { act: 'godiscover', label: '去发现音乐' } })}`;
  hydrateCovers(c);
}

function renderDownloads() {
  const c = contentEl();
  const lib = state.library || [];
  const dir = (state.settings && state.settings.downloadDir) || '';
  const totalBytes = lib.reduce((s, it) => s + (it.size || 0), 0);
  const rows = lib.map((it, i) => {
    const parts = String(it.title || '').split(' - ');
    const t = { title: parts[0] || it.title || '未命名', artist: parts[1] || '本地文件', rid: it.rid || '', rawCovers: it.covers ? String(it.covers).split('|').filter(Boolean) : [] };
    return `<div class="lib-row" data-lib="${i}">
      <div class="cw">${covInner(t)}</div>
      <div class="nm"><b>${esc(it.title || '未命名')}</b><span>${it.size ? (it.size / 1048576).toFixed(1) + ' MB · ' : ''}${esc(baseName(it.file))}</span></div>
      <button class="op-btn" data-act="playlocal" data-file="${escAttr(it.file)}" title="播放"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.2v13.6L18.5 12 8 5.2Z"/></svg></button>
      <button class="op-btn" data-act="reveal" data-file="${escAttr(it.file)}" title="在文件夹显示"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.06-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.38a1.5 1.5 0 0 1-1.06-.44z"/></svg></button>
      <button class="op-btn" data-act="rmlib" data-file="${escAttr(it.file)}" title="移除"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 18 18 6M6 6l12 12"/></svg></button>
    </div>`;
  }).join('');

  c.innerHTML = `
    <div class="sec-head"><h2>已下载</h2><span class="count num" style="font-size:11.5px;color:var(--ink-3);background:rgba(255,255,255,.07);border:1px solid var(--stroke-soft);padding:2px 9px;border-radius:99px">${lib.length} 首</span>
      <button class="more" data-act="pickdir">选择目录 <span aria-hidden="true">›</span></button>
    </div>
    <div class="sec-sub">离线缓存${totalBytes ? ' · 共 ' + (totalBytes / 1048576).toFixed(1) + ' MB' : ''}</div>
    <div class="set-block glass" style="padding:14px 16px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-size:12px;color:var(--ink-3);flex:none">下载目录</span>
        <span class="path" style="flex:1;margin:0;min-width:200px">${esc(dir || '未设置（默认 用户目录/聆听音乐）')}</span>
        <button class="mini" data-act="pickdir">选择目录</button>
        <button class="mini gold" data-act="opendir">打开文件夹</button>
      </div>
    </div>
    <section class="panel glass" style="padding:10px">
      ${lib.length ? rows : emptyBox('还没有下载任何歌曲', '在歌曲行点右侧的下载图标即可离线缓存', { act: 'godiscover', label: '去发现音乐' })}
    </section>`;
  hydrateCovers(c);
  hydrateLibCovers(c, lib);
}

// 旧版本下载条目没有 rid/covers：按「歌名 - 歌手」反查封面
const LIB_COVER_CACHE = new Map();
async function hydrateLibCovers(root, lib) {
  for (let i = 0; i < lib.length; i++) {
    const it = lib[i];
    const row = root.querySelector(`.lib-row[data-lib="${i}"]`);
    if (!row) continue;
    const img = row.querySelector('img.cimg');
    if (!img || img.src) continue;
    const parts = String(it.title || '').split(' - ');
    const name = (parts[0] || '').trim();
    const artist = (parts[1] || '').trim();
    if (!name) continue;
    const ck = name + '|' + artist;
    let url = LIB_COVER_CACHE.get(ck);
    if (url === undefined) {
      url = '';
      try {
        let rid = it.rid || '';
        if (!rid) {
          const r = await API.mSearch(name, 0, 8);
          const list = (r && r.ok && r.data && r.data.list) || [];
          const pick = list.find((x) => artist && (x.artist || '').includes(artist)) || list[0];
          if (pick) {
            rid = pick.rid || (pick.id ? 'MUSIC_' + pick.id : '');
            it.rid = rid;
          }
        }
        if (rid) {
          const rr = await API.mCover(rid);
          if (rr && rr.ok && rr.data) url = rr.data;
        }
      } catch (e) {}
      LIB_COVER_CACHE.set(ck, url);
    }
    if (url) { img.src = url; img.style.display = ''; img.style.opacity = '1'; }
  }
}

function renderRecent() {
  const c = contentEl();
  state.viewList = state.history;
  c.innerHTML = `
    <div class="sec-head"><h2>最近播放</h2><button class="more" data-act="clearhistory">清空记录</button></div>
    <div class="sec-sub">记录您最近的聆听足迹</div>
    ${panel(state.history, { showRank: false, emptyTitle: '还没有播放记录', emptyDesc: '去发现页播放喜欢的歌曲吧', emptyBtn: { act: 'godiscover', label: '去发现音乐' } })}`;
  hydrateCovers(c);
}

function renderSettings() {
  const c = contentEl();
  const s = state.settings || {};
  const dir = s.downloadDir || '';
  const q = state.quality || '320k';
  const lib = state.library || [];
  const totalBytes = lib.reduce((a, it) => a + (it.size || 0), 0);
  const qBtn = (val, label, desc) =>
    `<button class="${q === val ? 'on' : ''}" data-act="setq" data-q="${val}"><b>${label}${q === val ? ' ✓' : ''}</b><span>${desc}</span></button>`;

  c.innerHTML = `
    ${secHead('设置', { sub: '下载、播放与存储偏好' })}

    <div class="set-block glass">
      <h3>下载设置</h3>
      <div class="set-row">
        <div style="min-width:0"><p>下载保存目录</p><small>选择后立即生效，用于之后所有下载</small></div>
        <div style="display:flex;gap:8px;flex:none">
          <button class="mini" data-act="pickdir">选择文件夹</button>
          <button class="mini gold" data-act="opendir">打开</button>
        </div>
      </div>
      <div class="path">${esc(dir || '未设置（默认 用户目录/聆听音乐）')}</div>
    </div>

    <div class="set-block glass">
      <h3>播放设置</h3>
      <div class="set-row" style="display:block">
        <p style="margin-bottom:10px">默认音质 <small style="display:inline;margin-left:6px">（同时用于播放与下载）</small></p>
        <div class="qseg">${qBtn('128k', '标准 128K', '体积小，省流量')}${qBtn('320k', '高品质 320K', '推荐 · 均衡')}${qBtn('flac', '无损 FLAC', '发烧级 · 部分音源需会员')}</div>
      </div>
      <div class="set-row">
        <div><p>顶部环境氛围光</p><small>播放时背景随封面缓缓流动</small></div>
        <button class="switch${state.ambientGlowOn ? ' on' : ''}" data-act="glow" aria-label="氛围光开关"><i></i></button>
      </div>
    </div>

    <div class="set-block glass">
      <h3>存储</h3>
      <div class="set-row">
        <div><p>已下载 ${lib.length} 首 · 占用 ${(totalBytes / 1048576).toFixed(1)} MB</p><small>离线文件保存在上方「下载保存目录」</small></div>
        <button class="mini danger" data-act="cleardl">清空已下载</button>
      </div>
    </div>

    <div class="set-block glass">
      <h3>关于</h3>
      <div class="set-row">
        <div><p>聆听 MUSIC Desktop v2.4.0</p><small>音源：酷我 · 歌词：网易云 · 三档音质 128K / 320K / FLAC</small></div>
        <button class="mini" data-act="checkupdate">检查更新</button>
      </div>
    </div>`;
}

/* ---------------- 搜索 ---------------- */
let SEARCH_TOKEN = 0;

/* 搜索历史（持久化在 store.settings.searchHistory，最多 12 条） */
function pushSearchHistory(kw) {
  kw = String(kw || '').trim();
  if (!kw) return;
  const h = (state.searchHistory || []).filter((x) => x !== kw);
  h.unshift(kw);
  state.searchHistory = h.slice(0, 12);
  state.settings.searchHistory = state.searchHistory;
  API.storeSet({ settings: state.settings });
  renderSearchDrop();
}
function clearSearchHistory() {
  state.searchHistory = [];
  state.settings.searchHistory = [];
  API.storeSet({ settings: state.settings });
  renderSearchDrop();
}
function removeSearchHistory(kw) {
  kw = String(kw || '');
  state.searchHistory = (state.searchHistory || []).filter((x) => x !== kw);
  state.settings.searchHistory = state.searchHistory;
  API.storeSet({ settings: state.settings });
  renderSearchDrop();
}
function renderSearchDrop() {
  const drop = $('searchDrop');
  const tags = $('sdTags');
  if (!drop || !tags) return;
  const h = state.searchHistory || [];
  const X_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><path d="M5.5 5.5l13 13M18.5 5.5l-13 13"/></svg>';
  tags.innerHTML = h.length
    ? h.map((k) => `<span class="sd-tag-wrap"><button class="sd-tag" data-act="sduse" data-kw="${escAttr(k)}">${esc(k.length > 16 ? k.slice(0, 16) + '…' : k)}</button><button class="sd-x" data-act="sddel" data-kw="${escAttr(k)}" aria-label="删除这条记录">${X_SVG}</button></span>`).join('')
    : `<div class="sd-empty">暂无搜索记录</div>`;
}
function openSearchDrop(force) {
  const drop = $('searchDrop');
  if (!drop) return;
  const on = typeof force === 'boolean' ? force : true;
  if (on) { renderSearchDrop(); drop.classList.add('show'); }
  else drop.classList.remove('show');
}

/* 单曲搜索 */
async function doSearch(kw, page) {
  if (!kw) return;
  kw = kw.trim();
  const token = ++SEARCH_TOKEN;
  state.search = kw;
  state.searchTab = 'song';
  state.plOpen = null;
  openSearchDrop(false);
  if (page === 0) { state.searchResults = []; state.searchPage = 0; }
  const c = contentEl();
  c.innerHTML = secHead(`搜索「${kw}」`) + `<div class="sec-sub">检索中…</div>`;
  try {
    const [rs, rp] = await Promise.all([
      API.mSearch(kw, page, 100),
      page === 0 ? API.mSearchPlaylist(kw, 0, 30) : Promise.resolve(null),
    ]);
    if (token !== SEARCH_TOKEN) return;
    if (!rs || !rs.ok) throw new Error((rs && rs.error) || '搜索失败');
    const list = (rs.data.list || []).map(toTrack);
    reg(list);
    state.searchResults = page === 0 ? list : state.searchResults.concat(list);
    state.searchTotal = rs.data.total || state.searchResults.length;
    state.searchPage = page;
    if (rp && rp.ok) {
      state.plResults = rp.data.list || [];
      state.plTotal = rp.data.total || state.plResults.length;
      state.plPage = 0;
    }
    if (page === 0) pushSearchHistory(kw);
    renderSearch();
  } catch (e) {
    if (token === SEARCH_TOKEN) c.innerHTML = emptyBox('搜索失败', e.message || String(e));
  }
}
async function loadMorePlaylists() {
  if (!state.search) return;
  const token = SEARCH_TOKEN;
  const next = state.plPage + 1;
  const r = await API.mSearchPlaylist(state.search, next, 30);
  if (token !== SEARCH_TOKEN || !r || !r.ok) return;
  state.plResults = state.plResults.concat(r.data.list || []);
  state.plTotal = r.data.total || state.plResults.length;
  state.plPage = next;
  renderSearch();
}
function fmtCount(n) {
  n = Number(n) || 0;
  if (n >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, '') + '亿';
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  return String(n);
}
function playlistCards(list, opts = {}) {
  const { emptyTitle = '未找到相关歌单', emptyDesc = '换个关键词试试' } = opts;
  if (!list || !list.length) return emptyBox(emptyTitle, emptyDesc);
  return `<div class="pl-cards">${list.map((p) => `
    <button class="pl-card" data-act="plopen" data-id="${escAttr(p.id)}" aria-label="打开歌单 ${escAttr(p.name)}">
      <div class="cov">
        <span class="pl-txt">${esc((p.name || '歌')[0])}</span>
        ${p.cover ? `<img src="${escAttr(p.cover)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
        <span class="pl-n"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.2v13.6L18.5 12 8 5.2Z"/></svg>${fmtCount(p.playCount)}</span>
      </div>
      <b title="${escAttr(p.name)}">${esc(p.name)}</b>
      <span class="meta">${esc(p.songNum ? p.songNum + ' 首 · ' : '')}${esc(p.author || '')}</span>
    </button>`).join('')}</div>`;
}
function renderSearch() {
  const c = contentEl();
  const tab = state.searchTab || 'song';
  const list = state.searchResults;
  const pls = state.plResults;
  const songMore = list.length < state.searchTotal;
  const plMore = pls.length < state.plTotal;
  const tabs = `
    <div class="sr-tabs">
      <button class="sr-tab${tab === 'song' ? ' on' : ''}" data-act="srtab" data-tab="song">单曲<span class="n num">${state.searchTotal || list.length}</span></button>
      <button class="sr-tab${tab === 'list' ? ' on' : ''}" data-act="srtab" data-tab="list">歌单<span class="n num">${state.plTotal || pls.length}</span></button>
    </div>`;

  if (tab === 'list') {
    state.viewList = [];
    c.innerHTML = `
      <div class="sec-head"><h2>搜索结果</h2>
        <button class="more" data-act="clearsearch">清除搜索</button>
      </div>
      <div class="sec-sub">关键词：「<span style="color:var(--gold-2)">${esc(state.search)}</span>」· 歌单 ${state.plTotal} 个 · 已显示 ${pls.length}</div>
      ${tabs}
      ${playlistCards(pls)}
      ${plMore ? `<div class="loadmore"><button data-act="moreplaylist">加载更多（还有 ${state.plTotal - pls.length} 个）</button></div>` : ''}`;
    return;
  }

  state.viewList = list;
  c.innerHTML = `
    <div class="sec-head"><h2>搜索结果</h2>
      <button class="more" data-act="clearsearch">清除搜索</button>
    </div>
    <div class="sec-sub">关键词：「<span style="color:var(--gold-2)">${esc(state.search)}</span>」· 共 ${state.searchTotal} 首 · 已显示 ${list.length}</div>
    ${tabs}
    ${panel(list, { showRank: true, emptyTitle: '未找到相关歌曲', emptyDesc: '换个关键词试试，例如歌手名或歌名' })}
    ${songMore ? `<div class="loadmore"><button data-act="moresearch">加载更多（还有 ${state.searchTotal - list.length} 首）</button></div>` : ''}`;
  hydrateCovers(c);
}
function switchSearchTab(tab) {
  if (state.searchTab === tab) return;
  state.searchTab = tab;
  if (state.search) renderSearch();
}

/* 歌单详情 */
async function openPlaylist(id) {
  const c = contentEl();
  openSearchDrop(false);
  const key = 'pl:' + id;
  const cached = REG.get(key);
  c.innerHTML = secHead('歌单') + `<div class="sec-sub">加载中…</div>`;
  try {
    const r = await API.mPlaylist(id, 0, 300);
    if (!r || !r.ok) throw new Error((r && r.error) || '歌单加载失败');
    const d = r.data;
    const list = (d.list || []).map(toTrack);
    // 歌单内每首都带上歌单封面做兜底
    if (d.cover) list.forEach((t) => { if (!t.rawCovers.some((u) => u && !String(u).startsWith('rid:'))) t.rawCovers.push(d.cover); });
    reg(list);
    state.plOpen = { id, name: d.name, list };
    state.viewList = list;
    c.innerHTML = `
      <div class="pl-hero glass">
        <div class="cov">
          <span style="font-size:38px;font-weight:900;color:rgba(255,255,255,.25)">${esc((d.name || '歌')[0])}</span>
          ${d.cover ? `<img src="${escAttr(d.cover)}" alt="" onerror="this.style.display='none'">` : ''}
        </div>
        <div class="txt">
          <h1>${esc(d.name)}</h1>
          <div class="who">${esc(d.author)} · ${d.total} 首${d.playCount ? ' · ' + fmtCount(d.playCount) + ' 次播放' : ''}</div>
          ${d.tags ? `<div class="who" style="color:var(--gold-2);font-size:12px">${esc(d.tags.split(';').join(' / '))}</div>` : ''}
          ${d.intro ? `<div class="desc">${esc(d.intro)}</div>` : ''}
        </div>
      </div>
      ${secHead('歌单歌曲', { playAll: list.length > 0, more: { act: 'backsearch', label: '返回搜索' }, sub: `共 ${list.length} 首` })}
      ${panel(list, { showRank: true, emptyTitle: '这个歌单还没有歌曲' })}`;
    hydrateCovers(c);
  } catch (e) {
    c.innerHTML = emptyBox('歌单加载失败', e.message || String(e), { act: 'backsearch', label: '返回搜索' });
  }
}
function clearSearch() {
  state.search = ''; state.searchResults = []; state.searchTotal = 0; state.searchPage = 0;
  state.plResults = []; state.plTotal = 0; state.plPage = 0; state.searchTab = 'song';
  state.plOpen = null;
  const i = $('searchInput'); if (i) i.value = '';
  const w = $('searchWrap'); if (w) w.classList.remove('has');
  renderMain();
}

/* ==========================================================================
   播放核心
   ========================================================================== */
const URL_CACHE = new Map();
const URL_PENDING = new Map();
async function resolveUrl(t, quality) {
  const key = t.rid + '|' + quality;
  const hit = URL_CACHE.get(key);
  if (hit && hit.exp > Date.now()) return hit;
  if (URL_PENDING.has(key)) return URL_PENDING.get(key);
  const task = (async () => {
    const r = await API.mUrl(t.rid, quality);
    if (!r || !r.ok || !r.data || !r.data.url) throw new Error((r && r.error) || '取流失败');
    const pack = { url: r.data.url, lyric: r.data.lyric || '', exp: Date.now() + (r.data.ttl || 20 * 60000) };
    URL_CACHE.set(key, pack);
    return pack;
  })();
  URL_PENDING.set(key, task);
  try { return await task; } finally { URL_PENDING.delete(key); }
}
function prefetchTrack(key) { const t = REG.get(key); if (t) prefetchTrackObj(t); }
function prefetchTrackObj(t) {
  if (!t || !t.rid) return;
  const key = t.rid + '|' + state.quality;
  const hit = URL_CACHE.get(key);
  if ((hit && hit.exp > Date.now()) || URL_PENDING.has(key)) return;
  resolveUrl(t, state.quality).catch(() => {});
}

let PLAY_TOKEN = 0;
async function playAt(track, list, index, opts = {}) {
  if (!track) return;
  const token = ++PLAY_TOKEN;
  state.current = track;
  state.queue = (list && list.length) ? list : [track];
  state.queueIndex = index >= 0 ? index : 0;
  state.currentTime = opts.position || 0;
  state.duration = track.duration || 0;
  updateNowPlaying();
  updateProgressUI();
  renderQueue();
  try {
    const pack = await resolveUrl(track, state.quality);
    if (token !== PLAY_TOKEN) return;
    audio.src = pack.url;
    audio.playbackRate = state.speed;
    audio.volume = state.muted ? 0 : state.volume;
    audio.currentTime = opts.position || 0;
    await audio.play();
    if (token !== PLAY_TOKEN) return;
    state.isPlaying = true;
    syncPlayState();
    loadLyrics(track, pack.lyric);
    const q = state.queue;
    if (q.length > 1) {
      prefetchTrackObj(q[(state.queueIndex + 1) % q.length]);
      if (q.length > 2) prefetchTrackObj(q[(state.queueIndex + 2) % q.length]);
      prefetchTrackObj(q[(state.queueIndex - 1 + q.length) % q.length]);
    }
    pushHistory(track);
    refreshRows();
    showToast(`正在播放：${track.title} - ${track.artist}`);
  } catch (e) {
    if (token !== PLAY_TOKEN) return;
    state.isPlaying = false; syncPlayState();
    showToast('播放失败：' + (e.message || e));
  }
}
function selectTrack(key) {
  const t = REG.get(key);
  if (!t) return;
  if (state.current && state.current.key === key) { togglePlay(); return; }
  const list = (state.viewList && state.viewList.some((x) => x.key === key)) ? state.viewList : [t];
  let idx = list.findIndex((x) => x.key === key);
  if (idx < 0) idx = 0;
  playAt(t, list, idx);
}
function selectFromQueue(key) {
  const t = REG.get(key);
  if (!t) return;
  const idx = state.queue.findIndex((x) => x.key === key);
  playAt(t, state.queue, idx < 0 ? 0 : idx);
}
function highlight(key, el) {
  document.querySelectorAll('.row.selected').forEach((x) => x.classList.remove('selected'));
  if (el && el.classList.contains('row')) el.classList.add('selected');
}
function playAllFromList() {
  if (!state.viewList.length) { showToast('当前列表为空'); return; }
  playAt(state.viewList[0], state.viewList, 0);
}
function togglePlay() {
  if (!state.current) { playAllFromList(); return; }
  if (!audio.src) { playAt(state.current, state.queue, state.queueIndex); return; }
  if (audio.paused) audio.play().catch(() => {}); else audio.pause();
}
function nextTrack() {
  if (!state.queue.length) return;
  const random = state.playMode === 'shuffle';
  const i = random ? Math.floor(Math.random() * state.queue.length) : (state.queueIndex + 1) % state.queue.length;
  playAt(state.queue[i], state.queue, i);
}
function prevTrack() {
  if (!state.queue.length) return;
  const random = state.playMode === 'shuffle';
  const i = random ? Math.floor(Math.random() * state.queue.length) : (state.queueIndex - 1 + state.queue.length) % state.queue.length;
  playAt(state.queue[i], state.queue, i);
}
function onEnded() {
  if (state.playMode === 'loop') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
  nextTrack();
}
const MODES = [
  { key: 'sequential', label: '列表顺序播放', svg: '<path d="M17 2.5 21 6.5l-4 4"/><path d="M3 12.5v-1a5 5 0 0 1 5-5h13M7 21.5 3 17.5l4-4"/><path d="M21 11.5v1a5 5 0 0 1-5 5H3"/>' },
  { key: 'shuffle', label: '随机播放', svg: '<path d="M16 3.5h4.5V8"/><path d="M3.5 20 20.5 3.5M16 20.5h4.5V16"/><path d="m14.6 14.6 5.9 5.9M3.5 4l4.6 4.6a5 5 0 0 1 1.4 3.4v.6"/>' },
  { key: 'loop', label: '单曲循环', svg: '<path d="M17 2.5 21 6.5l-4 4"/><path d="M3 12.5v-1a5 5 0 0 1 5-5h13M7 21.5 3 17.5l4-4"/><path d="M21 11.5v1a5 5 0 0 1-5 5H3"/><text x="9.4" y="15.6" font-size="9" fill="currentColor" stroke="none" font-weight="800">1</text>' },
];
function cyclePlayMode() {
  const idx = MODES.findIndex((m) => m.key === state.playMode);
  const next = MODES[(idx + 1) % MODES.length];
  state.playMode = next.key;
  updateModeBtn();
  showToast('已切换为：' + next.label);
}
function updateModeBtn() {
  const btn = $('modeBtn');
  if (!btn) return;
  const m = MODES.find((x) => x.key === state.playMode) || MODES[0];
  btn.title = m.label;
  btn.setAttribute('aria-label', '播放模式：' + m.label);
  btn.classList.toggle('on', state.playMode !== 'sequential');
  btn.querySelector('svg').innerHTML = m.svg;
}

function playLocal(file) {
  const url = 'file:///' + String(file).replace(/\\/g, '/');
  const name = String(file).split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
  const libIt = (state.library || []).find((x) => x.file === file) || null;
  const parts = String((libIt && libIt.title) || name).split(' - ');
  const covers = libIt && libIt.covers ? String(libIt.covers).split('|').filter(Boolean) : [];
  state.current = {
    key: 'local:' + file, rid: (libIt && libIt.rid) || '',
    title: parts[0] || name, artist: parts[1] || '本地文件',
    album: '', duration: 0, rawCovers: covers, localFile: file,
  };
  state.queue = [state.current]; state.queueIndex = 0;
  audio.src = url;
  audio.volume = state.muted ? 0 : state.volume;
  audio.play().then(() => { state.isPlaying = true; syncPlayState(); }).catch(() => showToast('本地文件播放失败'));
  updateNowPlaying(); updateProgressUI(); renderQueue(); loadLyrics(state.current, '');
  ensureLocalCover(state.current);
}
async function ensureLocalCover(t) {
  if (!t || (t.rawCovers && t.rawCovers.length) || t.coverBusy) return;
  t.coverBusy = true;
  try {
    let rid = t.rid || '';
    if (!rid) {
      const r = await API.mSearch(t.title, 0, 8);
      const list = (r && r.ok && r.data && r.data.list) || [];
      const pick = list.find((x) => (x.artist || '').includes(t.artist) || t.artist.includes(x.artist || '')) || list[0];
      if (pick) rid = pick.rid || (pick.id ? 'MUSIC_' + pick.id : '');
    }
    if (rid && state.current && state.current.key === t.key) {
      state.current.rid = rid;
      updateNowPlaying();
      const libIt = (state.library || []).find((x) => x.file === t.localFile);
      if (libIt && !libIt.rid) libIt.rid = rid;
    }
  } catch (e) {}
}

/* ---------------- 收藏 / 下载 ---------------- */
/* ---------- 点赞粒子（对齐 D:\音乐 UI 毛玻璃版.html） ---------- */
const LIKE_COLORS = ['#ff5d73', '#ff8fa3', '#f5b83d', '#ffcf6b', '#ffffff', '#ff6b4a'];
const HEART_SVG = '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M12 21s-7.5-4.6-9.6-9A5.4 5.4 0 0 1 12 5.7 5.4 5.4 0 0 1 21.6 12C19.5 16.4 12 21 12 21Z"/></svg>';
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* 粒子兜底清扫：窗口被遮挡/动画被节流时 WAAPI 的 onfinish 可能不触发，
   会留下"卡在屏幕上"的粒子，这里每秒清掉超过 3s 的残留并限制总量 */
let PARTICLE_SWEEP = 0;
function sweepParticles() {
  const layer = $('particleLayer');
  if (!layer) return;
  const now = Date.now();
  for (const el of [...layer.children]) {
    if (now - (Number(el.dataset.born) || 0) > 3000) el.remove();
  }
  while (layer.children.length > 90) layer.firstElementChild.remove();
}


function spawnLikeParticles(cx, cy, big) {
  if (reduceMotion) return;
  if (!PARTICLE_SWEEP) PARTICLE_SWEEP = setInterval(sweepParticles, 1000);
  const layer = $('particleLayer');
  if (!layer) return;
  sweepParticles();
  const total = big ? 18 : 14;
  // expanding ring
  const ring = document.createElement('div');
  ring.className = 'like-particle like-ring';
  ring.style.width = ring.style.height = '14px';
  ring.style.transform = `translate(${cx - 7}px, ${cy - 7}px)`;
  ring.dataset.born = Date.now();
  layer.appendChild(ring);
  ring.animate(
    [{ transform: `translate(${cx - 7}px, ${cy - 7}px) scale(.4)`, opacity: 0.9 },
     { transform: `translate(${cx - 7}px, ${cy - 7}px) scale(3.2)`, opacity: 0 }],
    { duration: 520, easing: 'cubic-bezier(.22,1,.36,1)' }
  ).onfinish = () => ring.remove();

  for (let i = 0; i < total; i++) {
    const kind = i % 3;
    const p = document.createElement('div');
    p.className = 'like-particle';
    const col = LIKE_COLORS[Math.floor(Math.random() * LIKE_COLORS.length)];
    let size;
    if (kind === 0) { size = 11 + Math.random() * 13; p.innerHTML = HEART_SVG; p.style.color = col; p.style.width = size + 'px'; p.style.height = size + 'px'; }
    else if (kind === 1) { size = 4 + Math.random() * 6; p.className += ' like-dot'; p.style.width = size + 'px'; p.style.height = size + 'px'; p.style.background = col; }
    else { size = 10 + Math.random() * 8; p.className += ' like-plus'; p.textContent = '+'; p.style.fontSize = size + 'px'; p.style.color = col; }
    p.style.left = cx + 'px'; p.style.top = cy + 'px';
    p.dataset.born = Date.now();
    layer.appendChild(p);
    const ang = Math.PI * 2 * (i / total) + (Math.random() * 0.65 - 0.32);
    const dist = (big ? 58 : 44) + Math.random() * (big ? 62 : 48);
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist - 26 - Math.random() * 22;
    const rot = Math.random() * 220 - 110;
    const dur = 620 + Math.random() * 380;
    p.animate(
      [{ transform: `translate(-50%,-50%) translate(0,0) scale(.3) rotate(0deg)`, opacity: 1 },
       { transform: `translate(-50%,-50%) translate(${dx * 0.72}px,${dy * 0.72}px) scale(1.15) rotate(${rot * 0.72}deg)`, opacity: 1, offset: 0.55 },
       { transform: `translate(-50%,-50%) translate(${dx}px,${dy + 34}px) scale(.55) rotate(${rot}deg)`, opacity: 0 }],
      { duration: dur, easing: 'cubic-bezier(.22,1.2,.36,1)' }
    ).onfinish = () => p.remove();
  }
  // 主心形上升
  const h = document.createElement('div');
  h.className = 'like-particle';
  h.style.width = h.style.height = '20px';
  h.style.color = '#ff5d73';
  h.innerHTML = HEART_SVG;
  h.dataset.born = Date.now();
  layer.appendChild(h);
  h.animate(
    [{ transform: `translate(${cx - 10}px, ${cy - 10}px) translateY(-90%) scale(.8)`, opacity: 1 },
     { transform: `translate(${cx - 10}px, ${cy - 10}px) translateY(-190%) scale(1.15)`, opacity: 0 }],
    { duration: 820, easing: 'cubic-bezier(.22,1,.36,1)' }
  ).onfinish = () => h.remove();
}

/* 全局按压回弹 */
document.addEventListener('pointerdown', (e) => {
  if (reduceMotion) return;
  const t = e.target.closest('button,.card,.chip,.nav-item,.ctl,.op-btn,.side-ctl');
  if (!t || t.classList.contains('play-btn')) return;
  t.classList.remove('jelly-press');
  void t.offsetWidth;
  t.classList.add('jelly-press');
  setTimeout(() => t.classList.remove('jelly-press'), 560);
}, true);

async function toggleFav(key) {
  const t = REG.get(key);
  if (!t) return;
  try {
    const r = await API.favToggle(plain(t));
    if (r && r.added) { if (!isFav(t)) state.favorites.unshift(t); showToast(`已收藏《${t.title}》`); }
    else { state.favorites = state.favorites.filter((f) => f.key !== t.key); showToast(`已取消收藏《${t.title}》`); }
    updateCounts(); updateLike();
    if (state.view === 'favorites' && !state.search) renderMain();
    else refreshRows();
  } catch (e) { showToast('收藏失败'); }
}
async function toggleDownload(key) {
  const t = REG.get(key);
  if (!t) return;
  showToast('开始下载：' + t.title);
  try {
    const pack = await resolveUrl(t, state.quality);
    const ext = Q_EXT[state.quality] || 'mp3';
    const res = await API.downloadBatch({
      items: [{ url: pack.url, fileName: `${t.title} - ${t.artist}`, ext, rid: t.rid, covers: (t.rawCovers || []).join('|') }],
      dir: state.settings.downloadDir, ext,
    });
    if (res && res[0] && res[0].ok) showToast(`《${t.title}》下载完成`);
    else showToast('下载失败：' + ((res && res[0] && res[0].error) || '未知错误'));
    state.library = await API.libList();
    updateCounts();
    if (state.view === 'downloads') renderMain(); else refreshRows();
  } catch (e) { showToast('下载失败：' + (e.message || e)); }
}
async function removeLib(file) {
  await API.libRemove(file);
  state.library = await API.libList();
  updateCounts(); renderMain();
}
function refreshRows() {
  if (state.search) { renderSearch(); return; }
  if (state.view === 'favorites') renderFavorites();
  else if (state.view === 'recent') renderRecent();
  else if (state.view === 'downloads') renderDownloads();
  else renderMain();
}

/* ---------------- 历史 ---------------- */
async function pushHistory(t) {
  try {
    await API.historyPush(plain(t));
    state.history = state.history.filter((x) => x.key !== t.key);
    state.history.unshift(t);
    if (state.history.length > 300) state.history.length = 300;
    updateCounts();
  } catch (e) {}
}
async function clearHistory() {
  await API.historyClear();
  state.history = []; updateCounts(); renderMain();
}

/* ==========================================================================
   歌词
   ========================================================================== */
let LYRIC = [];
let LYRIC_META = [];
let LYRIC_SRC = '';
/* credits / 广告 / 版权声明：即使带时间轴也要剔出正文，否则会被逐行高亮 */
const LRC_META_RE = /^(作词|作曲|编曲|制作人|制作|监制|出品|发行|发行公司|混音|混音工程|录音|录音棚|录音助理|录音工程|母带|吉他|贝斯|鼓|键盘|和声|合声|弦乐|钢琴|统筹|艺人统筹|商务统筹|项目总监|总监|联合出品|企划|宣传|推广|营销|推广营销|经纪|词|曲|OP|SP|演唱|原唱|翻唱|策划|艺术|助理|工程|工作室|弦乐编写|和声编写|配唱|制作助理|出品人|词曲|编曲制作|版权|未经许可|特别鸣谢|正版授权|本音乐作品)/;
const LRC_ADS_RE = /酷狗|星曜计划|QQ音乐|酷我音乐|网易云音乐|未经许可|不得翻唱|翻唱请|高音质|无损音源|听歌就在|欢迎收听|关注我|订阅|请欣赏|本歌曲|音源来自|更多好听|已获得正版|正版授权/;
function isLyricJunk(text) {
  if (!text) return true;
  if (LRC_META_RE.test(text)) return true;
  if (LRC_ADS_RE.test(text)) return true;
  // 「词：xxx」「曲: xxx」「Produced by ...」这类短标签行（<=22 字且带冒号）
  if (text.length <= 22 && /^[^，。！？、]{1,10}[：:]/.test(text)) return true;
  if (/^(Produced|Written|Composed|Arranged|Mixed|Mastered|Lyrics?|Music)\b/i.test(text)) return true;
  return false;
}
/* 开头那句「歌名 - 歌手 (英文名)」是 LRC 文件自带的标题行，不是歌词 */
function isTitleLine(text) {
  return text.length <= 60 && /^.+?\s[-–—]\s.+$/.test(text) && !/[，。！？、]/.test(text);
}

function parseLRC(raw) {
  const out = { lines: [], meta: [] };
  if (!raw) return out;
  const timed = [];
  const metaSeen = new Set();
  for (const row of String(raw).replace(/\r/g, '').split('\n')) {
    const text = row.replace(/\[[^\]]*\]/g, '').trim();
    const times = [...row.matchAll(/\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (!text) continue;
    if (isLyricJunk(text)) {
      // 带时间轴的 credit 归到 meta，不参与逐行高亮
      if (!metaSeen.has(text)) { metaSeen.add(text); out.meta.push(text); }
      continue;
    }
    if (times.length) {
      for (const m of times) {
        const mm = parseInt(m[1], 10), ss = parseInt(m[2], 10), cs = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) : 0;
        timed.push({ time: mm * 60 + ss + cs / 1000, text });
      }
    }
  }
  timed.sort((a, b) => a.time - b.time);
  // 只在第一条时间轴附近（前 3 条内）剔除「歌名 - 歌手」标题行，避免误杀正文
  const head = timed.slice(0, 3).filter((x) => isTitleLine(x.text));
  if (head.length) {
    for (const h of head) { if (!metaSeen.has(h.text)) { metaSeen.add(h.text); out.meta.unshift(h.text); } }
    const drop = new Set(head.map((h) => h.text));
    out.lines = timed.filter((x) => !drop.has(x.text));
    return out;
  }
  out.lines = timed;
  return out;
}
async function loadLyrics(track, inlineLrc) {
  LYRIC = []; LYRIC_META = []; LYRIC_SRC = inlineLrc ? '内嵌' : '';
  let raw = inlineLrc || '';
  if (!raw) {
    try {
      const r = await API.mLyric(track.title, track.artist, track.duration);
      if (r && r.ok && r.data) { raw = r.data; LYRIC_SRC = '网易云'; }
    } catch (e) {}
  }
  const p = parseLRC(raw);
  LYRIC = p.lines; LYRIC_META = p.meta.slice(0, 10);
  LYRIC_ACTIVE = -1;
  renderLyrics();
  updateLyricHighlight(true);
}
function renderLyrics() {
  const box = $('lyricsBody');
  LYRIC_ACTIVE = -1;
  LY_TARGET = null;
  const src = $('lyricsSource');
  if (src) src.textContent = LYRIC_SRC ? `来源 ${LYRIC_SRC}` : '';
  if (!box) return;
  let html = '';
  if (LYRIC_META.length) html += `<div class="ly-meta">${LYRIC_META.map((m) => `<div>${esc(m)}</div>`).join('')}</div>`;
  html += LYRIC.length
    ? LYRIC.map((ln, i) => `<p class="ly-line" data-ly="${i}" data-t="${ln.time}"><span class="ly-tx">${esc(ln.text)}</span></p>`).join('')
    : `<p style="text-align:center;color:var(--ink-3);padding:40px 0;font-size:13px">暂无歌词</p>`;
  box.innerHTML = html;
  applyLyricDepth(box.querySelectorAll('.ly-line'), -1);
}
let LYRIC_ACTIVE = -1;
let LYRIC_RAF = 0;
let LY_TARGET = null;      // 平滑滚动目标
let LY_HOLD = 0;           // 用户手动滚动后的暂停跟随截止时间
let LY_ACTIVE_EL = null;   // 当前活动行元素（供滚动恢复时重新定位）
/* 逐字点亮：按本行到下一行的时间区间算进度，写到 --p，CSS 用 background-clip:text 做扫光 */
function lyricProgress(el, idx) {
  const cur = LYRIC[idx];
  if (!cur) return;
  const next = LYRIC[idx + 1];
  const t0 = cur.time;
  const t1 = next ? next.time : t0 + Math.max(2.4, (cur.text || '').length * 0.32);
  const span = Math.max(0.5, t1 - t0);
  let p = (state.currentTime - t0) / span;
  p = p < 0 ? 0 : p > 1 ? 1 : p;
  el.style.setProperty('--p', (p * 100).toFixed(2) + '%');
}
/* 景深：按与当前行的距离写 --d，CSS 用 transform/opacity/blur 做远近层次 */
function applyLyricDepth(lines, active) {
  for (let i = 0; i < lines.length; i++) {
    const d = active < 0 ? 0 : Math.min(8, Math.abs(i - active));
    lines[i].style.setProperty('--d', d);
  }
}
function updateLyricHighlight(force) {
  const lines = document.querySelectorAll('.ly-line');
  if (!lines.length || !LYRIC.length) return;
  let active = -1;
  for (let i = 0; i < LYRIC.length; i++) { if (state.currentTime >= LYRIC[i].time - 0.12) active = i; else break; }
  const box = $('lyricsBody');
  if (box && active >= 0 && force) LY_TARGET = lyricAnchor(box, lines[active]);
  if (active !== LYRIC_ACTIVE) {
    lines.forEach((el, i) => {
      const on = i === active;
      el.classList.toggle('active', on);
      if (!on) el.style.setProperty('--p', '0%');
    });
    LYRIC_ACTIVE = active;
    LY_ACTIVE_EL = active >= 0 ? lines[active] : null;
    applyLyricDepth(lines, active);
    // 换行时才量一次位置（每帧量会强制同步布局，白掉 10fps）
    if (box && active >= 0) LY_TARGET = lyricAnchor(box, lines[active]);
  }
  if (active < 0 || !state.lyricsOpen || !box) return;
  lyricProgress(lines[active], active);
  if (force && LY_TARGET != null) { box.scrollTop = LY_TARGET; LY_TARGET = null; }
}
/* 目标行在滚动容器里的绝对位置（居中） */
function lyricAnchor(box, el) {
  const er = el.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  return Math.max(0, box.scrollTop + (er.top - br.top) - box.clientHeight / 2 + er.height / 2);
}
/* 歌词页打开时用 rAF 刷进度：timeupdate 只有 4Hz，逐字会一顿一顿；
   同时每帧从 audio 读 currentTime，不再等 timeupdate，歌词才跟得上 */
function lyricTick() {
  if (!state.lyricsOpen) { LYRIC_RAF = 0; return; }
  const a = $('audio');
  if (a && !isNaN(a.currentTime)) state.currentTime = a.currentTime;
  updateLyricHighlight();
  const box = $('lyricsBody');
  if (LY_HOLD && performance.now() >= LY_HOLD) {
    LY_HOLD = 0;
    if (box && LY_ACTIVE_EL) LY_TARGET = lyricAnchor(box, LY_ACTIVE_EL);
  }
  if (box && LY_TARGET != null && performance.now() >= LY_HOLD) {
    const d = LY_TARGET - box.scrollTop;
    if (Math.abs(d) < 0.6 || Math.abs(d) > 420) { box.scrollTop = LY_TARGET; LY_TARGET = null; }
    else box.scrollTop = box.scrollTop + d * 0.2;
  }
  LYRIC_RAF = requestAnimationFrame(lyricTick);
}
/* 歌词页打开时用 rAF 刷进度：timeupdate 只有 4Hz，逐字会一顿一顿；
   同时每帧从 audio 读 currentTime，不再等 timeupdate，歌词才跟得上 */
function lyricTick() {
  if (!state.lyricsOpen) { LYRIC_RAF = 0; return; }
  const a = $('audio');
  if (a && !isNaN(a.currentTime)) state.currentTime = a.currentTime;
  updateLyricHighlight();
  const box = $('lyricsBody');
  if (box && LY_TARGET != null) {
    const d = LY_TARGET - box.scrollTop;
    if (Math.abs(d) < 0.6) { box.scrollTop = LY_TARGET; LY_TARGET = null; }
    else box.scrollTop = box.scrollTop + d * 0.18;
  }
  LYRIC_RAF = requestAnimationFrame(lyricTick);
}
function startLyricTick() {
  if (!LYRIC_RAF) LYRIC_RAF = requestAnimationFrame(lyricTick);
}
function stopLyricTick() {
  if (LYRIC_RAF) { cancelAnimationFrame(LYRIC_RAF); LYRIC_RAF = 0; }
}

/* ==========================================================================
   播放器 UI
   ========================================================================== */
function updateNowPlaying() {
  const t = state.current;
  if (!t) return;
  const disc = $('nowDisc');
  if (disc) { disc.innerHTML = covInner(t); hydrateCovers(disc.parentNode); }
  const title = $('nowTitle'); if (title) title.textContent = t.title;
  const art = $('nowArtist'); if (art) art.textContent = t.artist;
  const lyCover = $('lyricsCover');
  if (lyCover) { lyCover.innerHTML = covInner(t); hydrateCovers(lyCover.parentNode); }
  const lt = $('lyricsTitle'); if (lt) lt.textContent = t.title;
  const ls = $('lyricsSub'); if (ls) ls.textContent = `${t.artist}${t.album ? ' · ' + t.album : ''}`;
  const tag = $('lyricsTagText'); if (tag) tag.textContent = Q_FULL[state.quality];
  // 环境光跟随封面
  const amb = $('ambientImg');
  const lyAmb = $('lyAmbImg');
  const cands = (t.rawCovers || []).filter((u) => u && !String(u).startsWith('rid:'));
  const ambSrc = cands[0] || t.cover || '';
  if (amb) {
    if (ambSrc) { amb.style.opacity = '0'; setTimeout(() => { amb.src = ambSrc; amb.style.opacity = '.55'; }, 220); }
  }
  // 歌词页环境壁纸：同一张封面模糊放大当背景
  if (lyAmb) {
    const applyLyAmb = (src) => {
      if (!src) return;
      lyAmb.style.opacity = '0';
      setTimeout(() => { lyAmb.src = src; lyAmb.style.opacity = '.55'; }, 240);
    };
    if (ambSrc) applyLyAmb(ambSrc);
    else setTimeout(() => {
      const ci = lyCover && lyCover.querySelector('img.cimg');
      if (ci && ci.src) applyLyAmb(ci.src);
    }, 900);
  }
  updateLike();
}
function syncPlayState() {
  const p = state.isPlaying;
  document.body.classList.toggle('playing', p);
  document.body.classList.toggle('paused', !p);
  const icon = $('playIcon');
  if (icon) icon.innerHTML = p
    ? '<path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z"/>'
    : '<path d="M8 5.2v13.6L18.5 12 8 5.2Z"/>';
  const btn = $('playBtn');
  if (btn) { btn.setAttribute('aria-label', p ? '暂停' : '播放'); }
}
function updateLike() {
  const btn = $('nowLike');
  if (!btn) return;
  const on = state.current && isFav(state.current);
  btn.classList.toggle('liked', !!on);
  btn.querySelector('svg').setAttribute('fill', on ? 'currentColor' : 'none');
  btn.style.color = on ? '#ff5d73' : '';
}
function updateProgressUI() {
  const dur = state.duration || (state.current && state.current.duration) || 0;
  const ratio = dur ? Math.min(1, Math.max(0, state.currentTime / dur)) : 0;
  const fill = $('progFill'); if (fill) fill.style.width = (ratio * 100).toFixed(2) + '%';
  const knob = $('progKnob'); if (knob) knob.style.left = (ratio * 100).toFixed(2) + '%';
  const cur = $('curTime'); if (cur) cur.textContent = fmtTime(state.currentTime);
  const tot = $('totTime'); if (tot) tot.textContent = fmtTime(dur);
  const pr = $('progress'); if (pr) pr.setAttribute('aria-valuenow', Math.round(ratio * 100));
  // 播放中那一行的内嵌进度条
  const rp = document.querySelector('.panel.glass .row.playing .row-progress i');
  if (rp) rp.style.width = (ratio * 100).toFixed(2) + '%';
}
function updateVolumeUI() {
  const v = state.muted ? 0 : Math.round(state.volume * 100);
  const range = $('volRange'); if (range) range.value = v;
  const btn = $('muteBtn'); if (!btn) return;
  const muted = v === 0;
  btn.innerHTML = muted
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" fill="currentColor" stroke="none"/><path d="M16 9.5l5 5m0-5-5 5"/></svg>`
    : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" fill="currentColor" stroke="none"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18 6.8a7.4 7.4 0 0 1 0 10.4"/></svg>`;
}
function updateCounts() {
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set('favCount', state.favorites.length);
  set('dlCount', state.library.length);
  set('recentCount', state.history.length);
  set('queueCount', state.queue.length ? state.queue.length + ' 首' : '');
}
function syncQualityUI() {
  const q = state.quality;
  // 统一叫法：顶栏与歌词页都写完整档位名，底栏胶囊用短标签（空间受限）
  const t = $('qualityText'); if (t) t.textContent = Q_FULL[q];
  const ft = $('flacTag'); if (ft) ft.textContent = Q_LABEL[q];
  const lt = $('lyricsTagText'); if (lt) lt.textContent = Q_FULL[q];
  document.querySelectorAll('#qpop .qopt').forEach((b) => b.classList.toggle('on', b.dataset.q === q));
}
function setQuality(q, silent) {
  if (!Q_LABEL[q]) return;
  state.quality = q;
  state.settings.quality = q;
  API.storeSet({ settings: state.settings });
  syncQualityUI();
  if (!silent) showToast('已切换音质：' + Q_FULL[q]);
  if (state.current && state.current.rid) replayCurrent();
}
/* 浮层通用定位：优先弹在按钮上方，空间不够落下方，并夹在视口内 */
function showPop(pop, anchor) {
  if (!pop || !anchor) return;
  pop.classList.add('show');
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = r.right - pw;
  let top = r.top - ph - 10;
  if (top < 8) top = r.bottom + 10;
  left = Math.max(10, Math.min(left, innerWidth - pw - 10));
  top = Math.max(10, Math.min(top, innerHeight - ph - 10));
  pop.style.left = Math.round(left) + 'px';
  pop.style.top = Math.round(top) + 'px';
}
/* 音质浮层：点按钮弹出三档菜单，而不是循环切换 */
function openQpop(anchor) {
  syncQualityUI();
  showPop($('qpop'), anchor);
}
function closeQpop() { const p = $('qpop'); if (p) p.classList.remove('show'); }
function toggleQpop(anchor) {
  const p = $('qpop');
  if (p && p.classList.contains('show')) closeQpop();
  else openQpop(anchor);
}
/* 倍速浮层：六档网格，当前档高亮 */
function syncSpeedUI() {
  const b = $('speedBtn');
  if (b) b.textContent = (state.speed % 1 === 0 ? state.speed.toFixed(1) : state.speed) + 'x';
  document.querySelectorAll('#spop .sp-opt').forEach((x) => x.classList.toggle('on', Number(x.dataset.v) === Number(state.speed)));
}
function openSpop(anchor) { syncSpeedUI(); showPop($('spop'), anchor); }
function closeSpop() { const p = $('spop'); if (p) p.classList.remove('show'); }
function toggleSpop(anchor) {
  const p = $('spop');
  if (p && p.classList.contains('show')) closeSpop();
  else openSpop(anchor);
}
function replayCurrent() {
  if (!state.current) return;
  const pos = audio.currentTime || 0;
  if (state.current.localFile) return;
  playAt(state.current, state.queue, state.queueIndex, { position: pos });
}
function setSpeed(v) {
  state.speed = Number(v) || 1;
  audio.playbackRate = state.speed;
  state.settings.rate = state.speed;
  API.storeSet({ settings: state.settings });
  syncSpeedUI();
}
function cycleSpeed() {
  const list = [1, 1.25, 1.5, 2, 0.75, 0.5];
  const i = list.indexOf(state.speed);
  setSpeed(list[(i + 1) % list.length]);
  showToast('播放倍速 ' + state.speed + 'x');
}
function toggleMute() {
  state.muted = !state.muted;
  if (!state.muted && state.volume === 0) state.volume = 0.5;
  audio.volume = state.muted ? 0 : state.volume;
  updateVolumeUI();
}

/* ==========================================================================
   队列 / 歌词抽屉
   ========================================================================== */
function renderQueue() {
  const box = $('queueList');
  if (!box) return;
  const q = state.queue.length ? state.queue : state.viewList;
  const ct = $('queueCountText'); if (ct) ct.textContent = `共 ${q.length} 首`;
  const qc = $('queueCount'); if (qc) qc.textContent = q.length ? q.length + ' 首' : '';
  box.innerHTML = q.length ? q.map((t) => {
    const on = state.current && state.current.key === t.key;
    return `<div class="q-row${on ? ' on' : ''}" data-act="qrow" data-key="${escAttr(t.key)}">
      ${cwHTML(t)}
      <div class="nm"><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></div>
      <span class="du num">${t.duration ? fmtTime(t.duration) : ''}</span>
    </div>`;
  }).join('') : `<div style="padding:50px 0;text-align:center;color:var(--ink-3);font-size:13px">队列为空</div>`;
  hydrateCovers(box);
}
function toggleQueue(force) {
  state.queueOpen = typeof force === 'boolean' ? force : !state.queueOpen;
  const d = $('queueDrawer');
  if (!d) return;
  if (state.queueOpen) { if (state.lyricsOpen) toggleLyrics(false); renderQueue(); d.classList.add('show'); }
  else d.classList.remove('show');
}
function toggleLyrics(force) {
  state.lyricsOpen = typeof force === 'boolean' ? force : !state.lyricsOpen;
  const o = $('lyricsOverlay');
  if (!o) return;
  if (state.lyricsOpen) {
    if (state.queueOpen) toggleQueue(false);
    LYRIC_ACTIVE = -1;
    renderLyrics();
    o.classList.remove('hide');
    updateLyricHighlight(true);
    startLyricTick();
  } else { o.classList.add('hide'); stopLyricTick(); LY_TARGET = null; LY_HOLD = 0; }
}

/* ==========================================================================
   导航
   ========================================================================== */
function setView(v, push = true) {
  if (state.lyricsOpen) toggleLyrics(false);
  if (state.queueOpen) toggleQueue(false);
  state.view = v;
  if (push && state.histStack[state.histIndex] !== v) {
    state.histStack = state.histStack.slice(0, state.histIndex + 1);
    state.histStack.push(v);
    state.histIndex = state.histStack.length - 1;
  }
  if (state.search) { state.search = ''; state.plOpen = null; const i = $('searchInput'); if (i) i.value = ''; const sw = $('searchWrap'); if (sw) sw.classList.remove('has'); }
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  updateHistBtns();
  renderMain();
  const c = contentEl(); if (c) c.scrollTop = 0;
}
function updateHistBtns() {
  const b = $('histBack'), f = $('histFwd');
  if (b) b.disabled = state.histIndex <= 0;
  if (f) f.disabled = state.histIndex >= state.histStack.length - 1;
}
function histBack() { if (state.histIndex > 0) { state.histIndex--; setView(state.histStack[state.histIndex], false); } }
function histFwd() { if (state.histIndex < state.histStack.length - 1) { state.histIndex++; setView(state.histStack[state.histIndex], false); } }
async function refreshView() {
  const ic = $('refreshIcon');
  if (ic) { ic.style.transition = 'transform .5s'; ic.style.transform = 'rotate(360deg)'; setTimeout(() => { ic.style.transition = 'none'; ic.style.transform = 'none'; }, 520); }
  if (state.chartSelId) state.chartCache[state.chartSelId] = null;
  await renderMain();
  showToast('内容已刷新');
}
function openChart(id, autoplay) {
  state.chartSelId = id;
  setView('charts');
  if (autoplay) {
    const pack = state.chartCache[id];
    if (pack && pack.list.length) playAt(pack.list[0], pack.list, 0);
  }
}

/* ==========================================================================
   事件委托
   ========================================================================== */
function bindEvents() {
  // 单击选中，双击播放
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    switch (act) {
      case 'row': {
        if (e.target.closest('[data-act="fav"],[data-act="dl"]')) return;
        highlight(el.dataset.key, el);
        break;
      }
      case 'fav': {
        e.stopPropagation();
        const wasFav = isFav(REG.get(el.dataset.key));
        await toggleFav(el.dataset.key);
        if (!wasFav) {
          el.classList.add('like-burst');
          setTimeout(() => el.classList.remove('like-burst'), 620);
          spawnLikeParticles(e.clientX, e.clientY, false);
        }
        break;
      }
      case 'dl': e.stopPropagation(); await toggleDownload(el.dataset.key); break;
      case 'pod': selectTrack(el.dataset.key); break;
      case 'qrow': selectFromQueue(el.dataset.key); break;
      case 'chart': openChart(el.dataset.id, el.tagName === 'BUTTON' && el.classList.contains('card') && el.closest('#cards') && state.view === 'discover' ? true : false); break;
      case 'chip': state.chartSelId = el.dataset.id; renderMain(); break;
      case 'playall': playAllFromList(); break;
      case 'gocharts': setView('charts'); break;
      case 'godiscover': setView('discover'); break;
      case 'moresearch': doSearch(state.search, state.searchPage + 1); break;
      case 'moreplaylist': await loadMorePlaylists(); break;
      case 'srtab': switchSearchTab(el.dataset.tab); break;
      case 'plopen': state.plOpen = { id: el.dataset.id }; openPlaylist(el.dataset.id); break;
      case 'backsearch': state.plOpen = null; renderSearch(); break;
      case 'sddel': {
        e.stopPropagation();
        removeSearchHistory(el.dataset.kw || '');
        showToast('已删除该条搜索记录');
        break;
      }
      case 'sduse': {
        const kw = el.dataset.kw || '';
        const inp = $('searchInput');
        if (inp) { inp.value = kw; const w = $('searchWrap'); if (w) w.classList.add('has'); }
        openSearchDrop(false);
        doSearch(kw, 0);
        break;
      }
      case 'sdclear': clearSearchHistory(); break;
      case 'clearsearch': clearSearch(); break;
      case 'clearhistory': await clearHistory(); break;
      case 'pickdir': {
        const d = await API.pickDir();
        if (d) { state.settings.downloadDir = d; await API.storeSet({ settings: state.settings }); showToast('下载目录已更新'); renderMain(); }
        break;
      }
      case 'opendir': API.openDir((state.settings && state.settings.downloadDir) || ''); break;
      case 'playlocal': playLocal(el.dataset.file); break;
      case 'reveal': API.libReveal(el.dataset.file); break;
      case 'rmlib': await removeLib(el.dataset.file); break;
      case 'setq': setQuality(el.dataset.q); renderSettings(); break;
      case 'glow': state.ambientGlowOn = !state.ambientGlowOn; applyGlow(); renderSettings(); break;
      case 'cleardl': {
        if (!state.library.length) { showToast('没有已下载歌曲'); break; }
        for (const it of [...state.library]) { try { await API.libRemove(it.file); } catch (err) {} }
        state.library = await API.libList(); updateCounts(); renderMain(); showToast('已清空下载');
        break;
      }
      case 'checkupdate': showToast('当前已是最新版本 v2.4.0'); break;
      case 'closeLyrics': toggleLyrics(false); break;
    }
  });
  document.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.row[data-key]');
    if (row) { selectTrack(row.dataset.key); return; }
  });

  // 侧栏 / 顶栏
  document.querySelectorAll('[data-view]').forEach((b) => {
    if (b.id === 'settingsBtn' || b.classList.contains('nav-item') || b.classList.contains('mobilenav') || b.closest('.mobilenav')) {
      b.addEventListener('click', () => { if (b.dataset.view) setView(b.dataset.view); });
    }
  });
  $('histBack').addEventListener('click', histBack);
  $('histFwd').addEventListener('click', histFwd);
  $('refreshBtn').addEventListener('click', refreshView);
  $('qualityBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleQpop(e.currentTarget); });
  $('flacTag').addEventListener('click', (e) => { e.stopPropagation(); toggleQpop(e.currentTarget); });
  document.querySelectorAll('#qpop .qopt').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      setQuality(b.dataset.q);
      closeQpop();
    });
  });
  $('speedBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleSpop(e.currentTarget); });
  document.querySelectorAll('#spop .sp-opt').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      setSpeed(Number(b.dataset.v));
      closeSpop();
      showToast('播放倍速 ' + state.speed + 'x');
    });
  });
  document.addEventListener('mousedown', (e) => {
    const p = $('qpop');
    if (p && p.classList.contains('show') && !p.contains(e.target)
      && e.target.id !== 'flacTag' && e.target.id !== 'qualityBtn'
      && !e.target.closest('#flacTag') && !e.target.closest('#qualityBtn')) closeQpop();
    const sp = $('spop');
    if (sp && sp.classList.contains('show') && !sp.contains(e.target)
      && e.target.id !== 'speedBtn' && !e.target.closest('#speedBtn')) closeSpop();
  });
  window.addEventListener('resize', () => { closeQpop(); closeSpop(); });
  $('winMin').addEventListener('click', () => API.winMin());
  $('winMax').addEventListener('click', () => API.winMax());
  $('winClose').addEventListener('click', () => API.winClose());

  // 播放控制
  $('playBtn').addEventListener('click', togglePlay);
  $('prevBtn').addEventListener('click', prevTrack);
  $('nextBtn').addEventListener('click', nextTrack);
  $('modeBtn').addEventListener('click', cyclePlayMode);
  $('nowLike').addEventListener('click', (e) => {
    if (!state.current) return;
    const wasFav = isFav(state.current);
    toggleFav(state.current.key);
    if (!wasFav) {
      const r = e.currentTarget.getBoundingClientRect();
      spawnLikeParticles(r.left + r.width / 2, r.top + r.height / 2, true);
    }
  });
  $('queueBtn').addEventListener('click', () => toggleQueue());
  $('queueClose').addEventListener('click', () => toggleQueue(false));
  $('lyricsClose').addEventListener('click', () => toggleLyrics(false));
  $('muteBtn').addEventListener('click', toggleMute);
  $('nowDisc').addEventListener('click', () => toggleLyrics());
  $('nowTitle').addEventListener('click', () => toggleLyrics());
  $('nowArtist').addEventListener('click', () => toggleLyrics());

  // 音量
  $('volRange').addEventListener('input', (e) => {
    const v = Number(e.target.value) / 100;
    state.volume = v; state.muted = v === 0; audio.volume = v;
    state.settings.volume = v; API.storeSet({ settings: state.settings });
    updateVolumeUI();
  });

  // 进度条
  const prog = $('progress');
  let dragging = false;
  const seekAt = (clientX) => {
    const rail = prog.querySelector('.rail');
    const r = rail.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const dur = state.duration || (state.current && state.current.duration) || 0;
    if (!dur) return;
    const t = pct * dur;
    try { audio.currentTime = t; } catch (e) {}
    state.currentTime = t;
    updateProgressUI(); updateLyricHighlight();
  };
  prog.addEventListener('pointerdown', (e) => { dragging = true; try { prog.setPointerCapture(e.pointerId); } catch (err) {} seekAt(e.clientX); });
  prog.addEventListener('pointermove', (e) => { if (dragging) seekAt(e.clientX); });
  prog.addEventListener('pointerup', () => { dragging = false; });
  prog.addEventListener('pointercancel', () => { dragging = false; });
  prog.addEventListener('keydown', (e) => {
    const dur = state.duration || 0;
    if (e.key === 'ArrowRight') { state.currentTime = Math.min(dur, state.currentTime + 5); try { audio.currentTime = state.currentTime; } catch (err) {} updateProgressUI(); }
    if (e.key === 'ArrowLeft') { state.currentTime = Math.max(0, state.currentTime - 5); try { audio.currentTime = state.currentTime; } catch (err) {} updateProgressUI(); }
  });

  // 歌词点击跳转
  $('lyricsBody').addEventListener('click', (e) => {
    const line = e.target.closest('.ly-line');
    if (!line) return;
    const t = Number(line.dataset.t) || 0;
    try { audio.currentTime = t; } catch (err) {}
    state.currentTime = t;
    updateProgressUI(); updateLyricHighlight(true);
  });
  // 手动滚动歌词时暂停自动跟随 3 秒，滚完再回到当前句
  const lyricScrollPause = () => { LY_HOLD = performance.now() + 3000; LY_TARGET = null; };
  $('lyricsBody').addEventListener('wheel', lyricScrollPause, { passive: true });
  $('lyricsBody').addEventListener('touchmove', lyricScrollPause, { passive: true });

  // 搜索
  const input = $('searchInput');
  const w = $('searchWrap');
  const syncHas = () => { if (w) w.classList.toggle('has', !!(input && input.value)); };
  const run = debounce((v) => { if (v.trim()) doSearch(v, 0); else { state.search = ''; renderMain(); } }, 460);
  input.addEventListener('input', (e) => { syncHas(); run(e.target.value); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const v = input.value.trim(); if (v) { openSearchDrop(false); doSearch(v, 0); } } });
  input.addEventListener('focus', () => { renderSearchDrop(); openSearchDrop(true); });
  input.addEventListener('click', () => { renderSearchDrop(); openSearchDrop(true); });
  document.addEventListener('mousedown', (e) => {
    if (w && !w.contains(e.target)) openSearchDrop(false);
  });
  const sc = $('searchClear');
  if (sc) sc.addEventListener('click', () => { input.value = ''; syncHas(); openSearchDrop(false); clearSearch(); input.focus(); });
  const sd = $('sdClear');
  if (sd) sd.addEventListener('click', (e) => { e.stopPropagation(); clearSearchHistory(); });
  syncHas();

  // 空格播放/暂停
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); togglePlay(); }
    if (e.key === 'Escape') { if (state.lyricsOpen) toggleLyrics(false); if (state.queueOpen) toggleQueue(false); }
  });
}

/* ==========================================================================
   音频事件 / 持久化 / 启动
   ========================================================================== */
function bindAudio() {
  audio.addEventListener('timeupdate', () => {
    state.currentTime = audio.currentTime;
    updateProgressUI();
    if (state.lyricsOpen) updateLyricHighlight();
  });
  audio.addEventListener('loadedmetadata', () => {
    if (isFinite(audio.duration) && audio.duration > 0) { state.duration = audio.duration; updateProgressUI(); }
  });
  audio.addEventListener('play', () => { state.isPlaying = true; syncPlayState(); });
  audio.addEventListener('pause', () => { state.isPlaying = false; syncPlayState(); });
  audio.addEventListener('ended', onEnded);
  audio.addEventListener('error', () => { if (audio.src) showToast('音频加载出错'); });
}
function applyGlow() {
  const a = $('glowA'), b = $('glowB');
  if (a) a.style.opacity = state.ambientGlowOn ? '.5' : '0';
  if (b) b.style.opacity = state.ambientGlowOn ? '.5' : '0';
}
async function loadStore() {
  try {
    const s = await API.storeGet();
    state.settings = Object.assign({ quality: '320k', volume: 0.9, rate: 1 }, (s && s.settings) || {});
    state.quality = state.settings.quality || '320k';
    state.volume = typeof state.settings.volume === 'number' ? state.settings.volume : 0.9;
    state.speed = state.settings.rate || 1;
    state.favorites = ((s && s.favorites) || []).map(toTrack);
    state.history = ((s && s.history) || []).map(toTrack);
    state.searchHistory = Array.isArray(state.settings.searchHistory) ? state.settings.searchHistory.slice(0, 12) : [];
    reg(state.favorites); reg(state.history);
  } catch (e) {}
  try { state.library = await API.libList(); } catch (e) { state.library = []; }
  if (!Q_LABEL[state.quality]) state.quality = '320k';
  syncSpeedUI();
  syncQualityUI();
  audio.volume = state.volume;
  audio.playbackRate = state.speed;
}
async function boot() {
  if (boot._done) return;
  boot._done = true;
  bindAudio();
  bindEvents();
  document.body.classList.add('paused');
  try { API.onWinState(() => {}); } catch (e) {}
  await loadStore();
  try { const v = await API.appVersion(); const el = $('appVer'); if (v && el) el.textContent = 'v' + v; } catch (e) {}
  updateCounts(); updateVolumeUI(); updateModeBtn(); updateHistBtns(); syncPlayState(); updateProgressUI();
  applyGlow();
  renderMain();
  try { getCharts(); } catch (e) {}
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
