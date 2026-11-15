/* Экспорт рисуется непосредственно в Canvas: не зависит от масштаба экрана,
   прокрутки таблицы, внешних шрифтов и сторонних сервисов. */
(function (root) {
  'use strict';

  // Один стандартный шрифт без сетевой загрузки и платформенных имён.
  const FONT = 'sans-serif';
  const C = {
    ink: '#183e33', muted: '#62756a', line: '#d5ded5', paper: '#ffffff',
    stripe: '#f7f9f5', group: '#e9efe7', weekend: '#fff1b8', weekendHead: '#f4d873'
  };
  const DAYS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
  const WIDTH = 1200;
  const MARGIN = 36;
  const INNER = WIDTH - MARGIN * 2;

  function font(ctx, weight, size) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textBaseline = 'top';
  }

  // Разбиваем даже длинное слово: ни имя, ни подпись смены не обрезаются.
  function wrap(ctx, value, maxWidth) {
    const paragraphs = String(value == null ? '' : value).split(/\r?\n/);
    const lines = [];
    paragraphs.forEach(paragraph => {
      let current = '';
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (!words.length) { lines.push(''); return; }
      words.forEach(word => {
        const candidate = current ? `${current} ${word}` : word;
        if (ctx.measureText(candidate).width <= maxWidth) {
          current = candidate;
          return;
        }
        if (current) { lines.push(current); current = ''; }
        if (ctx.measureText(word).width <= maxWidth) { current = word; return; }
        Array.from(word).forEach(char => {
          if (current && ctx.measureText(current + char).width > maxWidth) {
            lines.push(current); current = '';
          }
          current += char;
        });
      });
      if (current) lines.push(current);
    });
    return lines.length ? lines : [''];
  }

  function lines(ctx, content, x, y, lineHeight, { center = false, width = 0 } = {}) {
    ctx.textAlign = center ? 'center' : 'left';
    content.forEach((line, i) => ctx.fillText(line, center ? x + width / 2 : x, y + i * lineHeight));
    ctx.textAlign = 'left';
  }

  function parseDate(key) { return new Date(`${key}T12:00:00Z`); }
  function displayDate(key, year) {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit', month: '2-digit', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC'
    }).format(parseDate(key));
  }
  function datesFor(key) {
    if (root.LesnoyCore) return root.LesnoyCore.weekDates(key);
    return Array.from({ length: 7 }, (_, i) => {
      const date = parseDate(key); date.setUTCDate(date.getUTCDate() + i);
      return date.toISOString().slice(0, 10);
    });
  }
  function gridCell(ctx, x, y, w, h, fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 0.75;
    ctx.strokeRect(x, y, w, h);
  }
  function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  async function render(state, weekKey, { includePhones = true } = {}) {
    if (!root.document) throw new Error('Экспорт PNG доступен в браузере.');
    const canvas = root.document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Браузер не поддерживает создание изображения.');
    const dates = datesFor(weekKey);
    const shifts = new Map(state.shifts.map(shift => [shift.id, shift]));
    const week = state.weeks[weekKey] || {};
    const nameWidth = includePhones ? 242 : 274;
    const phoneWidth = includePhones ? 152 : 0;
    const dayWidth = (INNER - nameWidth - phoneWidth) / 7;
    const dayStart = MARGIN + nameWidth + phoneWidth;
    const rows = [];
    let y = 172;
    let rowIndex = 0;

    // Измерение каждого текста тем же шрифтом, которым он будет нарисован.
    state.departments.forEach(department => {
      const employees = state.employees.filter(person => person.department === department.id);
      if (!employees.length) return;
      font(ctx, 600, 15);
      const departmentLines = wrap(ctx, department.name, INNER - 115);
      const groupHeight = Math.max(34, departmentLines.length * 19 + 16);
      rows.push({ type: 'department', lines: departmentLines, count: employees.length, y, height: groupHeight });
      y += groupHeight;
      employees.forEach(person => {
        font(ctx, 600, 15);
        const nameLines = wrap(ctx, person.name, nameWidth - 24);
        font(ctx, 400, 13);
        const phoneLines = includePhones ? wrap(ctx, person.phone || '—', phoneWidth - 20) : [];
        font(ctx, 600, 15);
        const cells = dates.map((_, day) => {
          const id = (week[person.id] || [])[day];
          const shift = shifts.get(id);
          return { shift, lines: wrap(ctx, shift ? shift.label : '—', dayWidth - 18) };
        });
        const textHeight = Math.max(nameLines.length * 19, phoneLines.length * 17,
          ...cells.map(cell => cell.lines.length * 18 + (cell.shift ? 8 : 0)));
        const height = Math.max(46, textHeight + 18);
        rows.push({ type: 'person', nameLines, phoneLines, cells, y, height, stripe: rowIndex++ % 2 !== 0 });
        y += height;
      });
    });
    if (!state.employees.length) {
      rows.push({ type: 'empty', y, height: 80 });
      y += 80;
    }

    const legendTop = y + 30;
    font(ctx, 500, 14);
    const legendItems = [];
    let legendX = MARGIN;
    let legendY = legendTop + 25;
    let legendRowHeight = 0;
    state.shifts.forEach(shift => {
      const labelLines = wrap(ctx, shift.label, Math.min(300, INNER - 35));
      const itemWidth = Math.min(INNER, Math.max(...labelLines.map(line => ctx.measureText(line).width)) + 40);
      const itemHeight = labelLines.length * 18 + 8;
      if (legendX + itemWidth > WIDTH - MARGIN && legendX > MARGIN) {
        legendX = MARGIN;
        legendY += legendRowHeight + 9;
        legendRowHeight = 0;
      }
      legendItems.push({ shift, lines: labelLines, x: legendX, y: legendY });
      legendX += itemWidth + 15;
      legendRowHeight = Math.max(legendRowHeight, itemHeight);
    });
    const footerY = legendY + legendRowHeight + 26;
    const height = Math.ceil(footerY + 58);

    // Safari ограничивает площадь Canvas. Масштаб снижается только для очень
    // длинных списков; экспорт всегда содержит всю таблицу, включая нижние строки.
    const scale = Math.min(2, Math.sqrt(15000000 / (WIDTH * height)), 16000 / height);
    canvas.width = Math.floor(WIDTH * scale);
    canvas.height = Math.floor(height * scale);
    ctx.scale(canvas.width / WIDTH, canvas.height / height);
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, WIDTH, height);

    // Шапка изображения.
    ctx.fillStyle = C.ink;
    ctx.fillRect(MARGIN, 33, 5, 52);
    font(ctx, 700, 36);
    ctx.fillText('ЛЕСНОЙ', MARGIN + 18, 30);
    font(ctx, 500, 13);
    ctx.fillStyle = C.muted;
    ctx.fillText('ГРАФИК КУХНИ', MARGIN + 20, 72);
    ctx.textAlign = 'right';
    font(ctx, 600, 22);
    ctx.fillStyle = C.ink;
    ctx.fillText(`${displayDate(dates[0], dates[0].slice(0, 4) !== dates[6].slice(0, 4))} — ${displayDate(dates[6], true)}`, WIDTH - MARGIN, 38);
    font(ctx, 400, 13);
    ctx.fillStyle = C.muted;
    ctx.fillText('ПОНЕДЕЛЬНИК — ВОСКРЕСЕНЬЕ', WIDTH - MARGIN, 70);
    ctx.textAlign = 'left';

    // Заголовки столбцов.
    const headerY = 110;
    const headerHeight = 62;
    gridCell(ctx, MARGIN, headerY, nameWidth, headerHeight, C.ink);
    font(ctx, 600, 14);
    ctx.fillStyle = C.paper;
    ctx.fillText('Сотрудник', MARGIN + 12, headerY + 23);
    if (includePhones) {
      gridCell(ctx, MARGIN + nameWidth, headerY, phoneWidth, headerHeight, C.ink);
      ctx.fillStyle = C.paper;
      ctx.fillText('Телефон', MARGIN + nameWidth + 10, headerY + 23);
    }
    dates.forEach((date, day) => {
      const weekend = day === 4 || day === 5;
      const x = dayStart + day * dayWidth;
      gridCell(ctx, x, headerY, dayWidth, headerHeight, weekend ? C.weekendHead : C.ink);
      ctx.fillStyle = weekend ? C.ink : C.paper;
      font(ctx, 700, 14);
      lines(ctx, [DAYS[day]], x, headerY + 12, 18, { center: true, width: dayWidth });
      font(ctx, 400, 14);
      lines(ctx, [displayDate(date)], x, headerY + 34, 18, { center: true, width: dayWidth });
    });

    rows.forEach(row => {
      if (row.type === 'department') {
        gridCell(ctx, MARGIN, row.y, INNER, row.height, C.group);
        font(ctx, 600, 15);
        ctx.fillStyle = C.ink;
        lines(ctx, row.lines, MARGIN + 12, row.y + (row.height - row.lines.length * 19) / 2, 19);
        font(ctx, 400, 12);
        ctx.textAlign = 'right';
        ctx.fillStyle = C.muted;
        ctx.fillText(String(row.count), WIDTH - MARGIN - 12, row.y + (row.height - 14) / 2);
        ctx.textAlign = 'left';
        return;
      }
      const fill = row.stripe ? C.stripe : C.paper;
      gridCell(ctx, MARGIN, row.y, nameWidth, row.height, fill);
      if (includePhones) gridCell(ctx, MARGIN + nameWidth, row.y, phoneWidth, row.height, fill);
      dates.forEach((_, day) => gridCell(ctx, dayStart + day * dayWidth, row.y, dayWidth, row.height,
        day === 4 || day === 5 ? C.weekend : fill));
      if (row.type === 'empty') {
        font(ctx, 500, 16);
        ctx.fillStyle = C.muted;
        lines(ctx, ['Добавьте сотрудников и заполните график'], MARGIN, row.y + 30, 20, { center: true, width: INNER });
        return;
      }
      font(ctx, 600, 15);
      ctx.fillStyle = C.ink;
      lines(ctx, row.nameLines, MARGIN + 12, row.y + (row.height - row.nameLines.length * 19) / 2, 19);
      if (includePhones) {
        font(ctx, 400, 13);
        ctx.fillStyle = C.muted;
        lines(ctx, row.phoneLines, MARGIN + nameWidth + 10, row.y + (row.height - row.phoneLines.length * 17) / 2, 17);
      }
      row.cells.forEach((cell, day) => {
        const x = dayStart + day * dayWidth;
        const contentHeight = cell.lines.length * 18 + (cell.shift ? 8 : 0);
        const textY = row.y + (row.height - contentHeight) / 2;
        font(ctx, cell.shift ? 600 : 400, 15);
        ctx.fillStyle = cell.shift ? C.ink : '#a1ada4';
        lines(ctx, cell.lines, x, textY, 18, { center: true, width: dayWidth });
        if (cell.shift) {
          ctx.fillStyle = cell.shift.color;
          roundedRect(ctx, x + dayWidth / 2 - 12, textY + cell.lines.length * 18 + 3, 24, 4, 2);
          ctx.fill();
        }
      });
    });

    font(ctx, 600, 12);
    ctx.fillStyle = C.muted;
    ctx.fillText('ОБОЗНАЧЕНИЯ СМЕН', MARGIN, legendTop);
    legendItems.forEach(item => {
      ctx.fillStyle = item.shift.color;
      roundedRect(ctx, item.x, item.y + 2, 14, 14, 4);
      ctx.fill();
      font(ctx, 500, 14);
      ctx.fillStyle = C.ink;
      lines(ctx, item.lines, item.x + 23, item.y, 18);
    });
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(MARGIN, footerY); ctx.lineTo(WIDTH - MARGIN, footerY); ctx.stroke();
    font(ctx, 400, 12);
    ctx.fillStyle = C.muted;
    ctx.fillText(`Сотрудников: ${state.employees.length}`, MARGIN, footerY + 18);
    ctx.textAlign = 'right';
    ctx.fillText('Пятница и суббота выделены жёлтым', WIDTH - MARGIN, footerY + 18);
    ctx.textAlign = 'left';

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('Не удалось создать PNG. Попробуйте закрыть лишние вкладки и повторить.')), 'image/png');
    });
    const result = { blob, filename: `lesnoy-grafik-${weekKey}.png`, width: canvas.width, height: canvas.height };
    canvas.width = 1; canvas.height = 1;
    return result;
  }

  const api = { render };
  root.LesnoyPNG = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
