/* Месячный табель: чистые расчёты и отдельное локальное хранилище. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LesnoyTimesheetCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const STORAGE_KEY = 'lesnoy-kitchen:timesheet:v1';
  const BACKUP_KEY = STORAGE_KEY + ':backup';
  const POISON = new Set(['__proto__', 'prototype', 'constructor']);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const fail = message => { throw new Error(message); };
  function record(o, label) {
    if (!o || typeof o !== 'object' || Array.isArray(o) || ![Object.prototype, null].includes(Object.getPrototypeOf(o))) fail(label + ': ожидается обычный объект.');
    if (Object.keys(o).some(k => POISON.has(k))) fail(label + ': недопустимый ключ.');
    return o;
  }
  function identifier(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id) || POISON.has(id)) fail('Недопустимый идентификатор сотрудника.');
    return id;
  }
  function text(value, max, label, empty) {
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || (!empty && !value.trim())) fail(label + ': неверный текст.');
    return value;
  }
  function money(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10000000) fail('Сумма должна быть числом от 0 до 10 000 000.');
    return value;
  }
  function checkMonth(month) {
    if (typeof month !== 'string' || !/^(19\d{2}|20\d{2}|21\d{2})-(0[1-9]|1[0-2])$/.test(month)) fail('Неверный месяц. Используйте ГГГГ-ММ, год от 1900 до 2199.');
    return month;
  }
  function monthKey(value) {
    if (value === undefined) value = new Date();
    if (value instanceof Date) {
      if (!Number.isFinite(value.getTime())) fail('Неверная дата.');
      return checkMonth(value.getFullYear() + '-' + String(value.getMonth() + 1).padStart(2, '0'));
    }
    if (typeof value === 'string' && value.length === 10) return parseDate(value).toISOString().slice(0, 7);
    return checkMonth(value);
  }
  function dayCount(month) {
    checkMonth(month);
    const [y, m] = month.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  function dateOf(month, day) {
    if (!Number.isInteger(day) || day < 1 || day > dayCount(month)) fail('Такого дня в месяце нет.');
    return month + '-' + String(day).padStart(2, '0');
  }
  function parseDate(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) fail('Неверная дата. Используйте ГГГГ-ММ-ДД.');
    const month = checkMonth(key.slice(0, 7)), d = Number(key.slice(8));
    if (dateOf(month, d) !== key) fail('Такой даты не существует.');
    return new Date(key + 'T00:00:00.000Z');
  }
  function addMonths(month, offset) {
    checkMonth(month);
    if (!Number.isInteger(offset) || Math.abs(offset) > 3600) fail('Неверное количество месяцев.');
    const [y, m] = month.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1 + offset, 1));
    return checkMonth(date.toISOString().slice(0, 7));
  }
  function createBook(month) {
    return { version: 2, people: {}, roster: [], days: {}, confirmed: {}, overrides: {}, profiles: {}, selectedMonth: monthKey(month), updatedAt: new Date().toISOString() };
  }
  function readProfile(p) {
    record(p, 'Ставка');
    if (!['shift', 'salary'].includes(p.type)) fail('Неверный тип оплаты.');
    return { type: p.type, rate: money(p.rate) };
  }
  function validateBook(input) {
    record(input, 'Табель');
    if (![1, 2].includes(input.version)) fail('Версия табеля не поддерживается.');
    const out = createBook(input.selectedMonth === undefined ? undefined : input.selectedMonth);
    const ids = new Set(), months = new Set();
    const person = id => { identifier(id); ids.add(id); if (ids.size > 200) fail('В табеле больше 200 сотрудников.'); };
    const month = m => { checkMonth(m); months.add(m); if (months.size > 1000) fail('В табеле больше 1000 месяцев.'); };
    for (const key of ['people', 'days', 'confirmed', 'overrides']) record(input[key], 'Раздел «' + key + '»');
    for (const [id, p] of Object.entries(input.people)) { person(id); out.people[id] = readProfile(p); }
    const roster = input.roster === undefined ? [] : input.roster;
    if (!Array.isArray(roster) || roster.length > 200) fail('В списке сотрудников должно быть не более 200 записей.');
    const rosterIds = new Set();
    out.roster = roster.map(p => {
      record(p, 'Сотрудник'); person(p.id);
      if (rosterIds.has(p.id)) fail('Повторяется сотрудник в списке.');
      rosterIds.add(p.id);
      return { id: p.id, name: text(p.name, 100, 'Имя сотрудника'), role: text(p.role === undefined ? '' : p.role, 100, 'Должность', true) };
    });
    let count = 0;
    for (const [id, row] of Object.entries(input.days)) {
      person(id); record(row, 'Дни сотрудника'); out.days[id] = {};
      if (Object.keys(row).length > 31000) fail('Слишком много дней у сотрудника.');
      for (const [date, cell] of Object.entries(row)) {
        parseDate(date); month(date.slice(0, 7)); record(cell, 'Смена');
        if (++count > 200000) fail('В табеле больше 200 000 записей о сменах.');
        if (typeof cell.value !== 'number' || !Number.isFinite(cell.value) || cell.value < 0 || cell.value > 3 || typeof cell.confirmed !== 'boolean') fail('Неверная смена: укажите число от 0 до 3 и подтверждение.');
        out.days[id][date] = { value: cell.value, confirmed: cell.confirmed, note: text(cell.note, 200, 'Примечание', true) };
      }
    }
    for (const [id, row] of Object.entries(input.overrides)) {
      person(id); record(row, 'Выплаты'); out.overrides[id] = {};
      for (const [m, value] of Object.entries(row)) { month(m); out.overrides[id][m] = money(value); }
    }
    const profiles = input.profiles === undefined ? {} : record(input.profiles, 'Месячные ставки');
    for (const [m, row] of Object.entries(profiles)) {
      month(m); record(row, 'Ставки за месяц'); out.profiles[m] = {};
      for (const [id, p] of Object.entries(row)) { person(id); out.profiles[m][id] = readProfile(p); }
    }
    // Поле прежней версии не участвовало в расчёте. Сохраняем его данные,
    // ограничивая размер и запрещая ключи, меняющие прототип объектов.
    let metadataCount = 0;
    function metadata(value, depth) {
      if (++metadataCount > 20000 || depth > 5) fail('Слишком большой раздел подтверждений.');
      if (value === null || typeof value === 'boolean') return value;
      if (typeof value === 'string') return text(value, 200, 'Подтверждение', true);
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      record(value, 'Подтверждения');
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, metadata(v, depth + 1)]));
    }
    if (Object.keys(input.confirmed).length > 1000) fail('Слишком много подтверждений.');
    out.confirmed = metadata(input.confirmed, 0);
    if (input.updatedAt !== undefined) {
      if (typeof input.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.updatedAt) || !Number.isFinite(Date.parse(input.updatedAt)) || new Date(input.updatedAt).toISOString() !== input.updatedAt) fail('Неверное время изменения табеля.');
      out.updatedAt = input.updatedAt;
    }
    // При миграции закрепляем ставки всех месяцев, в которых уже есть данные.
    // Последующая правка ставки по умолчанию не меняет прежние выплаты.
    if (input.version === 1) for (const m of months) {
      out.profiles[m] ||= {};
      for (const [id, p] of Object.entries(out.people)) if (!own(out.profiles[m], id)) out.profiles[m][id] = { ...p };
    }
    return out;
  }
  function normalizeName(name) { return String(name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е'); }
  function hasFinancialData(book, id) {
    return ['people', 'days', 'overrides'].some(key => book[key] && own(book[key], id)) || Object.values(book.profiles || {}).some(row => own(row, id));
  }
  function employees(book, schedule) {
    const result = (book.roster || []).map(p => ({ id: p.id, name: p.name, role: p.role || '' }));
    const ids = new Set(result.map(p => p.id)), names = new Set(result.map(p => normalizeName(p.name)));
    const planned = schedule && Array.isArray(schedule.employees) ? schedule.employees : [];
    if (planned.length > 200) fail('В графике больше 200 сотрудников.');
    const departments = schedule && Array.isArray(schedule.departments) ? schedule.departments : [];
    const order = new Map(departments.map((d, i) => [d.id, i]));
    for (const p of [...planned].sort((a, b) => (order.get(a.department) ?? 999) - (order.get(b.department) ?? 999))) {
      identifier(p.id); const name = text(p.name, 100, 'Имя сотрудника');
      if (ids.has(p.id) || names.has(normalizeName(name))) continue;
      // Явный месячный состав задаёт команда из ведомости. Недельные строки
      // добавляются автоматически лишь для сохранения уже внесённых данных.
      if ((book.roster || []).length && !hasFinancialData(book, p.id)) continue;
      result.push({ id: p.id, name, role: p.role || '' }); ids.add(p.id); names.add(normalizeName(name));
    }
    if (result.length > 200) fail('В табеле больше 200 сотрудников.');
    return result;
  }
  function employeeMap(book, schedule) {
    const list = employees(book, schedule), byWeeklyId = Object.create(null), byName = Object.create(null);
    const byId = new Map(list.map(p => [p.id, p]));
    for (const p of list) if (!own(byName, normalizeName(p.name))) byName[normalizeName(p.name)] = p.id;
    for (const p of schedule && Array.isArray(schedule.employees) ? schedule.employees : []) byWeeklyId[identifier(p.id)] = byId.has(p.id) ? p.id : byName[normalizeName(p.name)];
    return { byWeeklyId, byName };
  }
  function resolveEmployee(book, schedule, person) {
    const list = employees(book, schedule), map = employeeMap(book, schedule);
    const id = typeof person === 'string' ? person : person && person.id;
    const target = map.byWeeklyId[id] || (list.some(p => p.id === id) ? id : typeof person === 'object' && person ? map.byName[normalizeName(person.name)] : undefined);
    return list.find(p => p.id === target) || null;
  }
  function profile(book, id, month) {
    identifier(id); checkMonth(month);
    const profiles = book.profiles || {};
    let p = profiles[month] && profiles[month][id];
    if (!p) {
      const prior = Object.keys(profiles).filter(m => m < month && own(profiles[m], id)).sort().pop();
      if (prior !== undefined) p = profiles[prior][id];
    }
    p ||= book.people[id] || { type: 'shift', rate: 0 };
    return { type: p.type, rate: p.rate };
  }
  // Считаем десятичные значения целыми числами, включая дробные смены.
  function decimal(n) {
    const [mantissa, exp = '0'] = String(n).toLowerCase().split('e');
    const parts = mantissa.split('.'), scale = (parts[1] || '').length - Number(exp);
    let value = BigInt(parts.join(''));
    if (scale < 0) value *= 10n ** BigInt(-scale);
    return { value, scale: Math.max(0, scale) };
  }
  function sumDecimal(values) {
    const parts = values.map(decimal), scale = Math.max(0, ...parts.map(p => p.scale));
    return { value: parts.reduce((sum, p) => sum + p.value * 10n ** BigInt(scale - p.scale), 0n), scale };
  }
  function cents(product) {
    const denominator = 10n ** BigInt(product.scale), numerator = product.value * 100n;
    return Number((numerator + denominator / 2n) / denominator);
  }
  function decimalNumber(value) { return Number(value.value.toString() + 'e-' + value.scale); }
  function totals(book, id, month) {
    identifier(id); checkMonth(month);
    const paid = [], drafts = [];
    for (const [date, x] of Object.entries(book.days[id] || {})) if (date.startsWith(month + '-')) (x.confirmed ? paid : drafts).push(x.value);
    const shifts = sumDecimal(paid), draft = sumDecimal(drafts), p = profile(book, id, month), rate = decimal(p.rate);
    const automaticCents = p.type === 'salary' ? cents(rate) : cents({ value: shifts.value * rate.value, scale: shifts.scale + rate.scale });
    const override = book.overrides[id] && book.overrides[id][month];
    return { shifts: decimalNumber(shifts), totalShifts: decimalNumber(shifts), drafts: drafts.length, draftShifts: decimalNumber(draft), amount: (override === undefined ? automaticCents : cents(decimal(override))) / 100, automaticAmount: automaticCents / 100, override, profile: p };
  }
  function monthlyTotal(book, listOrIDs, month) {
    checkMonth(month);
    if (!Array.isArray(listOrIDs)) fail('Для расчёта нужен список сотрудников.');
    const ids = new Set(listOrIDs.map(p => typeof p === 'string' ? p : p.id));
    return [...ids].reduce((sum, id) => sum + Math.round(totals(book, id, month).amount * 100), 0) / 100;
  }
  function snapshotProfiles(book, month, listOrIDs) {
    const out = validateBook(book); checkMonth(month);
    const ids = listOrIDs === undefined ? [...new Set([...Object.keys(out.people), ...Object.keys(out.days), ...out.roster.map(p => p.id)])] : listOrIDs.map(p => typeof p === 'string' ? p : p.id);
    out.profiles[month] ||= {};
    for (const id of ids) if (!own(out.profiles[month], identifier(id))) out.profiles[month][id] = profile(out, id, month);
    return validateBook(out);
  }
  function importWeek(book, schedule, monday) {
    const first = parseDate(monday);
    if (first.getUTCDay() !== 1) fail('Неделя должна начинаться с понедельника.');
    const dates = Array.from({ length: 7 }, (_, i) => {
      const key = new Date(first.getTime() + i * 86400000).toISOString().slice(0, 10); parseDate(key); return key;
    });
    let out = validateBook(book), added = 0, skipped = 0;
    const rows = schedule && schedule.weeks && schedule.weeks[monday] || {};
    record(rows, 'График недели');
    const shifts = new Map((schedule && Array.isArray(schedule.shifts) ? schedule.shifts : []).map(s => [s.id, s]));
    let map = employeeMap(out, schedule);
    for (const p of schedule && Array.isArray(schedule.employees) ? schedule.employees : []) {
      const row = rows[p.id];
      if (row === undefined) continue;
      if (!Array.isArray(row) || row.length !== 7) fail('В графике сотрудника должно быть семь дней.');
      if (map.byWeeklyId[p.id] || !row.some(shiftId => shifts.has(shiftId))) continue;
      // При пустом списке сначала сохраняем весь текущий состав, чтобы его
      // случайно не заменил частичный список только переносимой недели.
      if (!out.roster.length) out.roster = employees(out, schedule);
      out.roster.push({ id: identifier(p.id), name: text(p.name, 100, 'Имя сотрудника'), role: text(p.role || '', 100, 'Должность', true) });
      map = employeeMap(out, schedule);
    }
    const touched = new Map();
    for (const p of schedule && Array.isArray(schedule.employees) ? schedule.employees : []) {
      const id = map.byWeeklyId[p.id], row = rows[p.id];
      if (!id || row === undefined) continue;
      if (!Array.isArray(row) || row.length !== 7) fail('В графике сотрудника должно быть семь дней.');
      row.forEach((shiftId, i) => {
        const shift = shifts.get(shiftId); if (!shift) return;
        const date = dates[i];
        if (out.days[id] && own(out.days[id], date)) { skipped++; return; }
        const label = String(shift.label).toLocaleUpperCase('ru-RU').trim();
        const isWork = label === 'Р' || /^\d{1,2}(?::\d{2})?\s*[-–—]\s*\d{1,2}(?::\d{2})?$/.test(label);
        (out.days[id] ||= {})[date] = { value: isWork ? 1 : 0, confirmed: false, note: ('Из графика: ' + shift.label).slice(0, 200) };
        const m = date.slice(0, 7); if (!touched.has(m)) touched.set(m, new Set()); touched.get(m).add(id); added++;
      });
    }
    for (const [m, ids] of touched) out = snapshotProfiles(out, m, [...ids]);
    return { book: validateBook(out), added, skipped };
  }
  function errorText(error) { return error && typeof error.message === 'string' && /[а-яё]/i.test(error.message) ? error.message : 'Хранилище недоступно или заполнено.'; }
  function decode(raw) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { fail('Повреждён файл табеля: неверный формат JSON.'); }
    return validateBook(parsed);
  }
  function load(storage) {
    let primary, primaryError;
    try { primary = storage.getItem(STORAGE_KEY); if (primary !== null) return { book: decode(primary), error: null, recovered: false }; }
    catch (error) { primaryError = 'Не удалось прочитать табель: ' + errorText(error); }
    try {
      const backup = storage.getItem(BACKUP_KEY);
      if (backup !== null) return { book: decode(backup), error: primaryError || 'Основной табель отсутствует. Восстановлена резервная копия.', recovered: true };
    } catch (error) { primaryError = (primaryError || 'Основной табель отсутствует.') + ' Резервная копия недоступна: ' + errorText(error); }
    return { book: createBook(), error: primaryError || null, recovered: false };
  }
  function comparable(book) {
    const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, sorted(value[k])])) : value;
    const copy = { ...book }; delete copy.updatedAt;
    return JSON.stringify(sorted(copy));
  }
  function save(storage, book) {
    const next = validateBook(book);
    let previous;
    try { previous = storage.getItem(STORAGE_KEY); } catch (error) { fail('Не удалось прочитать табель перед сохранением: ' + errorText(error)); }
    let validPrevious;
    if (previous !== null) try { validPrevious = decode(previous); } catch (_) { /* Сохраняем исходные байты ниже. */ }
    if (validPrevious && comparable(validPrevious) === comparable(next) && JSON.parse(previous).version === 2) return validPrevious;
    // Повреждённый оригинал может быть единственным источником для ручного
    // восстановления. Его нельзя заменять, пока исходные байты не защищены.
    if (previous !== null && !validPrevious) {
      let validBackup = false;
      try {
        const backup = storage.getItem(BACKUP_KEY);
        if (backup !== null) try { decode(backup); validBackup = true; } catch (_) { /* Нужна копия исходного файла. */ }
      } catch (_) { /* Попытка сохранить исходный файл ниже проверит доступ. */ }
      if (!validBackup) try { storage.setItem(BACKUP_KEY, previous); }
      catch (error) { fail('Не удалось сохранить повреждённый оригинал табеля. Основные данные не заменены: ' + errorText(error)); }
    }
    next.updatedAt = new Date().toISOString();
    try { storage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (error) { fail('Не удалось сохранить табель: ' + errorText(error)); }
    if (previous !== null && validPrevious) try {
      storage.setItem(BACKUP_KEY, previous);
    } catch (_) { /* Успешная запись основного табеля не отменяется ошибкой копии. */ }
    return next;
  }
  return { STORAGE_KEY, BACKUP_KEY, createBook, validateBook, load, save, monthKey, checkMonth, dayCount, dateOf, addMonths, parseDate, normalizeName, employees, employeeMap, resolveEmployee, profile, totals, monthlyTotal, snapshotProfiles, importWeek };
});
