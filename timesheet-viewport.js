/* Frozen monthly-table edges, sharing the schedule's pan/zoom controller. */
(function (root) {
  'use strict';

  function create(options) {
    const viewport = options.viewport;
    const surface = options.surface;
    const content = options.content;
    const engine = root.LesnoyViewport || (typeof require === 'function' ? require('./viewport.js') : null);
    if (!engine || !viewport || !surface || !content) throw new Error('Не найдена область табеля для масштабирования.');
    const frozenWidth = Number.isFinite(options.frozenWidth) ? options.frozenWidth : 335;
    const headerHeight = () => Math.max(0, Number(typeof options.headerHeight === 'function'
      ? options.headerHeight() : options.headerHeight) || (content.tHead ? content.tHead.offsetHeight : 0));
    const actionSelector = 'button, a[href], input, select, textarea, [role="button"]';
    const focusSelector = actionSelector + ', [tabindex], [contenteditable]';
    const overlays = [];
    let frozen = options.frozen !== false;
    let destroyed = false;
    let base;
    let currentState;
    let observer;
    let resizeObserver;
    let scheduled = false;
    let geometry = '';
    const previousPosition = viewport.style.position;
    const changedPosition = root.getComputedStyle && root.getComputedStyle(viewport).position === 'static';
    if (changedPosition) viewport.style.position = 'relative';

    for (const kind of ['top', 'left', 'corner']) {
      const clip = content.ownerDocument.createElement('div');
      clip.className = 'timesheet-frozen-overlay timesheet-frozen-' + kind;
      clip.dataset.frozenEdge = kind;
      clip.setAttribute('aria-hidden', 'true');
      Object.assign(clip.style, {
        position: 'absolute', overflow: 'hidden', pointerEvents: 'none',
        userSelect: 'none', zIndex: kind === 'corner' ? '6' : kind === 'top' ? '5' : '4'
      });
      const entry = { kind, clip, table: null, actions: new WeakMap() };
      const onClick = event => {
        event.preventDefault();
        event.stopPropagation();
        if (destroyed || !base || base.isClickBlocked()) return;
        const target = event.target.closest ? event.target.closest(actionSelector) : null;
        const original = target && entry.actions.get(target);
        if (original && original.isConnected && typeof original.click === 'function') original.click();
      };
      clip.addEventListener('click', onClick);
      entry.cleanup = () => clip.removeEventListener('click', onClick);
      overlays.push(entry);
      viewport.appendChild(clip);
    }

    function rebuild(state) {
      const originalActions = Array.from(content.querySelectorAll(actionSelector));
      for (const entry of overlays) {
        const clone = content.cloneNode(true);
        clone.removeAttribute('id');
        for (const node of clone.querySelectorAll('[id]')) node.removeAttribute('id');
        for (const node of [clone, ...clone.querySelectorAll('[aria-labelledby], [aria-describedby], label[for]')]) {
          node.removeAttribute('aria-labelledby');
          node.removeAttribute('aria-describedby');
          node.removeAttribute('for');
        }
        const clonedActions = Array.from(clone.querySelectorAll(actionSelector));
        entry.actions = new WeakMap();
        clonedActions.forEach((node, index) => entry.actions.set(node, originalActions[index]));
        for (const node of clone.querySelectorAll(focusSelector)) {
          node.setAttribute('tabindex', '-1');
          if (node.hasAttribute('contenteditable')) node.setAttribute('contenteditable', 'false');
        }
        clone.setAttribute('aria-hidden', 'true');
        clone.classList.add('timesheet-frozen-table');
        Object.assign(clone.style, {
          position: 'absolute', left: '0', top: '0', margin: '0',
          width: state.contentWidth + 'px', minWidth: state.contentWidth + 'px',
          transformOrigin: '0 0', pointerEvents: 'auto', userSelect: 'none'
        });
        entry.clip.replaceChildren(clone);
        entry.table = clone;
      }
      geometry = state.contentWidth + ':' + state.contentHeight + ':' + headerHeight();
    }

    function draw(state) {
      currentState = state;
      if (destroyed) return;
      if (geometry !== state.contentWidth + ':' + state.contentHeight + ':' + headerHeight()) rebuild(state);
      const pinnedX = Math.max(0, state.x);
      const pinnedY = Math.max(0, state.y);
      // Keep day cells reachable even when names are zoomed wider than a phone.
      const width = Math.min(Math.min(frozenWidth, state.contentWidth) * state.scale, state.width * 0.45);
      const height = Math.min(headerHeight(), state.contentHeight) * state.scale;
      for (const entry of overlays) {
        const horizontal = entry.kind !== 'left';
        const vertical = entry.kind !== 'top';
        Object.assign(entry.clip.style, {
          display: frozen ? 'block' : 'none',
          left: (vertical ? pinnedX : 0) + 'px',
          top: (horizontal ? pinnedY : 0) + 'px',
          width: (vertical ? width : state.width) + 'px',
          height: (horizontal ? height : state.height) + 'px'
        });
        entry.table.style.transform = 'translate(' + (vertical ? 0 : state.x) + 'px, ' +
          (horizontal ? 0 : state.y) + 'px) scale(' + state.scale + ')';
      }
      if (typeof options.onScale === 'function') options.onScale(state);
    }

    base = engine.create({ viewport, surface, content, onScale: draw });

    function refresh(settings) {
      if (!destroyed) geometry = '';
      return base.refresh(settings);
    }
    function scheduleRefresh() {
      if (destroyed || scheduled) return;
      scheduled = true;
      Promise.resolve().then(() => {
        scheduled = false;
        if (!destroyed) refresh();
      });
    }
    if (typeof root.MutationObserver === 'function') {
      observer = new root.MutationObserver(scheduleRefresh);
      observer.observe(content, { subtree: true, childList: true, characterData: true, attributes: true });
    }
    if (typeof root.ResizeObserver === 'function') {
      resizeObserver = new root.ResizeObserver(scheduleRefresh);
      resizeObserver.observe(content);
    }

    function reveal(element) {
      if (!frozen || !element || typeof element.getBoundingClientRect !== 'function') return base.reveal(element);
      const cell = element.closest && element.closest('th, td');
      const row = cell && cell.parentElement;
      const inHeader = row && row.parentElement === content.tHead;
      // A second header row starts after any cells spanning both header rows.
      // DOM cellIndex alone therefore cannot identify the frozen columns.
      let inFrozenColumn = false;
      if (cell) {
        const occupied = [];
        rowSearch: for (const tableRow of content.rows) {
          let column = 0;
          for (const tableCell of tableRow.cells) {
            while (occupied[column] > 0) column++;
            if (tableCell === cell) { inFrozenColumn = column < 2; break rowSearch; }
            for (let offset = 0; offset < tableCell.colSpan; offset++) occupied[column + offset] = tableCell.rowSpan;
            column += tableCell.colSpan;
          }
          for (let index = 0; index < occupied.length; index++) occupied[index] = Math.max(0, (occupied[index] || 0) - 1);
        }
      }
      return base.reveal({ getBoundingClientRect() {
        const state = base.getState();
        const box = viewport.getBoundingClientRect();
        const item = element.getBoundingClientRect();
        const displayedWidth = Math.min(frozenWidth * state.scale, state.width * 0.45);
        const left = inFrozenColumn ? box.left + 8 : item.left - Math.max(0, state.x) - displayedWidth;
        const top = inHeader ? box.top + 8 : item.top - Math.max(0, state.y) - headerHeight() * state.scale;
        return {
          left, top,
          right: inFrozenColumn ? box.left + 8 : item.right,
          bottom: inHeader ? box.top + 8 : item.bottom
        };
      } });
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      base.destroy();
      if (observer) observer.disconnect();
      if (resizeObserver) resizeObserver.disconnect();
      for (const entry of overlays) { entry.cleanup(); entry.clip.remove(); }
      if (changedPosition) viewport.style.position = previousPosition;
    }
    return {
      refresh,
      fit: () => refresh({ fit: true }),
      zoomBy: factor => base.zoomBy(factor),
      isClickBlocked: () => base.isClickBlocked(),
      getState: () => base.getState(),
      reveal,
      setFrozen(value) { frozen = Boolean(value); if (!destroyed) draw(currentState || base.getState()); return frozen; },
      destroy
    };
  }

  root.LesnoyTimesheetViewport = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = { create };
})(typeof window !== 'undefined' ? window : globalThis);
