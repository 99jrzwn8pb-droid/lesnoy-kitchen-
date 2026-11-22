const test = require('node:test');
const assert = require('node:assert/strict');
const C = require(require('./site-path.cjs')('core.js'));

function fixture() {
  const s = C.createState('2026-11-16');
  s.presetVersion = 0;
  s.shifts = [
    {id:'day',label:'10–22',color:'#e6eee6'},
    {id:'late',label:'12–00',color:'#e4ebf5'},
    {id:'off',label:'В',color:'#f1f0ed'},
    {id:'vacation',label:'ОТ',color:'#e8e1ef'},
    {id:'sick',label:'Б',color:'#f6e4df'}
  ];
  s.employees.push({ id: 'chef1', name: 'Тестовый сотрудник', phone: '', department: 'hot' });
  s.weeks[s.selectedWeek] = { chef1: ['day', 'late', '', 'off', 'vacation', 'sick', 'day'] };
  return s;
}
function storage() {
  const values = new Map();
  return { values, getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value)) };
}

test('недели и даты корректны на границе года, високосного дня и перехода часов', () => {
  assert.equal(C.monday('2027-01-01'), '2026-12-28');
  assert.deepEqual(C.weekDates('2024-02-26'), ['2024-02-26', '2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02', '2024-03-03']);
  assert.equal(C.addDays('2026-03-28', 2), '2026-03-30');
  assert.equal(C.addDays('2026-10-24', 2), '2026-10-26');
  assert.equal(C.previousWeek('2027-01-04'), '2026-12-28');
  assert.throws(() => C.weekDates('2026-11-17'), /понедельника/);
  assert.throws(() => C.monday('2026-02-30'), /не существует/);
});

test('данные проходят полный цикл JSON и локального сохранения', () => {
  const db = storage();
  const s = fixture();
  C.save(db, s);
  assert.deepEqual(C.load(db).state, s);
  const copy = C.validateState(JSON.parse(JSON.stringify(s)));
  copy.weeks[s.selectedWeek].chef1[0] = 'off';
  assert.equal(s.weeks[s.selectedWeek].chef1[0], 'day');
  C.save(db, copy);
  assert.deepEqual(C.load(db).state, copy);
  assert.deepEqual(JSON.parse(db.getItem(C.BACKUP_KEY)), s);
});

test('разные недели хранятся независимо и копия не меняет оригинал', () => {
  const s = fixture();
  const next = C.addDays(s.selectedWeek, 7);
  s.weeks[next] = structuredClone(s.weeks[s.selectedWeek]);
  s.weeks[next].chef1[0] = 'off';
  const restored = C.validateState(JSON.parse(JSON.stringify(s)));
  assert.equal(restored.weeks[s.selectedWeek].chef1[0], 'day');
  assert.equal(restored.weeks[next].chef1[0], 'off');
});

test('ошибочные и слишком большие резервные копии отвергаются', () => {
  let s = fixture(); s.weeks[s.selectedWeek].chef1[0] = 'unknown';
  assert.throws(() => C.validateState(s), /неизвестная смена/);
  s = fixture(); s.employees.push({ ...s.employees[0] });
  assert.throws(() => C.validateState(s), /повторяется/);
  s = fixture(); s.employees[0].department = 'missing';
  assert.throws(() => C.validateState(s), /неизвестный цех/);
  s = fixture(); s.employees[0].id = '__proto__';
  assert.throws(() => C.validateState(s), /идентификатор/);
  s = fixture(); s.weeks[s.selectedWeek].chef1.pop();
  assert.throws(() => C.validateState(s), /ровно 7/);
  s = fixture(); s.shifts[0].color = 'url(evil)';
  assert.throws(() => C.validateState(s), /цвет/);
  s = fixture(); s.employees = Array.from({ length: 201 }, (_, i) => ({ id: 'e' + i, name: 'Тест', phone: '', department: 'hot' }));
  assert.throws(() => C.validateState(s), /не более 200/);
  assert.throws(() => C.validateState({ ...fixture(), version: 2 }), /не поддерживается/);
});

