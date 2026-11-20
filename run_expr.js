// node run_expr.js <port> <exprFile|exprString>
const http = require('http');
const fs = require('fs');

const port = Number(process.argv[2] || 9333);
let code = process.argv[3] || '1';
try { if (fs.existsSync(code)) code = fs.readFileSync(code, 'utf8'); } catch (e) {}

function targets(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: p, path: '/json' }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

(async () => {
  const list = await targets(port);
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      console.log('@@EXC ' + ((d.exception && d.exception.description) || d.text || ''));
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      const s = (m.params.args || []).map((a) => (a.value !== undefined ? a.value : a.description || a.type)).join(' ');
      console.log('@@LOG ' + s);
    }
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p(m); }
  };
  const send = (method, params) => new Promise((res) => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  await send('Runtime.enable');
  const r = await send('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true, userGesture: true });
  const res = r.result || {};
  if (res.exceptionDetails) {
    console.log('@@ERR ' + ((res.exceptionDetails.exception && res.exceptionDetails.exception.description) || res.exceptionDetails.text));
  } else {
    const v = res.result && res.result.value;
    console.log('@@' + (typeof v === 'string' ? v : JSON.stringify(v, null, 2)));
  }
  await new Promise((r2) => setTimeout(r2, 700));
  try { ws.close(); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.log('@@FATAL ' + e.message); process.exit(1); });
