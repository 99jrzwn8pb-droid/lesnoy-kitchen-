/* Масштабирование и перемещение всего листа в неподвижной области.
   Работает локально: состояние графика и персональные данные не изменяет. */
(function (root) {
  'use strict';

  function create(options) {
    const viewport = options.viewport;
    const surface = options.surface;
    const content = options.content;
    if (!viewport || !surface || !content) throw new Error('Не найдена область графика для масштабирования.');
    const MIN_SCALE = 0.2;
    const MAX_SCALE = 3;
    const DRAG_THRESHOLD = 6;
    const CLICK_DELAY = 350;
    const pointers = new Map();
    const cleanups = [];
    const state = { scale: 1, x: 0, y: 0, width: 0, height: 0, contentWidth: 1200, contentHeight: 600, manual: false };
    let gesture = null;
    let legacyGesture = null;
    let sequenceMoved = false;
    let blockedUntil = 0;
    let destroyed = false;
    let resizeObserver;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const now = () => Date.now();
    const snapshot = () => ({ ...state, percent: Math.round(state.scale * 100) });
    const suppressClick = () => { blockedUntil = now() + CLICK_DELAY; };

    function listen(target, type, handler, settings) {
      target.addEventListener(type, handler, settings);
      cleanups.push(() => target.removeEventListener(type, handler, settings));
    }
    function measure() {
      const box = viewport.getBoundingClientRect();
      state.width = viewport.clientWidth || box.width || 0;
      state.height = viewport.clientHeight || box.height || 0;
      state.contentWidth = Math.max(content.offsetWidth || 0, content.scrollWidth || 0) || 1200;
      state.contentHeight = Math.max(content.offsetHeight || 0, content.scrollHeight || 0) || 600;
    }
    function constrain() {
      state.scale = clamp(state.scale, MIN_SCALE, MAX_SCALE);
      const width = state.contentWidth * state.scale;
      const height = state.contentHeight * state.scale;
      state.x = width <= state.width ? (state.width - width) / 2 : clamp(state.x, state.width - width, 0);
      state.y = height <= state.height ? (state.height - height) / 2 : clamp(state.y, state.height - height, 0);
    }
    function draw() {
      if (destroyed) return;
      constrain();
      surface.style.transformOrigin = '0 0';
      surface.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
      // Фокус внутри overflow:hidden не должен добавлять второй, нативный сдвиг.
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
      if (typeof options.onScale === 'function') options.onScale(snapshot());
    }
    function refresh(settings) {
      if (destroyed) return snapshot();
      measure();
      if (settings && settings.fit) state.manual = false;
      if (!state.manual && state.width > 0 && state.height > 0) {
        state.scale = clamp(Math.min(state.width / state.contentWidth, state.height / state.contentHeight), MIN_SCALE, MAX_SCALE);
        const width = state.contentWidth * state.scale;
        const height = state.contentHeight * state.scale;
        // Если даже минимальный масштаб не вмещает длинный список, начинаем
        // с первой строки; оставшаяся часть доступна перемещением листа.
        state.x = width <= state.width ? (state.width - width) / 2 : 0;
        state.y = height <= state.height ? (state.height - height) / 2 : 0;
      }
      draw();
      return snapshot();
    }
    function relativePoint(event) {
      const box = viewport.getBoundingClientRect();
      return {
        x: Number.isFinite(event.clientX) ? event.clientX - box.left : state.width / 2,
        y: Number.isFinite(event.clientY) ? event.clientY - box.top : state.height / 2
      };
    }
    function pointPair() {
      return Array.from(pointers.values()).slice(0, 2);
    }
    function geometry(pair) {
      return {
        x: (pair[0].x + pair[1].x) / 2,
        y: (pair[0].y + pair[1].y) / 2,
        distance: Math.max(1, Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y))
      };
    }
    function capture(pointerId) {
      try { viewport.setPointerCapture(pointerId); } catch (_) { /* Старые браузеры: события всё равно отслеживаются на window. */ }
    }
    function release(pointerId) {
      try {
        if (typeof viewport.hasPointerCapture !== 'function' || viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
      } catch (_) { /* Указатель уже отпущен браузером. */ }
    }
    function beginPan() {
      const point = pointers.values().next().value;
      gesture = point ? { kind: 'pan', startX: point.x, startY: point.y, x: state.x, y: state.y } : null;
    }
    function beginPinch() {
      const anchor = geometry(pointPair());
      gesture = {
        kind: 'pinch', scale: state.scale, distance: anchor.distance,
        worldX: (anchor.x - state.x) / state.scale,
        worldY: (anchor.y - state.y) / state.scale
      };
      legacyGesture = null;
      sequenceMoved = true;
      state.manual = true;
      suppressClick();
      viewport.classList.add('is-interacting');
      for (const pointerId of pointers.keys()) capture(pointerId);
    }
    function onPointerDown(event) {
      if (destroyed || (event.pointerType === 'mouse' && event.button !== 0)) return;
      const pointerId = event.pointerId === undefined ? 1 : event.pointerId;
      const point = relativePoint(event);
      pointers.set(pointerId, { ...point, id: pointerId });
      if (pointers.size === 1) {
        sequenceMoved = false;
        beginPan();
      } else beginPinch();
      // Не захватываем одиночное нажатие: иначе Safari перенаправит клик
      // с ячейки на контейнер, и обычное добавление смены перестанет работать.
    }
    function onPointerMove(event) {
      const pointerId = event.pointerId === undefined ? 1 : event.pointerId;
      if (destroyed || !pointers.has(pointerId)) return;
      Object.assign(pointers.get(pointerId), relativePoint(event));
      if (pointers.size >= 2) {
        if (!gesture || gesture.kind !== 'pinch') beginPinch();
        const current = geometry(pointPair());
        state.scale = clamp(gesture.scale * current.distance / gesture.distance, MIN_SCALE, MAX_SCALE);
        state.x = current.x - gesture.worldX * state.scale;
        state.y = current.y - gesture.worldY * state.scale;
        sequenceMoved = true;
        state.manual = true;
        suppressClick();
        if (event.cancelable) event.preventDefault();
        draw();
        return;
      }
      if (!gesture || gesture.kind !== 'pan') beginPan();
      const point = pointers.values().next().value;
      const dx = point.x - gesture.startX;
      const dy = point.y - gesture.startY;
      if (!sequenceMoved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      sequenceMoved = true;
      state.manual = true;
      capture(pointerId);
      viewport.classList.add('is-interacting');
      state.x = gesture.x + dx;
      state.y = gesture.y + dy;
      suppressClick();
      if (event.cancelable) event.preventDefault();
      draw();
    }
    function finishPointer(event, cancelled) {
      const pointerId = event.pointerId === undefined ? 1 : event.pointerId;
      if (!pointers.has(pointerId)) return;
      if (sequenceMoved || cancelled) suppressClick();
      pointers.delete(pointerId);
      release(pointerId);
      if (pointers.size >= 2) beginPinch();
      else if (pointers.size === 1) beginPan();
      else {
        gesture = null;
        sequenceMoved = false;
        viewport.classList.remove('is-interacting');
      }
    }
    const onPointerUp = event => finishPointer(event, false);
    const onPointerCancel = event => finishPointer(event, true);
    function zoomAt(factor, point) {
      if (destroyed || !Number.isFinite(factor) || factor <= 0) return snapshot();
      const worldX = (point.x - state.x) / state.scale;
      const worldY = (point.y - state.y) / state.scale;
      state.scale = clamp(state.scale * factor, MIN_SCALE, MAX_SCALE);
      state.x = point.x - worldX * state.scale;
      state.y = point.y - worldY * state.scale;
      state.manual = true;
      draw();
      return snapshot();
    }
    function onWheel(event) {
      if (destroyed) return;
      if (event.cancelable) event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, state.height) : 1;
      const dx = (event.deltaX || 0) * unit;
      const dy = (event.deltaY || 0) * unit;
      if (event.ctrlKey || event.metaKey) {
        zoomAt(Math.exp(clamp(-dy * 0.005, -2, 2)), relativePoint(event));
      } else {
        state.manual = true;
        state.x -= event.shiftKey && !dx ? dy : dx;
        state.y -= event.shiftKey && !dx ? 0 : dy;
        draw();
      }
    }
    function onGestureStart(event) {
      if (destroyed) return;
      if (event.cancelable) event.preventDefault();
      suppressClick();
      if (pointers.size >= 2) return;
      const anchor = relativePoint(event);
      legacyGesture = {
        scale: state.scale, worldX: (anchor.x - state.x) / state.scale,
        worldY: (anchor.y - state.y) / state.scale
      };
      state.manual = true;
      viewport.classList.add('is-interacting');
    }
    function onGestureChange(event) {
      if (destroyed) return;
      if (event.cancelable) event.preventDefault();
      suppressClick();
      // На современных iPhone PointerEvent уже выполняет тот же жест.
      if (pointers.size >= 2 || !legacyGesture) return;
      const point = relativePoint(event);
      const factor = Number(event.scale);
      if (!Number.isFinite(factor) || factor <= 0) return;
      state.scale = clamp(legacyGesture.scale * factor, MIN_SCALE, MAX_SCALE);
      state.x = point.x - legacyGesture.worldX * state.scale;
      state.y = point.y - legacyGesture.worldY * state.scale;
      draw();
    }
    function onGestureEnd(event) {
      if (event.cancelable) event.preventDefault();
      suppressClick();
      legacyGesture = null;
      if (pointers.size === 1) beginPan();
      if (pointers.size < 2) viewport.classList.remove('is-interacting');
    }
    function onBlur() {
      if (pointers.size || legacyGesture) suppressClick();
      for (const pointerId of pointers.keys()) release(pointerId);
      pointers.clear();
      gesture = null;
      legacyGesture = null;
      sequenceMoved = false;
      viewport.classList.remove('is-interacting');
    }
    function reveal(element) {
      if (destroyed || !element || typeof element.getBoundingClientRect !== 'function') return snapshot();
      const box = viewport.getBoundingClientRect();
      const item = element.getBoundingClientRect();
      const margin = 8;
      const left = box.left + margin;
      const top = box.top + margin;
      const right = box.left + state.width - margin;
      const bottom = box.top + state.height - margin;
      if (item.left < left) state.x += left - item.left;
      else if (item.right > right) state.x -= item.right - right;
      if (item.top < top) state.y += top - item.top;
      else if (item.bottom > bottom) state.y -= item.bottom - bottom;
      draw();
      return snapshot();
    }
    function destroy() {
      if (destroyed) return;
      onBlur();
      destroyed = true;
      for (const cleanup of cleanups) cleanup();
      if (resizeObserver) resizeObserver.disconnect();
    }

    listen(viewport, 'pointerdown', onPointerDown);
    listen(root, 'pointermove', onPointerMove, { passive: false });
    listen(root, 'pointerup', onPointerUp);
    listen(root, 'pointercancel', onPointerCancel);
    listen(viewport, 'wheel', onWheel, { passive: false });
    listen(viewport, 'gesturestart', onGestureStart, { passive: false });
    listen(viewport, 'gesturechange', onGestureChange, { passive: false });
    listen(viewport, 'gestureend', onGestureEnd, { passive: false });
    listen(root, 'blur', onBlur);
    const onResize = () => refresh();
    listen(root, 'resize', onResize);
    if (root.visualViewport && typeof root.visualViewport.addEventListener === 'function') listen(root.visualViewport, 'resize', onResize);
    if (typeof root.ResizeObserver === 'function') {
      resizeObserver = new root.ResizeObserver(onResize);
      resizeObserver.observe(viewport);
      resizeObserver.observe(content);
    }
    refresh();
    return {
      refresh,
      fit: () => refresh({ fit: true }),
      zoomBy: factor => zoomAt(factor, { x: state.width / 2, y: state.height / 2 }),
      isClickBlocked: () => !destroyed && (sequenceMoved || now() < blockedUntil),
      reveal,
      getState: snapshot,
      destroy
    };
  }

  root.LesnoyViewport = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = { create };
})(typeof window !== 'undefined' ? window : globalThis);
