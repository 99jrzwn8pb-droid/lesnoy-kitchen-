'use strict';

// Deterministic geometry/event checks for the custom table viewport.
// jsdom does not render pixels or reproduce Safari's native gesture handling.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let JSDOM;
try { ({JSDOM} = require('jsdom')); }
catch { ({JSDOM} = require('/tmp/lesnoy-dom-qa/node_modules/jsdom')); }

function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 0.0001, `${message}: expected ${expected}, got ${actual}`);
}

function harness(t) {
  const dom = new JSDOM('<!doctype html><div id="viewport"><div id="surface"><table id="content"></table></div></div>', {
    url:'https://viewport.example/', runScripts:'outside-only'
  });
  const w = dom.window;
  const viewport = w.document.querySelector('#viewport');
  const surface = w.document.querySelector('#surface');
  const content = w.document.querySelector('#content');
  const dimensions = {width:360,height:400,contentWidth:1200,contentHeight:600};
  for (const [property,key] of [['clientWidth','width'],['clientHeight','height']]) {
    Object.defineProperty(viewport,property,{get:()=>dimensions[key]});
  }
  for (const [property,key] of [['offsetWidth','contentWidth'],['scrollWidth','contentWidth'],['offsetHeight','contentHeight'],['scrollHeight','contentHeight']]) {
    Object.defineProperty(content,property,{get:()=>dimensions[key]});
  }
  viewport.getBoundingClientRect=()=>({left:10,top:20,right:10+dimensions.width,bottom:20+dimensions.height,width:dimensions.width,height:dimensions.height});
  viewport.setPointerCapture=()=>{};
  viewport.releasePointerCapture=()=>{};
  const errors=[];
  w.addEventListener('error',event=>errors.push(event.error?.message||event.message));
  w.eval(fs.readFileSync(require('./site-path.cjs')('viewport.js'),'utf8'));
  const scales=[];
  const controller=w.LesnoyViewport.create({viewport,surface,content,onScale:state=>scales.push(state)});
  const pointer=(type,id,x,y,pointerType='touch')=>{
    const event=new w.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:type==='pointerup'?0:1});
    Object.defineProperties(event,{pointerId:{value:id},pointerType:{value:pointerType},isPrimary:{value:id===1}});
    viewport.dispatchEvent(event);return event;
  };
  const wheel=options=>{
    const event=new w.WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:190,clientY:220,...options});
    viewport.dispatchEvent(event);return event;
  };
  t.after(()=>{controller.destroy();w.close();assert.deepEqual(errors,[],'Viewport must not throw event errors');});
  return {w,viewport,surface,content,dimensions,controller,scales,pointer,wheel};
}

test('initial fit keeps the complete table together and centers the short axis',t=>{
  const h=harness(t),s=h.controller.getState();
  close(s.scale,0.3,'Initial fit');close(s.x,0,'Horizontal origin');close(s.y,110,'Vertical centering');
  assert.equal(s.manual,false);
  assert.match(h.surface.style.transform,/translate/);
  assert.match(h.surface.style.transform,/scale/);
  assert.ok(h.scales.length>0);
});

test('spreading two fingers zooms in and squeezing zooms out around their center',t=>{
  const h=harness(t);
  h.pointer('pointerdown',1,140,220);h.pointer('pointerdown',2,240,220);
  h.pointer('pointermove',1,90,220);h.pointer('pointermove',2,290,220);
  let s=h.controller.getState();
  close(s.scale,0.6,'Spreading distance200 over initial100');
  close((180-s.x)/s.scale,600,'Content center x is preserved');
  close((200-s.y)/s.scale,300,'Content center y is preserved');
  h.pointer('pointermove',1,155,220);h.pointer('pointermove',2,225,220);
  s=h.controller.getState();close(s.scale,0.21,'Squeezing distance70 over initial100');
  assert.ok(s.scale<0.3);
  h.pointer('pointerup',1,155,220);h.pointer('pointerup',2,225,220);
  assert.equal(h.controller.isClickBlocked(),true,'Pinching must not trigger a shift click');
});

test('zoom limits, reset and clamping keep the table reachable',t=>{
  const h=harness(t);
  h.controller.zoomBy(100);let s=h.controller.getState();close(s.scale,3,'Maximum zoom');
  assert.ok(s.x<=0&&s.x>=s.width-s.contentWidth*s.scale);
  assert.ok(s.y<=0&&s.y>=s.height-s.contentHeight*s.scale);
  h.controller.zoomBy(0.000001);s=h.controller.getState();close(s.scale,0.2,'Minimum zoom');
  close(s.x,60,'Small table centered horizontally');close(s.y,140,'Small table centered vertically');
  h.controller.fit();s=h.controller.getState();close(s.scale,0.3,'Reset fit');assert.equal(s.manual,false);
});

