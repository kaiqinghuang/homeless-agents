'use strict';
(()=>{
 const el=id=>document.getElementById(id),key='afterimage.environment-monitor.native-input.v1';
 let active=false,starting=false,revision=0,pollTimer=null,preference='builtin';
 const session=crypto.randomUUID();
 try{preference=localStorage.getItem(key)||'builtin';}catch(e){}
 const caption=text=>{el('hud-recording').textContent='Noise Recording: '+text;};
 function buttons(){el('monitor-toggle').textContent=active||starting?'Stop listening':'Start listening';el('monitor-input').disabled=active||starting;el('monitor-interpret').disabled=active||starting;}
 async function post(action,data={}){
  const r=await fetch('/api/environment/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const value=await r.json();if(!r.ok)throw Error(value.error||'Audio monitor unavailable');return value;
 }
 function render(s){
  active=s.active;buttons();
  if(s.active&&!s.interpret)caption('Listening…');
  else if(s.text)caption(s.text);
  else if(s.error)caption('Waiting for an audio observation…');
  else caption({off:'Off',starting:'Starting microphone…',loading:'Loading local audio model…',listening:'Listening…'}[s.state]||'Listening…');
  el('monitor-device').textContent=[s.device,s.active&&!s.interpret?'Sound controls sampling · audio model off':'',s.error].filter(Boolean).join(' · ')||'Audio observations · display only';
  el('hud-recording').dataset.observations=s.observations;
  el('hud-recording').dataset.captured=s.captured;
  el('hud-recording').dataset.rms=s.features?.rms_dbfs??'';
 }
 async function poll(ticket){
  try{const r=await fetch('/api/environment/status');if(!r.ok)throw Error('Audio service unavailable');const s=await r.json();if(ticket!==revision)return;render(s);}
  catch(e){if(ticket===revision)caption(e.message);}
  if(ticket===revision)pollTimer=setTimeout(()=>poll(ticket),1000);
 }
 async function start(){
  if(starting||active)return;const ticket=++revision;clearTimeout(pollTimer);starting=true;buttons();caption('Starting microphone…');
  try{const s=await post('start',{device:preference,session,interpret:el('monitor-interpret').checked});if(ticket===revision){render(s);poll(ticket);}}
  catch(e){if(ticket===revision)caption(e.message);}
  finally{if(ticket===revision){starting=false;buttons();}}
 }
 async function stop(){
  const ticket=++revision;clearTimeout(pollTimer);active=false;starting=false;buttons();caption('Off');
  try{const s=await post('stop',{session});if(ticket===revision)render(s);}catch(e){if(ticket===revision)caption(e.message);}
 }
 async function devices(){
  try{
   const r=await fetch('/api/environment/devices');if(!r.ok)return;const data=await r.json();
   const select=el('monitor-input');select.replaceChildren(new Option('Mac built-in','builtin'));
   data.devices.forEach(d=>select.add(new Option(d.name,d.name)));
   if(![...select.options].some(o=>o.value===preference))select.add(new Option('Saved input unavailable',preference));
   select.value=preference;
  }catch(e){}
 }
 el('monitor-toggle').addEventListener('click',()=>active||starting?stop():start());
 el('monitor-input').addEventListener('change',()=>{preference=el('monitor-input').value;try{localStorage.setItem(key,preference);}catch(e){}});
 // Page exit stops this display session's microphone; it never controls the text model.
 window.addEventListener('pagehide',()=>{revision++;clearTimeout(pollTimer);fetch('/api/environment/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session}),keepalive:true}).catch(()=>{});});
 devices();start();
})();
