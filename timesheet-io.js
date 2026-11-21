/* Excel and full-table PNG for the independent monthly timesheet. No network calls. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./timesheet-core.js'), require('./vendor/exceljs-4.4.0.min.js'), null);
  else { const host = root.window || root; host.LesnoyTimesheetIO = factory(host.LesnoyTimesheetCore, host.ExcelJS, host.document || root.document); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C, ExcelJS, document) {
  'use strict';
  const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const WEEKDAYS = ['ВС','ПН','ВТ','СР','ЧТ','ПТ','СБ'];
  const fail = message => { throw new Error(message); };
  const norm = x => String(x || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  const round = x => Math.round((x + Number.EPSILON) * 100) / 100;
  function layout(month) {
    const days = C.dayCount(month), nameWidth = 190, roleWidth = 145, dayWidth = 38, shiftsWidth = 90, rateWidth = 100, payWidth = 110;
    return {nameWidth,roleWidth,dayWidth,shiftsWidth,rateWidth,payWidth,days,width:nameWidth+roleWidth+days*dayWidth+shiftsWidth+rateWidth+payWidth};
  }
  function col(index) { let result = ''; for (; index; index = Math.floor((index-1)/26)) result = String.fromCharCode(65+(index-1)%26)+result; return result; }
  function dayName(month, d) { return WEEKDAYS[new Date(C.dateOf(month,d)+'T12:00:00Z').getUTCDay()]; }
  function monthLabel(month) { return new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(month+'-01T12:00:00Z')).replace(/\s*г\.$/,''); }
  function data(book,schedule,month) { C.checkMonth(month); const copy=C.validateBook(book); return {book:copy,list:C.employees(copy,schedule),l:layout(month)}; }
  function noteText(cell) { const n=cell.note; return typeof n==='string'?n:n&&Array.isArray(n.texts)?n.texts.map(x=>x.text||'').join(''):''; }
  function exportedNote(x) { return '[LESNOY:'+ (x.confirmed?'confirmed':'draft') +']\n'+x.note; }
  function readNote(cell) {
    const raw=noteText(cell), marker=raw.match(/^\[LESNOY:(confirmed|draft)\]\n?/);
    return {confirmed:!marker||marker[1]==='confirmed',note:(marker?raw.slice(marker[0].length):raw).slice(0,200)};
  }
  async function exportExcel(book,schedule,month) {
    if (!ExcelJS) fail('Модуль Excel ещё не загружен.');
    const d=data(book,schedule,month), n=d.l.days, wb=new ExcelJS.Workbook();
    wb.creator='ЛЕСНОЙ'; wb.calcProperties.fullCalcOnLoad=true;
    const ws=wb.addWorksheet('Табель '+month,{views:[{state:'frozen',xSplit:2,ySplit:2}],pageSetup:{orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0}});
    const widths=[d.l.nameWidth,d.l.roleWidth,...Array(n).fill(d.l.dayWidth),d.l.shiftsWidth,d.l.rateWidth,d.l.payWidth];
    ws.columns=widths.map(width=>({width:(width-5)/7}));
    const totalCol=n+3, rateCol=n+4, payCol=n+5;
    ws.mergeCells(1,1,1,2);ws.getCell(1,1).value=monthLabel(month);
    ws.mergeCells(1,totalCol,1,payCol);ws.getCell(1,totalCol).value='Табель кухни';
    ws.getCell(2,1).value='LESNOY'; ws.getCell(2,2).value='Должность';
    ws.getCell(2,totalCol).value='Отработано смен'; ws.getCell(2,rateCol).value='Ставка'; ws.getCell(2,payCol).value='Выплаты';
    for(let day=1;day<=n;day++) { ws.getCell(1,day+2).value=dayName(month,day);ws.getCell(2,day+2).value=day; }
    d.list.forEach((p,i)=>{
      const row=i+3, profile=C.profile(d.book,p.id,month), total=C.totals(d.book,p.id,month), drafts=[];
      ws.getCell(row,1).value=p.name;ws.getCell(row,2).value=p.role;
      for(let day=1;day<=n;day++) { const x=d.book.days[p.id]?.[C.dateOf(month,day)];if(!x)continue;const cell=ws.getCell(row,day+2);cell.value=x.value;cell.note=exportedNote(x);if(!x.confirmed)drafts.push(col(day+2)+row); }
      ws.getCell(row,totalCol).value={formula:'SUM(C'+row+':'+col(n+2)+row+')'+(drafts.length?'-SUM('+drafts.join(',')+')':''),result:total.shifts};
      ws.getCell(row,rateCol).value=profile.rate;ws.getCell(row,rateCol).note='[LESNOY:pay:'+profile.type+']';
      const pay=ws.getCell(row,payCol);
      if(total.override!==undefined) {pay.value=total.amount;pay.note='[LESNOY:override]';}
      else if(profile.type==='salary')pay.value=profile.rate;
      else pay.value={formula:'ROUND('+col(rateCol)+row+'*'+col(totalCol)+row+',2)',result:total.amount};
      ws.getCell(row,rateCol).numFmt=pay.numFmt='#,##0.00';
    });
    const bottom=d.list.length+3;
    for(let day=1;day<=n;day++){ws.getCell(bottom,day+2).value=day;ws.getCell(bottom+1,day+2).value=dayName(month,day);}
    ws.getCell(bottom+1,rateCol).value='ФОТ';
    ws.getCell(bottom+1,payCol).value={formula:d.list.length?'SUM('+col(payCol)+'3:'+col(payCol)+(bottom-1)+')':'SUM(0)',result:C.monthlyTotal(d.book,d.list,month)};
    ws.getCell(bottom+1,payCol).numFmt='#,##0.00';
    for(let row=1;row<=bottom+1;row++) {
      ws.getRow(row).height=row===2?34:22;
      for(let c=1;c<=payCol;c++) { const cell=ws.getCell(row,c);cell.font={name:'Times New Roman',size:11,color:{argb:'FF000000'}};cell.alignment={vertical:'middle',horizontal:c<=2?'left':'center',wrapText:true};cell.border=Object.fromEntries(['top','left','bottom','right'].map(k=>[k,{style:'thin',color:{argb:'FF000000'}}]));if(row<=2||row>=bottom)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFD9D9D9'}}; }
    }
    ws.pageSetup.printArea='A1:'+col(payCol)+(bottom+1);ws.pageSetup.printTitlesRow='1:2';
    const bytes=await wb.xlsx.writeBuffer();return {blob:new Blob([bytes],{type:MIME}),filename:'Лесной-табель-'+month+'.xlsx'};
  }
  function zipCheck(input) {
    const a=input instanceof Uint8Array?input:new Uint8Array(input);
    if(a.byteLength>10*1024*1024)fail('Файл Excel больше 10 МБ.');
    const v=new DataView(a.buffer,a.byteOffset,a.byteLength);let end=-1;
    for(let i=a.length-22;i>=Math.max(0,a.length-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
    if(end<0)fail('Ожидается файл .xlsx (ZIP), а не старый .xls.');
    const count=v.getUint16(end+10,true),offset=v.getUint32(end+16,true);
    if(count>1000||count===65535)fail('Слишком много частей в Excel.');
    let at=offset,total=0;
    for(let i=0;i<count;i++) {
      if(at+46>a.length||v.getUint32(at,true)!==0x02014b50)fail('Повреждён архив Excel.');
      const flags=v.getUint16(at+8,true),size=v.getUint32(at+24,true),nameLength=v.getUint16(at+28,true),extra=v.getUint16(at+30,true),comment=v.getUint16(at+32,true);
      total+=size;if(flags&1||size>32*1024*1024||total>50*1024*1024)fail('Распакованный Excel слишком большой или зашифрован.');
      at+=46+nameLength+extra+comment;
    }
    return a;
  }
  // Evaluate a deliberately small, local formula language; never execute formula text as JavaScript.
  function numeric(ws,cell,stack=new Set()) {
    const value=cell.value;
    if(value===null||value===undefined||value==='')return null;
    if(typeof value==='number'){if(!Number.isFinite(value))fail('Нечисловая ячейка '+cell.address);return value;}
    if(value&&(value.error||value.result?.error))fail('Ошибка Excel в '+cell.address);
    if(value&&typeof value==='object'&&(value.formula||value.sharedFormula)) {
      if(stack.has(cell.address)||stack.size>50)fail('Циклическая формула в '+cell.address);
      stack.add(cell.address);
      try {
        const formula=String(cell.formula||value.formula||'').replace(/\$/g,'').toUpperCase();
        if(formula.length>2000)fail('Слишком длинная формула.');
        const tokens=formula.match(/\s+|(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?|[A-Z]+[1-9]\d*|SUM|ROUND|[()+*/,:-]/g)||[];
        if(tokens.join('').replace(/\s/g,'')!==formula.replace(/\s/g,''))fail('Неподдерживаемая формула в '+cell.address);
        const t=tokens.filter(s=>!/^\s+$/.test(s));let i=0;
        const ref=s=>numeric(ws,ws.getCell(s),stack)||0;
        function atom(){const s=t[i++];if(s==='-')return -atom();if(s==='+')return atom();if(s==='('){const x=expr();if(t[i++]!==')')fail('Неверная формула.');return x;}if(s==='SUM'||s==='ROUND'){if(t[i++]!=='(')fail('Неверная формула.');const args=[];if(t[i]!==')')do { if(/^[A-Z]+\d+$/.test(t[i]||'')&&t[i+1]===':'){const from=ws.getCell(t[i++]);i++;const to=ws.getCell(t[i++]);if((to.row-from.row+1)*(to.col-from.col+1)>10000||to.row<from.row||to.col<from.col)fail('Слишком большой диапазон.');let sum=0;for(let r=from.row;r<=to.row;r++)for(let c=from.col;c<=to.col;c++)sum+=numeric(ws,ws.getCell(r,c),stack)||0;args.push(sum);}else args.push(expr());if(t[i]!==',')break;i++;}while(true);if(t[i++]!==')')fail('Неверная формула.');if(s==='SUM')return args.reduce((a,b)=>a+b,0);if(args.length!==2||!Number.isInteger(args[1])||Math.abs(args[1])>8)fail('Неверный ROUND.');return Math.round((args[0]+Number.EPSILON)*10**args[1])/10**args[1];}if(/^[A-Z]+\d+$/.test(s||''))return ref(s);if(s!==undefined&&Number.isFinite(Number(s)))return Number(s);fail('Неподдерживаемая формула в '+cell.address);}
        function product(){let x=atom();while(t[i]==='*'||t[i]==='/'){const op=t[i++],y=atom();x=op==='*'?x*y:x/y;}return x;}
        function expr(){let x=product();while(t[i]==='+'||t[i]==='-'){const op=t[i++],y=product();x=op==='+'?x+y:x-y;}return x;}
        const result=expr();if(i!==t.length||!Number.isFinite(result))fail('Неподдерживаемая формула в '+cell.address);return result;
      } finally { stack.delete(cell.address); }
    }
    if(typeof value==='string'&&/^\s*\d+(?:[.,]\d+)?\s*$/.test(value))return Number(value.replace(',','.'));
    fail('Ожидается число в '+cell.address);
  }
  function cellText(cell) { const x=cell.value;return typeof x==='string'?x:x&&x.richText?x.richText.map(t=>t.text).join(''):x===null?'':typeof x==='number'?String(x):''; }
  function detectedMonth(filename) {
    const s=norm(filename), candidates=new Set(); let m;
    const patterns=[/\b(19\d{2}|20\d{2}|21\d{2})[-_. ](0?[1-9]|1[0-2])(?=\D|$)/g,/\b(0?[1-9]|1[0-2])[-_. ](19\d{2}|20\d{2}|21\d{2})(?=\D|$)/g];
    patterns.forEach((r,i)=>{while((m=r.exec(s)))candidates.add((i?m[2]:m[1])+'-'+String(i?m[1]:m[2]).padStart(2,'0'));});
    const roots=['январ','феврал','март','апрел','ма[йя]','июн','июл','август','сентябр','октябр','ноябр','декабр'];
    roots.forEach((root,i)=>{const r=new RegExp('(?:'+root+'[а-я]*).*?(19\\d{2}|20\\d{2}|21\\d{2})');const found=s.match(r);if(found)candidates.add(found[1]+'-'+String(i+1).padStart(2,'0'));});
    return [...candidates];
  }
  async function importExcel(arrayBuffer,filename,existingBook,schedule,options={}) {
    if(!ExcelJS)fail('Модуль Excel ещё не загружен.');
    const bytes=zipCheck(arrayBuffer),wb=new ExcelJS.Workbook();await wb.xlsx.load(bytes);
    const headers=[];
    for(const ws of wb.worksheets){if(ws.rowCount>10000||ws.columnCount>200)fail('Слишком большая таблица Excel.');for(let row=1;row<=Math.min(50,ws.rowCount);row++)for(let first=3;first<=Math.min(20,ws.columnCount);first++)if(ws.getCell(row,first).value===1){let n=1;while(n<31&&ws.getCell(row,first+n).value===n+1)n++;if(n>=28){const label=norm(cellText(ws.getCell(row,first+n)));if(/смен/.test(label))headers.push({ws,row,first,n});}}}
    if(!headers.length||headers.some(h=>h.ws!==headers[0].ws||h.first!==headers[0].first||h.n!==headers[0].n))fail('Не удалось однозначно найти строку дней и столбец смен в Excel.');
    const {ws,row,first,n}=headers[0],warnings=[],candidates=detectedMonth(filename);
    let month=options.month;if(month){C.checkMonth(month);if(candidates.length&&(!candidates.includes(month)||candidates.length>1))warnings.push('Использован выбранный месяц вместо неоднозначного месяца в имени файла.');}
    else if(candidates.length===1)month=candidates[0];else {const e=new Error('Выберите месяц табеля: имя файла не определяет его однозначно.');e.code='MONTH_REQUIRED';e.dayCount=n;throw e;}
    if(C.dayCount(month)!==n)fail('Количество дней в Excel не совпадает с выбранным месяцем.');
    const totalCol=first+n,rateCol=totalCol+1,payCol=totalCol+2;
    if(!/ставк|оклад/.test(norm(cellText(ws.getCell(row,rateCol))))||!/выплат|зарплат|оплат/.test(norm(cellText(ws.getCell(row,payCol)))))fail('Не найдены столбцы ставки и выплаты.');
    const book=C.validateBook(existingBook||C.createBook(month)),links=C.employeeMap(book,schedule),known=[...book.roster,...(schedule?.employees||[]).map(p=>book.roster.some(r=>norm(r.name)===norm(p.name))?{...p,id:links.byWeeklyId[p.id]||p.id}:p)],byName=new Map(),sourceNames=new Set(),usedIds=new Set([...known.map(x=>x.id),...Object.keys(book.people),...Object.keys(book.days)]);
    for(const p of known){const key=norm(p.name);if(!byName.has(key))byName.set(key,new Map());const canonical=book.aliases?.[p.id]||p.id;byName.get(key).set(canonical,{...p,id:canonical});}
    const rows=[],footerCandidates=[],sourcePayroll=[];
    for(let r=row+1;r<=ws.rowCount;r++) {
      if(headers.some(h=>h.row===r))continue;
      const name=cellText(ws.getCell(r,first-2)).trim(),role=cellText(ws.getCell(r,first-1)).trim();
      const summary=norm(name+' '+role+' '+cellText(ws.getCell(r,rateCol))).trim();
      if(/^(фот|итого|всего)(?:\s|$)/i.test(summary)){const cell=ws.getCell(r,payCol),pay=numeric(ws,cell);if(pay!==null)sourcePayroll.push({value:pay,cached:cell.result});continue;}
      if(!name){const cell=ws.getCell(r,payCol);if(cell.formula)footerCandidates.push({cell,row:r});continue;}
      if(name.length>100||role.length>100)fail('Имя или должность длиннее 100 символов.');
      const key=norm(name);if(sourceNames.has(key))fail('В Excel повторяется имя сотрудника. Импорт отменён.');sourceNames.add(key);
      const matches=byName.get(key);if(matches?.size>1)fail('Имя совпало с несколькими сотрудниками. Уточните имена до импорта.');
      let id=matches?.values().next().value?.id;
      if(!id){let i=1;while(usedIds.has('excel_'+i))i++;id='excel_'+i;usedIds.add(id);}
      const sourceUnits=numeric(ws,ws.getCell(r,totalCol)),rate=numeric(ws,ws.getCell(r,rateCol)),pay=numeric(ws,ws.getCell(r,payCol));if(rate===null||pay===null||rate<0||rate>10000000||pay<0||pay>10000000)fail('У сотрудника отсутствует корректная ставка или выплата.');
      const payCell=ws.getCell(r,payCol),rateNote=noteText(ws.getCell(r,rateCol)),mode=rateNote.match(/\[LESNOY:pay:(salary|shift)\]/)?.[1]||(!payCell.formula&&pay===rate?'salary':'shift');
      const days={};let units=0;
      for(let day=1;day<=n;day++){const cell=ws.getCell(r,first+day-1),value=numeric(ws,cell);if(value===null)continue;if(value<0||value>3)fail('Количество смен должно быть от 0 до 3 в '+cell.address);const status=readNote(cell);days[C.dateOf(month,day)]={value,...status};if(status.confirmed)units+=value;}
      if(sourceUnits!==null&&Math.abs(sourceUnits-units)>.0000001&&!warnings.includes('Итог смен в файле отличается от суммы подтверждённых дней.'))warnings.push('Итог смен в файле отличается от суммы подтверждённых дней.');
      const automatic=mode==='salary'?rate:round(units*rate),override=Math.abs(pay-automatic)>.005||noteText(payCell).includes('[LESNOY:override]');
      rows.push({id,name,role,rate,pay,mode,days,override,sourceRow:r});
    }
    if(!rows.length)fail('В Excel нет строк сотрудников.');
    // The source workbook has an unlabeled SUM in its pay-column footer. Only
    // references to the employee pay area identify it; stray numeric cells do not.
    const firstPerson=Math.min(...rows.map(x=>x.sourceRow)),lastPerson=Math.max(...rows.map(x=>x.sourceRow)),payLetter=col(payCol);
    for(const {cell,row:footerRow} of footerCandidates){
      const formula=cell.formula.replace(/\$|\s/g,'').toUpperCase(),match=formula.match(/^SUM\((([A-Z]+[1-9]\d*)(:[A-Z]+[1-9]\d*)?)(,([A-Z]+[1-9]\d*)(:[A-Z]+[1-9]\d*)?)*\)$/);
      if(!match||footerRow<=lastPerson)continue;
      const references=formula.match(/[A-Z]+[1-9]\d*/g)||[];
      if(!references.every(ref=>{const parts=ref.match(/^([A-Z]+)(\d+)$/);return parts[1]===payLetter&&Number(parts[2])>=firstPerson&&Number(parts[2])<=lastPerson;}))continue;
      sourcePayroll.push({value:numeric(ws,cell),cached:cell.result});
    }
    let employeesAdded=0,importedCells=0;book.profiles[month] ||= {};
    for(const x of rows){if(!book.roster.some(p=>p.id===x.id)){book.roster.push({id:x.id,name:x.name,role:x.role});employeesAdded++;}else {const p=book.roster.find(p=>p.id===x.id);p.name=x.name;p.role=x.role;}
      // Only affected people and this month are replaced. Weekly schedule and defaults stay untouched.
      const days=book.days[x.id] ||= {};for(const date of Object.keys(days))if(date.startsWith(month+'-'))delete days[date];Object.assign(days,x.days);importedCells+=Object.keys(x.days).length;
      book.profiles[month][x.id]={type:x.mode,rate:x.rate};if(book.overrides[x.id])delete book.overrides[x.id][month];if(x.override)(book.overrides[x.id] ||= {})[month]=x.pay;
    }
    book.selectedMonth=month;book.updatedAt=new Date().toISOString();const validated=C.validateBook(book);
    const total=round(rows.reduce((sum,x)=>sum+x.pay,0)),payrollMatches=sourcePayroll.every(x=>Math.abs(total-x.value)<.005&&(typeof x.cached!=='number'||Math.abs(total-x.cached)<.005));
    if(!payrollMatches)warnings.push('Итог ФОТ в файле отличается от суммы выплат сотрудников.');
    return {book:validated,month,employeesAdded,importedCells,warnings,sourceCount:rows.length,payrollMatches};
  }
  function canvasFactory() {
    if(document)return document.createElement('canvas');
    if(typeof require==='function'){let native;try{native=require('@napi-rs/canvas');}catch(_){native=require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');}return native.createCanvas(1,1);}
    fail('Браузер не поддерживает Canvas.');
  }
  async function exportPNG(book,schedule,month) {
    const d=data(book,schedule,month);if(document?.fonts?.ready)await document.fonts.ready;
    const canvas=canvasFactory(),ctx=canvas.getContext('2d'),font='15px "Times New Roman", "Liberation Serif", serif',line=18;
    ctx.font=font;
    function wrap(value,width){const words=String(value).split(/\s+/),lines=[];let current='';for(const word of words){if(ctx.measureText(word).width>width){if(current){lines.push(current);current='';}let part='';for(const ch of word){if(ctx.measureText(part+ch).width>width){lines.push(part);part='';}part+=ch;}current=part;}else if(current&&ctx.measureText(current+' '+word).width>width){lines.push(current);current=word;}else current=current?current+' '+word:word;}if(current||!lines.length)lines.push(current);return lines;}
    const widths=[d.l.nameWidth,d.l.roleWidth,...Array(d.l.days).fill(d.l.dayWidth),d.l.shiftsWidth,d.l.rateWidth,d.l.payWidth],rows=[];
    rows.push({values:['','',...Array.from({length:d.l.days},(_,i)=>dayName(month,i+1)),'','',''],header:true});
    rows.push({values:['ЛЕСНОЙ','Должность',...Array.from({length:d.l.days},(_,i)=>i+1),'Отработано смен','Ставка','Выплаты'],header:true});
    for(const p of d.list){const t=C.totals(d.book,p.id,month),profile=C.profile(d.book,p.id,month);rows.push({values:[p.name,p.role,...Array.from({length:d.l.days},(_,i)=>{const x=d.book.days[p.id]?.[C.dateOf(month,i+1)];return x?String(x.value)+(x.confirmed?'':'*'):'';}),t.shifts,profile.rate.toLocaleString('ru-RU'),t.amount.toLocaleString('ru-RU')]});}
    rows.push({values:['','',...Array.from({length:d.l.days},(_,i)=>i+1),'','',''],header:true});
    rows.push({values:['','',...Array.from({length:d.l.days},(_,i)=>dayName(month,i+1)),'','ФОТ',C.monthlyTotal(d.book,d.list,month).toLocaleString('ru-RU')],header:true});
    rows.forEach(row=>{row.lines=row.values.map((value,i)=>wrap(value,widths[i]-10));row.height=Math.max(28,...row.lines.map(lines=>lines.length*line+12));});
    const footer=28,logicalHeight=rows.reduce((sum,row)=>sum+row.height,0)+footer,scale=Math.min(2,16000/d.l.width,16000/logicalHeight,Math.sqrt(15000000/(d.l.width*logicalHeight)));
    canvas.width=Math.floor(d.l.width*scale);canvas.height=Math.floor(logicalHeight*scale);ctx.scale(scale,scale);ctx.font=font;ctx.fillStyle='#ffffff';ctx.fillRect(0,0,d.l.width,logicalHeight);ctx.strokeStyle='#000000';ctx.lineWidth=.7;ctx.textBaseline='middle';
    let y=0;for(const row of rows){let x=0;row.lines.forEach((lines,i)=>{ctx.fillStyle=row.header?'#d9d9d9':'#ffffff';ctx.fillRect(x,y,widths[i],row.height);ctx.strokeRect(x,y,widths[i],row.height);ctx.fillStyle='#000000';ctx.textAlign=i<2?'left':'center';lines.forEach((text,j)=>ctx.fillText(text,i<2?x+5:x+widths[i]/2,y+row.height/2+(j-(lines.length-1)/2)*line));x+=widths[i];});y+=row.height;}
    ctx.fillStyle='#000000';ctx.textAlign='left';ctx.fillText('* — черновик, в оплату не включён. Месяц: '+month,5,y+footer/2);
    let blob;if(canvas.toBlob)blob=await new Promise((resolve,reject)=>canvas.toBlob(x=>x?resolve(x):reject(new Error('Не удалось создать PNG.')),'image/png'));else blob=new Blob([canvas.toBuffer('image/png')],{type:'image/png'});
    return {blob,filename:'Лесной-табель-'+month+'.png',width:canvas.width,height:canvas.height};
  }
  return {layout,exportExcel,exportPNG,importExcel};
});
