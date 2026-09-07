import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const context = vm.createContext({
  Uint8ClampedArray, Float32Array, Math, parseInt,
  ImageData: class { constructor(width,height) { this.width=width;this.height=height;this.data=new Uint8ClampedArray(width*height*4); } },
  OffscreenCanvas: class { constructor(width,height){this.width=width;this.height=height;} getContext(){return {putImageData:image=>{this.image=image;}};} },
});
vm.runInContext(await fs.readFile(new URL('../public/processor.js',import.meta.url),'utf8')+'\nglobalThis.render=processImage;',context);
const settings={pattern:'tonal',cell:4,coverage:50,lift:0,contrast:100,texture:100,fade:0,start:15,brightness:100,color:'#8a76e9',background:'#050508'};
function render(tone,overrides={},width=1200,height=16){
  const data=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<data.length;i+=4){data[i]=data[i+1]=data[i+2]=tone;data[i+3]=255;}
  return context.render({width,height,pixels:{data}},{...settings,...overrides}).image;
}
const tile=image=>Array.from({length:4},(_,y)=>Array.from({length:4},(_,x)=>image.data[((y*4+1)*image.width+x*4+1)*4]));
const crosses=mask=>mask.some((row,y)=>row.some((on,x)=>on&&mask[y][(x+3)%4]&&mask[y][(x+1)%4]&&mask[(y+3)%4][x]&&mask[(y+1)%4][x]));

test('intermediate Bayer phases connect into upright crosses',()=>{
  const mask=tile(render(64)).map(row=>row.map(red=>red>5));
  assert.equal(mask.flat().filter(Boolean).length,10);
  assert(crosses(mask),'a filled centre must have all four cardinal neighbours');
});
test('sparse phases keep isolated square dots; bright phases leave square holes',()=>{
  const sparse=tile(render(16)).map(row=>row.map(red=>red>5));
  assert.equal(sparse.flat().filter(Boolean).length,2);assert(!crosses(sparse));
  const filled=tile(render(84)).map(row=>row.map(red=>red>5));
  assert.equal(filled.flat().filter(Boolean).length,13);assert(crosses(filled));
});
test('white uses alternating upper palette levels rather than saturating to a flat fill',()=>{
  const reds=tile(render(255)).flat();assert.equal(new Set(reds).size,2);
  assert.equal(reds.filter(v=>v===138).length,8);
});
test('black remains dark and the legacy screen remains available',()=>{
  assert(render(0).data.every((v,i)=>i%4===3?v===255:v<=8));
  assert.notDeepEqual(render(64).data,render(64,{pattern:'bayer'}).data);
});
test('zero texture ignores screen structure; fade is applied after screening',()=>{
  assert.deepEqual(render(100,{texture:0,pattern:'tonal'}).data,render(100,{texture:0,pattern:'bayer'}).data);
  const faded=render(255,{fade:100},1200,100);assert(faded.data.slice(-1200*4).every((v,i)=>i%4===3?v===255:v===0));
});
test('pattern scale follows output dimensions',()=>{
  const normal=render(64),large=render(64,{},2400,32);
  for(let y=0;y<16;y+=3)for(let x=0;x<1200;x+=17)for(let c=0;c<4;c++)assert.equal(normal.data[(y*1200+x)*4+c],large.data[(y*2*2400+x*2)*4+c]);
});
