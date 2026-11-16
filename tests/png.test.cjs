'use strict';

// These tests use a real Canvas implementation. The app itself has no dependencies.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let nativeCanvas;
try { nativeCanvas = require('@napi-rs/canvas'); }
catch {
  nativeCanvas = require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
}
const Core = require(require('./site-path.cjs')('core.js'));

function harness() {
  const text = [];
  const rectangles = [];
  const strokes = [];
  const textStyles = [];
  const canvases = [];
  const document = {
    fonts: { ready: Promise.resolve() },
    createElement(tag) {
      assert.equal(tag, 'canvas', 'PNG generation must not need another DOM element');
      const canvas = nativeCanvas.createCanvas(1, 1);
      const context = canvas.getContext('2d');
      const proxy = new Proxy(context, {
        get(target, property) {
          if (property === 'fillText') return (value, ...args) => {
            text.push(String(value));
            textStyles.push({text:String(value),font:target.font,color:target.fillStyle,args});
            return target.fillText(String(value), ...args);
          };
          if (property === 'fillRect') return (...args) => {
            rectangles.push({color: target.fillStyle, args});
            return target.fillRect(...args);
          };
          if (property === 'strokeRect' || property === 'stroke') return (...args) => {
            strokes.push({color:target.strokeStyle,width:target.lineWidth,args,method:property});
            return target[property](...args);
          };
          const value = target[property];
          return typeof value === 'function' ? value.bind(target) : value;
        },
        set(target, property, value) {
          target[property] = value;
          if (property === 'font') {
            assert.ok(target.measureText('ЛЕСНОЙ').width < 500,
              `Canvas font shorthand was not interpreted at the intended size: ${value}`);
          }
          return true;
        }
      });
      canvas.getContext = kind => { assert.equal(kind, '2d'); return proxy; };
      canvas.toBlob = (callback, mime = 'image/png') => {
        try { callback(new Blob([canvas.toBuffer(mime)], {type: mime})); }
        catch { callback(null); }
      };
      canvases.push(canvas);
      return canvas;
    }
  };
  const sandbox = {window: {LesnoyCore: Core, document}, document, Blob, console, Date, URL, setTimeout, clearTimeout};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require('./site-path.cjs')('png.js'), 'utf8'), sandbox, {filename: 'png.js'});
  return {api: sandbox.window.LesnoyPNG, text, rectangles, strokes, textStyles, canvases};
}

function schedule(count = 8) {
  const state = Core.createState(new Date('2026-11-16T12:00:00Z'));
  // Old saved weeks must remain exportable after the quick-pick buttons change.
  for (const shift of [
    {id:'late',label:'12–00',color:'#e4ebf5'},
    {id:'off',label:'В',color:'#f1f0ed'},
    {id:'vacation',label:'ОТ',color:'#e8e1ef'},
    {id:'sick',label:'Б',color:'#f6e4df'}
  ]) {
    if (!state.shifts.some(existing => existing.id === shift.id)) state.shifts.push(shift);
  }
  state.selectedWeek = '2026-11-16';
  state.employees = Array.from({length: count}, (_, index) => ({
    id: `test_${index + 1}`, name: `Тестовый повар ${index + 1}`,
    phone: `ТЕСТ-ТЕЛЕФОН-${index + 1}`, department: state.departments[index % state.departments.length].id
  }));
  state.weeks[state.selectedWeek] = Object.fromEntries(state.employees.map((employee, index) => [employee.id,
    ['day', 'day', 'off', 'late', 'day', 'late', index % 2 ? 'off' : 'day']
  ]));
  return Core.validateState(state);
}

