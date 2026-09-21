'use strict';
const $ = id => document.getElementById(id);
// Slider position is 0–100, with the preferred starting value exactly at 50.
const sliderRanges = {
 speed: {min:.15, center:.17, max:1.05},
 amount: {min:0, center:.30, max:.90}
};
function sliderValue(id){
 const range=sliderRanges[id], position=Number($(id).value)/100;
 return position<=.5
  ? range.min+(range.center-range.min)*position*2
  : range.center+(range.max-range.center)*(position-.5)*2;
}
function updateSliderLabel(id){
 const label=sliderValue(id).toFixed(2)+'×';
 $(id+'-value').textContent=label;
 $(id).setAttribute('aria-valuetext',label);
}
const canvas = $('portrait');
const gl = canvas.getContext('webgl', {alpha:false, antialias:false, preserveDrawingBuffer:true});
const shapes = {X:[0,1,0], A:[.02,.94,0], B:[.23,1.02,.5], C:[.55,1.02,.2], D:[1,.96,.1], E:[.42,.90,.05], F:[.30,.94,0], G:[.15,1,.7], H:[.4,.98,.25]};
// Keep animation in the calibrated 1184×666 coordinate space while the
// canvas and texture retain the full native image resolution (currently 4K).
const calibrationSize = [1184, 666];
// Each visible mouth has its own geometry in the same reference image space.
// The cropped object at the very top has no visible face/mouth to animate.
function makeFace(id,x,y,halfWidth,angle=0,curve=halfWidth*.12){
 const g={id,x,y,halfWidth,angle,curve,opening:halfWidth*.60,
  falloffX:halfWidth*1.72,falloffY:halfWidth*1.28,decay:halfWidth*.60,
  softness:halfWidth/25.74,bounds:[-2.7*halfWidth,-2.7*halfWidth,2.7*halfWidth,2.2*halfWidth]};
 g.cheeks=[[-1.8,-1.8],[-1.3,-.9],[-1.9,-.35],[-1.6,.3],
           [1.8,-1.8],[1.3,-.9],[1.9,-.35],[1.6,.3]].map(([a,b])=>[a*halfWidth,b*halfWidth]);
 return g;
}
const centralFace=Object.assign(makeFace('central',602.08,390.85,25.74),{
 falloffX:44.27,falloffY:32.95,curve:3.19,opening:15.44,decay:15.44,
 bounds:[510-602.08,300-390.85,704-602.08,449-390.85],
 cheeks:[[547.50,340.41],[562.95,365.12],[543.39,376.45],[552.66,397.04],
         [648.40,340.40],[637.08,365.11],[656.64,375.40],[646.35,397.02]].map(([x,y])=>[x-602.08,y-390.85])
});
const faces=[centralFace,
 makeFace('upper-left',401.45,152.93,18.5,.045,3.6),
 makeFace('left-profile',286.75,324.98,17.0,.20,4.1),
 makeFace('small-left',431.05,407.92,11.6,-.01,2.7),
 makeFace('lower-left',164.65,575.66,10.0,.06,2.5),
 makeFace('lower-hood',531.57,521.70,10.2,-.06,4.3),
 makeFace('red-eyes',828.18,270.10,21.0,-.02,2.4),
 makeFace('right-large',1020.28,346.88,18.0,.24,1.1),
 makeFace('lower-right',787.90,533.42,14.0,.10,-.5),
 makeFace('tiny-right',867.34,556.54,6.0,-.04,.4),
 makeFace('upper-right',981.12,110.38,11.5,.055,1.6),
 makeFace('wrapped',1102.90,89.73,8.3,.10,.4)
];
const faceCrop = [.304, .29, .41, .41];
const GUIDE_COUNT=21;
const guidePoints=new Float32Array(GUIDE_COUNT*2);
function faceToImage(g,x,y){const c=Math.cos(g.angle),s=Math.sin(g.angle);return [g.x+c*x-s*y,g.y+s*x+c*y];}
function faceScissor(g,crop,width,height){
 const [l,t,r,b]=g.bounds,points=[[l,t],[r,t],[l,b],[r,b]].map(([x,y])=>faceToImage(g,x,y));
 const px=x=>(x/calibrationSize[0]-crop[0])/crop[2]*width;
 const py=y=>(y/calibrationSize[1]-crop[1])/crop[3]*height;
 const x0=Math.max(0,Math.floor(px(Math.min(...points.map(p=>p[0])))));
 const x1=Math.min(width,Math.ceil(px(Math.max(...points.map(p=>p[0])))));
 const y0=Math.max(0,Math.floor(py(Math.min(...points.map(p=>p[1])))));
 const y1=Math.min(height,Math.ceil(py(Math.max(...points.map(p=>p[1])))));
 return x1>x0&&y1>y0?[x0,height-y1,x1-x0,y1-y0]:null;
}
const labels = {X:'Rest',A:'M / B / P',B:'EE',C:'EH',D:'AH',E:'OH',F:'OO',G:'F / V',H:'L'};
let state = {ready:false, playing:false, plan:null, start:0, elapsed:0, hold:'X', current:[0,1,0], zoom:false, guides:false, request:0};
let program, uniforms, lastFrame=performance.now(), lastWord=-2, lastCue=-1;
const vertex = `attribute vec2 position; varying vec2 uv; void main(){uv=vec2((position.x+1.0)*0.5,(1.0-position.y)*0.5);gl_Position=vec4(position,0.0,1.0);}`;
const fragment = `precision highp float;
varying vec2 uv; uniform sampler2D photo; uniform vec2 resolution; uniform vec3 mouth; uniform float amount; uniform vec4 crop;
uniform float activeFace; uniform vec4 geometry; uniform vec4 dynamics; uniform vec2 axis; uniform vec4 faceBounds; uniform float softness;
uniform float showGuides; uniform float guideRadius; uniform vec2 guidePoints[${GUIDE_COUNT}];
float maskAt(vec2 q){
 vec2 a=smoothstep(faceBounds.xy,faceBounds.xy+geometry.z*.4,q);
 vec2 b=1.0-smoothstep(faceBounds.zw-geometry.z*.4,faceBounds.zw,q);
 return a.x*a.y*b.x*b.y;
}
void main(){
 vec2 p=(crop.xy+uv*crop.zw)*resolution;
 if(activeFace<.5){gl_FragColor=vec4(texture2D(photo,p/resolution).rgb,1.0);return;}
 vec2 delta=p-geometry.xy;
 vec2 q=vec2(dot(delta,axis),dot(delta,vec2(-axis.y,axis.x)));
 // Scissored passes share a texture, with no warp outside this face's bounds.
 if(q.x<faceBounds.x||q.x>faceBounds.z||q.y<faceBounds.y||q.y>faceBounds.w)discard;
 float mask=maskAt(q);
 float local=exp(-pow(q.x/geometry.w,4.0)-pow(q.y/dynamics.x,4.0))*mask;
 float scale=1.0+(mouth.y-1.0)*local;
 float sx=q.x/scale;
 float nx=sx/geometry.z;
 float edge=pow(max(0.0,1.0-nx*nx),0.65);
 float seam=dynamics.y*nx*nx;
 float opening=mouth.x*amount*dynamics.z;
 float top=seam-opening*.36*edge;
 float bottom=seam+opening*.64*edge;
 float shift=(q.y<seam ? opening*.36 : -opening*.64)*edge;
 float outside=q.y<seam?max(0.0,top-q.y):max(0.0,q.y-bottom);
 float sy=q.y+shift*exp(-outside/dynamics.w)*mask;
 vec2 source=geometry.xy+vec2(axis.x*sx-axis.y*sy,axis.y*sx+axis.x*sy);
 vec3 col=texture2D(photo,source/resolution).rgb;
 float cavity=smoothstep(top-.35*softness,top+.75*softness,q.y)*(1.0-smoothstep(bottom-.65*softness,bottom+.35*softness,q.y));
 cavity*=smoothstep(0.0,.10,edge)*smoothstep(.0,1.4*softness,opening);
 float relative=clamp((q.y-top)/max(softness,bottom-top),0.0,1.0);
 vec3 inside=mix(vec3(.063,.060,.063),vec3(.13,.115,.12),relative);
 float teeth=(1.0-smoothstep(.18,.30,relative))*mouth.z*edge;
 inside=mix(inside,vec3(.39,.37,.33),teeth*.65);
 float tongue=smoothstep(.62,.9,relative)*max(0.0,1.0-nx*nx)*.35;
 inside=mix(inside,vec3(.24,.17,.17),tongue);
 col=mix(col,inside,cavity);
 if(showGuides>.5){
  float nearest=10000.0;
  for(int i=0;i<${GUIDE_COUNT};i++){nearest=min(nearest,length(p-guidePoints[i]));}
  float dotMask=1.0-smoothstep(guideRadius*.78,guideRadius,nearest);
  col=mix(col,vec3(0.0),dotMask);
 }
 gl_FragColor=vec4(col,1.0);
}`;
function compile(type, source){const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));return shader;}
function setup(image){
 if(!gl)throw new Error('This browser cannot render WebGL. Please use Safari or Chrome.');
 canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
 $('stage').style.aspectRatio=canvas.width+'/'+canvas.height;
 program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
 gl.useProgram(program);
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
 const attr=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);
 const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
 uniforms=Object.fromEntries(['resolution','mouth','amount','crop','showGuides','guideRadius','guidePoints[0]','activeFace','geometry','dynamics','axis','faceBounds','softness'].map(k=>[k,gl.getUniformLocation(program,k)]));
 gl.uniform2f(uniforms.resolution,...calibrationSize);gl.viewport(0,0,canvas.width,canvas.height);
 state.ready=true;$('play').disabled=false;$('status').textContent='Ready · 等待输入';
 document.querySelectorAll('[data-shape]').forEach(button=>button.disabled=false);
 requestAnimationFrame(frame);
}
// Forward-map the guide anchors through the same inverse warp as the shader.
function updateGuides(g){
 const opening=state.current[0]*sliderValue('amount')*g.opening;
 const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
 const mask=(x,y)=>{const [l,t,r,b]=g.bounds,f=g.halfWidth*.4;return smooth(l,l+f,x)*smooth(t,t+f,y)*(1-smooth(r-f,r,x))*(1-smooth(b-f,b,y));};
 const scaleAt=(x,y)=>1+(state.current[1]-1)*Math.exp(-Math.pow(x/g.falloffX,4)-Math.pow(y/g.falloffY,4))*mask(x,y);
 function followSkin([sourceX,sourceY]){
  const nx=sourceX/g.halfWidth,edge=Math.pow(Math.max(0,1-nx*nx),.65),seam=g.curve*nx*nx;
  const above=sourceY<seam,boundary=seam+opening*(above?-.36:.64)*edge;
  const shift=opening*(above?.36:-.64)*edge;
  let x=sourceX,y=sourceY;
  for(let i=0;i<24;i++){
   const outside=Math.max(0,above?boundary-y:y-boundary);
   y=sourceY-shift*Math.exp(-outside/g.decay)*mask(x,y);
   x=sourceX*scaleAt(x,y);
  }
  return faceToImage(g,x,y);
 }
 function contour(nx,side){
  const edge=Math.pow(Math.max(0,1-nx*nx),.65),y=g.curve*nx*nx+opening*side*edge;
  const sourceX=nx*g.halfWidth;let x=sourceX;
  for(let i=0;i<12;i++)x=sourceX*scaleAt(x,y);
  return faceToImage(g,x,y);
 }
 const points=[faceToImage(g,0,0),contour(-1,0),contour(1,0)];
 for(const side of [-.36,.64])for(const nx of [-.6,0,.6])points.push(contour(nx,side));
 points.push(...[[-g.falloffX,0],[g.falloffX,0],[0,-g.falloffY],[0,g.falloffY],...g.cheeks].map(followSkin));
 guidePoints.set(points.flat());return guidePoints;
}
function draw(){
 gl.uniform3fv(uniforms.mouth,state.current);gl.uniform1f(uniforms.amount,sliderValue('amount'));
 const crop=state.zoom?faceCrop:[0,0,1,1];gl.uniform4fv(uniforms.crop,crop);
 // One full-resolution background, then small scissored regions for each face.
 // We reuse 21 guide uniforms instead of requiring a large array for all faces.
 gl.disable(gl.SCISSOR_TEST);gl.uniform1f(uniforms.activeFace,0);gl.drawArrays(gl.TRIANGLES,0,6);
 gl.enable(gl.SCISSOR_TEST);gl.uniform1f(uniforms.activeFace,1);
 gl.uniform1f(uniforms.showGuides,state.guides?1:0);
 const displayedWidth=Math.max(1,Math.min(canvas.clientWidth,canvas.clientHeight*canvas.width/canvas.height));
 for(const g of faces){
  const rect=faceScissor(g,crop,canvas.width,canvas.height);if(!rect)continue;
  gl.scissor(...rect);
  gl.uniform4fv(uniforms.geometry,[g.x,g.y,g.halfWidth,g.falloffX]);
  gl.uniform4fv(uniforms.dynamics,[g.falloffY,g.curve,g.opening,g.decay]);
  gl.uniform2f(uniforms.axis,Math.cos(g.angle),Math.sin(g.angle));
  gl.uniform4fv(uniforms.faceBounds,g.bounds);gl.uniform1f(uniforms.softness,g.softness);
  if(state.guides){
   gl.uniform2fv(uniforms['guidePoints[0]'],updateGuides(g));
   gl.uniform1f(uniforms.guideRadius,crop[2]*calibrationSize[0]/displayedWidth*2.6*.75*Math.max(.3,Math.min(1,g.softness)));
  }
  gl.drawArrays(gl.TRIANGLES,0,6);
 }
 gl.disable(gl.SCISSOR_TEST);
}
function frame(now){
 const dt=Math.min(.05,(now-lastFrame)/1000);lastFrame=now;
 let target=shapes[state.hold];
 if(state.playing){
  state.elapsed=(now-state.start)/1000;
  const plan=state.plan;
  if(state.elapsed>=plan.duration){state.playing=false;state.hold='X';target=shapes.X;$('stop').disabled=true;$('play').textContent='Play again';$('status').textContent='Finished · 播放结束';setProgress(100);highlight(-1);}
  else{
   const index=plan.timeline.findIndex(c=>state.elapsed>=c.start&&state.elapsed<c.end);
   const cue=plan.timeline[index];
   if(cue){target=shapes[cue.shape];highlight(cue.word);if(index!==lastCue){$('status').textContent='Mouthing · '+labels[cue.shape];lastCue=index;}}
   setProgress(100*state.elapsed/plan.duration);
  }
 }
 const blend=1-Math.exp(-dt*23);
 state.current=state.current.map((value,i)=>value+(target[i]-value)*blend);
 draw();requestAnimationFrame(frame);
}
function setProgress(value){$('progress').style.width=value+'%';document.querySelector('.track').setAttribute('aria-valuenow',Math.round(value));}
function highlight(index){if(index===lastWord)return;lastWord=index;[...$('readout').children].forEach((span,i)=>span.classList.toggle('current',i===index));}
function resetPlayback(){state.playing=false;state.hold='X';state.elapsed=0;lastCue=-1;highlight(-1);setProgress(0);$('stop').disabled=true;$('play').textContent='Play sentence';document.querySelectorAll('[data-shape]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.shape==='X')));}
function stop(){state.request++;resetPlayback();$('play').disabled=!state.ready;$('status').textContent='Ready · 等待输入';}
async function play(){
 const pace=sliderValue('speed');
 const request=++state.request;resetPlayback();$('error').textContent='';$('play').disabled=true;$('status').textContent='Preparing movement…';$('stop').disabled=false;
 try{
  const response=await fetch('/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:$('text').value,speed:1})});
  const plan=await response.json();if(!response.ok)throw new Error(plan.error||'Could not prepare movement.');if(request!==state.request)return;
  if(plan.method!=='phonemes-v1')throw new Error('Restart Start.command to load the new phoneme engine. / 请重启 Start.command，启用新版音素口型。');
  // The server supplies the base timeline; pace is applied locally so slower
  // settings work without restarting an already-running server.
  for(const cue of plan.timeline){cue.start/=pace;cue.end/=pace;}
  plan.duration/=pace;
  state.plan=plan;$('readout').replaceChildren(...plan.words.map(word=>{const span=document.createElement('span');span.textContent=word.text;span.title=word.phonemes.join(' ');return span;}));lastWord=-2;
  $('pronunciation').replaceChildren(...plan.words.map(word=>{const row=document.createElement('div');row.textContent=word.text.trim()+'  / '+word.phonemes.join(' ')+' /';return row;}));
  $('meta').textContent='PHONEMES · '+plan.language+' · '+plan.duration.toFixed(1)+' SEC';state.start=performance.now();state.playing=true;$('play').textContent='Restart';$('stop').disabled=false;
 }catch(error){if(request!==state.request)return;$('error').textContent=error.message;$('status').textContent='Waiting for a sentence';$('stop').disabled=true;}
 finally{if(request===state.request)$('play').disabled=!state.ready;}
}
for(const [key,label] of Object.entries(labels)){const button=document.createElement('button');button.textContent=label;button.dataset.shape=key;button.disabled=true;button.setAttribute('aria-pressed',String(key==='X'));button.addEventListener('click',()=>{stop();state.hold=key;$('status').textContent='Hold · '+label;document.querySelectorAll('[data-shape]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));});$('shapes').append(button);}
$('play').addEventListener('click',play);$('stop').addEventListener('click',stop);
$('example-en').addEventListener('click',()=>{stop();$('text').value='I can still hear the room after it falls silent.';});
$('example-zh').addEventListener('click',()=>{stop();$('text').value='你还在这里吗？我听见了风，也听见了你。';});
$('speed').addEventListener('input',()=>{updateSliderLabel('speed');if(state.playing||$('play').disabled&&state.ready)stop();});
$('amount').addEventListener('input',()=>{updateSliderLabel('amount');});
updateSliderLabel('speed');updateSliderLabel('amount');
$('zoom').addEventListener('click',()=>{state.zoom=!state.zoom;$('zoom').setAttribute('aria-pressed',String(state.zoom));$('zoom').textContent=state.zoom?'Whole image':'Inspect face';});
$('guides').addEventListener('click',()=>{state.guides=!state.guides;$('guides').setAttribute('aria-pressed',String(state.guides));$('guide-note').hidden=!state.guides;});
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('stage').requestFullscreen();}catch(error){$('error').textContent='Full screen is unavailable here. Open this page in Safari or Chrome.';}});
$('text').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();if(state.ready)play();}});
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();state.ready=false;stop();$('error').textContent='Graphics context lost. Reload the page to restore the portrait.';});
const portrait=new Image();portrait.onload=()=>{try{setup(portrait);}catch(error){$('error').textContent=error.message;$('status').textContent='Could not render portrait';}};portrait.onerror=()=>{$('error').textContent='Portrait image could not be loaded.';};portrait.src='assets/portrait.png?v=central-face-4k-2';

// Both generated replies and the optional transcript echo use the same player.
let automaticRequest=null;
window.afterimageMotion = {
 isBusy(){return !state.ready||state.playing||$('play').disabled;},
 isAutomatic(){return automaticRequest===state.request&&(state.playing||$('play').disabled);},
 cancelEcho(){if(automaticRequest===state.request)stop();automaticRequest=null;},
 async echo(text){
  if(!state.ready||state.playing||$('play').disabled)return false;
  $('text').value=text.slice(0,1000);
  const pending=play();automaticRequest=state.request;
  await pending;
  return state.playing&&automaticRequest===state.request;
 }
};
