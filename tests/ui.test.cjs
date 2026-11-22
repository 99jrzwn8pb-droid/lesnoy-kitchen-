'use strict';

// DOM integration, not a browser: jsdom 31.0.1, Node.js 24.
// Layout, touch, Safari storage policy and native download/share UI need device QA.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let jsdom;
try { jsdom = require('jsdom'); }
catch { jsdom = require('/tmp/lesnoy-dom-qa/node_modules/jsdom'); }
const {JSDOM, VirtualConsole} = jsdom;
const site = require('./site-path.cjs')();
const KEY = 'lesnoy-kitchen:v1';
const ROSTER_KEY = 'lesnoy-kitchen:roster:v1';
const Core = require(require('./site-path.cjs')('core.js'));

function harness(t, shared = new Map(), initialURL = 'https://lesnoy.example/kitchen/', chooseInitialShift = true) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(fs.readFileSync(path.join(site, 'index.html'), 'utf8'), {
    url: initialURL, runScripts: 'outside-only', virtualConsole
  });
  const w = dom.window;
  let failWrites = false;
  const confirmations = [];
  const openedAt = [];
  const requests = [];
  let confirmAnswer = true;
  const storage = {
    getItem(key) { return shared.has(key) ? shared.get(key) : null; },
    setItem(key, value) {
      if (failWrites) throw new Error('QuotaExceededError: тест заполненного хранилища');
      shared.set(key, String(value));
    },
    removeItem(key) { shared.delete(key); }
  };
  Object.defineProperty(w, 'localStorage', {value: storage});
  w.TextDecoder = globalThis.TextDecoder;
  w.fetch = (...args) => { requests.push(['fetch', ...args]); throw new Error('Unexpected external request'); };
  w.XMLHttpRequest.prototype.send = function () { requests.push(['xhr']); throw new Error('Unexpected external request'); };
  w.confirm = message => { confirmations.push(message); return confirmAnswer; };
  w.HTMLDialogElement.prototype.showModal = function () { openedAt.push(w.location.href); this.setAttribute('open', ''); };
  w.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open'); this.dispatchEvent(new w.Event('close'));
  };
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.URL.createObjectURL = () => 'blob:test-only';
  w.URL.revokeObjectURL = () => {};
  const viewport=w.document.querySelector('#table-scroll');
  const table=w.document.querySelector('#schedule');
  Object.defineProperties(viewport,{
    clientWidth:{get:()=>360},clientHeight:{get:()=>400}
  });
  viewport.getBoundingClientRect=()=>({left:0,top:0,right:360,bottom:400,width:360,height:400});
  viewport.setPointerCapture=()=>{};viewport.releasePointerCapture=()=>{};
  for(const [property,value] of [['offsetWidth',1200],['scrollWidth',1200],['offsetHeight',600],['scrollHeight',600]]) {
    Object.defineProperty(table,property,{get:()=>value});
  }
  w.addEventListener('error', event => errors.push(event.error?.message || event.message));
  for (const file of ['core.js', 'png.js', 'viewport.js', 'app.js']) {
    w.eval(fs.readFileSync(path.join(site, file), 'utf8') + '\n//# sourceURL=' + file);
  }
  t.after(() => {
    w.close();
    assert.deepEqual(errors, [], 'App must not produce uncaught DOM/event errors');
  });
  const q = selector => {
    const element = w.document.querySelector(selector);
    assert.ok(element, `Expected DOM element: ${selector}`);
    return element;
  };
  const click = selector => q(selector).click();
  const pointer=(type,id,x,y,target=viewport)=>{
    const event=new w.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:type==='pointerup'?0:1});
    Object.defineProperties(event,{pointerId:{value:id},pointerType:{value:'touch'},isPrimary:{value:id===1}});
    target.dispatchEvent(event);return event;
  };
  const submit = (selector, fields) => {
    const form = q(selector);
    for (const [name, value] of Object.entries(fields)) {
      const input = form.elements.namedItem(name);
      assert.ok(input, `Missing form field: ${name}`);
      input.value = value;
    }
    form.dispatchEvent(new w.Event('submit', {bubbles: true, cancelable: true}));
  };
  const read = () => JSON.parse(shared.get(KEY));
  const setDate = value => {
    const input = q('#week-date'); input.value = value;
    input.dispatchEvent(new w.Event('change', {bubbles: true}));
  };
  const addEmployee = (name = 'Тестовый повар', phone = 'ТЕСТ-ТЕЛЕФОН') => {
    click('#add-employee');
    submit('#employee-form', {name, phone, department: 'hot'});
    return read().employees.find(person => person.name === name).id;
  };
  const cell = (person, day) => `[data-person="${person}"][data-day="${day}"]`;
  const importData = async value => {
    const file = {size: value.length, text: async () => value};
    q('#import-file').onchange({target: {files: [file], value: 'fake.json'}});
    await new Promise(resolve => setImmediate(resolve));
  };
  // Most scenarios start with the user explicitly selecting their paint tool.
  if (chooseInitialShift) w.document.querySelector('#shift-palette [data-brush]:not([data-brush=""])')?.click();
  return {w, q, click, pointer, submit, read, setDate, addEmployee, cell, importData, shared, confirmations, openedAt, requests,
    setFailWrites(value) { failWrites = value; },
    setConfirmAnswer(value) { confirmAnswer = value; }};
}

test('add employee, paint in one click, reload, and preserve both weeks without aliasing copied rows', t => {
  const h = harness(t);
  h.setDate('2026-12-30');
  assert.equal(h.read().selectedWeek, '2026-12-28');
  assert.match(h.q('#schedule-head').textContent, /03\.01/);
  const person = h.addEmployee();
  h.click('[data-brush="midday"]'); h.click(h.cell(person, 0));
  assert.equal(h.read().weeks['2026-12-28'][person][0], 'midday');
  assert.match(h.q('#save-status').textContent, /Сохранено/);
  const second = harness(t, h.shared);
  assert.equal(second.read().employees[0].phone, 'ТЕСТ-ТЕЛЕФОН');
  assert.equal(second.q(second.cell(person, 0)).getAttribute('aria-label').split(': ').at(-1), '11:30–23:30');
  second.click('#next-week');
  assert.equal(second.read().selectedWeek, '2027-01-04');
  second.click('#copy-week');
  assert.equal(second.read().weeks['2027-01-04'][person][0], 'midday');
  second.click('[data-brush="day"]'); second.click(second.cell(person, 0));
  second.click('[data-pick-shift="day"]');
  assert.equal(second.read().weeks['2027-01-04'][person][0], 'day');
  assert.equal(second.read().weeks['2026-12-28'][person][0], 'midday');
  second.click('#prev-week');
  assert.equal(second.q(second.cell(person, 0)).getAttribute('aria-label').split(': ').at(-1), '11:30–23:30');
});

function testRoster() {
  return {
    type: 'lesnoy-roster', version: 1,
    departments: [{id: 'import-cold', name: 'Холодный цех'}],
    employees: [
      {id: 'incoming-existing', name: 'Тестовый повар', phone: 'ТЕСТ-НОВЫЙ-ТЕЛЕФОН', department: 'import-cold'},
      {id: 'incoming-new', name: 'Новый тестовый сотрудник', phone: '', department: 'import-cold'}
    ]
  };
}

function legacySchedule() {
  const state = Core.createState('2026-11-16');
  delete state.presetVersion;
  state.shifts = [
    {id:'day',label:'10–22',color:'#e6eee6'},
    {id:'late',label:'12–00',color:'#e4ebf5'},
    {id:'off',label:'В',color:'#f1f0ed'},
    {id:'vacation',label:'ОТ',color:'#e8e1ef'},
    {id:'sick',label:'Б',color:'#f6e4df'}
  ];
  state.employees = [{id:'legacy-person',name:'Тестовый сотрудник из старого графика',phone:'ТЕСТ-СТАРЫЙ-ТЕЛЕФОН',department:'hot'}];
  state.weeks['2026-11-16'] = {'legacy-person':['late','off','vacation','sick','day','','']};
  state.weeks['2026-11-23'] = {'legacy-person':['day','late','','off','','','']};
  return state;
}

function paletteLabels(h, selector = '#shift-palette [data-brush]') {
  return [...h.w.document.querySelectorAll(selector)]
    .filter(button => button.dataset.brush !== '')
    .map(button => button.textContent.trim());
}

test('shift panel hides Р while minute intervals and existing saved values remain supported', t => {
  const h = harness(t);
  assert.deepEqual(paletteLabels(h),['10–22','11:30–23:30']);
  const person = h.addEmployee();
  h.click('[data-brush="midday"]'); h.click(h.cell(person,0));
  assert.deepEqual([...h.q(h.cell(person,0)).querySelectorAll('.shift-time')].map(span=>span.textContent),['11:30','23:30']);
  h.q(h.cell(person,1)).dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'1',bubbles:true,cancelable:true}));
  assert.equal(h.q('[data-brush="day"]').getAttribute('aria-pressed'),'true','The keyboard selects a visible time preset');
  h.click(h.cell(person,1));
  assert.deepEqual([...h.q(h.cell(person,1)).querySelectorAll('.shift-time')].map(span=>span.textContent),['10:00','22:00']);
  h.click(h.cell(person,0));
  assert.deepEqual(paletteLabels(h,'#dialog-body [data-pick-shift]'),['10–22','11:30–23:30']);
  h.click('#close-dialog');
  const reloaded=harness(t,h.shared);
  assert.deepEqual(paletteLabels(reloaded),['10–22','11:30–23:30']);
  assert.equal(reloaded.read().weeks[reloaded.read().selectedWeek][person][1],'day');
});

