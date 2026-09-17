'use strict';
(() => {
 const el=id=>document.getElementById(id);
 const session={active:false,starting:false,stream:null,context:null,node:null,analyser:null,ring:[],ringSeconds:0,clip:null,
   elapsed:0,lastAbove:0,clipStart:0,floor:-65,lastRoom:0,lastAmbient:0,lastMeter:0,queue:[],busy:false,controller:null,
   generation:0,id:'',ready:false,events:[],statusTimer:null};
 let room={rms_dbfs:-100,peak_dbfs:-100,brightness_hz:0};
 let pollErrors=0;
 const inputPreferenceKey='afterimage.microphone.v1';
 let inputPreference='builtin';
 try{inputPreference=localStorage.getItem(inputPreferenceKey)||'builtin';}catch(error){}
 const text=(id,value)=>{el(id).textContent=value;};
 function db(value){return Math.max(-100,20*Math.log10(Math.max(1e-5,value)));}
 function status(value){text('mic-state',value);}
 function message(value){text('listen-error',value);}
 function buttons(){
  el('listen-start').disabled=!session.ready||session.active||session.starting;
  el('listen-stop').disabled=!session.active&&!session.starting;
  el('microphone').disabled=session.active||session.starting;
  el('audio-test').disabled=!session.ready||session.active||session.busy;
 }
 async function poll(){
  try{
   const response=await fetch('/api/status');
   if(!response.ok)throw Error('Restart Start.command once to enable the new listening service.');
   const data=await response.json();
   if(data.stage!==2)throw Error('Restart Start.command to load the listening service.');
   session.ready=data.engine.state==='ready';
   text('engine-state',session.ready?'Whisper small · '+data.engine.backend+' · 本地':data.engine.state==='loading'?'Loading local speech model…':data.engine.error||'Speech model unavailable');
   el('engine-state').classList.toggle('engine-ready',session.ready);
   const counts=data.archive.counts;
   text('archive-count',(counts.speech||0)+' speech clips · '+((counts.environment||0)+(counts.silence||0))+' environment clips today');
   pollErrors=0;buttons();
  }catch(error){session.ready=false;buttons();text('engine-state',error.message);pollErrors++;}
  session.statusTimer=setTimeout(poll,pollErrors?5000:3000);
 }
 async function devices(){
  const available=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput');
  const named=available.filter(d=>d.deviceId&&d.deviceId!=='default'&&d.deviceId!=='communications');
  el('microphone').replaceChildren(new Option('Mac built-in / 电脑内置（默认）','builtin'));
  named.forEach((d,i)=>el('microphone').add(new Option(d.label||'Microphone '+(i+1)+' / 名称待授权',d.deviceId)));
  el('microphone').add(new Option('System default / 系统默认（可能是手机）','system'));
  if(![...el('microphone').options].some(o=>o.value===inputPreference)){
   el('microphone').add(new Option('Saved input unavailable / 已选设备未连接',inputPreference));
  }
  el('microphone').value=inputPreference;
  return named;
 }
 function resolveInput(preference,available){
  if(preference==='system')return undefined;
  if(preference==='builtin'){
   // Ignore default aliases: their labels can mention a built-in mic while routing elsewhere later.
   const builtIn=available.find(d=>d.label&&!/iphone|ipad|continuity|airpods|连续互通|接续互通/i.test(d.label)&&/macbook|imac|built[ -]?in|internal microphone|内置|內建|内建/i.test(d.label));
   if(builtIn)return builtIn.deviceId;
   throw Error('Built-in mic not identified. Choose a named input above. If names are hidden, first set macOS System Settings → Sound → Input to MacBook Microphone, then select System default here to grant access. / 未识别到内置麦克风，请手选设备；名称隐藏时，先在系统设置→声音→输入选择 MacBook 麦克风，再用“系统默认”完成首次授权。');
  }
  if(available.some(d=>d.deviceId===preference))return preference;
  throw Error('Selected microphone is unavailable. Reconnect it or choose another input. / 已选麦克风未连接，请重新连接或选择其他输入。');
 }
 function renderEvents(){
  const list=el('sound-events');list.replaceChildren();
  if(!session.events.length){const li=document.createElement('li');li.className='note';li.textContent='No sounds collected yet. / 尚未收集声音。';list.append(li);return;}
  for(const event of session.events.slice(0,12)){
   const li=document.createElement('li');li.className=event.kind==='speech'?'speech':'environment';
   const meta=document.createElement('div');meta.className='event-meta';
   const when=document.createElement('span');when.textContent=new Date(event.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
   const kind=document.createElement('span');kind.textContent=(event.kind==='speech'?(event.language||'speech').toUpperCase():event.kind.toUpperCase())+' · '+event.features.duration.toFixed(1)+' s';
   meta.append(when,kind);
   const content=document.createElement('div');content.className='event-text';
   content.textContent=event.text||event.error||(event.kind==='silence'?'Quiet sample':'No speech accepted · '+event.features.texture)+' · '+event.features.rms_dbfs+' dBFS';
   li.append(meta,content);list.append(li);
  }
 }
 async function recent(){try{const r=await fetch('/api/events');if(r.ok){session.events=(await r.json()).events;renderEvents();}}catch(error){renderEvents();}}
 function concatenate(blocks){const out=new Float32Array(blocks.reduce((n,b)=>n+b.length,0));let offset=0;for(const b of blocks){out.set(b,offset);offset+=b.length;}return out;}
 function tail(seconds){
  let remaining=Math.round(seconds*session.context.sampleRate);const result=[];
  for(let i=session.ring.length-1;i>=0&&remaining>0;i--){const b=session.ring[i];const take=Math.min(remaining,b.length);result.unshift(b.slice(b.length-take));remaining-=take;}
  return result;
 }
 function wav(samples,rate){
  const targetRate=16000, count=Math.floor(samples.length*targetRate/rate), pcm=new Float32Array(count);
  // Averaging resampler for microphone PCM. Keep the original stream separately from sound descriptors.
  for(let i=0;i<count;i++){
   const start=i*rate/targetRate,end=(i+1)*rate/targetRate;
   let sum=0,weight=0;
   for(let j=Math.floor(start);j<Math.ceil(end)&&j<samples.length;j++){
    const w=Math.max(0,Math.min(j+1,end)-Math.max(j,start));sum+=samples[j]*w;weight+=w;
   }
   pcm[i]=weight?sum/weight:0;
  }
  const buffer=new ArrayBuffer(44+count*2),view=new DataView(buffer);
  const string=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  string(0,'RIFF');view.setUint32(4,36+count*2,true);string(8,'WAVE');string(12,'fmt ');view.setUint32(16,16,true);
  view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);string(36,'data');view.setUint32(40,count*2,true);
  for(let i=0;i<count;i++){const v=Math.max(-1,Math.min(1,pcm[i]));view.setInt16(44+i*2,Math.round(v*(v<0?32768:32767)),true);}
  return buffer;
 }
 function enqueue(blocks,source,rate){
  if(!blocks.length)return;
  if(session.queue.length>=2){message('Recognition is behind; one new clip was skipped. / 识别积压，已跳过一个片段。');return;}
  const samples=concatenate(blocks);
  if(samples.length/rate<.4)return;
  session.queue.push({audio:wav(samples,rate),source,language:el('speech-language').value,generation:session.generation});
  processQueue();
 }
 async function processQueue(){
  if(session.busy||!session.queue.length)return;
  const item=session.queue.shift(),generation=item.generation;
  session.busy=true;session.controller=new AbortController();buttons();text('recognition-state','Recognizing locally… / 本地识别中');
  try{
   const params=new URLSearchParams({language:item.language,source:item.source,session:session.id});
   const response=await fetch('/api/audio?'+params,{method:'POST',headers:{'Content-Type':'audio/wav'},body:item.audio,signal:session.controller.signal});
   const result=await response.json();
   if(generation!==session.generation)return;
   if(!response.ok){if(result.id){session.events.unshift(result);renderEvents();}throw Error(result.error||'Local recognition failed.');}
   session.events.unshift(result);session.events=session.events.slice(0,20);renderEvents();
   text('recognition-state',result.kind==='speech'?'Heard '+(result.language||'speech').toUpperCase()+' · '+result.processing_seconds+' s':'Environment captured · 环境声已记录');
   if(result.text&&el('echo-speech').checked&&['en','zh'].includes(result.language)){
    const played=await window.afterimageMotion?.echo(result.text);
    if(!played)text('recognition-state','Speech saved · face is busy / 已记录，口型播放中');
   }
  }catch(error){if(error.name!=='AbortError'&&generation===session.generation){message(error.message);text('recognition-state','Recognition error / 识别失败');}}
  finally{session.busy=false;session.controller=null;buttons();if(session.queue.length)processQueue();}
 }
 function capture(block){
  if(!session.active)return;
  const rate=session.context.sampleRate, seconds=block.length/rate;
  session.elapsed+=seconds;
  let power=0,peak=0;for(const value of block){power+=value*value;peak=Math.max(peak,Math.abs(value));}
  const level=db(Math.sqrt(power/block.length));room.rms_dbfs=level;room.peak_dbfs=db(peak);
  session.ring.push(block);session.ringSeconds+=seconds;
  while(session.ringSeconds>6.5&&session.ring.length>1){session.ringSeconds-=session.ring.shift().length/rate;}
  if(session.elapsed<1.3)session.floor=Math.max(-80,Math.min(-25,session.floor*.65+level*.35));
  else if(!session.clip)session.floor=session.floor*.985+Math.min(level,session.floor+3)*.015;
  const threshold=Math.max(-55,Math.min(-28,session.floor+9));
  const above=level>threshold;
  if(session.clip){
   session.clip.push(block);if(above)session.lastAbove=session.elapsed;
   if(session.elapsed-session.lastAbove>.8||session.elapsed-session.clipStart>=10){
    enqueue(session.clip,'candidate',rate);session.clip=null;session.lastAmbient=session.elapsed;
   }
  }else if(session.elapsed>1.3&&above){
   session.clip=tail(.45);session.clipStart=session.elapsed-.45;session.lastAbove=session.elapsed;
  }
  if(!session.clip&&session.elapsed-session.lastAmbient>=20&&session.ringSeconds>=4){
   if(!session.busy&&!session.queue.length)enqueue(tail(5),'ambient',rate);
   session.lastAmbient=session.elapsed;
  }
  if(session.elapsed-session.lastMeter>.2){
   session.lastMeter=session.elapsed;el('input-level').value=level;text('level-value',level.toFixed(0)+' dBFS');
   status(session.elapsed<1.3?'Calibrating room… / 测量背景声':session.clip?'Sound activity · 声音活动':'Listening · 正在聆听');
   const spectrum=new Float32Array(session.analyser.frequencyBinCount);session.analyser.getFloatFrequencyData(spectrum);
   let total=0,weighted=0;for(let i=1;i<spectrum.length;i++){const power=Math.pow(10,spectrum[i]/10);total+=power;weighted+=power*i*rate/session.analyser.fftSize;}
   room.brightness_hz=total?weighted/total:0;
  }
  if(session.elapsed-session.lastRoom>=10){
   session.lastRoom=session.elapsed;
   fetch('/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...room,session:session.id})})
    .then(r=>{if(!r.ok)throw Error('Room observation could not be saved.');}).catch(e=>{if(session.active)message(e.message);});
  }
 }
 async function start(){
  if(session.active||session.starting)return;
  if(!navigator.mediaDevices?.getUserMedia){message('Microphone access needs localhost in Safari or Chrome.');return;}
  message('');session.starting=true;const generation=++session.generation;buttons();status('Waiting for microphone permission…');
  try{
   const available=await devices();
   if(generation!==session.generation)return;
   const device=resolveInput(inputPreference,available);
   const stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:device?{exact:device}:undefined,channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
   if(generation!==session.generation){stream.getTracks().forEach(t=>t.stop());return;}
   session.stream=stream;
   text('active-input','Active input / 正在使用：'+(stream.getAudioTracks()[0]?.label||'Unnamed microphone'));
   const context=new AudioContext({sampleRate:16000});session.context=context;
   await context.audioWorklet.addModule('audio-capture.js');await context.resume();
   if(generation!==session.generation){stream.getTracks().forEach(t=>t.stop());if(context.state!=='closed')await context.close();return;}
   const source=context.createMediaStreamSource(stream);
   session.node=new AudioWorkletNode(session.context,'afterimage-capture');
   session.analyser=session.context.createAnalyser();session.analyser.fftSize=2048;
   source.connect(session.analyser);source.connect(session.node);session.node.connect(session.context.destination);
   session.id=crypto.randomUUID();session.elapsed=0;session.lastRoom=0;session.lastAmbient=0;session.lastMeter=0;session.floor=-65;session.ring=[];session.ringSeconds=0;session.clip=null;
   session.active=true;session.node.port.onmessage=event=>capture(event.data);
   for(const track of stream.getAudioTracks())track.addEventListener('ended',()=>{if(session.active){stop();message('Microphone disconnected. Choose an input and start again.');}});
   el('recording-dot').hidden=false;status('Calibrating room… / 测量背景声');await devices().catch(()=>{});
  }catch(error){if(generation===session.generation){await stop();message(error.name==='NotAllowedError'?'Microphone permission was not granted. Allow it in your browser, then try again.':error.message);}}
  finally{if(generation===session.generation){session.starting=false;buttons();}}
 }
 async function stop(){
  session.generation++;session.active=false;session.starting=false;session.queue=[];session.clip=null;session.ring=[];
  if(session.stream)session.stream.getTracks().forEach(t=>t.stop());session.stream=null;
  if(session.node){session.node.port.onmessage=null;session.node.disconnect();session.node=null;}
  if(session.controller)session.controller.abort();
  const context=session.context;session.context=null;if(context&&context.state!=='closed')await context.close();
  el('recording-dot').hidden=true;el('input-level').value=-100;text('level-value','— dBFS');status('Microphone off / 麦克风已关闭');text('active-input','Active input / 正在使用：—');text('recognition-state','');buttons();
 }
 el('microphone').addEventListener('change',()=>{
  inputPreference=el('microphone').value;
  try{localStorage.setItem(inputPreferenceKey,inputPreference);}catch(error){}
  message('');
 });
 el('listen-start').addEventListener('click',start);el('listen-stop').addEventListener('click',stop);
 el('audio-test').addEventListener('click',()=>el('audio-file').click());
 el('audio-file').addEventListener('change',async()=>{
  const file=el('audio-file').files[0];if(!file)return;message('');let context;
  try{
   if(file.size>15*1024*1024)throw Error('Choose an audio file under 15 MB.');
   context=new AudioContext();const decoded=await context.decodeAudioData(await file.arrayBuffer());
   if(decoded.duration<.4||decoded.duration>15)throw Error('Choose a short audio clip: 0.4–15 seconds.');
   const mono=new Float32Array(decoded.length);for(let c=0;c<decoded.numberOfChannels;c++){const data=decoded.getChannelData(c);for(let i=0;i<mono.length;i++)mono[i]+=data[i]/decoded.numberOfChannels;}
   session.id='file-'+crypto.randomUUID();enqueue([mono],'file',decoded.sampleRate);
  }catch(error){message(error.message);}finally{if(context)await context.close();el('audio-file').value='';}
 });
 navigator.mediaDevices?.addEventListener('devicechange',()=>devices().catch(()=>{}));
 window.addEventListener('pagehide',()=>{session.stream?.getTracks().forEach(t=>t.stop());session.controller?.abort();});
 poll();devices().catch(()=>{});recent();
})();
