'use strict';
const $ = id => document.getElementById(id);
const canvas = $('portrait');
const gl = canvas.getContext('webgl', {alpha:false, antialias:false, preserveDrawingBuffer:true});
const shapes = {X:[0,1,0], A:[.02,.94,0], B:[.23,1.02,.5], C:[.55,1.02,.2], D:[1,.96,.1], E:[.42,.90,.05], F:[.30,.86,0], G:[.15,1,.7], H:[.4,.98,.25]};
// Shared calibration: these are hand-set image coordinates, not detected landmarks.
const mouthGeometry = {x:548, y:365, halfWidth:25, falloffX:43, falloffY:32, curve:3.1, opening:15};
// Decorative cheek anchors in the original image; they follow the skin warp without driving it.
const cheekGuidePoints = [
 [495,316],[510,340],[491,351],[500,371],
 [593,316],[582,340],[601,350],[591,371]
];
const GUIDE_COUNT = 13 + cheekGuidePoints.length;
const guidePoints = new Float32Array(GUIDE_COUNT * 2);
const labels = {X:'Rest',A:'M / B / P',B:'EE',C:'EH',D:'AH',E:'OH',F:'OO',G:'F / V',H:'L'};
let state = {ready:false, playing:false, plan:null, start:0, elapsed:0, hold:'X', current:[0,1,0], zoom:false, guides:false, request:0};
let program, uniforms, lastFrame=performance.now(), lastWord=-2, lastCue=-1;
const vertex = `attribute vec2 position; varying vec2 uv; void main(){uv=vec2((position.x+1.0)*0.5,(1.0-position.y)*0.5);gl_Position=vec4(position,0.0,1.0);}`;
const fragment = `precision highp float;
varying vec2 uv; uniform sampler2D photo; uniform vec2 resolution; uniform vec3 mouth; uniform float amount; uniform vec4 crop;
uniform float showGuides; uniform float guideRadius; uniform vec2 guidePoints[${GUIDE_COUNT}];
void main(){
 vec2 p=(crop.xy+uv*crop.zw)*resolution;
 vec2 center=vec2(${mouthGeometry.x.toFixed(1)},${mouthGeometry.y.toFixed(1)});
 float dx=p.x-center.x;
 float local=exp(-pow(dx/${mouthGeometry.falloffX.toFixed(1)},4.0)-pow((p.y-center.y)/${mouthGeometry.falloffY.toFixed(1)},4.0));
 float scale=1.0+(mouth.y-1.0)*local;
 float sx=center.x+dx/scale;
 float nx=(sx-center.x)/${mouthGeometry.halfWidth.toFixed(1)};
 float edge=pow(max(0.0,1.0-nx*nx),0.65);
 float seam=center.y+${mouthGeometry.curve.toFixed(1)}*nx*nx;
 float opening=mouth.x*amount*${mouthGeometry.opening.toFixed(1)};
 float top=seam-opening*.36*edge;
 float bottom=seam+opening*.64*edge;
 float shift=(p.y<seam ? opening*.36 : -opening*.64)*edge;
 float outside=p.y<seam?max(0.0,top-p.y):max(0.0,p.y-bottom);
 float sy=p.y+shift*exp(-outside/15.0);
 vec3 col=texture2D(photo,vec2(sx,sy)/resolution).rgb;
 float cavity=smoothstep(top-.35,top+.75,p.y)*(1.0-smoothstep(bottom-.65,bottom+.35,p.y));
 cavity*=smoothstep(0.0,.10,edge)*smoothstep(.0,1.4,opening);
 float relative=clamp((p.y-top)/max(1.0,bottom-top),0.0,1.0);
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
 program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
 gl.useProgram(program);
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
 const attr=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);
 const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
 uniforms=Object.fromEntries(['resolution','mouth','amount','crop','showGuides','guideRadius','guidePoints[0]'].map(k=>[k,gl.getUniformLocation(program,k)]));
 gl.uniform2f(uniforms.resolution,canvas.width,canvas.height);gl.viewport(0,0,canvas.width,canvas.height);
 state.ready=true;$('play').disabled=false;$('status').textContent='Ready · 等待输入';
 document.querySelectorAll('[data-shape]').forEach(button=>button.disabled=false);
 requestAnimationFrame(frame);
}
// Sample the same opening contour that the shader draws. Solve the horizontal
// inverse warp so the circular guides follow the lips rather than float above them.
function updateGuides(){
 const g=mouthGeometry, opening=state.current[0]*Number($('amount').value)*g.opening;
 const points=[[g.x,g.y]];
 // Forward-map a point on the original skin through the exact inverse texture
 // mapping used by the shader. Recompute from the smoothed pose every frame.
 function followSkin([sourceX,sourceY]){
  const sourceDX=sourceX-g.x, nx=sourceDX/g.halfWidth;
  const edge=Math.pow(Math.max(0,1-nx*nx),.65);
  const seam=g.y+g.curve*nx*nx;
  const above=sourceY<seam;
  const boundary=seam+opening*(above?-.36:.64)*edge;
  const shift=opening*(above?.36:-.64)*edge;
  let y=sourceY;
  for(let i=0;i<24;i++){
   const outside=Math.max(0,above?boundary-y:y-boundary);
   y=sourceY-shift*Math.exp(-outside/15);
  }
  let dx=sourceDX;
  for(let i=0;i<24;i++){
   const local=Math.exp(-Math.pow(dx/g.falloffX,4)-Math.pow((y-g.y)/g.falloffY,4));
   dx=sourceDX*(1+(state.current[1]-1)*local);
  }
  return [g.x+dx,y];
 }
 function contour(nx, side){
  const edge=Math.pow(Math.max(0,1-nx*nx),.65);
  const y=g.y+g.curve*nx*nx+opening*side*edge;
  const sourceDX=nx*g.halfWidth;
  let dx=sourceDX;
  for(let i=0;i<12;i++){
   const local=Math.exp(-Math.pow(dx/g.falloffX,4)-Math.pow((y-g.y)/g.falloffY,4));
   dx=sourceDX*(1+(state.current[1]-1)*local);
  }
  return [g.x+dx,y];
 }
 points.push(contour(-1,0),contour(1,0));
 for(const side of [-.36,.64])for(const nx of [-.6,0,.6])points.push(contour(nx,side));
 // Surrounding skin anchors start at the falloff scales, then follow the skin.
 points.push(...[[g.x-g.falloffX,g.y],[g.x+g.falloffX,g.y],[g.x,g.y-g.falloffY],[g.x,g.y+g.falloffY]].map(followSkin));
 points.push(...cheekGuidePoints.map(followSkin));
 guidePoints.set(points.flat());
 return guidePoints;
}
function draw(){
 gl.uniform3fv(uniforms.mouth,state.current);gl.uniform1f(uniforms.amount,Number($('amount').value));
 // Preserve the original aspect ratio while zooming into the face.
 const crop=state.zoom?[.287,.25,.43,.43]:[0,0,1,1];
 gl.uniform4fv(uniforms.crop,crop);
 gl.uniform1f(uniforms.showGuides,state.guides?1:0);
 if(state.guides){
  gl.uniform2fv(uniforms['guidePoints[0]'],updateGuides());
  const displayedWidth=Math.max(1,Math.min(canvas.clientWidth,canvas.clientHeight*canvas.width/canvas.height));
  gl.uniform1f(uniforms.guideRadius,crop[2]*canvas.width/displayedWidth*2.6*.75);
 }
 gl.drawArrays(gl.TRIANGLES,0,6);
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
 const request=++state.request;resetPlayback();$('error').textContent='';$('play').disabled=true;$('status').textContent='Preparing movement…';$('stop').disabled=false;
 try{
  const response=await fetch('/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:$('text').value,speed:Number($('speed').value)})});
  const plan=await response.json();if(!response.ok)throw new Error(plan.error||'Could not prepare movement.');if(request!==state.request)return;
  state.plan=plan;$('readout').replaceChildren(...plan.words.map(word=>{const span=document.createElement('span');span.textContent=word.text+(/[A-Za-z0-9]/.test(word.text)?' ':'');return span;}));lastWord=-2;
  $('meta').textContent=plan.language+' · '+plan.duration.toFixed(1)+' SEC';state.start=performance.now();state.playing=true;$('play').textContent='Restart';$('stop').disabled=false;
 }catch(error){if(request!==state.request)return;$('error').textContent=error.message;$('status').textContent='Waiting for a sentence';$('stop').disabled=true;}
 finally{if(request===state.request)$('play').disabled=!state.ready;}
}
for(const [key,label] of Object.entries(labels)){const button=document.createElement('button');button.textContent=label;button.dataset.shape=key;button.disabled=true;button.setAttribute('aria-pressed',String(key==='X'));button.addEventListener('click',()=>{stop();state.hold=key;$('status').textContent='Hold · '+label;document.querySelectorAll('[data-shape]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));});$('shapes').append(button);}
$('play').addEventListener('click',play);$('stop').addEventListener('click',stop);
$('example-en').addEventListener('click',()=>{stop();$('text').value='I can still hear the room after it falls silent.';});
$('example-zh').addEventListener('click',()=>{stop();$('text').value='你还在这里吗？我听见了风，也听见了你。';});
$('speed').addEventListener('input',()=>{$('speed-value').textContent=Number($('speed').value).toFixed(2)+'×';if(state.playing)stop();});
$('amount').addEventListener('input',()=>{$('amount-value').textContent=Number($('amount').value).toFixed(2)+'×';});
$('zoom').addEventListener('click',()=>{state.zoom=!state.zoom;$('zoom').setAttribute('aria-pressed',String(state.zoom));$('zoom').textContent=state.zoom?'Whole image':'Inspect face';});
$('guides').addEventListener('click',()=>{state.guides=!state.guides;$('guides').setAttribute('aria-pressed',String(state.guides));$('guide-note').hidden=!state.guides;});
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('stage').requestFullscreen();}catch(error){$('error').textContent='Full screen is unavailable here. Open this page in Safari or Chrome.';}});
$('text').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();if(state.ready)play();}});
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();state.ready=false;stop();$('error').textContent='Graphics context lost. Reload the page to restore the portrait.';});
const portrait=new Image();portrait.onload=()=>{try{setup(portrait);}catch(error){$('error').textContent=error.message;$('status').textContent='Could not render portrait';}};portrait.onerror=()=>{$('error').textContent='Portrait image could not be loaded.';};portrait.src='assets/portrait.png';
