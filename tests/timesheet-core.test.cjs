const test = require('node:test');
const assert = require('node:assert/strict');
const T = require(require('./site-path.cjs')('timesheet-core.js'));

function memory(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { data, writes: [], getItem: k => data.get(k) ?? null, setItem(k, v) { this.writes.push(k); data.set(k, v); } };
}
function book() {
  const b = T.createBook('2028-02');
  b.roster = [{ id: 'monthly-a', name: 'Тест Один', role: 'Повар' }, { id: 'monthly-b', name: 'Тест Два', role: '' }];
  b.people = { 'monthly-a': { type: 'shift', rate: 100.25 }, 'monthly-b': { type: 'salary', rate: 1234.56 } };
  return b;
}
function cell(value, confirmed = true, note = '') { return { value, confirmed, note }; }
function schedule() {
  return {
    employees: [{ id: 'weekly-a', name: '  ТЕСТ   ОДИН ', department: 'kitchen' }, { id: 'monthly-b', name: 'Тест Два', department: 'kitchen' }],
    departments: [{ id: 'kitchen', name: 'Цех' }],
    shifts: [{ id: 'work', label: 'Р' }, { id: 'time', label: '10:30–22:30' }, { id: 'off', label: 'В' }, { id: 'leave', label: 'ОТ' }, { id: 'sick', label: 'Б' }],
    weeks: { '2028-01-31': { 'weekly-a': ['work', 'time', 'off', 'leave', 'sick', '', 'work'], 'monthly-b': ['off', '', '', '', '', '', ''] } }
  };
}

test('calendar checks leap days, real dates, and supported bounds', () => {
  assert.equal(T.dayCount('2028-02'), 29);
  assert.equal(T.dayCount('2100-02'), 28);
  assert.equal(T.dayCount('2000-02'), 29);
  assert.equal(T.dateOf('2028-02', 29), '2028-02-29');
  assert.equal(T.addMonths('2028-01', -1), '2027-12');
  assert.equal(T.addMonths('2028-12', 1), '2029-01');
  assert.equal(T.monthKey('2028-02-29'), '2028-02');
  for (const bad of ['2027-02-29', '2028-02-30', '2028-13-01', '1899-12-31', '2200-01-01']) assert.throws(() => T.parseDate(bad));
  assert.throws(() => T.dateOf('2028-02', 0));
  assert.throws(() => T.addMonths('1900-01', -1));
  assert.throws(() => T.addMonths('2199-12', 1));
});

test('payroll uses only confirmed fractional shifts and rounds each employee to kopecks', () => {
  const b = book();
  b.days['monthly-a'] = { '2028-02-01': cell(0.5), '2028-02-02': cell(1.5), '2028-02-03': cell(3, false), '2028-03-01': cell(1) };
  const a = T.totals(b, 'monthly-a', '2028-02');
  assert.equal(a.shifts, 2);
  assert.equal(a.drafts, 1);
  assert.equal(a.draftShifts, 3);
  assert.equal(a.amount, 200.5);
  assert.equal(T.totals(b, 'monthly-b', '2028-02').amount, 1234.56);
  b.people['monthly-a'].rate = 0.01;
  b.days['monthly-a'] = { '2028-02-01': cell(0.5) };
  b.people['monthly-b'] = { type: 'salary', rate: 0.005 };
  assert.equal(T.monthlyTotal(b, ['monthly-a', 'monthly-b', 'monthly-a'], '2028-02'), 0.02);
  b.overrides['monthly-a'] = { '2028-02': 0 };
  assert.equal(T.totals(b, 'monthly-a', '2028-02').amount, 0);
  assert.equal(T.totals(b, 'monthly-a', '2028-02').automaticAmount, 0.01);
});

test('fraction summation is deterministic and monthly rate edits preserve history', () => {
  let b = book();
  b.days['monthly-a'] = { '2028-02-01': cell(0.1), '2028-02-02': cell(0.2) };
  assert.equal(T.totals(b, 'monthly-a', '2028-02').shifts, 0.3);
  b.days['monthly-a']['2028-02-03'] = cell(Number.MIN_VALUE);
  assert.equal(T.totals(b, 'monthly-a', '2028-02').shifts, 0.3);
  b = T.snapshotProfiles(b, '2028-02');
  b.people['monthly-a'].rate = 200;
  b.profiles['2028-03'] = { 'monthly-a': { type: 'shift', rate: 300 } };
  assert.equal(T.profile(b, 'monthly-a', '2028-02').rate, 100.25);
  assert.equal(T.profile(b, 'monthly-a', '2028-03').rate, 300);
  assert.equal(T.profile(b, 'monthly-a', '2028-04').rate, 300);
  assert.equal(T.totals(b, 'monthly-a', '2028-02').amount, 30.08);
});