test('повреждённый оригинал остаётся нетронутым при загрузке и восстанавливается из копии', () => {
  const db = storage();
  const raw = '{broken json';
  db.setItem(C.STORAGE_KEY, raw);
  const first = C.load(db);
  assert.equal(first.recovered, false);
  assert.match(first.error, /Не удалось прочитать/);
  assert.equal(db.getItem(C.STORAGE_KEY), raw);
  db.setItem(C.BACKUP_KEY, JSON.stringify(fixture()));
  const second = C.load(db);
  assert.equal(second.recovered, true);
  assert.deepEqual(second.state, fixture());
  assert.equal(db.getItem(C.STORAGE_KEY), raw);
  C.save(db, second.state);
  assert.ok([...db.values.entries()].some(([key, value]) => key.includes(':corrupt:') && value === raw));
  assert.deepEqual(C.load(db).state, fixture());
});

test('запрет localStorage и переполнение не скрывают потерю сохранения', () => {
  const denied = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };
  assert.match(C.load(denied).error, /запретил/);
  assert.throws(() => C.save(denied, fixture()), /запретил/);
  const db = storage(); C.save(db, fixture());
  const before = db.getItem(C.STORAGE_KEY);
  db.setItem = () => { throw new Error('QuotaExceededError'); };
  const changed = fixture(); changed.weeks[changed.selectedWeek].chef1[0] = 'off';
  assert.throws(() => C.save(db, changed), /Не удалось сохранить изменения/);
  assert.equal(db.getItem(C.STORAGE_KEY), before);
});

test('ошибка дополнительной копии не отменяет успешное основное сохранение', () => {
  const db = storage(); C.save(db, fixture());
  const originalSet = db.setItem;
  db.setItem = (key, value) => {
    if (key === C.BACKUP_KEY) throw new Error('QuotaExceededError');
    originalSet(key, value);
  };
  const updated = fixture(); updated.employees[0].name = 'Новое тестовое имя';
  assert.doesNotThrow(() => C.save(db, updated));
  assert.equal(C.load(db).state.employees[0].name, 'Новое тестовое имя');
});

test('при отсутствии основного сохранения восстанавливается действующая копия без записи в браузер', () => {
  const db = storage();
  const expected = fixture();
  const raw = JSON.stringify(expected);
  db.setItem(C.BACKUP_KEY, raw);
  const before = [...db.values.entries()];
  const result = C.load(db);
  assert.equal(result.recovered, true);
  assert.match(result.error, /Основное сохранение отсутствует/);
  assert.deepEqual(result.state, expected);
  assert.deepEqual([...db.values.entries()], before, 'Загрузка не должна менять основное сохранение или копию');
});

test('повторное сохранение неизменившегося состояния не перезаписывает полезную резервную копию', () => {
  const db = storage();
  const first = fixture();
  C.save(db, first);
  const current = structuredClone(first);
  current.employees[0].name = 'Изменённое тестовое имя';
  C.save(db, current);
  const backup = db.getItem(C.BACKUP_KEY);
  const main = db.getItem(C.STORAGE_KEY);
  db.setItem = () => { throw new Error('Неизменившиеся данные не должны записываться повторно'); };
  assert.doesNotThrow(() => C.save(db, C.load(db).state));
  assert.doesNotThrow(() => C.save(db, C.load(db).state));
  assert.equal(db.getItem(C.STORAGE_KEY), main);
  assert.equal(db.getItem(C.BACKUP_KEY), backup);
  assert.deepEqual(JSON.parse(backup), first);
});

test('действующий пустой график не заменяется резервной копией и не стирает её при повторном открытии', () => {
  const db = storage();
  const empty = C.createState('2026-11-16');
  const backup = JSON.stringify(fixture());
  db.setItem(C.STORAGE_KEY, JSON.stringify(empty));
  db.setItem(C.BACKUP_KEY, backup);
  const loaded = C.load(db);
  assert.equal(loaded.recovered, false);
  assert.equal(loaded.error, null);
  assert.deepEqual(loaded.state, empty);
  C.save(db, loaded.state);
  C.save(db, C.load(db).state);
  assert.deepEqual(C.load(db).state, empty);
  assert.equal(db.getItem(C.BACKUP_KEY), backup);
});