test('existing legacy selection migrates without changing historical shift values, people or weeks', t => {
  const legacy=legacySchedule();
  const shared=new Map([[KEY,JSON.stringify(legacy)]]);
  const h=harness(t,shared);
  assert.deepEqual(paletteLabels(h),['10–22','11:30–23:30']);
  const migrated=h.read();
  assert.deepEqual(migrated.employees,legacy.employees);
  assert.deepEqual(migrated.weeks,legacy.weeks);
  assert.equal(migrated.selectedWeek,legacy.selectedWeek);
  for(const old of legacy.shifts) assert.equal(migrated.shifts.find(shift=>shift.id===old.id)?.label,old.label);
  const halves=day=>[...h.q(h.cell('legacy-person',day)).querySelectorAll('.shift-time')].map(span=>span.textContent);
  assert.deepEqual(halves(0),['12:00','00:00']);
  assert.deepEqual(halves(1),['В','В']);
  assert.deepEqual(halves(2),['ОТ','ОТ']);
  assert.deepEqual(halves(3),['Б','Б']);
  assert.match(h.q('#schedule-body').textContent,/ТЕСТ-СТАРЫЙ-ТЕЛЕФОН/);
  h.click(h.cell('legacy-person',0));
  assert.deepEqual(paletteLabels(h,'#dialog-body [data-pick-shift]'),['10–22','11:30–23:30']);
  for(const id of ['late','off','vacation','sick']) assert.equal(h.w.document.querySelector(`[data-pick-shift="${id}"]`),null);
  h.click('#close-dialog');
  const after=JSON.stringify(migrated);
  const reloaded=harness(t,shared);
  assert.equal(JSON.stringify(reloaded.read()),after,'Reload migration must be idempotent');
  assert.deepEqual(paletteLabels(reloaded),['10–22','11:30–23:30']);
});

test('importing an old backup preserves archived labels and reuses an existing manual midday interval', async t => {
  const h=harness(t);
  h.addEmployee();
  const old=legacySchedule();
  old.shifts.push({id:'existing-manual',label:'11:30–23:30',color:'#e6eee6'});
  old.weeks['2026-11-16']['legacy-person'][5]='existing-manual';
  await h.importData(JSON.stringify(old));
  const imported=h.read();
  assert.deepEqual(imported.employees,old.employees);
  assert.deepEqual(imported.weeks,old.weeks);
  assert.deepEqual(paletteLabels(h),['10–22','11:30–23:30']);
  assert.equal(imported.shifts.filter(shift=>shift.label==='11:30–23:30').length,1,'The manual interval must be reused');
  h.click('[data-brush="existing-manual"]'); h.click(h.cell('legacy-person',6));
  assert.equal(h.read().weeks['2026-11-16']['legacy-person'][6],'existing-manual');
  assert.deepEqual(h.read().weeks['2026-11-16']['legacy-person'].slice(0,5),['late','off','vacation','sick','day']);
  h.click('#undo');
  assert.equal(h.read().weeks['2026-11-16']['legacy-person'][6],'');
});

test('roster file shows preview, preserves existing shifts and IDs, and can be imported repeatedly or undone', async t => {
  const h = harness(t);
  const person = h.addEmployee();
  h.setDate('2026-11-16'); h.click(h.cell(person, 2));
  const before = h.read();
  const beforeRaw = h.shared.get(KEY);
  const roster = testRoster();
  await h.importData(JSON.stringify(roster));
  assert.equal(h.shared.get(KEY), beforeRaw, 'Preview alone must not change persisted data');
  assert.equal(h.q('#editor-dialog').open, true);
  assert.match(h.q('#dialog-title').textContent, /Добавить команду/);
  assert.match(h.q('#dialog-body').textContent, /Добавится: 1, обновится: 1/);
  h.click('#confirm-roster');
  const merged = h.read();
  assert.equal(merged.employees.length, 2);
  assert.equal(merged.employees.find(p => p.name === 'Тестовый повар').id, person);
  assert.equal(merged.employees.find(p => p.id === person).phone, 'ТЕСТ-НОВЫЙ-ТЕЛЕФОН');
  assert.equal(merged.employees.find(p => p.id === person).department, 'cold');
  assert.deepEqual(merged.weeks, before.weeks);
  assert.equal(merged.selectedWeek, before.selectedWeek);
  assert.deepEqual(merged.shifts, before.shifts);
  assert.equal(h.q('#editor-dialog').open, false);
  const reloaded = harness(t, h.shared);
  assert.equal(reloaded.read().employees.length, 2);
  assert.equal(reloaded.q(reloaded.cell(person, 2)).getAttribute('aria-label').split(': ').at(-1), '10–22');
  await h.importData(JSON.stringify(roster));
  assert.match(h.q('#dialog-body').textContent, /Добавится: 0, обновится: 0/);
  h.click('#confirm-roster');
  assert.equal(h.read().employees.length, 2, 'Repeated import must not duplicate employees');
  h.click('#undo'); h.click('#undo');
  assert.equal(h.read().employees.length, 1);
  assert.equal(h.read().employees[0].phone, 'ТЕСТ-ТЕЛЕФОН');
  assert.deepEqual(h.read().weeks, before.weeks);
  assert.deepEqual(h.requests, []);
});

test('roster cancellation, invalid input and empty phone preserve current data', async t => {
  const h = harness(t);
  const person = h.addEmployee(); h.click(h.cell(person, 0));
  const beforeRaw = h.shared.get(KEY);
  await h.importData(JSON.stringify(testRoster()));
  h.click('#dialog-body [data-close]');
  assert.equal(h.shared.get(KEY), beforeRaw);
  const invalid = testRoster(); invalid.employees[1].department = 'unknown';
  await h.importData(JSON.stringify(invalid));
  assert.match(h.q('#toast').textContent, /Импорт не выполнен/);
  assert.equal(h.shared.get(KEY), beforeRaw);
  const blank = testRoster(); blank.employees[0].phone = '';
  await h.importData(JSON.stringify(blank)); h.click('#confirm-roster');
  assert.equal(h.read().employees.find(p => p.id === person).phone, 'ТЕСТ-ТЕЛЕФОН');
  assert.equal(h.read().weeks[h.read().selectedWeek][person][0], 'day');
});

test('private roster fragment is cleared before preview opens and imports only after confirmation', t => {
  const h = harness(t);
  const person = h.addEmployee(); h.click(h.cell(person, 3));
  const beforeRaw = h.shared.get(KEY);
  const encoded = Buffer.from(JSON.stringify(testRoster()), 'utf8').toString('base64url');
  h.w.history.replaceState(null, '', '/kitchen/?view=week#roster=' + encoded);
  h.w.dispatchEvent(new h.w.HashChangeEvent('hashchange'));
  assert.equal(h.w.location.hash, '');
  assert.equal(h.w.location.search, '?view=week');
  assert.equal(h.openedAt.at(-1), 'https://lesnoy.example/kitchen/?view=week');
  assert.equal(h.shared.get(KEY), beforeRaw, 'Opening a link must only show a preview');
  h.click('#confirm-roster');
  assert.equal(h.read().employees.length, 2);
  assert.equal(h.read().weeks[h.read().selectedWeek][person][3], 'day');
  assert.deepEqual(h.requests, [], 'Private roster must not be sent over the network');
});