test('imported monthly profiles carry into future months while past rates stay unchanged', () => {
  const b = T.createBook('2026-11');
  b.profiles['2026-11'] = { imported: { type: 'salary', rate: 1200 }, legacy: { type: 'shift', rate: 200 } };
  b.people.legacy = { type: 'shift', rate: 100 };
  assert.deepEqual(T.profile(b, 'imported', '2026-12'), { type: 'salary', rate: 1200 });
  assert.equal(T.totals(b, 'imported', '2026-12').amount, 1200);
  assert.equal(T.profile(b, 'legacy', '2026-12').rate, 200);
  b.profiles['2026-12'] = { imported: { type: 'salary', rate: 1500 }, legacy: { type: 'shift', rate: 300 } };
  assert.equal(T.profile(b, 'imported', '2026-11').rate, 1200);
  assert.equal(T.profile(b, 'imported', '2027-01').rate, 1500);
  assert.equal(T.profile(b, 'legacy', '2026-11').rate, 200);
  assert.equal(T.profile(b, 'legacy', '2027-01').rate, 300);
  assert.equal(T.profile(b, 'legacy', '2026-10').rate, 100);
  assert.deepEqual(T.profile(b, 'imported', '2026-10'), { type: 'shift', rate: 0 });
});

test('legacy migration retains orphan data and snapshots historical default rates', () => {
  const legacy = { version: 1, people: { orphan: { type: 'salary', rate: 42 } }, days: { orphan: { '2026-11-01': cell(0) }, noProfile: { '2026-12-01': cell(1, false) } }, confirmed: { '2026-11': true }, overrides: { orphan: { '2026-10': 11 } } };
  const migrated = T.validateBook(legacy);
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.roster, []);
  assert.deepEqual(migrated.days, legacy.days);
  assert.deepEqual(migrated.confirmed, legacy.confirmed);
  assert.equal(migrated.profiles['2026-11'].orphan.rate, 42);
  migrated.people.orphan.rate = 100;
  assert.equal(T.totals(migrated, 'orphan', '2026-11').amount, 42);
  assert.equal(legacy.people.orphan.rate, 42);
  assert.deepEqual(T.employees(migrated, { employees: [{ id: 'orphan', name: 'Вымышленный сотрудник' }] }), [{ id: 'orphan', name: 'Вымышленный сотрудник', role: '' }]);
});

test('weekly import resolves normalized names to roster IDs, crosses months, and preserves existing cells', () => {
  const b = book(), s = schedule(), before = JSON.stringify(s);
  b.days['monthly-a'] = { '2028-02-01': cell(1.5, true, 'Проверено'), '2028-02-02': cell(0.5, false, 'Черновик') };
  const merged = T.employees(b, s);
  assert.equal(merged.length, 2);
  assert.equal(T.employeeMap(b, s).byWeeklyId['weekly-a'], 'monthly-a');
  assert.equal(T.resolveEmployee(b, s, 'weekly-a').id, 'monthly-a');
  const result = T.importWeek(b, s, '2028-01-31');
  assert.equal(result.added, 5);
  assert.equal(result.skipped, 2);
  assert.equal(result.book.days['monthly-a']['2028-01-31'].value, 1);
  assert.equal(result.book.days['monthly-a']['2028-02-01'].value, 1.5);
  assert.equal(result.book.days['monthly-a']['2028-02-02'].value, 0.5);
  assert.equal(result.book.days['monthly-a']['2028-02-03'].value, 0);
  assert.equal(result.book.days['monthly-a']['2028-02-04'].value, 0);
  assert.equal(result.book.days['monthly-a']['2028-02-06'].confirmed, false);
  assert.equal(result.book.days['weekly-a'], undefined);
  assert.equal(b.days['monthly-a']['2028-01-31'], undefined);
  assert.equal(JSON.stringify(s), before);
  assert.equal(T.importWeek(result.book, s, '2028-01-31').added, 0);
  assert.throws(() => T.importWeek(b, s, '2028-02-01'), /понедельника/);
});

test('an explicit monthly roster excludes weekly-only people without existing monthly financial data', () => {
  const b = book(), s = schedule();
  s.employees.push({ id: 'weekly-only', name: 'Тест Три', department: 'kitchen' });
  assert.deepEqual(T.employees(b, s).map(p => p.id), ['monthly-a', 'monthly-b']);
  assert.equal(T.resolveEmployee(b, s, 'weekly-only'), null);
  for (const section of ['people', 'days', 'overrides', 'profiles']) {
    const next = T.validateBook(b);
    if (section === 'people') next.people['weekly-only'] = { type: 'salary', rate: 500 };
    if (section === 'days') next.days['weekly-only'] = { '2028-02-01': cell(0.5) };
    if (section === 'overrides') next.overrides['weekly-only'] = { '2028-02': 50 };
    if (section === 'profiles') next.profiles['2028-02'] = { 'weekly-only': { type: 'shift', rate: 10 } };
    assert.deepEqual(T.employees(next, s).map(p => p.id), ['monthly-a', 'monthly-b', 'weekly-only']);
  }
  b.roster = [];
  assert.deepEqual(T.employees(b, s).map(p => p.id), ['weekly-a', 'monthly-b', 'weekly-only']);
});

