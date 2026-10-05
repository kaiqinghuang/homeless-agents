'use strict';
(()=>{
 const track=document.getElementById('hud-source-track'),counter=document.getElementById('hud-training-count');
 const restartButton=document.getElementById('collection-restart'),resetState=document.getElementById('collection-reset-state');
 let runId=null,sequence=0,rows=[],timer=null,transitionTimer=null,closed=false,restarting=false,pollEpoch=0;
 function row(source){
  const node=document.createElement('div');node.className='hud-source';node.textContent=source.display;
  node.title=source.url+(source.snapshot_date?' · Common Crawl '+source.snapshot_date:'');
  node.dataset.sourceId=source.id;return node;
 }
 function paint(items){track.replaceChildren(...items.map(row));}
 function syncMetric(){window.dispatchEvent(new CustomEvent('afterimage:collection',{detail:{runId,sequence}}));}
 function reset(data){
  clearTimeout(transitionTimer);track.style.transition='none';track.style.transform='translateY(0)';
  runId=data.run_id;sequence=data.sequence;rows=data.entries;paint(rows);counter.textContent=String(data.count);syncMetric();
 }
 function update(data){
  counter.parentElement.title=data.error?'Waiting for Common Crawl: '+data.error:'Common Crawl → preference-filtered fragments. Temporary collection; not used for LoRA training.';
  if(runId!==data.run_id||data.sequence<sequence||data.sequence>sequence+1||rows.length!==7){reset(data);return;}
  if(data.sequence===sequence)return; // No real record: no movement or counter change.
  const newest=data.entries.at(-1),reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  sequence=data.sequence;rows=data.entries;
  track.appendChild(row(newest));
  // Commit the unshifted eighth row before beginning the seven-row viewport scroll.
  void track.offsetHeight;
  track.style.transition=reduced?'none':'transform 650ms cubic-bezier(.22,.7,.25,1)';
  track.style.transform='translateY(calc(-73 * var(--u)))';
  counter.textContent=String(data.count);syncMetric();
  transitionTimer=setTimeout(()=>{track.style.transition='none';track.style.transform='translateY(0)';paint(rows);},reduced?0:670);
 }
 async function poll(){
  const epoch=pollEpoch;
  try{
   const response=await fetch('/api/collection/status');if(!response.ok)throw Error('Collection unavailable');
   const data=await response.json();
   if(!closed&&!restarting&&epoch===pollEpoch){update(data);restartButton.disabled=false;}
  }catch(error){if(!closed&&epoch===pollEpoch)counter.parentElement.title='Waiting for Common Crawl; count paused.';}
  if(!closed&&!restarting&&epoch===pollEpoch)timer=setTimeout(poll,1000);
 }
 restartButton.addEventListener('click',async()=>{
  if(restarting||!runId)return;
  restarting=true;pollEpoch++;clearTimeout(timer);
  restartButton.disabled=true;restartButton.textContent='正在重启…';resetState.textContent='正在清空本轮临时数据…';
  try{
   const response=await fetch('/api/collection/restart',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_id:runId})});
   const data=await response.json();if(!response.ok)throw Error(data.error||'重启失败');
   if(!closed){reset(data);resetState.textContent='已重新开始采集，计数从 '+data.base_count+' 开始。';}
  }catch(error){if(!closed)resetState.textContent='未能确认重启结果，请重试。';}
  finally{
   restarting=false;restartButton.textContent='重启实时采集';restartButton.disabled=false;
   if(!closed)poll();
  }
 });
 window.addEventListener('pagehide',()=>{closed=true;clearTimeout(timer);clearTimeout(transitionTimer);});
 poll();
})();

