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
      employees: [],
      departments: [
        { id: 'hot', name: 'Горячий цех' },
        { id: 'cold', name: 'Холодный цех' },
        { id: 'prep', name: 'Заготовочный цех' }
      ],
      shifts: [
        { id: 'day', label: '10–22', color: '#e6eee6' },
        { id: 'late', label: '12–00', color: '#e4ebf5' },
        { id: 'off', label: 'В', color: '#f1f0ed' },
        { id: 'vacation', label: 'ОТ', color: '#e8e1ef' },
        { id: 'sick', label: 'Б', color: '#f6e4df' }
      ],
      weeks: {},
      selectedWeek: monday(current),
      updatedAt: date.toISOString()
    };
  }

  function validateState(input) {
    record(input, 'Файл');
    if (input.version !== 1) fail('Эта версия резервной копии не поддерживается. Нужна версия 1.');
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
    const shifts = boundedList(input.shifts, 30, 'Смены').map(item => {
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
    weekDates(input.selectedWeek);
    if (typeof input.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.updatedAt) ||
      Number.isNaN(Date.parse(input.updatedAt)) || new Date(input.updatedAt).toISOString() !== input.updatedAt) {
      fail('В резервной копии неверное время сохранения.');
    }
    return { version: 1, employees, departments, shifts, weeks, selectedWeek: input.selectedWeek, updatedAt: input.updatedAt };
  }

  function decode(raw) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { fail('Данные не являются корректным JSON.'); }
    return validateState(parsed);
  }
  function load(storage) {
    let raw;
    try { raw = storage.getItem(STORAGE_KEY); }
    catch (_) {
      return { state: createState(), error: 'Браузер запретил доступ к локальному сохранению. Изменения нужно сохранять в JSON.', recovered: false };
    }
    if (raw === null || raw === undefined) return { state: createState(), error: null, recovered: false };
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

  return { STORAGE_KEY, BACKUP_KEY, createState, monday, addDays, weekDates, previousWeek, validateState, load, save };
});
