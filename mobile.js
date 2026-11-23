/* Полный экран таблицы при повороте телефона. Данные не изменяет. */
(function () {
  'use strict';
  const media = window.matchMedia('(orientation: landscape) and (max-height: 600px) and (max-width: 1100px) and (pointer: coarse)');
  const menu = document.getElementById('mobile-menu');
  const toggle = document.getElementById('mobile-menu-toggle');
  const shade = document.getElementById('mobile-menu-shade');
  const main = document.querySelector('main');
  const entries = [];
  let landscape = false;
  for (const [selector,panel] of [
    ['.topbar','common'],['#storage-warning','common'],
    ['#schedule-panel .week-toolbar','week'],['#schedule-panel .paint-toolbar','week'],
    ['#schedule-panel .table-hint','week'],['#schedule-panel .table-bottom','week'],
    ['.ts-controls','month'],['.ts-paint','month'],['.ts-view-controls','month'],
    ['#ts-warning','month'],['.ts-bottom','month']
  ]) {
    const node = document.querySelector(selector);
    if (node) entries.push({node,panel,marker:document.createComment('Место панели')});
  }
  function setOpen(open) {
    open = landscape && open;
    menu.hidden = !open; shade.hidden = !open; main.inert = open;
    toggle.setAttribute('aria-expanded',String(open));
    toggle.textContent = open ? '×' : '☰';
    toggle.setAttribute('aria-label',open ? 'Закрыть меню таблицы' : 'Меню таблицы');
  }
  function fit() {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const monthly = !document.getElementById('ts-panel').hidden;
      document.getElementById(monthly ? 'ts-zoom-fit' : 'zoom-fit').click();
    }));
  }
  function update() {
    const next = media.matches;
    if (next === landscape) return;
    document.dispatchEvent(new Event('lesnoy:menu-before-move'));
    landscape = next;
    document.documentElement.classList.toggle('landscape-sheet',next);
    if (next) {
      for (const entry of entries) {
        entry.node.before(entry.marker);
        entry.node.dataset.mobilePanel = entry.panel;
        menu.append(entry.node);
      }
    } else {
      for (const entry of entries) {
        entry.marker.replaceWith(entry.node);
        delete entry.node.dataset.mobilePanel;
      }
    }
    toggle.hidden = !next;
    setOpen(false);
    document.dispatchEvent(new Event('lesnoy:menu-moved'));
    fit();
  }
  toggle.onclick = () => setOpen(menu.hidden);
  shade.onclick = () => { setOpen(false); toggle.focus({preventScroll:true}); };
  menu.addEventListener('click',event => {
    if (event.target.closest('[data-brush],[data-ts-brush],#ts-open,#ts-back')) {
      setOpen(false); toggle.focus({preventScroll:true});
    }
  });
  document.addEventListener('keydown',event => {
    if (event.key === 'Escape' && !menu.hidden && !document.querySelector('dialog[open]')) {
      setOpen(false); toggle.focus({preventScroll:true});
    }
  });
  if (media.addEventListener) media.addEventListener('change',update);
  else media.addListener(update);
  update();
})();
