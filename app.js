/* Oriento — minimalist, mobile-first, no frameworks */
const MODES = { ALARM:'alarm', TIMER:'timer', STOPWATCH:'stopwatch', WEATHER:'weather' };
const TITLES = { alarm:'Alarm', timer:'Timer', stopwatch:'Stopwatch', weather:'Weather' };
const SUBS = {
  alarm:'Portrait upright',
  timer:'Portrait upside‑down',
  stopwatch:'Landscape right‑side',
  weather:'Landscape left‑side'
};

const els = {
  overlay: q('#overlay'), enableMotion:q('#enableMotion'), enableSound:q('#enableSound'), closeOverlay:q('#closeOverlay'),
  modeTitle:q('#modeTitle'), modeSubtitle:q('#modeSubtitle'),
  status:q('#statusChip'), themeToggle:q('#themeToggle'), themeIcon:q('#themeIcon'),
  lockBtn:q('#lockBtn'), settingsBtn:q('#settingsBtn'),
  // panels
  p:{ alarm:q('#mode-alarm'), timer:q('#mode-timer'), stopwatch:q('#mode-stopwatch'), weather:q('#mode-weather') },
  // alarm
  alarmNow:q('#alarmNow'), alarmTime:q('#alarmTime'), setAlarm:q('#setAlarm'), clearAlarm:q('#clearAlarm'), alarmInfo:q('#alarmInfo'), stopAlarm:q('#stopAlarm'),
  // timer
  tDisp:q('#timerDisplay'), tMin:q('#timerMin'), tSec:q('#timerSec'), tSet:q('#timerSet'), tSP:q('#timerStartPause'), tReset:q('#timerReset'), tInfo:q('#timerInfo'),
  // sw
  swDisp:q('#swDisplay'), swStart:q('#swStartPause'), swReset:q('#swReset'), swLap:q('#swLap'), swLaps:q('#swLaps'),
  // weather
  cityInput:q('#cityInput'), citySearch:q('#citySearch'),
  wHead:q('#weatherHeadline'), wCity:q('#wCity'), wTemp:q('#wTemp'), wMinMax:q('#wMinMax'), wDesc:q('#wDesc'), wInfo:q('#weatherInfo')
};

let state = load() || {
  theme: (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  mode: MODES.ALARM, locked:false,
  // alarm
  alarmAt:null, alarmRinging:false,
  // timer
  tTotal:5*60*1000, tLeft:5*60*1000, tRun:false, tLast:0,
  // sw
  swRun:false, swStart:0, swElapsed:0, swLaps:[],
  // weather
  lastWeather:null,
  sensorEnabled:false, soundEnabled:false
};

document.body.dataset.theme = state.theme;
document.body.dataset.mode = state.mode;
q('#modeTitle')?.textContent = TITLES[state.mode];
els.modeSubtitle.textContent = SUBS[state.mode];
els.themeIcon.setAttribute('href', state.theme==='dark' ? '#i-moon' : '#i-sun');

// PWA
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});

// ===== Theme =====
els.themeToggle.addEventListener('click', ()=>{
  state.theme = state.theme==='dark' ? 'light' : 'dark';
  document.body.dataset.theme = state.theme;
  els.themeIcon.setAttribute('href', state.theme==='dark' ? '#i-moon' : '#i-sun');
  save();
});

// ===== Lock + swipe =====
function setLocked(v){
  state.locked=!!v; save();
  els.lockBtn.innerHTML = state.locked
    ? `<svg class="icon"><use href="#i-lock"/></svg><span>Unlock</span>`
    : `<svg class="icon"><use href="#i-lock"/></svg><span>Lock</span>`;
  setStatus(state.locked ? 'Mode locked' : 'Mode unlocked');
}
els.lockBtn.addEventListener('click', ()=> setLocked(!state.locked));

let sx=0, sy=0, st=0;
window.addEventListener('touchstart',e=>{const t=e.changedTouches[0]; sx=t.clientX; sy=t.clientY; st=Date.now();},{passive:true});
window.addEventListener('touchend',e=>{
  if(!state.locked) return;
  const t=e.changedTouches[0], dx=t.clientX-sx, dy=t.clientY-sy, dt=Date.now()-st;
  if(dt>600) return; if(Math.abs(dx)<60 || Math.abs(dy)>60) return;
  const order=[MODES.ALARM, MODES.TIMER, MODES.STOPWATCH, MODES.WEATHER];
  const i=order.indexOf(state.mode);
  const next = dx<0 ? order[(i+1)%order.length] : order[(i-1+order.length)%order.length];
  setMode(next);
},{passive:true});

