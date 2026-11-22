'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const file=require('./site-path.cjs'),C=require(file('core.js')),T=require(file('timesheet-core.js')),IO=require(file('timesheet-io.js'));
const native=require('@napi-rs/canvas'),crc32=require('node:zlib').crc32;
function chunks(bytes){const list=[];for(let at=8;at+12<=bytes.length;){const n=bytes.readUInt32BE(at),end=at+n+12;assert.ok(end<=bytes.length);const type=bytes.toString('ascii',at+4,at+8),data=bytes.subarray(at+8,at+8+n);assert.equal(crc32(bytes.subarray(at+4,at+8+n)),bytes.readUInt32BE(at+8+n),type+' CRC');list.push({type,data});at=end;}return list;}
function dpi(bytes){const p=chunks(bytes).filter(c=>c.type==='pHYs');assert.equal(p.length,1);assert.equal(p[0].data.readUInt32BE(0),15748);assert.equal(p[0].data.readUInt32BE(4),15748);assert.equal(p[0].data[8],1);}
function weekly(){const scales=[];const document={createElement(){const c=native.createCanvas(1,1),ctx=c.getContext('2d');const draw=ctx.fillText.bind(ctx);ctx.fillText=(...args)=>{scales.push(ctx.getTransform().a);draw(...args);};c.toBlob=fn=>fn(new Blob([c.toBuffer('image/png')],{type:'image/png'}));return c;}};const window={document,LesnoyCore:C};vm.runInNewContext(fs.readFileSync(file('png.js'),'utf8'),{window,document,Blob,console});return{api:window.LesnoyPNG,scales};}
function roster(n=12){const s=C.createState('2026-11-16');s.employees=Array.from({length:n},(_,i)=>({id:'test_'+i,name:'Тестовый повар '+i,phone:'ТЕСТ',department:s.departments[i%3].id}));s.weeks[s.selectedWeek]=Object.fromEntries(s.employees.map(p=>[p.id,['day','midday','','','midday','day','']]));return s;}

test('A4 weekly PNG renders text at doubled pixel resolution and embeds valid physical density',async()=>{
 const h=weekly(),s=roster(),before=JSON.stringify(s),standard=await h.api.render(s,s.selectedWeek);h.scales.length=0;
 const print=await h.api.render(s,s.selectedWeek,{printQuality:true}),bytes=Buffer.from(await print.blob.arrayBuffer());
 assert.equal(standard.width,2400);assert.equal(print.width,4800);assert.equal(print.height,standard.height*2);assert.ok(h.scales.every(x=>x===4));
 assert.match(print.filename,/-a4\.png$/);dpi(bytes);const decoded=await native.loadImage(bytes);assert.equal(decoded.width,print.width);assert.equal(decoded.height,print.height);assert.equal(JSON.stringify(s),before);
});

test('DPI metadata is replaced once without changing encoded image pixels',async()=>{
 const h=weekly(),s=roster(1),normal=await h.api.render(s,s.selectedWeek),raw=Buffer.from(await normal.blob.arrayBuffer());
 const once=await h.api.withDpi(normal.blob,400),twice=await h.api.withDpi(once,400),out=Buffer.from(await twice.arrayBuffer());dpi(out);
 const imageData=b=>Buffer.concat(chunks(b).filter(c=>c.type==='IDAT').map(c=>c.data));assert.deepEqual(imageData(out),imageData(raw));
 assert.deepEqual(chunks(out).find(c=>c.type==='IHDR').data,chunks(raw).find(c=>c.type==='IHDR').data);
});

test('A4 monthly PNG has higher resolution and valid density while payroll and normal PNG stay unchanged',async()=>{
 const b=T.createBook('2026-11');b.roster=[{id:'demo',name:'Тестовый повар',role:'Повар'}];b.people.demo={type:'shift',rate:1000};b.days.demo={'2026-11-16':{value:1.5,confirmed:true,note:''}};
 const before=JSON.stringify(b),normal=await IO.exportPNG(b,null,'2026-11'),print=await IO.exportPNG(b,null,'2026-11',{printQuality:true}),bytes=Buffer.from(await print.blob.arrayBuffer());
 assert.equal(print.width,normal.width*2);assert.ok(print.width*print.height<=15000000);assert.match(print.filename,/-a4\.png$/);dpi(bytes);assert.equal((await native.loadImage(bytes)).width,print.width);assert.equal(JSON.stringify(b),before);assert.equal(T.totals(b,'demo','2026-11').amount,1500);
});

test('high quality mode respects the mobile canvas budget even with 200 staff',async()=>{
 const h=weekly(),s=roster(200),print=await h.api.render(s,s.selectedWeek,{printQuality:true});assert.ok(print.width*print.height<=15000000);assert.ok(print.height<=16000);dpi(Buffer.from(await print.blob.arrayBuffer()));
});
