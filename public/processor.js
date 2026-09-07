/* All image processing runs locally in this worker. */
let original=null,sourceVersion=0,preview=null;
const BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
const clamp=(v,lo=0,hi=1)=>Math.max(lo,Math.min(hi,v));
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
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
  const ink=[light[0]*.529,light[1]*.432,light[2]*.957],floor=[light[0]*.449,light[1]*.398,light[2]*.567];
  const size=Math.max(.5,s.cell*Math.max(width,height)/1200),contrast=s.contrast/100,gamma=1-s.lift/100,mix=s.texture/100,brightness=s.brightness/100,fadeStart=s.start/100;
  const tones=new Float32Array(width*height);
  for(let p=0,i=0;p<tones.length;p++,i+=4){let g=(.2126*data[i]+.7152*data[i+1]+.0722*data[i+2])/255;g=Math.pow(clamp((g-.012)/.988),gamma);tones[p]=clamp((g-.5)*contrast+.5);}
  const radius=Math.max(1,Math.round(4*Math.max(width,height)/1200));
  for(let y=0;y<height;y++){
    const t=clamp((y/Math.max(1,height-1)-fadeStart)/Math.max(.01,.94-fadeStart)),gain=brightness*(1-s.fade/100*t*t*(3-2*t)),by=(Math.floor(y/size)%4)*4;
    for(let x=0;x<width;x++){
      const p=y*width+x,i=p*4;let g=tones[p];
      const neighbors=(tones[y*width+Math.max(0,x-radius)]+tones[y*width+Math.min(width-1,x+radius)]+tones[Math.max(0,y-radius)*width+x]+tones[Math.min(height-1,y+radius)*width+x])/4;
      g=clamp(g+.3*(g-neighbors));const threshold=(BAYER[by+Math.floor(x/size)%4]+.5)/16,active=.025+(s.coverage/100-.025)*g>threshold;
      for(let c=0;c<3;c++){const low=background[c]*(1-g*g)+floor[c]*g*g,high=ink[c]+(light[c]-ink[c])*g,continuous=background[c]+(light[c]-background[c])*g*.72;out[i+c]=clamp(((active?high:low)*mix+continuous*(1-mix))*gain,0,255);}out[i+3]=255;
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