test('startup roster fragment opens a local preview and escapes markup-like employee names', t => {
  const roster = testRoster();
  roster.employees[0].name = '<img src=x onerror=alert(1)>';
  const encoded = Buffer.from(JSON.stringify(roster), 'utf8').toString('base64url');
  const h = harness(t, new Map(), 'https://lesnoy.example/kitchen/#roster=' + encoded);
  assert.equal(h.w.location.hash, '');
  assert.equal(h.openedAt[0], 'https://lesnoy.example/kitchen/');
  assert.equal(h.q('#editor-dialog').open, true);
  assert.equal(h.q('#dialog-body').querySelector('img'), null);
  assert.match(h.q('#dialog-body').textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(h.read().employees.length, 0);
  h.click('#confirm-roster');
  assert.equal(h.read().employees.length, 2);
  assert.equal(h.read().employees[0].name, roster.employees[0].name);
  assert.deepEqual(h.requests, []);
});

test('invalid private roster links are cleared and rejected without changing saved data', t => {
  const h = harness(t);
  h.addEmployee();
  const beforeRaw = h.shared.get(KEY);
  for (const value of ['!!!', Buffer.from('{bad JSON').toString('base64url'), Buffer.from(JSON.stringify({type:'wrong'})).toString('base64url')]) {
    h.w.history.replaceState(null, '', '/kitchen/#roster=' + value);
    h.w.dispatchEvent(new h.w.HashChangeEvent('hashchange'));
    assert.equal(h.w.location.hash, '');
    assert.equal(h.shared.get(KEY), beforeRaw);
    assert.match(h.q('#toast').textContent, /Изменения не применены/);
    assert.equal(h.q('#editor-dialog').open, false);
  }
  assert.deepEqual(h.requests, []);
});

test('direct private restoration restores people, departments and phones while preserving shifts and existing IDs', t => {
  const h = harness(t);
  const person = h.addEmployee();
  const unrelated = h.addEmployee('Посторонний тестовый сотрудник', 'ТЕСТ-ПОСТОРОННИЙ');
  h.setDate('2026-11-16'); h.click(h.cell(person, 1)); h.click(h.cell(unrelated, 3));
  h.click('#next-week'); h.click(h.cell(person, 6));
  const before = h.read();
  const roster = testRoster();
  const encoded = Buffer.from(JSON.stringify(roster), 'utf8').toString('base64url');
  h.w.history.replaceState(null, '', '/kitchen/?v=recovery#restore-roster=' + encoded);
  h.w.dispatchEvent(new h.w.HashChangeEvent('hashchange'));
  const restored = h.read();
  assert.equal(h.w.location.hash, '', 'Personal recovery fragment must be removed');
  assert.equal(h.w.location.search, '?v=recovery');
  assert.equal(h.q('#editor-dialog').open, false, 'Explicit recovery link applies locally without a second confirmation');
  assert.equal(restored.employees.length, 3);
  assert.equal(restored.employees.find(p => p.name === 'Тестовый повар').id, person);
  assert.equal(restored.employees.find(p => p.id === person).phone, 'ТЕСТ-НОВЫЙ-ТЕЛЕФОН');
  assert.equal(restored.employees.find(p => p.id === person).department, 'cold');
  assert.equal(restored.employees.find(p => p.id === unrelated).phone, 'ТЕСТ-ПОСТОРОННИЙ');
  assert.deepEqual(restored.weeks, before.weeks);
  assert.deepEqual(restored.shifts, before.shifts);
  assert.equal(restored.selectedWeek, before.selectedWeek);
  assert.deepEqual(JSON.parse(h.shared.get(ROSTER_KEY)), roster);
  const reloaded = harness(t, h.shared);
  assert.deepEqual(reloaded.read().employees, restored.employees);
  assert.deepEqual(reloaded.read().weeks, before.weeks);
  assert.deepEqual(h.requests, [], 'Recovery data must stay in this browser');
});

test('startup recovery link restores the roster in a new browser store and retains a local recovery copy', t => {
  const roster = testRoster();
  const encoded = Buffer.from(JSON.stringify(roster), 'utf8').toString('base64url');
  const h = harness(t, new Map(), 'https://lesnoy.example/kitchen/?v=recovery#restore-roster=' + encoded);
  assert.equal(h.w.location.hash, '');
  assert.equal(h.read().employees.length, 2);
  assert.equal(h.read().employees[0].phone, roster.employees[0].phone);
  assert.equal(h.read().departments[0].name, roster.departments[0].name);
  assert.equal(h.q('#editor-dialog').open, false);
  assert.deepEqual(h.openedAt, [], 'Direct recovery should not open a preview modal');
  assert.deepEqual(JSON.parse(h.shared.get(ROSTER_KEY)), roster);
  assert.deepEqual(h.requests, []);
});

test('cached roster offers explicit recovery for a valid empty schedule without automatically resurrecting deleted people', async t => {
  const h = harness(t);
  const roster = testRoster();
  await h.importData(JSON.stringify(roster)); h.click('#confirm-roster');
  assert.deepEqual(JSON.parse(h.shared.get(ROSTER_KEY)), roster, 'Confirmed import should retain a separate recovery copy');
  const empty = h.read(); empty.employees = []; empty.weeks = {};
  h.shared.set(KEY, JSON.stringify(empty));
  const reloaded = harness(t, h.shared);
  assert.equal(reloaded.read().employees.length, 0, 'A valid intentionally empty primary state is respected');
  const beforeRaw = h.shared.get(KEY);
  reloaded.click('#data-menu'); reloaded.click('#roster-restore');
  assert.equal(reloaded.q('#editor-dialog').open, true);
  assert.equal(h.shared.get(KEY), beforeRaw, 'Manual recovery first shows the roster without writing');
  reloaded.click('#confirm-roster');
  assert.equal(reloaded.read().employees.length, 2);
  assert.deepEqual(JSON.parse(h.shared.get(ROSTER_KEY)), roster);
  assert.deepEqual(reloaded.requests, []);
});

test('cancelled preview and malformed or ambiguous recovery links do not create a recovery cache or change current data', async t => {
  const h = harness(t);
  h.addEmployee();
  const beforeRaw = h.shared.get(KEY);
  await h.importData(JSON.stringify(testRoster()));
  assert.equal(h.shared.has(ROSTER_KEY), false, 'Unconfirmed preview must not cache personal data');
  h.click('#dialog-body [data-close]');
  assert.equal(h.shared.has(ROSTER_KEY), false);
  assert.equal(h.shared.get(KEY), beforeRaw);
  const duplicate = testRoster(); duplicate.employees[1].name = duplicate.employees[0].name;
  const payloads = ['!!!', Buffer.from('{bad JSON').toString('base64url'), Buffer.from(JSON.stringify(duplicate)).toString('base64url')];
  for (const encoded of payloads) {
    h.w.history.replaceState(null, '', '/kitchen/#restore-roster=' + encoded);
    h.w.dispatchEvent(new h.w.HashChangeEvent('hashchange'));
    assert.equal(h.w.location.hash, '');
    assert.equal(h.shared.get(KEY), beforeRaw);
    assert.equal(h.shared.has(ROSTER_KEY), false);
    assert.equal(h.q('#editor-dialog').open, false);
  }
  assert.deepEqual(h.requests, []);
});

test('a corrupt cached roster does not prevent loading or offer an unusable recovery action', t => {
  const h = harness(t);
  h.addEmployee();
  h.shared.set(ROSTER_KEY, '{corrupt private cache');
  const reloaded = harness(t, h.shared);
  assert.equal(reloaded.read().employees.length, 1);
  reloaded.click('#data-menu');
  assert.equal(reloaded.w.document.querySelector('#roster-restore'), null);
  assert.deepEqual(reloaded.requests, []);
});

test('edit employee and create a custom shift from the cell editor', t => {
  const h = harness(t);
  const person = h.addEmployee();
  h.click(`[data-employee="${person}"]`);
  h.submit('#employee-form', {name: 'Повар после правки', phone: 'ТЕСТ-НОВЫЙ', department: 'cold'});
  assert.equal(h.read().employees[0].department, 'cold');
  assert.match(h.q(`[data-employee="${person}"]`).textContent, /после правки/);
  h.click('#edit-mode'); h.click(h.cell(person, 4));
  h.submit('#custom-shift-form', {label: '11:00–23:00'});
  const current = h.read();
  const custom = current.shifts.find(shift => shift.label === '11:00–23:00');
  assert.ok(custom, 'New custom shift should also appear in the palette');
  assert.equal(current.weeks[current.selectedWeek][person][4], custom.id);
  assert.match(h.q(h.cell(person, 4)).getAttribute('aria-label'), /11:00–23:00/);
  assert.ok(h.q(h.cell(person, 4)).closest('td').classList.contains('weekend'));
  assert.ok(h.q(h.cell(person, 5)).closest('td').classList.contains('weekend'));
  h.click(h.cell(person, 5));
  h.click('[data-pick-shift="day"]');
  assert.equal(h.read().weeks[current.selectedWeek][person][5], 'day');
});

test('paste a valid Excel range, reject unknown values atomically, then undo', t => {
  const h = harness(t);
  const person = h.addEmployee();
  const paste = text => {
    const event = new h.w.Event('paste', {bubbles: true, cancelable: true});
    Object.defineProperty(event, 'clipboardData', {value: {getData: () => text}});
    h.q(h.cell(person, 0)).dispatchEvent(event);
  };
  paste('Р\t10-22\t11:30–23:30');
  let state = h.read();
  assert.deepEqual(state.weeks[state.selectedWeek][person].slice(0, 3), ['work', 'day', 'midday']);
  const before = h.shared.get(KEY);
  paste('Р\tНЕИЗВЕСТНО');
  assert.equal(h.shared.get(KEY), before);
  assert.match(h.q('#toast').textContent, /Неизвестная смена/);
  h.click('#undo');
  state = h.read();
  assert.ok(!state.weeks[state.selectedWeek]?.[person]);
});

test('JSON import validates first, preserves state on rejection, imports all data and supports undo', async t => {
  const h = harness(t);
  h.addEmployee();
  const before = h.shared.get(KEY);
  await h.importData('{bad JSON');
  assert.equal(h.shared.get(KEY), before);
  assert.match(h.q('#toast').textContent, /Импорт не выполнен/);
  const invalid = h.read(); invalid.weeks[invalid.selectedWeek] = {unknown_person: Array(7).fill('day')};
  await h.importData(JSON.stringify(invalid));
  assert.equal(h.shared.get(KEY), before);
  assert.equal(h.confirmations.length, 0, 'Invalid input must be rejected before overwrite confirmation');
  const incoming = h.read();
  incoming.employees[0].name = 'Импортированный тестовый повар';
  incoming.weeks[incoming.selectedWeek] = {[incoming.employees[0].id]: ['day', 'work', '', '', '', '', '']};
  await h.importData(JSON.stringify(incoming));
  assert.equal(h.read().employees[0].name, incoming.employees[0].name);
  assert.equal(h.read().weeks[incoming.selectedWeek][incoming.employees[0].id][1], 'work');
  assert.equal(h.confirmations.length, 1);
  h.click('#undo');
  assert.equal(h.read().employees[0].name, 'Тестовый повар');
});

test('cancel copy/import preserves current data, and non-Monday selection normalizes dates', async t => {
  const h = harness(t);
  const person = h.addEmployee();
  h.setDate('2026-11-16'); h.click(h.cell(person, 0));
  h.click('#next-week'); h.click(h.cell(person, 0));
  const before = h.shared.get(KEY);
  h.setConfirmAnswer(false); h.click('#copy-week');
  assert.equal(h.shared.get(KEY), before);
  await h.importData(before);
  assert.equal(h.shared.get(KEY), before);
  assert.equal(h.confirmations.length, 2);
  h.setDate('2026-11-25');
  assert.equal(h.read().selectedWeek, '2026-11-23');
});

test('quota failure never claims saved success and keeps in-memory edits exportable', t => {
  const h = harness(t);
  const person = h.addEmployee();
  const persistedBefore = h.shared.get(KEY);
  h.setFailWrites(true);
  h.click(h.cell(person, 1));
  assert.equal(h.shared.get(KEY), persistedBefore, 'Failed write must leave persisted state unchanged');
  assert.equal(h.q('#save-status').textContent, 'Не сохранено');
  assert.match(h.q('#toast').textContent, /не сохранены/);
  assert.equal(h.q('#storage-warning').hidden, false);
  assert.match(h.q('#storage-warning').textContent, /JSON/);
  assert.equal(h.q(h.cell(person, 1)).getAttribute('aria-label').split(': ').at(-1), '10–22', 'Edit remains in memory');
  h.setFailWrites(false);
  h.click(h.cell(person, 2));
  const recovered = h.read();
  assert.equal(recovered.weeks[recovered.selectedWeek][person][1], 'day');
  assert.equal(recovered.weeks[recovered.selectedWeek][person][2], 'day');
  assert.equal(h.q('#save-status').textContent, 'Сохранено в браузере');
});

test('external-tab change freezes writes and calendar boundaries report a useful message', t => {
  const h = harness(t);
  const person = h.addEmployee();
  h.setDate('1900-01-01');
  h.click('#prev-week');
  assert.match(h.q('#toast').textContent, /граница календаря/);
  const before = h.shared.get(KEY);
  h.w.dispatchEvent(new h.w.StorageEvent('storage', {key: KEY, newValue: before}));
  h.click(h.cell(person, 0));
  assert.equal(h.shared.get(KEY), before);
  assert.equal(h.q('#save-status').textContent, 'Другая вкладка');
  assert.match(h.q('#storage-warning').textContent, /приостановлено/);
});

test('PNG button automatically exports high quality with phones and no option switches', async t => {
  const h = harness(t);
  const person = h.addEmployee(); h.click(h.cell(person, 0));
  let native;
  try { native = require('@napi-rs/canvas'); }
  catch { native = require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas'); }
  const make = h.w.document.createElement.bind(h.w.document);
  const encoded = [];
  h.w.document.createElement = (tag, options) => {
    if (String(tag).toLowerCase() !== 'canvas') return make(tag, options);
    const canvas = native.createCanvas(1, 1);
    canvas.toBlob = callback => {
      const bytes = canvas.toBuffer('image/png'); encoded.push(bytes);
      callback(new h.w.Blob([bytes], {type: 'image/png'}));
    };
    return canvas;
  };
  h.click('#export-png');
  for (let i=0; i<100 && h.q('#png-save').hidden; i++) await new Promise(resolve => setTimeout(resolve,10));
  assert.equal(h.q('#png-save').hidden, false);
  assert.equal(h.q('#png-preview').hidden, false);
  assert.match(h.q('#png-save').download, /^lesnoy-grafik-\d{4}-\d{2}-\d{2}-a4\.png$/);
  assert.match(h.q('#png-status').textContent, /Вся таблица.*px$/);
  assert.equal(encoded.length, 1);
  assert.deepEqual([...encoded[0].subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const image = await native.loadImage(encoded[0]);
  assert.equal(image.width, 4800);
  assert.equal(h.w.document.querySelector('#png-phones'), null);
  assert.equal(h.w.document.querySelector('#png-print'), null);
  h.click('#close-dialog');
  assert.equal(h.q('#editor-dialog').open, false);
});

test('filled cell opens editing without changing data, and explicit deletion affects one day with undo and reload', t => {
  const h = harness(t);
  const first = h.addEmployee('Первый тестовый повар');
  const second = h.addEmployee('Второй тестовый повар');
  h.setDate('2026-11-16');
  h.click(h.cell(first, 0)); h.click(h.cell(first, 1)); h.click(h.cell(second, 0));
  h.click('#next-week'); h.click(h.cell(first, 0)); h.click('#prev-week');
  h.click('[data-brush="midday"]');
  const before = h.read();
  const beforeRaw = h.shared.get(KEY);
  h.click(h.cell(first, 0));
  assert.equal(h.q('#editor-dialog').open, true);
  assert.equal(h.shared.get(KEY), beforeRaw, 'Opening a filled cell must not repaint it');
  assert.match(h.q('#delete-cell-shift').textContent, /Удалить смену/);
  h.click('#delete-cell-shift');
  const cleared = h.read();
  assert.equal(cleared.weeks['2026-11-16'][first][0], '');
  assert.equal(cleared.weeks['2026-11-16'][first][1], 'day');
  assert.equal(cleared.weeks['2026-11-16'][second][0], 'day');
  assert.deepEqual(cleared.weeks['2026-11-23'], before.weeks['2026-11-23']);
  assert.deepEqual(cleared.employees, before.employees);
  assert.equal(h.q('#editor-dialog').open, false);
  const reloaded = harness(t, h.shared);
  assert.equal(reloaded.read().weeks['2026-11-16'][first][0], '');
  h.click('#undo');
  assert.equal(h.read().weeks['2026-11-16'][first][0], 'day');
});

test('erase brush deletes a filled cell in one click and Delete key keeps working', t => {
  const h = harness(t);
  const person = h.addEmployee();
  h.click(h.cell(person, 0)); h.click(h.cell(person, 1));
  h.click('[data-brush=""]'); h.click(h.cell(person, 0));
  let state = h.read();
  assert.equal(state.weeks[state.selectedWeek][person][0], '');
  assert.equal(h.q('#editor-dialog').open, false);
  h.q(h.cell(person, 1)).dispatchEvent(new h.w.KeyboardEvent('keydown', {key:'Delete',bubbles:true,cancelable:true}));
  state = h.read();
  assert.equal(state.weeks[state.selectedWeek][person][1], '');
});

test('manual interval saves selected minutes, preserves other data, and prefills when reopened', t => {
  const h = harness(t);
  const person = h.addEmployee();
  h.setDate('2026-11-16'); h.click(h.cell(person, 0));
  h.click('#next-week'); h.click(h.cell(person, 0)); h.click('#prev-week');
  const before = h.read();
  h.click('#edit-mode'); h.click(h.cell(person, 3));
  assert.equal(h.q('#interval-form [name="start"]').type, 'time');
  assert.equal(h.q('#interval-form [name="end"]').type, 'time');
  h.submit('#interval-form', {start:'11:30',end:'23:30'});
  const current = h.read();
  const manual = current.shifts.find(shift => shift.label === '11:30–23:30');
  assert.ok(manual, 'Saved interval must include minutes');
  assert.equal(current.weeks['2026-11-16'][person][3], manual.id);
  assert.equal(current.weeks['2026-11-16'][person][0], 'day');
  assert.deepEqual(current.weeks['2026-11-23'], before.weeks['2026-11-23']);
  assert.deepEqual(current.employees, before.employees);
  h.click('#edit-mode'); // Return to quick fill; occupied cells still open their editor.
  h.click(h.cell(person, 3));
  assert.equal(h.q('#interval-form [name="start"]').value, '11:30');
  assert.equal(h.q('#interval-form [name="end"]').value, '23:30');
  h.click('#close-dialog');
  const reloaded = harness(t, h.shared);
  assert.match(reloaded.q(reloaded.cell(person, 3)).getAttribute('aria-label'), /11:30–23:30/);
});

test('overnight interval is explicit and reuses an existing interval rather than duplicating it', t => {
  const h = harness(t);
  const person = h.addEmployee();
  h.click('#edit-mode'); h.click(h.cell(person, 4));
  for (const [name,value] of Object.entries({start:'15:30',end:'03:30'})) {
    const input = h.q(`#interval-form [name="${name}"]`);
    input.value = value; input.dispatchEvent(new h.w.Event('input', {bubbles:true}));
  }
  assert.match(h.q('#interval-summary').textContent, /следующ|завтра|ноч/i);
  h.submit('#interval-form', {start:'15:30',end:'03:30'});
  const first = h.read();
  const night = first.shifts.find(shift => shift.label === '15:30–03:30');
  assert.ok(night);
  assert.equal(first.weeks[first.selectedWeek][person][4], night.id);
  h.click(h.cell(person, 5));
  h.submit('#interval-form', {start:'15:30',end:'03:30'});
  const repeated = h.read();
  assert.equal(repeated.shifts.length, first.shifts.length);
  assert.equal(repeated.weeks[repeated.selectedWeek][person][5], night.id);
});

test('manual editor rejects equal or missing times and reuses a short existing interval', t => {
  const h = harness(t);
  const person = h.addEmployee();
  h.click('#edit-mode'); h.click(h.cell(person, 2));
  const beforeRaw = h.shared.get(KEY);
  h.submit('#interval-form', {start:'10:00',end:'10:00'});
  assert.equal(h.shared.get(KEY), beforeRaw);
  assert.equal(h.q('#editor-dialog').open, true);
  assert.ok(h.q('#interval-form .form-error').textContent.trim(), 'Equal time must explain validation failure');
  h.submit('#interval-form', {start:'',end:'22:00'});
  assert.equal(h.shared.get(KEY), beforeRaw);
  assert.ok(h.q('#interval-form .form-error').textContent.trim());
  const count = h.read().shifts.length;
  h.submit('#interval-form', {start:'10:00',end:'22:00'});
  const reused = h.read();
  assert.equal(reused.shifts.length, count);
  assert.equal(reused.weeks[reused.selectedWeek][person][2], 'day');
  h.click(h.cell(person, 2));
  assert.equal(h.q('#interval-form [name="start"]').value, '10:00');
  assert.equal(h.q('#interval-form [name="end"]').value, '22:00');
});

test('full shift catalog rejects a new interval without losing data but allows an existing interval', async t => {
  const h = harness(t);
  const person = h.addEmployee();
  h.click('[data-brush="midday"]'); h.click(h.cell(person, 0));
  const full = h.read();
  for (let index = full.shifts.length; index < 30; index++) {
    full.shifts.push({id:`test-shift-${index}`,label:`Тестовая смена ${index}`,color:'#e6eee6'});
  }
  await h.importData(JSON.stringify(full));
  assert.equal(h.read().shifts.length, 30);
  const beforeRaw = h.shared.get(KEY);
  h.click(h.cell(person, 0));
  h.submit('#interval-form', {start:'11:17',end:'23:19'});
  assert.equal(h.shared.get(KEY), beforeRaw, 'Catalog limit must not partially replace the existing shift');
  assert.equal(h.q('#editor-dialog').open, true);
  assert.match(h.q('#interval-form .form-error').textContent, /30/);
  h.submit('#interval-form', {start:'10:00',end:'22:00'});
  const existing = h.read();
  assert.equal(existing.shifts.length, 30);
  assert.equal(existing.weeks[existing.selectedWeek][person][0], 'day');
  assert.equal(h.q('#editor-dialog').open, false);
});

test('Excel table keeps merged headers and department cells while displaying start and end separately', t => {
  const h = harness(t);
  const person = h.addEmployee();
  h.setDate('2026-09-14');
  const heading = h.q('#schedule-head');
  assert.equal(heading.querySelectorAll('tr').length,3,'Title, weekday and date rows must be separate');
  assert.match(heading.textContent,/График кухни.*ЛЕСНОЙ/);
  assert.equal(heading.querySelector('.sheet-title').colSpan,16);
  for (const day of ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье']) {
    assert.ok(heading.textContent.includes(day),`Full Russian weekday missing: ${day}`);
  }
  for (const day of [14,15,16,17,18,19,20]) assert.ok(heading.textContent.includes(`${day}.09.2026`));
  assert.equal([...h.q('#schedule colgroup').querySelectorAll('col')].reduce((sum,col)=>sum+col.span,0),16);
  const department=h.q('#schedule-body .department-row');
  assert.equal(department.querySelector('th').colSpan,2,'Only employee and phone columns are merged');
  assert.equal(department.querySelectorAll('td').length,7,'Calendar grid continues across department rows');
  assert.equal(department.querySelectorAll('td.weekend').length,2);
  h.click(h.cell(person,0));
  const halves=(day)=>[...h.q(h.cell(person,day)).querySelectorAll('.shift-time')].map(span=>span.textContent);
  assert.deepEqual(halves(0),['10:00','22:00']);
  assert.equal(h.q(h.cell(person,0)).closest('td').colSpan,2);
  assert.match(h.q(h.cell(person,0)).getAttribute('aria-label'),/10–22/);
  h.click(h.cell(person,1));
  assert.deepEqual(halves(1),['10:00','22:00']);
  assert.equal(h.q(h.cell(person,2)).textContent.trim(),'','Empty Excel cells should remain blank');
  h.click('#edit-mode');h.click(h.cell(person,4));
  h.submit('#interval-form',{start:'17:30',end:'03:30'});
  assert.deepEqual(halves(4),['17:30','03:30']);
  assert.ok(h.q(h.cell(person,4)).closest('td').classList.contains('weekend'));
  assert.ok(h.q(h.cell(person,5)).closest('td').classList.contains('weekend'));
  assert.equal((h.w.document.querySelector('#schedule-foot')?.textContent||'').trim(),'','The exported-style table has no additional totals row');
});

test('table zoom controls change a unified surface without modifying employees, phones or shifts',t=>{
  const h=harness(t);const person=h.addEmployee();h.click(h.cell(person,0));
  const before=h.shared.get(KEY);
  const percentage=()=>Number.parseInt(h.q('#zoom-level').textContent,10);
  const initial=percentage();assert.ok(initial>0&&initial<=100);
  h.click('#zoom-in');const larger=percentage();assert.ok(larger>initial,'Plus zooms in');
  h.click('#zoom-out');assert.ok(percentage()<larger,'Minus zooms out');
  h.click('#zoom-in');h.click('#zoom-fit');assert.equal(percentage(),initial,'Fit returns to the complete table');
  assert.match(h.q('#schedule-surface').style.transform,/scale/);
  assert.equal(h.shared.get(KEY),before,'Zoom must not write to the schedule');
  assert.equal(h.q('#schedule-surface').contains(h.q('#schedule-head')),true,'Header shares the same surface');
  assert.equal(h.q('#schedule-surface').contains(h.q(`[data-employee="${person}"]`)),true,'Names share the same surface');
});

test('dragging or pinching the table never accidentally paints a shift',t=>{
  const h=harness(t);const person=h.addEmployee();const cell=h.q(h.cell(person,0));
  const before=h.shared.get(KEY);
  h.pointer('pointerdown',1,150,200,cell);
  h.pointer('pointermove',1,190,230);
  h.pointer('pointerup',1,190,230);
  cell.click();
  assert.equal(h.shared.get(KEY),before,'Post-drag synthetic click must be ignored');
  assert.equal(h.q('#editor-dialog').open,false);
  h.pointer('pointerdown',1,130,200,cell);h.pointer('pointerdown',2,230,200,cell);
  h.pointer('pointermove',1,90,200);h.pointer('pointermove',2,270,200);
  h.pointer('pointerup',1,90,200);h.pointer('pointerup',2,270,200);
  cell.click();
  assert.equal(h.shared.get(KEY),before,'Post-pinch synthetic click must be ignored');
  assert.equal(h.q('#editor-dialog').open,false);
  h.click('#zoom-fit');
  assert.equal(h.shared.get(KEY),before,'Controls outside the gesture surface stay usable');
});

function applyContactLink(h, contact) {
  const encoded=Buffer.from(JSON.stringify(contact),'utf8').toString('base64url');
  h.w.history.replaceState(null,'','/kitchen/?contact=update#contact='+encoded);
  h.w.dispatchEvent(new h.w.HashChangeEvent('hashchange'));
}

test('private contact update changes one phone and its recovery copy while preserving every schedule and employee ID', t => {
  const h=harness(t);
  const person=h.addEmployee();
  const other=h.addEmployee('Другой тестовый сотрудник','ТЕСТ-ДРУГОЙ-ТЕЛЕФОН');
  h.setDate('2026-11-16');h.click(h.cell(person,0));h.click(h.cell(other,2));
  h.click('#next-week');h.click('[data-brush="day"]');h.click(h.cell(person,3));
  const before=h.read();
  const roster={type:'lesnoy-roster',version:1,departments:before.departments,employees:before.employees};
  h.shared.set(ROSTER_KEY,JSON.stringify(roster));
  const originalSet=h.w.localStorage.setItem;
  h.w.localStorage.setItem=(key,value)=>{
    if(key===KEY)assert.equal(h.w.location.hash,'','Contact fragment must be removed before saving');
    originalSet(key,value);
  };
  applyContactLink(h,{type:'lesnoy-contact',version:1,name:'  ТЕСТОВЫЙ   ПОВАР  ',phone:'ТЕСТ-ОБНОВЛЁННЫЙ-ТЕЛЕФОН'});
  const after=h.read();
  const expected=before.employees.map(p=>p.id===person?{...p,phone:'ТЕСТ-ОБНОВЛЁННЫЙ-ТЕЛЕФОН'}:p);
  assert.deepEqual(after.employees,expected,'Only the intended phone may change; employee IDs and ordering stay intact');
  assert.deepEqual(after.departments,before.departments);
  assert.deepEqual(after.weeks,before.weeks);
  assert.deepEqual(after.shifts,before.shifts);
  assert.equal(after.selectedWeek,before.selectedWeek);
  assert.equal(h.w.location.hash,'');
  assert.equal(h.q('#editor-dialog').open,false);
  const cached=JSON.parse(h.shared.get(ROSTER_KEY));
  assert.deepEqual(cached.employees,expected);
  h.click('#data-menu');h.click('#roster-restore');h.click('#confirm-roster');
  assert.equal(h.read().employees.find(p=>p.id===person).phone,'ТЕСТ-ОБНОВЛЁННЫЙ-ТЕЛЕФОН','Recovery must not restore the old phone');
  const reloaded=harness(t,h.shared);
  assert.deepEqual(reloaded.read().employees,expected);
  assert.deepEqual(reloaded.read().weeks,before.weeks);
  assert.deepEqual(h.requests,[]);
});

test('startup contact link can seed an empty browser from a private roster and cache the updated phone', t => {
  const roster=testRoster();
  const contact={type:'lesnoy-contact',version:1,name:'Тестовый повар',phone:'ТЕСТ-НОМЕР-ДЛЯ-НОВОГО-БРАУЗЕРА',roster};
  const encoded=Buffer.from(JSON.stringify(contact),'utf8').toString('base64url');
  const h=harness(t,new Map(),'https://lesnoy.example/kitchen/#contact='+encoded);
  assert.equal(h.w.location.hash,'');
  assert.equal(h.q('#editor-dialog').open,false);
  assert.equal(h.read().employees.length,2);
  assert.equal(h.read().employees.find(p=>p.name==='Тестовый повар').phone,contact.phone);
  assert.equal(h.read().employees.find(p=>p.name==='Новый тестовый сотрудник').phone,'');
  assert.equal(JSON.parse(h.shared.get(ROSTER_KEY)).employees.find(p=>p.name==='Тестовый повар').phone,contact.phone);
  assert.deepEqual(h.requests,[]);
});

test('invalid, missing or ambiguous private contacts leave saved data and the recovery cache untouched', t => {
  const h=harness(t);
  h.addEmployee();h.click(h.cell(h.read().employees[0].id,0));
  const roster={type:'lesnoy-roster',version:1,departments:h.read().departments,employees:h.read().employees};
  h.shared.set(ROSTER_KEY,JSON.stringify(roster));
  const before=h.shared.get(KEY),cacheBefore=h.shared.get(ROSTER_KEY);
  for(const contact of [
    {type:'wrong',version:1,name:'Тестовый повар',phone:'ТЕСТ'},
    {type:'lesnoy-contact',version:2,name:'Тестовый повар',phone:'ТЕСТ'},
    {type:'lesnoy-contact',version:1,name:'Тестовый повар',phone:123},
    {type:'lesnoy-contact',version:1,name:'Неизвестный сотрудник',phone:'ТЕСТ',roster:testRoster()}
  ]){
    applyContactLink(h,contact);
    assert.equal(h.w.location.hash,'');
    assert.equal(h.shared.get(KEY),before);
    assert.equal(h.shared.get(ROSTER_KEY),cacheBefore);
    assert.match(h.q('#toast').textContent,/Изменения не применены/);
  }
  h.addEmployee('Тестовый повар','ТЕСТ-ОДНОФАМИЛЕЦ');
  const ambiguousBefore=h.shared.get(KEY);
  applyContactLink(h,{type:'lesnoy-contact',version:1,name:'Тестовый повар',phone:'ТЕСТ-НОВЫЙ'});
  assert.equal(h.w.location.hash,'');
  assert.equal(h.shared.get(KEY),ambiguousBefore,'Ambiguous full names must not choose an arbitrary employee');
  assert.equal(h.shared.get(ROSTER_KEY),cacheBefore);
  assert.match(h.q('#toast').textContent,/Изменения не применены/);
  assert.deepEqual(h.requests,[]);
});

test('a saved +7 phone is formatted on normal startup without a private link and remains stable after reload', t => {
  const source=Core.createState('2026-11-16');
  source.employees=[
    {id:'format-person',name:'Тестовый повар с международным номером',phone:'+7 (000) 000-00-01',department:'hot'},
    {id:'existing-national',name:'Тестовый повар с обычным номером',phone:'8-000-000-00-22',department:'cold'},
    {id:'existing-grouping',name:'Тестовый повар с другим разбиением',phone:'8-000-00-00-033',department:'prep'},
    {id:'foreign-number',name:'Тестовый зарубежный номер',phone:'+44 20 0000 0000',department:'cold'},
    {id:'short-number',name:'Тестовый короткий номер',phone:'+7 000',department:'hot'},
    {id:'text-number',name:'Тестовое обозначение телефона',phone:'ТЕСТ-ТЕЛЕФОН',department:'hot'}
  ];
  source.weeks[source.selectedWeek]={'format-person':['day','work','midday','','','','']};
  source.weeks['2026-11-23']={'existing-national':['work','','day','','','','']};
  const shared=new Map([[KEY,JSON.stringify(source)]]);
  const h=harness(t,shared);
  const expected=source.employees.map(person=>person.id==='format-person'?{...person,phone:'8-000-000-00-01'}:person);
  assert.deepEqual(h.read().employees,expected,'Only the complete +7 phone may change; existing 8/foreign/short/text values stay exact');
  assert.deepEqual(h.read().departments,source.departments);
  assert.deepEqual(h.read().weeks,source.weeks);
  assert.deepEqual(h.read().shifts,source.shifts);
  assert.equal(h.read().selectedWeek,source.selectedWeek);
  assert.match(h.q('#schedule-body').textContent,/8-000-000-00-01/);
  assert.equal(h.q('#schedule-body a[href="tel:80000000001"]').textContent,'8-000-000-00-01');
  const saved=shared.get(KEY),backup=shared.get(KEY+':backup');
  const reloaded=harness(t,shared);
  assert.deepEqual(reloaded.read().employees,expected);
  assert.equal(shared.get(KEY),saved,'Formatting must not rewrite an already formatted schedule on every load');
  assert.equal(shared.get(KEY+':backup'),backup,'Repeated load must retain the useful previous backup');
  assert.deepEqual(h.requests,[]);
});

test('phone entry and an older +7 contact link cannot restore international formatting', t => {
  const h=harness(t);
  const person=h.addEmployee('Тестовый повар','+7 000 000 00 02');
  assert.equal(h.read().employees.find(p=>p.id===person).phone,'8-000-000-00-02');
  h.click(h.cell(person,0));
  const weeks=h.read().weeks;
  h.shared.set(ROSTER_KEY,JSON.stringify({type:'lesnoy-roster',version:1,departments:h.read().departments,employees:h.read().employees}));
  applyContactLink(h,{type:'lesnoy-contact',version:1,name:'Тестовый повар',phone:'+7(000)000-00-03'});
  assert.equal(h.read().employees.find(p=>p.id===person).phone,'8-000-000-00-03');
  assert.equal(JSON.parse(h.shared.get(ROSTER_KEY)).employees.find(p=>p.id===person).phone,'8-000-000-00-03');
  assert.deepEqual(h.read().weeks,weeks);
  h.click(`[data-employee="${person}"]`);
  h.submit('#employee-form',{name:'Тестовый повар',phone:'+7-000-000-00-04',department:'hot'});
  assert.equal(h.read().employees.find(p=>p.id===person).phone,'8-000-000-00-04');
  const reloaded=harness(t,h.shared);
  assert.equal(reloaded.read().employees.find(p=>p.id===person).phone,'8-000-000-00-04');
  assert.deepEqual(reloaded.read().weeks,weeks);
  assert.deepEqual(h.requests,[]);
});

test('restoring an older cached roster does not reintroduce its +7 phone', t => {
  const h=harness(t);
  const person=h.addEmployee('Тестовый повар','8-000-000-00-05');
  h.click(h.cell(person,2));
  const before=h.read();
  const roster={type:'lesnoy-roster',version:1,departments:before.departments,employees:before.employees.map(p=>({...p,phone:'+7 (000) 000-00-05'}))};
  h.shared.set(ROSTER_KEY,JSON.stringify(roster));
  h.click('#data-menu');h.click('#roster-restore');
  assert.match(h.q('#dialog-body').textContent,/8-000-000-00-05/,'Recovery preview should show the final national format');
  h.click('#confirm-roster');
  assert.equal(h.read().employees.find(p=>p.id===person).phone,'8-000-000-00-05');
  assert.equal(JSON.parse(h.shared.get(ROSTER_KEY)).employees.find(p=>p.id===person).phone,'8-000-000-00-05');
  assert.deepEqual(h.read().weeks,before.weeks);
  assert.deepEqual(h.read().departments,before.departments);
});

test('backup and roster imports normalize complete +7 phones while preserving saved shifts and other numbers', async t => {
  const h=harness(t);
  const person=h.addEmployee('Тестовый повар','8-000-000-00-06');
  h.click(h.cell(person,4));
  const backup=h.read();backup.employees[0].phone='+7 000 000 00 07';
  await h.importData(JSON.stringify(backup));
  assert.equal(h.read().employees.find(p=>p.id===person).phone,'8-000-000-00-07');
  assert.deepEqual(h.read().weeks,backup.weeks);
  const roster=testRoster();
  roster.employees[0].phone='+7 (000) 000-00-08';
  roster.employees[1].phone='8-000-00-00-099';
  await h.importData(JSON.stringify(roster));h.click('#confirm-roster');
  assert.equal(h.read().employees.find(p=>p.id===person).phone,'8-000-000-00-08');
  assert.equal(h.read().employees.find(p=>p.name==='Новый тестовый сотрудник').phone,'8-000-00-00-099');
  assert.equal(JSON.parse(h.shared.get(ROSTER_KEY)).employees.find(p=>p.name==='Тестовый повар').phone,'8-000-000-00-08');
  assert.deepEqual(h.read().weeks,backup.weeks);
  assert.deepEqual(h.requests,[]);
});

function applyWeekLink(h, schedule) {
  const encoded=Buffer.from(JSON.stringify(schedule),'utf8').toString('base64url');
  h.w.history.replaceState(null,'','/kitchen/?week=update#week='+encoded);
  h.w.dispatchEvent(new h.w.HashChangeEvent('hashchange'));
}

test('private week link copies named rows including blanks while preserving other weeks, people and contacts', t => {
  const h=harness(t);
  const person=h.addEmployee('Тестовый повар первой строки','ТЕСТ-ПЕРВЫЙ-ТЕЛЕФОН');
  const other=h.addEmployee('Тестовый повар другой строки','ТЕСТ-ДРУГОЙ-ТЕЛЕФОН');
  h.setDate('2026-11-16');h.click(h.cell(person,0));h.click(h.cell(person,1));h.click(h.cell(other,4));
  h.setDate('2026-11-23');h.click('[data-brush="day"]');h.click(h.cell(person,6));
  const before=h.read();
  const recovery={type:'lesnoy-roster',version:1,departments:before.departments,employees:before.employees};
  h.shared.set(ROSTER_KEY,JSON.stringify(recovery));
  const cacheBefore=h.shared.get(ROSTER_KEY);
  const originalSet=h.w.localStorage.setItem;
  h.w.localStorage.setItem=(key,value)=>{
    if(key===KEY)assert.equal(h.w.location.hash,'','Private week data must be cleared from the address before save');
    originalSet(key,value);
  };
  const schedule={type:'lesnoy-week',version:1,week:'2026-11-16',rows:[{
    name:'  ТЕСТОВЫЙ   ПОВАР ПЕРВОЙ СТРОКИ  ',
    shifts:['10:00–22:00','','15:30–03:30','Р','','11:30–23:30','']
  }]};
  applyWeekLink(h,schedule);
  const after=h.read();
  const labels=new Map(after.shifts.map(shift=>[shift.id,shift.label]));
  const row=after.weeks[schedule.week][person];
  assert.equal(row[0],'day','Equivalent full-time label must reuse the existing day shift');
  assert.deepEqual(row.map(id=>id?labels.get(id):''),['10–22','','15:30–03:30','Р','','11:30–23:30','']);
  assert.equal(after.shifts.filter(shift=>shift.label==='15:30–03:30').length,1);
  assert.deepEqual(after.weeks['2026-11-23'],before.weeks['2026-11-23']);
  assert.deepEqual(after.weeks[schedule.week][other],before.weeks[schedule.week][other]);
  assert.deepEqual(after.employees,before.employees);
  assert.deepEqual(after.departments,before.departments);
  assert.equal(after.selectedWeek,schedule.week);
  assert.equal(h.shared.get(ROSTER_KEY),cacheBefore,'Applying shifts must not rewrite the recovery contacts');
  assert.equal(h.w.location.hash,'');assert.equal(h.q('#editor-dialog').open,false);
  assert.match(h.q('#schedule-head').textContent,/16\.11\.2026/);
  assert.match(h.q('#schedule-head').textContent,/22\.11\.2026/);
  assert.deepEqual([...h.q(h.cell(person,2)).querySelectorAll('.shift-time')].map(x=>x.textContent),['15:30','03:30']);
  assert.equal(h.q(h.cell(person,1)).textContent.trim(),'','A blank from the imported row must clear the previously filled day');
  const reloaded=harness(t,h.shared);
  assert.deepEqual(reloaded.read().weeks,after.weeks);
  h.click('#undo');
  assert.deepEqual(h.read().weeks,before.weeks);
  assert.deepEqual(h.read().employees,before.employees);
  assert.deepEqual(h.requests,[]);
});

test('startup week link seeds an empty browser with a private roster and then applies its selected week', t => {
  const roster=testRoster();
  const schedule={type:'lesnoy-week',version:1,week:'2026-11-16',roster,rows:[
    {name:roster.employees[0].name,shifts:['Р','','10–22','','','','11:30–23:30']},
    {name:roster.employees[1].name,shifts:['','15:30–03:30','','','','','']}
  ]};
  const encoded=Buffer.from(JSON.stringify(schedule),'utf8').toString('base64url');
  const h=harness(t,new Map(),'https://lesnoy.example/kitchen/#week='+encoded);
  const after=h.read();
  assert.equal(after.employees.length,2);
  for(const person of roster.employees){
    const actual=after.employees.find(p=>p.name===person.name);
    assert.ok(actual);assert.equal(actual.phone,person.phone);
    assert.equal(after.weeks[schedule.week][actual.id].length,7);
  }
  assert.equal(after.selectedWeek,schedule.week);
  assert.equal(h.w.location.hash,'');assert.equal(h.q('#editor-dialog').open,false);
  assert.ok(h.shared.get(ROSTER_KEY),'A freshly seeded roster must remain available for local recovery');
  assert.deepEqual(h.requests,[]);
});

test('invalid private week data is rejected atomically after its address fragment is removed', t => {
  const h=harness(t);const person=h.addEmployee();h.click(h.cell(person,0));
  const recovery={type:'lesnoy-roster',version:1,departments:h.read().departments,employees:h.read().employees};
  h.shared.set(ROSTER_KEY,JSON.stringify(recovery));
  const before=h.shared.get(KEY),cacheBefore=h.shared.get(ROSTER_KEY);
  const validRow={name:'Тестовый повар',shifts:['10–22','','','','','','']};
  const cases=[
    {type:'wrong',version:1,week:'2026-11-16',rows:[validRow]},
    {type:'lesnoy-week',version:2,week:'2026-11-16',rows:[validRow]},
    {type:'lesnoy-week',version:1,week:'2026-11-17',rows:[validRow]},
    {type:'lesnoy-week',version:1,week:'2026-11-16',rows:[{...validRow,name:'Неизвестный тестовый повар'}],roster:testRoster()},
    {type:'lesnoy-week',version:1,week:'2026-11-16',rows:[validRow,{...validRow,name:'  ТЕСТОВЫЙ   ПОВАР '}]},
    {type:'lesnoy-week',version:1,week:'2026-11-16',rows:[{...validRow,shifts:['10–22']}]}
  ];
  for(const schedule of cases){
    applyWeekLink(h,schedule);
    assert.equal(h.w.location.hash,'');
    assert.equal(h.shared.get(KEY),before,'Invalid data must not change any saved row');
    assert.equal(h.shared.get(ROSTER_KEY),cacheBefore);
    assert.match(h.q('#toast').textContent,/Изменения не применены/);
  }
  assert.deepEqual(h.requests,[]);
});

test('week JSON import uses the same targeted update and remains reversible', async t => {
  const h=harness(t);const person=h.addEmployee();h.setDate('2026-11-16');
  h.click(h.cell(person,5));const before=h.read();
  const schedule={type:'lesnoy-week',version:1,week:'2026-11-16',rows:[{name:'Тестовый повар',shifts:['','Р','','','15:30–03:30','','']}]};
  await h.importData(JSON.stringify(schedule));
  const after=h.read(),labels=new Map(after.shifts.map(shift=>[shift.id,shift.label]));
  assert.deepEqual(after.weeks[schedule.week][person].map(id=>id?labels.get(id):''),schedule.rows[0].shifts);
  assert.deepEqual(after.employees,before.employees);
  assert.deepEqual(after.departments,before.departments);
  assert.equal(h.confirmations.length,0,'Explicit targeted schedule import does not use the full-backup replacement prompt');
  h.click('#undo');assert.deepEqual(h.read().weeks,before.weeks);
});

const departmentCell = (department,day) => `[data-department-cell="${department}"][data-day="${day}"]`;

test('department calendar cells persist manual intervals and deletion without changing employee shifts', t => {
  const h=harness(t);const person=h.addEmployee();h.setDate('2026-11-16');
  h.click(h.cell(person,0));const before=h.read();
  h.click(departmentCell('hot',1));
  assert.equal(h.read().departmentWeeks['2026-11-16'].hot[1],'day');
  assert.deepEqual([...h.q(departmentCell('hot',1)).querySelectorAll('.shift-time')].map(x=>x.textContent),['10:00','22:00']);
  assert.equal(h.q(departmentCell('hot',1)).hasAttribute('data-person'),false);
  h.click('#edit-mode');h.click(departmentCell('hot',4));
  h.submit('#interval-form',{start:'15:30',end:'03:30'});
  let current=h.read();const night=current.shifts.find(x=>x.label==='15:30–03:30');
  assert.ok(night);assert.equal(current.departmentWeeks['2026-11-16'].hot[4],night.id);
  assert.deepEqual(current.weeks,before.weeks);assert.deepEqual(current.employees,before.employees);
  assert.deepEqual(current.departments,before.departments);
  const reloaded=harness(t,h.shared);
  assert.equal(reloaded.read().departmentWeeks['2026-11-16'].hot[4],night.id);
  reloaded.click(departmentCell('hot',4));
  assert.equal(reloaded.q('#interval-form [name="start"]').value,'15:30');
  assert.equal(reloaded.q('#interval-form [name="end"]').value,'03:30');
  reloaded.click('#delete-cell-shift');
  assert.equal(reloaded.read().departmentWeeks['2026-11-16'].hot[4],'');
  assert.equal(reloaded.read().departmentWeeks['2026-11-16'].hot[1],'day');
  reloaded.click('#undo');assert.equal(reloaded.read().departmentWeeks['2026-11-16'].hot[4],night.id);
  assert.deepEqual(reloaded.read().weeks,before.weeks);
});

test('copying a week includes independent department rows even when the source has no employee shifts', t => {
  const h=harness(t);h.setDate('2026-11-16');
  h.click(departmentCell('hot',0));h.click('[data-brush="day"]');h.click(departmentCell('cold',5));
  const source=h.read();assert.deepEqual(source.weeks,{});
  h.click('#next-week');h.click('#copy-week');
  const copied=h.read();assert.deepEqual(copied.departmentWeeks['2026-11-23'],source.departmentWeeks['2026-11-16']);
  assert.equal(copied.employees.length,0);
  h.click('[data-brush=""]');h.click(departmentCell('hot',0));
  assert.equal(h.read().departmentWeeks['2026-11-23'].hot[0],'');
  assert.equal(h.read().departmentWeeks['2026-11-16'].hot[0],'day');
  h.click('#prev-week');assert.match(h.q(departmentCell('hot',0)).getAttribute('aria-label'),/10–22/);
});

test('department cells support keyboard navigation, custom text and clearing with escaped content', t => {
  const h=harness(t);h.setDate('2026-11-16');
  h.click('#edit-mode');h.click(departmentCell('hot',0));
  h.submit('#custom-shift-form',{label:'<img src=x>'});
  const current=h.read(),custom=current.shifts.find(x=>x.label==='<img src=x>');
  assert.ok(custom);assert.equal(current.departmentWeeks['2026-11-16'].hot[0],custom.id);
  assert.equal(h.q(departmentCell('hot',0)).querySelector('img'),null);
  assert.match(h.q(departmentCell('hot',0)).textContent,/<img src=x>/);
  h.q(departmentCell('hot',0)).focus();
  h.q(departmentCell('hot',0)).dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
  assert.equal(h.w.document.activeElement,h.q(departmentCell('hot',1)));
  h.q(departmentCell('hot',1)).dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'F2',bubbles:true,cancelable:true}));
  assert.equal(h.q('#editor-dialog').open,true);h.click('#close-dialog');
  h.q(departmentCell('hot',0)).dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true}));
  assert.equal(h.read().departmentWeeks['2026-11-16'].hot[0],'');
  h.click('#undo');assert.equal(h.read().departmentWeeks['2026-11-16'].hot[0],custom.id);
});

