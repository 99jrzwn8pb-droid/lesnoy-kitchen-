/* Месячный табель: отдельное локальное хранилище и расчёты. */
(function () {
'use strict';
const T=window.LesnoyTimesheetCore,C=window.LesnoyCore;
if(!T||!C)return;
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=x=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:4}).format(x);
const money=x=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(x)+' ₽';
const monthName=m=>new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(m+'-01T12:00:00Z'));
let storage;try{storage=window.localStorage;}catch(_){storage=null;}
const loaded=T.load(storage);
let book=loaded.book,month=book.selectedMonth,active=false,dirty=false,external=false,history=[],brush='1',view;
let warning=loaded.error||'',exportURL,exportSequence=0,importSequence=0,lastFocus,weeklyPNG,oldStatus;
const dialog=$('ts-dialog');
const schedule=()=>window.LesnoySchedule?window.LesnoySchedule.getState():C.load(storage).state;
const people=()=>T.employees(book,schedule());
const cell=(id,date)=>book.days[id]?.[date];
const io=()=>{if(!window.LesnoyTimesheetIO)throw Error('Модуль Excel и PNG не загрузился. Обновите страницу.');return window.LesnoyTimesheetIO;};
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,5000);}
function formError(form,error){let p=form.querySelector('.form-error');if(!p){p=document.createElement('p');p.className='form-error';p.setAttribute('role','alert');form.append(p);}p.textContent=error.message||String(error);}
function status(){
 const list=people(),drafts=list.reduce((sum,p)=>sum+T.totals(book,p.id,month).drafts,0);
 $('ts-status').textContent=(dirty?'Не сохранено · ':external?'Другая вкладка · ':warning?'Проверьте сохранение · ':'Сохранено в браузере · ')+list.length+' чел. · ФОТ '+money(T.monthlyTotal(book,list,month))+(drafts?' · Черновиков: '+drafts+' (не входят в оплату)':' · Учтены только подтверждённые смены');
 $('ts-retry-save').hidden=!dirty||external;
 if(active){$('save-status').textContent=external?'Другая вкладка':dirty?'Не сохранено':warning?'Проверьте данные':'Сохранено в браузере';$('save-status').classList.toggle('error',dirty||external||!!warning);}
 const box=$('ts-warning');box.replaceChildren();box.hidden=!warning;
 if(warning){box.append(document.createTextNode(warning+' '));const b=document.createElement('button');b.className='button small';b.textContent='Скачать JSON';b.onclick=backupJSON;box.append(b);if(external){const r=document.createElement('button');r.className='button small';r.textContent='Загрузить другую вкладку';r.onclick=()=>location.reload();box.append(r);}}
}
function persist(){try{if(external)throw Error('Табель изменён в другой вкладке. Загрузите свежие данные.');book=T.save(storage,book);dirty=false;warning='';status();return true;}catch(error){dirty=true;warning=error.message+' Изменения остаются на странице. Скачайте JSON перед закрытием.';status();return false;}}
function commit(change,message,remember=true){
 if(external){toast('Редактирование приостановлено: загрузите изменения из другой вкладки.');return false;}
 const before=T.validateBook(book),next=T.validateBook(book);
 try{change(next);book=T.validateBook(next);}catch(error){toast(error.message);return false;}
 if(remember){history.push(before);if(history.length>20)history.shift();}
 const saved=persist();render();if(message)toast(message+(saved?'':' Не сохранено — скачайте JSON.'));return true;
}
function closeDialog(){exportSequence++;dialog.close();}
function modal(title,html,setup){exportSequence++;if(exportURL){URL.revokeObjectURL(exportURL);exportURL=null;}$('ts-dialog-title').textContent=title;$('ts-dialog-body').innerHTML=html;lastFocus=document.activeElement;if(!dialog.open)dialog.showModal();if(setup)setup($('ts-dialog-body'));}
function actions(label='Сохранить',extra=''){return '<div class="form-actions">'+extra+'<button type="button" class="button" data-ts-close>Отмена</button><button type="submit" class="button primary">'+label+'</button></div>';}
function setMonth(value){try{T.checkMonth(value);}catch(error){toast(error.message);$('ts-month').value=month;return;}month=value;commit(next=>next.selectedMonth=value,null,false);}
function heading(day){const date=T.dateOf(month,day),d=new Date(date+'T12:00:00Z').getUTCDay();return{date,label:['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][d]};}
function render(){
 const list=people(),count=T.dayCount(month),g=io().layout(month);
 const cols='<col style="width:'+g.nameWidth+'px"><col style="width:'+g.roleWidth+'px">'+Array(count).fill('<col style="width:'+g.dayWidth+'px">').join('')+'<col style="width:'+g.shiftsWidth+'px"><col style="width:'+g.rateWidth+'px"><col style="width:'+g.payWidth+'px">';
 $('ts-table').style.width=g.width+'px';$('ts-surface').style.width=g.width+'px';
 const weekdays=Array.from({length:count},(_,i)=>'<th scope="col" class="ts-dayhead">'+heading(i+1).label+'</th>').join('');
 const dates=Array.from({length:count},(_,i)=>'<th scope="col" class="ts-dayhead">'+(i+1)+'</th>').join('');
 const head='<thead><tr class="ts-weekdays"><th colspan="2">'+esc(monthName(month))+'</th>'+weekdays+'<th colspan="3">Табель кухни «ЛЕСНОЙ»</th></tr><tr class="ts-labels"><th scope="col">LESNOY</th><th scope="col">Должность</th>'+dates+'<th scope="col">Отработано<br>смен</th><th scope="col">Ставка / оклад</th><th scope="col">Выплаты</th></tr></thead>';
 const rows=list.map(person=>{
  const profile=T.profile(book,person.id,month),total=T.totals(book,person.id,month);
  const days=Array.from({length:count},(_,i)=>{const date=T.dateOf(month,i+1),x=cell(person.id,date);return '<td class="'+(x&&!x.confirmed?'ts-draft':'')+'"><button class="ts-cell" data-ts-person="'+esc(person.id)+'" data-date="'+date+'" aria-label="'+esc(person.name+', '+(i+1)+': '+(x?num(x.value)+(x.confirmed?', факт':', черновик'):'пусто'))+'" title="'+esc(x?.note||'Пустая ячейка — заполнить; заполненная — изменить')+'">'+(x?num(x.value):'')+'</button></td>';}).join('');
  return '<tr><th class="ts-name" scope="row"><button data-rate="'+esc(person.id)+'" title="Имя, должность и оплата">'+esc(person.name)+'</button></th><td class="ts-role"><button data-rate="'+esc(person.id)+'">'+esc(person.role||'')+'</button></td>'+days+'<td class="ts-total">'+num(total.shifts)+'</td><td><button data-rate="'+esc(person.id)+'" class="ts-money" title="'+(profile.type==='salary'?'Фиксированный оклад за месяц':'Оплата за одну смену')+'">'+num(profile.rate)+(profile.type==='salary'?'<small>оклад</small>':'')+'</button></td><td><button data-pay="'+esc(person.id)+'" class="ts-money" title="'+(total.override!==undefined?'Ручная выплата':'Автоматический расчёт')+'">'+num(total.amount)+(total.override!==undefined?'<small>вручную</small>':'')+'</button></td></tr>';
 }).join('');
 const empty=list.length?'':'<tr><td colspan="'+(count+5)+'" class="ts-empty"><strong>Загрузите свой табель Excel</strong><p>Сотрудники, должности, смены и ставки сохранятся только в этом браузере.</p><button class="button primary" data-ts-import>Импорт Excel / JSON</button> <button class="button" data-ts-add>Добавить сотрудника</button></td></tr>';
 $('ts-table').innerHTML='<colgroup>'+cols+'</colgroup>'+head+'<tbody>'+rows+empty+'</tbody><tfoot><tr class="ts-repeat"><th colspan="2"></th>'+dates+'<th colspan="3"></th></tr><tr><th colspan="2">ФОТ за '+esc(monthName(month))+'</th>'+weekdays+'<th colspan="2">Итого</th><th class="ts-grand-total">'+num(T.monthlyTotal(book,list,month))+'</th></tr></tfoot>';
 $('ts-month').value=month;$('ts-month-label').textContent=monthName(month);$('ts-palette').innerHTML=['1','0.5','1.5','0','erase'].map(v=>'<button class="shift-chip" data-ts-brush="'+v+'" aria-pressed="'+(brush===v)+'">'+(v==='erase'?'⌫':v.replace('.',','))+'</button>').join('');
 $('ts-undo').disabled=!history.length||external;updateTransferControls();status();if(active)initView();view?.refresh();
}
function initView(){if(view||!window.LesnoyTimesheetViewport)return;view=window.LesnoyTimesheetViewport.create({viewport:$('ts-body'),surface:$('ts-surface'),content:$('ts-table'),frozenWidth:335,headerHeight:()=>$('ts-table').tHead.offsetHeight,onScale:s=>$('ts-zoom-level').textContent=s.percent+'%'});}
function open(){if(!active){oldStatus={text:$('save-status').textContent,error:$('save-status').classList.contains('error')};weeklyPNG=$('export-png').onclick;}active=true;$('ts-panel').hidden=false;$('schedule-panel').hidden=true;document.documentElement.classList.add('monthly-active');$('ts-open').setAttribute('aria-pressed','true');$('ts-back').setAttribute('aria-pressed','false');$('export-png').onclick=pngDialog;try{render();}catch(error){warning=error.message;status();}requestAnimationFrame(()=>view?.refresh());}
function close(){if(!active)return;active=false;$('ts-panel').hidden=true;$('schedule-panel').hidden=false;document.documentElement.classList.remove('monthly-active');$('ts-open').setAttribute('aria-pressed','false');$('ts-back').setAttribute('aria-pressed','true');$('export-png').onclick=weeklyPNG;if(oldStatus){$('save-status').textContent=oldStatus.text;$('save-status').classList.toggle('error',oldStatus.error);}window.LesnoySchedule?.refresh();}
function applyCell(id,date,value,confirmed,note){return commit(next=>{const row=next.days[id]||={};if(value===null)delete row[date];else row[date]={value,confirmed,note:note||''};});}
function focusCell(id,date){const b=$('ts-table').querySelector('[data-ts-person="'+id+'"][data-date="'+date+'"]');if(b){b.focus({preventScroll:true});view?.reveal(b);}}
function editCell(id,date){
 const person=people().find(p=>p.id===id);if(!person)return;const old=cell(id,date);
 modal(person.name+' · '+date.split('-').reverse().join('.'),'<form id="ts-cell-form" class="form-grid"><label class="field">Количество смен<input name="value" inputmode="decimal" autocomplete="off" value="'+esc(old?String(old.value).replace('.',','):'1')+'" required></label><label class="ts-check"><input name="confirmed" type="checkbox" '+(!old||old.confirmed?'checked':'')+'>Подтверждённый факт (учитывается в оплате)</label><label class="field">Примечание<input name="note" maxlength="200" value="'+esc(old?.note||'')+'"></label><p class="dialog-note">Можно указать дробную смену: 0,5 или 1,5. Оклад не зависит от числа смен.</p>'+actions('Сохранить','<button type="button" id="ts-delete-cell" class="button danger">Удалить смену</button>')+'</form>',body=>{
  const f=body.querySelector('form');f.onsubmit=e=>{e.preventDefault();const raw=f.elements.value.value.trim(),value=Number(raw.replace(',','.'));if(!raw||!Number.isFinite(value)||value<0||value>3)return formError(f,Error('Введите число от 0 до 3, например 1,5.'));if(applyCell(id,date,value,f.elements.confirmed.checked,f.elements.note.value.trim())){closeDialog();focusCell(id,date);}};
  body.querySelector('#ts-delete-cell').onclick=()=>{if(applyCell(id,date,null)){closeDialog();focusCell(id,date);}};
 });
}
function editPerson(id){
 const existing=id&&people().find(p=>p.id===id),p=id?T.profile(book,id,month):{type:'shift',rate:0};
 modal(existing?'Сотрудник и оплата':'Добавить сотрудника','<form id="ts-person-form" class="form-grid"><label class="field">Фамилия и имя<input name="name" maxlength="100" value="'+esc(existing?.name||'')+'" required></label><label class="field">Должность<input name="role" maxlength="100" value="'+esc(existing?.role||'')+'"></label><label class="field">Тип оплаты<select name="type"><option value="shift" '+(p.type==='shift'?'selected':'')+'>За смену</option><option value="salary" '+(p.type==='salary'?'selected':'')+'>Фиксированный оклад</option></select></label><label class="field">Ставка / оклад за '+esc(monthName(month))+'<input name="rate" inputmode="decimal" value="'+p.rate+'" required></label><p class="dialog-note">Оплата меняется только за выбранный месяц. Недельный график сохраняется отдельно.</p>'+actions()+'</form>',body=>{
  const f=body.querySelector('form');f.onsubmit=e=>{e.preventDefault();const name=f.elements.name.value.trim(),role=f.elements.role.value.trim(),raw=f.elements.rate.value.trim(),rate=Number(raw.replace(',','.'));if(!name||!raw||!Number.isFinite(rate)||rate<0||rate>10000000)return formError(f,Error('Заполните имя и укажите сумму от 0 до 10 000 000.'));if(people().some(x=>x.id!==id&&T.normalizeName(x.name)===T.normalizeName(name)))return formError(f,Error('Такое имя уже есть в табеле. Уточните фамилию и имя.'));
   const personId=id||'ts-'+(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2));
   if(commit(next=>{const row=next.roster.find(x=>x.id===personId);if(row){row.name=name;row.role=role;}else next.roster.push({id:personId,name,role});(next.profiles[month]||={})[personId]={type:f.elements.type.value,rate};},'Сотрудник сохранён'))closeDialog();
  };
 });
}
function editPay(id){
 const person=people().find(p=>p.id===id);if(!person)return;const total=T.totals(book,id,month);
 modal('Выплата · '+person.name,'<form id="ts-pay-form" class="form-grid"><p class="dialog-note">Автоматический расчёт: '+money(total.automaticAmount)+'. Пустое поле возвращает автоматический расчёт.</p><label class="field">Ручная выплата за месяц<input name="amount" inputmode="decimal" value="'+esc(total.override===undefined?'':total.override)+'"></label>'+actions()+'</form>',body=>{const f=body.querySelector('form');f.onsubmit=e=>{e.preventDefault();const raw=f.elements.amount.value.trim(),amount=Number(raw.replace(',','.'));if(raw&&(!Number.isFinite(amount)||amount<0||amount>10000000))return formError(f,Error('Введите сумму от 0 до 10 000 000.'));if(commit(next=>{const row=next.overrides[id]||={};if(raw)row[month]=amount;else delete row[month];},'Выплата сохранена'))closeDialog();};});
}
function undo(){if(!history.length||external)return;book=history.pop();month=book.selectedMonth;persist();render();toast('Изменение табеля отменено');}
function syncOpenWeek(){
 try{
  const current=schedule(),week=current.selectedWeek,result=T.importWeek(book,current,week);
  if(!result.changes.length){toast('Изменений нет: табель уже соответствует переносу недели.');return;}
  if(commit(next=>{Object.assign(next,result.book);next.selectedMonth=week.slice(0,7);},'Перенесено черновиков: '+result.added+' · Удалено смен: '+result.removed)){month=week.slice(0,7);render();}
 }catch(error){toast('Не удалось перенести неделю: '+error.message);}
}
function updateTransferControls(){
 try{const current=schedule(),disabled=external||!T.weekTransferEntries(book,current,current.selectedWeek).length;
  $('cancel-timesheet-transfer').disabled=disabled;$('ts-cancel-week').disabled=disabled;
 }catch(_){$('cancel-timesheet-transfer').disabled=true;$('ts-cancel-week').disabled=true;}
}
function cancelOpenWeekTransfer(){
 try{const current=schedule(),week=current.selectedWeek,result=T.cancelWeekTransfer(book,current,week);
  if(!result.changed){toast('Для этой недели нет переносов, которые можно отменить.');return;}
  const dates=C.weekDates(week),range=dates[0].split('-').reverse().join('.')+' — '+dates[6].split('-').reverse().join('.');
  if(!confirm('Отменить все переносы недели '+range+'? Из табеля будут удалены все перенесённые смены этой недели, включая изменённые и подтверждённые. Отдельно внесённые смены сохранятся.'))return;
  commit(next=>Object.assign(next,result.book),'Все переносы недели отменены · Удалено смен: '+result.removed);
 }catch(error){toast('Не удалось отменить перенос: '+error.message);}
}
function confirmMonth(){if(!confirm('Подтвердить все черновики за '+monthName(month)+'? Они войдут в расчёт выплаты.'))return;commit(next=>{for(const row of Object.values(next.days))for(const [date,x]of Object.entries(row))if(date.startsWith(month+'-'))x.confirmed=true;},'Смены месяца подтверждены');}
function download(name,data,type){const blob=data instanceof Blob?data:new Blob([data],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function backupJSON(){download('Лесной-график-и-табель-'+month+'.json',JSON.stringify({type:'lesnoy-combined-backup',version:1,schedule:C.validateState(schedule()),timesheet:T.validateBook(book)},null,2),'application/json');}
function exportCSV(){const list=people(),count=T.dayCount(month),rows=[['Сотрудник','Должность',...Array.from({length:count},(_,i)=>i+1),'Смены','Ставка / оклад','Выплаты']];for(const p of list)rows.push([p.name,p.role||'',...Array.from({length:count},(_,i)=>{const x=cell(p.id,T.dateOf(month,i+1));return x?.confirmed?x.value:'';}),T.totals(book,p.id,month).shifts,T.profile(book,p.id,month).rate,T.totals(book,p.id,month).amount]);rows.push(['ФОТ',...Array(count+3).fill(''),T.monthlyTotal(book,list,month)]);const quote=v=>'"'+String(typeof v==='string'&&/^[=+@\-\t\r]/.test(v)?"'"+v:v).replace(/"/g,'""')+'"';download('Лесной-табель-'+month+'.csv','\ufeff'+rows.map(r=>r.map(quote).join(';')).join('\r\n'),'text/csv;charset=utf-8');}
async function exportExcel(){const button=$('ts-export');button.disabled=true;try{const r=await io().exportExcel(T.validateBook(book),C.validateState(schedule()),month);download(r.filename,r.blob);toast('Excel готов: формулы и оформление сохранены');}catch(error){toast('Не удалось создать Excel: '+error.message);}finally{button.disabled=false;}}
function pngDialog(){
 modal('PNG табеля','<img id="ts-png-preview" class="png-preview" alt="Полный месячный табель" hidden><p id="ts-png-status" class="dialog-note">Создаю полную таблицу…</p><div class="png-actions"><button id="ts-png-share" class="button primary" hidden><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 13V2m-4 4 4-4 4 4M5 9H3v8h14V9h-2"/></svg><span>Поделиться</span></button><a id="ts-png-download" class="button small" hidden><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2v10m-4-4 4 4 4-4M3 12v5h14v-5"/></svg><span>Скачать</span></a></div>');
 const generate=async()=>{
  const seq=++exportSequence;$('ts-png-preview').hidden=true;$('ts-png-download').hidden=true;$('ts-png-share').hidden=true;$('ts-png-status').textContent='Создаю полную таблицу…';
  try{const r=await io().exportPNG(T.validateBook(book),C.validateState(schedule()),month,{printQuality:true});if(seq!==exportSequence||!dialog.open)return;
   if(exportURL)URL.revokeObjectURL(exportURL);exportURL=URL.createObjectURL(r.blob);$('ts-png-preview').src=exportURL;$('ts-png-preview').hidden=false;$('ts-png-status').textContent='Весь табель'+' · '+r.width+' × '+r.height+' px';$('ts-png-download').href=exportURL;$('ts-png-download').download=r.filename;$('ts-png-download').hidden=false;
   const file=new File([r.blob],r.filename,{type:'image/png'});let canShare=false;try{canShare=!!navigator.canShare?.({files:[file]});}catch(_){}$('ts-png-share').hidden=!canShare;$('ts-png-share').onclick=async()=>{try{await navigator.share({files:[file]});}catch(error){if(error.name!=='AbortError')toast('Сохраните PNG и прикрепите картинку в Telegram.');}};
  }catch(error){if(seq===exportSequence)$('ts-png-status').textContent='Ошибка PNG: '+error.message;}
 };
 generate();
}
function restoreCombined(nextBook,nextSchedule){
 const keys=[C.STORAGE_KEY,C.BACKUP_KEY,T.STORAGE_KEY,T.BACKUP_KEY],previous=keys.map(k=>[k,storage.getItem(k)]);
 try{T.save(storage,nextBook);C.save(storage,nextSchedule);}catch(error){let failed=false;for(const[k,v]of previous)try{if(v===null)storage.removeItem(k);else storage.setItem(k,v);}catch(_){failed=true;}if(failed)throw Error('Не удалось восстановить оба раздела. Скачайте текущий JSON и проверьте хранилище.');throw error;}
}
function importData(parsed,options={}){
 const combined=parsed?.type==='lesnoy-combined-backup';if(combined&&parsed.version!==1)throw Error('Версия полной копии не поддерживается.');
 const nextSchedule=combined?C.validateState(parsed.schedule):null;
 const next=T.mergeImportedDuplicates(T.validateBook(combined?parsed.timesheet:parsed?.type==='lesnoy-timesheet-backup'?parsed.timesheet:parsed),nextSchedule||schedule());
 if(!options.skipConfirm&&!confirm(combined?'Заменить недельный график И табель полной резервной копией? Текущие данные будут заменены.':'Загрузить этот табель? Недельный график останется без изменений. Текущий табель будет заменён.'))return false;
 if(external)throw Error('Сначала загрузите изменения другой вкладки.');
 if(combined){restoreCombined(next,nextSchedule);book=next;dirty=false;month=book.selectedMonth;history=[];render();if(!options.noReload)location.reload();}
 else{if(!commit(target=>Object.assign(target,next),'Табель импортирован'))return false;month=book.selectedMonth;render();}return true;
}
async function importFile(file,forcedMonth){
 if(!file)return;if(file.size>10*1024*1024)return toast('Файл больше 10 МБ. Выберите исходный табель или JSON.');const seq=++importSequence;
 try{if(/\.xlsx$/i.test(file.name)){
  const beforeImport=JSON.stringify(book);const result=await io().importExcel(await file.arrayBuffer(),file.name,T.validateBook(book),C.validateState(schedule()),forcedMonth?{month:forcedMonth}:{});if(seq!==importSequence)return;
  modal('Импорт Excel','<p>Месяц: <strong>'+esc(monthName(result.month))+'</strong></p><p>Сотрудников в файле: '+result.sourceCount+'. Ячеек смен: '+result.importedCells+'.</p><p class="dialog-note">Указанные строки этого месяца будут заменены данными Excel. Другие месяцы и недельный график сохранятся.</p>'+(result.warnings.length?'<p class="warning">'+result.warnings.map(esc).join('<br>')+'</p>':'')+'<div class="form-actions"><button class="button" data-ts-close>Отмена</button><button id="ts-import-apply" class="button primary">Загрузить табель</button></div>',body=>{body.querySelector('#ts-import-apply').onclick=()=>{if(beforeImport!==JSON.stringify(book)){importFile(file,forcedMonth);return;}if(commit(next=>Object.assign(next,result.book),'Данные Excel перенесены')){month=result.month;book.selectedMonth=month;persist();render();closeDialog();}};});
 }else{const parsed=JSON.parse(await file.text());if(seq===importSequence)importData(parsed);}}
 catch(error){if(error.code==='MONTH_REQUIRED')modal('Выберите месяц Excel','<form id="ts-import-month-form" class="form-grid"><p class="dialog-note">Не удалось определить месяц из имени файла. Укажите месяц табеля.</p><label class="field">Месяц<input name="month" type="month" min="1900-01" max="2199-12" value="'+month+'" required></label>'+actions('Продолжить')+'</form>',body=>body.querySelector('form').onsubmit=e=>{e.preventDefault();const value=e.currentTarget.elements.month.value;closeDialog();importFile(file,value);});else toast('Файл не импортирован: '+error.message);}
}
function paste(event){
 const target=event.target.closest('[data-ts-person][data-date]');if(!target||dialog.open)return;const text=event.clipboardData?.getData('text/plain');if(!text||text.length>40000)return;event.preventDefault();
 const grid=text.replace(/\r\n?/g,'\n').replace(/\n+$/,'').split('\n').map(r=>r.split('\t').map(x=>x.trim())),list=people(),start=list.findIndex(p=>p.id===target.dataset.tsPerson),day=Number(target.dataset.date.slice(8));
 if(start<0||start+grid.length>list.length||grid.some(r=>day+r.length-1>T.dayCount(month)))return toast('Диапазон выходит за границы табеля.');
 if(grid.flat().some(v=>v!==''&&(!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(v)||Number(v.replace(',','.'))>3)))return toast('Вставьте числа от 0 до 3 или пустые ячейки.');
 commit(next=>grid.forEach((r,i)=>{const row=next.days[list[start+i].id]||={};r.forEach((v,j)=>{const date=T.dateOf(month,day+j);if(v==='')delete row[date];else row[date]={value:Number(v.replace(',','.')),confirmed:$('ts-brush-confirmed').checked,note:''};});}),'Диапазон вставлен');focusCell(target.dataset.tsPerson,target.dataset.date);
}
$('ts-open').onclick=open;$('ts-back').onclick=close;
$('ts-month').onchange=e=>setMonth(e.target.value);$('ts-prev').onclick=()=>{try{setMonth(T.addMonths(month,-1));}catch(e){toast(e.message);}};$('ts-next').onclick=()=>{try{setMonth(T.addMonths(month,1));}catch(e){toast(e.message);}};
$('ts-palette').onclick=e=>{const b=e.target.closest('[data-ts-brush]');if(b){brush=b.dataset.tsBrush;render();}};
document.addEventListener('lesnoy:schedulechange',updateTransferControls);
$('cancel-timesheet-transfer').onclick=cancelOpenWeekTransfer;$('ts-cancel-week').onclick=cancelOpenWeekTransfer;
$('ts-undo').onclick=undo;$('ts-addemployee').onclick=()=>editPerson();$('ts-import-week').onclick=syncOpenWeek;$('sync-timesheet').onclick=syncOpenWeek;$('ts-confirm').onclick=confirmMonth;
$('ts-export').onclick=exportExcel;$('ts-png').onclick=pngDialog;$('ts-backup').onclick=backupJSON;$('ts-csv').onclick=exportCSV;$('ts-retry-save').onclick=persist;
$('ts-restore').onclick=()=>$('ts-file').click();$('ts-file').onchange=e=>{const file=e.target.files[0];e.target.value='';importFile(file);};
$('ts-zoom-in').onclick=()=>view?.zoomBy(1.2);$('ts-zoom-out').onclick=()=>view?.zoomBy(1/1.2);$('ts-zoom-fit').onclick=()=>view?.fit();$('ts-freeze').onchange=e=>view?.setFrozen(e.target.checked);
$('ts-body').addEventListener('click',e=>{
 if(view?.isClickBlocked()){e.preventDefault();e.stopImmediatePropagation();return;}const b=e.target.closest('button');if(!b)return;
 if(b.hasAttribute('data-ts-import'))$('ts-file').click();else if(b.hasAttribute('data-ts-add'))editPerson();else if(b.dataset.rate)editPerson(b.dataset.rate);else if(b.dataset.pay)editPay(b.dataset.pay);else if(b.dataset.tsPerson){if(brush===null&&!cell(b.dataset.tsPerson,b.dataset.date))return;if(brush==='erase')applyCell(b.dataset.tsPerson,b.dataset.date,null);else if(cell(b.dataset.tsPerson,b.dataset.date))editCell(b.dataset.tsPerson,b.dataset.date);else{applyCell(b.dataset.tsPerson,b.dataset.date,Number(brush),$('ts-brush-confirmed').checked,'');focusCell(b.dataset.tsPerson,b.dataset.date);}}
});
$('ts-body').addEventListener('keydown',e=>{const b=e.target.closest('[data-ts-person][data-date]');if(!b)return;const list=people(),row=list.findIndex(p=>p.id===b.dataset.tsPerson),day=Number(b.dataset.date.slice(8)),arrows={ArrowLeft:[row,day-1],ArrowRight:[row,day+1],ArrowUp:[row-1,day],ArrowDown:[row+1,day]};if(arrows[e.key]){e.preventDefault();const[r,d]=arrows[e.key];if(list[r]&&d>=1&&d<=T.dayCount(month))focusCell(list[r].id,T.dateOf(month,d));}else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();applyCell(b.dataset.tsPerson,b.dataset.date,null);focusCell(b.dataset.tsPerson,b.dataset.date);}else if(e.key==='F2'){e.preventDefault();editCell(b.dataset.tsPerson,b.dataset.date);}});
$('ts-body').addEventListener('paste',paste);
document.addEventListener('click',e=>{if(active&&!e.defaultPrevented&&!e.target.closest('button,a,input,select,textarea,label,summary,dialog,[role=button]')&&brush!==null){brush=null;render();}});
document.addEventListener('keydown',e=>{if(active&&(e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'&&!e.shiftKey&&!dialog.open&&!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)){e.preventDefault();undo();}});
$('ts-dialog-close').onclick=closeDialog;$('ts-dialog-body').onclick=e=>{if(e.target.closest('[data-ts-close]'))closeDialog();};
dialog.addEventListener('close',()=>{exportSequence++;if(exportURL){URL.revokeObjectURL(exportURL);exportURL=null;}if(lastFocus?.isConnected)lastFocus.focus({preventScroll:true});});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('storage',e=>{if(e.key===T.STORAGE_KEY||e.key===null){external=true;warning='Табель изменён в другой вкладке. Редактирование приостановлено, чтобы не перезаписать изменения.';if(active)render();}});
if(!loaded.error){const repaired=T.mergeImportedDuplicates(book,schedule());if(JSON.stringify(repaired)!==JSON.stringify(book)){book=repaired;persist();}}
updateTransferControls();
window.LesnoyTimesheet={getBook:()=>T.validateBook(book),getMonth:()=>month,open,close,importData,importFile};
})();
