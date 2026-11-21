/* ЛЕСНОЙ. Все данные остаются в браузере. Нет сетевых запросов. */
(function () {
  'use strict';
  const C = window.LesnoyCore;
  const ROSTER_KEY = 'lesnoy-kitchen:roster:v1';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone = (s) => JSON.parse(JSON.stringify(s));
  function nationalPhoneFormat(value) {
    if (typeof value !== 'string' || !/^\+7[\d\s().–—-]*$/.test(value.trim())) return value;
    const digits = value.replace(/\D/g,'');
    if (digits.length !== 11) return value;
    return '8-' + digits.slice(1,4) + '-' + digits.slice(4,7) + '-' + digits.slice(7,9) + '-' + digits.slice(9);
  }
  function normalizeEmployeePhones(container) {
    let changed = false;
    if (!Array.isArray(container?.employees)) return changed;
    for (const person of container.employees) {
      const phone = nationalPhoneFormat(person.phone);
      if (phone !== person.phone) { person.phone = phone; changed = true; }
    }
    return changed;
  }
  let storage;
  try { storage = window.localStorage; } catch (_) { storage = null; }
  const loaded = C.load(storage);
  let state = loaded.state;
  let presetsError = null;
  try { state = C.configureShiftPresets(state); } catch (error) { presetsError = error.message; }
  if (normalizeEmployeePhones(state)) state.updatedAt = new Date().toISOString();
  const visibleShifts = () => C.selectableShifts(state).filter(s => s.label.trim().toLocaleUpperCase('ru-RU') !== 'Р');
  const ordinaryShifts = () => visibleShifts().filter(s => !/^ревизия(?:\s|$|[:–-])/i.test(s.label.trim()));
  let brush = ordinaryShifts()[0]?.id ?? null;
  let editMode = false;
  let history = [];
  let toastTimer;
  let dirty = false;
  let externalChange = false;
  let exportURL;
  let exportSequence = 0;
  let scheduleViewport = null;
  const dialog = $('editor-dialog');
  const dateLabel = (date, options) => new Date(date + 'T12:00:00Z').toLocaleDateString('ru-RU', {...options, timeZone:'UTC'});
  const id = (prefix) => prefix + '-' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,10));
  const orderedEmployees = () => state.departments.flatMap((dep) => state.employees.filter((p) => p.department === dep.id));
  const row = (personId,department = false) => (department ? state.departmentWeeks : state.weeks)?.[state.selectedWeek]?.[personId] || Array(7).fill('');
  const shiftById = (shiftId) => state.shifts.find((s) => s.id === shiftId);
  const rangeLabel = () => {
    const dates = C.weekDates(state.selectedWeek);
    const a = dateLabel(dates[0],{day:'numeric',month:'short'}).replace(' г.','');
    const b = dateLabel(dates[6],{day:'numeric',month:'short',year:'numeric'}).replace(' г.','');
    return a + ' — ' + b;
  };

  function toast(message) {
    $('toast').textContent = message;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; },4500);
  }
  function showWarning(message, reload = false) {
    const el = $('storage-warning');
    el.replaceChildren(document.createTextNode(message));
    const backup = document.createElement('button');
    backup.className = 'button small'; backup.textContent = 'Скачать JSON'; backup.onclick = exportJSON; el.append(backup);
    if (reload) {
      const button = document.createElement('button'); button.className = 'button small'; button.textContent = 'Загрузить данные из другой вкладки';
      button.onclick = () => location.reload(); el.append(button);
    }
    el.hidden = false;
  }
  function persist() {
    if (externalChange) return false;
    try {
      C.save(storage, state);
      dirty = false;
      $('save-status').classList.remove('error');
      $('save-status').textContent = 'Сохранено в браузере';
      $('save-status').title = 'Последнее сохранение: ' + new Date(state.updatedAt).toLocaleTimeString('ru-RU');
      $('storage-warning').hidden = true;
      return true;
    } catch (error) {
      dirty = true;
      $('save-status').textContent = 'Не сохранено';
      $('save-status').classList.add('error');
      showWarning('Браузер не сохранил изменения. Они доступны до закрытия страницы. Скачайте JSON, чтобы не потерять данные. ' + error.message);
      return false;
    }
  }
  function commit(change, message, remember = true) {
    if (externalChange) { toast('График изменён в другой вкладке. Сначала загрузите её данные.'); return false; }
    const before = clone(state);
    const next = clone(state);
    try {
      change(next);
      normalizeEmployeePhones(next);
      next.updatedAt = new Date().toISOString();
      state = C.validateState(next);
    } catch (error) { toast(error.message); return false; }
    if (remember) { history.push(before); if (history.length > 20) history.shift(); }
    const saved = persist(); render();
    if (!saved) toast('Изменения применены, но не сохранены. Скачайте JSON.');
    else if (message) toast(message);
    return true;
  }
  function setWeek(value) {
    let week;
    try { week = C.monday(value); } catch (_) { toast('Выберите корректную дату'); return; }
    if (week === state.selectedWeek) return;
    commit((next) => { next.selectedWeek = week; },null,false);
  }
  function moveWeek(days) {
    try { setWeek(C.addDays(state.selectedWeek,days)); }
    catch (_) { toast('Достигнута граница календаря: 1900–2199 годы.'); }
  }
  function applyShift(personId, day, shiftId, message, department = false) {
    if (row(personId,department)[day] === shiftId) return true;
    const scrollLeft = $('table-scroll').scrollLeft, scrollTop = $('table-scroll').scrollTop;
    const applied = commit((next) => {
      const calendar = department ? (next.departmentWeeks ||= {}) : next.weeks;
      const week = calendar[next.selectedWeek] ||= {};
      const values = week[personId] ||= Array(7).fill('');
      values[day] = shiftId;
    },message);
    focusCell(personId,day,false,department);
    $('table-scroll').scrollLeft = scrollLeft; $('table-scroll').scrollTop = scrollTop;
    return applied;
  }
  function focusCell(personId,day,scroll = true,department = false) {
    const button = $('schedule-body').querySelector(`[${department?'data-department-cell':'data-person'}="${personId}"][data-day="${day}"]`);
    button?.focus({preventScroll:true});
    if (scroll && button) {
      if (scheduleViewport) scheduleViewport.reveal(button);
      else button.scrollIntoView({block:'nearest',inline:'nearest'});
    }
  }
  function weekNumber(date) {
    const d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 3);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    return Math.ceil((((d-yearStart)/86400000)+1)/7);
  }
  function departmentCalendarCells(department,dates) {
    return dates.map((date,day) => {
      const shift = shiftById(row(department.id,true)[day]);
      const times = shift ? intervalFromLabel(shift.label) : null;
      return `<td colspan="2" class="group-day shift-cell split-day ${[4,5].includes(day)?'weekend':''}" data-filled="${!!shift}"><button class="cell-button" data-department-cell="${esc(department.id)}" data-day="${day}" aria-label="${esc(department.name)}, ${esc(dateLabel(date,{weekday:'long',day:'numeric',month:'long'}))}: ${esc(shift?.label || 'не заполнено')}"><span class="shift-time time-start" aria-hidden="true">${esc(times?.start || shift?.label || '')}</span><span class="shift-time time-end" aria-hidden="true">${esc(times?.end || shift?.label || '')}</span></button></td>`;
    }).join('');
  }
  function render() {
    const choices = visibleShifts();
    if (brush !== null && brush !== '' && !choices.some((s) => s.id === brush)) brush = null;
    $('week-range').textContent = rangeLabel(); $('week-number').textContent = ' / ' + String(weekNumber(state.selectedWeek)).padStart(2,'0');
    $('week-date').value = state.selectedWeek;
    $('undo').disabled = !history.length || externalChange;
    $('edit-mode').setAttribute('aria-pressed',String(editMode));
    $('mode-hint').textContent = editMode ? 'Нажмите ячейку и задайте время смены' : brush === null ? 'Выберите смену сверху. Нажатие на пустое место снимает выбор' : brush === '' ? 'Нажимайте смены, которые нужно удалить' : 'Нажмите заполненную ячейку, чтобы изменить или удалить смену';
    $('shift-palette').innerHTML = ordinaryShifts().map((s,i) => `<button class="shift-chip" data-brush="${esc(s.id)}" aria-pressed="${brush === s.id}" style="--shift-color:${s.color}" title="${esc(s.label)} · клавиша ${i+1}"><i></i>${esc(s.label)}</button>`).join('') + `<button class="shift-chip" data-brush="" aria-pressed="${brush === ''}" title="Удалять смены нажатием на ячейку"><span class="erase-icon" aria-hidden="true">⌫</span> Удалить смену</button><button id="revision-picker" class="shift-chip" aria-pressed="${/^ревизия/i.test(shiftById(brush)?.label || '')}" title="Выбрать утреннюю или ночную ревизию">Ревизия ▾</button>`;
    const dates = C.weekDates(state.selectedWeek);
    $('schedule-head').innerHTML = '<tr class="sheet-title-row"><th class="sheet-title" colspan="16">График кухни &quot;ЛЕСНОЙ&quot;</th></tr><tr class="sheet-days-row"><th class="employee-header" scope="col" rowspan="2">Фамилия Имя сотрудника</th><th scope="col" rowspan="2" class="phone-header">№ телефона</th>' + dates.map((_,i) => `<th scope="colgroup" colspan="2" class="${[4,5].includes(i)?'weekend':''}">${['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'][i]}</th>`).join('') + '</tr><tr class="sheet-dates-row">' + dates.map((date,i) => `<th scope="colgroup" colspan="2" class="${[4,5].includes(i)?'weekend':''}">${dateLabel(date,{day:'2-digit',month:'2-digit',year:'numeric'})}</th>`).join('') + '</tr>';
    $('schedule-body').innerHTML = state.departments.map((dep) => {
      const people = state.employees.filter((p) => p.department === dep.id);
      return `<tr class="department-row"><th colspan="2" scope="rowgroup"><button data-department="${esc(dep.id)}" title="Редактировать цех">${esc(dep.name)}</button></th>${departmentCalendarCells(dep,dates)}</tr>` + (people.length ? people.map((p) => {
        return `<tr><th scope="row" class="employee-cell"><button class="person-button" data-employee="${esc(p.id)}" title="Редактировать сотрудника">${esc(p.name)}</button></th><td class="phone-cell">${p.phone ? `<a href="tel:${esc(p.phone.replace(/[^+\d]/g,''))}">${esc(p.phone)}</a>` : ''}</td>` + row(p.id).map((shiftId,day) => {
          const s = shiftById(shiftId);
          const times = s ? intervalFromLabel(s.label) : null;
          return `<td colspan="2" class="shift-cell split-day ${[4,5].includes(day)?'weekend':''}" data-filled="${!!s}"><button class="cell-button" data-person="${esc(p.id)}" data-day="${day}" aria-label="${esc(p.name)}, ${esc(dateLabel(dates[day],{weekday:'long',day:'numeric',month:'long'}))}: ${esc(s?.label || 'не заполнено')}"><span class="shift-time time-start" aria-hidden="true">${esc(times?.start || s?.label || '')}</span><span class="shift-time time-end" aria-hidden="true">${esc(times?.end || s?.label || '')}</span></button></td>`;
        }).join('') + '</tr>';
      }).join('') : `<tr class="empty-department"><td colspan="16"><button class="button subtle small" data-add-department="${esc(dep.id)}">＋ Добавить сотрудника в цех</button></td></tr>`);
    }).join('') + (!state.employees.length ? '<tr class="empty-guide"><td colspan="16"><strong>Добавьте команду</strong><p>Добавьте сотрудников или импортируйте файл команды через меню «Данные». Затем выберите смену сверху и нажимайте пустые ячейки.</p><button class="button primary" data-action="first-employee">＋ Добавить сотрудника</button></td></tr>' : '');
    $('schedule-foot').replaceChildren();
    $('team-count').textContent = state.employees.length + ' чел. / ' + state.departments.length + ' цеха';
    scheduleViewport?.refresh();
  }
  function initScheduleViewport() {
    if (!window.LesnoyViewport) return;
    document.documentElement.classList.add('sheet-app');
    const viewport = $('table-scroll');
    viewport.classList.add('canvas-viewport');
    scheduleViewport = window.LesnoyViewport.create({
      viewport,surface:$('schedule-surface'),content:$('schedule'),
      onScale:(view) => { $('zoom-level').textContent = view.percent + '%'; }
    });
    $('zoom-controls').hidden = false;
    $('zoom-in').onclick = () => scheduleViewport.zoomBy(1.2);
    $('zoom-out').onclick = () => scheduleViewport.zoomBy(1 / 1.2);
    $('zoom-fit').onclick = () => scheduleViewport.fit();
    viewport.addEventListener('click',(event) => {
      if (scheduleViewport.isClickBlocked()) { event.preventDefault(); event.stopImmediatePropagation(); }
    },true);
  }

  function modal(title, content, setup) {
    exportSequence++;
    if (exportURL) { URL.revokeObjectURL(exportURL); exportURL = null; }
    $('dialog-title').textContent = title;
    $('dialog-body').innerHTML = content;
    if (!dialog.open) dialog.showModal();
    if (setup) setup($('dialog-body'));
    const first = $('dialog-body').querySelector('input:not([type="checkbox"]):not([type="time"]),select');
    if (first && !first.closest('details:not([open])')) setTimeout(() => first.focus({preventScroll:true}),0);
  }
  function closeModal() { exportSequence++; dialog.close(); }
  function formError(form, error) { form.querySelector('.form-error').textContent = error; }
  function employeeEditor(employeeId, departmentId) {
    const person = state.employees.find((p) => p.id === employeeId);
    if (!state.departments.length) { departmentEditor(); return; }
    modal(person ? 'Редактировать сотрудника' : 'Новый сотрудник',`<form id="employee-form"><div class="form-grid"><label class="field">Имя сотрудника<input name="name" maxlength="100" required autocomplete="off" value="${esc(person?.name || '')}" placeholder="Фамилия и имя"></label><label class="field">Телефон<input name="phone" type="tel" maxlength="50" autocomplete="off" value="${esc(person?.phone || '')}" placeholder="Необязательно"></label><label class="field">Цех<select name="department">${state.departments.map((d) => `<option value="${esc(d.id)}" ${d.id === (person?.department || departmentId)?'selected':''}>${esc(d.name)}</option>`).join('')}</select></label></div><p class="form-error" role="alert"></p><div class="form-actions">${person?'<button type="button" id="delete-employee" class="button subtle danger">Удалить</button>':''}<button type="button" class="button" data-close>Отмена</button><button class="button primary" type="submit">Сохранить</button></div></form>`,(body) => {
      const form = body.querySelector('form');
      form.onsubmit = (event) => {
        event.preventDefault(); const data = new FormData(form); const name = String(data.get('name')).trim();
        if (!name) { formError(form,'Укажите имя сотрудника'); return; }
        if (commit((next) => {
          const values = {id:person?.id || id('person'),name,phone:String(data.get('phone')).trim(),department:String(data.get('department'))};
          if (person) Object.assign(next.employees.find((p) => p.id === person.id), values); else next.employees.push(values);
        },'Сотрудник сохранён')) closeModal();
      };
      body.querySelector('#delete-employee')?.addEventListener('click',() => {
        if (!confirm(`Удалить сотрудника «${person.name}» и его смены во всех неделях? Действие можно отменить кнопкой «Отменить».`)) return;
        if (commit((next) => { next.employees = next.employees.filter((p) => p.id !== person.id); Object.values(next.weeks).forEach((w) => { delete w[person.id]; }); },'Сотрудник удалён')) closeModal();
      });
    });
  }
  function departmentList() {
    modal('Цеха',`<p class="dialog-note">Порядок цехов и сотрудников сохраняется во всех неделях.</p><div>${state.departments.map((d) => `<div class="list-row"><span>${esc(d.name)}</span><button class="button small" data-edit-department="${esc(d.id)}">Изменить</button></div>`).join('')}</div><div class="form-actions"><button class="button primary" id="new-department">＋ Добавить цех</button></div>`,(body) => {
      body.querySelectorAll('[data-edit-department]').forEach((b) => { b.onclick = () => departmentEditor(b.dataset.editDepartment); });
      body.querySelector('#new-department').onclick = () => departmentEditor();
    });
  }
  function departmentEditor(departmentId) {
    const dep = state.departments.find((d) => d.id === departmentId);
    modal(dep ? 'Редактировать цех' : 'Новый цех',`<form><label class="field">Название цеха<input name="name" required maxlength="80" value="${esc(dep?.name || '')}" autocomplete="off"></label><p class="dialog-note">Название изменится во всех неделях. Удалить можно только пустой цех.</p><p class="form-error" role="alert"></p><div class="form-actions">${dep?'<button type="button" id="delete-department" class="button subtle danger">Удалить</button>':''}<button type="button" class="button" data-close>Отмена</button><button type="submit" class="button primary">Сохранить</button></div></form>`,(body) => {
      const form = body.querySelector('form');
      form.onsubmit = (event) => { event.preventDefault(); const name = String(new FormData(form).get('name')).trim();
        if (!name) { formError(form,'Укажите название цеха'); return; }
        if (commit((next) => { if (dep) next.departments.find((d) => d.id === dep.id).name = name; else next.departments.push({id:id('dept'),name}); },'Цех сохранён')) departmentList();
      };
      body.querySelector('#delete-department')?.addEventListener('click',() => {
        if (state.employees.some((p) => p.department === dep.id)) { formError(form,'Сначала перенесите сотрудников в другой цех.'); return; }
        if (!confirm(`Удалить цех «${dep.name}» и значения его строки во всех неделях? Действие можно отменить.`)) return;
        if (commit((next) => { next.departments = next.departments.filter((d) => d.id !== dep.id); Object.values(next.departmentWeeks).forEach((week) => { delete week[dep.id]; }); },'Цех удалён')) departmentList();
      });
    });
  }
  function shiftList() {
    modal('Варианты смен',`<p class="dialog-note">Настройте время и обозначения. Изменение названия или цвета применяется ко всем неделям, где выбрана эта смена.</p>${visibleShifts().map((s) => `<div class="list-row"><i class="color-dot" style="--shift-color:${s.color}"></i><span>${esc(s.label)}</span><button class="button small" data-edit-shift="${esc(s.id)}">Изменить</button></div>`).join('')}<div class="form-actions"><button id="new-shift" class="button primary">＋ Новая смена</button></div>`,(body) => {
      body.querySelectorAll('[data-edit-shift]').forEach((b) => { b.onclick = () => shiftEditor(b.dataset.editShift); });
      body.querySelector('#new-shift').onclick = () => shiftEditor();
    });
  }
  function shiftEditor(shiftId) {
    const shift = shiftById(shiftId);
    modal(shift ? 'Редактировать смену' : 'Новая смена',`<form><div class="form-grid"><label class="field">Время или обозначение<input name="label" required maxlength="24" value="${esc(shift?.label || '')}" placeholder="Например: 09–21" autocomplete="off"></label><label class="field">Цвет<input name="color" type="color" value="${shift?.color || '#e6eee6'}"></label></div><p class="dialog-note">Удалить можно только неиспользуемый вариант смены. Чтобы изменить время отдельной смены или удалить её из графика, нажмите заполненную ячейку.</p><p class="form-error" role="alert"></p><div class="form-actions">${shift?'<button type="button" id="delete-shift" class="button subtle danger">Удалить</button>':''}<button type="button" class="button" id="back-shifts">Назад</button><button type="submit" class="button primary">Сохранить</button></div></form>`,(body) => {
      const form = body.querySelector('form');
      body.querySelector('#back-shifts').onclick = shiftList;
      form.onsubmit = (event) => { event.preventDefault(); const data = new FormData(form); const label = String(data.get('label')).trim();
        if (!label) { formError(form,'Укажите обозначение смены'); return; }
        if (state.shifts.some((s) => s.id !== shift?.id && s.label.toLocaleLowerCase('ru-RU') === label.toLocaleLowerCase('ru-RU'))) { formError(form,'Смена с таким обозначением уже есть'); return; }
        if (commit((next) => { if (shift) Object.assign(next.shifts.find((s) => s.id === shift.id),{label,color:String(data.get('color'))}); else next.shifts.push({id:id('shift'),label,color:String(data.get('color'))}); },'Смена сохранена')) shiftList();
      };
      body.querySelector('#delete-shift')?.addEventListener('click',() => {
        const used = [state.weeks,state.departmentWeeks].some((calendar) => Object.values(calendar).some((w) => Object.values(w).some((r) => r.includes(shift.id))));
        if (used) { formError(form,'Эта смена уже есть в графике. Сначала замените её в соответствующих неделях.'); return; }
        if (!confirm(`Удалить вариант «${shift.label}»?`)) return;
        if (commit((next) => { next.shifts = next.shifts.filter((s) => s.id !== shift.id); },'Смена удалена')) shiftList();
      });
    });
  }
  function intervalFromLabel(label) {
    const match = String(label || '').match(/^(\d{1,2})(?::(\d{2}))?\s*[-–—−]\s*(\d{1,2})(?::(\d{2}))?$/);
    if (!match) return null;
    const start = match[1].padStart(2,'0') + ':' + (match[2] || '00');
    const end = match[3].padStart(2,'0') + ':' + (match[4] || '00');
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(start) && /^([01]\d|2[0-3]):[0-5]\d$/.test(end) ? {start,end} : null;
  }
  function cellEditor(personId,day,department = false) {
    const person = (department ? state.departments : state.employees).find((p) => p.id === personId);
    const current = row(personId,department)[day];
    const interval = intervalFromLabel(shiftById(current)?.label) || (!current ? intervalFromLabel(shiftById(brush)?.label) : null);
    modal(department ? 'Ячейка «' + person.name + '»' : 'Смена сотрудника',`<p class="dialog-note">${esc(person.name)} · ${esc(dateLabel(C.weekDates(state.selectedWeek)[day],{weekday:'long',day:'numeric',month:'long'}))}</p><div class="modal-palette">${ordinaryShifts().map((s) => `<button class="shift-chip" data-pick-shift="${esc(s.id)}" aria-pressed="${current === s.id}" style="--shift-color:${s.color}"><i></i>${esc(s.label)}</button>`).join('')}<button id="pick-cell-revision" class="shift-chip">Ревизия ▾</button></div><form id="interval-form" class="interval-form"><div class="time-fields"><label class="field">Начало смены<input name="start" type="time" step="60" required value="${interval?.start || ''}" autocomplete="off"></label><label class="field">Окончание смены<input name="end" type="time" step="60" required value="${interval?.end || ''}" autocomplete="off"></label></div><p id="interval-summary" class="dialog-note" aria-live="polite"></p><p class="form-error" role="alert"></p><button type="submit" class="button primary interval-save">Сохранить время</button></form><details id="custom-shift-details" class="custom-shift-details"><summary>Другое обозначение смены</summary><form id="custom-shift-form"><label class="field">Обозначение<input name="label" maxlength="24" required placeholder="Например: Стажировка" autocomplete="off"></label><p class="form-error" role="alert"></p><div class="form-actions"><button type="submit" class="button">Применить обозначение</button></div></form></details><div class="form-actions cell-editor-actions"><button id="delete-cell-shift" type="button" class="button danger" ${current?'':'disabled'}><span class="erase-icon" aria-hidden="true">⌫</span> Удалить смену</button><button type="button" class="button" data-close>Закрыть</button></div>`,(body) => {
      body.querySelectorAll('[data-pick-shift]').forEach((b) => { b.onclick = () => { if (applyShift(personId,day,b.dataset.pickShift,'Смена применена',department)) closeModal(); }; });
      body.querySelector('#pick-cell-revision').onclick = () => revisionPicker(shiftId => applyShift(personId,day,shiftId,'Ревизия сохранена',department));
      body.querySelector('#delete-cell-shift').onclick = () => { if (applyShift(personId,day,'','Смена удалена',department)) closeModal(); };
      const form = body.querySelector('#interval-form');
      const customForm = body.querySelector('#custom-shift-form');
      function saveLabel(label, sourceForm, times) {
        const existing = state.shifts.find((s) => {
          if (s.label.toLocaleLowerCase('ru-RU') === label.toLocaleLowerCase('ru-RU')) return true;
          const known = times ? intervalFromLabel(s.label) : null;
          return known && known.start === times.start && known.end === times.end;
        });
        if (!existing && state.shifts.length >= 30) { formError(sourceForm,'Уже есть 30 вариантов смен. Удалите неиспользуемый вариант через «Настроить» или выберите готовую смену.'); return; }
        if (existing) { if (applyShift(personId,day,existing.id,'Время смены сохранено',department)) closeModal(); return; }
        if (commit((next) => {
          const shiftId = id('shift');
          next.shifts.push({id:shiftId,label,color:'#e6eee6'});
          const calendar = department ? (next.departmentWeeks ||= {}) : next.weeks;
          const week = calendar[next.selectedWeek] ||= {}; (week[personId] ||= Array(7).fill(''))[day] = shiftId;
        },'Время смены сохранено')) closeModal();
      }
      function intervalValues() {
        const start = form.elements.namedItem('start').value;
        const end = form.elements.namedItem('end').value;
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)) return {error:'Укажите начало и окончание смены.'};
        if (start === end) return {error:'Начало и окончание должны различаться.'};
        const minutes = (value) => Number(value.slice(0,2)) * 60 + Number(value.slice(3));
        const duration = (minutes(end) - minutes(start) + 1440) % 1440;
        return {start,end,duration,overnight:minutes(end) < minutes(start)};
      }
      function updateSummary() {
        formError(form,'');
        const times = intervalValues();
        const duration = times.error ? '' : `${Math.floor(times.duration / 60)} ч${times.duration % 60 ? ' ' + times.duration % 60 + ' мин' : ''}`;
        body.querySelector('#interval-summary').textContent = times.error || `Длительность: ${duration}${times.overnight ? '. Окончание — ' + times.end + ' следующего дня.' : '.'}`;
      }
      form.oninput = updateSummary;
      form.onchange = updateSummary;
      form.onsubmit = (event) => { event.preventDefault(); const times = intervalValues(); if (times.error) { formError(form,times.error); return; } saveLabel(times.start + '–' + times.end,form,times); };
      customForm.onsubmit = (event) => { event.preventDefault(); const label = String(new FormData(customForm).get('label')).trim(); if (!label) { formError(customForm,'Введите обозначение смены'); return; } saveLabel(label,customForm); };
      updateSummary();
    });
  }
  function undo() {
    if (!history.length || externalChange) return;
    const previous = history.pop(); previous.selectedWeek = state.selectedWeek; previous.updatedAt = new Date().toISOString();
    state = previous; const saved = persist(); render(); toast(saved ? 'Последнее изменение отменено' : 'Изменение отменено, но не сохранено. Скачайте JSON.');
  }
  function download(blob,filename) {
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=filename;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url),60000);
  }
  function exportJSON() {
    download(new Blob([JSON.stringify(state,null,2)],{type:'application/json;charset=utf-8'}),'lesnoy-backup-' + new Date().toISOString().slice(0,10) + '.json');
    toast('Резервная копия подготовлена. Храните JSON в личных файлах.');
  }
  function cachedRoster(persistFormat = false) {
    try {
      const roster = JSON.parse(storage.getItem(ROSTER_KEY));
      C.mergeRoster(C.createState(),roster);
      if (normalizeEmployeePhones(roster) && persistFormat) {
        try { storage.setItem(ROSTER_KEY,JSON.stringify(roster)); } catch (_) { /* основное сохранение проверяется отдельно */ }
      }
      return roster;
    } catch (_) { return null; }
  }
  function writeRosterCache(roster) {
    const recovery = clone(roster);
    normalizeEmployeePhones(recovery);
    try { storage.setItem(ROSTER_KEY,JSON.stringify(recovery)); } catch (_) { /* основное сохранение проверено persist() */ }
  }
  function applyRoster(roster, message) {
    if (!commit((next) => { Object.assign(next,C.mergeRoster(next,roster).state); },message)) return false;
    // Отдельная локальная копия команды позволяет вернуть имена и телефоны,
    // даже если пользователь очистил сотрудников в основном графике.
    writeRosterCache(roster);
    closeModal();
    return true;
  }
  function applyContact(contact) {
    if (contact?.type !== 'lesnoy-contact' || contact.version !== 1 || typeof contact.name !== 'string' || typeof contact.phone !== 'string') throw new Error('Неверный формат контакта.');
    const nameKey = (name) => name.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/\s+/g,' ').trim();
    const next = clone(state);
    let roster = cachedRoster();
    if (!next.employees.length && contact.roster) {
      Object.assign(next,C.mergeRoster(next,contact.roster).state);
      roster = clone(contact.roster);
    }
    const matches = next.employees.filter((person) => nameKey(person.name) === nameKey(contact.name));
    if (matches.length !== 1) throw new Error(matches.length ? 'Найдено несколько сотрудников с таким именем. Уточните контакт.' : 'Сотрудник не найден. Сначала восстановите состав команды.');
    matches[0].phone = contact.phone.trim();
    const updated = C.validateState(next);
    if (!commit((target) => { Object.assign(target,updated); },'Телефон сотрудника обновлён.')) return;
    if (roster) {
      for (const person of roster.employees) if (nameKey(person.name) === nameKey(contact.name)) person.phone = contact.phone.trim();
      writeRosterCache(roster);
    }
    closeModal();
  }
  function applyWeekSchedule(schedule) {
    const seeded = state.employees.length === 0 && schedule.roster;
    const result = C.importWeekSchedule(state,schedule);
    if (!commit((next) => { Object.assign(next,result.state); },'График заполнен: ' + result.filledCells + ' смен у ' + result.employeesApplied + ' сотрудников.')) return;
    if (seeded) writeRosterCache(schedule.roster);
    closeModal();
    scheduleViewport?.fit();
  }
  function rosterPreview(roster) {
    const preview = C.mergeRoster(state,roster);
    const departments = new Map(roster.departments.map((d) => [d.id,d.name]));
    modal('Добавить команду',`<p class="dialog-note">Сотрудников в файле: ${roster.employees.length}. Добавится: ${preview.added}, обновится: ${preview.updated}. Уже заполненные смены и недели сохранятся.</p><div>${roster.employees.map((p) => `<div class="list-row"><span><strong>${esc(p.name)}</strong><br><span style="font-size:11px;color:#7d8973">${esc(departments.get(p.department))} · ${esc(p.phone || 'Телефон не указан')}</span></span></div>`).join('')}</div><p class="dialog-note">Данные сохранятся только в этом браузере. Для другого устройства используйте этот же файл или личную ссылку. Пустое поле телефона не стирает уже введённый номер.</p><div class="form-actions"><button type="button" class="button" data-close>Отмена</button><button id="confirm-roster" class="button primary">Добавить сотрудников</button></div>`,(body) => {
      body.querySelector('#confirm-roster').onclick = () => {
        applyRoster(roster,'Команда добавлена. Смены и недели сохранены.');
      };
    });
  }
  function importParsed(parsed) {
    if (parsed?.type === 'lesnoy-roster') { rosterPreview(parsed); return; }
    if (parsed?.type === 'lesnoy-contact') { applyContact(parsed); return; }
    if (parsed?.type === 'lesnoy-week') { applyWeekSchedule(parsed); return; }
    const incoming = C.configureShiftPresets(C.validateState(parsed));
    if (!confirm(`Импортировать ${incoming.employees.length} сотрудников и ${Object.keys(incoming.weeks).length} недель? Весь текущий график, сотрудники и варианты смен будут заменены. Рекомендуем сначала скачать JSON текущих данных. Замену можно отменить кнопкой «Отменить».`)) return;
    if (commit((next) => { Object.keys(next).forEach((key) => delete next[key]); Object.assign(next,incoming); },'Резервная копия импортирована')) closeModal();
  }
  function importRosterLink() {
    const weekUpdate = location.hash.startsWith('#week=');
    const contactUpdate = location.hash.startsWith('#contact=');
    const restoring = location.hash.startsWith('#restore-roster=');
    const prefix = weekUpdate ? '#week=' : contactUpdate ? '#contact=' : restoring ? '#restore-roster=' : '#roster=';
    if (!location.hash.startsWith(prefix)) return;
    const encoded = location.hash.slice(prefix.length);
    // Фрагмент после # обрабатывается только браузером и не отправляется хостингу.
    // Убираем его из адреса до показа данных и до любых дальнейших переходов.
    try { window.history.replaceState(null,'',location.pathname + location.search); }
    catch (_) { toast('Не удалось убрать личные данные из адреса. Используйте импорт JSON.'); return; }
    try {
      if (encoded.length > 100000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('Неверная ссылка импорта команды.');
      const base64 = encoded.replace(/-/g,'+').replace(/_/g,'/');
      const raw = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
      const decoded = new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(raw,(c) => c.charCodeAt(0)));
      const roster = JSON.parse(decoded);
      if (weekUpdate) { applyWeekSchedule(roster); return; }
      if (contactUpdate) { applyContact(roster); return; }
      if (roster?.type !== 'lesnoy-roster') throw new Error('В ссылке нет списка сотрудников.');
      if (restoring) applyRoster(roster,'Сотрудники, цеха и телефоны восстановлены.');
      else rosterPreview(roster);
    } catch (error) { toast('Изменения не применены: ' + (error instanceof SyntaxError ? 'повреждённые данные' : error.message)); }
  }
  async function importJSON(file) {
    if (!file) return;
    if (file.size > 8*1024*1024) { toast('Файл больше 8 МБ. Выберите резервную копию этого приложения.'); return; }
    try {
      const parsed = JSON.parse((await file.text()).replace(/^\uFEFF/,''));
      importParsed(parsed);
    } catch (error) { toast('Импорт не выполнен: ' + (error instanceof SyntaxError ? 'некорректный JSON' : error.message)); }
  }
  function dataMenu() {
    const roster = cachedRoster();
    modal('Данные и помощь',`<div class="menu-buttons"><button id="json-export" class="button">↓ Сохранить резервную копию JSON</button><button id="json-import" class="button">↑ Импортировать JSON</button>${roster?'<button id="roster-restore" class="button">↶ Восстановить состав команды</button>':''}<button id="help-button" class="button">Как заполнять график</button></div><p class="dialog-note" style="margin-top:20px">Все сотрудники и недели хранятся только в этом браузере. Между iPhone и Mac нет синхронизации: передавайте JSON вручную.<br><br>Резервная копия заменяет все данные. Файл команды добавляет сотрудников и обновляет телефоны, сохраняя уже заполненные смены и недели. Файл графика недели заменяет только указанные строки этой недели, включая пустые дни; другие недели и телефоны сохраняются.<br><br>При очистке данных браузера график будет удалён. Периодически сохраняйте резервную копию. JSON и PNG с телефонами передавайте только тем, кому они предназначены.</p>`,(body) => {
      body.querySelector('#json-export').onclick = exportJSON;
      body.querySelector('#json-import').onclick = () => $('import-file').click();
      body.querySelector('#roster-restore')?.addEventListener('click',() => rosterPreview(roster));
      body.querySelector('#help-button').onclick = help;
    });
  }
  function help() {
    modal('Быстрое заполнение',`<p class="dialog-note">1. Выберите неделю календарём или стрелками.<br>2. Выберите смену в панели и нажимайте пустые ячейки.<br>3. Нажмите заполненную ячейку: можно изменить время начала и окончания или удалить смену. Для пустой ячейки сначала включите «Время вручную». Окончание раньше начала означает следующий день.<br>4. Для быстрого удаления выберите «⌫ Удалить смену» в панели и нажимайте ячейки.<br>5. Нажмите имя сотрудника или название цеха, чтобы изменить его.<br>6. Кнопка «Из прошлой недели» копирует смены. Пятница и суббота выделены жёлтым.<br>7. Для отправки команде нажмите «Скачать PNG».</p><dl class="key-guide"><dt>Стрелки</dt><dd>Переход между ячейками</dd><dt>Enter / пробел</dt><dd>Добавить смену или открыть редактор заполненной ячейки</dd><dt>1–9</dt><dd>Выбрать смену в панели</dd><dt>Delete</dt><dd>Удалить смену из ячейки</dd><dt>F2</dt><dd>Редактор отдельной ячейки</dd><dt>⌘Z / Ctrl+Z</dt><dd>Отменить последнее изменение</dd><dt>⌘V / Ctrl+V</dt><dd>Вставить диапазон смен из Excel начиная с выбранной ячейки. Обозначения должны совпадать с панелью.</dd></dl><p class="dialog-note">Страница закреплена. Сжимайте два пальца для уменьшения графика, разводите для увеличения. Одним пальцем перемещайте лист. Имена, даты и смены масштабируются вместе. Кнопка «Весь график» возвращает общий вид. На Mac также работают трекпад и кнопки «−»/«+». Нажмите телефон, чтобы позвонить.</p>`);
  }
  function pngDialog() {
    modal('График для команды',`<label class="check-label"><input id="png-phones" type="checkbox" checked>Показывать телефоны на картинке</label><p class="dialog-note" id="png-status" role="status">Готовим всю таблицу…</p><img id="png-preview" class="png-preview" alt="Предпросмотр графика кухни" hidden><div class="png-actions"><a id="png-save" class="button primary" hidden>Скачать PNG</a><button id="png-share" class="button" hidden>Поделиться</button></div><p class="dialog-note">На iPhone можно сохранить изображение через меню «Поделиться» или удержанием картинки. Для максимального качества отправляйте в Telegram как файл.</p>`,(body) => {
      const checkbox = body.querySelector('#png-phones');
      const generate = async () => {
        const seq = ++exportSequence;
        body.querySelector('#png-save').hidden = true; body.querySelector('#png-share').hidden = true;
        body.querySelector('#png-preview').hidden = true;
        body.querySelector('#png-status').textContent = 'Готовим всю таблицу…';
        try {
          const result = await window.LesnoyPNG.render(clone(state),state.selectedWeek,{includePhones:checkbox.checked});
          if (seq !== exportSequence || !dialog.open) return;
          if (exportURL) URL.revokeObjectURL(exportURL);
          exportURL = URL.createObjectURL(result.blob);
          const img = body.querySelector('#png-preview'); img.src = exportURL; img.hidden = false;
          const a = body.querySelector('#png-save'); a.href = exportURL; a.download = result.filename; a.hidden = false;
          body.querySelector('#png-status').textContent = `Вся таблица · ${result.width} × ${result.height} px · ${checkbox.checked?'с телефонами':'без телефонов'}`;
          const shareFile = new File([result.blob],result.filename,{type:'image/png'});
          const share = body.querySelector('#png-share');
          let canShare = false;
          try { canShare = !!navigator.canShare?.({files:[shareFile]}); } catch (_) { /* download remains available */ }
          share.hidden = !canShare;
          share.onclick = async () => {
            try { await navigator.share({files:[shareFile]}); }
            catch (error) { if (error.name !== 'AbortError') toast('Не удалось поделиться. Скачайте PNG или сохраните картинку удержанием.'); }
          };
        } catch (error) { if (seq === exportSequence) body.querySelector('#png-status').textContent = 'Не удалось создать PNG. ' + error.message; }
      };
      checkbox.onchange = generate; generate();
    });
  }
  function copyPreviousWeek() {
    let source,departmentSource;
    try { const previous = C.previousWeek(state.selectedWeek); source = state.weeks[previous] || {}; departmentSource = state.departmentWeeks[previous] || {}; }
    catch (_) { toast('Предыдущая неделя за пределами календаря.'); return; }
    const hasValues = (week) => Object.values(week).some((values) => values.some(Boolean));
    if (!hasValues(source) && !hasValues(departmentSource)) { toast('В предыдущей неделе пока нет смен'); return; }
    const filled = hasValues(state.weeks[state.selectedWeek] || {}) || hasValues(state.departmentWeeks[state.selectedWeek] || {});
    if (filled && !confirm('Заменить смены выбранной недели графиком предыдущей недели? Сотрудники и телефоны сохранятся. Действие можно отменить.')) return;
    commit((next) => { next.weeks[next.selectedWeek] = clone(source); next.departmentWeeks[next.selectedWeek] = clone(departmentSource); },'Смены скопированы из предыдущей недели');
  }
  function pasteRange(event) {
    const target = event.target.closest('[data-person][data-day],[data-department-cell][data-day]');
    if (!target || dialog.open) return;
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain');
    if (!text || text.length > 40000) { toast('Нет данных для вставки или диапазон слишком большой'); return; }
    const grid = text.replace(/\r\n?/g,'\n').replace(/\n+$/,'').split('\n').map((line) => line.split('\t').map((v) => v.trim()));
    const department = target.hasAttribute('data-department-cell');
    const people = department ? [{id:target.dataset.departmentCell}] : orderedEmployees(); const start = department ? 0 : people.findIndex((p) => p.id === target.dataset.person); const day = Number(target.dataset.day);
    if (start + grid.length > people.length || grid.some((r) => day + r.length > 7)) { toast('Диапазон выходит за пределы таблицы. Выберите другую начальную ячейку.'); return; }
    const normalize = (s) => s.replace(/[—–−]/g,'-').replace(/\s/g,'').toLocaleLowerCase('ru-RU');
    const matches = new Map(state.shifts.map((s) => [normalize(s.label),s.id]));
    const unknown = grid.flat().find((s) => s !== '' && s !== '-' && !matches.has(normalize(s)));
    if (unknown !== undefined) { toast(`Неизвестная смена «${unknown.slice(0,24)}». Сначала добавьте её в варианты смен.`); return; }
    commit((next) => {
      const calendar = department ? next.departmentWeeks : next.weeks;
      const week = calendar[next.selectedWeek] ||= {};
      grid.forEach((r,offset) => { const values = week[people[start+offset].id] ||= Array(7).fill(''); r.forEach((s,i) => { values[day+i] = matches.get(normalize(s)) || ''; }); });
    },'Диапазон из Excel вставлен');
    focusCell(department ? target.dataset.departmentCell : target.dataset.person,day,true,department);
  }

  function revisionPicker(pick) {
    modal('Ревизия','<div class="revision-options"><button class="button" data-revision-period="утро">Ревизия утро</button><button class="button" data-revision-period="ночь">Ревизия ночь</button></div>',body => {
      body.querySelectorAll('[data-revision-period]').forEach(button => { button.onclick = () => {
        const label = 'Ревизия ' + button.dataset.revisionPeriod;
        let shift = state.shifts.find(s => s.label.trim().toLocaleLowerCase('ru-RU') === label.toLocaleLowerCase('ru-RU'));
        if (!shift) {
          if (state.shifts.length >= 33) { toast('Удалите неиспользуемый вариант через «Настроить», чтобы добавить ревизию.'); return; }
          shift = {id:id('revision'),label,color:'#f0e9d2'};
          if (!commit(next => next.shifts.push(shift))) return;
        }
        if (pick(shift.id) === false) return;
        closeModal();
        const menu = $('mobile-menu-toggle'); if (menu?.getAttribute('aria-expanded') === 'true') menu.click();
      }; });
    });
  }
  $('shift-palette').onclick = (event) => {
    if (event.target.closest('#revision-picker')) { revisionPicker(shiftId => { brush=shiftId;editMode=false;render(); }); return; }
    const b = event.target.closest('[data-brush]'); if (b) { brush = b.dataset.brush; editMode = false; render(); }
  };
  $('edit-mode').onclick = () => { editMode = !editMode; render(); };
  $('schedule-body').onclick = (event) => {
    const b = event.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-person')) { const day = Number(b.dataset.day); if (brush === null && !editMode && !row(b.dataset.person)[day]) return; if (editMode || (brush !== '' && row(b.dataset.person)[day])) cellEditor(b.dataset.person,day); else applyShift(b.dataset.person,day,brush); }
    if (b.hasAttribute('data-department-cell')) { const day = Number(b.dataset.day); if (brush === null && !editMode && !row(b.dataset.departmentCell,true)[day]) return; if (editMode || (brush !== '' && row(b.dataset.departmentCell,true)[day])) cellEditor(b.dataset.departmentCell,day,true); else applyShift(b.dataset.departmentCell,day,brush,'Ячейка строки сохранена',true); }
    if (b.hasAttribute('data-employee')) employeeEditor(b.dataset.employee);
    if (b.hasAttribute('data-department')) departmentEditor(b.dataset.department);
    if (b.hasAttribute('data-add-department')) employeeEditor(null,b.dataset.addDepartment);
    if (b.dataset.action === 'first-employee') employeeEditor();
  };
  $('schedule-body').onkeydown = (event) => {
    const b = event.target.closest('[data-person][data-day],[data-department-cell][data-day]'); if (!b) return;
    const department = b.hasAttribute('data-department-cell');
    const personId = department ? b.dataset.departmentCell : b.dataset.person;
    const people = state.departments.flatMap((dep) => [{id:dep.id,department:true},...state.employees.filter((p) => p.department === dep.id).map((p) => ({id:p.id,department:false}))]);
    const personIndex = people.findIndex((p) => p.id === personId && p.department === department), day = Number(b.dataset.day);
    const arrows = {ArrowLeft:[personIndex,day-1],ArrowRight:[personIndex,day+1],ArrowUp:[personIndex-1,day],ArrowDown:[personIndex+1,day]};
    if (arrows[event.key]) { event.preventDefault(); const [i,d] = arrows[event.key]; if (people[i] && d>=0 && d<7) focusCell(people[i].id,d,true,people[i].department); }
    else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); applyShift(personId,day,'',null,department); }
    else if (event.key === 'F2') { event.preventDefault(); cellEditor(personId,day,department); }
    else if (/^[1-9]$/.test(event.key) && !event.metaKey && !event.ctrlKey) { const s = ordinaryShifts()[Number(event.key)-1]; if (s) { event.preventDefault(); brush = s.id; editMode=false; render(); focusCell(personId,day,false,department); toast('Выбрана смена: ' + s.label); } }
  };
  $('schedule-body').addEventListener('paste',pasteRange);
  document.addEventListener('click', event => {
    if ($('schedule-panel')?.hidden || event.defaultPrevented || event.target.closest('button,a,input,select,textarea,label,summary,dialog,[role=button]')) return;
    if (brush !== null || editMode) { brush=null;editMode=false;render(); }
  });
  document.addEventListener('keydown',(event) => {
    if ($('schedule-panel')?.hidden) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey && !dialog.open && !/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) { event.preventDefault(); undo(); }
  });
  $('prev-week').onclick = () => moveWeek(-7);
  $('next-week').onclick = () => moveWeek(7);
  $('today').onclick = () => setWeek(new Date());
  $('week-date').onchange = (event) => { if (event.target.value) setWeek(event.target.value); };
  $('copy-week').onclick = copyPreviousWeek;
  $('undo').onclick = undo;
  $('add-employee').onclick = () => employeeEditor();
  $('manage-departments').onclick = departmentList;
  $('manage-shifts').onclick = shiftList;
  $('data-menu').onclick = dataMenu;
  $('backup-shortcut').onclick = exportJSON;
  $('export-png').onclick = pngDialog;
  $('import-file').onchange = (event) => { importJSON(event.target.files[0]); event.target.value = ''; };
  $('close-dialog').onclick = closeModal;
  $('dialog-body').onclick = (event) => { if (event.target.closest('[data-close]')) closeModal(); };
  dialog.addEventListener('close',() => { exportSequence++; if (exportURL) { URL.revokeObjectURL(exportURL); exportURL=null; } });
  window.addEventListener('beforeunload',(event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('storage',(event) => {
    if (event.key !== C.STORAGE_KEY && event.key !== null) return;
    externalChange = true;
    $('save-status').textContent = 'Другая вкладка'; $('save-status').classList.add('error');
    showWarning('Данные изменены в другой вкладке. Редактирование приостановлено, чтобы не перезаписать изменения. При необходимости сохраните текущий график в JSON и загрузите данные из другой вкладки.',true); render();
  });
  window.addEventListener('hashchange',importRosterLink);
  window.LesnoySchedule = { getState: () => C.validateState(state), refresh: () => scheduleViewport?.refresh() };
  render();
  initScheduleViewport();
  if (loaded.error) {
    $('save-status').textContent = loaded.recovered ? 'Восстановлено из копии' : 'Проверьте данные';
    $('save-status').classList.add('error');
    showWarning(loaded.error + (loaded.recovered ? ' Загружена предыдущая сохранённая копия. Проверьте последние изменения.' : ' Исходные данные не перезаписаны. Если это первое открытие, добавьте сотрудников или импортируйте JSON.'));
  } else if (presetsError) {
    $('save-status').textContent = 'Проверьте смены';
    $('save-status').classList.add('error');
    showWarning('Не удалось обновить набор смен. Существующий график оставлен без изменений. ' + presetsError);
  } else persist();
  cachedRoster(true);
  importRosterLink();
})();
