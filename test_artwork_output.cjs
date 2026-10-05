const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
function element(){return {textContent:'',children:[],style:{},dataset:{},parentElement:{},classList:{values:new Set(),add(v){this.values.add(v);}},replaceChildren(...children){this.children=children;},appendChild(c){this.children.push(c);}};}
const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
const ctx=vm.createContext({document:{getElementById:el,createElement:element},window:{addEventListener(){}},fetch:async()=>({ok:true,json:async()=>({run_id:'a',count:139,sequence:0,entries:[]})}),setTimeout(){},clearTimeout(){}});
vm.runInContext(fs.readFileSync('artwork-overlay.js','utf8'),ctx);
const output=ctx.window.afterimageOutput,words=[{text:'Please '},{text:'wait '},{text:'404.'}];output.render(words);
const spans=el('word-subtitle').children.slice(1),lit=()=>spans.map(s=>s.classList.values.has('spoken'));
assert.deepEqual(lit(),[false,false,false]);output.advance(0);assert.deepEqual(lit(),[true,false,false]);output.advance(-1);assert.deepEqual(lit(),[true,false,false]);
output.render(words);assert.equal(el('word-subtitle').children[1],spans[0],'frame updates must not recreate words');output.advance(2);assert.deepEqual(lit(),[true,true,true]);
output.render([{text:'Next.'}]);assert.equal(el('word-subtitle').children[1].classList.values.size,0);output.finish();assert.ok(el('word-subtitle').children[1].classList.values.has('spoken'));output.clear();assert.equal(el('word-subtitle').textContent,'Homeless Agent Output:');
console.log('PASS: full text appears before playback; highlighting persists through pauses, advances monotonically and resets on a new page.');
// Exercise multi-chunk page assembly and retained overflow independently of font layout.
(async()=>{
 const els=new Map(),get=id=>{if(!els.has(id))els.set(id,{disabled:false,textContent:'',addEventListener(){}});return els.get(id);};let busy=false,tick;const requests=[],played=[];
 const context=vm.createContext({document:{getElementById:get},AbortController,setInterval(f){tick=f;},window:{addEventListener(){},afterimageOutput:{ready:async()=>{},page(text){const words=text.split(' ');return {text:words.slice(0,6).join(' '),remaining:words.slice(6).join(' '),ready:words.length>=6};},sampling(){}},afterimageMotion:{isBusy:()=>busy,cancelEcho(){busy=false;},async echo(text){played.push(text);busy=true;return true;}}},fetch(url,options){return new Promise(resolve=>requests.push({url,resolve,busy}));}});
 vm.runInContext(fs.readFileSync('residue.js','utf8'),context);const ctl=context.window.afterimageResidue,flush=()=>new Promise(r=>setImmediate(r)),reply=(r,data)=>r.resolve({ok:true,json:async()=>data});
 const start=ctl.start();await flush();reply(requests[0],{session:'test'});await start;await flush();reply(requests[1],{text:'one two three four'});await flush();assert.equal(played.length,0);reply(requests[2],{text:'five six seven eight'});await flush();tick();await flush();assert.deepEqual(played,['one two three four five six']);assert.equal(requests[3].busy,true);
 reply(requests[3],{text:'nine ten eleven twelve thirteen fourteen'});await flush();tick();await flush();assert.equal(played.length,1);busy=false;tick();await flush();assert.equal(played[1],'seven eight nine ten eleven twelve','overflow words must carry into the next page without loss');ctl.stop();reply(requests.at(-2),{text:'late'});
 console.log('PASS: multi-chunk page fill, overflow carry, next-page prefetch during playback, sequential page playback.');
})().catch(e=>{console.error(e);process.exitCode=1;});
