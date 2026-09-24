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
// canvas and texture retain the full native image resolution (currently 4608×2592).
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
 // The central image pass covers the full 1024px face crop, including forehead.
 bounds:[1824*1184/4608-602.08,752*666/2592-390.85,
         (1824+1024)*1184/4608-602.08,(752+1024)*666/2592-390.85],
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
 makeFace('wrapped',1102.90,89.73,8.3,.10,.4),
 makeFace('far-upper-left',152.88,111.51,9.51,-0.025,1.03),
 makeFace('top-black',265.68,30.58,8.99,-0.170,0.00),
 makeFace('far-left',109.97,242.81,7.45,0.020,2.31),
 makeFace('wicker-left',102.01,460.44,6.17,0.060,0.51),
 makeFace('wig-left',269.79,604.08,8.22,0.080,0.77),
 makeFace('white-upper',667.03,90.19,8.48,-0.040,0.51),
 makeFace('clay-lower',627.46,559.62,5.14,-0.100,0.51),
 makeFace('ruffle-right',970.48,579.41,8.74,0.070,1.54),
 makeFace('far-right',1136.21,458.13,5.91,0.040,0.77)
];
// Frame the entire composite together: remove 10px left / 4px right at the
// 1184px reference width, then enlarge uniformly to fill. Center the vertical crop.
// Background, sprite UVs, procedural faces, guides and scissors share this crop.
const artworkFrame = {left:10, right:4};
const artworkScale = (calibrationSize[0]-artworkFrame.left-artworkFrame.right)/calibrationSize[0];
const artworkCrop = [artworkFrame.left/calibrationSize[0], (1-artworkScale)/2, artworkScale, artworkScale];
const faceCrop = [.304, .29, .41, .41];
const GUIDE_COUNT=21;
const guidePoints=new Float32Array(GUIDE_COUNT*2);
function faceToImage(g,x,y){const c=Math.cos(g.angle),s=Math.sin(g.angle);return [g.x+c*x-s*y,g.y+s*x+c*y];}
function faceScissor(g,crop,width,height){
 const [l,t,r,b]=g.bounds;
 const points=g.spriteBounds
  ? [[g.spriteBounds[0],g.spriteBounds[1]],[g.spriteBounds[2],g.spriteBounds[3]]]
  : [[l,t],[r,t],[l,b],[r,b]].map(([x,y])=>faceToImage(g,x,y));
 const px=x=>(x/calibrationSize[0]-crop[0])/crop[2]*width;
 const py=y=>(y/calibrationSize[1]-crop[1])/crop[3]*height;
 const x0=Math.max(0,Math.floor(px(Math.min(...points.map(p=>p[0])))));
 const x1=Math.min(width,Math.ceil(px(Math.max(...points.map(p=>p[0])))));
 const y0=Math.max(0,Math.floor(py(Math.min(...points.map(p=>p[1])))));
 const y1=Math.min(height,Math.ceil(py(Math.max(...points.map(p=>p[1])))));
 return x1>x0&&y1>y0?[x0,height-y1,x1-x0,y1-y0]:null;
}
// Discrete artwork poses; the shared phoneme planner keeps its A–H codes.
const centralPoseFiles={X:'00-rest',A:'01-pressed',B:'02-wide',C:'03-parted',D:'04-open',E:'05-oh',F:'06-oo',G:'07-fold',H:'08-skew'};
const centralSpriteRect=[1824/4608,752/2592,1024/4608,1024/2592];
// Inset silhouette traced on the original 1024px crop. It excludes the
// surrounding soil and cast shadow; each pose shares this fixed boundary.
const centralHeadOutline=[
 [517,62],[573,69],[628,88],[681,119],[729,161],[766,215],
 [792,274],[804,334],[805,396],[798,453],[794,499],
 [818,507],[844,498],[862,511],[874,538],[874,577],[865,615],
 [847,650],[824,673],[801,679],[787,665],
 [775,711],[755,759],[724,807],[683,852],[636,887],
 [582,916],[525,932],[468,922],[409,901],[355,871],
 [309,831],[274,782],[247,727],[230,672],
 [209,678],[184,663],[165,633],[151,596],[146,556],
 [153,522],[169,507],[187,512],[201,539],[212,558],
 [205,498],[198,440],[197,380],[203,318],[215,258],
 [237,202],[271,155],[317,117],[368,89],[421,73],[469,63]
];
function makeHeadMask(outline){
 const mask=document.createElement('canvas');mask.width=mask.height=1024;
 const ctx=mask.getContext('2d');
 ctx.fillStyle='#000';ctx.fillRect(0,0,1024,1024);
 ctx.beginPath();outline.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();
 ctx.save();ctx.clip();ctx.fillStyle='#fff';ctx.fill();
 // Paint nested edge strokes, clipped to the silhouette. No blur can leak
 // outward onto the ground; the 8px feather lies entirely inside the head.
 ctx.lineJoin='round';
 for(let distance=8;distance>=.5;distance-=.5){
  const t=(distance-.5)/7.5,gray=Math.round(255*t*t*(3-2*t));
  ctx.strokeStyle=`rgb(${gray},${gray},${gray})`;ctx.lineWidth=distance*2;ctx.stroke();
 }
 ctx.restore();return mask;
}
function makeCentralHeadMask(){return makeHeadMask(centralHeadOutline);}
const centralTextures={};
let boundSpriteKey=null;
function loadPoseImage(file,folder,version=1){
 return new Promise((resolve,reject)=>{
  const image=new Image();image.onload=()=>resolve(image);
  image.onerror=()=>reject(new Error('Mouth images could not load. Restart Start.command, then refresh. / 请重启 Start.command 后刷新，加载嘴形图片。'));
  image.src='assets/'+folder+'/'+file+'.png?v='+version;
 });
}
function uploadTexture(image){
 const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);return texture;
}
// Approximate lip anchors measured in each still's 1024px crop. They switch
// with the selected image, rather than following the old geometric warp.
const centralLipAnchors={
 X:[420,779,620,783,520,768,520,771],A:[403,780,624,784,516,762,516,764],
 B:[399,770,620,782,510,757,510,767],C:[393,779,619,790,510,763,510,784],
 D:[423,781,608,784,505,758,505,787],E:[432,780,611,785,506,760,506,788],
 F:[451,780,595,783,501,754,501,785],G:[403,780,625,783,510,761,510,765],
 H:[394,780,618,791,559,754,559,787]
};
// Original set restored: level lip folds, subtler AH and original EH/OO brows.
// The first11 collection plus an extra Wide shares 30% selection probability.
const redEyesHeadOutline=[
 [437,185],[502,183],[565,192],[621,211],[671,242],[706,278],
 [728,320],[733,370],[730,430],[730,491],[725,548],[728,592],
 [740,608],[750,637],[749,672],[739,696],[721,710],[706,705],
 [697,752],[682,803],[657,850],[625,887],[585,918],[549,935],
 [501,936],[459,922],[417,902],[384,872],[354,826],[330,777],
 [312,723],[301,669],[293,610],[293,544],[293,483],[295,427],
 [307,377],[328,335],[340,296],[352,260],[373,230],[399,205]
];
const redEyesLipAnchors={
 X:[447,801,625,805,534,786,534,790],A:[449,800,625,800,536,780,536,782],
 B:[454,796,616,796,535,781,535,792],C:[457,802,617,801,531,775,531,797],
 D:[453,801,615,801,535,769,535,800],E:[473,802,610,802,535,773,535,802],
 F:[480,801,614,803,529,783,529,801],G:[448,800,620,800,536,782,536,786],
 H:[453,799,619,799,535,775,535,788]
};
// The brown face swallows its words: small, locally folded lips with
// different eye/brow/cheek tension per still, not a mirrored diagonal pull.
const brownHeadOutline=[
 [448,125],[505,118],[566,128],[628,159],[682,204],[725,254],
 [744,312],[742,370],[724,432],[708,466],[725,478],[731,501],
 [724,536],[708,563],[685,582],[663,585],[649,622],[628,664],
 [603,701],[573,732],[537,748],[501,756],[471,746],[438,723],
 [411,693],[388,651],[363,606],[351,563],[337,551],[330,535],
 [332,517],[343,500],[352,483],[350,440],[338,405],[328,366],
 [326,317],[342,270],[366,227],[390,185],[417,150]
];
const brownLipAnchors={
 X:[448,666,568,670,509,663,509,666],A:[448,658,567,665,508,660,508,662],
 B:[450,652,567,665,498,656,498,660],C:[450,654,559,667,510,659,510,662],
 D:[448,657,564,672,508,657,508,667],E:[454,661,567,667,506,651,506,663],
 F:[457,660,565,665,511,657,511,665],G:[448,653,565,665,509,659,509,661],
 H:[450,654,563,668,509,653,509,662]
};
// Fourth face: slipping lip layers inside the fixed hood. Authored at 2x source size.
const smallLeftHeadOutline=[[379,224],[439,202],[497,212],[531,244],[545,280],[541,308],[575,329],[611,358],[642,398],[668,440],[685,483],[698,526],[698,561],[680,594],[661,619],[660,658],[652,705],[635,750],[606,791],[564,824],[522,846],[480,860],[447,850],[421,822],[401,789],[380,746],[363,696],[347,644],[332,590],[318,535],[309,481],[307,432],[303,388],[301,342],[318,295],[349,253]];
const smallLeftLipAnchors={"X":[440,686,629,680,541,657,541,663],"A":[442,683,627,677,548,656,548,660],"B":[441,684,625,680,538,655,538,666],"C":[443,683,623,678,542,658,542,666],"D":[443,684,623,680,541,652,541,666],"E":[446,682,623,678,551,650,551,663],"F":[445,683,625,679,544,649,544,668],"G":[442,682,624,678,540,654,540,659],"H":[442,683,624,679,538,656,538,662]};
// Fifth face: watchful painted hood, asymmetric lip folds and unequal eyelid tension.
const lowerHoodHeadOutline=[[433,200],[480,194],[525,211],[568,246],[612,265],[648,304],[673,358],[678,402],[690,437],[686,487],[679,533],[669,581],[655,628],[635,670],[606,700],[572,718],[537,726],[502,716],[470,699],[441,674],[419,642],[400,600],[386,552],[376,504],[367,458],[359,414],[351,374],[350,332],[361,288],[382,248],[407,219]];
const lowerHoodLipAnchors={"X":[469,574,637,564,560,529,560,548],"A":[467,573,632,563,561,528,561,531],"B":[482,555,640,555,559,524,559,548],"C":[470,570,632,565,558,530,558,546],"D":[474,573,635,569,560,521,560,550],"E":[478,572,631,566,562,526,562,560],"F":[475,570,634,566,554,527,554,541],"G":[477,553,632,555,557,518,557,521],"H":[480,557,635,565,550,524,550,538]};
const lowerHoodVariants={"B":[{"key":"extra:09-wide-initial","file":"09-wide-initial","folder":"lower-hood-visemes-v1","anchors":[483,554,637,555,559,530,559,539]}],"D":[{"key":"extra:10-open-initial","file":"10-open-initial","folder":"lower-hood-visemes-v1","anchors":[475,572,635,568,560,523,560,547]}],"E":[{"key":"extra:11-oh-initial","file":"11-oh-initial","folder":"lower-hood-visemes-v1","anchors":[481,572,635,566,560,531,560,554]}],"G":[{"key":"extra:12-fold-initial","file":"12-fold-initial","folder":"lower-hood-visemes-v1","anchors":[475,561,634,558,559,521,559,525]},{"key":"extra:13-fold-intermediate","file":"13-fold-intermediate","folder":"lower-hood-visemes-v1","anchors":[484,558,635,557,560,522,560,545]}]};
const redEyesFirstVariants={"A":[{"key":"first:01-pressed","file":"01-pressed","folder":"red-eyes-first11","anchors":[449,799,627,801,536,780,536,782]}],"B":[{"key":"first:02-wide","file":"02-wide","folder":"red-eyes-first11","anchors":[447,796,624,779,535,783,535,790]},{"key":"first:12-wide-expression","file":"12-wide-expression","folder":"red-eyes-first11","anchors":[450,796,625,793,537,776,537,786]}],"C":[{"key":"first:03-parted-initial","file":"03-parted-initial","folder":"red-eyes-first11","anchors":[447,800,625,799,538,778,538,793]},{"key":"first:10-parted-expression","file":"10-parted-expression","folder":"red-eyes-first11","anchors":[457,802,617,801,531,775,531,797]}],"D":[{"key":"first:04-open","file":"04-open","folder":"red-eyes-first11","anchors":[457,801,619,800,533,770,533,804]}],"E":[{"key":"first:05-oh","file":"05-oh","folder":"red-eyes-first11","anchors":[460,801,618,794,535,774,535,798]}],"F":[{"key":"first:06-oo-initial","file":"06-oo-initial","folder":"red-eyes-first11","anchors":[476,798,612,800,540,780,540,797]},{"key":"first:09-oo-expression","file":"09-oo-expression","folder":"red-eyes-first11","anchors":[480,801,614,803,529,783,529,801]}],"G":[{"key":"first:07-fold","file":"07-fold","folder":"red-eyes-first11","anchors":[448,800,626,802,534,782,534,787]}],"H":[{"key":"first:08-skew-initial","file":"08-skew-initial","folder":"red-eyes-first11","anchors":[449,807,623,788,535,775,535,795]},{"key":"first:11-skew-expression","file":"11-skew-expression","folder":"red-eyes-first11","anchors":[453,801,620,788,539,779,539,788]}]};
// Sixth face: quiet clay, tiny uneven lip seams; native crop authored at 8/3 scale.
const clayLowerHeadOutline=[[348,430],[388,431],[432,422],[473,436],[512,433],[548,426],[588,424],[626,409],[663,397],[698,426],[714,458],[714,505],[708,549],[700,596],[685,644],[663,689],[638,734],[612,766],[579,785],[543,797],[506,790],[470,772],[442,745],[416,712],[394,674],[375,632],[359,585],[348,541],[343,496]];
const clayLowerLipAnchors={"X":[472,691,599,685,533,684,533,688],"A":[474,689,598,684,533,685,533,687],"B":[463,689,600,685,533,682,533,686],"C":[475,689,595,687,510,682,510,691],"D":[475,691,592,688,535,686,535,698],"E":[483,689,588,688,538,684,538,695],"F":[483,690,591,687,540,689,540,703],"G":[475,690,595,684,530,685,530,688],"H":[475,690,595,686,533,690,533,699]};
// Seventh face: tiny triangular mouth; articulation lives in surrounding muscle planes.
const leftProfileHeadOutline=[[279,380],[310,369],[351,366],[387,367],[419,378],[448,396],[478,420],[498,446],[525,466],[545,489],[552,521],[551,555],[548,587],[553,617],[551,649],[548,678],[539,700],[543,719],[542,741],[530,753],[510,754],[490,743],[475,737],[468,751],[448,766],[424,775],[395,770],[374,758],[355,741],[341,715],[328,685],[318,650],[305,613],[292,571],[279,526],[267,480],[256,435],[259,405]];
const leftProfileLipAnchors={"X":[479,598,505,601,490,589,490,601],"A":[477,599,505,604,487,589,490,601],"B":[482,598,503,601,491,590,491,599],"C":[479,601,501,603,490,588,490,601],"D":[475,595,495,596,483,585,484,595],"E":[480,600,502,603,490,588,490,601],"F":[476,595,495,596,486,585,486,595],"G":[478,601,500,602,489,584,489,601],"H":[485,601,505,603,494,588,495,601]};
const leftProfileSecondVariants={"A":[{"key":"second:01-pressed","file":"01-pressed","folder":"left-profile-visemes-v2","anchors":[458,613,513,614,488,585,489,615]}],"B":[{"key":"second:02-wide","file":"02-wide","folder":"left-profile-visemes-v2","anchors":[451,604,508,606,483,591,483,605]}],"C":[{"key":"second:03-parted","file":"03-parted","folder":"left-profile-visemes-v2","anchors":[456,608,514,613,490,583,490,613]}],"D":[{"key":"second:04-open","file":"04-open","folder":"left-profile-visemes-v2","anchors":[451,610,519,607,488,584,489,617]}],"E":[{"key":"second:05-oh","file":"05-oh","folder":"left-profile-visemes-v2","anchors":[451,610,507,613,489,581,484,612]}],"F":[{"key":"second:06-oo","file":"06-oo","folder":"left-profile-visemes-v2","anchors":[472,596,516,612,493,576,493,606]}],"G":[{"key":"second:07-fold","file":"07-fold","folder":"left-profile-visemes-v2","anchors":[453,610,517,614,490,584,484,612]}],"H":[{"key":"second:08-skew","file":"08-skew","folder":"left-profile-visemes-v2","anchors":[467,597,512,611,493,580,490,610]}]};
const spriteFaces={
 'left-profile':{face:faces.find(g=>g.id==='left-profile'),folder:'left-profile-visemes-v1',variants:leftProfileSecondVariants,baseProbability:{A:.7,B:.7,C:.7,D:.7,E:.7,F:.7,G:.7,H:.7},origin:[640,640],rect:[640/4608,640/2592,1024/4608,1024/2592],outline:leftProfileHeadOutline,lipAnchors:leftProfileLipAnchors,textures:{},mask:null},
 'clay-lower':{face:faces.find(g=>g.id==='clay-lower'),folder:'clay-lower-visemes-v1',origin:[2240,1920],sourceScale:.375,rect:[2240/4608,1920/2592,384/4608,384/2592],outline:clayLowerHeadOutline,lipAnchors:clayLowerLipAnchors,textures:{},mask:null},
 central:{face:centralFace,folder:'central-visemes-v1',origin:[1824,752],rect:centralSpriteRect,outline:centralHeadOutline,lipAnchors:centralLipAnchors,textures:centralTextures,mask:null},
 'red-eyes':{face:faces.find(g=>g.id==='red-eyes'),folder:'red-eyes-visemes-v1',version:6,variants:redEyesFirstVariants,origin:[2688,256],rect:[2688/4608,256/2592,1024/4608,1024/2592],outline:redEyesHeadOutline,lipAnchors:redEyesLipAnchors,textures:{},mask:null},
 'small-left':{face:faces.find(g=>g.id==='small-left'),folder:'small-left-visemes-v1',origin:[1408,1248],sourceScale:.5,rect:[1408/4608,1248/2592,512/4608,512/2592],outline:smallLeftHeadOutline,lipAnchors:smallLeftLipAnchors,textures:{},mask:null},
 'lower-hood':{face:faces.find(g=>g.id==='lower-hood'),folder:'lower-hood-visemes-v1',variants:lowerHoodVariants,baseProbability:{B:.5,D:.5,E:.5,G:1/3},origin:[1792,1760],sourceScale:.5,rect:[1792/4608,1760/2592,512/4608,512/2592],outline:lowerHoodHeadOutline,lipAnchors:lowerHoodLipAnchors,textures:{},mask:null},
 'lower-right':{face:faces.find(g=>g.id==='lower-right'),folder:'brown-face-visemes-v1',origin:[2560,1408],rect:[2560/4608,1408/2592,1024/4608,1024/2592],outline:brownHeadOutline,lipAnchors:brownLipAnchors,textures:{},mask:null}
};
for(const config of Object.values(spriteFaces)){
 const xs=config.outline.map(p=>p[0]),ys=config.outline.map(p=>p[1]),[x,y]=config.origin,scale=config.sourceScale??1;
 // Limit the draw pass to the head silhouette's bounds, with a 1px margin.
 config.face.spriteBounds=[(x+Math.min(...xs)*scale-1)*1184/4608,(y+Math.min(...ys)*scale-1)*666/2592,
  (x+Math.max(...xs)*scale+1)*1184/4608,(y+Math.max(...ys)*scale+1)*666/2592];
}
// Choose once per phoneme cue (including repeated same-shape cues), never per frame.
// Red eyes retains 70/30 set weighting; other faces may define per-pose probabilities.
function spritePose(config,pose){
 const base={key:pose,anchors:config.lipAnchors[pose]};
 const candidates=config.variants?.[pose];
 if(pose==='X'||!candidates?.length)return base;
 const previous=config.selection;
 if(previous&&previous.pose===pose&&previous.revision===state.poseRevision)return previous;
 const probability=config.baseProbability?.[pose]??.7;
 const selected=Math.random()<probability?base:candidates[Math.floor(Math.random()*candidates.length)];
 config.selection={...selected,pose,revision:state.poseRevision};return config.selection;
}
function centralGuides(pose){return imagePoseGuides(centralFace,pose);}
function imagePoseGuides(g,pose){
 const config=spriteFaces[g.id],scale=config.sourceScale??1;
 const [lx,ly,rx,ry,tx,ty,bx,by]=spritePose(config,pose).anchors;
 const lip=[[.5*(lx+rx),.5*(ty+by)],[lx,ly],[rx,ry],
  [.4*lx+.6*tx,.4*ly+.6*ty],[tx,ty],[.4*rx+.6*tx,.4*ry+.6*ty],
  [.4*lx+.6*bx,.4*ly+.6*by],[bx,by],[.4*rx+.6*bx,.4*ry+.6*by]]
  .map(([x,y])=>[(config.origin[0]+x*scale)*1184/4608,(config.origin[1]+y*scale)*666/2592]);
 const skin=[[-g.falloffX,0],[g.falloffX,0],[0,-g.falloffY],[0,g.falloffY],...g.cheeks].map(([x,y])=>faceToImage(g,x,y));
 guidePoints.set([...lip,...skin].flat());return guidePoints;
}
const labels = {X:'Rest',A:'M / B / P',B:'EE',C:'EH',D:'AH',E:'OH',F:'OO',G:'Lip fold · F / V',H:'Skew · L'};
let state = {ready:false, playing:false, plan:null, start:0, elapsed:0, hold:'X', pose:'X', poseRevision:0, current:[0,1,0], zoom:false, guides:false, request:0};
let program, uniforms, lastFrame=performance.now(), lastWord=-2, lastCue=-1;
const vertex = `attribute vec2 position; varying vec2 uv; void main(){uv=vec2((position.x+1.0)*0.5,(1.0-position.y)*0.5);gl_Position=vec4(position,0.0,1.0);}`;
const fragment = `precision highp float;
varying vec2 uv; uniform sampler2D photo; uniform vec2 resolution; uniform vec3 mouth; uniform float amount; uniform vec4 crop;
uniform sampler2D posePhoto; uniform sampler2D headMask; uniform vec4 spriteRect; uniform float spriteVisible;
uniform float activeFace; uniform vec4 geometry; uniform vec4 dynamics; uniform vec2 axis; uniform vec4 faceBounds; uniform float softness;
uniform float showGuides; uniform float guideRadius; uniform vec2 guidePoints[${GUIDE_COUNT}];
vec3 withGuides(vec3 col,vec2 p){
 if(showGuides>.5){
  float nearest=10000.0;
  for(int i=0;i<${GUIDE_COUNT};i++){nearest=min(nearest,length(p-guidePoints[i]));}
  col=mix(col,vec3(0.0),1.0-smoothstep(guideRadius*.78,guideRadius,nearest));
 }
 return col;
}
float maskAt(vec2 q){
 vec2 a=smoothstep(faceBounds.xy,faceBounds.xy+geometry.z*.4,q);
 vec2 b=1.0-smoothstep(faceBounds.zw-geometry.z*.4,faceBounds.zw,q);
 return a.x*a.y*b.x*b.y;
}
void main(){
 vec2 p=(crop.xy+uv*crop.zw)*resolution;
 if(activeFace<.5){gl_FragColor=vec4(texture2D(photo,p/resolution).rgb,1.0);return;}
 if(activeFace>1.5){
  vec2 t=(p/resolution-spriteRect.xy)/spriteRect.zw;
  // The whole face changes, but the fixed inset silhouette excludes all soil.
  float coverage=texture2D(headMask,t).r;
  // A later head pass must never paint original ground over an earlier face.
  if(coverage<=0.0)discard;
  float mask=coverage*spriteVisible;
  vec3 col=mix(texture2D(photo,p/resolution).rgb,texture2D(posePhoto,t).rgb,mask);
  gl_FragColor=vec4(withGuides(col,p),1.0);return;
 }
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
 col=mix(col,inside,cavity);
 gl_FragColor=vec4(withGuides(col,p),1.0);
}`;
function compile(type, source){const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));return shader;}
async function setup(image){
 if(!gl)throw new Error('This browser cannot render WebGL. Please use Safari or Chrome.');
 canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
 $('stage').style.aspectRatio=canvas.width+'/'+canvas.height;
 program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
 gl.useProgram(program);
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
 const attr=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);
 gl.activeTexture(gl.TEXTURE0);uploadTexture(image);
 uniforms=Object.fromEntries(['photo','posePhoto','headMask','spriteRect','spriteVisible','resolution','mouth','amount','crop','showGuides','guideRadius','guidePoints[0]','activeFace','geometry','dynamics','axis','faceBounds','softness'].map(k=>[k,gl.getUniformLocation(program,k)]));
 gl.uniform1i(uniforms.photo,0);gl.uniform1i(uniforms.posePhoto,1);gl.uniform1i(uniforms.headMask,2);
 gl.activeTexture(gl.TEXTURE2);
 for(const config of Object.values(spriteFaces))config.mask=uploadTexture(makeHeadMask(config.outline));
 gl.activeTexture(gl.TEXTURE0);
 gl.uniform4fv(uniforms.spriteRect,centralSpriteRect);
 $('status').textContent='Loading mouth images… / 正在加载嘴形图片';
 const images=await Promise.all(Object.values(spriteFaces).flatMap(config=>[
   ...Object.entries(centralPoseFiles).map(async([key,file])=>[config,key,await loadPoseImage(file,config.folder,config.version)]),
   ...Object.values(config.variants??{}).flat().map(async v=>[config,v.key,await loadPoseImage(v.file,v.folder,1)])
 ]));
 gl.activeTexture(gl.TEXTURE1);
 for(const [config,key,image] of images)config.textures[key]=uploadTexture(image);
 gl.activeTexture(gl.TEXTURE0);
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
 const crop=state.zoom?faceCrop:artworkCrop;gl.uniform4fv(uniforms.crop,crop);
 // One full-resolution background, then small scissored regions for each face.
 // We reuse 21 guide uniforms instead of requiring a large array for all faces.
 gl.disable(gl.SCISSOR_TEST);gl.uniform1f(uniforms.activeFace,0);gl.drawArrays(gl.TRIANGLES,0,6);
 gl.enable(gl.SCISSOR_TEST);gl.uniform1f(uniforms.activeFace,1);
 gl.uniform1f(uniforms.showGuides,state.guides?1:0);
 const displayedWidth=Math.max(1,Math.min(canvas.clientWidth,canvas.clientHeight*canvas.width/canvas.height));
 for(const g of faces){
  const rect=faceScissor(g,crop,canvas.width,canvas.height);if(!rect)continue;
  gl.scissor(...rect);
  const sprite=spriteFaces[g.id];
  gl.uniform1f(uniforms.activeFace,sprite?2:1);
  const pose=state.pose;
  if(sprite){
   const selected=spritePose(sprite,pose);
   const key=g.id+':'+selected.key;
   if(boundSpriteKey!==key){
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,sprite.textures[selected.key]);
    gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,sprite.mask);
    gl.activeTexture(gl.TEXTURE0);boundSpriteKey=key;
   }
   gl.uniform4fv(uniforms.spriteRect,sprite.rect);
   gl.uniform1f(uniforms.spriteVisible,pose==='X'?0:1);
  }
  gl.uniform4fv(uniforms.geometry,[g.x,g.y,g.halfWidth,g.falloffX]);
  gl.uniform4fv(uniforms.dynamics,[g.falloffY,g.curve,g.opening,g.decay]);
  gl.uniform2f(uniforms.axis,Math.cos(g.angle),Math.sin(g.angle));
  gl.uniform4fv(uniforms.faceBounds,g.bounds);gl.uniform1f(uniforms.softness,g.softness);
  if(state.guides){
   gl.uniform2fv(uniforms['guidePoints[0]'],sprite?imagePoseGuides(g,pose):updateGuides(g));
   gl.uniform1f(uniforms.guideRadius,crop[2]*calibrationSize[0]/displayedWidth*2.6*.75*Math.max(.3,Math.min(1,g.softness)));
  }
  gl.drawArrays(gl.TRIANGLES,0,6);
 }
 gl.disable(gl.SCISSOR_TEST);
}
function frame(now){
 const dt=Math.min(.05,(now-lastFrame)/1000);lastFrame=now;
 let pose=state.hold;
 if(state.playing){
  state.elapsed=(now-state.start)/1000;
  const plan=state.plan;
  if(state.elapsed>=plan.duration){state.playing=false;state.hold='X';pose='X';$('stop').disabled=true;$('play').textContent='Play again';$('status').textContent='Finished · 播放结束';setProgress(100);highlight(-1);}
  else{
   const index=plan.timeline.findIndex(c=>state.elapsed>=c.start&&state.elapsed<c.end);
   const cue=plan.timeline[index];
   if(cue){pose=cue.shape;highlight(cue.word);if(index!==lastCue){state.poseRevision++;$('status').textContent='Mouthing · '+labels[cue.shape];lastCue=index;}}
   setProgress(100*state.elapsed/plan.duration);
  }
 }
 state.pose=pose;
 const target=shapes[pose];
 const blend=1-Math.exp(-dt*23);
 state.current=state.current.map((value,i)=>value+(target[i]-value)*blend);
 draw();requestAnimationFrame(frame);
}
function setProgress(value){$('progress').style.width=value+'%';document.querySelector('.track').setAttribute('aria-valuenow',Math.round(value));}
function highlight(index){
 if(index===lastWord)return;
 lastWord=index;
 [...$('readout').children].forEach((span,i)=>span.classList.toggle('current',i===index));
 // Use the same word event as the mouth cues; silence, stop and completion clear it.
 const text=index>=0?state.plan?.words[index]?.text??'':'';
 $('word-subtitle').textContent=text.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'');
}
function resetPlayback(){state.poseRevision++;state.playing=false;state.hold='X';state.pose='X';state.elapsed=0;lastCue=-1;highlight(-1);setProgress(0);$('stop').disabled=true;$('play').textContent='Play sentence';document.querySelectorAll('[data-shape]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.shape==='X')));}
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
const portrait=new Image();portrait.onload=async()=>{try{await setup(portrait);}catch(error){$('error').textContent=error.message;$('status').textContent='Could not render portrait';}};portrait.onerror=()=>{$('error').textContent='Portrait image could not be loaded.';};portrait.src='assets/portrait.png?v=composition-20260922-1';

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
