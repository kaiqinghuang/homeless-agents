// Exercise real response scheduling with deferred network promises, not a browser.
const vm=require('node:vm'), fs=require('node:fs'), assert=require('node:assert/strict');
const elements=new Map();
const el=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',disabled:false,hidden:false,
 handlers:{},addEventListener(name,fn){this.handlers[name]=fn;}});return elements.get(id);};
el('speech-language').value='en';el('response-mode').value='ai';el('response-threshold').value='60';
let busyFace=false, automatic=false, pump, resolveRequest, calls=[], spoken=[];
const context=vm.createContext({document:{getElementById:el},AbortController,Date,
 window:{addEventListener(){},afterimageMotion:{isBusy:()=>busyFace,isAutomatic:()=>automatic,
  cancelEcho(){automatic=false;},async echo(text){spoken.push(text);automatic=true;return true;}}},
 fetch:(_url,options)=>{calls.push(JSON.parse(options.body));return new Promise(resolve=>{resolveRequest=resolve;});},
 setInterval(fn){pump=fn;}});
vm.runInContext(fs.readFileSync(__dirname+'/agent.js','utf8'),context);
const agent=context.window.afterimageAgent;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 agent.status({state:'ready',model:'local'});
 agent.observe({kind:'audio',id:'wrong-language',language_mode:'zh'});assert.equal(calls.length,0);
 agent.observe({kind:'audio',id:'first'});assert.equal(calls.length,1);
 agent.observe({kind:'speech',id:'second'});agent.observe({kind:'audio',id:'latest'});
 resolveRequest({ok:true,json:async()=>({action:'silent',reason:'background',text:'',salience:.1})});await flush();
 pump();assert.equal(calls.at(-1).event_id,'latest');
 agent.stop();
 resolveRequest({ok:true,json:async()=>({action:'speak',reason:'question',text:'Stale reply',salience:.9})});await flush();
 assert.equal(spoken.length,0,'stop must prevent a late reply from moving the face');
 busyFace=true;agent.observe({kind:'speech',id:'wait-for-face'});pump();assert.equal(calls.length,2);
 busyFace=false;pump();assert.equal(calls.at(-1).event_id,'wait-for-face');
 resolveRequest({ok:true,json:async()=>({action:'speak',reason:'question',text:'A current reply',salience:.9})});await flush();
 assert.deepEqual(spoken,['A current reply']);pump();assert.equal(el('agent-cancel').disabled,false);
 el('response-mode').value='collect';el('response-mode').handlers.change();
 agent.observe({kind:'speech',id:'collect-only'});pump();assert.equal(calls.length,3);
 assert.equal(automatic,false);
 el('response-mode').value='ai';el('speech-language').value='zh';el('agent-input').value='Hello';
 el('agent-test').handlers.click();assert.equal(calls.at(-1).language,'zh');
 agent.stop();
 console.log('PASS: latest-input queue, face-busy wait, stop/cancel, mode change, and generated reply playback.');
})().catch(error=>{console.error(error);process.exitCode=1;});
