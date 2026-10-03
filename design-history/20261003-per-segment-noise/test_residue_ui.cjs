const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{textContent:'',disabled:false,handlers:{},addEventListener(k,f){this.handlers[k]=f;}});return elements.get(id);};
let tick,busy=false,spoken=[],requests=[];
const ctx=vm.createContext({document:{getElementById:el},AbortController,setInterval(f){tick=f;},window:{addEventListener(){},afterimageMotion:{isBusy:()=>busy,cancelEcho(){busy=false;},async echo(t){spoken.push(t);busy=true;return true;}}},fetch(url,options){return new Promise(resolve=>requests.push({url,data:JSON.parse(options.body),resolve}));}});
vm.runInContext(fs.readFileSync(__dirname+'/residue.js','utf8'),ctx);
const ctl=ctx.window.afterimageResidue,flush=()=>new Promise(r=>setImmediate(r));
function reply(r,value){r.resolve({ok:true,json:async()=>value});}
(async()=>{
 const start=ctl.start();reply(requests[0],{session:'first'});await start;await flush();
 const first=requests.find(r=>r.url.endsWith('/next'));reply(first,{text:'First phrase.',sampling:{temperature:1.1,top_p:.97}});await flush();tick();await flush();
 assert.deepEqual(spoken,['First phrase.']);assert.equal(ctl.sampling().temperature,1.1);assert.equal(requests.filter(r=>r.url.endsWith('/next')).length,2);
 const next=requests.filter(r=>r.url.endsWith('/next'))[1];reply(next,{text:'Second phrase.',sampling:{temperature:.8,top_p:.89}});await flush();tick();await flush();
 assert.equal(spoken.length,1);assert.equal(ctl.sampling().temperature,1.1,'prefetch must not change displayed parameters');assert.equal(requests.filter(r=>r.url.endsWith('/next')).length,2,'one-chunk prefetch only');
 busy=false;tick();await flush();assert.deepEqual(spoken,['First phrase.','Second phrase.']);assert.equal(ctl.sampling().temperature,.8);
 const late=requests.filter(r=>r.url.endsWith('/next'))[2];ctl.stop();reply(late,{text:'Stale phrase.'});await flush();tick();await flush();assert.equal(spoken.length,2);assert.equal(busy,false);
 const newStart=ctl.start();const starting=requests.at(-1);ctl.stop();reply(starting,{session:'cancelled-start'});await newStart;assert.equal(ctl.status().active,false);assert.ok(requests.some(r=>r.url.endsWith('/stop')&&r.data.session==='cancelled-start'));
 console.log('PASS: one-item prefetch, sequential playback, stop cancels face, stale response rejection, cancelled-start cleanup.');
})().catch(e=>{console.error(e);process.exitCode=1;});
