const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const data=JSON.parse(fs.readFileSync('assets/training-sources.json','utf8'));
const corpus=fs.readFileSync('training/residue-qwen05-20261001/corpus.jsonl','utf8').trim().split('\n').map(JSON.parse).filter(r=>r.split==='train');
assert.equal(data.sources.length,139);assert.deepEqual(data.sources.map(s=>s.url),corpus.map(s=>s.url));
function element(){return {textContent:'',children:[],style:{},dataset:{},replaceChildren(...r){this.children=r;}};}
const els=new Map();const el=id=>{if(!els.has(id))els.set(id,element());return els.get(id);};
el('hud-training-count').textContent='139';
let tick,finish,frame;const ctx=vm.createContext({document:{getElementById:el,createElement:element},window:{addEventListener(){},matchMedia:()=>({matches:false}),afterimageMotion:{snapshot:()=>({label:'OO',pace:.17})}},setInterval(fn,ms){assert.equal(ms,8000);tick=fn;},clearInterval(){},setTimeout(fn){finish=fn;},clearTimeout(){},requestAnimationFrame(fn){frame=fn;},fetch:async url=>({ok:true,json:async()=>url.includes('sources')?data:{base_model:'Qwen2.5-0.5B'}})});
vm.runInContext(fs.readFileSync('artwork-overlay.js','utf8'),ctx);
setImmediate(()=>{
 for(let n=1;n<=320;n++){
  tick();assert.match(el('hud-source-track').style.transform,/-66/);finish();
  assert.equal(el('hud-training-count').textContent,'139');
  assert.equal(el('hud-source-track').children[0].dataset.sourceId,data.sources[n%139].id);
 }
 assert.equal(frame,undefined,'source list has no per-frame parameter or mouth polling');
 const html=fs.readFileSync('index.html','utf8');
 assert.ok(html.includes('Collecting Discarded Data'));
 for(const id of ['hud-base','hud-steps','hud-mouth','hud-pace','hud-recording','hud-temperature','hud-top-p','monitor-toggle'])assert.ok(!html.includes('id="'+id+'"'));
 assert.ok(!html.includes('<script src="environment-monitor.js'));
 assert.ok(html.includes('Homeless Agent:'));
 console.log('PASS: all 139 training sources in order, 8-second source steps / fixed 139, 320 transitions, minimal text-only overlay.');
});