test('повреждённая копия без основного сохранения остаётся нетронутой и вызывает понятную ошибку', () => {
  const db = storage();
  const raw = '{broken backup';
  db.setItem(C.BACKUP_KEY, raw);
  const before = [...db.values.entries()];
  const result = C.load(db);
  assert.equal(result.recovered, false);
  assert.match(result.error, /Не удалось прочитать резервную копию/);
  assert.equal(result.state.employees.length, 0);
  assert.deepEqual([...db.values.entries()], before);
  const fresh = storage();
  assert.equal(C.load(fresh).error, null, 'Первый запуск без обеих записей не является ошибкой');
});

function roster() {
  return {
    type: 'lesnoy-roster', version: 1,
    departments: [{id: 'first', name: 'Новый тестовый цех'}, {id: 'second', name: 'Горячий цех'}],
    employees: [
      {id: 'source1', name: 'Тестовый сотрудник', phone: 'ТЕСТ-НОВЫЙ', department: 'first'},
      {id: 'source2', name: 'Другой тестовый сотрудник', phone: 'ТЕСТ-ДРУГОЙ', department: 'second'}
    ]
  };
}

test('импорт состава команды сохраняет график, ID, выбранную неделю и посторонних сотрудников', () => {
  const original = fixture();
  original.employees.push({id:'unrelated',name:'Неизменяемый тестовый сотрудник',phone:'ТЕСТ',department:'cold'});
  const before = structuredClone(original);
  const input = roster(); const inputBefore = structuredClone(input);
  const result = C.mergeRoster(original, input);
  assert.deepEqual(original, before);
  assert.deepEqual(input, inputBefore);
  assert.equal(result.added, 1);
  assert.equal(result.updated, 1);
  assert.equal(result.departmentsAdded, 1);
  assert.equal(result.state.employees[0].id, 'chef1');
  assert.equal(result.state.employees[0].department, 'first');
  assert.equal(result.state.employees[0].phone, 'ТЕСТ-НОВЫЙ');
  assert.equal(result.state.employees[1].department, 'hot');
  assert.deepEqual(result.state.employees[2], original.employees[1]);
  assert.deepEqual(result.state.weeks, original.weeks);
  assert.notEqual(result.state.weeks, original.weeks);
  assert.deepEqual(result.state.shifts, original.shifts);
  assert.equal(result.state.selectedWeek, original.selectedWeek);
  assert.equal(result.state.updatedAt, original.updatedAt);
  assert.deepEqual(result.state.departments.map(d => d.id), ['first', 'hot', 'cold', 'prep']);
  result.state.weeks[result.state.selectedWeek].chef1[0] = 'off';
  assert.equal(original.weeks[original.selectedWeek].chef1[0], 'day');
});

test('повторный импорт команды не создаёт дубликаты и пустой телефон не стирает существующий', () => {
  const original = fixture(); original.employees[0].phone = 'ТЕСТ-СОХРАНИТЬ';
  const input = roster(); input.employees = [input.employees[0]];
  input.employees[0].name = '  ТЕСТОВЫЙ   СОТРУДНИК  ';
  input.employees[0].phone = '';
  const result = C.mergeRoster(original, input);
  assert.equal(result.state.employees.length, 1);
  assert.equal(result.state.employees[0].id, 'chef1');
  assert.equal(result.state.employees[0].phone, 'ТЕСТ-СОХРАНИТЬ');
  const again = C.mergeRoster(result.state, input);
  assert.equal(again.added, 0);
  assert.equal(again.updated, 0);
  assert.equal(again.departmentsAdded, 0);
  assert.deepEqual(again.state, result.state);
});

