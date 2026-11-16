/* PNG в виде компактного листа Excel. Экспорт рисуется непосредственно
   в Canvas и включает все строки независимо от прокрутки экрана. */
(function (root) {
  'use strict';

  const WIDTH = 1200;
  const EDGE = 1;
  const INNER = WIDTH - EDGE * 2;
  const TITLE_HEIGHT = 38;
  const DAY_HEIGHT = 28;
  const DATE_HEIGHT = 26;
  const C = { ink: '#000000', line: '#000000', paper: '#ffffff', weekend: '#ffff66' };
  const DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

  function font(ctx, weight, size, italic = false) {
    ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px Arial, "Liberation Sans", sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = C.ink;
  }

  function wrap(ctx, value, maxWidth) {
    const output = [];
    String(value == null ? '' : value).split(/\r?\n/).forEach(paragraph => {
      let current = '';
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (!words.length) { output.push(''); return; }
      words.forEach(word => {
        const candidate = current ? current + ' ' + word : word;
        if (ctx.measureText(candidate).width <= maxWidth) { current = candidate; return; }
        if (current) { output.push(current); current = ''; }
        if (ctx.measureText(word).width <= maxWidth) { current = word; return; }
        Array.from(word).forEach(char => {
          if (current && ctx.measureText(current + char).width > maxWidth) {
            output.push(current); current = '';
          }
          current += char;
        });
      });
      if (current) output.push(current);
    });
    return output.length ? output : [''];
  }

  function drawLines(ctx, content, x, y, width, height, lineHeight) {
    ctx.textAlign = 'center';
    const top = y + (height - content.length * lineHeight) / 2;
    content.forEach((line, index) => ctx.fillText(line, x + width / 2, top + index * lineHeight));
    ctx.textAlign = 'left';
  }

  function cell(ctx, x, y, width, height, fill = C.paper, lineWidth = 0.75) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = C.line;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(x, y, width, height);
    ctx.fillStyle = C.ink;
  }

  function vertical(ctx, x, top, bottom, thickness = 1.5) {
    ctx.strokeStyle = C.line;
    ctx.lineWidth = thickness;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
  }

  function displayDate(key) {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC'
    }).format(new Date(key + 'T12:00:00Z'));
  }

  function datesFor(key) {
    if (root.LesnoyCore) return root.LesnoyCore.weekDates(key);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(key + 'T12:00:00Z');
      date.setUTCDate(date.getUTCDate() + index);
      return date.toISOString().slice(0, 10);
    });
  }

  function splitShift(label) {
    const text = String(label || '').trim();
    const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*[-–—−]\s*(\d{1,2})(?::(\d{2}))?$/);
    if (match) {
      const first = match[1].padStart(2, '0') + ':' + (match[2] || '00');
      const second = match[3].padStart(2, '0') + ':' + (match[4] || '00');
      const valid = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (valid.test(first) && valid.test(second)) return [first, second];
    }
    // В оригинальном листе обозначение «Р» занимает обе половины дня.
    return [text, text];
  }

  async function render(state, weekKey, { includePhones = true } = {}) {
    if (!root.document) throw new Error('Экспорт PNG доступен в браузере.');
    const canvas = root.document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Браузер не поддерживает создание изображения.');
    const dates = datesFor(weekKey);
    const shifts = new Map(state.shifts.map(shift => [shift.id, shift]));
    const week = state.weeks[weekKey] || {};
    const departmentWeek = state.departmentWeeks?.[weekKey] || {};
    const nameWidth = includePhones ? 190 : 220;
    const phoneWidth = includePhones ? 120 : 0;
    const leftWidth = nameWidth + phoneWidth;
    const dayWidth = (INNER - leftWidth) / 7;
    const halfWidth = dayWidth / 2;
    const dayStart = EDGE + leftWidth;
    const headerY = EDGE + TITLE_HEIGHT;
    const bodyY = headerY + DAY_HEIGHT + DATE_HEIGHT;
    const rows = [];
    let y = bodyY;
    function shiftCells(values) {
      font(ctx, 400, 13, true);
      return dates.map((_, day) => {
        const shift = shifts.get((values || [])[day]);
        const parts = splitShift(shift ? shift.label : '');
        return parts.map(part => wrap(ctx, part, halfWidth - 8));
      });
    }

    // Каждая подпись измеряется в пределах своей ячейки, длинные слова переносятся.
    state.departments.forEach(department => {
      const employees = state.employees.filter(person => person.department === department.id);
      const departmentValues = departmentWeek[department.id] || [];
      if (!employees.length && state.employees.length && !departmentValues.some(value => shifts.has(value))) return;
      font(ctx, 700, 15, true);
      const groupLines = wrap(ctx, department.name, leftWidth - 12);
      const groupCells = shiftCells(departmentValues);
      const groupCellLines = Math.max(...groupCells.flat().map(lines => lines.length));
      const groupHeight = Math.max(28, groupLines.length * 18 + 10, groupCellLines * 17 + 11);
      rows.push({ type: 'department', text: groupLines, cells: groupCells, y, height: groupHeight });
      y += groupHeight;
      employees.forEach(person => {
        font(ctx, 400, 14, true);
        const nameLines = wrap(ctx, person.name, nameWidth - 10);
        font(ctx, 400, 13, true);
        const phoneLines = includePhones ? wrap(ctx, person.phone || '', phoneWidth - 6) : [];
        const cells = shiftCells(week[person.id]);
        const lineCount = Math.max(nameLines.length, phoneLines.length, ...cells.flat().map(lines => lines.length));
        const height = Math.max(30, lineCount * 17 + 13);
        rows.push({ type: 'person', nameLines, phoneLines, cells, y, height });
        y += height;
      });
    });
    if (!state.employees.length) {
      rows.push({ type: 'empty', y, height: 48 });
      y += 48;
    }
    const height = Math.ceil(y + EDGE);
    // Ограничиваем площадь и длину Canvas для мобильных браузеров.
    const scale = Math.min(2, Math.sqrt(15000000 / (WIDTH * height)), 16000 / height);
    canvas.width = Math.floor(WIDTH * scale);
    canvas.height = Math.floor(height * scale);
    ctx.scale(canvas.width / WIDTH, canvas.height / height);
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, WIDTH, height);

    // Объединённая строка заголовка и двухстрочная шапка, как в исходном Excel.
    cell(ctx, EDGE, EDGE, INNER, TITLE_HEIGHT, C.paper, 1.5);
    font(ctx, 700, 25, true);
    drawLines(ctx, ['График кухни "ЛЕСНОЙ"'], EDGE, EDGE, INNER, TITLE_HEIGHT, 30);
    cell(ctx, EDGE, headerY, nameWidth, DAY_HEIGHT + DATE_HEIGHT, C.paper, 1.5);
    font(ctx, 400, 14);
    drawLines(ctx, wrap(ctx, 'Фамилия Имя сотрудника', nameWidth - 12), EDGE, headerY, nameWidth, DAY_HEIGHT + DATE_HEIGHT, 17);
    if (includePhones) {
      cell(ctx, EDGE + nameWidth, headerY, phoneWidth, DAY_HEIGHT + DATE_HEIGHT, C.paper, 1.5);
      drawLines(ctx, ['№ телефона'], EDGE + nameWidth, headerY, phoneWidth, DAY_HEIGHT + DATE_HEIGHT, 17);
    }
    dates.forEach((date, day) => {
      const x = dayStart + day * dayWidth;
      const fill = day === 4 || day === 5 ? C.weekend : C.paper;
      cell(ctx, x, headerY, dayWidth, DAY_HEIGHT, fill, 1.5);
      font(ctx, 700, 15, true);
      drawLines(ctx, [DAYS[day]], x, headerY, dayWidth, DAY_HEIGHT, 18);
      cell(ctx, x, headerY + DAY_HEIGHT, dayWidth, DATE_HEIGHT, fill, 1.5);
      font(ctx, 700, 15);
      drawLines(ctx, [displayDate(date)], x, headerY + DAY_HEIGHT, dayWidth, DATE_HEIGHT, 18);
    });

    rows.forEach(row => {
      if (row.type === 'empty') {
        cell(ctx, EDGE, row.y, INNER, row.height, C.paper, 1.5);
        font(ctx, 400, 14, true);
        drawLines(ctx, ['Добавьте сотрудников и заполните график'], EDGE, row.y, INNER, row.height, 18);
        return;
      }
      if (row.type === 'department') {
        cell(ctx, EDGE, row.y, leftWidth, row.height, C.paper, 1.5);
        font(ctx, 700, 15, true);
        drawLines(ctx, row.text, EDGE, row.y, leftWidth, row.height, 18);
      } else {
        cell(ctx, EDGE, row.y, nameWidth, row.height, C.paper, 1.5);
        font(ctx, 400, 14, true);
        drawLines(ctx, row.nameLines, EDGE, row.y, nameWidth, row.height, 17);
        if (includePhones) {
          cell(ctx, EDGE + nameWidth, row.y, phoneWidth, row.height, C.paper, 1.5);
          font(ctx, 400, 13, true);
          drawLines(ctx, row.phoneLines, EDGE + nameWidth, row.y, phoneWidth, row.height, 17);
        }
      }
      dates.forEach((_, day) => {
        const x = dayStart + day * dayWidth;
        const fill = day === 4 || day === 5 ? C.weekend : C.paper;
        for (let half = 0; half < 2; half++) {
          cell(ctx, x + half * halfWidth, row.y, halfWidth, row.height, fill);
          if (row.cells) {
            font(ctx, 400, 13, true);
            drawLines(ctx, row.cells[day][half], x + half * halfWidth, row.y, halfWidth, row.height, 17);
          }
        }
        vertical(ctx, x, row.y, row.y + row.height);
      });
      vertical(ctx, WIDTH - EDGE, row.y, row.y + row.height);
    });
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(EDGE, EDGE, INNER, height - EDGE * 2);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('Не удалось создать PNG. Попробуйте закрыть лишние вкладки и повторить.')), 'image/png');
    });
    const result = { blob, filename: `lesnoy-grafik-${weekKey}.png`, width: canvas.width, height: canvas.height };
    canvas.width = 1; canvas.height = 1;
    return result;
  }

  root.LesnoyPNG = { render };
  if (typeof module !== 'undefined' && module.exports) module.exports = { render };
})(typeof window !== 'undefined' ? window : globalThis);