test('one-finger drag pans only after movement and suppresses the following click',t=>{
  const h=harness(t);
  h.pointer('pointerdown',1,190,220);h.pointer('pointerup',1,190,220);
  assert.equal(h.controller.isClickBlocked(),false,'A plain tap remains available for editing');
  h.controller.zoomBy(3);const before=h.controller.getState();
  h.pointer('pointerdown',1,190,220);h.pointer('pointermove',1,270,270);h.pointer('pointerup',1,270,270);
  const after=h.controller.getState();
  close(after.x-before.x,80,'Drag x');close(after.y-before.y,50,'Drag y');
  assert.equal(h.controller.isClickBlocked(),true);
  h.pointer('pointerdown',1,190,220);h.pointer('pointermove',1,-10000,-10000);h.pointer('pointerup',1,-10000,-10000);
  const edge=h.controller.getState();
  close(edge.x,edge.width-edge.contentWidth*edge.scale,'Right boundary');
  close(edge.y,edge.height-edge.contentHeight*edge.scale,'Bottom boundary');
});

test('resize and content changes refit untouched view but preserve manual zoom',t=>{
  const h=harness(t);
  h.dimensions.width=480;h.controller.refresh();close(h.controller.getState().scale,0.4,'Automatic resize fit');
  h.controller.zoomBy(2);close(h.controller.getState().scale,0.8,'Manual zoom');
  h.dimensions.width=360;h.dimensions.contentHeight=1000;h.controller.refresh();
  close(h.controller.getState().scale,0.8,'Manual scale survives refresh');assert.equal(h.controller.getState().manual,true);
  h.controller.fit();close(h.controller.getState().scale,0.3,'Reset after resize');
  h.dimensions.contentHeight=2000;h.controller.refresh();close(h.controller.getState().scale,0.2,'Tall content fit');
});

test('a tall table at minimum fit starts with its first rows visible and remains pannable',t=>{
  const h=harness(t);h.dimensions.contentHeight=6000;h.controller.fit();
  let state=h.controller.getState();
  close(state.scale,0.2,'Tall table minimum fit');close(state.x,60,'Narrow axis centered');close(state.y,0,'First row stays visible');
  h.pointer('pointerdown',1,190,260);h.pointer('pointermove',1,190,60);h.pointer('pointerup',1,190,60);
  state=h.controller.getState();close(state.y,-200,'Long table can be moved to later rows');
});

test('wheel pans inside the viewport and trackpad control-wheel zooms without page scroll',t=>{
  const h=harness(t);h.controller.zoomBy(3);const before=h.controller.getState();
  assert.equal(h.wheel({deltaX:20,deltaY:30}).defaultPrevented,true);
  let after=h.controller.getState();close(after.x,before.x-20,'Wheel x');close(after.y,before.y-30,'Wheel y');
  assert.equal(h.wheel({deltaY:-100,ctrlKey:true}).defaultPrevented,true);
  after=h.controller.getState();assert.ok(after.scale>before.scale,'Control-wheel up zooms in');
  const increased=after.scale;h.wheel({deltaY:100,metaKey:true});assert.ok(h.controller.getState().scale<increased,'Meta-wheel down zooms out');
});

test('keyboard reveal moves an offscreen cell into the viewport without changing scale',t=>{
  const h=harness(t);h.controller.zoomBy(4);const before=h.controller.getState();
  const element=h.w.document.createElement('button');h.content.append(element);
  element.getBoundingClientRect=()=>{
    const s=h.controller.getState();const left=10+s.x+1100*s.scale,top=20+s.y+500*s.scale;
    return {left,top,right:left+80*s.scale,bottom:top+30*s.scale,width:80*s.scale,height:30*s.scale};
  };
  h.controller.reveal(element);
  const s=h.controller.getState(),r=element.getBoundingClientRect();close(s.scale,before.scale,'Reveal keeps scale');
  assert.ok(r.left>=10-0.001&&r.right<=370.001,'Cell visible horizontally');
  assert.ok(r.top>=20-0.001&&r.bottom<=420.001,'Cell visible vertically');
});

test('destroy disconnects input handlers without changing the saved schedule',t=>{
  const h=harness(t);const before=h.controller.getState();h.controller.destroy();
  h.wheel({deltaY:-200,ctrlKey:true});h.pointer('pointerdown',1,50,50);h.pointer('pointermove',1,250,250);h.pointer('pointerup',1,250,250);
  assert.deepEqual(h.controller.getState(),before);
});