test('section-only shift usage prevents preset removal and deleting an empty department cleans its saved rows', t => {
  const h=harness(t);h.addEmployee();h.setDate('2026-11-16');
  h.click(departmentCell('cold',0));h.click('#next-week');h.click(departmentCell('cold',1));
  const before=h.read();h.click('#manage-shifts');h.click('[data-edit-shift="day"]');h.click('#delete-shift');
  assert.match(h.q('#dialog-body .form-error').textContent,/использ|график|смена/i);
  assert.ok(h.read().shifts.some(x=>x.id==='day'));assert.deepEqual(h.read().departmentWeeks,before.departmentWeeks);
  h.click('#close-dialog');h.click('[data-department="cold"]');h.click('#delete-department');
  const after=h.read();assert.ok(!after.departments.some(x=>x.id==='cold'));
  for(const week of Object.values(after.departmentWeeks))assert.equal(Object.hasOwn(week,'cold'),false);
  assert.deepEqual(after.employees,before.employees);assert.deepEqual(after.weeks,before.weeks);
});

test('sharing the rendered PNG sends only the image file without a separate title, text or URL', async t => {
  const h=harness(t);h.addEmployee();
  let native;try{native=require('@napi-rs/canvas')}catch{native=require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas')}
  const create=h.w.document.createElement.bind(h.w.document);const buffers=[];
  h.w.document.createElement=(tag,options)=>{
    if(String(tag).toLowerCase()!=='canvas')return create(tag,options);
    const canvas=native.createCanvas(1,1);canvas.toBlob=callback=>{const bytes=canvas.toBuffer('image/png');buffers.push(bytes);callback(new h.w.Blob([bytes],{type:'image/png'}));};return canvas;
  };
  const shared=[];
  Object.defineProperty(h.w.navigator,'canShare',{configurable:true,value:payload=>Array.isArray(payload.files)&&payload.files.length===1});
  Object.defineProperty(h.w.navigator,'share',{configurable:true,value:async payload=>{shared.push(payload);}});
  h.click('#export-png');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.q('#png-share').hidden,false);
  h.click('#png-share');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(shared.length,1);assert.deepEqual(Object.keys(shared[0]),['files']);
  const file=shared[0].files[0];assert.equal(file.type,'image/png');assert.ok(file.size>100);
  assert.match(file.name,/\.png$/);assert.deepEqual([...buffers[0].subarray(0,8)],[137,80,78,71,13,10,26,10]);
});