// ===== Orientation =====
let usingSensors=false, handler=null, rafGate=false;
function modeFrom({beta=null,gamma=null,angle=null,winOri=null}){
  if(beta!==null && gamma!==null){
    const ab=Math.abs(beta), ag=Math.abs(gamma);
    if (ab>45 && ag<35) return beta>0?MODES.ALARM:MODES.TIMER;
    if (ag>=35 && ab<45) return gamma>0?MODES.STOPWATCH:MODES.WEATHER;
  }
  const ang = angle ?? (typeof screen.orientation?.angle==='number'?screen.orientation.angle:null) ?? winOri ?? 0;
  if (ang===0) return MODES.ALARM;
  if (ang===180) return MODES.TIMER;
  if (ang===90) return MODES.STOPWATCH;
  if (ang===-90 || ang===270) return MODES.WEATHER;
  return state.mode;
}
async function enableSensors(){
  try{
    if (typeof DeviceOrientationEvent!=='undefined' && typeof DeviceOrientationEvent.requestPermission==='function'){
      const p = await DeviceOrientationEvent.requestPermission();
      if (p!=='granted') throw new Error('Denied');
    }
    if (!handler){
      handler = (ev)=>{
        if (rafGate) return; rafGate=true;
        requestAnimationFrame(()=>{
          rafGate=false; if(state.locked) return;
          const m=modeFrom({beta:ev.beta,gamma:ev.gamma});
          setMode(m);
          setStatus(`β=${ev.beta?.toFixed?.(0)} γ=${ev.gamma?.toFixed?.(0)}`);
        });
      };
    }
    window.addEventListener('deviceorientation', handler, {passive:true});
    usingSensors=true; state.sensorEnabled=true; save();
  }catch{ usingSensors=false; state.sensorEnabled=false; save(); }
}
window.addEventListener('orientationchange', ()=>{
  if(state.locked) return;
  const angle=screen.orientation?.angle, winOri=typeof window.orientation==='number'?window.orientation:null;
  setMode(modeFrom({angle,winOri}));
},{passive:true});
window.addEventListener('resize', ()=>{
  if(state.locked) return;
  const angle=screen.orientation?.angle, winOri=typeof window.orientation==='number'?window.orientation:null;
  setMode(modeFrom({angle,winOri}));
},{passive:true});

// ===== Mode router =====
function setMode(m){
  if (!Object.values(MODES).includes(m)) return;
  if (state.mode===m) return;
  state.mode=m; save();
  for(const k of Object.values(MODES)) els.p[k].classList.toggle('active', k===m);
  document.body.dataset.mode = m;
  (q('#modeTitle')||{}).textContent = TITLES[m];
  els.modeSubtitle.textContent = SUBS[m];
  if (m===MODES.WEATHER && !state.lastWeather) lazyWeather();
}

// ===== Audio =====
let audioCtx=null;
function ensureAudio(){ if(!audioCtx){ try{ audioCtx=new (window.AudioContext||window.webkitAudioContext)(); }catch{} } state.soundEnabled=!!audioCtx; save(); return !!audioCtx; }
function beep(pattern=[500,200,700,200,900,300], times=2){
  if(!ensureAudio()) return;
  const now=audioCtx.currentTime; let t=0;
  for(let i=0;i<times;i++){
    for(let j=0;j<pattern.length;j+=2){
      const freq=pattern[j], dur=(pattern[j+1]||200)/1000;
      const osc=audioCtx.createOscillator(), g=audioCtx.createGain();
      osc.frequency.value=freq; osc.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.0001, now+t); g.gain.exponentialRampToValueAtTime(0.28, now+t+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now+t+dur);
      osc.start(now+t); osc.stop(now+t+dur); t+=dur+0.03;
    } t+=0.12;
  }
  if (navigator.vibrate) navigator.vibrate([140,80,140]);
}

// Overlay
function showOverlay(){ els.overlay.classList.add('show'); els.overlay.setAttribute('aria-hidden','false'); }
function hideOverlay(){ els.overlay.classList.remove('show'); els.overlay.setAttribute('aria-hidden','true'); }
els.closeOverlay.addEventListener('click', hideOverlay);
els.enableMotion.addEventListener('click', async()=>{ await enableSensors(); hideOverlay(); });
els.enableSound.addEventListener('click', ()=>{ ensureAudio(); hideOverlay(); });

