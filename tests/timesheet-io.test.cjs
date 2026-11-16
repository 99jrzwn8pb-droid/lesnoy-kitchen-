'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const C=require(require('./site-path.cjs')('timesheet-core.js'));
const IO=require(require('./site-path.cjs')('timesheet-io.js'));
const ExcelJS=require(require('./site-path.cjs')('vendor/exceljs-4.4.0.min.js'));
let nativeCanvas;
try{nativeCanvas=require('@napi-rs/canvas');}catch{nativeCanvas=require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');}
const schedule={employees:[{id:'weekly',name:'Weekly Test',department:'kitchen'}],departments:[{id:'kitchen'}]};
function fixture(month='2026-11'){
 const b=C.createBook(month);
 b.roster=[{id:'fraction',name:'Fraction Test',role:'Cook'},{id:'salary',name:'Salary Test',role:'Manager'},{id:'manual',name:'Override Test',role:'Cook'}];
 b.people={fraction:{type:'shift',rate:100.01},salary:{type:'salary',rate:4000},manual:{type:'shift',rate:200}};
 b.days.fraction={[month+'-01']:{value:1.5,confirmed:true,note:'A test note'},[month+'-02']:{value:1,confirmed:false,note:'Needs checking'},[month+'-03']:{value:0,confirmed:true,note:''}};
 b.days.manual={[month+'-01']:{value:1,confirmed:true,note:''}};
 b.overrides.manual={[month]:275.25};
 return b;
}
async function bytes(result){return new Uint8Array(await result.blob.arrayBuffer());}
async function workbook(result){const wb=new ExcelJS.Workbook();await wb.xlsx.load(await bytes(result));return wb;}
async function makeWorkbook({month='2026-11',rows=[['Person Test','Cook',1.5,100,{formula:'AH3*AG3',result:150}]],formula,headerRow=2}={}){
 const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Data'),n=C.dayCount(month),tc=n+3;
 ws.getCell(headerRow,1).value='ЛЕСНОЙ';ws.getCell(headerRow,2).value='Должность';for(let i=1;i<=n;i++)ws.getCell(headerRow,i+2).value=i;
 ws.getCell(headerRow,tc).value='Отработано смен';ws.getCell(headerRow,tc+1).value='Ставка';ws.getCell(headerRow,tc+2).value='Выплаты';
 for(let i=0;i<rows.length;i++){const r=headerRow+1+i,x=rows[i];ws.getCell(r,1).value=x[0];ws.getCell(r,2).value=x[1];ws.getCell(r,3).value=formula||x[2];ws.getCell(r,tc).value={formula:'SUM(C'+r+':'+String.fromCharCode(64+Math.min(n+2,26))+r+')',result:x[2]};ws.getCell(r,tc+1).value=x[3];ws.getCell(r,tc+2).value=x[4];}
 return {wb,ws,buffer:await wb.xlsx.writeBuffer()};
}

test('real XLSX preserves confirmed fractions, drafts, fixed salary, overrides and cached formulas',async()=>{
 const book=fixture(),before=JSON.stringify(book),scheduleBefore=JSON.stringify(schedule);
 const result=await IO.exportExcel(book,schedule,'2026-11'),raw=await bytes(result);
 assert.equal(raw[0],80);assert.equal(raw[1],75);assert.match(result.filename,/2026-11\.xlsx$/);
 const wb=await workbook(result),ws=wb.worksheets[0];
 assert.equal(ws.getCell('AG3').formula,'SUM(C3:AF3)-SUM(D3)');assert.equal(ws.getCell('AG3').result,1.5);
 assert.equal(ws.getCell('AI3').formula,'ROUND(AH3*AG3,2)');assert.equal(ws.getCell('AI3').result,150.02);
 assert.equal(ws.getCell('AI4').value,4000);assert.equal(ws.getCell('AI5').value,275.25);
 assert.equal(ws.getCell('C3').font.name,'Times New Roman');assert.equal(ws.getCell('C3').font.size,11);
 assert.equal(ws.getCell('C2').fill.fgColor.argb,'FFD9D9D9');assert.equal(ws.views[0].xSplit,2);assert.equal(ws.views[0].ySplit,2);assert.equal(ws.pageSetup.orientation,'landscape');
 assert.equal(ws.getCell('A2').value,'LESNOY');assert.equal(ws.getCell('A1').value,'ноябрь 2026');assert.equal(ws.getCell('AG1').value,'Табель кухни');
 assert.equal(ws.getCell('B1').master.address,'A1');assert.equal(ws.getCell('AI1').master.address,'AG1');assert.equal(ws.getRow(3).height,22);
 assert.equal(ws.getCell('A6').value,null,'weekly-only employees without monthly data stay outside the authoritative monthly roster');
 const imported=await IO.importExcel(raw,result.filename,C.createBook('2026-11'),{employees:[]});
 assert.equal(imported.payrollMatches,true);assert.equal(imported.sourceCount,3);
 const [fraction,salary,manual]=imported.book.roster;
 assert.deepEqual(imported.book.days[fraction.id],book.days.fraction);
 assert.equal(C.totals(imported.book,fraction.id,'2026-11').amount,150.02);
 assert.equal(C.profile(imported.book,salary.id,'2026-11').type,'salary');
 assert.equal(imported.book.overrides[manual.id]['2026-11'],275.25);
 assert.equal(JSON.stringify(book),before);assert.equal(JSON.stringify(schedule),scheduleBefore);
});

test('reimport is authoritative for affected month only; preserves defaults, IDs and other people',async()=>{
 const book=fixture();book.days.fraction['2026-10-01']={value:2,confirmed:true,note:'Earlier'};book.days.fraction['2026-11-30']={value:3,confirmed:true,note:'Remove'};
 book.roster.push({id:'untouched',name:'Untouched Test',role:'Other'});book.days.untouched={'2026-11-01':{value:1,confirmed:true,note:''}};
 const file=await IO.exportExcel(fixture(),{employees:[]},'2026-11');
 const result=await IO.importExcel(await bytes(file),file.filename,book,schedule);
 assert.equal(result.book.roster.find(p=>p.name==='Fraction Test').id,'fraction');
 assert.equal(result.book.days.fraction['2026-11-30'],undefined);assert.equal(result.book.days.fraction['2026-10-01'].value,2);
 assert.deepEqual(result.book.days.untouched,book.days.untouched);assert.deepEqual(result.book.people,book.people);
 const again=await IO.importExcel(await bytes(file),file.filename,result.book,schedule);
 assert.equal(again.book.roster.length,result.book.roster.length);assert.deepEqual(again.book.days,result.book.days);
});

test('literal salary follows numeric pay semantics, independent of role; zero and fractions survive',async()=>{
 const file=await makeWorkbook({rows:[['Monthly Test','Cook',0,3000,3000],['Shift Test','Manager',1.5,100,{formula:'AH4*AG4',result:150}],['Manual Test','Cook',1,100,123]]});
 const imported=await IO.importExcel(file.buffer,'Кухня-Ноябрь-2026.xlsx',C.createBook('2026-11'),{employees:[]});
 const [a,b,c]=imported.book.roster;
 assert.equal(C.profile(imported.book,a.id,imported.month).type,'salary');assert.equal(C.profile(imported.book,b.id,imported.month).type,'shift');
 assert.equal(C.totals(imported.book,b.id,imported.month).shifts,1.5);assert.equal(C.totals(imported.book,a.id,imported.month).amount,3000);assert.equal(imported.book.overrides[c.id][imported.month],123);
 assert.equal(imported.book.days[a.id]['2026-11-01'].confirmed,true);
});

test('month detection requires evidence, explicit selection resolves ambiguity, calendar length is checked',async()=>{
 const file=await IO.exportExcel(fixture(),{employees:[]},'2026-11'),raw=await bytes(file);
 await assert.rejects(IO.importExcel(raw,'table.xlsx',null,null),e=>e.code==='MONTH_REQUIRED');
 await assert.rejects(IO.importExcel(raw,'table.xlsx',null,null,{month:'2026-02'}),/Количество дней/);
 const selected=await IO.importExcel(raw,'2026-10 and 2026-11.xlsx',null,null,{month:'2026-11'});assert.equal(selected.month,'2026-11');assert.equal(selected.warnings.length,1);
 const december=await IO.exportExcel(fixture('2026-12'),null,'2026-12');const detected=await IO.importExcel(await bytes(december),'12-2026.xlsx',null,null);assert.equal(detected.month,'2026-12');
});

test('header can move; repeated bottom date labels and unrelated numeric cells are ignored',async()=>{
 const f=await makeWorkbook({headerRow:4,rows:[['Moved Test','Cook',1,100,100]]});
 for(let c=1;c<=35;c++)f.ws.getCell(7,c).value=f.ws.getCell(4,c).value;
 f.ws.getCell(9,6).value=12345;f.ws.getCell(9,34).value='ФОТ';f.ws.getCell(9,35).value={formula:'SUM(AI5:AI6)',result:100};
 const x=await IO.importExcel(await f.wb.xlsx.writeBuffer(),'2026-11.xlsx',null,null);assert.equal(x.sourceCount,1);assert.equal(x.payrollMatches,true);
});

test('unlabeled pay-column footer SUM is verified, including missing rows and stale numeric cache',async()=>{
 const f=await makeWorkbook({rows:[['First Test','Cook',1,100,100],['Second Test','Cook',1,200,200]]});
 f.ws.getCell('AI7').value={formula:'SUM(AI3:AI4)',result:300};f.ws.getCell('AI22').value=123456;
 let x=await IO.importExcel(await f.wb.xlsx.writeBuffer(),'2026-11.xlsx',null,null);assert.equal(x.payrollMatches,true);assert.equal(x.warnings.length,0);
 f.ws.getCell('AI7').value={formula:'SUM(AI3:AI3)',result:100};
 x=await IO.importExcel(await f.wb.xlsx.writeBuffer(),'2026-11.xlsx',null,null);assert.equal(x.payrollMatches,false);assert.ok(x.warnings.some(s=>s.includes('ФОТ')));
 f.ws.getCell('AI7').value={formula:'SUM(AI3:AI4)',result:999};
 x=await IO.importExcel(await f.wb.xlsx.writeBuffer(),'2026-11.xlsx',null,null);assert.equal(x.payrollMatches,false);assert.ok(x.warnings.some(s=>s.includes('ФОТ')));
});

test('exports valid leap-February and 30-day calendars without adding nonexistent days',async()=>{
 for(const [month,count] of [['2028-02',29],['2026-04',30]]){
  const file=await IO.exportExcel(fixture(month),null,month),wb=await workbook(file),ws=wb.worksheets[0];
  assert.equal(ws.getCell(2,count+2).value,count);assert.equal(ws.getCell(2,count+3).value,'Отработано смен');
  const x=await IO.importExcel(await bytes(file),file.filename,null,null);assert.equal(x.month,month);assert.equal(x.payrollMatches,true);
 }
});

test('duplicates are rejected atomically in source and existing combined roster',async()=>{
 const file=await IO.exportExcel(fixture(),null,'2026-11'),raw=await bytes(file),book=fixture();
 const before=JSON.stringify(book);
 await assert.rejects(IO.importExcel(raw,file.filename,book,{employees:[{id:'other',name:' fraction   test ',role:''}]}),/несколькими/);
 assert.equal(JSON.stringify(book),before);
 const wb=await workbook(file),ws=wb.worksheets[0];ws.getCell('A4').value='FRACTION TEST';await assert.rejects(IO.importExcel(await wb.xlsx.writeBuffer(),file.filename,book,null),/повторяется имя/);
});

test('unsupported formulas, Excel errors, huge files and inflated ZIP parts are rejected',async()=>{
 for(const value of [{formula:'INDIRECT("A1")',result:1},{error:'#VALUE!'}]){const f=await makeWorkbook({formula:value});await assert.rejects(IO.importExcel(f.buffer,'2026-11.xlsx',null,null),/формул|Ошибка Excel/);}
 await assert.rejects(IO.importExcel(new Uint8Array(10*1024*1024+1),'2026-11.xlsx',null,null),/10 МБ/);
 const f=await IO.exportExcel(fixture(),null,'2026-11'),raw=await bytes(f);const v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);let central=-1;for(let i=0;i<raw.length-4;i++)if(v.getUint32(i,true)===0x02014b50){central=i;break;}assert.ok(central>=0);v.setUint32(central+24,40*1024*1024,true);await assert.rejects(IO.importExcel(raw,f.filename,null,null),/слишком большой/);
});

