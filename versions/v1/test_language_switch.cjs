// English-only capture, contiguous ambient windows, and cancellation of stale uploads.
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const elements=new Map(),stored=new Map([['afterimage.language.fixed.v1','zh']]);
const make=()=>({value:'',textContent:'',handlers:{},files:[],classList:{toggle(){}},options:[],
 addEventListener(name,fn){this.handlers[name]=fn},replaceChildren(){this.options=[]},append(){},add(v){this.options.push(v)}});
const el=id=>{if(!elements.has(id))elements.set(id,make());return elements.get(id)};
let uploads=[],observed=[],stops=0,serial=0,holdDecode=false,releaseDecode,node;
class AudioContext {
 constructor(){this.sampleRate=16000;this.state='running';this.audioWorklet={addModule:async()=>{}}}
 async resume(){}
 createMediaStreamSource(){return {connect(){}}}
 createAnalyser(){return {frequencyBinCount:2,fftSize:2048,getFloatFrequencyData(a){a.fill(-70)}}}
 async decodeAudioData(){if(holdDecode)await new Promise(resolve=>{releaseDecode=resolve});return {duration:.5,length:8000,numberOfChannels:1,sampleRate:16000,getChannelData:()=>new Float32Array(8000)}}
 async close(){this.state='closed'}
}
const track={label:'MacBook Microphone',stop(){},addEventListener(){}};
const context=vm.createContext({document:{getElementById:el,createElement:make},
 navigator:{mediaDevices:{enumerateDevices:async()=>[{kind:'audioinput',deviceId:'mac',label:'MacBook Microphone'}],getUserMedia:async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]}),addEventListener(){}}},
 Option:function(label,value){this.label=label;this.value=value},
 AudioWorkletNode:class {constructor(){node=this;this.port={}}connect(){}disconnect(){}},
 localStorage:{getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)},
 window:{addEventListener(){},afterimageAgent:{stop(){stops++},observe:event=>observed.push(event)}},
 AudioContext,AbortController,URLSearchParams,Date,crypto:{randomUUID:()=>String(++serial)},setTimeout(){},
 fetch:(url,options)=>new Promise(resolve=>{if(url.startsWith('/api/audio?'))uploads.push({url,options,resolve});else if(url==='/api/room')resolve({ok:true})})});
vm.runInContext(fs.readFileSync(__dirname+'/listening.js','utf8'),context);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function upload(){el('audio-file').files=[{size:16000,arrayBuffer:async()=>new ArrayBuffer(16000)}];await el('audio-file').handlers.change()}
function resolveUpload(index){uploads[index].resolve({ok:true,json:async()=>({id:String(index),kind:'audio',created_at:new Date().toISOString(),features:{duration:.5,rms_dbfs:-20}})})}
(async()=>{
 assert.equal(el('speech-language').value,'en','saved Chinese preference cannot change environment mode');
 await upload();assert.match(uploads[0].url,/language=en/);
 await el('listen-stop').handlers.click();resolveUpload(0);await flush();assert.equal(observed.length,0,'cancelled upload cannot reach faces');
 holdDecode=true;const delayed=upload();await flush();await el('listen-stop').handlers.click();releaseDecode();await delayed;assert.equal(uploads.length,1);
 await el('listen-start').handlers.click();assert.ok(node.port.onmessage);
 // Even a quiet constant input is captured every 8 seconds, without voice triggers.
 for(let i=0;i<16;i++)node.port.onmessage({data:new Float32Array(8000).fill(.001)});
 assert.equal(uploads.length,2);assert.match(uploads[1].url,/source=ambient/);
 assert.equal(new DataView(uploads[1].options.body).getUint32(40,true),256000);
 resolveUpload(1);await flush();
 for(let i=0;i<16;i++)node.port.onmessage({data:new Float32Array(8000).fill(.002)});
 assert.equal(uploads.length,3);assert.equal(new DataView(uploads[2].options.body).getUint32(40,true),256000);
 await el('listen-stop').handlers.click();resolveUpload(2);await flush();
 console.log('PASS: English-only capture, consecutive ambient windows without VAD, cancelled uploads and pending decode.');
})().catch(e=>{console.error(e);process.exitCode=1});
