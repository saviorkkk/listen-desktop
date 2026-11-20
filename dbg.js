const http = require('http');
function targets(port){return new Promise((res,rej)=>{http.get(`http://127.0.0.1:${port}/json`,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}})}).on('error',rej)})}
(async()=>{
  const port=process.argv[2]||9333;
  const t=(await targets(port)).find(x=>x.type==='page');
  const ws=new WebSocket(t.webSocketDebuggerUrl);
  let id=0; const pending=new Map();
  const send=(method,params={})=>new Promise((res,rej)=>{const i=++id;pending.set(i,{res,rej});ws.send(JSON.stringify({id:i,method,params}))});
  const events=[];
  await new Promise(r=>ws.onopen=r);
  ws.onmessage=(ev)=>{const m=JSON.parse(ev.data); if(m.id&&pending.has(m.id)){const{res,rej}=pending.get(m.id);pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)} else if(m.method==='Runtime.exceptionThrown'){events.push('EXC: '+(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text))} else if(m.method==='Runtime.consoleAPICalled'){events.push('CONSOLE['+m.params.type+']: '+m.params.args.map(a=>a.value??a.description).join(' '))} else if(m.method==='Log.entryAdded'){events.push('LOG['+m.params.entry.level+']: '+m.params.entry.text)}};
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Page.reload',{ignoreCache:true});
  await new Promise(r=>setTimeout(r,3500));
  const r=await send('Runtime.evaluate',{expression:"JSON.stringify({state:typeof window.__state, nav:typeof window.navigateTo, rows:document.querySelectorAll('.track-row').length, msa:(document.getElementById('mainScrollArea')?.innerHTML||'').length})",returnByValue:true});
  console.log('EVENTS:\n'+events.join('\n'));
  console.log('STATE:', r.result.value);
  ws.close();process.exit(0);
})().catch(e=>{console.log('ERR '+e.message);process.exit(1)});