// ===== Alarm =====
let clockT=0, alarmT=0;
function fmtClock(d){ return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'}); }
function startClock(){ if(clockT) return; const tick=()=> els.alarmNow.textContent = fmtClock(new Date()); tick(); clockT=setInterval(tick,500); }
function nextAlarm(hhmm){ if(!hhmm) return null; const [h,m]=hhmm.split(':').map(Number); const d=new Date(); d.setSeconds(0,0); d.setHours(h,m,0,0); if(d<=Date.now()) d.setDate(d.getDate()+1); return d; }
function scheduleAlarm(ts){ clearTimeout(alarmT); const d=ts-Date.now(); if(d<=0) return triggerAlarm(); alarmT=setTimeout(triggerAlarm,d); }
function triggerAlarm(){ state.alarmRinging=true; save(); els.stopAlarm.classList.remove('hidden'); els.alarmInfo.textContent='🔔 Alarm ringing!'; beep(); }
function cancelAlarm(){ clearTimeout(alarmT); state.alarmAt=null; state.alarmRinging=false; save(); els.stopAlarm.classList.add('hidden'); els.alarmInfo.textContent='No alarm set.'; }
els.setAlarm.addEventListener('click', ()=>{
  const d=nextAlarm(els.alarmTime.value); if(!d){ els.alarmInfo.textContent='Pick a time first.'; return; }
  state.alarmAt=d.getTime(); state.alarmRinging=false; save(); scheduleAlarm(state.alarmAt);
  els.stopAlarm.classList.add('hidden');
  const mins=Math.round((d-Date.now())/60000);
  els.alarmInfo.textContent=`Alarm set for ${d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} (~${mins} min).`;
});
els.clearAlarm.addEventListener('click', cancelAlarm);
els.stopAlarm.addEventListener('click', ()=>{ state.alarmRinging=false; save(); els.stopAlarm.classList.add('hidden'); });

// ===== Timer =====
let tInt=0;
function fmtMS(ms){ const neg=ms<0; if(neg) ms=-ms; const h=Math.floor(ms/3600000), m=Math.floor((ms%3600000)/60000), s=Math.floor((ms%60000)/1000);
  return (neg?'-':'') + (h?String(h).padStart(2,'0')+':':'') + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0'); }
function tRender(){ els.tDisp.textContent=fmtMS(state.tLeft); }
function tStart(){ if(state.tRun) return; state.tRun=true; state.tLast=performance.now(); save();
  tInt=setInterval(()=>{ const now=performance.now(); state.tLeft -= (now-state.tLast); state.tLast=now;
    if(state.tLeft<=0){ state.tLeft=0; tPause(); beep([700,200,500,200,900,300],2); }
    tRender(); },200);
  els.tSP.textContent='Pause';
}
function tPause(){ if(!state.tRun) return; state.tRun=false; save(); clearInterval(tInt); els.tSP.textContent='Start'; }
function tReset(to=null){ tPause(); state.tLeft = (to??state.tTotal); tRender(); save(); }
els.tSet.addEventListener('click', ()=>{
  const m=Math.max(0, parseInt(els.tMin.value||'0',10)||0);
  const s=Math.min(59, Math.max(0, parseInt(els.tSec.value||'0',10)||0));
  const total=(m*60+s)*1000; state.tTotal=total||0; tReset(total);
});
els.tSP.addEventListener('click', ()=> state.tRun ? tPause() : tStart());
els.tReset.addEventListener('click', ()=> tReset());

// ===== Stopwatch =====
let swInt=0;
function swRender(ms){ const m=Math.floor(ms/60000), s=Math.floor((ms%60000)/1000), h=Math.floor((ms%1000)/10);
  els.swDisp.textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(h).padStart(2,'0')}`; }
function swStart(){ if(state.swRun) return; state.swRun=true; state.swStart=performance.now()-state.swElapsed; save();
  swInt=setInterval(()=>{ state.swElapsed=performance.now()-state.swStart; swRender(state.swElapsed); },50);
  els.swStart.textContent='Pause';
}
function swPause(){ if(!state.swRun) return; state.swRun=false; save(); clearInterval(swInt); els.swStart.textContent='Start'; }
function swReset(){ swPause(); state.swElapsed=0; state.swLaps=[]; save(); swRender(0); renderLaps(); }
function swLap(){ state.swLaps.unshift(state.swElapsed); save(); renderLaps(); if(navigator.vibrate) navigator.vibrate(20); }
function renderLaps(){ els.swLaps.innerHTML = state.swLaps.map((ms,i)=>`Lap ${state.swLaps.length-i}: ${fmtMS(ms)}`).join('<br>'); }
els.swStart.addEventListener('click', ()=> state.swRun?swPause():swStart());
els.swReset.addEventListener('click', swReset);
els.swLap.addEventListener('click', swLap);

// ===== Weather (Open‑Meteo, no key) =====
const WMAP = {0:'Clear',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Rime fog',51:'Drizzle',53:'Drizzle',55:'Drizzle',56:'Freezing drizzle',57:'Freezing drizzle',61:'Rain',63:'Rain',65:'Heavy rain',66:'Freezing rain',67:'Freezing rain',71:'Snowfall',73:'Snowfall',75:'Snow',77:'Snow grains',80:'Rain showers',81:'Rain showers',82:'Heavy showers',85:'Snow showers',86:'Heavy snow',95:'Thunderstorm',96:'Thunder w/ hail',99:'Thunder w/ hail'};
let fetchedWeather=false;
async function reverseCity(lat,lon){
  const r=await fetch(`https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&language=en`,{cache:'no-store'});
  const j=await r.json(); return j?.results?.[0]?.city || j?.results?.[0]?.name || null;
}
async function fetchWeatherByCoords(lat,lon){
  const u=`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto`;
  const r=await fetch(u,{cache:'no-store'}); const j=await r.json();
  const cc=j.current, dd=j.daily; const i=0;
  const desc=WMAP[dd.weather_code?.[i]] || WMAP[cc.weather_code] || '—';
  const city = await reverseCity(lat,lon).catch(()=>null);
  state.lastWeather = { city: city || `${lat.toFixed(2)},${lon.toFixed(2)}`, temp: Math.round(cc.temperature_2m), min: Math.round(dd.temperature_2m_min[i]), max: Math.round(dd.temperature_2m_max[i]), desc };
  save(); renderWeather();
}
async function searchCity(qStr){
  const r=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(qStr)}&count=1&language=en`,{cache:'no-store'});
  const j=await r.json(); if(!j?.results?.length) throw new Error('City not found');
  const {latitude, longitude} = j.results[0]; await fetchWeatherByCoords(latitude, longitude);
}
function renderWeather(){
  const w=state.lastWeather; if(!w) return;
  els.wCity.textContent=w.city; els.wTemp.textContent=`${w.temp}°`;
  els.wMinMax.textContent=`${w.min}° / ${w.max}°`; els.wDesc.textContent=w.desc;
  els.wHead.textContent=`${w.desc} — ${w.temp}°C`;
}
function lazyWeather(){
  if(fetchedWeather && state.lastWeather) return; fetchedWeather=true;
  if('geolocation' in navigator){
    navigator.geolocation.getCurrentPosition(
      p=>fetchWeatherByCoords(p.coords.latitude, p.coords.longitude),
      _=>{ els.wInfo.textContent='Location blocked. Enter city manually.'; },
      { maximumAge: 3600_000, timeout:8000, enableHighAccuracy:false }
    );
  }else els.wInfo.textContent='Geolocation unavailable. Enter city manually.';
}
els.citySearch.addEventListener('click', async()=>{
  const qv=els.cityInput.value.trim(); if(!qv) return;
  els.wInfo.textContent='Searching…';
  try{ await searchCity(qv); els.wInfo.textContent='Data: Open‑Meteo'; }catch{ els.wInfo.textContent='Not found. Try another city.'; }
});

