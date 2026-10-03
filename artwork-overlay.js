'use strict';
(()=>{
 const track=document.getElementById('hud-source-track'),counter=document.getElementById('hud-training-count');
 let runId=null,sequence=0,rows=[],timer=null,transitionTimer=null,closed=false;
 function row(source){
  const node=document.createElement('div');node.className='hud-source';node.textContent=source.display;
  node.title=source.url+(source.snapshot_date?' · Common Crawl '+source.snapshot_date:'');
  node.dataset.sourceId=source.id;return node;
 }
 function paint(items){track.replaceChildren(...items.map(row));}
 function reset(data){
  clearTimeout(transitionTimer);track.style.transition='none';track.style.transform='translateY(0)';
  runId=data.run_id;sequence=data.sequence;rows=data.entries;paint(rows);counter.textContent=String(data.count);
 }
 function update(data){
  counter.parentElement.title=data.error?'Waiting for Common Crawl: '+data.error:'Common Crawl → preference-filtered fragments. Temporary collection; not used for LoRA training.';
  if(runId!==data.run_id||data.sequence<sequence||data.sequence>sequence+1||rows.length!==6){reset(data);return;}
  if(data.sequence===sequence)return; // No real record: no movement or counter change.
  const newest=data.entries.at(-1),reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  sequence=data.sequence;rows=data.entries;
  track.appendChild(row(newest));
  // Commit the unshifted seventh row before beginning the six-row viewport scroll.
  void track.offsetHeight;
  track.style.transition=reduced?'none':'transform 650ms cubic-bezier(.22,.7,.25,1)';
  track.style.transform='translateY(calc(-66 * var(--u)))';
  counter.textContent=String(data.count);
  transitionTimer=setTimeout(()=>{track.style.transition='none';track.style.transform='translateY(0)';paint(rows);},reduced?0:670);
 }
 async function poll(){
  try{
   const response=await fetch('/api/collection/status');if(!response.ok)throw Error('Collection unavailable');
   const data=await response.json();if(!closed)update(data);
  }catch(error){if(!closed)counter.parentElement.title='Waiting for Common Crawl; count paused.';}
  if(!closed)timer=setTimeout(poll,1000);
 }
 window.addEventListener('pagehide',()=>{closed=true;clearTimeout(timer);clearTimeout(transitionTimer);});
 poll();
})();
