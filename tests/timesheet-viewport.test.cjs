'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch { ({ JSDOM } = require('/tmp/lesnoy-dom-qa/node_modules/jsdom')); }

function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} != ${expected}`); }
function transform(h, actual, expected) {
  const node = h.w.document.createElement('div'); node.style.transform = expected;
  assert.equal(actual, node.style.transform);
}

function harness(t) {
  const dom = new JSDOM('<!doctype html><div id="viewport"><div id="surface"><table id="table" class="monthly-table"><thead><tr><th rowspan="2">Name</th><th rowspan="2">Role</th><th colspan="2">Days</th></tr><tr><th>1</th><th>2</th></tr></thead><tbody><tr><td><button id="name">Person</button></td><td>Cook</td><td><button id="shift">8</button></td><td>8</td></tr></tbody></table></div></div>', { runScripts: 'outside-only' });
  const w = dom.window, document = w.document;
  const viewport = document.querySelector('#viewport'), surface = document.querySelector('#surface'), content = document.querySelector('#table');
  const dimensions = { width: 600, height: 500, contentWidth: 2000, contentHeight: 1000 };
  for (const [property, key] of [['clientWidth', 'width'], ['clientHeight', 'height']]) Object.defineProperty(viewport, property, { get: () => dimensions[key] });
  for (const [property, key] of [['offsetWidth', 'contentWidth'], ['scrollWidth', 'contentWidth'], ['offsetHeight', 'contentHeight'], ['scrollHeight', 'contentHeight']]) Object.defineProperty(content, property, { get: () => dimensions[key] });
  Object.defineProperty(content.tHead, 'offsetHeight', { get: () => 80 });
  viewport.getBoundingClientRect = () => ({ left: 10, top: 20, width: dimensions.width, height: dimensions.height, right: dimensions.width + 10, bottom: dimensions.height + 20 });
  viewport.setPointerCapture = () => {};
  viewport.releasePointerCapture = () => {};
  const errors = [];
  w.addEventListener('error', event => errors.push(event.error?.message || event.message));
  for (const filename of ['viewport.js', 'timesheet-viewport.js']) w.eval(fs.readFileSync(require('./site-path.cjs')(filename), 'utf8'));
  const controller = w.LesnoyTimesheetViewport.create({ viewport, surface, content, frozenWidth: 335 });
  const edge = kind => viewport.querySelector(`[data-frozen-edge="${kind}"]`);
  const wheel = options => viewport.dispatchEvent(new w.WheelEvent('wheel', { bubbles: true, cancelable: true, ...options }));
  const pointer = (type, target, x, y, id = 1) => {
    const event = new w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: 'touch' } });
    target.dispatchEvent(event);
  };
  t.after(() => { controller.destroy(); w.close(); assert.deepEqual(errors, []); });
  return { w, viewport, surface, content, dimensions, controller, edge, wheel, pointer };
}

test('frozen edges share the table scale and align during initial centered fit', t => {
  const h = harness(t), state = h.controller.getState();
  close(state.scale, 0.3); close(state.y, 100);
  const top = h.edge('top'), left = h.edge('left'), corner = h.edge('corner');
  close(parseFloat(top.style.top), 100); close(parseFloat(top.style.height), 24);
  close(parseFloat(left.style.width), 100.5); close(parseFloat(corner.style.top), 100);
  transform(h, top.firstChild.style.transform, 'translate(0px, 0px) scale(0.3)');
  transform(h, left.firstChild.style.transform, 'translate(0px, 100px) scale(0.3)');
  for (const clip of [top, left, corner]) {
    assert.equal(clip.getAttribute('aria-hidden'), 'true');
    assert.equal(clip.querySelectorAll('[id]').length, 0);
    assert.equal(clip.querySelector('button').tabIndex, -1);
    assert.equal(clip.firstChild.classList.contains('monthly-table'), true);
    assert.equal(clip.firstChild.style.width, '2000px');
  }
});

test('panning pins only the relevant axes and retains the base clamp limits', t => {
  const h = harness(t); h.controller.zoomBy(4); h.wheel({ deltaX: 50, deltaY: 60 });
  let state = h.controller.getState();
  assert.ok(state.x < 0 && state.y < 0);
  transform(h, h.edge('top').firstChild.style.transform, `translate(${state.x}px, 0px) scale(${state.scale})`);
  transform(h, h.edge('left').firstChild.style.transform, `translate(0px, ${state.y}px) scale(${state.scale})`);
  transform(h, h.edge('corner').firstChild.style.transform, `translate(0px, 0px) scale(${state.scale})`);
  assert.equal(h.edge('corner').style.left, '0px'); assert.equal(h.edge('corner').style.top, '0px');
  h.wheel({ deltaX: 100000, deltaY: 100000 }); state = h.controller.getState();
  close(state.x, state.width - state.contentWidth * state.scale);
  close(state.y, state.height - state.contentHeight * state.scale);
  h.controller.zoomBy(100); close(h.controller.getState().scale, 3);
  h.controller.zoomBy(0.000001); close(h.controller.getState().scale, 0.2);
});

test('overlay taps forward exactly one original button click and drags block editing', t => {
  const h = harness(t); let clicks = 0, delegated = 0;
  h.content.querySelector('#name').addEventListener('click', () => clicks++);
  h.viewport.addEventListener('click', event => { if (event.target.closest('button')) delegated++; });
  const button = h.edge('left').querySelector('button');
  button.click(); assert.equal(clicks, 1); assert.equal(delegated, 1);
  h.controller.zoomBy(4);
  h.pointer('pointerdown', button, 300, 220); h.pointer('pointermove', h.w, 340, 250); h.pointer('pointerup', h.w, 340, 250);
  assert.equal(h.controller.isClickBlocked(), true);
  button.click(); assert.equal(clicks, 1); assert.equal(delegated, 1);
});

test('pinching on an overlay uses the shared zoom and blocks the next button click', t => {
  const h = harness(t), button = h.edge('top').querySelector('button');
  let clicks = 0; h.content.querySelector('#name').addEventListener('click', () => clicks++);
  h.pointer('pointerdown', button, 200, 220, 1); h.pointer('pointerdown', button, 300, 220, 2);
  h.pointer('pointermove', h.w, 150, 220, 1); h.pointer('pointermove', h.w, 350, 220, 2);
  close(h.controller.getState().scale, 0.6);
  h.pointer('pointerup', h.w, 150, 220, 1); h.pointer('pointerup', h.w, 350, 220, 2);
  button.click(); assert.equal(clicks, 0); assert.equal(h.controller.isClickBlocked(), true);
});

test('refresh and observed content changes rebuild clones without observing clones recursively', async t => {
  const h = harness(t); h.content.querySelector('#name').textContent = 'Updated';
  await new Promise(resolve => h.w.setTimeout(resolve, 0));
  assert.equal(h.edge('left').querySelector('button').textContent, 'Updated');
  h.dimensions.contentWidth = 2400; h.controller.refresh();
  assert.equal(h.edge('corner').firstChild.style.width, '2400px');
  const clone = h.edge('corner').firstChild;
  await new Promise(resolve => h.w.setTimeout(resolve, 0));
  assert.equal(h.edge('corner').firstChild, clone);
  h.controller.setFrozen(false); assert.equal(h.edge('left').style.display, 'none');
  h.controller.setFrozen(true); assert.equal(h.edge('left').style.display, 'block');
});

test('keyboard reveal leaves day cells clear of both frozen strips', t => {
  const h = harness(t); h.controller.zoomBy(2);
  const button = h.content.querySelector('#shift');
  button.getBoundingClientRect = () => {
    const s = h.controller.getState(), left = 10 + s.x + 700 * s.scale, top = 20 + s.y + 400 * s.scale;
    return { left, top, right: left + 80 * s.scale, bottom: top + 40 * s.scale };
  };
  h.wheel({ deltaX: 260, deltaY: 200 });
  const scale = h.controller.getState().scale; h.controller.reveal(button);
  const bounds = button.getBoundingClientRect(), state = h.controller.getState();
  close(state.scale, scale);
  assert.ok(bounds.left >= 10 + 335 * scale + 8 - 0.001);
  assert.ok(bounds.top >= 20 + 80 * scale + 8 - 0.001);
  assert.ok(bounds.right <= 610 && bounds.bottom <= 520);
});

test('large phone zoom clips names to 45 percent and reveals days beside that visible strip', t => {
  const h = harness(t); h.dimensions.width = 390; h.controller.refresh(); h.controller.zoomBy(8);
  const state = h.controller.getState();
  assert.ok(335 * state.scale > 390);
  close(parseFloat(h.edge('left').style.width), 390 * 0.45);
  close(parseFloat(h.edge('corner').style.width), 390 * 0.45);
  const button = h.content.querySelector('#shift');
  button.getBoundingClientRect = () => {
    const s = h.controller.getState(), left = 10 + s.x + 900 * s.scale, top = 20 + s.y + 500 * s.scale;
    return { left, top, right: left + 40 * s.scale, bottom: top + 20 * s.scale };
  };
  h.wheel({ deltaX: 400 }); h.controller.reveal(button);
  const bounds = button.getBoundingClientRect();
  assert.ok(bounds.left >= 10 + 390 * 0.45 + 8 - 0.001);
  assert.ok(bounds.right <= 400.001);
});

test('destroy removes clones and disables input and queued refresh work', async t => {
  const h = harness(t); const before = h.controller.getState();
  h.content.querySelector('#name').textContent = 'Queued'; h.controller.destroy();
  h.wheel({ deltaY: -100, ctrlKey: true });
  h.controller.setFrozen(true); await new Promise(resolve => h.w.setTimeout(resolve, 0));
  assert.equal(h.viewport.querySelectorAll('[data-frozen-edge]').length, 0);
  assert.deepEqual(h.controller.getState(), before);
});
