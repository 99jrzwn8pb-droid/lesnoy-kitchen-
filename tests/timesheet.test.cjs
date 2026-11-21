'use strict';
// DOM integration with the production HTML, event handlers and calculation core.
// Browser layout, native share sheets and touch interactions still require device QA.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let jsdom, canvas;
try { jsdom = require('jsdom'); } catch { jsdom = require('/tmp/lesnoy-dom-qa/node_modules/jsdom'); }
try { canvas = require('@napi-rs/canvas'); } catch { canvas = require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas'); }
const {JSDOM, VirtualConsole} = jsdom;
const site = fs.existsSync(path.join(__dirname, '../site/index.html')) ? path.join(__dirname, '../site') : path.join(__dirname, '..');
const Core = require(path.join(site, 'core.js'));
const Monthly = require(path.join(site, 'timesheet-core.js'));
const WEEKLY = 'lesnoy-kitchen:v1';
const MONTHLY = Monthly.STORAGE_KEY;
function fixture() {
  const state = Core.createState(new Date('2026-11-16T12:00:00Z'));
  state.employees = [{id:'test-shift',name:'Тестовый повар',phone:'',department:state.departments[0].id}, {id:'test-salary',name:'Тестовый помощник',phone:'',department:state.departments[0].id}];
  state.selectedWeek = '2026-11-16';
  state.weeks = {'2026-11-16': {'test-shift':['day','','','','','',''], 'test-salary':['','day','','','','','']}};
  return Core.validateState(state);
}
function storageFixture() {
  const book = Monthly.createBook('2026-11');
  book.people = {'test-shift':{type:'shift',rate:1200}, 'test-salary':{type:'salary',rate:41000}};
  return new Map([[WEEKLY, JSON.stringify(fixture())], [MONTHLY, JSON.stringify(book)]]);
}
function harness(t, shared = storageFixture()) {
  const errors = [], downloads = [], shares = [], requests = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(fs.readFileSync(path.join(site,'index.html'),'utf8'), {url:'https://lesnoy.example/kitchen/', runScripts:'outside-only', pretendToBeVisual:true, virtualConsole:vc});
  const w = dom.window;
  let failWrites = false;
  Object.defineProperty(w, 'localStorage', {value:{getItem:key=>shared.get(key) ?? null, setItem(key,value) { if(typeof failWrites==='function' ? failWrites(key,value) : failWrites) throw new Error('QuotaExceededError'); shared.set(key,String(value)); }, removeItem:key=>shared.delete(key)}});
  w.TextDecoder = globalThis.TextDecoder;
  w.confirm = () => true;
  w.alert = () => {};
  w.fetch = (...args) => { requests.push(args); throw new Error('Unexpected network request'); };
  w.HTMLDialogElement.prototype.showModal = function(){ this.setAttribute('open',''); };
  w.HTMLDialogElement.prototype.close = function(){ this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')); };
  w.HTMLElement.prototype.scrollIntoView = function(){};
  w.URL.createObjectURL = blob => {downloads.push(blob); return 'blob:test-'+downloads.length;};
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function(){};
  Object.defineProperty(w.navigator,'canShare',{configurable:true,value:()=>true});
  Object.defineProperty(w.navigator,'share',{configurable:true,value:async payload=>shares.push(payload)});
  const native = new WeakMap();
  function backing(el) { if(!native.has(el)) native.set(el,canvas.createCanvas(el.width,el.height)); const c=native.get(el); if(c.width!==el.width)c.width=el.width;if(c.height!==el.height)c.height=el.height;return c; }
  for (const dimension of ['width','height']) {
    const descriptor=Object.getOwnPropertyDescriptor(w.HTMLCanvasElement.prototype,dimension);
    Object.defineProperty(w.HTMLCanvasElement.prototype,dimension,{...descriptor,set(value){descriptor.set.call(this,value);if(native.has(this))native.get(this)[dimension]=descriptor.get.call(this);}});
  }
  w.HTMLCanvasElement.prototype.getContext = function(kind){ return backing(this).getContext(kind); };
  w.HTMLCanvasElement.prototype.toBlob = function(callback,type='image/png'){ callback(new w.Blob([backing(this).toBuffer(type)],{type})); };
  w.HTMLCanvasElement.prototype.toDataURL = function(type='image/png'){return backing(this).toDataURL(type);};
  for(const id of ['table-scroll','ts-body']) {
    const el=w.document.getElementById(id); if(!el)continue;
    Object.defineProperties(el,{clientWidth:{get:()=>360},clientHeight:{get:()=>460}});
    el.getBoundingClientRect=()=>({left:0,top:0,right:360,bottom:460,width:360,height:460});
    el.setPointerCapture=()=>{};el.releasePointerCapture=()=>{};
  }
  w.addEventListener('error',event=>errors.push(event.error?.message || event.message));
  for(const file of ['core.js','png.js','viewport.js','app.js','timesheet-core.js','timesheet-io.js','timesheet-viewport.js','timesheet.js']) w.eval(fs.readFileSync(path.join(site,file),'utf8')+'\n//# sourceURL='+file);
  t.after(()=>{w.close();assert.deepEqual(errors,[],'No uncaught DOM errors');assert.deepEqual(requests,[],'Monthly editing works offline');});
  const q=selector=>{const el=w.document.querySelector(selector);assert.ok(el,'Expected DOM element '+selector);return el;};
  const click=selector=>q(selector).click();
  const submit=(selector,fields)=>{const form=q(selector);for(const [name,value] of Object.entries(fields)){const el=form.elements.namedItem(name);assert.ok(el,'Expected field '+name);if(el.type==='checkbox')el.checked=value;else el.value=value;}form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));};
  const month=value=>{q('#ts-month').value=value;q('#ts-month').dispatchEvent(new w.Event('change',{bubbles:true}));};
  const read=()=>JSON.parse(JSON.stringify(w.LesnoyTimesheet.getBook()));
  const cell=(id,date)=>`[data-ts-person="${id}"][data-date="${date}"]`;
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  click('#ts-open'); month('2026-11');
  return {w,q,click,submit,month,read,cell,tick,shared,downloads,shares,setFailWrites:value=>{failWrites=value;}};
}

