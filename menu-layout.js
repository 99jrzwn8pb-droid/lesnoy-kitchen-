/* Пользовательская расстановка меню. Редактор можно отключить, сохранив renderer. */
(function () {
'use strict';
const ALLOW_EDIT=true,KEY='lesnoy-kitchen:menu-layout:v1';
const $=id=>document.getElementById(id),clone=x=>JSON.parse(JSON.stringify(x));
const panelSelectors=['.topbar','.view-switch','.week-toolbar','.paint-toolbar','.table-hint','.table-bottom','.ts-controls','.ts-paint','.ts-view-controls','.ts-bottom'];
const panels=panelSelectors.map(s=>document.querySelector(s)).filter(Boolean);
let store={version:1,layouts:{}},draft=null,editing=false,frame=null,surface=null,bar=null,roots=[],items=[],selected=null,gesture=null,queued=false,rebuilding=false,context='',notice='',dataMarker=null;
let conflict=false;
let storage;try{storage=window.localStorage;}catch(_){notice='Хранилище браузера недоступно.';}
function number(x,min,max){return typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;}
function validate(x){
 if(!x||x.version!==1||!x.layouts||Array.isArray(x.layouts)||typeof x.layouts!=='object'||Object.keys(x.layouts).length>8)throw Error('Неверная копия настроек меню.');
 const out={version:1,layouts:{}};
 for(const [key,l]of Object.entries(x.layouts)){
  if(!/^(coarse|fine)-(portrait|landscape)-(week|month)$/.test(key)||!l||!number(l.height,120,1800)||!l.items||typeof l.items!=='object'||Array.isArray(l.items)||Object.keys(l.items).length>150)throw Error('Повреждена расстановка меню.');
  const row={height:l.height,items:{}};
  for(const [id,p]of Object.entries(l.items)){
   if(!/^(id:|week-shift:|month-shift:)[a-zA-Z0-9_.-]{1,64}$/.test(id)||!p||!number(p.x,0,1)||!number(p.y,0,1800)||!number(p.w,24,600)||!number(p.h,20,160)||!number(p.scale,.65,2.4))throw Error('Неверный размер или положение кнопки.');
   row.items[id]={x:p.x,y:p.y,w:p.w,h:p.h,scale:p.scale};
  }
  out.layouts[key]=row;
 }
 return out;
}
try{const raw=storage?.getItem(KEY);if(raw)store=validate(JSON.parse(raw));}catch(_){notice='Не удалось прочитать настройки меню. Исходный вид сохранён.';}
const monthly=()=>!$('ts-panel').hidden;
const landscape=()=>document.documentElement.classList.contains('landscape-sheet');
const currentKey=()=> (matchMedia('(pointer: coarse)').matches?'coarse':'fine')+'-'+(matchMedia('(orientation: landscape)').matches?'landscape':'portrait')+'-'+(monthly()?'month':'week');
const db=()=>editing?draft:store;
const model=()=>db().layouts[context];
function save(next){if(conflict){notice='Расстановка изменена в другой вкладке. Нажмите «Отмена» и откройте настройку заново.';updateBar();return false;}try{if(!storage)throw Error();storage.setItem(KEY,JSON.stringify(validate(next)));store=clone(next);notice='';return true;}catch(_){notice='Не удалось сохранить расстановку. Освободите место в браузере и повторите «Готово».';updateBar();return false;}}
function label(node){return node.getAttribute('aria-label')||node.getAttribute('title')||node.textContent.trim().replace(/\s+/g,' ').slice(0,80)||'Кнопка';}
function candidates(root){
 const list=[];
 for(const e of root.querySelectorAll('button[id],a[id],output[id],#save-status,#team-count,#ts-status,.brand,.week-label,.ts-month-label,.ts-check,#shift-palette [data-brush],#ts-palette [data-ts-brush]')){
  if(e.id==='data-menu'||e.closest('dialog')||(e.closest('[hidden]')&&e.closest('[hidden]').id!=='mobile-menu')||list.some(x=>x.el.contains(e)))continue;
  let key=e.id?'id:'+e.id:e.hasAttribute('data-brush')?(e.dataset.brush?'week-shift:'+e.dataset.brush:'id:week-erase'):e.hasAttribute('data-ts-brush')?'month-shift:'+e.dataset.tsBrush:e.classList.contains('brand')?'id:brand':e.classList.contains('week-label')?'id:week-label':e.classList.contains('ts-month-label')?'id:month-label':e.querySelector('#ts-freeze')?'id:freeze-label':'id:fact-label';
  list.push({key,el:e});
 }
 return list;
}
function activePanels(){return panels.filter(p=>p.matches('.topbar,.view-switch')||(monthly()?p.matches('.ts-controls,.ts-paint,.ts-view-controls,.ts-bottom'):p.matches('.week-toolbar,.paint-toolbar,.table-hint,.table-bottom')));}
function dimensions(el){const r=el.getBoundingClientRect();return {w:Math.max(28,Math.min(230,r.width||100)),h:Math.max(28,Math.min(72,r.height||34))};}
function cancelGesture(){gesture=null;}
function teardown(){
 rebuilding=true;cancelGesture();observer.disconnect();
 for(const item of items){if(item.style===null)item.el.removeAttribute('style');else item.el.setAttribute('style',item.style);item.el.classList.remove('menu-layout-item');item.el.inert=item.inert;}
 items=[];selected=null;
 if(dataMarker){dataMarker.replaceWith($('data-menu'));$('data-menu').classList.remove('menu-layout-access-button');dataMarker=null;}
 for(const r of roots){r.marker.replaceWith(r.el);r.el.classList.remove('menu-layout-panel');}roots=[];
 frame?.remove();frame=null;surface=null;bar=null;
 document.documentElement.classList.remove('custom-menu-layout','menu-layout-editing');
 for(const id of ['table-scroll','ts-body'])if($(id)?.dataset.layoutInert!==undefined){$(id).inert=$(id).dataset.layoutInert==='true';delete $(id).dataset.layoutInert;}
 rebuilding=false;
}
function watch(){observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class']});}
function schedule(){if(rebuilding||queued)return;queued=true;requestAnimationFrame(()=>{queued=false;refresh();});}
const observer=new MutationObserver(records=>{
 if(rebuilding)return;
 if(records.some(r=>r.type==='attributes'&&(r.target===$('schedule-panel')||r.target===$('ts-panel')||r.target===$('mobile-menu')))){schedule();return;}
 if(surface&&records.some(r=>r.type==='childList'&&r.target.closest?.('.menu-layout-panel')))schedule();
});
function freePlace(row,p,width){
 for(let y=4;y<1780;y+=38)for(let x=4;x+p.w<=width-4;x+=8){
  const collision=Object.values(row.items).some(q=>{const w=q.w*q.scale,h=q.h*q.scale,l=q.x*Math.max(0,width-w);return x<l+w+4&&x+p.w+4>l&&y<q.y+h+4&&y+p.h+4>q.y;});
  if(!collision)return{x:x/Math.max(1,width-p.w),y};
 }
 return{x:0,y:Math.max(4,row.height-40)};
}
function collect(){
 items=items.filter(item=>{if(surface.contains(item.el))return true;item.hit?.remove();return false;});
 const row=model(),width=surface.clientWidth||320;
 for(const r of roots)for(const found of candidates(r.el)){
  if(items.some(i=>i.el===found.el))continue;
  const size=dimensions(found.el),p=row.items[found.key];
  if(!p){const initial={w:Math.min(size.w,width-8),h:size.h,scale:1},point=freePlace(row,initial,width);row.items[found.key]={...initial,...point};row.height=Math.min(1800,Math.max(row.height,point.y+initial.h+8));}
  const item={...found,style:found.el.getAttribute('style'),inert:found.el.inert};items.push(item);found.el.classList.add('menu-layout-item');
 }
 if(editing)addHits();draw();
}
function draw(){
 if(!surface)return;const row=model(),width=surface.clientWidth||320;
 surface.style.height=row.height+'px';
 for(const item of items){const p=row.items[item.key];if(!p)continue;const scale=Math.min(p.scale,(width-8)/p.w),w=p.w*scale,h=p.h*scale,x=p.x*Math.max(0,width-w),y=Math.min(p.y,Math.max(0,row.height-h));
  item.box={x,y,w,h,scale};item.el.style.setProperty('position','absolute','important');item.el.style.setProperty('left',x+'px','important');item.el.style.setProperty('top',y+'px','important');item.el.style.setProperty('width',p.w+'px','important');item.el.style.setProperty('height',p.h+'px','important');item.el.style.setProperty('min-width','0','important');item.el.style.setProperty('min-height','0','important');item.el.style.setProperty('max-width','none','important');item.el.style.setProperty('margin','0','important');item.el.style.setProperty('transform','scale('+scale+')','important');item.el.style.setProperty('transform-origin','0 0','important');item.el.inert=editing||item.inert;
  if(item.hit){Object.assign(item.hit.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px'});item.hit.classList.toggle('selected',selected===item.key);}
 }
 updateBar();
}
function updateBar(){
 if(!bar||!editing)return;const item=items.find(x=>x.key===selected),p=item&&model()?.items[selected];
 bar.querySelector('[data-layout-name]').textContent=notice||(item?'Выбрано: '+label(item.el):'Перетаскивайте кнопки внутри меню');
 const slider=bar.querySelector('[data-layout-size]');slider.disabled=!p;slider.value=p?Math.round(p.scale*100):100;
 bar.querySelector('output').textContent=slider.value+'%';bar.querySelector('[data-layout-height]').value=model()?.height||240;
}
function resizeSelected(value){const p=model()?.items[selected];if(!p)return;p.scale=Math.max(.65,Math.min(2.4,value));p.y=Math.min(p.y,Math.max(0,model().height-p.h*p.scale));draw();}
function makeBar(){
 bar=document.createElement('div');bar.className='menu-layout-bar';
 if(!editing){bar=null;return;}
 bar.innerHTML='<div class="menu-layout-actions"><strong>Расстановка</strong><select aria-label="Настраиваемое меню" data-layout-view><option value="week">График</option><option value="month">Табель</option></select><button class="button primary" data-layout-done>Готово</button><button class="button" data-layout-cancel>Отмена</button></div><div data-layout-name class="menu-layout-name"></div><label class="menu-layout-size">Размер <input type="range" min="65" max="240" step="5" aria-label="Размер выбранной кнопки" data-layout-size><output>100%</output></label><label class="menu-layout-size">Высота меню <input type="range" min="120" max="900" step="10" aria-label="Высота области меню" data-layout-height></label><button class="button small" data-layout-reset>Вернуть исходное меню</button>';
 bar.querySelector('[data-layout-view]').value=monthly()?'month':'week';
 bar.querySelector('[data-layout-view]').onchange=e=>e.target.value==='month'?window.LesnoyTimesheet.open():window.LesnoyTimesheet.close();
 bar.querySelector('[data-layout-done]').onclick=()=>{if(save(draft)){editing=false;draft=null;refresh(true);}};
 bar.querySelector('[data-layout-cancel]').onclick=()=>{editing=false;draft=null;conflict=false;notice='';refresh(true);};
 bar.querySelector('[data-layout-reset]').onclick=()=>{if(!confirm('Вернуть исходное меню для этой таблицы и ориентации?'))return;delete draft.layouts[context];if(save(draft)){editing=false;draft=null;refresh(true);}};
 bar.querySelector('[data-layout-size]').oninput=e=>resizeSelected(Number(e.target.value)/100);
 bar.querySelector('[data-layout-height]').oninput=e=>{const min=Math.max(120,...items.map(i=>{const p=model().items[i.key];return p.y+p.h*p.scale+8;}));model().height=Math.max(min,Number(e.target.value));draw();};
}
function refresh(force=false){
 if(rebuilding)return;
 if(matchMedia('(orientation: landscape) and (max-height: 600px) and (max-width: 1100px) and (pointer: coarse)').matches!==landscape()){schedule();return;}
 const key=currentKey();
 if(frame&&key===context&&!force){collect();return;}
 teardown();context=key;
 if(!editing&&!store.layouts[key]){watch();return;}
 rebuilding=true;
 if(editing&&landscape()&&$('mobile-menu').hidden)$('mobile-menu-toggle').click();
 const active=activePanels(),natural=new Map();for(const root of active)for(const c of candidates(root))natural.set(c.el,dimensions(c.el));
 frame=document.createElement('section');frame.className='menu-layout-frame';frame.setAttribute('aria-label','Меню с настроенным расположением');
 const access=document.createElement('div');access.className='menu-layout-access';
 dataMarker=document.createComment('Место кнопки данных');$('data-menu').before(dataMarker);$('data-menu').classList.add('menu-layout-access-button');access.append($('data-menu'));frame.append(access);
 makeBar();if(ALLOW_EDIT&&bar)frame.append(bar);
 surface=document.createElement('div');surface.id='menu-layout-surface';surface.className='menu-layout-surface';frame.append(surface);
 if(landscape())$('mobile-menu').append(frame);else (monthly()?$('ts-body'):$('table-scroll')).before(frame);
 document.documentElement.classList.add('custom-menu-layout');document.documentElement.classList.toggle('menu-layout-editing',editing);
 if(!db().layouts[key])db().layouts[key]={height:160,items:{}};
 for(const el of active){const marker=document.createComment('Исходное место меню');el.before(marker);roots.push({el,marker});el.classList.add('menu-layout-panel');surface.append(el);}
 // Populate in original visual order; each object retains its original parents/listeners.
 for(const r of roots)for(const found of candidates(r.el)){
  if(items.some(i=>i.el===found.el))continue;const size=natural.get(found.el)||dimensions(found.el),width=surface.clientWidth||320,row=model();
  if(!row.items[found.key]){const p={w:Math.min(size.w,width-8),h:size.h,scale:1},point=freePlace(row,p,width);row.items[found.key]={...p,...point};row.height=Math.min(1800,Math.max(row.height,point.y+p.h+8));}
  const item={...found,style:found.el.getAttribute('style'),inert:found.el.inert};items.push(item);found.el.classList.add('menu-layout-item');
 }
 if(editing){
  for(const id of ['table-scroll','ts-body']){$(id).dataset.layoutInert=String($(id).inert);$(id).inert=true;}
  addHits();
 }
 draw();rebuilding=false;watch();
}
function addHits(){for(const item of items)if(!item.hit){const hit=document.createElement('div');hit.className='menu-layout-hit';hit.dataset.layoutKey=item.key;hit.tabIndex=0;hit.setAttribute('role','button');hit.setAttribute('aria-label','Переместить: '+label(item.el));surface.append(hit);item.hit=hit;}}
function start(){if(!ALLOW_EDIT)return;if(!editing){conflict=false;draft=clone(store);editing=true;}refresh(true);if(landscape()&&$('mobile-menu').hidden)$('mobile-menu-toggle').click();}
function begin(event){if(!editing)return;const hit=event.target.closest('.menu-layout-hit');if(!hit||event.button!==0)return;event.preventDefault();event.stopImmediatePropagation();selected=hit.dataset.layoutKey;const p=model().items[selected],item=items.find(i=>i.key===selected);gesture={id:event.pointerId,x:event.clientX,y:event.clientY,bx:item.box.x,by:item.box.y,w:item.box.w,h:item.box.h};try{hit.setPointerCapture(event.pointerId);}catch(_){}draw();}
document.addEventListener('pointerdown',begin,true);
window.addEventListener('pointermove',event=>{if(!editing||!gesture||event.pointerId!==gesture.id)return;event.preventDefault();event.stopImmediatePropagation();const p=model().items[selected],width=surface.clientWidth,x=Math.max(0,Math.min(width-gesture.w,gesture.bx+event.clientX-gesture.x)),y=Math.max(0,Math.min(model().height-gesture.h,gesture.by+event.clientY-gesture.y));p.x=x/Math.max(1,width-gesture.w);p.y=y;draw();},{capture:true,passive:false});
window.addEventListener('pointerup',cancelGesture,true);window.addEventListener('pointercancel',cancelGesture,true);
document.addEventListener('click',event=>{if(editing&&event.target.closest('.menu-layout-item,.menu-layout-hit')){event.preventDefault();event.stopImmediatePropagation();}},true);
document.addEventListener('keydown',event=>{
 if(!editing||event.target.closest('dialog')||document.querySelector('dialog[open]'))return;
 if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();editing=false;draft=null;conflict=false;refresh(true);return;}
 if(event.key==='Tab'){event.stopImmediatePropagation();return;}
 if(event.target.closest('.menu-layout-bar')){if((event.ctrlKey||event.metaKey)&&/^[zy]$/i.test(event.key)){event.preventDefault();event.stopImmediatePropagation();}return;}
 if(!event.target.closest('dialog')){event.preventDefault();event.stopImmediatePropagation();}
 if(event.target.closest('.menu-layout-hit'))selected=event.target.closest('.menu-layout-hit').dataset.layoutKey;
 const p=model()?.items[selected];if(!p)return;const delta=event.shiftKey?10:2,width=surface.clientWidth,w=p.w*p.scale;
 if(event.key==='ArrowLeft'||event.key==='ArrowRight')p.x=Math.max(0,Math.min(1,p.x+(event.key==='ArrowLeft'?-delta:delta)/Math.max(1,width-w)));
 if(event.key==='ArrowUp'||event.key==='ArrowDown')p.y=Math.max(0,Math.min(model().height-p.h*p.scale,p.y+(event.key==='ArrowUp'?-delta:delta)));
 if(event.key==='+'||event.key==='=')resizeSelected(p.scale+.05);if(event.key==='-')resizeSelected(p.scale-.05);draw();
},true);
window.addEventListener('resize',()=>{cancelGesture();schedule();});
document.addEventListener('lesnoy:menu-before-move',teardown);document.addEventListener('lesnoy:menu-moved',()=>refresh(true));
window.addEventListener('storage',event=>{if(event.key===KEY||event.key===null){try{store=event.newValue?validate(JSON.parse(event.newValue)):{version:1,layouts:{}};if(editing){conflict=true;notice='Настройки изменены в другой вкладке. Нажмите «Отмена».';updateBar();return;}refresh(true);}catch(_){}}});
function toggle(){if(editing){if(save(draft)){editing=false;draft=null;refresh(true);}}else start();}
window.LesnoyMenuLayout={available:ALLOW_EDIT,start,toggle,isEditing:()=>editing,getSettings:()=>clone(store)};
refresh();
})();
