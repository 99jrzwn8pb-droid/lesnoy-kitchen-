/* Данные и календарь. Работает без сервера и сторонних библиотек. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LesnoyCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'lesnoy-kitchen:v1';
  const BACKUP_KEY = STORAGE_KEY + ':backup';
  const DAY_MS = 86400000;
  const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const SHIFT_PRESETS = [
    { id: 'day', label: '10–22', color: '#e6eee6' },
    { id: 'midday', label: '11:30–23:30', color: '#e4ebf5' },
    { id: 'work', label: 'Р', color: '#f1f0ed' }
  ];

  function fail(message) { throw new Error(message); }
  function record(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
      fail(label + ': ожидается объект.');
    }
    return value;
  }
  function boundedList(value, max, label) {
    if (!Array.isArray(value) || value.length > max) fail(label + ': допустимо не более ' + max + ' записей.');
    return Array.from(value);
  }
  function string(value, max, label, empty) {
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
      fail(label + ': неверный текст или превышена длина ' + max + ' символов.');
    }
    const result = value.trim();
    if (!empty && !result) fail(label + ': заполните значение.');
    return result;
  }
  function id(value, label) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value) || RESERVED.has(value)) {
      fail(label + ': недопустимый идентификатор.');
    }
    return value;
  }
  function unique(items, label) {
    const ids = new Set();
    for (const item of items) {
      if (ids.has(item.id)) fail(label + ': повторяется идентификатор «' + item.id + '».');
      ids.add(item.id);
    }
    return ids;
  }

  function parseDate(value) {
    if (typeof value !== 'string' || !DATE_RE.test(value)) fail('Неверная дата. Используйте формат ГГГГ-ММ-ДД.');
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1900 || year > 2199) fail('Год должен быть от 1900 до 2199.');
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      fail('Такой даты не существует.');
    }
    return date;
  }
  function dateKey(date) { return date.toISOString().slice(0, 10); }
  function localDateKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) fail('Неверная дата.');
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }
  function monday(value) {
    const date = parseDate(value instanceof Date ? localDateKey(value) : value);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return dateKey(date);
  }
  function addDays(key, days) {
    if (!Number.isInteger(days) || Math.abs(days) > 110000) fail('Неверное количество дней.');
    const result = dateKey(new Date(parseDate(key).getTime() + days * DAY_MS));
    parseDate(result);
    return result;
  }
  function weekDates(key) {
    if (monday(key) !== key) fail('Неделя должна начинаться с понедельника.');
    return Array.from({ length: 7 }, (_, day) => addDays(key, day));
  }
  function previousWeek(key) { return addDays(monday(key), -7); }

  function createState(now) {
    const current = now === undefined ? new Date() : now;
    const date = current instanceof Date ? current : parseDate(current);
    return {
      version: 1,
      presetVersion: 1,
      employees: [],
      departments: [
        { id: 'hot', name: 'Горячий цех' },
        { id: 'cold', name: 'Холодный цех' },
        { id: 'prep', name: 'Заготовочный цех' }
      ],
      shifts: SHIFT_PRESETS.map(shift => ({ ...shift })),
      weeks: {},
      departmentWeeks: {},
      selectedWeek: monday(current),
      updatedAt: date.toISOString()
    };
  }

  function validateState(input) {
    record(input, 'Файл');
    if (input.version !== 1) fail('Эта версия резервной копии не поддерживается. Нужна версия 1.');
    const presetVersion = input.presetVersion === undefined ? 0 : input.presetVersion;
    if (presetVersion !== 0 && presetVersion !== 1) fail('Версия вариантов смен не поддерживается.');
    const departments = boundedList(input.departments, 50, 'Цеха').map(item => {
      record(item, 'Цех');
      return { id: id(item.id, 'Цех'), name: string(item.name, 80, 'Название цеха') };
    });
    const departmentIds = unique(departments, 'Цеха');
    const employees = boundedList(input.employees, 200, 'Сотрудники').map(item => {
      record(item, 'Сотрудник');
      const department = id(item.department, 'Цех сотрудника');
      if (!departmentIds.has(department)) fail('У сотрудника указан неизвестный цех.');
      return {
        id: id(item.id, 'Сотрудник'), name: string(item.name, 100, 'Имя сотрудника'),
        phone: string(item.phone, 50, 'Телефон', true), department
      };
    });
    const employeeIds = unique(employees, 'Сотрудники');
    // Три дополнительных записи нужны только для обновления старого полного
    // каталога: уже использованные обозначения остаются в истории графика.
    const shifts = boundedList(input.shifts, presetVersion === 0 ? 30 : 33, 'Смены').map(item => {
      record(item, 'Смена');
      if (typeof item.color !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(item.color)) fail('У смены неверный цвет.');
      return { id: id(item.id, 'Смена'), label: string(item.label, 24, 'Название смены'), color: item.color.toLowerCase() };
    });
    const shiftIds = unique(shifts, 'Смены');
    record(input.weeks, 'Недели');
    const keys = Object.keys(input.weeks);
    if (keys.length > 1000) fail('В резервной копии больше 1000 недель.');
    const weeks = {};
    for (const key of keys) {
      weekDates(key);
      const rows = record(input.weeks[key], 'График недели');
      const rowKeys = Object.keys(rows);
      if (rowKeys.length > 200) fail('В графике больше 200 сотрудников.');
      const output = {};
      for (const employee of rowKeys) {
        if (!employeeIds.has(employee)) fail('В графике указан неизвестный сотрудник.');
        const row = rows[employee];
        if (!Array.isArray(row) || row.length !== 7) fail('У каждого сотрудника должно быть ровно 7 дней.');
        output[employee] = Array.from(row, shift => {
          if (shift !== '' && !shiftIds.has(shift)) fail('В графике указана неизвестная смена.');
          return shift;
        });
      }
      weeks[key] = output;
    }
    const departmentInput = input.departmentWeeks === undefined ? {} : input.departmentWeeks;
    record(departmentInput, 'Строки цехов');
    const departmentKeys = Object.keys(departmentInput);
    if (departmentKeys.length > 1000) fail('В строках цехов больше 1000 недель.');
    const departmentWeeks = {};
    for (const key of departmentKeys) {
      weekDates(key);
      const rows = record(departmentInput[key], 'Строки цехов недели');
      const rowKeys = Object.keys(rows);
      if (rowKeys.length > 50) fail('В строках недели больше 50 цехов.');
      const output = {};
      for (const department of rowKeys) {
        if (!departmentIds.has(department)) fail('В строке графика указан неизвестный цех.');
        const row = rows[department];
        if (!Array.isArray(row) || row.length !== 7) fail('В строке каждого цеха должно быть ровно 7 дней.');
        output[department] = Array.from(row, shift => {
          if (shift !== '' && !shiftIds.has(shift)) fail('В строке цеха указана неизвестная смена.');
          return shift;
        });
      }
      departmentWeeks[key] = output;
    }
    weekDates(input.selectedWeek);
    if (typeof input.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.updatedAt) ||
      Number.isNaN(Date.parse(input.updatedAt)) || new Date(input.updatedAt).toISOString() !== input.updatedAt) {
      fail('В резервной копии неверное время сохранения.');
    }
    return { version: 1, presetVersion, employees, departments, shifts, weeks, departmentWeeks, selectedWeek: input.selectedWeek, updatedAt: input.updatedAt };
  }

  function shiftLabelKey(label) {
    const text = String(label).trim().toLocaleUpperCase('ru-RU').replace(/\s+/g, '').replace(/[-—−]/g, '–');
    const interval = text.match(/^(\d{1,2})(?::(\d{2}))?–(\d{1,2})(?::(\d{2}))?$/);
    if (!interval) return text;
    const start = interval[1].padStart(2, '0') + ':' + (interval[2] || '00');
    const end = interval[3].padStart(2, '0') + ':' + (interval[4] || '00');
    return start + '–' + end;
  }
  function retiredShift(shift) {
    return ['В', 'ОТ', 'Б', '12:00–00:00'].includes(shiftLabelKey(shift.label));
  }
  function selectableShifts(state) {
    const order = new Map(SHIFT_PRESETS.map((shift, index) => [shiftLabelKey(shift.label), index]));
    return state.shifts.filter(shift => !retiredShift(shift)).sort((a, b) =>
      (order.get(shiftLabelKey(a.label)) ?? 3) - (order.get(shiftLabelKey(b.label)) ?? 3));
  }
  function configureShiftPresets(input) {
    const next = validateState(input);
    // Однократное обновление: последующие пользовательские изменения вариантов
    // не отменяются при повторном открытии сайта или импорте новой копии.
    if (next.presetVersion === 1) return next;
    const used = new Set();
    for (const collection of [next.weeks, next.departmentWeeks]) {
      for (const week of Object.values(collection)) {
        for (const row of Object.values(week)) for (const value of row) if (value) used.add(value);
      }
    }
    next.shifts = next.shifts.filter(shift => !retiredShift(shift) || used.has(shift.id));
    const ids = new Set(next.shifts.map(shift => shift.id));
    for (const preset of SHIFT_PRESETS) {
      if (next.shifts.some(shift => shiftLabelKey(shift.label) === shiftLabelKey(preset.label))) continue;
      let shiftId = preset.id;
      for (let number = 2; ids.has(shiftId); number++) shiftId = preset.id + '-' + number;
      ids.add(shiftId);
      next.shifts.push({ ...preset, id: shiftId });
    }
    next.presetVersion = 1;
    return validateState(next);
  }

  function decode(raw) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { fail('Данные не являются корректным JSON.'); }
    return validateState(parsed);
  }

  // Список сотрудников импортируется отдельно от полной резервной копии.
  // Совпавшие имена сохраняют внутренние ID, на которые ссылаются смены.
  function mergeRoster(state, input) {
    const next = validateState(state);
    record(input, 'Список сотрудников');
    if (input.type !== 'lesnoy-roster' || input.version !== 1) {
      fail('Формат списка сотрудников не поддерживается.');
    }
    const incoming = validateState({
      version: 1, departments: input.departments, employees: input.employees,
      shifts: [], weeks: {}, selectedWeek: next.selectedWeek, updatedAt: next.updatedAt
    });
    const nameKey = value => value.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
    function byName(items, label) {
      const map = new Map();
      for (const item of items) {
        const key = nameKey(item.name);
        if (map.has(key)) fail(label + ': повторяется имя или название «' + item.name + '». Уточните совпадающие записи перед импортом.');
        map.set(key, item);
      }
      return map;
    }
    const existingDepartments = byName(next.departments, 'Существующие цеха');
    const existingEmployees = byName(next.employees, 'Существующие сотрудники');
    byName(incoming.departments, 'Импортируемые цеха');
    byName(incoming.employees, 'Импортируемые сотрудники');
    const departmentIds = new Set(next.departments.map(item => item.id));
    const employeeIds = new Set(next.employees.map(item => item.id));
    function availableId(preferred, used) {
      let value = preferred;
      for (let number = 2; used.has(value); number++) {
        const suffix = '-' + number;
        value = preferred.slice(0, 64 - suffix.length) + suffix;
      }
      used.add(value);
      return value;
    }
    const departmentMap = new Map();
    const orderedDepartments = [];
    let departmentsAdded = 0;
    for (const department of incoming.departments) {
      let target = existingDepartments.get(nameKey(department.name));
      if (target) target.name = department.name;
      else {
        target = { id: availableId(department.id, departmentIds), name: department.name };
        departmentsAdded++;
      }
      departmentMap.set(department.id, target.id);
      orderedDepartments.push(target);
    }
    const importedDepartmentIds = new Set(orderedDepartments.map(item => item.id));
    next.departments = orderedDepartments.concat(next.departments.filter(item => !importedDepartmentIds.has(item.id)));
    const orderedEmployees = [];
    let added = 0;
    let updated = 0;
    for (const employee of incoming.employees) {
      let target = existingEmployees.get(nameKey(employee.name));
      const department = departmentMap.get(employee.department);
      if (target) {
        const phone = employee.phone || target.phone;
        if (target.name !== employee.name || target.phone !== phone || target.department !== department) updated++;
        Object.assign(target, { name: employee.name, phone, department });
      } else {
        target = { ...employee, id: availableId(employee.id, employeeIds), department };
        added++;
      }
      orderedEmployees.push(target);
    }
    const importedEmployeeIds = new Set(orderedEmployees.map(item => item.id));
    next.employees = orderedEmployees.concat(next.employees.filter(item => !importedEmployeeIds.has(item.id)));
    // Общие лимиты проверяются после объединения, до возврата результата.
    return { state: validateState(next), added, updated, departmentsAdded };
  }
  // Импорт одной недели заменяет только указанные строки, включая пустые дни.
  // Все проверки выполняются над копией; ошибка не оставляет частичных правок.
  function importWeekSchedule(state, input) {
    let next = validateState(state);
    record(input, 'График недели');
    if (input.type !== 'lesnoy-week' || input.version !== 1) fail('Формат графика недели не поддерживается.');
    weekDates(input.week);
    const nameKey = value => value.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
    const seenNames = new Set();
    const rows = boundedList(input.rows, 200, 'Строки графика').map(item => {
      record(item, 'Строка графика');
      const name = string(item.name, 100, 'Имя сотрудника');
      const key = nameKey(name);
      if (seenNames.has(key)) fail('В графике повторяется сотрудник «' + name + '».');
      seenNames.add(key);
      if (!Array.isArray(item.shifts) || item.shifts.length !== 7) fail('У каждого сотрудника должно быть ровно 7 дней.');
      const shifts = Array.from(item.shifts, label => string(label, 24, 'Обозначение смены', true));
      return { name, key, shifts };
    });
    if (!rows.length) fail('В файле нет строк графика.');
    if (!next.employees.length && input.roster) next = mergeRoster(next, input.roster).state;
    const employeesByName = new Map();
    for (const employee of next.employees) {
      const key = nameKey(employee.name);
      if (!employeesByName.has(key)) employeesByName.set(key, []);
      employeesByName.get(key).push(employee);
    }
    // Сначала сопоставляем все имена, прежде чем создавать варианты смен.
    for (const row of rows) {
      const matches = employeesByName.get(row.key) || [];
      if (!matches.length) fail('Сотрудник «' + row.name + '» не найден. Сначала добавьте его в команду.');
      if (matches.length !== 1) fail('Найдено несколько сотрудников «' + row.name + '». Уточните совпадающие имена.');
      row.employeeId = matches[0].id;
    }
    const shiftByLabel = new Map();
    const shiftIds = new Set(next.shifts.map(shift => shift.id));
    for (const shift of next.shifts) {
      const key = shiftLabelKey(shift.label);
      if (!shiftByLabel.has(key)) shiftByLabel.set(key, shift.id);
    }
    const maxShifts = next.presetVersion === 1 ? 33 : 30;
    let shiftNumber = 1;
    let filledCells = 0;
    const targetWeek = next.weeks[input.week] || {};
    for (const row of rows) {
      targetWeek[row.employeeId] = row.shifts.map(label => {
        if (!label) return '';
        filledCells++;
        const key = shiftLabelKey(label);
        if (!shiftByLabel.has(key)) {
          if (next.shifts.length >= maxShifts) fail('Недостаточно места для новых вариантов смен. Удалите неиспользуемый вариант через «Настроить».');
          while (shiftIds.has('import-shift-' + shiftNumber)) shiftNumber++;
          const shiftId = 'import-shift-' + shiftNumber++;
          shiftIds.add(shiftId);
          next.shifts.push({ id: shiftId, label, color: '#e6eee6' });
          shiftByLabel.set(key, shiftId);
        }
        return shiftByLabel.get(key);
      });
    }
    next.weeks[input.week] = targetWeek;
    next.selectedWeek = input.week;
    return { state: validateState(next), employeesApplied: rows.length, filledCells };
  }
  function load(storage) {
    let raw;
    try { raw = storage.getItem(STORAGE_KEY); }
    catch (_) {
      return { state: createState(), error: 'Браузер запретил доступ к локальному сохранению. Изменения нужно сохранять в JSON.', recovered: false };
    }
    if (raw === null || raw === undefined) {
      let backup;
      try { backup = storage.getItem(BACKUP_KEY); }
      catch (_) {
        return {
          state: createState(), recovered: false,
          error: 'Основное сохранение отсутствует, а браузер не дал прочитать резервную копию. Сохранённые данные оставлены без изменений. Импортируйте JSON-копию.'
        };
      }
      if (backup === null || backup === undefined) return { state: createState(), error: null, recovered: false };
      try {
        return {
          state: decode(backup), recovered: true,
          error: 'Основное сохранение отсутствует. Восстановлена предыдущая сохранённая версия из резервной копии.'
        };
      } catch (error) {
        return {
          state: createState(), recovered: false,
          error: 'Основное сохранение отсутствует. Не удалось прочитать резервную копию: ' + error.message + ' Исходная копия оставлена без изменений. Импортируйте JSON-копию.'
        };
      }
    }
    try { return { state: decode(raw), error: null, recovered: false }; }
    catch (error) {
      try {
        const backup = storage.getItem(BACKUP_KEY);
        if (backup !== null && backup !== undefined) {
          return {
            state: decode(backup), recovered: true,
            error: 'Основное сохранение повреждено. Восстановлена предыдущая сохранённая версия. Повреждённые данные сохранены в браузере.'
          };
        }
      } catch (_) { /* Нечитаемая копия не заменяет исходные данные. */ }
      return {
        state: createState(), recovered: false,
        error: 'Не удалось прочитать сохранение: ' + error.message + ' Исходные данные сохранены в браузере. Импортируйте резервную копию JSON.'
      };
    }
  }
  function save(storage, state) {
    const valid = validateState(state);
    const serialized = JSON.stringify(valid);
    let previous;
    try { previous = storage.getItem(STORAGE_KEY); }
    catch (_) { fail('Браузер запретил локальное сохранение. Скачайте резервную копию JSON.'); }
    // Повторное открытие страницы не заменяет полезную предыдущую копию
    // тем же самым состоянием и не требует новой записи в хранилище.
    if (previous === serialized) return valid;
    if (previous !== null && previous !== undefined) {
      try { decode(previous); }
      catch (_) {
        try {
          // Не перезаписываем повреждённый оригинал без сохранения его точной копии.
          storage.setItem(STORAGE_KEY + ':corrupt:' + Date.now() + ':' + Math.random().toString(36).slice(2, 8), previous);
        } catch (_) { fail('Не удалось сохранить повреждённый оригинал. Скачайте JSON; исходные данные оставлены без изменений.'); }
        previous = null;
      }
    }
    try { storage.setItem(STORAGE_KEY, serialized); }
    catch (_) { fail('Не удалось сохранить изменения в браузере: возможно, закончилось место. Скачайте резервную копию JSON.'); }
    // Сбой дополнительной копии не превращает уже успешное сохранение в ошибку.
    if (previous !== null && previous !== undefined) {
      try { storage.setItem(BACKUP_KEY, previous); } catch (_) { /* best effort */ }
    }
    return valid;
  }

  return { STORAGE_KEY, BACKUP_KEY, createState, monday, addDays, weekDates, previousWeek, validateState, configureShiftPresets, selectableShifts, mergeRoster, importWeekSchedule, load, save };
});
