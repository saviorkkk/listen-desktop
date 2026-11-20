'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('L', {
  // 音乐
  mSearch: (kw, pn, rn) => ipcRenderer.invoke('m:search', kw, pn, rn),
  mSearchPlaylist: (kw, pn, rn) => ipcRenderer.invoke('m:searchPlaylist', kw, pn, rn),
  mPlaylist: (id, pn, rn) => ipcRenderer.invoke('m:playlist', id, pn, rn),
  mChartNodes: () => ipcRenderer.invoke('m:chartNodes'),
  mChartSongs: (id, pn, rn) => ipcRenderer.invoke('m:chartSongs', id, pn, rn),
  mAlbum: (id) => ipcRenderer.invoke('m:album', id),
  mArtist: (id) => ipcRenderer.invoke('m:artist', id),
  mArtistSongs: (id, pn) => ipcRenderer.invoke('m:artistSongs', id, pn),
  mLyric: (n, a, d) => ipcRenderer.invoke('m:lyric', n, a, d),
  mUrl: (rid, quality) => ipcRenderer.invoke('m:url', rid, quality),
  mCover: (rid) => ipcRenderer.invoke('m:cover', rid),

  // 有声书（保留）
  api: (endpoint, params) => ipcRenderer.invoke('api:call', endpoint, params),
  bookResolve: (req) => ipcRenderer.invoke('book:resolve', req),

  // 下载
  downloadBatch: (payload) => ipcRenderer.invoke('dl:batch', payload),
  pickDir: () => ipcRenderer.invoke('dl:pickDir'),
  openDir: (dir) => ipcRenderer.invoke('dl:openDir', dir),
  onDownloadProgress: (cb) => ipcRenderer.on('dl:progress', (_e, p) => cb(p)),

  // 本地库
  libList: () => ipcRenderer.invoke('lib:list'),
  libRemove: (f) => ipcRenderer.invoke('lib:remove', f),
  libReveal: (f) => ipcRenderer.invoke('lib:reveal', f),

  // 状态
  storeGet: () => ipcRenderer.invoke('store:get'),
  storeSet: (patch) => ipcRenderer.invoke('store:set', patch),
  favToggle: (item) => ipcRenderer.invoke('store:favToggle', item),
  historyPush: (entry) => ipcRenderer.invoke('store:historyPush', entry),
  historyClear: () => ipcRenderer.invoke('store:historyClear'),

  // 窗口
  winMin: () => ipcRenderer.invoke('win:min'),
  winMax: () => ipcRenderer.invoke('win:max'),
  winClose: () => ipcRenderer.invoke('win:close'),
  onWinState: (cb) => ipcRenderer.on('win:state', (_e, s) => cb(s)),
});