test('неверные и неоднозначные списки сотрудников отклоняются без частичного изменения', () => {
  const original = fixture(); const before = structuredClone(original);
  let input = roster(); input.employees[0].department = 'unknown';
  assert.throws(() => C.mergeRoster(original, input), /неизвестный цех/);
  input = roster(); input.employees.push({...input.employees[0], id:'duplicate',name:'ТЕСТОВЫЙ  СОТРУДНИК'});
  assert.throws(() => C.mergeRoster(original, input), /повторяется имя/);
  input = roster(); input.departments.push({id:'duplicate',name:'ГОРЯЧИЙ  ЦЕХ'});
  assert.throws(() => C.mergeRoster(original, input), /повторяется имя или название/);
  input = roster(); input.employees[0].phone = 'x'.repeat(51);
  assert.throws(() => C.mergeRoster(original, input), /длина|длины/);
  assert.throws(() => C.mergeRoster(original, {...roster(),type:'unknown'}), /не поддерживается/);
  assert.deepEqual(original, before);
  const duplicates = fixture(); duplicates.employees.push({...duplicates.employees[0],id:'duplicate'});
  assert.throws(() => C.mergeRoster(duplicates, roster()), /Существующие сотрудники: повторяется/);
});

test('совпадение входящих ID с другими записями не перезаписывает сотрудников и цеха', () => {
  const original = fixture();
  const input = roster();
  input.departments[0].id = 'hot'; input.employees[0].department = 'hot';
  input.employees[1].id = 'chef1';
  const result = C.mergeRoster(original, input);
  assert.equal(result.state.departments[0].id, 'hot-2');
  assert.equal(result.state.departments[1].id, 'hot');
  assert.equal(result.state.employees[0].id, 'chef1');
  assert.equal(result.state.employees[0].department, 'hot-2');
  assert.equal(result.state.employees[1].id, 'chef1-2');
  assert.equal(result.state.weeks[original.selectedWeek].chef1[0], 'day');
  const full = C.createState('2026-11-16');
  full.employees = Array.from({length:200},(_,i)=>({id:'full'+i,name:'Тест '+i,phone:'',department:'hot'}));
  const before = structuredClone(full);
  assert.throws(()=> C.mergeRoster(full, roster()), /не более 200/);
  assert.deepEqual(full,before);
});

test('новый график предлагает только 10–22, 11:30–23:30 и Р', () => {
  const current = C.createState('2026-11-16');
  assert.equal(current.presetVersion,1);
  assert.deepEqual(current.shifts.map(shift => [shift.id,shift.label]),[
    ['day','10–22'],['midday','11:30–23:30'],['work','Р']
  ]);
  assert.deepEqual(C.selectableShifts(current),current.shifts);
  current.shifts[0].label='Тестовая правка';
  assert.equal(C.createState('2026-11-16').shifts[0].label,'10–22','Графики не должны разделять объекты вариантов смен');
});

test('обновление кнопок сохраняет сотрудников, телефоны и старые значения во всех неделях', () => {
  const previous=fixture(); previous.employees[0].phone='ТЕСТ-ТЕЛЕФОН';
  previous.weeks['2026-11-23']={chef1:['late','off','vacation','sick','','','day']};
  const before=structuredClone(previous);
  const upgraded=C.configureShiftPresets(previous);
  assert.deepEqual(previous,before,'Обновление не изменяет исходный объект');
  assert.equal(upgraded.presetVersion,1);
  for(const key of ['employees','departments','weeks','selectedWeek','updatedAt']) assert.deepEqual(upgraded[key],before[key]);
  for(const historical of before.shifts) assert.deepEqual(upgraded.shifts.find(shift=>shift.id===historical.id),historical);
  assert.deepEqual(C.selectableShifts(upgraded).map(shift=>shift.label),['10–22','11:30–23:30','Р']);
  assert.deepEqual(C.configureShiftPresets(upgraded),upgraded);
  const db=storage();C.save(db,upgraded);
  assert.deepEqual(C.load(db).state,upgraded);
});

