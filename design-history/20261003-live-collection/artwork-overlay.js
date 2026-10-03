'use strict';
(()=>{
 const el=id=>document.getElementById(id),sourceInterval=8000;
 let sources=[],cursor=0,timer=null,transitionTimer=null;
 const track=el('hud-source-track');
 function paint(){
  track.replaceChildren(...Array.from({length:7},(_,i)=>{
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
 }
 window.addEventListener('pagehide',()=>{clearInterval(timer);clearTimeout(transitionTimer);});
 init();
})();
