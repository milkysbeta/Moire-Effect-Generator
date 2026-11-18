#pragma once
// Control page served at http://moire.local. Talks to /api/state and /api/set.
const char WEB_UI[] PROGMEM = R"HTML(<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Moiré drive</title>
<meta name="theme-color" content="#111214"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Moiré"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="/manifest.json"><link rel="icon" href="/icon.svg">
<style>
:root{--bg:#111214;--panel:#1b1d21;--ink:#ececec;--muted:#9a9ea6;--line:#2c2f35;--accent:#f59e0b}
@media (prefers-color-scheme: light){:root{--bg:#f4f3f0;--panel:#fff;--ink:#1c1b19;--muted:#6b6862;--line:#e2dfd9;--accent:#c2700a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;padding:16px}
main{max-width:520px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
h1{font-size:22px;margin:4px 0 0}p{margin:0;color:var(--muted);font-size:13px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:12px}
.row{display:grid;grid-template-columns:110px 1fr 70px;gap:10px;align-items:center}.row[hidden]{display:none}
.row label{color:var(--muted);font-size:13px}output{font:500 13px ui-monospace,Consolas,monospace;text-align:right}
input[type=range]{width:100%;accent-color:var(--accent)}
.seg{display:flex;gap:6px;flex-wrap:wrap}.seg button,.btn{font:inherit;font-size:13px;padding:7px 12px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer}
.seg button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#111}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#111;font-weight:600}
.live{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}.chip{background:var(--bg);border-radius:8px;padding:8px 10px}.chip[hidden]{display:none}
.chip b{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500}
.chip span{font:500 17px ui-monospace,Consolas,monospace}
.warn{color:#f87171;font-size:13px}.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
input[type=text],input[type=password]{font:inherit;padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink);width:100%}
.lock{display:flex;gap:8px;align-items:center}.lock[hidden]{display:none}fieldset{border:0;padding:0;margin:0;display:contents}
details summary{cursor:pointer;color:var(--muted);font-size:13px}
</style></head><body><main>
<h1>Moiré drive</h1>
<p>Front disc = Layer 1, then Layer 2, then Layer 3 at the back. Positive speed turns clockwise seen from the front.</p>
<form class="card lock" id="unlock" hidden><span style="flex:none">&#x1F512;</span><input type="password" id="key" placeholder="Password to change settings" autocomplete="current-password"><button class="btn primary">Unlock</button></form>
<p id="lockMsg" hidden></p>
<fieldset id="ctl">
<div class="card">
  <div class="live"><div class="chip"><b id="n0"></b><span id="c0">–</span></div><div class="chip"><b id="n1"></b><span id="c1">–</span></div><div class="chip" id="chip2"><b id="n2"></b><span id="c2">–</span></div></div>
  <p class="warn" id="warn" hidden></p>
  <div class="row"><label for="l0" id="m0"></label><input type="range" id="l0" step="0.01"><output id="o0"></output></div>
  <div class="row"><label for="l1" id="m1"></label><input type="range" id="l1" step="0.01"><output id="o1"></output></div>
  <div class="row" id="row2"><label for="l2" id="m2"></label><input type="range" id="l2" step="0.01"><output id="o2"></output></div>
  <div class="bar"><button class="btn primary" id="run">Pause</button><button class="btn" id="flip">Swap directions</button><button class="btn" id="zero">Stop all</button></div>
</div>
<div class="card">
  <div class="row"><label>Motion</label><div class="seg" id="mode"><button data-v="steady">Steady</button><button data-v="breathe">Breathe</button><button data-v="drift">Drift</button></div><span></span></div>
  <div class="row" data-for="breathe"><label for="period">Breathe period</label><input type="range" id="period" min="5" max="300" step="1"><output id="periodO"></output></div>
  <div class="row" data-for="breathe"><label for="depth">Breathe depth</label><input type="range" id="depth" min="0" max="1" step="0.01"><output id="depthO"></output></div>
  <div class="row" data-for="drift"><label for="drift">Drift amount</label><input type="range" id="drift" min="0" max="1" step="0.01"><output id="driftO"></output></div>
  <div class="row"><label for="accel">Ramp</label><input type="range" id="accel" min="0.02" max="2" step="0.01"><output id="accelO"></output></div>
</div>
<details class="card"><summary>Setup</summary>
  <form id="pw" class="bar"><input type="password" name="new" placeholder="New admin password (4+ characters)" autocomplete="new-password"><button class="btn">Set password</button><button class="btn" type="button" id="pwOff">Remove lock</button></form>
  <p id="pwMsg">Watching stays open to anyone on your Wi-Fi; changes need the password. Forgot it? Hold the board's BOOT button for 5 seconds.</p>
  <div class="row" id="discRow"><label>Discs</label><div class="seg" id="discs"><button data-v="2">2</button><button data-v="3">3</button></div><span></span></div>
  <div class="row"><label>Reverse motor</label><div class="bar" id="invs"></div><span></span></div>
  <div class="row" id="curRow"><label for="current">Motor current</label><input type="range" id="current" min="50" max="400" step="10"><output id="currentO"></output></div>
  <p id="drv"></p>
  <form id="fw" class="bar"><input type="file" id="fwFile" accept=".bin" aria-label="Firmware file"><button class="btn">Update firmware</button></form>
  <p id="fwMsg">Upload firmware.bin from the PlatformIO build folder; the drive restarts with it.</p>
  <form id="wifi" class="bar"><input type="text" name="ssid" placeholder="Wi-Fi name" autocomplete="off"><input type="password" name="pass" placeholder="Password"><button class="btn primary">Save Wi-Fi &amp; restart</button></form>
</details>
</fieldset>
</main>
<script>
const $=id=>document.getElementById(id);let st=null,timer=null;
const fmt={period:v=>v+' s',depth:v=>Math.round(v*100)+'%',drift:v=>Math.round(v*100)+'%',accel:v=>(+v).toFixed(2)+'/s',current:v=>v+' mA'};
const names=n=>n===3?['Front (L1)','Middle (L2)','Rear (L3)']:['Front (L1)','Rear (L2)'];
let key='';try{key=localStorage.getItem('moireKey')||''}catch(e){}
const withKey=q=>q+(key?'&key='+encodeURIComponent(key):'');
async function api(q,path){const r=await fetch('/api/'+(path?path+'?'+withKey(q):q?'set?'+withKey(q):'state'));const j=await r.json();
  if(r.status===401||r.status===429){key='';try{localStorage.removeItem('moireKey')}catch(e){}lockMsg(r.status===429?j.error:'Wrong password.');if(!st)return;render(false);return false}
  st=j;render(false);return true}
function lockMsg(t){$('lockMsg').hidden=!t;$('lockMsg').textContent=t||''}
const canEdit=()=>!st.locked||!!key;
function send(q){clearTimeout(timer);timer=setTimeout(()=>api(q),120)}
function render(all){
  const n=st.discs,nm=names(n);
  $('unlock').hidden=canEdit();$('ctl').disabled=!canEdit();$('pwOff').hidden=!st.locked;
  for(let i=0;i<3;i++){const e=$('l'+i);e.min=-st.maxDiscRpm;e.max=st.maxDiscRpm;
    if(all||document.activeElement!==e)e.value=st.l[i];$('o'+i).textContent=(+e.value).toFixed(2)+' rpm';
    $('n'+i).textContent=(nm[i]||'')+' now';$('m'+i).textContent=nm[i]||'';$('c'+i).textContent=st.cur[i].toFixed(2)+' rpm'}
  $('row2').hidden=$('chip2').hidden=n<3;
  for(const k in fmt){const e=$(k);if(all||document.activeElement!==e){e.value=st[k]}$(k+'O').textContent=fmt[k](e.value)}
  $('run').textContent=st.running?'Pause':'Run';
  document.querySelectorAll('#mode button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===st.mode));
  document.querySelectorAll('#discs button').forEach(b=>b.setAttribute('aria-pressed',+b.dataset.v===n));
  $('discRow').hidden=st.motors<3;
  document.querySelectorAll('[data-for]').forEach(r=>r.hidden=r.dataset.for!==st.mode);
  $('invs').innerHTML=nm.map((x,i)=>`<label><input type="checkbox" data-i="${i}" ${st.inv[i]?'checked':''}> ${x}</label>`).join('');
  $('invs').querySelectorAll('input').forEach(c=>c.onchange=e=>api('inv'+(+c.dataset.i+1)+'='+(e.target.checked?1:0)));
  $('curRow').hidden=st.driver!=='TMC2209';
  $('drv').textContent='Driver: '+st.driver+' ('+st.motors+' motors) · max '+st.maxDiscRpm.toFixed(2)+' disc rpm · gears '+st.ratio+':1 · '+(st.ap?'access point ':'')+st.ip;
  const w=[];for(let i=0;i<n;i++)if(!st.ok[i])w.push(nm[i]+' driver not answering');
  const live=st.l.slice(0,n).filter(v=>v);if(live.length>1&&live.every(v=>Math.sign(v)===Math.sign(live[0])))w.push('all discs turn the same way, so there is no counter-rotation');
  $('warn').hidden=!w.length;$('warn').textContent=w.join(' · ');
}
for(let i=0;i<3;i++)$('l'+i).addEventListener('input',e=>{$('o'+i).textContent=(+e.target.value).toFixed(2)+' rpm';send('l'+(i+1)+'='+e.target.value)});
for(const k in fmt)$(k).addEventListener('input',e=>{$(k+'O').textContent=fmt[k](e.target.value);send(k+'='+e.target.value)});
document.querySelectorAll('#mode button').forEach(b=>b.onclick=()=>api('mode='+b.dataset.v));
document.querySelectorAll('#discs button').forEach(b=>b.onclick=()=>api('discs='+b.dataset.v));
$('run').onclick=()=>api('run='+(st.running?0:1));
$('flip').onclick=()=>api(st.l.map((v,i)=>'l'+(i+1)+'='+(-v)).join('&'));
$('zero').onclick=()=>api('l1=0&l2=0&l3=0');
$('unlock').onsubmit=async e=>{e.preventDefault();key=$('key').value;$('key').value='';
  if(await api('run='+(st.running?1:0))){try{localStorage.setItem('moireKey',key)}catch(e){}lockMsg('')}};
$('pw').onsubmit=async e=>{e.preventDefault();const n=e.target.new.value;if(n.length<4){$('pwMsg').textContent='Use at least 4 characters.';return}
  if(await api('new='+encodeURIComponent(n),'password')){key=n;try{localStorage.setItem('moireKey',key)}catch(e){}e.target.reset();$('pwMsg').textContent='Password set. This browser stays unlocked.'}};
$('pwOff').onclick=async()=>{if(await api('new=','password'))$('pwMsg').textContent='Lock removed: anyone on the network can change settings.'};
$('fw').onsubmit=async e=>{e.preventDefault();const f=$('fwFile').files[0];if(!f){$('fwMsg').textContent='Pick a .bin file first.';return}
  $('fwMsg').textContent='Uploading '+f.name+'…';const d=new FormData();d.append('firmware',f,f.name);
  try{const r=await fetch('/update?'+withKey(''),{method:'POST',body:d});$('fwMsg').textContent=r.ok?'Updated. Restarting… reload in 10 s.':(r.status===401?'Unlock first.':'Update failed.')}catch(x){$('fwMsg').textContent='Upload failed.'}};
$('wifi').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const r=await fetch('/api/wifi?'+withKey(new URLSearchParams(f).toString()));if(!r.ok){lockMsg('Unlock first to change Wi-Fi.');return}document.body.innerHTML='<main><h1>Restarting…</h1><p>Rejoin your Wi-Fi, then open http://moire.local</p></main>'};
api().then(()=>render(true));setInterval(()=>api(),1000);
</script></body></html>)HTML";