test('monthly navigation and edits preserve the exact saved weekly schedule', t=>{
  const shared=storageFixture(), original=shared.get(WEEKLY), h=harness(t,shared);
  assert.equal(h.q('#schedule-panel').hidden,true);
  h.click('[data-ts-brush="0.5"]');h.click(h.cell('test-shift','2026-11-03'));
  assert.equal(h.read().days['test-shift']['2026-11-03'].value,.5);
  const table=h.q('#ts-table');h.click('#ts-next');assert.equal(h.q('#ts-month').value,'2026-12');assert.equal(h.q('#ts-table'),table,'Navigation preserves the table element');
  h.click('#ts-prev');h.click('#ts-back');assert.equal(h.q('#schedule-panel').hidden,false);
  assert.equal(shared.get(WEEKLY),original,'Monthly actions must not rewrite weekly storage');
});

test('fractional confirmed shifts, draft cells, fixed salary, manual pay and undo use real calculations', t=>{
  const h=harness(t);
  h.q('#ts-brush-confirmed').checked=true;
  h.click('[data-ts-brush="0.5"]');h.click(h.cell('test-shift','2026-11-03'));
  h.click('[data-ts-brush="1.5"]');h.click(h.cell('test-shift','2026-11-04'));
  h.q('#ts-brush-confirmed').checked=false;
  h.click('[data-ts-brush="1"]');h.click(h.cell('test-shift','2026-11-05'));
  let sum=Monthly.totals(h.read(),'test-shift','2026-11');
  assert.equal(sum.shifts,2);assert.equal(sum.draftShifts,1);assert.equal(sum.amount,2400);
  assert.equal(Monthly.totals(h.read(),'test-salary','2026-11').amount,41000);
  h.click(h.cell('test-shift','2026-11-03'));h.submit('#ts-cell-form',{value:'1.5',confirmed:true,note:'Тестовая корректировка'});
  assert.equal(Monthly.totals(h.read(),'test-shift','2026-11').amount,3600);
  h.click('#ts-undo');assert.equal(h.read().days['test-shift']['2026-11-03'].value,.5);
  h.click('[data-pay="test-shift"]');h.submit('#ts-pay-form',{amount:'1777.25'});
  assert.equal(Monthly.totals(h.read(),'test-shift','2026-11').amount,1777.25);
  h.click('[data-pay="test-shift"]');h.submit('#ts-pay-form',{amount:''});
  assert.equal(Monthly.totals(h.read(),'test-shift','2026-11').amount,2400);
});

