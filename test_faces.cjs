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
const ctx=vm.createContext({document:{getElementById:el,querySelector:el,createElement:()=>el(Math.random()),querySelectorAll:()=>[]},
 performance:{now:()=>0},Image:class{},window:{},requestAnimationFrame(){}});
const run=s=>vm.runInContext(s,ctx);
run('Math.random=()=>.1');
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
 assert.equal(call.activeFace,['central','red-eyes','lower-right','small-left'].includes(faces[i].id)?2:1);const [x,y,w,h]=call.scissor;
 assert.ok(x>=0&&y>=0&&w>0&&h>0&&x+w<=4608&&y+h<=2592);area+=w*h;
}
assert.ok(area/(4608*2592)<.2,'mouth passes should touch only a small part of the native-resolution image');
for(let i=0;i<faces.length;i++){
 const g=faces[i];if(['central','red-eyes','lower-right','small-left'].includes(g.id))continue;run('state.current=[0,1,0]');const rest=Array.from(run(`updateGuides(faces[${i}])`));
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
 assert.equal(calls[4].texture,'small-left:'+pose);assert.equal(calls[4].spriteVisible,pose==='X'?0:1);
 assert.equal(calls[4].mask,'small-left:mask');
 assert.deepEqual(Array.from(calls[4].spriteRect),[1408/4608,1248/2592,512/4608,512/2592]);
 const fourthGuides=Array.from(run(`imagePoseGuides(spriteFaces['small-left'].face,'${pose}')`));
 const fourthLips=Array.from(run(`smallLeftLipAnchors['${pose}']`));
 assert.ok(Math.abs(fourthGuides[2]-(1408+fourthLips[0]*.5)*1184/4608)<1e-4);
 assert.ok(Math.abs(fourthGuides[3]-(1248+fourthLips[1]*.5)*666/2592)<1e-4);
 const fourthScissor=calls[4].scissor;assert.ok(fourthScissor[2]<210&&fourthScissor[3]<340,'small face must use native half-scale clipping');
 assert.equal(calls[9].mask,'lower-right:mask');
 assert.deepEqual(Array.from(calls[9].spriteRect),[2560/4608,1408/2592,1024/4608,1024/2592]);
 assert.equal(calls[1].mask,'central:mask');assert.equal(calls[7].mask,'red-eyes:mask');
 assert.deepEqual(Array.from(calls[7].spriteRect),[2688/4608,256/2592,1024/4608,1024/2592]);
 for(const id of ['central','red-eyes','lower-right','small-left']){
  const anchors=Array.from(run(`imagePoseGuides(spriteFaces['${id}'].face,'${pose}')`));assert.equal(anchors.length,42);assert.ok(anchors.every(Number.isFinite));
 }

 el('amount').value=0;calls.length=0;run('draw()');assert.equal(calls[1].texture,'central:'+pose);el('amount').value=50;
}
console.log(`PASS: 21 face passes, rotated lip/guide motion, native-resolution clipping; local passes cover ${(area/(4608*2592)*100).toFixed(1)}% of image.`);

// Two weighted sets (70% current, 30% original) for red eyes; candidate count must not bias set odds.
assert.equal(run('redEyesFirstVariants.B.length'),2);
assert.equal(run('Object.values(redEyesFirstVariants).flat().length'),12);
for(const pose of ['A','B','C','D','E','F','G','H']){
 const count=run(`redEyesFirstVariants['${pose}'].length`);
 for(const setRoll of [.0,.5,.699999,.7,.99])for(let index=0;index<count;index++){
  run(`state.poseRevision++;state.pose='${pose}';randomCalls=0;Math.random=()=>++randomCalls===1?${setRoll}:${(index+.5)/count};`);
  const selected=run(`spritePose(spriteFaces['red-eyes'],'${pose}')`);
  const expected=setRoll<.7?pose:run(`redEyesFirstVariants['${pose}'][${index}].key`);
  assert.equal(selected.key,expected);
  const sampled=run('randomCalls');
  run(`for(let i=0;i<60;i++)spritePose(spriteFaces['red-eyes'],'${pose}')`);
  assert.equal(run('randomCalls'),sampled,'no random resampling during held cue');
  const guides=Array.from(run(`imagePoseGuides(spriteFaces['red-eyes'].face,'${pose}')`));
  assert.ok(Math.abs(guides[2]-(2688+selected.anchors[0])*1184/4608)<1e-4);
  assert.ok(Math.abs(guides[3]-(256+selected.anchors[1])*666/2592)<1e-4);
 }
}
run("for(const v of Object.values(redEyesFirstVariants).flat())spriteFaces['red-eyes'].textures[v.key]='red-eyes:'+v.key;state.pose='C';state.poseRevision++;Math.random=()=>.99");
calls.length=0;run('draw()');assert.equal(calls[7].texture,'red-eyes:first:10-parted-expression');
run('state.poseRevision++;Math.random=()=>.1');calls.length=0;run('draw()');assert.equal(calls[7].texture,'red-eyes:C','same shape in next cue may choose other set');
run("state.pose='X';Math.random=()=>{throw new Error('rest must not sample')} ");calls.length=0;run('draw()');assert.equal(calls[7].spriteVisible,0);
run("state.pose='C';state.poseRevision++;Math.random=()=>.99;spritePose(spriteFaces['red-eyes'],'C');resetPlayback()");
assert.equal(run('state.pose'),'X');
console.log('PASS: 70/30 probability branches, all 12 collection candidates, stable held cues, repeat-cue reselection, matching guides and rest.');
