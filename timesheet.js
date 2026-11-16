/* Табель: отдельные локальные данные, не меняет график. */
(() => {
'use strict';
const C=window.LesnoyCore, KEY='lesnoy-kitchen:timesheet:v1';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=new Date(), monthNow=()=>today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0');
let month=monthNow(), book={version:1,people:{},days:{},confirmed:{},overrides:{}};
try {const raw=localStorage.getItem(KEY);if(raw) book=validate(JSON.parse(raw));}catch(e){alert('Не удалось прочитать табель: '+e.message+'\nДанные не перезаписаны.');return;}
function validate(b){
 if(!b||b.version!==1||!['people','days','confirmed','overrides'].every(k=>b[k]&&typeof b[k]==='object'&&!Array.isArray(b[k])))throw Error('Неверный формат табеля');
 return b;
}
function save(){try{localStorage.setItem(KEY,JSON.stringify(book));render();}catch(e){alert('Не удалось сохранить табель: '+e.message);}}
function state(){return C.load(localStorage).state;}
function employees(){const s=state();return s.departments.flatMap(d=>s.employees.filter(p=>p.department===d.id));}
function dayCount(m){const [y,mo]=m.split('-').map(Number);return new Date(Date.UTC(y,mo,0)).getUTCDate();}
function dateOf(m,d){return m+'-'+String(d).padStart(2,'0');}
function num(v){return Number.isFinite(Number(v))?Number(v):0;}
function money(n){return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(n)+' ₽';}
function profile(id){return book.people[id]||{type:'shift',rate:0};}
function cell(id,date){return book.days[id]?.[date];}
function paid(id,m){let total=0;for(let d=1;d<=dayCount(m);d++){const x=cell(id,dateOf(m,d));if(x?.confirmed)total+=num(x.value);}return total;}
function amount(id,m){const p=profile(id),override=book.overrides[id]?.[m];return override!==undefined?num(override):p.type==='salary'?num(p.rate):paid(id,m)*num(p.rate);}
function render(){
 const list=employees(), days=dayCount(month), headings=Array.from({length:days},(_,i)=>'<th>'+String(i+1)+'</th>').join('');
 $('ts-month').value=month;
 $('ts-body').innerHTML='<table class="ts-table"><thead><tr><th class="ts-name">Сотрудник</th>'+headings+'<th>Смены</th><th>Оплата</th></tr></thead><tbody>'+list.map(p=>{
 const profileData=profile(p.id),cells=Array.from({length:days},(_,i)=>{
 const date=dateOf(month,i+1),x=cell(p.id,date);
 return '<td><button class="ts-cell '+(x?.confirmed?'ts-confirmed':x?'ts-draft':'')+'" data-person="'+esc(p.id)+'" data-date="'+date+'" title="'+esc(x?.note||'Нажмите для редактирования')+'">'+(x?esc(x.value):'·')+'</button></td>';
 }).join('');
 return '<tr><th class="ts-name"><button data-rate="'+esc(p.id)+'">'+esc(p.name)+'</button><small>'+(profileData.type==='salary'?'Оклад':'За смену')+': '+money(profileData.rate)+'</small></th>'+cells+'<td>'+paid(p.id,month)+'</td><td><button data-pay="'+esc(p.id)+'">'+money(amount(p.id,month))+'</button></td></tr>';
 }).join('')+'</tbody><tfoot><tr><th>ФОТ</th><td colspan="'+days+'"></td><td></td><th>'+money(list.reduce((a,p)=>a+amount(p.id,month),0))+'</th></tr></tfoot></table>';
 $('ts-status').textContent='Подтверждённые смены учитываются в зарплате. Черновики отмечены жёлтым.';
}
function editRate(id){
 const p=employees().find(x=>x.id===id);if(!p)return;
 const prev=profile(id);
 const type=prompt('Оплата для '+p.name+': 1 — за смену, 2 — оклад',prev.type==='salary'?'2':'1');
 if(type===null)return;if(!['1','2'].includes(type))return alert('Выберите 1 или 2');
 const input=prompt('Ставка в рублях '+(type==='2'?'за месяц':'за смену'),String(prev.rate));if(input===null)return;
 const rate=Number(input.replace(',','.'));if(!Number.isFinite(rate)||rate<0||rate>10000000)return alert('Некорректная ставка');
 book.people[id]={type:type==='2'?'salary':'shift',rate};save();
}
function editCell(id,date){
 const old=cell(id,date)||{value:0,confirmed:false};
 const input=prompt(date+': количество фактических смен (0, 0.5, 1, 1.5). Пусто — удалить.',String(old.value));
 if(input===null)return;
 if(!input.trim()){if(book.days[id])delete book.days[id][date];return save();}
 const value=Number(input.replace(',','.'));if(!Number.isFinite(value)||value<0||value>3)return alert('Введите число от 0 до 3');
 const note=prompt('Примечание (замена, невыход и т. п.)',old.note||'');if(note===null)return;
 const confirmed=confirm('Подтвердить фактическую смену?\nОК — подтвердить, Отмена — оставить черновиком');
 (book.days[id] ||= {})[date]={value,note:note.slice(0,200),confirmed};save();
}
function importWeek(){
 const s=state(), week=prompt('Понедельник переносимой недели (ГГГГ-ММ-ДД). По умолчанию прошлая неделя.',C.previousWeek(C.monday(new Date())));
 if(week===null)return;
 let dates;try{dates=C.weekDates(week);}catch(e){return alert('Неверная дата понедельника: '+e.message);}
 const entries=[];let conflicts=0;
 for(const p of employees()){const row=s.weeks[week]?.[p.id]||[];dates.forEach((date,i)=>{
 const shift=s.shifts.find(x=>x.id===row[i]);if(!shift)return;
 // «Р» и смены со временем — одна смена; отпуск/больничный/выходной не оплачиваются.
 const label=shift.label.toUpperCase().trim();const value=['В','ОТ','Б','ОТП','ВЫХ'].includes(label)?0:1;
 if(cell(p.id,date)!==undefined)conflicts++;
 entries.push({id:p.id,date,value,note:'Из графика: '+shift.label});
 });}
 if(!entries.length)return alert('На выбранной неделе нет смен сотрудников');
 if(!confirm('Перенести '+entries.length+' записей из графика за '+week+'?\nСуществующие записи: '+conflicts+'. Они НЕ будут перезаписаны. Все новые записи останутся черновиками.'))return;
 let added=0;for(const x of entries){if(cell(x.id,x.date)!==undefined)continue;(book.days[x.id] ||= {})[x.date]={value:x.value,note:x.note,confirmed:false};added++;}
 month=dates[0].slice(0,7);save();alert('Добавлено '+added+' черновиков. При переходе через границу месяца записи сохранены по своим датам. Проверьте и подтвердите смены.');
}
function confirmMonth(){
 if(!confirm('Подтвердить все черновики за '+month+'? Проверьте замены и невыходы перед подтверждением.'))return;
 for(const [id,days] of Object.entries(book.days))for(const [date,x] of Object.entries(days))if(date.startsWith(month+'-'))x.confirmed=true;
 save();
}
function editPay(id){
 const p=employees().find(x=>x.id===id);if(!p)return;
 const previous=book.overrides[id]?.[month],base=amount(id,month);
 const raw=prompt('Итоговая выплата '+p.name+' за '+month+'. Пустое поле — вернуть автоматический расчёт.',String(previous??base));
 if(raw===null)return;
 if(!raw.trim()){if(book.overrides[id])delete book.overrides[id][month];return save();}
 const value=Number(raw.replace(',','.'));if(!Number.isFinite(value)||value<0||value>10000000)return alert('Неверная сумма');
 (book.overrides[id] ||= {})[month]=value;save();
}
function download(name,data,type){
 const blob=new Blob([data],{type});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
function exportCSV(){
 const list=employees(),n=dayCount(month);
 const rows=[['Сотрудник',...Array.from({length:n},(_,i)=>i+1),'Смены','Тип оплаты','Ставка','Выплата']];
 for(const p of list){const r=profile(p.id);rows.push([p.name,...Array.from({length:n},(_,i)=>{const x=cell(p.id,dateOf(month,i+1));return x?.confirmed?x.value:'';}),paid(p.id,month),r.type==='salary'?'Оклад':'За смену',r.rate,amount(p.id,month)]);}
 rows.push(['ФОТ',...Array(n+3).fill(''),list.reduce((a,p)=>a+amount(p.id,month),0)]);
 download('Лесной-табель-'+month+'.csv','\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(';')).join('\r\n'),'text/csv;charset=utf-8');
}
function backup(){const full={type:'lesnoy-combined-backup',version:1,schedule:state(),timesheet:book};download('Лесной-полная-копия.json',JSON.stringify(full,null,2),'application/json');}
$('ts-open').onclick=()=>{$('ts-panel').hidden=false;$('schedule-panel').hidden=true;render();};
$('ts-back').onclick=()=>{$('ts-panel').hidden=true;$('schedule-panel').hidden=false;};
$('ts-month').onchange=e=>{if(/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)){month=e.target.value;render();}};
$('ts-prev').onclick=()=>{const [y,m]=month.split('-').map(Number);month=new Date(Date.UTC(y,m-2,1)).toISOString().slice(0,7);render();};
$('ts-next').onclick=()=>{const [y,m]=month.split('-').map(Number);month=new Date(Date.UTC(y,m,1)).toISOString().slice(0,7);render();};
$('ts-import-week').onclick=importWeek;
$('ts-confirm').onclick=confirmMonth;
$('ts-export').onclick=exportCSV;
$('ts-backup').onclick=backup;
$('ts-restore').onclick=()=>$('ts-file').click();
$('ts-file').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;try{const parsed=JSON.parse(await f.text());const combined=parsed.type==='lesnoy-combined-backup'&&parsed.version===1;const next=validate(combined?parsed.timesheet:parsed);const schedule=combined?C.validateState(parsed.schedule):null;if(!confirm(combined?'Заменить график И табель из полной копии?':'Заменить ВЕСЬ табель из резервной копии?'))return;if(schedule){C.save(localStorage,schedule);book=next;save();alert('График и табель восстановлены. Страница перезагрузится.');location.reload();}else{book=next;save();}}catch(err){alert('Не удалось импортировать: '+err.message);}};
$('ts-body').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.rate)editRate(b.dataset.rate);else if(b.dataset.pay)editPay(b.dataset.pay);else if(b.dataset.person)editCell(b.dataset.person,b.dataset.date);};
})();