test('обновление повторно использует пользовательский интервал и безопасно обходит совпавшие ID', () => {
  const previous=fixture();
  previous.shifts[0].label='Дежурство';
  previous.shifts.push(
    {id:'custom-mid',label:'11:30 - 23:30',color:'#112233'},
    {id:'midday',label:'Стажировка',color:'#223344'},
    {id:'work',label:'Учёба',color:'#334455'}
  );
  const upgraded=C.configureShiftPresets(previous);
  const choices=C.selectableShifts(upgraded);
  assert.deepEqual(choices.slice(0,3).map(shift=>shift.id),['day-2','custom-mid','work-2']);
  assert.equal(choices.filter(shift=>shift.label.replace(/\s/g,'').replace(/-/g,'–')==='11:30–23:30').length,1);
  assert.equal(upgraded.shifts.find(shift=>shift.id==='custom-mid').color,'#112233');
  assert.equal(upgraded.shifts.find(shift=>shift.id==='day').label,'Дежурство');
  assert.equal(upgraded.shifts.find(shift=>shift.id==='midday').label,'Стажировка');
  assert.equal(upgraded.shifts.find(shift=>shift.id==='work').label,'Учёба');
  assert.deepEqual(upgraded.weeks,previous.weeks);
});

test('неиспользуемые старые кнопки убираются, включая разные тире, регистр и формат часов', () => {
  const previous=fixture();previous.weeks={};
  previous.shifts.find(shift=>shift.id==='late').label='12:00 — 0:00';
  previous.shifts.find(shift=>shift.id==='off').label=' в ';
  previous.shifts.find(shift=>shift.id==='vacation').label='от';
  previous.shifts.find(shift=>shift.id==='sick').label='б';
  assert.deepEqual(C.selectableShifts(previous).map(shift=>shift.id),['day']);
  const upgraded=C.configureShiftPresets(previous);
  assert.deepEqual(upgraded.shifts.map(shift=>shift.label),['10–22','11:30–23:30','Р']);
});

test('полный старый каталог обновляется без удаления любой используемой смены', () => {
  const previous=fixture();
  previous.shifts=Array.from({length:30},(_,index)=>({
    id:index===0?'day':index===1?'midday':index===2?'work':'custom-'+index,
    label:'Тестовый вариант '+index,color:'#112233'
  }));
  previous.weeks={};
  for(let offset=0;offset<5;offset++) previous.weeks[C.addDays(previous.selectedWeek,offset*7)]={
    chef1:Array.from({length:7},(_,day)=>previous.shifts[offset*7+day]?.id||'')
  };
  const before=structuredClone(previous);
  const upgraded=C.configureShiftPresets(previous);
  assert.equal(upgraded.shifts.length,33);
  for(const shift of before.shifts) assert.deepEqual(upgraded.shifts.find(item=>item.id===shift.id),shift);
  assert.deepEqual(upgraded.weeks,before.weeks);
  assert.deepEqual(C.selectableShifts(upgraded).slice(0,3).map(shift=>shift.id),['day-2','midday-2','work-2']);
  assert.deepEqual(C.configureShiftPresets(upgraded),upgraded);
  assert.deepEqual(C.validateState(JSON.parse(JSON.stringify(upgraded))),upgraded);
  assert.throws(()=>C.validateState({...upgraded,presetVersion:0}),/не более 30/);
});

test('после однократного обновления пользовательские изменения вариантов не отменяются', () => {
  const upgraded=C.configureShiftPresets(fixture());
  upgraded.shifts.find(shift=>shift.id==='day').label='09–21';
  upgraded.shifts=upgraded.shifts.filter(shift=>shift.id!=='work');
  const before=structuredClone(upgraded);
  assert.deepEqual(C.configureShiftPresets(upgraded),before);
  assert.ok(!C.selectableShifts(C.configureShiftPresets(upgraded)).some(shift=>shift.label==='Р'));
  assert.throws(()=>C.validateState({...upgraded,presetVersion:2}),/Версия вариантов смен/);
});