test('explicit weekly import adds excluded staff only when their selected week has a known shift', () => {
  const b = book(), s = schedule();
  s.employees.push({ id: 'weekly-only', name: 'Тест Три', department: 'kitchen' }, { id: 'without-shifts', name: 'Тест Четыре', department: 'kitchen' });
  s.weeks['2028-01-31']['weekly-only'] = ['work', 'off', '', '', '', '', ''];
  s.weeks['2028-01-31']['without-shifts'] = ['unknown', '', '', '', '', '', ''];
  const result = T.importWeek(b, s, '2028-01-31');
  assert.deepEqual(result.book.roster.map(p => p.id), ['monthly-a', 'monthly-b', 'weekly-only']);
  assert.equal(result.book.days['weekly-only']['2028-01-31'].value, 1);
  assert.equal(result.book.days['weekly-only']['2028-02-01'].value, 0);
  assert.equal(result.book.days['weekly-only']['2028-01-31'].confirmed, false);
  assert.equal(result.book.days['without-shifts'], undefined);
  result.book.days['weekly-only']['2028-01-31'] = cell(1.5, true);
  const repeated = T.importWeek(result.book, s, '2028-01-31');
  assert.equal(repeated.added, 0);
  assert.equal(repeated.book.days['weekly-only']['2028-01-31'].value, 1.5);
  assert.equal(b.roster.length, 2);
  const emptyRoster = book(); emptyRoster.roster = [];
  const fallback = T.importWeek(emptyRoster, s, '2028-01-31');
  assert.equal(T.employees(fallback.book, s).length, 4);
  assert.ok(T.employees(fallback.book, s).some(p => p.id === 'without-shifts'));
});

test('validation returns independent state and rejects poisoned, nonfinite, and oversized data', () => {
  const source = book(), copy = T.validateBook(source);
  copy.roster[0].name = 'Другой';
  assert.equal(source.roster[0].name, 'Тест Один');
  for (const bad of [NaN, Infinity, -1, 10000001]) {
    const b = book(); b.people['monthly-a'].rate = bad; assert.throws(() => T.validateBook(b));
  }
  const invalidDate = book(); invalidDate.days.a = { '2028-02-30': cell(1) }; assert.throws(() => T.validateBook(invalidDate));
  const invalidNote = book(); invalidNote.days.a = { '2028-02-01': cell(1, false, 'a'.repeat(201)) }; assert.throws(() => T.validateBook(invalidNote));
  const poison = JSON.parse(JSON.stringify(book())); poison.people = JSON.parse('{"__proto__":{"type":"shift","rate":1}}'); assert.throws(() => T.validateBook(poison));
  const inherited = book(); inherited.days = Object.create({ x: {} }); assert.throws(() => T.validateBook(inherited));
  const tooMany = book(); tooMany.roster = Array.from({ length: 201 }, (_, i) => ({ id: 'fake' + i, name: 'Тест ' + i, role: '' })); assert.throws(() => T.validateBook(tooMany));
  const manyMonths = book(); manyMonths.profiles = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [T.addMonths('1900-01', i), {}])); assert.throws(() => T.validateBook(manyMonths));
  assert.equal({}.polluted, undefined);
});

test('storage keeps prior valid bytes, avoids no-op writes, and recovers without rewriting corruption', () => {
  const store = memory(), first = T.save(store, book());
  const raw = store.getItem(T.STORAGE_KEY);
  assert.equal(T.load(store).book.version, 2);
  first.updatedAt = '2000-01-01T00:00:00.000Z';
  T.save(store, first);
  assert.equal(store.writes.length, 1);
  first.people = Object.fromEntries(Object.entries(first.people).reverse());
  T.save(store, first);
  assert.equal(store.writes.length, 1);
  first.days['monthly-a'] = { '2028-02-01': cell(1) };
  T.save(store, first);
  assert.equal(store.getItem(T.BACKUP_KEY), raw);
  store.data.set(T.STORAGE_KEY, '{повреждено');
  const recovered = T.load(store);
  assert.equal(recovered.recovered, true);
  assert.match(recovered.error, /Не удалось прочитать/);
  assert.equal(store.getItem(T.STORAGE_KEY), '{повреждено');
  T.save(store, recovered.book);
  assert.equal(store.getItem(T.BACKUP_KEY), raw);
});

