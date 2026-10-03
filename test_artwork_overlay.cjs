const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const sources=JSON.parse(fs.readFileSync('assets/training-sources.json','utf8')).sources;
const corpus=fs.readFileSync('training/residue-qwen05-20261001/corpus.jsonl','utf8').trim().split('\n').map(JSON.parse).filter(r=>r.split==='train');
assert.equal(sources.length,139);assert.deepEqual(sources.map(s=>s.url),corpus.map(s=>s.url));
function element(){return {textContent:'',children:[],style:{},dataset:{},title:'',parentElement:{title:''},replaceChildren(...r){this.children=r;},appendChild(r){this.children.push(r);}};}
const els=new Map();const el=id=>{if(!els.has(id))els.set(id,element());return els.get(id);};
const timers=new Map();let id=0,failed=false;
let data={run_id:'first',sequence:0,count:139,entries:sources.slice(0,6)};
const ctx=vm.createContext({document:{getElementById:el,createElement:element},window:{addEventListener(){},matchMedia:()=>({matches:false})},setTimeout(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},fetch:async()=>{if(failed)throw Error('offline');return {ok:true,json:async()=>data};}});
const flush=()=>new Promise(r=>setImmediate(r));
async function tick(ms){const entry=[...timers].find(([,t])=>t.ms===ms);assert.ok(entry,'missing timer '+ms);timers.delete(entry[0]);await entry[1].fn();await flush();}
vm.runInContext(fs.readFileSync('artwork-overlay.js','utf8'),ctx);
(async()=>{
 await flush();assert.equal(el('hud-training-count').textContent,'139');assert.equal(el('hud-source-track').children.length,6);
 const firstIds=el('hud-source-track').children.map(r=>r.dataset.sourceId);
 for(let i=0;i<8;i++)await tick(1000);
 assert.deepEqual(el('hud-source-track').children.map(r=>r.dataset.sourceId),firstIds,'no new record means no fake scrolling');
 const fresh={id:'live-1',url:'https://new.example/a',display:'new.example'};
 data={...data,sequence:1,count:140,entries:[...data.entries.slice(1),fresh]};await tick(1000);
 assert.equal(el('hud-source-track').children.length,7);assert.equal(el('hud-training-count').textContent,'140');
 assert.match(el('hud-source-track').style.transform,/-66/);await tick(670);assert.equal(el('hud-source-track').children.length,6);
 assert.equal(el('hud-source-track').children.at(-1).textContent,'new.example');
 failed=true;await tick(1000);assert.equal(el('hud-training-count').textContent,'140');failed=false;
 data={...data,run_id:'restart',sequence:0,count:139,entries:sources.slice(0,6)};await tick(1000);
 assert.equal(el('hud-training-count').textContent,'139');assert.deepEqual(el('hud-source-track').children.map(r=>r.dataset.sourceId),firstIds);
 data={...data,sequence:10,count:149,entries:[...sources.slice(0,5),fresh]};await tick(1000);
 assert.equal(el('hud-training-count').textContent,'149');assert.equal(el('hud-source-track').children.length,6);
 const html=fs.readFileSync('index.html','utf8');assert.ok(html.includes('Collecting Discarded Data'));
 assert.ok(!html.includes('<script src="environment-monitor.js'));
 console.log('PASS: no simulated increments, six rows, real-record animation, offline pause, restart reset and missed-update resync.');
})().catch(e=>{console.error(e);process.exitCode=1;});
