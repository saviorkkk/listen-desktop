'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const fsp = fs.promises;

/* ================================================================== */
/* 接口配置                                                            */
/* ================================================================== */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const KUWO_REF = 'http://www.kuwo.cn/';

/* 有声书（保留，作为 App 的次要模块） */
const SB_BASE = 'https://backend.appmiaoda.com/projects/supabase364143248983240704';
const SB_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoyMTA2MjQ1NzE2LCJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIiwic3ViIjoiYW5vbiJ9.hIxrDQcZb3uM-yggkosEsRuBuPlzSAIFK2S_h_OcCyU';
const FN = SB_BASE + '/functions/v1';
const LRTS_PROXY = 'http://www.tingshu8.top/yuan1/lrts.php';

/* ================================================================== */
/* 本地存储                                                            */
/* ================================================================== */
const DATA_DIR = path.join(app.getPath('userData'), 'data');
const LIB_FILE = path.join(DATA_DIR, 'library.json');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const DL_DIR = path.join(app.getPath('music'), '聆听下载');

async function ensureDirs() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(DL_DIR, { recursive: true });
}

function readJsonSync(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

let saveTimer = null;
function scheduleSave(file, data) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await ensureDirs();
      await fsp.writeFile(file, JSON.stringify(data), 'utf8');
    } catch (e) {
      console.error('save fail', e);
    }
  }, 400);
}

const defaultSettings = {
  quality: '320k',
  volume: 0.9,
  rate: 1,
  downloadDir: DL_DIR,
  autoNext: true,
};

let STORE = readJsonSync(STORE_FILE, {});
STORE.settings = Object.assign({}, defaultSettings, STORE.settings || {});
STORE.favorites = STORE.favorites || [];
STORE.history = STORE.history || [];
STORE.playlists = STORE.playlists || [];
const saveStore = () => scheduleSave(STORE_FILE, STORE);

let LIB = readJsonSync(LIB_FILE, { items: [] });
if (!Array.isArray(LIB.items)) LIB = { items: [] };
const saveLib = () => scheduleSave(LIB_FILE, LIB);

/* ================================================================== */
/* HTTP                                                               */
/* ================================================================== */
async function fetchText(url, opts = {}, timeout = 20000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctl.signal,
      headers: Object.assign({ 'User-Agent': UA }, opts.headers || {}),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, opts = {}, timeout = 20000) {
  const r = await fetchText(url, opts, timeout);
  try {
    return { ...r, data: JSON.parse(r.text) };
  } catch {
    return { ...r, data: null };
  }
}

/**
 * 酷我搜索返回单引号 JS 对象字面量，不是标准 JSON。
 * 用沙箱 vm 解析，带超时，不执行任何 IO。
 */