async function decode(result) {
  assert.equal(result.blob.type, 'image/png');
  const bytes = Buffer.from(await result.blob.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const image = await nativeCanvas.loadImage(bytes);
  assert.equal(image.width, result.width);
  assert.equal(image.height, result.height);
  return {bytes, image};
}

function yellow(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return false;
  const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
  return r > 225 && g > 185 && b < g - 15;
}

// A native Canvas verifies pixels and encoder output, but does not emulate Safari's download UI.
test('full PNG contains every employee, both highlighted columns, dates and a real decodable PNG', async () => {
  const h = harness();
  const state = schedule();
  const result = await h.api.render(state, state.selectedWeek);
  const {bytes} = await decode(result);
  assert.equal(result.width, 2400);
  assert.ok(result.height > 300);
  assert.match(result.filename, /2026-11-16.*\.png$/);
  for (const employee of state.employees) {
    assert.ok(h.text.includes(employee.name), `${employee.name} must be in the full PNG`);
    assert.ok(h.text.includes(employee.phone), `${employee.name}: phone should be included by default`);
  }
  const highlights = h.rectangles.filter(rect => yellow(rect.color));
  assert.ok(highlights.length >= 2 * state.employees.length, `Expected >=${2 * state.employees.length} yellow cells, got ${highlights.length}`);
  assert.ok(h.text.some(line => /График кухни.*ЛЕСНОЙ/.test(line)));
  for (const day of ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье']) {
    assert.ok(h.text.includes(day),`Full weekday heading missing: ${day}`);
  }
  for (const day of [16,17,18,19,20,21,22]) assert.ok(h.text.includes(`${day}.11.2026`));
  fs.mkdirSync(path.join(__dirname, 'artifacts'), {recursive: true});
  fs.writeFileSync(path.join(__dirname, 'artifacts/schedule.png'), bytes);
});

test('phone hiding omits every phone from the rendered PNG', async () => {
  const h = harness();
  const state = schedule(3);
  const result = await h.api.render(state, state.selectedWeek, {includePhones: false});
  await decode(result);
  for (const employee of state.employees) {
    assert.ok(!h.text.some(line => line.includes(employee.phone)));
    assert.ok(h.text.includes(employee.name));
  }
});

test('empty roster still exports a valid useful PNG', async () => {
  const h = harness();
  const state = schedule(0);
  const result = await h.api.render(state, state.selectedWeek);
  await decode(result);
  assert.ok(result.width > 1000);
  assert.ok(h.text.some(line => /сотрудник|повар/i.test(line)));
});

test('maximum roster exports all 200 people within the advertised Safari canvas budget', async () => {
  const h = harness();
  const state = schedule(200);
  const result = await h.api.render(state, state.selectedWeek, {includePhones: false});
  await decode(result);
  assert.ok(result.width * result.height <= 15_000_000, `${result.width} × ${result.height} exceeds 15 MP`);
  assert.ok(result.width <= 16000 && result.height <= 16000);
  assert.ok(h.text.includes('Тестовый повар 200'), 'Last row must survive full-table export');
  for (const employee of state.employees) assert.ok(h.text.includes(employee.name));
});

test('long employee, department and shift labels wrap without silently dropping words', async () => {
  const h = harness();
  const state = schedule(1);
  state.employees[0].name = 'Длинноеимябезпробела ЧтобыПроверитьПеренос СоставнаяФамилия';
  state.departments[0].name = 'Очень длинное название производственного цеха специальной подготовки';
  state.shifts[0].label = 'Стажировка до закрытия';
  const result = await h.api.render(state, state.selectedWeek);
  await decode(result);
  const drawn = h.text.join(' ').replace(/\s/g, '');
  for (const value of [state.employees[0].name, state.departments[0].name, state.shifts[0].label]) {
    assert.ok(drawn.includes(value.replace(/\s/g, '')), `Text dropped: ${value}`);
  }
});

test('Excel PNG uses a white sheet, black grid, yellow Friday/Saturday and split time halves', async () => {
  const h=harness();
  const state=schedule(1);
  state.shifts.push({id:'night-test',label:'17:30–03:30',color:'#e6eee6'});
  state.weeks[state.selectedWeek][state.employees[0].id]=['day','off','','night-test','day','night-test',''];
  const result=await h.api.render(state,state.selectedWeek);
  const {image}=await decode(result);
  assert.ok(h.text.includes('График кухни "ЛЕСНОЙ"'));
  for (const value of ['10:00','22:00','17:30','03:30']) assert.ok(h.text.includes(value),`Time half missing: ${value}`);
  assert.ok(!h.text.includes('10–22'),'Intervals should be drawn as two time halves');
  assert.ok(h.text.filter(value=>value==='В').length>=2,'Notation should be repeated into both half cells');
  assert.ok(!h.text.some(value=>/ОБОЗНАЧЕНИЯ СМЕН|Сотрудников:/.test(value)),'Reference Excel visual should have no decorative footer');
  const colors=new Set(h.rectangles.map(rect=>rect.color.toLowerCase()));
  assert.ok(colors.has('#ffffff'),'Sheet background is white');
  assert.ok(colors.has('#ffff66'),'Friday and Saturday use the reference bright yellow');
  for(const color of colors) assert.ok(['#ffffff','#ffff66','#000000'].includes(color),`Unexpected decorative fill: ${color}`);
  assert.ok(h.strokes.length>10,'Black cell boundaries should be drawn');
  for(const stroke of h.strokes) assert.equal(stroke.color.toLowerCase(),'#000000');
  const title=h.textStyles.find(value=>value.text==='График кухни "ЛЕСНОЙ"');
  assert.match(title.font,/italic/,'Reference title is italic');
  const surface=nativeCanvas.createCanvas(image.width,image.height);
  const context=surface.getContext('2d');context.drawImage(image,0,0);
  const yellowRect=h.rectangles.find(rect=>rect.color.toLowerCase()==='#ffff66'&&rect.args[2]>10&&rect.args[3]>10);
  const sx=result.width/1200,sy=result.width/1200;
  const [x,y,w,height]=yellowRect.args;
  const pixel=[...context.getImageData(Math.floor((x+w-4)*sx),Math.floor((y+height-4)*sy),1,1).data];
  assert.deepEqual(pixel,[255,255,102,255],'Yellow must exist in the encoded image, not only draw calls');
});

test('new 11:30–23:30 and Р shifts export beside unchanged historical shift values', async () => {
  const h = harness();
  const state = schedule(1);
  const desired = [
    {id:'midday-test',label:'11:30–23:30',color:'#e4ebf5'},
    {id:'work-test',label:'Р',color:'#e6eee6'}
  ].map(shift => {
    const existing = state.shifts.find(value => value.label === shift.label);
    if (existing) return existing.id;
    state.shifts.push(shift);
    return shift.id;
  });
  state.weeks[state.selectedWeek][state.employees[0].id] = [desired[0],desired[1],'late','off','vacation','sick',''];
  const validated = Core.validateState(state);
  const before = JSON.stringify(validated);
  const result = await h.api.render(validated,validated.selectedWeek);
  await decode(result);
  for (const value of ['11:30','23:30','12:00','00:00']) {
    assert.ok(h.text.includes(value),`New or historical time half was not exported: ${value}`);
  }
  for (const value of ['Р','В','ОТ','Б']) {
    assert.equal(h.text.filter(text => text === value).length,2,`${value} must remain in both day halves`);
  }
  assert.equal(JSON.stringify(validated),before,'Export must not migrate or rewrite historical schedule values');
});

test('editable department rows export their own split times and symbols above employee rows', async () => {
  const h=harness();const state=schedule(1);
  state.weeks[state.selectedWeek][state.employees[0].id]=Array(7).fill('');
  state.shifts.push({id:'section-night',label:'17:45–04:15',color:'#e6eee6'});
  state.departmentWeeks={[state.selectedWeek]:{hot:['section-night','work','','','','','']}};
  const validated=Core.validateState(state);const before=JSON.stringify(validated);
  const result=await h.api.render(validated,validated.selectedWeek);await decode(result);
  for(const value of ['17:45','04:15'])assert.equal(h.text.filter(text=>text===value).length,1);
  assert.equal(h.text.filter(text=>text==='Р').length,2);
  const departmentTime=h.textStyles.find(item=>item.text==='17:45');
  const employeeName=h.textStyles.find(item=>item.text===state.employees[0].name);
  assert.ok(departmentTime.args[1]<employeeName.args[1],'Department values must be inside the header row, above the employee');
  assert.ok(h.rectangles.filter(rect=>rect.color.toLowerCase()==='#ffff66').length>=8);
  assert.equal(JSON.stringify(validated),before,'Export must not change section or staff assignments');
});

test('long department-row labels wrap completely and increase the section row instead of clipping', async () => {
  const first=harness();const baseline=schedule(1);baseline.weeks[baseline.selectedWeek][baseline.employees[0].id]=Array(7).fill('');
  const small=await first.api.render(baseline,baseline.selectedWeek);await decode(small);
  const second=harness();const state=JSON.parse(JSON.stringify(baseline));
  const label='Подготовка и уборка';state.shifts.push({id:'section-note',label,color:'#e6eee6'});
  state.departmentWeeks={[state.selectedWeek]:{hot:['','','','','section-note','','']}};
  const result=await second.api.render(Core.validateState(state),state.selectedWeek);await decode(result);
  assert.ok(second.text.join(' ').replace(/\s/g,'').includes(label.replace(/\s/g,'')),'Wrapped note must survive complete');
  assert.ok(result.height>small.height,'Text taller than one line must grow the department row');
  assert.equal(result.width,2400);
});

test('a department with calendar values remains in PNG even without assigned employees', async () => {
  const h=harness();const state=schedule(1);
  state.weeks[state.selectedWeek][state.employees[0].id]=Array(7).fill('');
  state.departmentWeeks={[state.selectedWeek]:{cold:['','','','','work','','']}};
  const result=await h.api.render(Core.validateState(state),state.selectedWeek);await decode(result);
  assert.ok(h.text.includes('Холодный цех'),'An edited department header must not disappear because its roster is empty');
  assert.equal(h.text.filter(text=>text==='Р').length,2);
});
