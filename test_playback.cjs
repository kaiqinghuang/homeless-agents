// Unit-test the actual player against real phoneme plans with a deterministic clock.
// No browser or microphone is opened. Run: node test_playback.cjs
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const plans = JSON.parse(execFileSync('python3', ['-c', `
import json
from mouth_plan import plan
print(json.dumps([plan(s) for s in ['Make a face. You move through the room.', '你好，我听见了风。', 'Hello，你好吗？2026。']]))
`], {cwd: __dirname, encoding:'utf8'}));
function element() {
 return {value:'', textContent:'', disabled:false, children:[], dataset:{}, style:{}, attrs:{},
  classList:{toggle(key, value){this[key]=value;}}, addEventListener(){},
  setAttribute(key,value){this.attrs[key]=value;}, append(e){this.children.push(e);},
  replaceChildren(...items){this.children=items;}, getContext(){return {};}};
}
const elements=new Map();
const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
get('speed').value=50; get('amount').value=50;
let currentPlan=plans[0], pending=null, sent=[];
const context=vm.createContext({
 document:{getElementById:get,querySelectorAll:()=>[],querySelector:()=>get('track'),createElement:element},
 performance:{now:()=>1000},requestAnimationFrame(){},Image:class{},window:{},
 fetch:async (_url,opts)=>{sent.push(JSON.parse(opts.body));return pending ? await pending :
  {ok:true,json:async()=>JSON.parse(JSON.stringify(currentPlan))};}
});
const run=code=>vm.runInContext(code,context);
run(fs.readFileSync(__dirname+'/app.js','utf8'));
run('draw=()=>{};state.ready=true;');
(async()=>{
 let checked=0;
 for(const p of plans){
  currentPlan=p;get('text').value=p.words.map(w=>w.text).join('');await run('play()');
  const scaled=run('state.plan');
  assert.ok(Math.abs(scaled.duration-p.duration/.17)<1e-9);
  assert.equal(get('readout').children.map(e=>e.textContent).join(''),get('text').value);
  assert.match(get('meta').textContent,/PHONEMES/);
  assert.equal(get('pronunciation').children.length,p.words.length);
  for(const [index,cue] of scaled.timeline.entries()){
   run(`frame(${1000+(cue.start+cue.end)*500})`);
   assert.equal(get('readout').children.findIndex(e=>e.classList.current),cue.word);
   assert.equal(run('lastCue'),index);checked++;
  }
  run(`frame(${1000+scaled.duration*1000+10})`);
  assert.equal(run('state.playing'),false);
  assert.equal(get('readout').children.some(e=>e.classList.current),false);
 }
 currentPlan=plans[0];await run('window.afterimageMotion.echo("Make a face.")');
 assert.equal(sent.at(-1).text,'Make a face.');
 assert.equal(await run('window.afterimageMotion.echo("later transcript")'),false);
 assert.equal(get('text').value,'Make a face.');run('stop()');
 let release;pending=new Promise(resolve=>{release=resolve;});
 const loading=run('play()');run('stop()');
 release({ok:true,json:async()=>plans[0]});await loading;
 assert.equal(run('state.playing'),false);
 pending=null;currentPlan={...plans[0],method:'old spelling rules'};
 await run('play()');assert.equal(run('state.playing'),false);
 assert.match(get('error').textContent,/Restart/);
 console.log(`PASS: ${checked} timed cues, exact captions, phoneme inspector, pace, busy echo, cancellation, old-server guard.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
