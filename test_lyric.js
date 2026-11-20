const http = require('http');

function targets(port){return new Promise((res,rej)=>{http.get(`http://127.0.0.1:${port}/json`,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}})}).on('error',rej)})}

class CDP{constructor(url){this.ws=new WebSocket(url);this.id=0;this.pending=new Map();this.ready=new Promise((res,rej)=>{this.ws.onopen=()=>res();this.ws.onerror=()=>rej(new Error('ws fail'))});this.ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)}}}
send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}))})}
async ev(expr){const r=await this.send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||'eval err');return r.result.value}}

const EXPR = `(async () => {
  const wait = ms => new Promise(r=>setTimeout(r,ms));
  let rows = document.querySelectorAll('.song-row');
  if (!rows.length) { const nav=document.querySelector('.nav-item[data-page="home"]'); if(nav) nav.click(); await wait(3000); }
  rows = document.querySelectorAll('.song-row');
  const rowCount = rows.length;
  if (rows.length) { const t = rows[2]||rows[0]; t.click(); }
  await wait(5000);
  const thumb=document.getElementById('pThumb'); if(thumb) thumb.click();
  await wait(2000);
  const panel=document.getElementById('lyricPanel');
  const footer=document.querySelector('.player');
  const pr=panel.getBoundingClientRect();
  const fr=footer?footer.getBoundingClientRect():null;
  const lines=[...document.querySelectorAll('.lyric-line')];
  const meta=document.getElementById('lyricMeta');
  const lb=document.querySelector('.lyric-body');
  const cs=lb?getComputedStyle(lb):null;
  const lbr=lb?lb.getBoundingClientRect():null;
  const firstLine=lines[0];
  return {
    title: (document.getElementById('npTitle')||{}).textContent,
    artist: (document.getElementById('npArtist')||{}).textContent,
    rowCount, vh: window.innerHeight, vw: window.innerWidth,
    panelOpen: panel.classList.contains('open'),
    panelRect: {top:Math.round(pr.top),bottom:Math.round(pr.bottom),left:Math.round(pr.left),right:Math.round(pr.right),h:Math.round(pr.height)},
    footerRect: fr?{top:Math.round(fr.top),bottom:Math.round(fr.bottom),h:Math.round(fr.height)}:null,
    footerHit: (()=>{const el=document.elementFromPoint(window.innerWidth/2, window.innerHeight-46);return el?(el.className||el.tagName):null})(),
    metaDisplay: meta?getComputedStyle(meta).display:null,
    metaText: meta?meta.textContent.slice(0,140):null,
    metaCount: meta?meta.querySelectorAll('span').length:0,
    lineCount: lines.length,
    textAlign: cs?cs.textAlign:null,
    lineHeight: firstLine?getComputedStyle(firstLine).lineHeight:null,
    fontSize: firstLine?getComputedStyle(firstLine).fontSize:null,
    onCount: document.querySelectorAll('.lyric-line.on').length,
    onText: (document.querySelector('.lyric-line.on')||{}).textContent,
    bodyMaxW: cs?cs.maxWidth:null,
    lyricBodyRect: lbr?{left:Math.round(lbr.left),right:Math.round(lbr.right),w:Math.round(lbr.width)}:null
  };
})()`;

(async()=>{
  const port = process.argv[2]||9333;
  const t=(await targets(port)).find(x=>x.type==='page');
  const c=new CDP(t.webSocketDebuggerUrl);
  await c.ready; await c.send('Runtime.enable');
  const r=await c.ev(EXPR);
  console.log('@@'+JSON.stringify(r));
  c.ws.close(); process.exit(0);
})().catch(e=>{console.log('@@ERR '+e.message);process.exit(1)});