function weekFixture() {
  const state=C.createState('2026-11-16');
  state.employees=[
    {id:'week-first',name:'Тестовый повар Ёж',phone:'ТЕСТ-ПЕРВЫЙ',department:'hot'},
    {id:'week-second',name:'Другой тестовый повар',phone:'ТЕСТ-ВТОРОЙ',department:'cold'},
    {id:'week-extra',name:'Посторонний тестовый повар',phone:'ТЕСТ-ТРЕТИЙ',department:'prep'}
  ];
  state.weeks['2026-11-16']={'week-first':['work','','','','','','']};
  state.weeks['2026-11-23']={
    'week-first':Array(7).fill('midday'),
    'week-second':['day','','','','','',''],
    'week-extra':['','','work','','','','']
  };
  return state;
}
function weekInput() {
  return {type:'lesnoy-week',version:1,week:'2026-11-23',rows:[
    {name:'  ТЕСТОВЫЙ   ПОВАР ЕЖ ',shifts:['10:00–22:00','','15:30–03:30','Р','','11:30–23:30','']}
  ]};
}

test('импорт недели заменяет семь дней по имени, сохраняет остальные данные и повторно использует интервалы',()=>{
  const state=weekFixture(),before=structuredClone(state),input=weekInput(),inputBefore=structuredClone(input);
  const result=C.importWeekSchedule(state,input);
  assert.deepEqual(state,before);assert.deepEqual(input,inputBefore);
  assert.equal(result.employeesApplied,1);assert.equal(result.filledCells,4);
  assert.equal(result.state.selectedWeek,'2026-11-23');
  for(const key of ['employees','departments','updatedAt'])assert.deepEqual(result.state[key],before[key]);
  assert.deepEqual(result.state.weeks['2026-11-16'],before.weeks['2026-11-16']);
  for(const person of ['week-second','week-extra'])assert.deepEqual(result.state.weeks['2026-11-23'][person],before.weeks['2026-11-23'][person]);
  const values=result.state.weeks['2026-11-23']['week-first'];
  assert.equal(values[0],'day');assert.equal(values[3],'work');assert.equal(values[5],'midday');
  for(const day of [1,4,6])assert.equal(values[day],'','Пустые дни из файла должны очищать ранее заполненные ячейки');
  assert.equal(result.state.shifts.find(s=>s.id===values[2]).label,'15:30–03:30');
  assert.equal(result.state.shifts.length,before.shifts.length+1);
  const again=C.importWeekSchedule(result.state,input);
  assert.deepEqual(again.state,result.state,'Повторный импорт не создаёт варианты смен повторно');
});

test('импорт недели отклоняет отсутствующие и неоднозначные имена без частичного применения',()=>{
  const state=weekFixture(),before=structuredClone(state);
  let input=weekInput();input.rows.push({name:'Нет такого повара',shifts:Array(7).fill('Р')});
  assert.throws(()=>C.importWeekSchedule(state,input),/не найден/);
  input=weekInput();input.rows.push({...input.rows[0],name:'тестовый повар ёж'});
  assert.throws(()=>C.importWeekSchedule(state,input),/повторяется сотрудник/);
  assert.deepEqual(state,before);
  const duplicate=weekFixture();duplicate.employees.push({...duplicate.employees[0],id:'duplicate-week'});
  const duplicateBefore=structuredClone(duplicate);
  assert.throws(()=>C.importWeekSchedule(duplicate,weekInput()),/несколько сотрудников/);
  assert.deepEqual(duplicate,duplicateBefore);
  const unrelated=weekFixture();unrelated.employees.push({...unrelated.employees[1],id:'unrelated-duplicate'});
  assert.doesNotThrow(()=>C.importWeekSchedule(unrelated,weekInput()),'Несовпадения среди неимпортируемых имён не должны блокировать целевую строку');
});

test('проверка файла недели отвергает неверные границы, даты, значения и формат',()=>{
  const state=weekFixture(),before=structuredClone(state);
  const cases=[
    {...weekInput(),type:'unknown'},
    {...weekInput(),version:2},
    {...weekInput(),week:'2026-11-24'},
    {...weekInput(),week:'2026-02-30'},
    {...weekInput(),rows:[]},
    {...weekInput(),rows:Array.from({length:201},(_,i)=>({name:'Тест '+i,shifts:Array(7).fill('Р')}))},
    {...weekInput(),rows:[{name:'Тестовый повар Ёж',shifts:Array(6).fill('Р')}]},
    {...weekInput(),rows:[{name:'Тестовый повар Ёж',shifts:['x'.repeat(25),'','','','','','']}]},
    {...weekInput(),rows:[{name:'Тестовый повар Ёж',shifts:[null,'','','','','','']}]},
    {...weekInput(),rows:[{name:'Тестовый повар Ёж',shifts:['Р\n','','','','','','']}]}
  ];
  for(const input of cases)assert.throws(()=>C.importWeekSchedule(state,input));
  assert.deepEqual(state,before);
});