function parseKuwoLiteral(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  // 标准 JSON 先试
  try {
    return JSON.parse(t);
  } catch {}
  try {
    const ctx = vm.createContext(Object.create(null), {
      codeGeneration: { strings: false, wasm: false },
    });
    return vm.runInContext('(' + t + ')', ctx, { timeout: 2000 });
  } catch (e) {
    console.error('parseKuwoLiteral fail', e.message);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 酷我音乐                                                            */
/* ------------------------------------------------------------------ */
const COVER_HOSTS = ['img4', 'img1', 'img2', 'img3'];

/** 拼封面：web_albumpic_short 形如 "120/s4s55/27/258803629.jpg" */
function coverUrl(short, size) {
  if (!short) return '';
  const p = String(short).replace(/^\d+\//, '');
  if (!p) return '';
  return `https://img4.kuwo.cn/star/albumcover/${size || 300}/${p}`;
}

function coverCandidates(short) {
  const p = String(short || '').replace(/^\d+\//, '');
  if (!p) return [];
  return COVER_HOSTS.map((h) => `https://${h}.kuwo.cn/star/albumcover/300/${p}`);
}

/**
 * 按 rid 取图。注意：artistpicserver 返回的是【纯文本图片地址】而不是图片本身，
 * 所以这里先返回 `rid:<id>` 标记，由 resolveCover 二次请求拿到真实图片 URL。
 */
function ridCover(rid) {
  const id = String(rid || '').replace(/^MUSIC_/, '');
  if (!id) return '';
  return `rid:${id}`;
}

const RID_COVER_CACHE = new Map();
const RID_COVER_PENDING = new Map();

/** 解析 rid → 真实封面 URL（带缓存与并发去重） */
async function resolveCover(rid) {
  const id = String(rid || '').replace(/^MUSIC_/, '').replace(/^rid:/, '');
  if (!id) return '';
  if (RID_COVER_CACHE.has(id)) return RID_COVER_CACHE.get(id);
  if (RID_COVER_PENDING.has(id)) return RID_COVER_PENDING.get(id);
  const task = (async () => {
    try {
      const r = await fetchText(
        `http://artistpicserver.kuwo.cn/pic.web?type=rid_pic&pictype=500&size=500&rid=${id}`,
        { headers: { Referer: 'http://www.kuwo.cn/' } },
        8000
      );
      const t = String(r.text || '').trim();
      const m = t.match(/https?:\/\/[^\s'"]+/);
      const url = m ? m[0] : '';
      RID_COVER_CACHE.set(id, url);
      return url;
    } catch {
      RID_COVER_CACHE.set(id, '');
      return '';
    } finally {
      RID_COVER_PENDING.delete(id);
    }
  })();
  RID_COVER_PENDING.set(id, task);
  return task;
}

function decodeEnt(s) {
  return String(s == null ? '' : s)
    .replace(/\\u0026/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\\\\/g, '\\')
    .trim();
}

const QUALITY_TAG = { '128k': 'MP3128', '320k': 'MP3H' };

/* App 同源后端：kuwo-play 支持 128 / 320 / 无损(flac) 三档，并附带歌词 */
const APP_BACKEND = 'https://backend.appmiaoda.com/projects/supabase364143248983240704/functions/v1';
const APP_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoyMTA2MjQ1NzE2LCJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIiwic3ViIjoiYW5vbiJ9.hIxrDQcZb3uM-yggkosEsRuBuPlzSAIFK2S_h_OcCyU';
const QUALITY_MAP = { '128k': '128', '320k': '320', flac: 'flac' };

/**
 * 搜索歌曲
 * abslist[] 关键字段：NAME/SONGNAME ARTIST ALBUM ALBUMID MUSICRID DC_TARGETID
 *                     DURATION web_albumpic_short web_artistpic_short PAY FORMATS
 */
async function musicSearch(keyword, page = 0, size = 100) {
  const rn = Math.min(Math.max(Number(size) || 100, 1), 100);
  const pn = Math.max(Number(page) || 0, 0);
  // 酷我移动端全量搜索接口：返回完整曲库（abslist，HIT 为总命中数）
  const url =
    `http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(keyword)}` +
    `&pn=${pn}&rn=${rn}&uid=0&ver=kwplayer_ar_9.2.2.1&vipver=1` +
    `&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012` +
    `&encoding=utf8&rformat=json&vermerge=1&mobi=1`;
  const r = await fetchText(url, { headers: { Referer: KUWO_REF } });
  const j = parseKuwoLiteral(r.text);
  if (!j) throw new Error('搜索解析失败');

  const list = (j.abslist || []).map((a) => {
    const short = a.web_albumpic_short || '';
    const rid = a.MUSICRID || 'MUSIC_' + a.DC_TARGETID;
    return {
      source: 'kuwo',
      id: String(a.DC_TARGETID || String(rid).replace('MUSIC_', '')),
      rid,
      name: decodeEnt(a.SONGNAME || a.NAME),
      artist: decodeEnt(a.ARTIST || a.AARTIST),
      album: decodeEnt(a.ALBUM),
      albumId: a.ALBUMID && a.ALBUMID !== '0' ? String(a.ALBUMID) : '',
      duration: Number(a.DURATION) || 0,
      cover: short ? coverCandidates(short) : [ridCover(rid)],
      artistPic: a.web_artistpic_short ? coverUrl(a.web_artistpic_short, 240) : '',
      formats: a.FORMATS || '',
      pay: String(a.PAY || '0') !== '0',
      artistId: a.ARTISTID && a.ARTISTID !== '0' ? String(a.ARTISTID) : '',
    };
  });

  return { list, total: Number(j.HIT || j.TOTAL) || list.length };
}

/**
 * 搜索歌单（与手机 App「歌单」分组一致）
 * 返回 abslist[]：playlistid/name/nickname/pic/hts_pic/songnum/playcnt/tags/intro
 */
async function musicSearchPlaylist(keyword, page = 0, size = 30) {
  const rn = Math.min(Math.max(Number(size) || 30, 1), 100);
  const pn = Math.max(Number(page) || 0, 0);
  const url =
    `http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(keyword)}` +
    `&pn=${pn}&rn=${rn}&uid=0&ver=kwplayer_ar_9.2.2.1&vipver=1` +
    `&show_copyright_off=1&newver=1&ft=playlist&cluster=0&strategy=2012` +
    `&encoding=utf8&rformat=json&vermerge=1&mobi=1`;
  const r = await fetchText(url, { headers: { Referer: KUWO_REF } });
  const j = parseKuwoLiteral(r.text);
  if (!j) throw new Error('歌单搜索解析失败');

  const list = (j.abslist || []).map((a) => ({
    id: String(a.playlistid || a.DC_TARGETID || ''),
    name: decodeEnt(a.name),
    author: decodeEnt(a.nickname) || '酷我用户',
    cover: a.hts_pic || a.pic || '',
    songNum: Number(a.songnum) || 0,
    playCount: Number(a.playcnt) || 0,
    tags: decodeEnt(a.tags || ''),
    intro: decodeEnt(a.intro || ''),
  })).filter((x) => x.id);

  return { list, total: Number(j.HIT || j.TOTAL) || list.length };
}

/**
 * 歌单详情
 * nplserver.kuwo.cn/pl.svc 返回 {title,pic,info,total,musiclist[]}
 * musiclist 字段：id/name/artist/album/albumid/artistid/duration/albumpic/formats
 */
async function playlistInfo(pid, page = 0, size = 200) {
  const rn = Math.min(Math.max(Number(size) || 200, 1), 500);
  const pn = Math.max(Number(page) || 0, 0);
  const url =
    `http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${encodeURIComponent(pid)}` +
    `&pn=${pn}&rn=${rn}&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1` +
    `&vipver=MUSIC_9.1.0.0_W1&newver=1`;
  const r = await fetchJson(url, { headers: { Referer: KUWO_REF } }, 25000);
  if (!r.data) throw new Error('歌单详情获取失败');
  const j = r.data;

  const list = (j.musiclist || []).map((m, i) => ({
    source: 'kuwo',
    id: String(m.id),
    rid: 'MUSIC_' + m.id,
    name: decodeEnt(m.name),
    artist: decodeEnt(m.artist),
    album: decodeEnt(m.album),
    albumId: m.albumid ? String(m.albumid) : '',
    artistId: m.artistid ? String(m.artistid) : '',
    duration: Number(m.duration) || 0,
    cover: [ridCover(m.id)],
    formats: m.formats || '',
    rank: i + 1 + pn * rn,
  }));
  // 歌单自带封面（700px），直接给到每首做兜底
  const plPic = j.pic || '';
  if (plPic) list.forEach((s) => { if (!s.cover.length) s.cover = [plPic]; });

  return {
    id: String(j.id || pid),
    name: decodeEnt(j.title) || '歌单',
    author: decodeEnt(j.uname) || '酷我用户',
    cover: plPic,
    intro: decodeEnt(j.info || ''),
    tags: decodeEnt(j.tag || ''),
    playCount: Number(j.playnum) || 0,
    total: Number(j.total) || list.length,
    list,
  };
}

/** 播放直链：优先走 App 同源后端（三档音质 + 歌词），失败再退回 anti.s */
async function musicUrl(rid, quality) {
  const id = String(rid).startsWith('MUSIC_') ? rid : 'MUSIC_' + rid;
  const q = QUALITY_MAP[quality] || '320';

  // 主通道：与手机 App 完全一致的 kuwo-play 接口
  try {
    const r = await fetchText(
      `${APP_BACKEND}/kuwo-play?rid=${encodeURIComponent(id)}&quality=${q}`,
      { headers: { apikey: APP_ANON_KEY, Authorization: 'Bearer ' + APP_ANON_KEY } },
      15000
    );
    const j = parseKuwoLiteral(r.text);
    if (j && j.url && /^https?:\/\//i.test(j.url)) {
      return { url: j.url, quality: q, ttl: 28 * 60 * 1000, lyric: j.lyric || '' };
    }
  } catch (e) {
    console.error('kuwo-play fail:', e.message);
  }

  // 兜底：anti.s（仅 mp3/aac；无损不可用自动降级到 320）
  const fmt = q === 'flac' ? 'flac' : 'mp3';
  const url = `http://antiserver.kuwo.cn/anti.s?type=convert_url&response=url&rid=${encodeURIComponent(
    id
  )}&format=${fmt}`;
  const r2 = await fetchText(url, { headers: { Referer: KUWO_REF } }, 15000);
  const text = (r2.text || '').trim();
  if (!text || /refuse|deny|error/i.test(text) || !/^https?:\/\//i.test(text)) {
    if (q === 'flac') return musicUrl(rid, '320k');
    throw new Error('该歌曲暂无可用户播放地址');
  }
  return { url: text, quality: q, ttl: 30 * 60 * 1000, lyric: '' };
}

/**
 * 榜单列表
 * 注意：qukudata 下发的新 id（80358 / 490742 …）kbangserver 不认，
 * 只有下面这批老 id 能取到歌，已逐个实测。
 */
const CHARTS = [
  { id: '16', name: '酷我热歌榜' },
  { id: '93', name: '酷我飙升榜' },
  { id: '17', name: '酷我新歌榜' },
  { id: '26', name: '酷我经典榜' },
  { id: '62', name: '酷我华语榜' },
  { id: '22', name: '酷我欧美榜' },
  { id: '23', name: '酷我日韩榜' },
  { id: '64', name: '酷我影视榜' },
  { id: '63', name: '酷我网络榜' },
  { id: '68', name: 'DJ舞曲榜' },
  { id: '69', name: '儿童歌曲榜' },
  { id: '65', name: '我是歌手榜' },
  { id: '72', name: '中国好声音榜' },
  { id: '25', name: '钱柜KTV榜' },
  { id: '52', name: '钱柜KTV国语榜' },
  { id: '53', name: '钱柜KTV粤语榜' },
  { id: '18', name: '酷我MV榜' },
  { id: '55', name: '酷我热歌MV榜' },
  { id: '1', name: '中国歌曲排行榜' },
  { id: '21', name: '百度热歌榜' },
  { id: '20', name: '百度新歌榜' },
  { id: '27', name: '中国TOP排行榜' },
  { id: '12', name: 'Billboard Hot 100' },
  { id: '13', name: '英国 UK Official' },
  { id: '14', name: '韩国 M-net' },
  { id: '15', name: '日本 ORICON' },
  { id: '49', name: 'iTunes 单曲榜' },
  { id: '66', name: 'APE无损音乐榜' },
];

function chartNodes() {
  return CHARTS.slice();
}

/** 榜单歌曲 */
async function chartSongs(bangId, page = 0, size = 100) {
  const url =
    `http://kbangserver.kuwo.cn/ksong.s?from=pc&fmt=json&pn=${page}&rn=${size}` +
    `&type=bang&data=content&id=${encodeURIComponent(bangId)}` +
    `&show_copyright_off=0&pcmp4=1&isbang=1`;
  const r = await fetchJson(url, { headers: { Referer: KUWO_REF } }, 25000);
  if (!r.data) throw new Error('榜单歌曲获取失败');
  const j = r.data;
  const list = (j.musiclist || []).map((m, i) => ({
    source: 'kuwo',
    id: String(m.id),
    rid: 'MUSIC_' + m.id,
    name: decodeEnt(m.name),
    artist: decodeEnt(m.artist),
    album: decodeEnt(m.album),
    albumId: m.albumid ? String(m.albumid) : '',
    duration: Number(m.song_duration || m.duration) || 0,
    cover: [ridCover(m.id)],
    rank: i + 1 + page * size,
    artistId: m.artistid ? String(m.artistid) : '',
  }));
  return {
    name: decodeEnt(j.name),
    total: Number(j.num) || list.length,
    list,
    cover: j.v9_pic2 || j.pic || '',
  };
}

/** 专辑详情 */
async function albumInfo(albumId) {
  const url = `http://search.kuwo.cn/r.s?stype=albuminfo&albumid=${encodeURIComponent(
    albumId
  )}&pn=0&rn=100&rformat=json&encoding=utf8`;
  const r = await fetchText(url, { headers: { Referer: KUWO_REF } });
  const j = parseKuwoLiteral(r.text);
  if (!j) throw new Error('专辑解析失败');

  const songs = (j.musiclist || []).map((m) => ({
    source: 'kuwo',
    id: String(m.id),
    rid: 'MUSIC_' + m.id,
    name: decodeEnt(m.name),
    artist: decodeEnt(m.artist),
    album: decodeEnt(m.album || j.name),
    albumId: String(albumId),
    duration: Number(m.duration) || 0,
    cover: [],
  }));

  const pic = j.hts_img || j.img || '';
  const finalPic = pic || ridCover(songs[0] && songs[0].id);
  songs.forEach((s) => (s.cover = finalPic ? [finalPic] : []));
  return {
    album: {
      id: String(albumId),
      name: decodeEnt(j.name || j.album),
      artist: decodeEnt(j.artist || j.fartist),
      cover: finalPic,
      company: decodeEnt(j.company),
      songNum: songs.length,
      desc: decodeEnt(j.info || ''),
    },
    songs,
  };
}

/** 歌手详情 */
async function artistInfo(artistId) {
  const url = `http://search.kuwo.cn/r.s?stype=artistinfo&artistid=${encodeURIComponent(
    artistId
  )}&pn=0&rn=20&rformat=json&encoding=utf8`;
  const r = await fetchText(url, { headers: { Referer: KUWO_REF } });
  const j = parseKuwoLiteral(r.text);
  if (!j) throw new Error('歌手解析失败');
  return {
    id: String(artistId),
    name: decodeEnt(j.name),
    pic: j.hts_pic || coverUrl(j.pic, 240),
    musicNum: Number(j.musicnum) || 0,
    albumNum: Number(j.albumnum) || 0,
    area: decodeEnt(j.country || j.birthplace),
    desc: decodeEnt(j.info || '').slice(0, 800),
  };
}

/** 歌手歌曲 */
async function artistSongs(artistId, page = 0, size = 30) {
  const url =
    `http://search.kuwo.cn/r.s?stype=artistinfo&artistid=${encodeURIComponent(artistId)}` +
    `&pn=${page}&rn=${size}&rformat=json&encoding=utf8`;
  const r = await fetchText(url, { headers: { Referer: KUWO_REF } });
  const j = parseKuwoLiteral(r.text);
  if (!j) return [];
  const arr = j.musiclist || j.songlist || [];
  return arr.map((m) => ({
    source: 'kuwo',
    id: String(m.id),
    rid: 'MUSIC_' + m.id,
    name: decodeEnt(m.name || m.songname),
    artist: decodeEnt(m.artist || j.name),
    album: decodeEnt(m.album),
    albumId: m.albumid ? String(m.albumid) : '',
    duration: Number(m.duration) || 0,
    cover: [ridCover(m.id)],
  }));
}

/** 歌词：优先网易（酷我接口 301 拒绝） */
async function lyric(name, artist, duration) {
  try {
    const q = encodeURIComponent(`${name} ${artist}`.trim());
    const s = await fetchJson(
      `https://music.163.com/api/search/get?s=${q}&type=1&offset=0&limit=5`,
      { headers: { Referer: 'https://music.163.com/' } },
      12000
    );
    const songs = (s.data && s.data.result && s.data.result.songs) || [];
    if (!songs.length) return '';
    // 时长最接近的一首
    let best = songs[0];
    if (duration) {
      let diff = Infinity;
      for (const x of songs) {
        const d = Math.abs((x.duration || 0) / 1000 - duration);
        if (d < diff) {
          diff = d;
          best = x;
        }
      }
    }
    const l = await fetchJson(
      `https://music.163.com/api/song/lyric?id=${best.id}&lv=1&kv=1&tv=-1`,
      { headers: { Referer: 'https://music.163.com/' } },
      12000
    );
    const raw = (l.data && l.data.lrc && l.data.lrc.lyric) || '';
    return raw;
  } catch {
    return '';
  }
}

/* ================================================================== */
/* IPC：音乐                                                           */
/* ================================================================== */
const wrap = (fn) => async (_e, ...args) => {
  try {
    return { ok: true, data: await fn(...args) };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
};

ipcMain.handle('m:search', wrap(musicSearch));
ipcMain.handle('m:searchPlaylist', wrap(musicSearchPlaylist));
ipcMain.handle('m:playlist', wrap(playlistInfo));
ipcMain.handle('m:chartNodes', wrap(chartNodes));
ipcMain.handle('m:chartSongs', wrap(chartSongs));
ipcMain.handle('m:album', wrap(albumInfo));
ipcMain.handle('m:artist', wrap(artistInfo));
ipcMain.handle('m:artistSongs', wrap(artistSongs));
ipcMain.handle('m:lyric', wrap(lyric));
ipcMain.handle('m:url', wrap(musicUrl));
ipcMain.handle('m:cover', wrap(resolveCover));

/* ================================================================== */
/* IPC：有声书（兼容保留）                                              */
/* ================================================================== */
async function callFn(endpoint, params = {}, timeout = 25000) {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const r = await fetchJson(
    FN + endpoint + (qs ? '?' + qs : ''),
    { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } },
    timeout
  );
  if (r.data) return r.data;
  if (!r.ok) throw new Error(`接口 ${endpoint} HTTP ${r.status}`);
  throw new Error(`接口 ${endpoint} 非 JSON`);
}

ipcMain.handle('api:call', wrap(callFn));
ipcMain.handle(
  'book:resolve',
  wrap(async (req) => {
    if (req.source === 'lrts') {
      const id = `${req.bookId}*${req.section}`;
      const r = await fetchJson(LRTS_PROXY + '?id=' + encodeURIComponent(id), {}, 15000);
      if (!r.data || !r.data.data || !r.data.data.url) throw new Error('地址解析失败');
      return { url: r.data.data.url, ttl: 24 * 3600 * 1000 };
    }
    const j = await callFn('/kuwo-play', { rid: req.rid, quality: req.quality || '320k' });
    if (!j || !j.url) throw new Error('地址解析失败');
    return { url: j.url, lyric: j.lyric || '', ttl: 15 * 60 * 1000 };
  })
);

/* ================================================================== */
/* 下载                                                                */
/* ================================================================== */
function safeName(s) {
  return String(s || 'untitled')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

async function downloadOne(job, onProgress) {
  const dir = path.join(job.dir);
  await fsp.mkdir(dir, { recursive: true });
  const ext = job.ext || (job.url.includes('.m4a') ? 'm4a' : job.url.includes('.flac') ? 'flac' : 'mp3');
  const file = path.join(dir, `${safeName(job.fileName)}.${ext}`);
  if (fs.existsSync(file) && fs.statSync(file).size > 1024) return { file, skipped: true };

  const ctl = new AbortController();
  const res = await fetch(job.url, {
    signal: ctl.signal,
    headers: { 'User-Agent': UA, Referer: KUWO_REF },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const total = Number(res.headers.get('content-length') || 0);
  const tmp = file + '.part';
  const out = fs.createWriteStream(tmp);
  let got = 0;
  let last = 0;
  for await (const chunk of res.body) {
    got += chunk.length;
    out.write(chunk);
    const now = Date.now();
    if (now - last > 300) {
      last = now;
      onProgress && onProgress({ got, total });
    }
  }
  await new Promise((r) => out.end(r));
  await fsp.rename(tmp, file);
  return { file, size: got };
}

ipcMain.handle('dl:batch', async (e, payload) => {
  const { items, ext } = payload;
  const dir = payload.dir || (STORE.settings && STORE.settings.downloadDir) || DL_DIR;
  const results = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    try {
      const r = await downloadOne({ ...it, dir, ext }, (p) => {
        e.sender.send('dl:progress', { index: i, total: items.length, title: it.fileName, ...p });
      });
      results.push({ ok: true, title: it.fileName, file: r.file, skipped: r.skipped, rid: it.rid || '', covers: it.covers || '' });
    } catch (err) {
      results.push({ ok: false, title: it.fileName, error: String(err.message || err) });
    }
    e.sender.send('dl:progress', { index: i, total: items.length, title: it.fileName, done: true });
  }
  for (const r of results) {
    if (r.ok) {
      LIB.items = LIB.items.filter((x) => x.file !== r.file);
      LIB.items.push({ file: r.file, title: r.title, rid: r.rid || '', covers: r.covers || '', addedAt: Date.now() });
    }
  }
  saveLib();
  return results;
});

ipcMain.handle('dl:pickDir', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
});

ipcMain.handle('dl:openDir', async (_e, dir) => {
  const d = dir || STORE.settings.downloadDir || DL_DIR;
  await fsp.mkdir(d, { recursive: true }).catch(() => {});
  shell.openPath(d);
  return d;
});

ipcMain.handle('lib:list', async () => {
  const items = [];
  for (const it of LIB.items) {
    let size = 0;
    try {
      size = (await fsp.stat(it.file)).size;
    } catch {}
    items.push({ ...it, size });
  }
  return items;
});

ipcMain.handle('lib:remove', async (_e, file) => {
  LIB.items = LIB.items.filter((x) => x.file !== file);
  saveLib();
  try {
    await fsp.unlink(file);
  } catch {}
  return true;
});

ipcMain.handle('lib:reveal', async (_e, file) => {
  shell.showItemInFolder(file);
  return true;
});

/* ================================================================== */
/* 收藏 / 历史                                                         */
/* ================================================================== */
ipcMain.handle('store:get', async () => STORE);
ipcMain.handle('store:set', async (_e, patch) => {
  STORE = Object.assign({}, STORE, patch);
  saveStore();
  return STORE;
});

ipcMain.handle('store:favToggle', async (_e, item) => {
  const key = `${item.source}:${item.id}`;
  const idx = STORE.favorites.findIndex((x) => `${x.source}:${x.id}` === key);
  if (idx >= 0) {
    STORE.favorites.splice(idx, 1);
    saveStore();
    return { added: false };
  }
  STORE.favorites.unshift(Object.assign({ addedAt: Date.now() }, item));
  saveStore();
  return { added: true };
});

ipcMain.handle('store:historyPush', async (_e, entry) => {
  const key = `${entry.source}:${entry.id}`;
  STORE.history = STORE.history.filter((x) => `${x.source}:${x.id}` !== key);
  STORE.history.unshift(Object.assign({ ts: Date.now() }, entry));
  if (STORE.history.length > 300) STORE.history.length = 300;
  saveStore();
  return true;
});

ipcMain.handle('store:historyClear', async () => {
  STORE.history = [];
  saveStore();
  return true;
});

/* ================================================================== */
/* 窗口                                                                */
/* ================================================================== */
let win = null;

function createWindow() {
  // 按主屏工作区（DIP）自适应，避免高 DPI 下窗口超出屏幕导致右侧被裁掉
  let w = 1280;
  let h = 820;
  try {
    const area = screen.getPrimaryDisplay().workAreaSize;
    w = Math.min(1280, Math.max(1000, area.width - 40));
    h = Math.min(820, Math.max(640, area.height - 40));
  } catch (_) {
    /* 用默认值 */
  }
  win = new BrowserWindow({
    width: w,
    height: h,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#070a14',
    title: '聆听',
    frame: false,
    show: false,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
  });

  // 禁用系统「最大化」语义：这样 Windows 不会把标题栏双击解释成最大化，
  // 拖拽区（-webkit-app-region:drag，本质是 HTCAPTION）就不会一拖就变大。
  // 自绘的最大化按钮走下面的 win:max，用 workArea 手动铺满。
  win.setMaximizable(false);

  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => (win = null));
  trackNormalBounds();

  const push = () => win && win.webContents.send('win:state', { max: isMaxed() });
  win.on('maximize', push);
  win.on('unmaximize', push);

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.handle('win:min', () => win && win.minimize());
/* 自绘最大化：不调用系统 maximize()，改为把窗口铺满当前显示器工作区。
   这样可以保持 setMaximizable(false)，彻底避免标题栏双击最大化。
   normalBounds 只在「用户自己调整尺寸」时更新，绝不在最大化往返里重读，
   否则 125% 缩放下 DIP↔物理像素每轮往返都会多 1~2px，越切越大。 */
let fakeMax = false;
let normalBounds = null;

const isMaxed = () => fakeMax;

function trackNormalBounds() {
  if (!win || win.isDestroyed()) return;
  win.on('resize', () => {
    if (!fakeMax && !win.isMaximized()) normalBounds = win.getBounds();
  });
  win.on('move', () => {
    if (!fakeMax && !win.isMaximized()) normalBounds = win.getBounds();
  });
  win.once('ready-to-show', () => {
    if (!normalBounds) normalBounds = win.getBounds();
  });
}

ipcMain.handle('win:max', () => {
  if (!win || win.isDestroyed()) return false;
  if (fakeMax) {
    if (normalBounds) win.setBounds(normalBounds);
    fakeMax = false;
  } else {
    if (!normalBounds) normalBounds = win.getBounds();
    fakeMax = true;
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    win.setBounds({ x: area.x, y: area.y, width: area.width, height: area.height });
  }
  if (win.webContents) win.webContents.send('win:state', { max: fakeMax });
  return fakeMax;
});
ipcMain.handle('win:close', () => win && win.close());

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(async () => {
    await ensureDirs();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
