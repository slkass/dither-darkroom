/* All image processing runs locally in this worker. */
let original=null,sourceVersion=0,preview=null;
const BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
const clamp=(v,lo=0,hi=1)=>Math.max(lo,Math.min(hi,v));
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const wrap=(value,size)=>((value%size)+size)%size;
function shapeContains(shape,dx,dy,radius,stroke){
  if(radius<=0)return false;
  const ax=Math.abs(dx),ay=Math.abs(dy);
  if(shape==='circle')return dx*dx+dy*dy<=radius*radius;
  if(shape==='square')return Math.max(ax,ay)<=radius;
  if(shape==='diamond')return ax+ay<=radius*1.3;
  if(shape==='lines')return ay<=radius*stroke;
  if(shape==='x'){const u=Math.abs(dx+dy)/Math.SQRT2,v=Math.abs(dx-dy)/Math.SQRT2;return Math.max(u,v)<=radius&&Math.min(u,v)<=radius*stroke;}
  return Math.max(ax,ay)<=radius&&Math.min(ax,ay)<=radius*stroke;
}
function raster(maxSize){
  const scale=maxSize?Math.min(1,maxSize/Math.max(original.width,original.height)):1;
  const width=Math.max(1,Math.round(original.width*scale)),height=Math.max(1,Math.round(original.height*scale));
  const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);ctx.drawImage(original,0,0,width,height);
  return {width,height,pixels:ctx.getImageData(0,0,width,height)};
}
function processImage(input,s){
  const {width,height,pixels}=input,data=pixels.data,output=new ImageData(width,height),out=output.data;
  const light=rgb(s.color),background=rgb(s.background);
  const ink=[light[0]*.529,light[1]*.432,light[2]*.957];
  const floor=s.middle?rgb(s.middle):[light[0]*.449,light[1]*.398,light[2]*.567];
  const layered=s.pattern==='tonal',geometric=['cross','x','circle','square','diamond','lines'].includes(s.pattern);
  const palette=[background,ink.map(c=>c*.6),floor,light];
  const scale=Math.max(width,height)/1200,size=Math.max(.5,s.cell*scale);
  const contrast=s.contrast/100,gamma=1-s.lift/100,mix=s.texture/100,brightness=s.brightness/100;
  const fadeStart=s.start/100,fadeEnd=(s.fadeEnd??94)/100,direction=s.fadeDirection??'down';
  const angle=(s.rotation??0)*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
  const pitch=size*4*(s.spacing??100)/100,stroke=(s.stroke??30)/100;
  const detail=(s.sharpness??30)/100,vignette=(s.vignette??0)/100,grain=(s.grain??0)/100;
  const tones=new Float32Array(width*height);
  for(let p=0,i=0;p<tones.length;p++,i+=4){let g=(.2126*data[i]+.7152*data[i+1]+.0722*data[i+2])/255;g=Math.pow(clamp((g-.012)/.988),gamma);tones[p]=clamp((g-.5)*contrast+.5);}
  const radius=Math.max(1,Math.round(4*scale));
  for(let y=0;y<height;y++){
    const fy=y/Math.max(1,height-1);
    for(let x=0;x<width;x++){
      const p=y*width+x,i=p*4,fx=x/Math.max(1,width-1);let g=tones[p];
      const neighbors=(tones[y*width+Math.max(0,x-radius)]+tones[y*width+Math.min(width-1,x+radius)]+tones[Math.max(0,y-radius)*width+x]+tones[Math.min(height-1,y+radius)*width+x])/4;
      g=clamp(g+detail*(g-neighbors));
      const rx=x*cos+y*sin,ry=-x*sin+y*cos;
      const threshold=(BAYER[wrap(Math.floor(ry/size),4)*4+wrap(Math.floor(rx/size),4)]+.5)/16;
      let active=.025+(s.coverage/100-.025)*g>threshold;
      if(geometric){
        const dx=wrap(rx,pitch)-pitch/2,dy=wrap(ry,pitch)-pitch/2;
        const dotRadius=size*1.8*Math.sqrt(clamp(g*s.coverage/50));
        active=shapeContains(s.pattern,dx,dy,dotRadius,stroke);
      }
      // A full fractional Bayer phase creates dot -> upright cross -> square-hole transitions.
      const q=g*(2+s.coverage/100),base=Math.floor(q),level=Math.min(3,base+(q-base>threshold?1:0));
      const position=direction==='up'?1-fy:direction==='left'?1-fx:direction==='right'?fx:fy;
      const t=clamp((position-fadeStart)/Math.max(.01,fadeEnd-fadeStart));
      const radial=((2*fx-1)**2+(2*fy-1)**2)/2;
      const gain=brightness*(1-s.fade/100*t*t*(3-2*t))*(1-vignette*radial*radial);
      // Deterministic grain in normalized coordinates: previews never shimmer when controls move.
      let noise=0;
      if(grain){const hash=Math.sin(Math.floor(x/scale)*12.9898+Math.floor(y/scale)*78.233)*43758.5453;noise=((hash-Math.floor(hash))-.5)*64*grain;}
      for(let c=0;c<3;c++){
        const low=background[c]*(1-g*g)+floor[c]*g*g,high=ink[c]+(light[c]-ink[c])*g;
        const continuous=background[c]+(light[c]-background[c])*g*.72;
        const screen=layered?palette[level][c]:(active?high:low);
        out[i+c]=clamp((screen*mix+continuous*(1-mix)+noise)*gain,0,255);
      }
      out[i+3]=255;
    }
  }
  const canvas=new OffscreenCanvas(width,height);canvas.getContext('2d').putImageData(output,0,0);return canvas;
}
if(typeof self!=='undefined')self.onmessage=async event=>{
  const m=event.data;
  try{
    if(m.type==='load'){original?.close();original=m.bitmap;sourceVersion=m.sourceVersion;preview=null;self.postMessage({type:'loaded',sourceVersion});return;}
    if(!original)throw new Error('请先选择图片。');
    if(m.type==='preview'){if(m.sourceVersion!==sourceVersion)return;preview??=raster(m.maxSize);const canvas=processImage(preview,m.settings),bitmap=canvas.transferToImageBitmap();self.postMessage({type:'preview',id:m.id,sourceVersion,bitmap,width:canvas.width,height:canvas.height},[bitmap]);}
    if(m.type==='export'){const canvas=processImage(raster(m.maxSize),m.settings),blob=await canvas.convertToBlob({type:'image/png'});self.postMessage({type:'export',blob,width:canvas.width,height:canvas.height});}
  }catch(e){self.postMessage({type:'error',message:e?.message||'处理失败，请缩小图片后重试。'});}
};