test('background click clears the brush without painting or erasing a later empty cell',t=>{
 const h=harness(t),person=h.addEmployee();h.click('[data-brush="midday"]');
 const before=h.shared.get(KEY);h.q('.table-scroll').dispatchEvent(new h.w.MouseEvent('click',{bubbles:true}));
 assert.equal(h.w.document.querySelector('#shift-palette [aria-pressed="true"]'),null);
 h.click(h.cell(person,0));assert.equal(h.shared.get(KEY),before);
 h.click('[data-brush="midday"]');h.click(h.cell(person,0));
 assert.equal(h.read().weeks[h.read().selectedWeek][person][0],'midday');
 h.click('[data-brush=""]');h.q('main').dispatchEvent(new h.w.MouseEvent('click',{bubbles:true}));
 h.click(h.cell(person,1));assert.equal(h.read().weeks[h.read().selectedWeek][person][0],'midday');
});

test('one revision picker follows erase, offers morning/night, and persists the chosen label',t=>{
 const h=harness(t),person=h.addEmployee();
 assert.equal(h.w.document.querySelector('[data-brush="work"]'),null);
 const buttons=[...h.q('#shift-palette').children];assert.equal(buttons.at(-1).id,'revision-picker');assert.equal(buttons.at(-2).dataset.brush,'');
 h.click('#revision-picker');h.click('[data-revision-period="ночь"]');h.click(h.cell(person,2));
 const state=h.read(),selected=state.weeks[state.selectedWeek][person][2];assert.equal(state.shifts.find(x=>x.id===selected).label,'Ревизия ночь');
 h.click(h.cell(person,2));h.click('#pick-cell-revision');h.click('[data-revision-period="утро"]');
 const next=h.read();assert.equal(next.shifts.find(x=>x.id===next.weeks[next.selectedWeek][person][2]).label,'Ревизия утро');
 const reloaded=harness(t,h.shared);assert.equal(reloaded.read().weeks[next.selectedWeek][person][2],next.weeks[next.selectedWeek][person][2]);
});

