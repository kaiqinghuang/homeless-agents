'use strict';
(()=>{
 const el=id=>document.getElementById(id);
 let active=false,revision=0,session=null,pending=null,pendingSampling=null,currentSampling=null,fetching=false,starting=false,controller=null;
 function status(text){el('residue-state').textContent=text;}
 function buttons(){el('residue-start').disabled=starting||active;el('residue-stop').disabled=!starting&&!active;}
 async function post(path,data,signal){const r=await fetch('/api/residue/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal});const d=await r.json();if(!r.ok)throw Error(d.error||'Text generation failed.');return d;}
 function stop(){const old=session;revision++;active=false;starting=false;pending=null;session=null;controller?.abort();controller=null;window.afterimageMotion.cancelEcho();buttons();status('Stopped / 已停止');if(old)post('stop',{session:old}).catch(()=>{});}
 async function start(){
  if(active||starting)return;const ticket=++revision;starting=true;buttons();status('Loading text model… / 加载文字模型');
  // Keep this request alive so a cancelled start can close its exact session.
  try{const r=await post('start',{});if(ticket!==revision){post('stop',{session:r.session}).catch(()=>{});return;}
   session=r.session;starting=false;active=true;buttons();status('Generating / 正在生成');pump();
  }catch(e){if(ticket!==revision)return;stop();status(e.message);}
 }
 async function refill(ticket){
  if(fetching||pending||!active)return;fetching=true;controller=new AbortController();
  try{const r=await post('next',{session},controller.signal);if(ticket!==revision||!active)return;pending=r.text;pendingSampling=r.sampling||null;}
  catch(e){if(ticket===revision&&e.name!=='AbortError'){stop();status(e.message);}}
  finally{fetching=false;if(ticket===revision)controller=null;}
 }
 let pumping=false;
 async function pump(){
  if(pumping||!active)return;pumping=true;const ticket=revision;
  try{
   if(pending!==null&&!window.afterimageMotion.isBusy()){
    let cut=Math.min(800,pending.length);if(cut<pending.length){const space=pending.lastIndexOf(" ",cut);if(space>200)cut=space+1;if(/[\uD800-\uDBFF]/.test(pending[cut-1]))cut--;}
    const text=pending.slice(0,cut),remaining=pending.slice(cut);
    if(!text.trim()){pending=null;}
    else{const played=await window.afterimageMotion.echo(text);if(ticket!==revision)return;if(!played){stop();status(el('error').textContent||'Face playback unavailable.');return;}currentSampling=pendingSampling;pending=remaining||null;status('Generating continuously / 持续生成中');}
   }
   if(ticket===revision&&!pending)await refill(ticket);
  }finally{pumping=false;}
 }
 el('residue-start').addEventListener('click',start);el('residue-stop').addEventListener('click',stop);
 // A manual stop or playback request takes ownership of the face.
 for(const id of ['stop','play','example-en','example-zh'])el(id).addEventListener('click',()=>{if(active||starting)stop();});
 document.getElementById('shapes').addEventListener('click',()=>{if(active||starting)stop();});
 window.addEventListener('pagehide',()=>{const old=session;revision++;active=false;controller?.abort();if(old)fetch('/api/residue/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:old}),keepalive:true}).catch(()=>{});});
 setInterval(pump,120);buttons();
 window.afterimageResidue={start,stop,sampling:()=>currentSampling,status:()=>({active,starting,queued:pending!==null,fetching})};
})();
