import assert from 'node:assert/strict';
import test from 'node:test';
import {splitAt,splitByKey,createComparisonDrag} from '../lib/comparison.mjs';

test('comparison uses the displayed image bounds and clamps outside drags',()=>{
  assert.equal(splitAt(350,100,1000),25);assert.equal(splitAt(600,100,1000),50);
  assert.equal(splitAt(-100,100,1000),0);assert.equal(splitAt(1600,100,1000),100);
  assert.equal(splitAt(350,100,0,72),72);
});
test('comparison supports keyboard endpoints and fine/coarse steps',()=>{
  assert.equal(splitByKey('ArrowRight',50),51);assert.equal(splitByKey('ArrowLeft',50,true),40);
  assert.equal(splitByKey('ArrowRight',99,true),100);assert.equal(splitByKey('ArrowLeft',0),0);
  assert.equal(splitByKey('Home',73),0);assert.equal(splitByKey('End',20),100);
});
test('pointer capture keeps a drag active outside image and cancellation ends it',()=>{
  const values=[],captured=new Set();
  const target={getBoundingClientRect:()=>({left:100,width:400}),setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id)};
  const event=(x,id=1,button=0)=>({clientX:x,pointerId:id,button,currentTarget:target,preventDefault(){}});
  const drag=createComparisonDrag(value=>values.push(value));
  drag.down(event(200));assert(captured.has(1));assert.equal(values.at(-1),25);
  drag.down(event(300,2));drag.move(event(400,2));assert.equal(values.at(-1),25);
  drag.move(event(900));assert.equal(values.at(-1),100);
  drag.end(event(900));assert(!captured.has(1));drag.move(event(200));assert.equal(values.at(-1),100);
  drag.down(event(200,3,2));assert(!captured.has(3));
  drag.down(event(300,4));drag.lost(event(300,4));drag.move(event(100,4));assert.equal(values.at(-1),50);
});