test('holding a used time button hides it only after confirmation and survives reload with every weekly cell intact',async t=>{
 const h=harness(t),person=h.addEmployee();h.click(h.cell(person,0));
 const weeks=JSON.stringify(h.read().weeks),button=h.q('[data-brush="day"]');
 button.dispatchEvent(new h.w.MouseEvent('pointerdown',{bubbles:true,button:0,clientX:10,clientY:10}));
 await new Promise(r=>setTimeout(r,650));assert.equal(h.q('#editor-dialog').open,true);
 assert.equal(h.read().shifts.find(x=>x.id==='day').hidden,undefined);
 h.click('#hide-time-button');assert.equal(h.w.document.querySelector('#shift-palette [data-brush="day"]'),null);
 assert.equal(JSON.stringify(h.read().weeks),weeks);
 const reload=harness(t,h.shared);assert.equal(reload.w.document.querySelector('#shift-palette [data-brush="day"]'),null);
 assert.equal(JSON.stringify(reload.read().weeks),weeks);
 reload.click('#manage-shifts');reload.click('[data-show-shift="day"]');reload.click('#close-dialog');
 assert.ok(reload.q('#shift-palette [data-brush="day"]'));assert.equal(JSON.stringify(reload.read().weeks),weeks);
});

test('moving, cancelling or releasing a press prevents hiding, and context-menu removal can be cancelled',async t=>{
 const h=harness(t),button=h.q('[data-brush="midday"]'),event=(type,x=10)=>button.dispatchEvent(new h.w.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:10}));
 for(const type of ['pointerup','pointercancel','pointermove']){event('pointerdown');event(type,30);await new Promise(r=>setTimeout(r,650));assert.equal(h.q('#editor-dialog').open,false);}
 event('contextmenu');assert.equal(h.q('#editor-dialog').open,true);h.click('#close-dialog');
 assert.equal(h.read().shifts.find(x=>x.id==='midday').hidden,undefined);
});


