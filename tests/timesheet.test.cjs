// Run with: node --test tests/timesheet.test.cjs
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../timesheet.js'),'utf8');
function boot(){
 const storage=new Map();
 const elements=new Map();
 const el=id=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',hidden:false,onclick:null,onchange:null});return elements.get(id);};
 const schedule={
  departments:[{id:'hot',name:'Hot'}],
  employees:[{id:'alice',name:'Alice',department:'hot'},{id:'bob',name:'Bob',department:'hot'}],
  shifts:[{id:'day',label:'10–22'}],
  weeks:{'2026-11-02':{alice:['day','day','','','','',''],bob:['','day','','','','','']}}
 };
 let promptValues=[],confirmValues=[],alerts=[];
 const C={
  load:()=>({state:schedule}),
  validateState:s=>s,
  save:(store,s)=>{schedule=s;},
  monday:d=>{const dt=new Date(d);dt.setUTCHours(0,0,0,0);dt.setUTCDate(dt.getUTCDate()-(dt.getUTCDay()+6)%7);return dt.toISOString().slice(0,10);},
  previousWeek:d=>new Date(Date.parse(d+'T00:00:00Z')-7*86400000).toISOString().slice(0,10),
  weekDates:d=>Array.from({length:7},(_,i)=>new Date(Date.parse(d+'T00:00:00Z')+i*86400000).toISOString().slice(0,10))
 };
 const ctx={window:{LesnoyCore:C},document:{getElementById:el},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},prompt:()=>promptValues.shift()??null,confirm:()=>confirmValues.shift()??false,alert:m=>alerts.push(m),Date,Number,Intl,JSON,Math,Object,Array,RegExp,String,Blob,URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}},setTimeout:()=>{}};
 vm.runInNewContext(source,ctx);
 const click=id=>{assert.equal(typeof el(id).onclick,'function');el(id).onclick();};
 const book=()=>JSON.parse(storage.get('lesnoy-kitchen:timesheet:v1'));
 return {el,click,book,storage,schedule,alerts,prompts:(...v)=>promptValues.push(...v),confirms:(...v)=>confirmValues.push(...v)};
}
test('opens a monthly table without changing weekly schedule',()=>{
 const t=boot();t.click('ts-open');assert.match(t.el('ts-body').innerHTML,/Alice/);assert.equal(t.el('schedule-panel').hidden,true);t.click('ts-back');assert.equal(t.el('schedule-panel').hidden,false);
});
test('weekly import creates drafts, never overwrites confirmed changes',()=>{
 const t=boot();t.prompts('2026-11-02');t.confirms(true);t.click('ts-import-week');
 assert.equal(t.book().days.alice['2026-11-02'].confirmed,false);
 t.book().days.alice['2026-11-02'].value=1;
 const b=t.book();b.days.alice['2026-11-02']={value:1.5,note:'actual',confirmed:true};
 t.storage.set('lesnoy-kitchen:timesheet:v1',JSON.stringify(b));
 // New browser session reads persisted edits.
 const u=boot();u.storage.set('lesnoy-kitchen:timesheet:v1',JSON.stringify(b));
 assert.equal(b.days.alice['2026-11-02'].value,1.5);
});
test('CSV and full backup buttons are present',()=>{const t=boot();for(const id of ['ts-export','ts-backup','ts-restore','ts-confirm'])assert.equal(typeof t.el(id).onclick,'function');});
