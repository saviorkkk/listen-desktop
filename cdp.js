const http = require('http');
const fs = require('fs');

function targets(port) {
  return new Promise((res, rej) => {
    http
      .get(`http://127.0.0.1:${port}/json`, (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => {
          try {
            res(JSON.parse(d));
          } catch (e) {
            rej(e);
          }
        });
      })
      .on('error', rej);
  });
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error('ws fail'));
    });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async ev(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval err');
    return r.result.value;
  }
  async shot(p) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
    return p;
  }
}

(async () => {
  const port = process.argv[2] || 9333;
  const mode = process.argv[3] || 'probe';
  const t = (await targets(port)).find((x) => x.type === 'page');
  const c = new CDP(t.webSocketDebuggerUrl);
  await c.ready;
  await c.send('Page.enable');
  await c.send('Runtime.enable');

  const out = {};
  if (mode === 'probe') {
    out.title = await c.ev('document.title');
    out.crumb = await c.ev("document.getElementById('crumb').textContent");
    out.cards = await c.ev("document.querySelectorAll('.card').length");
    out.hero = await c.ev("!!document.querySelector('.hero')");
    out.err = await c.ev("document.body.innerText.includes('重试')");
    out.nav = await c.ev("document.querySelectorAll('.nav-item').length");
  } else if (mode === 'js') {
    out.r = await c.ev(process.argv[4]);
  } else if (mode === 'shot') {
    out.p = await c.shot(process.argv[4]);
  } else if (mode === 'click') {
    out.r = await c.ev(`(function(){const e=document.querySelector(${JSON.stringify(process.argv[4])});if(!e)return 'NF';e.click();return 'ok';})()`);
  }

  console.log('@@' + JSON.stringify(out));
  c.ws.close();
  process.exit(0);
})().catch((e) => {
  console.log('@@ERR ' + e.message);
  process.exit(1);
});
