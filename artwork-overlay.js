'use strict';
// Keep existing chunk sizing/prefetch; visible captions now follow the current word.
(()=>{
 let measure=null;
 function height(text){
  if(!measure){
   measure=document.createElement('div');measure.setAttribute('aria-hidden','true');
   Object.assign(measure.style,{position:'fixed',left:'-10000px',top:'0',visibility:'hidden',pointerEvents:'none',width:'776px',fontFamily:'"Artwork Myriad Pro","Myriad Pro","PingFang SC",sans-serif',fontSize:'30px',fontWeight:'400',lineHeight:'37px',whiteSpace:'normal',overflowWrap:'anywhere',padding:'0',border:'0'});
   document.body.appendChild(measure);
  }
  measure.textContent=text;return 37+measure.scrollHeight; // One dedicated title line plus the generated text.
 }
 function page(raw){
  const text=raw.replace(/\s+/g,' ').trim();
  const fits=t=>t.length<=900&&height(t)<=259;
  if(fits(text))return {text,remaining:'',ready:height(text)>=259};
  const ends=[...text.matchAll(/\s+/g)].map(m=>m.index).filter(n=>n>0&&n<=900);
  let lo=0,hi=ends.length-1,cut=0;
  while(lo<=hi){const mid=(lo+hi)>>1;if(fits(text.slice(0,ends[mid]))){cut=ends[mid];lo=mid+1;}else hi=mid-1;}
  if(!cut){ // A single long URL/token may span several lines; preserve every character.
   const chars=Array.from(text);lo=1;hi=Math.min(chars.length,900);
   while(lo<=hi){const mid=(lo+hi)>>1,part=chars.slice(0,mid).join('');if(fits(part)){cut=part.length;lo=mid+1;}else hi=mid-1;}
  }
  return {text:text.slice(0,cut),remaining:text.slice(cut).trimStart(),ready:true};
 }
 function sampling(values){
  if(!values)return;
  for(const [key,id] of [['temperature','hud-temperature'],['top_p','hud-top-p']]){const node=document.getElementById(id);if(node&&Number.isFinite(values[key]))node.textContent=String(values[key]);}
 }
 window.afterimageOutput={page,sampling,ready:()=>document.fonts?.ready??Promise.resolve()};
})();