test('initial load and reload have no selected shift until the user chooses one',t=>{
 const shared=new Map(),h=harness(t,shared,'https://lesnoy.example/kitchen/',false),person=h.addEmployee();
 assert.equal(h.w.document.querySelector('#shift-palette [aria-pressed="true"]'),null);
 const before=shared.get(KEY);h.click(h.cell(person,0));assert.equal(shared.get(KEY),before);
 h.click('[data-brush="day"]');h.click(h.cell(person,0));assert.equal(h.read().weeks[h.read().selectedWeek][person][0],'day');
 const reload=harness(t,shared,'https://lesnoy.example/kitchen/',false);
 assert.equal(reload.w.document.querySelector('#shift-palette [aria-pressed="true"]'),null);
 const saved=shared.get(KEY);reload.click(reload.cell(person,1));assert.equal(shared.get(KEY),saved);
 reload.click(reload.cell(person,0));assert.equal(reload.q('#editor-dialog').open,true,'Existing cells still open for editing');
});


test('tapping the selected weekly tool again clears it without painting or changing saved data',t=>{
 const h=harness(t,new Map(),'https://lesnoy.example/kitchen/',false),person=h.addEmployee(),saved=h.shared.get(KEY);
 for(const id of ['day','midday','']){h.click('[data-brush="'+id+'"]');assert.equal(h.q('[data-brush="'+id+'"]').getAttribute('aria-pressed'),'true');h.click('[data-brush="'+id+'"]');assert.equal(h.w.document.querySelector('#shift-palette [aria-pressed="true"]'),null);h.click(h.cell(person,0));assert.equal(h.shared.get(KEY),saved);}
 h.click('#revision-picker');h.click('[data-revision-period="утро"]');h.click('#revision-picker');assert.equal(h.w.document.querySelector('#shift-palette [aria-pressed="true"]'),null);assert.equal(h.q('#editor-dialog').open,false);
});
