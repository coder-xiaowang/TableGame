const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Local fixtures only. No external browser profile, account, or remote site.
async function openBrowser() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tablegame-interactions-'));
  const chrome = spawn(process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome'), [
    '--headless=new', ...(process.platform === 'win32' || process.env.CHROME_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
    '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--disable-background-networking', 'about:blank'
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let ws;
  const errors = [], pending = new Map();
  let seq = 0;
  async function close() {
    ws?.close();
    if (chrome.exitCode == null) chrome.kill();
    await delay(350);
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith('tablegame-interactions-'));
    try { fs.rmSync(profile, {recursive:true, force:true, maxRetries:3, retryDelay:100}); }
    catch { console.log('Temporary browser profile retained: ' + profile); }
  }
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(Error('Chrome startup timeout')), 15000);
      chrome.once('error', error => { clearTimeout(timer); reject(error); });
      chrome.stderr.on('data', chunk => {
        output += chunk;
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timer); resolve(new URL(match[1])); }
      });
    });
    const pages = await fetch(`http://${endpoint.host}/json/list`).then(r => r.json());
    ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
    await once(ws, 'open');
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      if (message.method === 'Page.javascriptDialogOpening') ws.send(JSON.stringify({ id:++seq, method:'Page.handleJavaScriptDialog', params:{accept:true} }));
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); reject(Error(method + ' timeout')); }, 10000);
      pending.set(id, message => { clearTimeout(timer); message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result); });
      ws.send(JSON.stringify({id, method, params}));
    });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true}).catch(error=>{throw Error(error.message+' in '+expression.slice(0,160));});
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result?.value;
    };
    const until = async (check, label, timeout = 8000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) { if (await check()) return; await delay(60); }
      throw Error('Timed out: ' + label);
    };
    const viewport = async (width, height) => {
      await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor:1, mobile:true});
      await send('Emulation.setTouchEmulationEnabled', {enabled:true, maxTouchPoints:1});
      await delay(80);
    };
    async function tap(selector, label = null) {
      const expression = `(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})];const e=nodes.find(n=>${label === null ? 'true' : `n.textContent.trim()===${JSON.stringify(label)}`});if(!e||e.disabled)throw Error('Missing/disabled touch target: '+${JSON.stringify(selector+' '+(label||''))});e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});return true;})()`;
      await evaluate(expression); await delay(40);
      const point = await evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(n=>${label === null ? 'true' : `n.textContent.trim()===${JSON.stringify(label)}`});const r=e.getBoundingClientRect();let l=Math.max(0,r.left),t=Math.max(0,r.top),right=Math.min(innerWidth,r.right),bottom=Math.min(innerHeight,r.bottom);for(let p=e.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),b=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(s.overflowX)){l=Math.max(l,b.left);right=Math.min(right,b.right);}if(/auto|scroll|hidden|clip/.test(s.overflowY)){t=Math.max(t,b.top);bottom=Math.min(bottom,b.bottom);}}const x=(l+right)/2,y=(t+bottom)/2,hit=document.elementFromPoint(x,y);if(right<=l||bottom<=t||!(hit===e||e.contains(hit)))throw Error('Obscured touch target: '+e.textContent);return {x,y};})()`);
      await send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{...point, radiusX:2, radiusY:2, force:1, id:1}]});
      await send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
      await delay(100);
    }
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    return {send, evaluate, until, viewport, tap, errors, close};
  } catch (error) { await close(); throw error; }
}
module.exports = {openBrowser, delay};
