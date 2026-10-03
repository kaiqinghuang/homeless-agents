'use strict';
(()=>{
 const el=id=>document.getElementById(id),sourceInterval=8000;
 let sources=[],cursor=0,timer=null,transitionTimer=null;
 const track=el('hud-source-track');
 function paint(){
  track.replaceChildren(...Array.from({length:6},(_,i)=>{
   const source=sources[(cursor+i)%sources.length],row=document.createElement('div');
   row.className='hud-source';row.textContent=source.display;row.title=source.url;
   row.dataset.sourceId=source.id;return row;
  }));
 }
 function advance(){
  if(!sources.length)return;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  track.style.transition=reduced?'none':'transform 650ms cubic-bezier(.22,.7,.25,1)';
  track.style.transform='translateY(calc(-66 * var(--u)))';
  clearTimeout(transitionTimer);
  transitionTimer=setTimeout(()=>{
   cursor=(cursor+1)%sources.length;track.style.transition='none';track.style.transform='translateY(0)';paint();
  },reduced?0:670);
 }
 async function init(){
  try{
   const r=await fetch('/assets/training-sources.json');if(!r.ok)throw Error('Source list unavailable');
   const data=await r.json();sources=data.sources;
   if(sources.length!==139)throw Error('Expected 139 training sources');
   paint();timer=setInterval(advance,sourceInterval);
  }catch(e){track.textContent=e.message;}
  try{
   const r=await fetch('/api/artwork/info');if(!r.ok)return;const info=await r.json();
   for(const [id,key] of Object.entries({'hud-base':'base_model','hud-steps':'steps','hud-temperature':'temperature','hud-top-p':'top_p','hud-context':'context_tokens'})){
    if(info[key]!==undefined)el(id).textContent=info[key];
   }
  }catch(e){/* Static labels retain the verified saved configuration. */}
 }
 function frame(){
  const s=window.afterimageMotion?.snapshot();
  if(s){const pace=s.pace.toFixed(2)+'×';if(el('hud-pace').textContent!==pace)el('hud-pace').textContent=pace;if(el('hud-mouth').textContent!==s.label)el('hud-mouth').textContent=s.label;}
  requestAnimationFrame(frame);
 }
 window.addEventListener('pagehide',()=>{clearInterval(timer);clearTimeout(transitionTimer);});
 init();requestAnimationFrame(frame);
})();