test('storage errors do not rotate backups or replace primary; backup failure permits successful save', () => {
  const raw = JSON.stringify(book()), store = memory({ [T.STORAGE_KEY]: raw, [T.BACKUP_KEY]: 'сохранить' });
  const next = book(); next.people['monthly-a'].rate = 99;
  store.setItem = () => { throw Error('Нет места'); };
  assert.throws(() => T.save(store, next), /Не удалось сохранить/);
  assert.equal(store.getItem(T.STORAGE_KEY), raw);
  assert.equal(store.getItem(T.BACKUP_KEY), 'сохранить');
  store.setItem = (k, v) => { if (k === T.BACKUP_KEY) throw Error('Нет места'); store.data.set(k, v); };
  assert.equal(T.save(store, next).people['monthly-a'].rate, 99);
  assert.equal(T.load(store).book.people['monthly-a'].rate, 99);
  const blocked = T.load({ getItem() { throw Error('Доступ запрещён'); } });
  assert.ok(blocked.error);
  assert.equal(blocked.recovered, false);
  assert.equal(blocked.book.version, 2);
  const corrupt = memory({ [T.STORAGE_KEY]: '{', [T.BACKUP_KEY]: '[' });
  assert.ok(T.load(corrupt).error);
  assert.equal(T.load(corrupt).recovered, false);
  assert.equal(corrupt.writes.length, 0);
});

test('replacing a corrupt primary requires preserving its original bytes first', () => {
  const corrupt = '{исходные повреждённые данные', store = memory({ [T.STORAGE_KEY]: corrupt });
  const writes = [];
  store.setItem = (key, value) => {
    writes.push(key);
    if (key === T.BACKUP_KEY) throw Error('Нет места для копии');
    store.data.set(key, value);
  };
  assert.throws(() => T.save(store, book()), /Основные данные не заменены/);
  assert.equal(store.getItem(T.STORAGE_KEY), corrupt);
  assert.deepEqual(writes, [T.BACKUP_KEY]);
  store.setItem = (key, value) => { writes.push(key); store.data.set(key, value); };
  T.save(store, book());
  assert.equal(store.getItem(T.BACKUP_KEY), corrupt);
  assert.equal(T.load(store).error, null);
  assert.deepEqual(writes.slice(-2), [T.BACKUP_KEY, T.STORAGE_KEY]);
});


test('import typo duplicates merge into upper row, archive conflicts and keep future weekly imports linked',()=>{
 const b=T.createBook('2026-11');b.roster=[{id:'excel_1',name:'Тестовский Алексей',role:'Повар'},{id:'weekly',name:'Тестовсский Алексей',role:''}];
 b.profiles['2026-11']={excel_1:{type:'shift',rate:1000},weekly:{type:'shift',rate:0}};
 b.days.excel_1={'2026-11-16':cell(1)};b.days.weekly={'2026-11-16':cell(1.5),'2026-11-17':cell(1,false,'Из графика')};
 const s={departments:[],employees:[{id:'weekly',name:'Тестовсский Алексей'}],shifts:[{id:'day',label:'10–22'}],weeks:{'2026-11-16':{weekly:['day','day','day','','','','']}}};
 const before=JSON.stringify(b),next=T.mergeImportedDuplicates(b,s);
 assert.equal(JSON.stringify(b),before);assert.equal(T.employees(next,s).length,1);assert.equal(next.roster[0].id,'excel_1');
 assert.equal(next.days.excel_1['2026-11-16'].value,1);assert.equal(next.days.excel_1['2026-11-17'].value,1);
 assert.equal(next.mergedRows.weekly.source.days.weekly['2026-11-16'].value,1.5);assert.equal(next.aliases.weekly,'excel_1');
 const imported=T.importWeek(T.validateBook(JSON.parse(JSON.stringify(next))),s,'2026-11-16').book;
 assert.equal(imported.roster.length,1);assert.equal(imported.days.excel_1['2026-11-18'].value,1);
 assert.equal(imported.days.weekly,undefined);assert.equal(T.totals(imported,'excel_1','2026-11').amount,1000);
 assert.deepEqual(T.mergeImportedDuplicates(next,s),next);
});

test('similar imported names with independent pay or ambiguous targets are never merged automatically',()=>{
 const b=T.createBook('2026-11');b.roster=[{id:'excel_1',name:'Тестовский Алексей',role:'Повар'},{id:'weekly',name:'Тестовсский Алексей',role:''}];
 const s={employees:[{id:'weekly',name:'Тестовсский Алексей'}]};b.people.weekly={type:'shift',rate:100};
 assert.equal(T.mergeImportedDuplicates(b,s).roster.length,2);
 delete b.people.weekly;b.roster.push({id:'excel_2',name:'Тестовский Алексей',role:'Повар'});
 assert.equal(T.mergeImportedDuplicates(b,s).roster.length,3);
});
