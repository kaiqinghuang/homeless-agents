// Verify rotated mouth guides, clipping and the real draw path for every face.
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const elements=new Map(),calls=[];
let current={},textureUnit=10;
const gl={SCISSOR_TEST:1,TRIANGLES:4,disable(){},enable(){},
 TEXTURE0:10,TEXTURE1:11,TEXTURE2:13,TEXTURE_2D:12,activeTexture(unit){textureUnit=unit;},bindTexture(_target,texture){if(textureUnit===11)current.texture=texture;if(textureUnit===13)current.mask=texture;},
 uniform3fv(){},uniform1f(k,v){current[k]=v;},uniform2f(){},uniform4fv(k,v){current[k]=v;},uniform2fv(){},
 scissor(...v){current.scissor=v;},drawArrays(){calls.push({...current});}};
const el=id=>{if(!elements.has(id))elements.set(id,{value:50,style:{},dataset:{},children:[],
 addEventListener(){},setAttribute(){},append(x){this.children.push(x);},getContext:()=>gl});return elements.get(id);};
el('portrait').width=4608;el('portrait').height=2592;el('portrait').clientWidth=1184;el('portrait').clientHeight=666;
const ctx=vm.createContext({document:{getElementById:el,createElement:()=>el(Math.random()),querySelectorAll:()=>[]},
 performance:{now:()=>0},Image:class{},window:{},requestAnimationFrame(){}});
const run=s=>vm.runInContext(s,ctx);
run(fs.readFileSync(__dirname+'/app.js','utf8'));
const faces=run('faces');assert.equal(faces.length,21);
run("uniforms=Object.fromEntries(['spriteRect','spriteVisible','mouth','amount','crop','activeFace','showGuides','geometry','dynamics','axis','faceBounds','softness','guideRadius','guidePoints[0]'].map(x=>[x,x]));for(const [id,c] of Object.entries(spriteFaces)){Object.assign(c.textures,Object.fromEntries(Object.keys(centralPoseFiles).map(k=>[k,id+':'+k])));c.mask=id+':mask';}state.guides=true;draw();");
assert.equal(calls.length,22);assert.equal(calls[0].activeFace,0);
// The image pass must include the forehead and ears, not retain mouth-only clipping.
const [cx,cy,cw,ch]=calls[1].scissor;
assert.ok(cx<=1970&&cx+cw>=2698);
assert.ok(2592-cy-ch<=814&&2592-cy>=1684);

let area=0;
for(const [i,call] of calls.slice(1).entries()){
 assert.equal(call.activeFace,['central','red-eyes','lower-right'].includes(faces[i].id)?2:1);const [x,y,w,h]=call.scissor;
 assert.ok(x>=0&&y>=0&&w>0&&h>0&&x+w<=4608&&y+h<=2592);area+=w*h;
}
assert.ok(area/(4608*2592)<.2,'mouth passes should touch only a small part of the native-resolution image');
for(let i=0;i<faces.length;i++){
 const g=faces[i];if(['central','red-eyes','lower-right'].includes(g.id))continue;run('state.current=[0,1,0]');const rest=Array.from(run(`updateGuides(faces[${i}])`));
 run('state.current=[1,1,0]');const open=Array.from(run(`updateGuides(faces[${i}])`));
 assert.equal(open.length,42);assert.ok(open.every(Number.isFinite));
 // At index 4 / 7, the upper / lower lip centers move along the local normal.
 const along=(index)=>(open[index*2]-rest[index*2])*-Math.sin(g.angle)+(open[index*2+1]-rest[index*2+1])*Math.cos(g.angle);
 assert.ok(along(4)<0&&along(7)>0,g.id+' must move both lips along its own face angle');
 assert.ok(Math.abs((along(7)-along(4))-g.opening*.30)<1e-4);
 const full=run(`faceScissor(faces[${i}],[0,0,1,1],4608,2592)`);assert.ok(full);
 const hidden=run(`faceScissor(faces[${i}],[2,2,.1,.1],4608,2592)`);assert.equal(hidden,null);
}
// Each image cue binds exactly its own still with no crossfade, including
// rest/stop. The other-face amplitude slider must not distort these stills.
for(const pose of ['A','B','C','D','E','F','G','H','X']){
 calls.length=0;run(`state.pose='${pose}';state.current=[.123,1,0];draw()`);
 assert.equal(calls[1].texture,'central:'+pose);assert.equal(calls[1].spriteVisible,pose==='X'?0:1);
 assert.equal(calls[7].texture,'red-eyes:'+pose);assert.equal(calls[7].spriteVisible,pose==='X'?0:1);
 assert.equal(calls[9].texture,'lower-right:'+pose);assert.equal(calls[9].spriteVisible,pose==='X'?0:1);
 assert.equal(calls[9].mask,'lower-right:mask');
 assert.deepEqual(Array.from(calls[9].spriteRect),[2560/4608,1408/2592,1024/4608,1024/2592]);
 assert.equal(calls[1].mask,'central:mask');assert.equal(calls[7].mask,'red-eyes:mask');
 assert.deepEqual(Array.from(calls[7].spriteRect),[2688/4608,256/2592,1024/4608,1024/2592]);
 for(const id of ['central','red-eyes','lower-right']){
  const anchors=Array.from(run(`imagePoseGuides(spriteFaces['${id}'].face,'${pose}')`));assert.equal(anchors.length,42);assert.ok(anchors.every(Number.isFinite));
 }

 el('amount').value=0;calls.length=0;run('draw()');assert.equal(calls[1].texture,'central:'+pose);el('amount').value=50;
}
console.log(`PASS: 21 face passes, rotated lip/guide motion, native-resolution clipping; local passes cover ${(area/(4608*2592)*100).toFixed(1)}% of image.`);
