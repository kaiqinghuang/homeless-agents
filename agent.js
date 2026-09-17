'use strict';
(() => {
 const el=id=>document.getElementById(id);
 const state={ready:false,busy:false,pending:null,generation:0,controller:null,configured:false};
 const reasons={quiet:'Quiet input / 安静片段',cooldown:'Between responses / 回应间隔中',
  environment_interval:'Environment check interval / 环境判断间隔中',model_busy:'Model is busy / 模型忙碌',
  below_threshold:'Below response threshold / 未达到回应阈值',background:'Background / 背景声音',
  unclear:'Unclear input / 输入不明确',question:'Question / 问题',addressed:'Addressed / 有人在说话',
  ambient_change:'Ambient change / 环境变化'};
 const threshold=()=>Number(el('response-threshold').value)/100;
 const mode=()=>el('response-mode').value;
 function note(value){el('decision-state').textContent=value;}
 function buttons(){
  el('agent-test').disabled=!state.ready||state.busy||mode()!=='ai'||window.afterimageMotion.isBusy();
  el('agent-cancel').disabled=!state.busy&&!state.pending&&!window.afterimageMotion.isAutomatic();
 }
 function render(result){
  const label={speak:'Response / 回应',silent:'Silence / 沉默',deferred:'Waiting / 暂缓',error:'Model error / 模型错误'}[result.action];
  el('agent-reply').textContent=result.text||'—';
  note(label+' · '+(reasons[result.reason]||result.error||result.reason)+(typeof result.salience==='number'?' · '+result.salience.toFixed(2):''));
 }
 async function run(path,body){
  const generation=state.generation;
  state.busy=true;state.controller=new AbortController();buttons();note('Considering a response… / 正在决定是否回应');
  try{
   const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...body,threshold:threshold()}),signal:state.controller.signal});
   const result=await response.json();
   if(generation!==state.generation||mode()!=='ai')return;
   if(!response.ok)throw Error(result.error||'Local decision failed.');
   render(result);
   if(result.action==='speak'){
    const played=await window.afterimageMotion.echo(result.text);
    if(generation!==state.generation)return;
    if(!played)note('Reply saved; face is busy or playback failed. / 回应已记录；人脸忙碌或播放失败。');
   }
  }catch(error){if(error.name!=='AbortError'&&generation===state.generation)note('Model error / 模型错误：'+error.message);}
  finally{if(generation===state.generation){state.busy=false;state.controller=null;buttons();}}
 }
 function stop(){
  state.generation++;state.pending=null;state.controller?.abort();state.controller=null;state.busy=false;
  window.afterimageMotion.cancelEcho();note('Response stopped / 回应已停止');buttons();
 }
 function pump(){
  buttons();
  if(!state.pending||state.busy||mode()!=='ai')return;
  if(Date.now()-state.pending.received>30000){state.pending=null;note('Older input skipped / 已跳过等待过久的输入');return;}
  if(!state.ready||window.afterimageMotion.isBusy())return;
  const item=state.pending;state.pending=null;
  run('/api/agent/decide',{event_id:item.event.id});
 }
 window.afterimageAgent={
  stop,
  mode,
  status(data){
   if(!state.configured&&typeof data?.threshold==='number'){
    el('response-threshold').value=Math.round(data.threshold*100);el('threshold-value').textContent=threshold().toFixed(2);state.configured=true;
   }
   state.ready=data?.state==='ready';
   el('agent-model').textContent=state.ready?data.model+' · Local / 本地':data?.error||'Connecting to local model… / 正在连接本地模型';
   el('agent-retry').hidden=data?.state!=='error';buttons();
  },
  observe(event){
   if(mode()!=='ai'||!['speech','environment','silence'].includes(event.kind))return;
   state.pending={event,received:Date.now()};
   if(state.busy||window.afterimageMotion.isBusy())note('Latest input waiting / 最新输入等待回应');
   pump();
  }
 };
 el('response-mode').addEventListener('change',()=>{stop();note(mode()==='ai'?'Listening for a reason to respond / 等待值得回应的声音':mode()==='echo'?'Transcript echo / 复述识别文字':'Collecting only / 只收集，不回应');});
 el('response-threshold').addEventListener('input',()=>{el('threshold-value').textContent=threshold().toFixed(2);});
 el('agent-cancel').addEventListener('click',stop);
 el('agent-test').addEventListener('click',()=>{
  const text=el('agent-input').value.trim();if(!text){note('Enter a test message first. / 请先输入测试文字。');return;}
  state.pending=null;run('/api/agent/test',{text});
 });
 el('agent-retry').addEventListener('click',async()=>{
  try{await fetch('/api/agent/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});note('Reconnecting… / 正在重连');}
  catch(error){note(error.message);}
 });
 setInterval(pump,500);
 window.addEventListener('pagehide',()=>{state.generation++;state.controller?.abort();state.pending=null;});
})();