test('weekly import creates drafts once and preserves a confirmed correction', t=>{
  const h=harness(t), original=h.shared.get(WEEKLY);
  h.click('#ts-import-week');
  assert.equal(h.read().days['test-shift']['2026-11-16'].confirmed,false);
  h.click(h.cell('test-shift','2026-11-16'));h.submit('#ts-cell-form',{value:'1.5',confirmed:true,note:'Тестовая фактическая смена'});
  h.click('#ts-import-week');
  assert.deepEqual(h.read().days['test-shift']['2026-11-16'],{value:1.5,confirmed:true,note:'Тестовая фактическая смена'});
  assert.equal(h.shared.get(WEEKLY),original);
});

test('month-specific profiles survive navigation and reload without altering earlier payroll', t=>{
  const h=harness(t);
  h.q('#ts-brush-confirmed').checked=true;h.click('[data-ts-brush="1"]');h.click(h.cell('test-shift','2026-11-03'));
  h.month('2026-12');h.click('[data-rate="test-shift"]');h.submit('#ts-person-form',{name:'Тестовый повар',role:'Повар',type:'shift',rate:'1500'});
  h.q('#ts-brush-confirmed').checked=true;h.click('[data-ts-brush="1"]');h.click(h.cell('test-shift','2026-12-03'));
  assert.equal(Monthly.totals(h.read(),'test-shift','2026-12').amount,1500);
  assert.equal(Monthly.totals(h.read(),'test-shift','2026-11').amount,1200);
  const reloaded=harness(t,h.shared);reloaded.month('2026-12');
  assert.equal(Monthly.totals(reloaded.read(),'test-shift','2026-12').amount,1500);
  assert.equal(Monthly.totals(reloaded.read(),'test-shift','2026-11').amount,1200);
});