// Seven native-size text lines: the same measurement is used for prefetch and display.
(()=>{
 const output=document.getElementById('word-subtitle');
 let words=null,spans=[],spoken=-1,measure=null;
 function clear(){words=null;spans=[];spoken=-1;output.textContent='Homeless Agent Output:';}
 function render(next){
  if(words===next)return;
  words=next;spoken=-1;
  const prefix=document.createElement('span');prefix.className='output-prefix';prefix.textContent='Homeless Agent Output: ';
  spans=next.map(word=>{const span=document.createElement('span');span.className='output-word';span.textContent=word.text;return span;});
  output.replaceChildren(prefix,...spans);
 }
 function advance(index){
  if(index<0)return;
  const end=Math.min(index,spans.length-1);
  for(let i=spoken+1;i<=end;i++)spans[i].classList.add('spoken');
  spoken=Math.max(spoken,end);
 }
 function height(text){
  if(!measure){
   measure=document.createElement('div');measure.setAttribute('aria-hidden','true');
   Object.assign(measure.style,{position:'fixed',left:'-10000px',top:'0',visibility:'hidden',pointerEvents:'none',width:'776px',fontFamily:'"Artwork Myriad Pro","Myriad Pro","PingFang SC",sans-serif',fontSize:'30px',fontWeight:'400',lineHeight:'37px',whiteSpace:'normal',overflowWrap:'anywhere',padding:'0',border:'0'});
   document.body.appendChild(measure);
  }
  measure.textContent='Homeless Agent Output: '+text;return measure.scrollHeight;
 }
 function page(raw){
  const text=raw.replace(/\s+/g,' ').trim();
  const fits=t=>t.length<=900&&height(t)<=259;
  if(fits(text))return {text,remaining:'',ready:height(text)>=259};
  const ends=[...text.matchAll(/\s+/g)].map(m=>m.index).filter(n=>n>0&&n<=900);
  let lo=0,hi=ends.length-1,cut=0;
  while(lo<=hi){const mid=(lo+hi)>>1;if(fits(text.slice(0,ends[mid]))){cut=ends[mid];lo=mid+1;}else hi=mid-1;}
  if(!cut){ // A single long URL/token may span several lines; preserve every character.
   const chars=Array.from(text);lo=1;hi=Math.min(chars.length,900);
   while(lo<=hi){const mid=(lo+hi)>>1,part=chars.slice(0,mid).join('');if(fits(part)){cut=part.length;lo=mid+1;}else hi=mid-1;}
  }
  return {text:text.slice(0,cut),remaining:text.slice(cut).trimStart(),ready:true};
 }
 function sampling(values){
  if(!values)return;
  for(const [key,id] of [['temperature','hud-temperature'],['top_p','hud-top-p']]){const node=document.getElementById(id);if(node&&Number.isFinite(values[key]))node.textContent=String(values[key]);}
 }
 window.afterimageOutput={render,advance,finish:()=>advance(spans.length-1),clear,page,sampling,ready:()=>document.fonts?.ready??Promise.resolve()};
})();

// Four measured benchmarks follow successful collection publications (normally every 16 seconds).
(()=>{
 const dataNode=document.getElementById('hud-benchmark-data');
 if(!dataNode)return;
 const metrics=JSON.parse(dataNode.textContent);
 const chart=document.querySelector('.hud-chart');
 const line=document.getElementById('hud-metric-curve');
 const points=[...document.querySelectorAll('#hud-metric-points circle')];
 const yLabels=[...document.querySelectorAll('.hud-chart-y-labels text')];
 const xUnit=document.querySelector('.hud-chart-x-labels text:last-child');
 const rows=[...document.querySelectorAll('.hud-metric')];
 const dot=document.querySelector('.hud-metric-dot');
 function show(index){
  const metric=metrics[index];
  const coords=metric.points.map(point=>[89+.72*point.samples,177-144*point.value/metric.yMax]);
  line.setAttribute('d',coords.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(4)} ${y.toFixed(4)}`).join(' '));
  coords.forEach(([x,y],i)=>{points[i].setAttribute('cx',x.toFixed(4));points[i].setAttribute('cy',y.toFixed(4));});
  yLabels.forEach((label,i)=>{label.textContent=i===5?metric.yUnit:String(i*metric.yMax/4);});
  xUnit.textContent=metric.xUnit;
  document.getElementById('chart-title').textContent=metric.label;
  document.getElementById('chart-desc').textContent=metric.description;
  chart.dataset.metric=metric.id;
  rows.forEach((row,i)=>{row.classList.toggle('is-active',i===index);if(i===index)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');});
  rows[index].prepend(dot);
 }
 // Use the same publication sequence as the URL list, including refreshes and missed polls.
 // No independent timer: a delayed/failed collection also pauses the chart.
 window.addEventListener('afterimage:collection',event=>{
  const sequence=event.detail.sequence;
  if(Number.isInteger(sequence)&&sequence>=0)show(sequence%metrics.length);
 });
 show(0);
})();