test('profile import for historical month leaves default and later rates intact',async()=>{
 const book=fixture();book.profiles['2026-12']={fraction:{type:'shift',rate:888}};book.people.fraction.rate=777;
 const file=await IO.exportExcel(fixture(),null,'2026-11'),x=await IO.importExcel(await bytes(file),file.filename,book,null);
 assert.equal(x.book.people.fraction.rate,777);assert.equal(C.profile(x.book,'fraction','2026-12').rate,888);assert.equal(C.profile(x.book,'fraction','2026-11').rate,100.01);
});

test('native PNG exports all monthly people, wraps labels, includes drafts and respects canvas budget',async()=>{
 const b=fixture(),texts=[];b.roster[0].name='A very long employee test name that must wrap across multiple lines';
 for(let i=0;i<197;i++)b.roster.push({id:'extra_'+i,name:'Employee Test '+i,role:'Kitchen assistant'});
 const document={fonts:{ready:Promise.resolve()},createElement(tag){assert.equal(tag,'canvas');const canvas=nativeCanvas.createCanvas(1,1),ctx=canvas.getContext('2d');canvas.getContext=()=>new Proxy(ctx,{get(t,k){if(k==='fillText')return(v,...args)=>{texts.push(String(v));return t.fillText(v,...args);};const x=t[k];return typeof x==='function'?x.bind(t):x;},set(t,k,v){t[k]=v;return true;}});return canvas;}};
 const sandbox={window:{document,LesnoyTimesheetCore:C,ExcelJS},document,Blob};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(require('./site-path.cjs')('timesheet-io.js'),'utf8'),sandbox);
 const before=JSON.stringify(b),result=await sandbox.window.LesnoyTimesheetIO.exportPNG(b,null,'2026-11');
 assert.equal(JSON.stringify(b),before);assert.equal(result.blob.type,'image/png');const image=await nativeCanvas.loadImage(Buffer.from(await result.blob.arrayBuffer()));assert.equal(image.width,result.width);assert.equal(image.height,result.height);
 assert.ok(result.width*result.height<=15000000);assert.ok(result.width<=16000&&result.height<=16000);assert.ok(texts.includes('Employee Test 196'));assert.ok(texts.includes('1*'));assert.ok(texts.some(x=>x.includes('черновик')));assert.ok(texts.includes('ФОТ'));assert.ok(texts.includes('Выплаты'));assert.ok(texts.includes('Отработано'));assert.ok(texts.includes('смен'));
 const empty=await IO.exportPNG(C.createBook('2026-02'),null,'2026-02');assert.ok(empty.blob.size>1000);
});

// Editing a previously empty day in Excel must participate in the formula.
test('Excel formulas include newly filled day cells and still exclude exported drafts',async()=>{
 const result=await IO.exportExcel(fixture(),{employees:[]},'2026-11');
 const wb=await workbook(result),ws=wb.worksheets[0];
 ws.getCell('F3').value=.5;
 const imported=await IO.importExcel(await wb.xlsx.writeBuffer(),result.filename,null,null);
 const p=imported.book.roster.find(p=>p.name==='Fraction Test');
 assert.equal(C.totals(imported.book,p.id,'2026-11').shifts,2);
 assert.equal(C.totals(imported.book,p.id,'2026-11').amount,200.02);
 assert.equal(imported.book.days[p.id]['2026-11-02'].confirmed,false);
 assert.equal(imported.book.overrides[p.id]?.['2026-11'],undefined);
});