test('импорт недели использует состав команды только для пустого графика',()=>{
  const empty=C.createState('2026-11-16'),input=weekInput();
  input.roster=roster();input.rows=[{name:'Другой тестовый сотрудник',shifts:['Р','','','','','','']}];
  const result=C.importWeekSchedule(empty,input);
  assert.equal(empty.employees.length,0);
  assert.equal(result.state.employees.length,2);
  const employee=result.state.employees.find(p=>p.name==='Другой тестовый сотрудник');
  assert.equal(employee.phone,'ТЕСТ-ДРУГОЙ');
  assert.equal(result.state.weeks[input.week][employee.id][0],'work');
  const existing=weekFixture(),existingBefore=structuredClone(existing),valid=weekInput();
  valid.roster={type:'invalid'};
  const kept=C.importWeekSchedule(existing,valid);
  assert.deepEqual(kept.state.employees,existingBefore.employees);
  assert.deepEqual(kept.state.departments,existingBefore.departments);
});

test('нехватка вариантов смен не теряет данные, а совпадение ID обрабатывается безопасно',()=>{
  const state=weekFixture();
  state.shifts.push({id:'import-shift-1',label:'Тестовая подпись',color:'#112233'});
  const result=C.importWeekSchedule(state,weekInput());
  const values=result.state.weeks['2026-11-23']['week-first'];
  assert.equal(values[2],'import-shift-2');
  assert.equal(result.state.shifts.find(s=>s.id==='import-shift-1').label,'Тестовая подпись');
  const full=weekFixture();
  while(full.shifts.length<33)full.shifts.push({id:'full-'+full.shifts.length,label:'Тест '+full.shifts.length,color:'#112233'});
  const before=structuredClone(full);
  assert.throws(()=>C.importWeekSchedule(full,weekInput()),/Недостаточно места/);
  assert.deepEqual(full,before);
  const reused=weekInput();reused.rows[0].shifts=['10:00–22:00','','','','','',''];
  assert.doesNotThrow(()=>C.importWeekSchedule(full,reused));
});

test('старые JSON-копии открываются с пустыми строками цехов, а новые строки проходят сохранение',()=>{
  const old=weekFixture();delete old.departmentWeeks;
  const oldBefore=structuredClone(old);
  const restored=C.validateState(old);
  assert.deepEqual(restored.departmentWeeks,{});
  assert.deepEqual(old,oldBefore,'Проверка старой копии не меняет её объект');
  const db=storage();db.setItem(C.STORAGE_KEY,JSON.stringify(old));
  const beforeLoad=[...db.values];
  assert.deepEqual(C.load(db).state.departmentWeeks,{});
  assert.deepEqual([...db.values],beforeLoad,'Совместимая загрузка не пишет в хранилище');
  restored.departmentWeeks['2026-11-16']={hot:['day','work','','midday','','','']};
  C.save(db,restored);
  const loaded=C.load(db).state;
  assert.deepEqual(loaded,restored);
  assert.deepEqual(loaded.weeks,old.weeks);
  assert.deepEqual(C.validateState(JSON.parse(JSON.stringify(loaded))),loaded);
});