function realm(h,value) {return h.w.JSON.parse(JSON.stringify(value));}
function bytes(h,blob) {return new Promise((resolve,reject)=>{const reader=new h.w.FileReader();reader.onload=()=>resolve(Buffer.from(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsArrayBuffer(blob);});}

test('malformed restore and duplicate roster IDs leave both stores and the visible book unchanged', async t=>{
  const h=harness(t), book=h.read(), stores=new Map(h.shared);
  const malformed={...book,days:{'test-shift':{'2026-11-03':{value:9,confirmed:true,note:''}}}};
  assert.throws(()=>h.w.LesnoyTimesheet.importData(realm(h,malformed),{skipConfirm:true}));
  const duplicate={...book,roster:[{id:'duplicate',name:'Первый тест',role:''},{id:'duplicate',name:'Второй тест',role:''}]};
  assert.throws(()=>h.w.LesnoyTimesheet.importData(realm(h,duplicate),{skipConfirm:true}));
  await h.w.LesnoyTimesheet.importFile({name:'broken.json',size:8,text:async()=>'{broken'});
  assert.deepEqual(h.read(),book);assert.deepEqual(h.shared,stores);
});

test('combined restore rolls back both stores on partial failure and then restores both on success', t=>{
  const h=harness(t), before=h.read(), stores=new Map(h.shared), incoming=h.read(), schedule=fixture();
  incoming.days['test-shift']={'2026-11-09':{value:1.5,confirmed:true,note:'Из тестовой копии'}};
  schedule.employees[0].name='Другой тестовый повар';
  const combined=realm(h,{type:'lesnoy-combined-backup',version:1,timesheet:incoming,schedule});
  let failed=false;h.setFailWrites(key=>{if(key===WEEKLY&&!failed){failed=true;return true;}return false;});
  assert.throws(()=>h.w.LesnoyTimesheet.importData(combined,{skipConfirm:true,noReload:true}));
  assert.deepEqual(h.shared,stores,'A failed second store write rolls back the first');assert.deepEqual(h.read(),before);
  h.setFailWrites(false);
  assert.equal(h.w.LesnoyTimesheet.importData(combined,{skipConfirm:true,noReload:true}),true);
  assert.equal(JSON.parse(h.shared.get(WEEKLY)).employees[0].name,'Другой тестовый повар');
  assert.equal(h.read().days['test-shift']['2026-11-09'].value,1.5);
});

test('storage failure retains edits in memory and full JSON exports those unsaved edits', async t=>{
  const h=harness(t), saved=h.shared.get(MONTHLY), weekly=h.shared.get(WEEKLY);
  h.setFailWrites(true);h.click('[data-ts-brush="1.5"]');h.click(h.cell('test-shift','2026-11-06'));
  assert.equal(h.read().days['test-shift']['2026-11-06'].value,1.5);
  assert.equal(h.shared.get(MONTHLY),saved);assert.match(h.q('#ts-status').textContent,/Не сохранено/);
  h.click('#ts-backup');const exported=JSON.parse((await bytes(h,h.downloads.at(-1))).toString('utf8'));
  assert.equal(exported.type,'lesnoy-combined-backup');assert.equal(exported.timesheet.days['test-shift']['2026-11-06'].value,1.5);
  assert.deepEqual(exported.schedule,JSON.parse(weekly));assert.equal(h.shared.get(WEEKLY),weekly);
  h.setFailWrites(false);h.click('#ts-retry-save');assert.equal(JSON.parse(h.shared.get(MONTHLY)).days['test-shift']['2026-11-06'].value,1.5);
});

test('PNG preview renders a real full-month image and shares only the image file', async t=>{
  const h=harness(t);h.click('#ts-png');await h.tick();
  assert.equal(h.q('#ts-png-preview').hidden,false,h.q('#ts-png-status').textContent);
  const blob=h.downloads.at(-1), png=await bytes(h,blob);
  assert.equal(blob.type,'image/png');assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  const image=await canvas.loadImage(png);assert.ok(image.width>1000);assert.ok(image.height>100);
  h.click('#ts-png-share');await h.tick();assert.equal(h.shares.length,1);
  assert.deepEqual(Object.keys(h.shares[0]),['files'],'Native share must not add text or a URL');
  assert.equal(h.shares[0].files.length,1);assert.equal(h.shares[0].files[0].type,'image/png');
  assert.deepEqual(await bytes(h,h.shares[0].files[0]),png);
});


test('weekly sync button transfers only the displayed week without changing weekly data',t=>{
 const shared=storageFixture(),state=JSON.parse(shared.get(WEEKLY));
 state.weeks['2026-11-09']={'test-shift':['day','day','day','day','day','day','day']};
 shared.set(WEEKLY,JSON.stringify(state));const h=harness(t,shared),before=shared.get(WEEKLY);
 h.click('#ts-back');h.click('#sync-timesheet');
 assert.equal(h.q('#schedule-panel').hidden,false);
 assert.equal(h.read().days['test-shift']['2026-11-16'].value,1);
 assert.equal(h.read().days['test-shift']['2026-11-16'].confirmed,false);
 assert.equal(h.read().days['test-shift']['2026-11-09'],undefined);
 assert.equal(Monthly.totals(h.read(),'test-shift','2026-11').amount,0);
 const saved=shared.get(MONTHLY);h.click('#sync-timesheet');assert.equal(shared.get(MONTHLY),saved);
 assert.equal(shared.get(WEEKLY),before);
});

test('startup merges an imported zero-rate typo duplicate and persists its archive and weekly link',t=>{
 const state=fixture();state.employees[0].name='Тестовсский Алексей';
 const b=Monthly.createBook('2026-11');b.roster=[{id:'excel_1',name:'Тестовский Алексей',role:'Повар'}];
 b.profiles['2026-11']={excel_1:{type:'shift',rate:1000},'test-shift':{type:'shift',rate:0}};
 b.days['test-shift']={'2026-11-17':{value:1,confirmed:false,note:'Из графика'}};
 const shared=new Map([[WEEKLY,JSON.stringify(state)],[MONTHLY,JSON.stringify(b)]]),h=harness(t,shared);
 assert.equal(h.read().aliases['test-shift'],'excel_1');assert.equal(h.read().days['test-shift'],undefined);
 assert.equal(h.read().days.excel_1['2026-11-17'].value,1);assert.ok(h.read().mergedRows['test-shift']);
 assert.equal(h.w.document.querySelector('#ts-table [data-rate="test-shift"]'),null);
 h.click('#ts-import-week');assert.equal(h.read().roster.length,2);assert.equal(h.read().roster.filter(p=>p.id==='excel_1').length,1);assert.equal(h.read().days.excel_1['2026-11-16'].value,1);
 const reloaded=harness(t,shared);assert.equal(reloaded.read().aliases['test-shift'],'excel_1');
 assert.equal(reloaded.w.document.querySelector('#ts-table [data-rate="test-shift"]'),null);
});


test('monthly background click clears selection and cannot accidentally paint a zero shift',t=>{
 const h=harness(t);h.click('[data-ts-brush="1.5"]');
 const before=h.shared.get(MONTHLY);h.q('#ts-body').dispatchEvent(new h.w.MouseEvent('click',{bubbles:true}));
 assert.equal(h.w.document.querySelector('#ts-palette [aria-pressed="true"]'),null);
 h.click(h.cell('test-shift','2026-11-20'));assert.equal(h.shared.get(MONTHLY),before);
});
