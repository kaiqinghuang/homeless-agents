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
function makeHeadMask(outline,feather=8){
 const mask=document.createElement('canvas');mask.width=mask.height=1024;
 const ctx=mask.getContext('2d');
 ctx.fillStyle='#000';ctx.fillRect(0,0,1024,1024);
 ctx.beginPath();outline.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();
 ctx.save();ctx.clip();ctx.fillStyle='#fff';ctx.fill();
 // Paint nested edge strokes, clipped to the silhouette. No blur can leak
 // outward onto the ground; feathering stays inside the fixed silhouette.
 ctx.lineJoin='round';
 for(let distance=feather;distance>=.5;distance-=.5){
  const t=(distance-.5)/(feather-.5),gray=Math.round(255*t*t*(3-2*t));
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
// Eighth face: taut asymmetric lip/cheek tension inside a fixed brown hood.
const upperLeftHeadOutline=[[475,171],[519,174],[562,193],[602,220],[634,252],[652,290],[659,334],[659,376],[650,419],[641,458],[627,499],[611,539],[591,577],[566,612],[536,637],[503,652],[469,647],[438,630],[412,604],[392,573],[375,536],[361,495],[350,451],[341,407],[336,362],[338,315],[349,270],[371,234],[405,205],[441,184]];
const upperLeftLipAnchors={"X":[438,539,578,540,505,524,505,530],"A":[438,530,580,533,501,520,501,524],"B":[438,535,574,541,505,519,505,524],"C":[440,533,564,538,499,514,499,530],"D":[446,532,560,538,504,509,504,537],"E":[451,531,563,537,506,517,506,534],"F":[448,535,563,539,508,514,508,533],"G":[435,531,580,532,505,515,505,519],"H":[442,533,565,540,507,518,507,531]};
const upperLeftSecondVariants={"A":[{"key":"second:01-pressed","file":"01-pressed","folder":"upper-left-visemes-v2","anchors":[437,540,570,550,505,526,505,530],"version":2}],"B":[{"key":"second:02-wide","file":"02-wide","folder":"upper-left-visemes-v2","anchors":[438,535,574,541,505,519,505,524],"version":2}],"C":[{"key":"second:03-parted","file":"03-parted","folder":"upper-left-visemes-v2","anchors":[438,535,574,540,505,523,505,529]}],"D":[{"key":"second:04-open","file":"04-open","folder":"upper-left-visemes-v2","anchors":[438,532,571,540,505,524,505,532]}],"E":[{"key":"second:05-oh","file":"05-oh","folder":"upper-left-visemes-v2","anchors":[447,531,565,536,507,520,507,531]}],"F":[{"key":"second:06-oo","file":"06-oo","folder":"upper-left-visemes-v2","anchors":[446,539,565,539,510,528,510,533]}],"G":[{"key":"second:07-fold","file":"07-fold","folder":"upper-left-visemes-v2","anchors":[438,539,573,540,503,526,503,529]}],"H":[{"key":"second:08-skew","file":"08-skew","folder":"upper-left-visemes-v2","anchors":[448,534,572,542,513,524,513,534]}]};
const upperLeftThirdVariants={"A":[{"key":"third:01-pressed","file":"01-pressed","folder":"upper-left-visemes-v3","anchors":[437,540,570,550,505,526,505,530]}],"B":[{"key":"third:02-wide","file":"02-wide","folder":"upper-left-visemes-v3","anchors":[438,535,574,541,505,519,505,524]}],"C":[{"key":"third:03-parted","file":"03-parted","folder":"upper-left-visemes-v3","anchors":[439,542,573,546,499,513,499,521]}],"D":[{"key":"third:04-open","file":"04-open","folder":"upper-left-visemes-v3","anchors":[440,540,571,551,505,517,505,527]}],"E":[{"key":"third:05-oh","file":"05-oh","folder":"upper-left-visemes-v3","anchors":[448,539,574,545,505,521,505,529]}],"F":[{"key":"third:06-oo","file":"06-oo","folder":"upper-left-visemes-v3","anchors":[440,541,574,545,509,517,509,526]}],"G":[{"key":"third:07-fold","file":"07-fold","folder":"upper-left-visemes-v3","anchors":[438,535,579,550,496,515,496,522]}],"H":[{"key":"third:08-skew","file":"08-skew","folder":"upper-left-visemes-v3","anchors":[438,539,577,555,507,521,507,527]}]};
const upperLeftVariants=Object.fromEntries(Object.keys(upperLeftSecondVariants).map(p=>[p,[...upperLeftSecondVariants[p],...upperLeftThirdVariants[p]]]));
// Ninth face: switch the full facial surface, excluding hair, ornaments and neck.
const rightLargeHeadOutline=[[414,270],[424,234],[452,214],[484,201],[521,178],[550,158],[571,163],[582,180],[588,216],[588,253],[603,285],[617,296],[631,288],[627,258],[626,221],[633,183],[640,166],[678,168],[714,187],[744,220],[767,250],[786,288],[800,330],[801,374],[796,417],[786,460],[773,493],[759,531],[737,570],[707,611],[674,644],[641,666],[607,683],[575,682],[547,689],[518,683],[488,668],[461,647],[443,624],[428,596],[415,563],[405,525],[398,481],[396,441],[397,405],[405,377],[415,361],[416,327],[411,300]];
const rightLargeLipAnchors={"X":[480,535,625,567,550,534,550,539],"A":[480,530,620,556,550,526,550,531],"B":[480,534,620,561,550,530,550,535],"C":[480,532,621,560,550,529,550,536],"D":[480,533,624,561,550,527,550,536],"E":[480,533,620,560,550,530,550,536],"F":[492,536,619,563,554,531,554,539],"G":[480,534,620,560,550,530,550,534],"H":[480,533,621,560,550,530,550,534]};
const rightLargeSecondVariants={"A":[{"key":"second:01-pressed","file":"01-pressed","folder":"right-large-visemes-v2","anchors":[480,530,621,556,550,526,550,530]}],"B":[{"key":"second:02-wide","file":"02-wide","folder":"right-large-visemes-v2","anchors":[480,535,620,560,550,532,550,534]}],"E":[{"key":"second:05-oh","file":"05-oh","folder":"right-large-visemes-v2","anchors":[484,535,622,563,552,530,552,538]}],"F":[{"key":"second:06-oo","file":"06-oo","folder":"right-large-visemes-v2","anchors":[493,535,620,562,554,530,554,538]}],"G":[{"key":"second:07-fold","file":"07-fold","folder":"right-large-visemes-v2","anchors":[481,535,620,560,550,531,550,533]}],"H":[{"key":"second:08-skew","file":"08-skew","folder":"right-large-visemes-v2","anchors":[481,534,623,560,550,529,550,535]}]};
// Tenth face: uncoordinated lip articulation within the full head silhouette.
const whiteUpperHeadOutline=[[499,166],[547,172],[590,189],[630,213],[665,244],[690,281],[710,325],[719,365],[714,405],[701,447],[704,473],[722,467],[739,486],[749,517],[743,558],[725,598],[702,635],[682,648],[672,640],[652,693],[626,737],[590,770],[548,793],[504,801],[459,798],[417,780],[380,752],[349,718],[326,674],[309,628],[287,646],[265,641],[244,621],[227,591],[213,553],[211,517],[219,484],[238,463],[260,464],[272,481],[270,436],[263,401],[260,366],[268,329],[282,293],[303,263],[335,233],[371,211],[415,188],[456,174]];
const whiteUpperLipAnchors={"X":[433,646,597,642,517,638,517,643],"A":[432,639,595,638,520,628,520,633],"B":[431,643,594,637,520,631,520,635],"C":[432,644,596,641,520,627,520,641],"D":[434,646,594,649,519,627,519,650],"E":[444,643,585,650,520,628,520,644],"F":[450,651,575,650,516,624,516,650],"G":[432,644,589,636,517,627,517,631],"H":[429,645,597,644,519,634,519,643]};
const whiteUpperSecondVariants={"A":[{"key":"second:01-pressed","file":"01-pressed","folder":"white-upper-visemes-v2","anchors":[433,641,595,637,519,627,519,630]}],"B":[{"key":"second:02-wide","file":"02-wide","folder":"white-upper-visemes-v2","anchors":[430,646,600,638,520,629,520,633]}],"C":[{"key":"second:03-parted","file":"03-parted","folder":"white-upper-visemes-v2","anchors":[436,649,596,644,520,634,520,641]}],"D":[{"key":"second:04-open","file":"04-open","folder":"white-upper-visemes-v2","anchors":[439,646,596,644,520,629,520,659]}],"E":[{"key":"second:05-oh","file":"05-oh","folder":"white-upper-visemes-v2","anchors":[450,644,584,640,520,628,520,648]}],"F":[{"key":"second:06-oo","file":"06-oo","folder":"white-upper-visemes-v2","anchors":[449,642,585,639,517,632,517,638]}],"G":[{"key":"second:07-fold","file":"07-fold","folder":"white-upper-visemes-v2","anchors":[435,637,596,638,519,625,519,628]}],"H":[{"key":"second:08-skew","file":"08-skew","folder":"white-upper-visemes-v2","anchors":[435,645,593,641,520,636,520,643]}]};
// Eleventh face: small painted head, varied lip folds and uneasy facial tension.
const tinyRightHeadOutline=[[478,225],[466,205],[447,191],[424,185],[399,192],[369,210],[347,231],[324,257],[309,288],[301,324],[296,364],[293,405],[296,448],[304,490],[302,516],[302,549],[304,582],[313,610],[311,629],[322,643],[338,646],[351,637],[363,682],[378,719],[397,748],[421,765],[450,779],[480,786],[511,789],[541,784],[570,774],[595,759],[615,737],[631,705],[644,667],[650,645],[664,659],[681,658],[694,642],[705,615],[710,582],[717,549],[718,517],[713,501],[704,496],[689,509],[697,479],[708,447],[714,414],[710,378],[700,341],[681,308],[659,276],[633,249],[604,224],[575,205],[550,191],[523,187],[503,193],[490,207]];
const tinyRightLipAnchors={"X":[434,658,579,659,505,650,505,654],"A":[436,652,576,655,506,649,506,651],"B":[436,654,578,654,506,646,506,652],"C":[436,658,576,659,508,646,508,661],"D":[442,656,566,661,508,646,508,661],"E":[444,654,566,655,506,645,506,660],"F":[435,653,573,651,505,648,505,651],"G":[431,644,580,646,506,639,506,642],"H":[434,653,575,656,504,646,504,660]};
const tinyRightSecondVariants={"A":[{"key":"second:01-pressed","file":"01-pressed","folder":"tiny-right-visemes-v2","anchors":[434,656,579,657,507,651,507,653]}],"B":[{"key":"second:02-wide","file":"02-wide","folder":"tiny-right-visemes-v2","anchors":[433,658,579,660,506,646,506,657]}],"C":[{"key":"second:03-parted","file":"03-parted","folder":"tiny-right-visemes-v2","anchors":[438,657,574,674,548,655,548,678]}],"D":[{"key":"second:04-open","file":"04-open","folder":"tiny-right-visemes-v2","anchors":[436,654,574,665,507,647,507,666]}],"E":[{"key":"second:05-oh","file":"05-oh","folder":"tiny-right-visemes-v2","anchors":[451,654,563,653,508,646,508,665]}],"F":[{"key":"second:06-oo","file":"06-oo","folder":"tiny-right-visemes-v2","anchors":[442,652,569,652,507,648,507,652]}],"G":[{"key":"second:07-fold","file":"07-fold","folder":"tiny-right-visemes-v2","anchors":[439,651,570,652,517,647,517,656]}],"H":[{"key":"second:08-skew","file":"08-skew","folder":"tiny-right-visemes-v2","anchors":[437,669,578,647,508,649,508,663]}]};
// Twelfth face: restrained gray head, asymmetric lip mechanics.
const ruffleRightHeadOutline=[[338,183],[358,163],[390,154],[423,157],[458,147],[494,147],[531,148],[568,154],[606,170],[644,195],[677,227],[704,266],[727,309],[741,352],[747,398],[742,445],[739,472],[738,502],[720,532],[696,550],[688,576],[683,603],[668,621],[650,622],[639,655],[625,689],[607,721],[586,746],[558,766],[528,778],[498,782],[467,778],[437,768],[407,752],[379,732],[354,707],[335,679],[320,647],[308,612],[299,593],[285,605],[270,598],[255,580],[249,553],[249,523],[256,496],[266,475],[254,449],[242,422],[244,388],[254,351],[265,316],[280,279],[296,245],[315,213]];
const ruffleRightLipAnchors={"X":[423,661,573,678,500,654,500,658],"A":[424,660,570,675,497,651,497,654],"B":[423,661,572,678,500,655,500,660],"C":[424,667,567,679,534,650,534,664],"D":[428,662,570,680,505,649,505,666],"E":[428,661,568,678,507,651,507,662],"F":[429,661,568,678,501,654,501,660],"G":[425,668,568,678,511,658,511,660],"H":[424,660,570,676,521,651,521,666]};
const ruffleRightSecondVariants={"A":[{"key":"second:01-pressed","file":"01-pressed","folder":"ruffle-right-visemes-v2","anchors":[426,658,570,675,500,652,500,654]}],"B":[{"key":"second:02-wide","file":"02-wide","folder":"ruffle-right-visemes-v2","anchors":[426,662,570,678,501,655,501,661]}],"C":[{"key":"second:03-parted","file":"03-parted","folder":"ruffle-right-visemes-v2","anchors":[426,660,570,677,500,654,500,659]}],"D":[{"key":"second:04-open","file":"04-open","folder":"ruffle-right-visemes-v2","anchors":[426,662,570,677,501,652,501,665]}],"E":[{"key":"second:05-oh","file":"05-oh","folder":"ruffle-right-visemes-v2","anchors":[434,662,565,678,507,653,507,661]}],"F":[{"key":"second:06-oo","file":"06-oo","folder":"ruffle-right-visemes-v2","anchors":[426,662,568,678,501,655,501,657]}],"G":[{"key":"second:07-fold","file":"07-fold","folder":"ruffle-right-visemes-v2","anchors":[425,662,570,678,500,655,500,657]}],"H":[{"key":"second:08-skew","file":"08-skew","folder":"ruffle-right-visemes-v2","anchors":[426,660,570,673,506,653,506,664]}]};
// Thirteenth face: taut, indistinct asymmetric muttering.
const upperRightHeadOutline=[[407,94],[449,96],[493,109],[538,124],[577,144],[608,180],[632,224],[644,265],[644,308],[637,350],[633,396],[644,406],[656,406],[665,417],[666,446],[659,481],[650,514],[637,539],[620,552],[607,548],[593,574],[578,607],[558,636],[535,661],[506,683],[476,698],[453,706],[440,715],[411,719],[390,713],[375,702],[349,692],[322,675],[300,652],[283,626],[270,595],[261,562],[251,535],[235,540],[218,530],[204,508],[196,479],[190,449],[191,419],[200,399],[212,394],[218,398],[217,369],[211,337],[212,302],[217,269],[229,232],[248,199],[276,169],[309,143],[345,122],[377,106]];
const upperRightLipAnchors={"X":[356,579,507,585,430,574,430,577],"A":[355,573,505,587,431,564,431,568],"B":[356,569,506,584,430,558,430,568],"C":[357,577,508,583,463,562,463,578],"D":[356,577,507,581,432,560,432,575],"E":[365,582,499,589,432,567,432,583],"F":[369,579,494,583,430,568,430,579],"G":[356,574,508,571,429,566,429,570],"H":[355,571,507,583,428,555,428,570]};
const upperRightSecondVariants={"A":[{"key":"second:01-pressed","file":"01-pressed","folder":"upper-right-visemes-v2","anchors":[356,578,507,584,431,572,431,575]}],"B":[{"key":"second:02-wide","file":"02-wide","folder":"upper-right-visemes-v2","anchors":[356,579,507,585,430,560,430,578]}],"C":[{"key":"second:03-parted","file":"03-parted","folder":"upper-right-visemes-v2","anchors":[357,577,507,583,404,562,404,577]}],"D":[{"key":"second:04-open","file":"04-open","folder":"upper-right-visemes-v2","anchors":[356,570,507,584,431,561,431,579]}],"E":[{"key":"second:05-oh","file":"05-oh","folder":"upper-right-visemes-v2","anchors":[366,581,502,586,432,566,432,583]}],"F":[{"key":"second:06-oo","file":"06-oo","folder":"upper-right-visemes-v2","anchors":[369,579,494,583,430,568,430,580]}],"G":[{"key":"second:07-fold","file":"07-fold","folder":"upper-right-visemes-v2","anchors":[355,576,507,578,429,570,429,574]}],"H":[{"key":"second:08-skew","file":"08-skew","folder":"upper-right-visemes-v2","anchors":[357,578,506,583,430,569,430,578]}]};
// Fourteenth face: taut, indistinct asymmetric muttering.
const wrappedHeadOutline=[[354,208],[370,190],[409,182],[449,181],[489,190],[522,205],[552,222],[581,246],[603,282],[623,326],[632,365],[638,405],[648,443],[658,483],[668,529],[671,566],[665,588],[641,590],[620,583],[613,566],[599,568],[598,610],[607,642],[573,624],[536,616],[498,605],[457,595],[414,583],[377,582],[348,592],[329,604],[300,596],[291,565],[289,528],[296,490],[301,452],[300,420],[286,391],[272,356],[269,320],[277,287],[291,257],[310,235],[333,218]];
const wrappedLipAnchors={"X":[458,533,547,539,499,530,499,532],"A":[455,534,548,541,497,531,497,533],"B":[458,534,547,537,497,532,497,534],"C":[458,537,546,539,499,527,499,537],"D":[458,537,546,539,500,526,500,537],"E":[458,535,546,539,499,528,499,537],"F":[458,534,547,538,497,532,497,534],"G":[459,536,547,538,500,531,500,536],"H":[458,539,547,541,499,531,499,539]};
// Fifteenth face: taut, indistinct asymmetric muttering.
const farRightHeadOutline=[[627,247],[670,251],[713,263],[754,275],[789,296],[817,329],[839,363],[851,397],[855,430],[851,461],[850,480],[863,505],[873,535],[870,565],[852,591],[835,615],[814,636],[799,661],[780,665],[763,678],[748,693],[736,699],[720,710],[697,728],[666,741],[636,740],[610,726],[586,705],[568,680],[552,651],[537,635],[514,647],[494,641],[474,625],[460,607],[450,582],[448,558],[458,535],[469,518],[456,499],[446,474],[441,447],[449,419],[466,393],[481,365],[501,337],[526,311],[557,287],[590,266]];
const farRightLipAnchors={"X":[604,619,693,625,650,615,650,619],"A":[604,615,691,625,649,615,649,618],"B":[604,622,691,625,648,616,648,624],"C":[610,622,690,625,653,614,653,623],"D":[606,621,691,625,650,614,650,624],"E":[618,625,686,630,651,616,651,631],"F":[606,623,690,628,649,618,649,626],"G":[604,621,691,623,649,619,649,621],"H":[610,624,690,630,653,617,653,628]};
const farRightVariants={"H":[{"key":"extra:09-skew-initial","file":"09-skew-initial","folder":"far-right-visemes-v1","anchors":[609,622,693,630,650,616,650,628]}]};
const spriteFaces={
 'far-right':{face:faces.find(g=>g.id==='far-right'),folder:'far-right-visemes-v1',variants:farRightVariants,baseProbability:{H:.5},origin:[4096,1472],sourceScale:.5,rect:[4096/4608,1472/2592,512/4608,512/2592],outline:farRightHeadOutline,maskFeather:16,lipAnchors:farRightLipAnchors,textures:{},mask:null},
 'wrapped':{face:faces.find(g=>g.id==='wrapped'),folder:'wrapped-visemes-v1',origin:[4000,32],sourceScale:.59375,rect:[4000/4608,32/2592,608/4608,608/2592],outline:wrappedHeadOutline,maskFeather:16,lipAnchors:wrappedLipAnchors,textures:{},mask:null},
 'upper-right':{face:faces.find(g=>g.id==='upper-right'),folder:'upper-right-visemes-v1',variants:upperRightSecondVariants,setWeights:[20,80],origin:[3552,64],sourceScale:.625,rect:[3552/4608,64/2592,640/4608,640/2592],outline:upperRightHeadOutline,maskFeather:16,lipAnchors:upperRightLipAnchors,textures:{},mask:null},
 'ruffle-right':{face:faces.find(g=>g.id==='ruffle-right'),folder:'ruffle-right-visemes-v1',version:2,variants:ruffleRightSecondVariants,setWeights:[50,50],origin:[3520,1920],sourceScale:.5,rect:[3520/4608,1920/2592,512/4608,512/2592],outline:ruffleRightHeadOutline,maskFeather:16,lipAnchors:ruffleRightLipAnchors,textures:{},mask:null},
 'tiny-right':{face:faces.find(g=>g.id==='tiny-right'),folder:'tiny-right-visemes-v1',variants:tinyRightSecondVariants,setWeights:[80,20],origin:[3184,1920],sourceScale:.375,rect:[3184/4608,1920/2592,384/4608,384/2592],outline:tinyRightHeadOutline,maskFeather:16,lipAnchors:tinyRightLipAnchors,textures:{},mask:null},
 'white-upper':{face:faces.find(g=>g.id==='white-upper'),folder:'white-upper-visemes-v1',variants:whiteUpperSecondVariants,setWeights:[75,25],origin:[2336,32],sourceScale:.5,rect:[2336/4608,32/2592,512/4608,512/2592],outline:whiteUpperHeadOutline,maskFeather:16,lipAnchors:whiteUpperLipAnchors,textures:{},mask:null},
 'right-large':{face:faces.find(g=>g.id==='right-large'),folder:'right-large-visemes-v1',variants:rightLargeSecondVariants,setWeights:[70,30],origin:[3424,800],rect:[3424/4608,800/2592,1024/4608,1024/2592],outline:rightLargeHeadOutline,maskFeather:24,lipAnchors:rightLargeLipAnchors,textures:{},mask:null},
 'upper-left':{face:faces.find(g=>g.id==='upper-left'),folder:'upper-left-visemes-v1',version:2,variants:upperLeftVariants,setWeights:[10,35,55],origin:[1056,64],rect:[1056/4608,64/2592,1024/4608,1024/2592],outline:upperLeftHeadOutline,lipAnchors:upperLeftLipAnchors,textures:{},mask:null},
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
 // Optional weights correspond to the base set followed by each matching variant.
 if(config.setWeights){
  const choices=[base,...candidates],weights=config.setWeights;
  let roll=Math.random()*weights.reduce((sum,w)=>sum+w,0),index=0;
  while(index<weights.length-1&&roll>=weights[index]){roll-=weights[index];index++;}
  config.selection={...choices[index],pose,revision:state.poseRevision};return config.selection;
 }
 const probability=config.baseProbability?.[pose]??.7;
 const selected = Math.random() < probability ? base : candidates[
  config.face.id === 'red-eyes' && pose === 'B'
    ? (Math.random() < 20 / 30 ? 0 : 1)
    : Math.floor(Math.random() * candidates.length)
];
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
 for(const config of Object.values(spriteFaces))config.mask=uploadTexture(makeHeadMask(config.outline,config.maskFeather));
 gl.activeTexture(gl.TEXTURE0);
 gl.uniform4fv(uniforms.spriteRect,centralSpriteRect);
 $('status').textContent='Loading mouth images… / 正在加载嘴形图片';
 const images=await Promise.all(Object.values(spriteFaces).flatMap(config=>[
   ...Object.entries(centralPoseFiles).map(async([key,file])=>[config,key,await loadPoseImage(file,config.folder,config.version)]),
   ...Object.values(config.variants??{}).flat().map(async v=>[config,v.key,await loadPoseImage(v.file,v.folder,v.version??1)])
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