// ===== Battery: pause when hidden =====
document.addEventListener('visibilitychange', ()=>{ if(document.hidden){ if(state.tRun) tPause(); if(state.swRun) swPause(); } });

// ===== Boot =====
function setStatus(t){ els.status.textContent='Orientation: '+t; }
function q(s){ return document.querySelector(s); }
function save(){ try{ localStorage.setItem('oriento-min', JSON.stringify(state)); }catch{} }
function load(){ try{ return JSON.parse(localStorage.getItem('oriento-min')||''); }catch{ return null; } }

function initMode(){
  for(const k of Object.values(MODES)) els.p[k].classList.toggle('active', k===state.mode);
  q('#modeTitle')?.textContent=TITLES[state.mode];
  els.modeSubtitle.textContent=SUBS[state.mode];
  if (state.mode===MODES.WEATHER && !state.lastWeather) lazyWeather();
}
initMode();

startClock();
if(state.alarmAt) scheduleAlarm(state.alarmAt);
tRender(); if(state.tRun) tStart();
swRender(state.swElapsed); renderLaps(); if(state.swRun) swStart();

if (state.sensorEnabled) enableSensors();
else {
  const angle=screen.orientation?.angle, winOri=typeof window.orientation==='number'?window.orientation:null;
  setMode(modeFrom({angle,winOri}));
  // show overlay for first-time permissions
  setTimeout(()=>showOverlay(), 300);
}