test('строки разных цехов и недель не разделяют массивы и не меняют смены сотрудников',()=>{
  const original=weekFixture();const shared=['day','','','','','',''];
  original.departmentWeeks={
    '2026-11-16':{hot:shared,cold:shared},
    '2026-11-23':{hot:shared}
  };
  const before=structuredClone(original.weeks);
  const valid=C.validateState(original);
  valid.departmentWeeks['2026-11-23'].hot[0]='work';
  valid.departmentWeeks['2026-11-16'].cold[0]='midday';
  assert.equal(valid.departmentWeeks['2026-11-16'].hot[0],'day');
  assert.equal(original.departmentWeeks['2026-11-23'].hot[0],'day');
  assert.equal(original.departmentWeeks['2026-11-16'].cold[0],'day');
  assert.deepEqual(valid.weeks,before);
});

test('строки цехов проверяют даты, принадлежность, семь дней и ограничения без частичных изменений',()=>{
  const state=weekFixture();
  const cases=[
    null,[],
    {'2026-11-17':{hot:Array(7).fill('day')}},
    {'2026-02-30':{hot:Array(7).fill('day')}},
    {'2026-11-16':{unknown:Array(7).fill('day')}},
    {'2026-11-16':{hot:['unknown','','','','','','']}},
    {'2026-11-16':{hot:Array(6).fill('day')}},
    {'2026-11-16':{hot:[null,'','','','','','']}},
    {'2026-11-16':{hot:'day'}},
    {'2026-11-16':Object.fromEntries(Array.from({length:51},(_,i)=>['dept'+i,Array(7).fill('day')]))},
    Object.fromEntries(Array.from({length:1001},(_,i)=>[C.addDays('2026-11-16',i*7),{}]))
  ];
  for(const departmentWeeks of cases){
    const input={...structuredClone(state),departmentWeeks};const before=structuredClone(input);
    assert.throws(()=>C.validateState(input));
    assert.deepEqual(input,before);
  }
  assert.deepEqual(state.departmentWeeks,{});
});

test('импорт команды и одной недели сохраняет отдельные строки цехов',()=>{
  const original=weekFixture();
  original.departmentWeeks={
    '2026-11-16':{hot:['day','','work','','','','']},
    '2026-11-23':{cold:['','','midday','','','','']}
  };
  const before=structuredClone(original);
  const merged=C.mergeRoster(original,roster()).state;
  assert.deepEqual(merged.departmentWeeks,before.departmentWeeks);
  assert.notEqual(merged.departmentWeeks,original.departmentWeeks);
  const imported=C.importWeekSchedule(original,weekInput()).state;
  assert.deepEqual(imported.departmentWeeks,before.departmentWeeks);
  assert.deepEqual(imported.employees,before.employees);
  imported.departmentWeeks['2026-11-16'].hot[0]='work';
  assert.equal(original.departmentWeeks['2026-11-16'].hot[0],'day');
});

test('старые варианты, используемые только в строке цеха, сохраняются при обновлении кнопок',()=>{
  const original=fixture();original.weeks={};
  original.departmentWeeks={'2026-11-16':{hot:['late','off','vacation','sick','','','']}};
  const before=structuredClone(original);
  const upgraded=C.configureShiftPresets(original);
  assert.deepEqual(original,before);
  assert.deepEqual(upgraded.departmentWeeks,before.departmentWeeks);
  for(const value of ['late','off','vacation','sick']){
    assert.deepEqual(upgraded.shifts.find(s=>s.id===value),before.shifts.find(s=>s.id===value));
  }
  assert.deepEqual(C.selectableShifts(upgraded).map(s=>s.label),['10–22','11:30–23:30','Р']);
});

test('hidden time buttons persist without changing referenced shifts and remain restorable in configuration',()=>{
 const C=require(require('./site-path.cjs')('core.js')),s=C.configureShiftPresets(C.createState('2026-11-16'));
 const time=s.shifts.find(x=>x.label.includes('10'));time.hidden=true;
 const saved=C.validateState(JSON.parse(JSON.stringify(s)));
 assert.equal(C.selectableShifts(saved).some(x=>x.id===time.id),false);
 assert.equal(C.selectableShifts(saved,{includeHidden:true}).some(x=>x.id===time.id),true);
 assert.equal(C.configureShiftPresets(saved).shifts.find(x=>x.id===time.id).hidden,true);
 time.hidden='yes';assert.throws(()=>C.validateState(s),/скрытой/);
});
