// A late upload from the previous language must not reach the face/model queue.
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const elements=new Map(),stored=new Map([['afterimage.language.fixed.v1','auto']]);
const make=()=>({value:'',textContent:'',handlers:{},files:[],classList:{toggle(){}},
 addEventListener(name,fn){this.handlers[name]=fn;},replaceChildren(){},append(){}});
const el=id=>{if(!elements.has(id))elements.set(id,make());return elements.get(id);};
let uploads=[],observed=[],stops=0,serial=0,holdDecode=false,releaseDecode;
class AudioContext {
 async decodeAudioData(){if(holdDecode)await new Promise(resolve=>{releaseDecode=resolve;});return {duration:.5,length:8000,numberOfChannels:1,sampleRate:16000,getChannelData:()=>new Float32Array(8000)};}
 async close(){}
}
const context=vm.createContext({document:{getElementById:el,createElement:make},navigator:{},
 localStorage:{getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)},
 window:{addEventListener(){},afterimageAgent:{stop(){stops++;},observe:event=>observed.push(event)}},
 AudioContext,AbortController,URLSearchParams,Date,crypto:{randomUUID:()=>String(++serial)},setTimeout(){},
 fetch:(url,options)=>new Promise(resolve=>{if(url.startsWith('/api/audio?'))uploads.push({url,options,resolve});})});
vm.runInContext(fs.readFileSync(__dirname+'/listening.js','utf8'),context);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function upload(){el('audio-file').files=[{size:16000,arrayBuffer:async()=>new ArrayBuffer(16000)}];await el('audio-file').handlers.change();}
function resolveUpload(index){uploads[index].resolve({ok:true,json:async()=>({id:String(index),kind:'audio',created_at:new Date().toISOString(),features:{duration:.5,rms_dbfs:-20}})});}
(async()=>{
 assert.equal(el('speech-language').value,'en','old automatic preference migrates to English');
 await upload();assert.match(uploads[0].url,/language=en/);
 el('speech-language').value='zh';el('speech-language').handlers.change();
 assert.equal(stops,1);assert.equal(uploads[0].options.signal.aborted,true);
 resolveUpload(0);await flush();assert.equal(observed.length,0,'late old-language upload must be discarded');
 await upload();assert.match(uploads[1].url,/language=zh/);
 assert.notEqual(new URLSearchParams(uploads[0].url.split('?')[1]).get('session'),new URLSearchParams(uploads[1].url.split('?')[1]).get('session'));
 resolveUpload(1);await flush();assert.equal(observed.length,1);
 assert.equal(stored.get('afterimage.language.fixed.v1'),'zh');
 holdDecode=true;const delayed=upload();await flush();
 el('speech-language').value='en';el('speech-language').handlers.change();releaseDecode();await delayed;
 assert.equal(uploads.length,2,'an old-language file still decoding must also be discarded');
 console.log('PASS: fixed English default, persisted choice, language switch abort, late-upload rejection, new Chinese capture.');
})().catch(error=>{console.error(error);process.exitCode=1;});
