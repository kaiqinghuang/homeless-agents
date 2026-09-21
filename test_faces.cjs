// Verify rotated mouth guides, clipping and the real draw path for every face.
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const elements=new Map(),calls=[];
let current={};
const gl={SCISSOR_TEST:1,TRIANGLES:4,disable(){},enable(){},
 uniform3fv(){},uniform1f(k,v){current[k]=v;},uniform2f(){},uniform4fv(k,v){current[k]=v;},uniform2fv(){},
 scissor(...v){current.scissor=v;},drawArrays(){calls.push({...current});}};
const el=id=>{if(!elements.has(id))elements.set(id,{value:50,style:{},dataset:{},children:[],
 addEventListener(){},setAttribute(){},append(x){this.children.push(x);},getContext:()=>gl});return elements.get(id);};
el('portrait').width=3840;el('portrait').height=2160;el('portrait').clientWidth=1184;el('portrait').clientHeight=666;
const ctx=vm.createContext({document:{getElementById:el,createElement:()=>el(Math.random()),querySelectorAll:()=>[]},
 performance:{now:()=>0},Image:class{},window:{},requestAnimationFrame(){}});
const run=s=>vm.runInContext(s,ctx);
run(fs.readFileSync(__dirname+'/app.js','utf8'));
const faces=run('faces');assert.equal(faces.length,12);
run("uniforms=Object.fromEntries(['mouth','amount','crop','activeFace','showGuides','geometry','dynamics','axis','faceBounds','softness','guideRadius','guidePoints[0]'].map(x=>[x,x]));state.guides=true;draw();");
assert.equal(calls.length,13);assert.equal(calls[0].activeFace,0);
let area=0;
for(const call of calls.slice(1)){
 assert.equal(call.activeFace,1);const [x,y,w,h]=call.scissor;
 assert.ok(x>=0&&y>=0&&w>0&&h>0&&x+w<=3840&&y+h<=2160);area+=w*h;
}
assert.ok(area/(3840*2160)<.2,'mouth passes should touch only a small part of the 4K image');
for(let i=0;i<faces.length;i++){
 const g=faces[i];run('state.current=[0,1,0]');const rest=Array.from(run(`updateGuides(faces[${i}])`));
 run('state.current=[1,1,0]');const open=Array.from(run(`updateGuides(faces[${i}])`));
 assert.equal(open.length,42);assert.ok(open.every(Number.isFinite));
 // At index 4 / 7, the upper / lower lip centers move along the local normal.
 const along=(index)=>(open[index*2]-rest[index*2])*-Math.sin(g.angle)+(open[index*2+1]-rest[index*2+1])*Math.cos(g.angle);
 assert.ok(along(4)<0&&along(7)>0,g.id+' must move both lips along its own face angle');
 assert.ok(Math.abs((along(7)-along(4))-g.opening*.30)<1e-4);
 const full=run(`faceScissor(faces[${i}],[0,0,1,1],3840,2160)`);assert.ok(full);
 const hidden=run(`faceScissor(faces[${i}],[2,2,.1,.1],3840,2160)`);assert.equal(hidden,null);
}
console.log(`PASS: 12 face passes, rotated lip/guide motion, 4K clipping; local passes cover ${(area/(3840*2160)*100).toFixed(1)}% of image.`);
