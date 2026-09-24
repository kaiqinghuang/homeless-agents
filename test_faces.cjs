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
const crop=Array.from(calls[0].crop);
assert.ok(Math.abs(crop[0]*1184-10)<1e-9);
assert.ok(Math.abs((1-crop[0]-crop[2])*1184-4)<1e-9);
assert.equal(crop[2],crop[3],'uniform scaling must preserve face proportions');
assert.ok(Math.abs(crop[1]*2+crop[3]-1)<1e-9,'vertical crop stays centered');
const screenX=x=>(x/4608-crop[0])/crop[2]*4608;
const screenY=y=>(y/2592-crop[1])/crop[3]*2592;
assert.ok(cx<=screenX(1970)&&cx+cw>=screenX(2698));
assert.ok(2592-cy-ch<=screenY(814)&&2592-cy>=screenY(1684));
for(const call of calls)assert.deepEqual(Array.from(call.crop),crop,'all face and background passes share one frame');

let area=0;
for(const [i,call] of calls.slice(1).entries()){
 assert.equal(call.activeFace,['central','red-eyes','lower-right','small-left','lower-hood','clay-lower','left-profile'].includes(faces[i].id)?2:1);const [x,y,w,h]=call.scissor;
 assert.ok(x>=0&&y>=0&&w>0&&h>0&&x+w<=4608&&y+h<=2592);area+=w*h;
}
assert.ok(area/(4608*2592)<.2,'mouth passes should touch only a small part of the native-resolution image');
for(let i=0;i<faces.length;i++){
 const g=faces[i];if(['central','red-eyes','lower-right','small-left','lower-hood','clay-lower','left-profile'].includes(g.id))continue;run('state.current=[0,1,0]');const rest=Array.from(run(`updateGuides(faces[${i}])`));
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
 assert.equal(calls[3].activeFace,2,'seventh face must bypass the geometric mouth-opening shader');
 assert.equal(calls[3].texture,'left-profile:'+pose);assert.equal(calls[3].spriteVisible,pose==='X'?0:1);
 assert.equal(calls[3].mask,'left-profile:mask');
 assert.deepEqual(Array.from(calls[3].spriteRect),[640/4608,640/2592,1024/4608,1024/2592]);
 const seventhGuides=Array.from(run(`imagePoseGuides(spriteFaces['left-profile'].face,'${pose}')`));
 const seventhLips=Array.from(run(`leftProfileLipAnchors['${pose}']`));
 assert.ok(Math.abs(seventhGuides[2]-(640+seventhLips[0])*1184/4608)<1e-4);
 assert.ok(Math.abs(seventhGuides[3]-(640+seventhLips[1])*666/2592)<1e-4);
 assert.ok(calls[3].scissor[2]<320&&calls[3].scissor[3]<440,'seventh face must clip inside the hood');
 assert.equal(calls[6].texture,'lower-hood:'+pose);assert.equal(calls[6].spriteVisible,pose==='X'?0:1);
 assert.equal(calls[6].mask,'lower-hood:mask');
 assert.equal(calls[19].texture,'clay-lower:'+pose);assert.equal(calls[19].spriteVisible,pose==='X'?0:1);
 assert.equal(calls[19].mask,'clay-lower:mask');
 assert.deepEqual(Array.from(calls[19].spriteRect),[2240/4608,1920/2592,384/4608,384/2592]);
 const sixthGuides=Array.from(run(`imagePoseGuides(spriteFaces['clay-lower'].face,'${pose}')`));
 const sixthLips=Array.from(run(`clayLowerLipAnchors['${pose}']`));
 assert.ok(Math.abs(sixthGuides[2]-(2240+sixthLips[0]*.375)*1184/4608)<1e-4);
 assert.ok(Math.abs(sixthGuides[3]-(1920+sixthLips[1]*.375)*666/2592)<1e-4);
 assert.ok(calls[19].scissor[2]<150&&calls[19].scissor[3]<160,'sixth face must stay within its small native face bounds');
 assert.deepEqual(Array.from(calls[6].spriteRect),[1792/4608,1760/2592,512/4608,512/2592]);
 const fifthGuides=Array.from(run(`imagePoseGuides(spriteFaces['lower-hood'].face,'${pose}')`));
 const fifthLips=Array.from(run(`lowerHoodLipAnchors['${pose}']`));
 assert.ok(Math.abs(fifthGuides[2]-(1792+fifthLips[0]*.5)*1184/4608)<1e-4);
 assert.ok(Math.abs(fifthGuides[3]-(1760+fifthLips[1]*.5)*666/2592)<1e-4);
 assert.ok(calls[6].scissor[2]<180&&calls[6].scissor[3]<275,'fifth face must stay within its native face bounds');
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
 for(const id of ['central','red-eyes','lower-right','small-left','lower-hood','clay-lower','left-profile']){
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

// Fifth face: corresponding pairs are 50/50; the three F/V images have equal shares.
run("for(const v of Object.values(lowerHoodVariants).flat())spriteFaces['lower-hood'].textures[v.key]='lower-hood:'+v.key;");
const fifthCases=[
 ['B',.499999,0,'B'],['B',.5,0,'extra:09-wide-initial'],
 ['D',.499999,0,'D'],['D',.5,0,'extra:10-open-initial'],
 ['E',.499999,0,'E'],['E',.5,0,'extra:11-oh-initial'],
 ['G',1/3-1e-8,0,'G'],['G',1/3,0,'extra:12-fold-initial'],
 ['G',.99,.499999,'extra:12-fold-initial'],['G',.99,.5,'extra:13-fold-intermediate']
];
for(const [pose,setRoll,variantRoll,key] of fifthCases){
 run(`state.pose='${pose}';state.poseRevision++;randomCalls=0;Math.random=()=>++randomCalls===1?${setRoll}:${variantRoll};`);
 const selected=run(`spritePose(spriteFaces['lower-hood'],'${pose}')`);assert.equal(selected.key,key);
 const sampled=run('randomCalls');
 run(`for(let i=0;i<60;i++)spritePose(spriteFaces['lower-hood'],'${pose}')`);
 assert.equal(run('randomCalls'),sampled,'fifth-face cue must hold its selection');
 const guides=Array.from(run(`imagePoseGuides(spriteFaces['lower-hood'].face,'${pose}')`));
 assert.ok(Math.abs(guides[2]-(1792+selected.anchors[0]*.5)*1184/4608)<1e-4);
 assert.ok(Math.abs(guides[3]-(1760+selected.anchors[1]*.5)*666/2592)<1e-4);
 calls.length=0;run('draw()');assert.equal(calls[6].texture,'lower-hood:'+key);
}
run("state.poseRevision++;Math.random=()=>.1");
assert.equal(run("spritePose(spriteFaces['lower-hood'],'G').key"),'G','new same-shape cue can pick another still');
run("Math.random=()=>{throw new Error('single candidates and rest must not sample')}");
for(const pose of ['A','C','F','H','X'])assert.equal(run(`spritePose(spriteFaces['lower-hood'],'${pose}').key`),pose);
run('resetPlayback()');calls.length=0;run('draw()');assert.equal(calls[6].spriteVisible,0);
assert.equal(run('Object.values(lowerHoodVariants).flat().length'),5);
console.log('PASS: fifth-face 50/50 pairs, equal-third F/V branches, all five extra stills, held cues, guides and stop.');

// Inspect mode retains its calibrated close-up; returning restores the common frame.
run('state.zoom=true');calls.length=0;run('draw()');
for(const call of calls)assert.deepEqual(Array.from(call.crop),Array.from(run('faceCrop')));
run('state.zoom=false');calls.length=0;run('draw()');
for(const call of calls)assert.deepEqual(Array.from(call.crop),crop);
console.log('PASS: whole-composite framing, 10px/4px crop, uniform scale and inspect round-trip.');

// Seventh face: 70% first set, 30% second set for each corresponding speaking pose.
run("for(const v of Object.values(leftProfileSecondVariants).flat())spriteFaces['left-profile'].textures[v.key]='left-profile:'+v.key;");
assert.equal(run('Object.values(leftProfileSecondVariants).flat().length'),8);
for(const pose of ['A','B','C','D','E','F','G','H']){
 assert.equal(run(`leftProfileSecondVariants['${pose}'].length`),1);
 for(const roll of [0,.5,.699999,.7,.999999]){
  run(`state.pose='${pose}';state.poseRevision++;randomCalls=0;Math.random=()=>{randomCalls++;return ${roll}};`);
  const selected=run(`spritePose(spriteFaces['left-profile'],'${pose}')`);
  const expected=roll<.7?pose:run(`leftProfileSecondVariants['${pose}'][0].key`);
  assert.equal(selected.key,expected);
  const samples=run('randomCalls');
  run(`for(let i=0;i<60;i++)spritePose(spriteFaces['left-profile'],'${pose}')`);
  assert.equal(run('randomCalls'),samples,'hold seventh-face choice for the entire cue');
  const guides=Array.from(run(`imagePoseGuides(spriteFaces['left-profile'].face,'${pose}')`));
  assert.ok(Math.abs(guides[2]-(640+selected.anchors[0])*1184/4608)<1e-4);
  assert.ok(Math.abs(guides[3]-(640+selected.anchors[1])*666/2592)<1e-4);
  calls.length=0;run('draw()');
  assert.equal(calls[3].texture,'left-profile:'+expected);
  assert.equal(calls[3].mask,'left-profile:mask');
  assert.equal(calls[3].activeFace,2);
  assert.deepEqual(Array.from(calls[3].crop),crop);
 }
}
run("state.pose='H';state.poseRevision++;Math.random=()=>.1");
assert.equal(run("spritePose(spriteFaces['left-profile'],'H').key"),'H','repeated cue can select the other set');
run("state.pose='X';state.poseRevision++;Math.random=()=>{throw new Error('rest must not sample')}");
assert.equal(run("spritePose(spriteFaces['left-profile'],'X').key"),'X');
calls.length=0;run('draw()');assert.equal(calls[3].spriteVisible,0);
console.log('PASS: seventh-face 70/30 branches for all eight poses, stable cues, repeat-cue reselection, matching guides, shared framing and original rest.');
