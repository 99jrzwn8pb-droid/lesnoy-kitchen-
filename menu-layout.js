/* Пользовательская расстановка меню. Редактор можно отключить, сохранив renderer. */
(function () {
'use strict';
const ALLOW_EDIT=true,KEY='lesnoy-kitchen:menu-layout:v1';
const $=id=>document.getElementById(id),clone=x=>JSON.parse(JSON.stringify(x));
const panelSelectors=['.topbar','.view-switch','.week-toolbar','.paint-toolbar','.table-hint','.table-bottom','.ts-controls','.ts-paint','.ts-view-controls','.ts-bottom'];
const panels=panelSelectors.map(s=>document.querySelector(s)).filter(Boolean);
let store={version:1,layouts:{}},draft=null,editing=false,frame=null,surface=null,bar=null,roots=[],items=[],selected=null,gesture=null,queued=false,rebuilding=false,context='',notice='',dataMarker=null;
let conflict=false,footerFrame=null,footerSurface=null,pair=null,choosingPair=false,snapping=true,guides=null;
const areaOf=root=>root.matches('.table-bottom,.ts-bottom')?'bottom':'top';
const areaSurface=area=>area==='bottom'?footerSurface:surface;
const areaHeight=(row,area)=>area==='bottom'?row.footerHeight:row.height;
function setAreaHeight(row,area,h){if(area==='bottom')row.footerHeight=h;else row.height=h;}
let storage;try{storage=window.localStorage;}catch(_){notice='Хранилище браузера недоступно.';}
function number(x,min,max){return typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;}
function validate(x){
 if(!x||x.version!==1||!x.layouts||Array.isArray(x.layouts)||typeof x.layouts!=='object'||Object.keys(x.layouts).length>8)throw Error('Неверная копия настроек меню.');
 const out={version:1,layouts:{}};
 for(const [key,l]of Object.entries(x.layouts)){
  if(!/^(coarse|fine)-(portrait|landscape)-(week|month)$/.test(key)||!l||!number(l.height,120,1800)||!l.items||typeof l.items!=='object'||Array.isArray(l.items)||Object.keys(l.items).length>150)throw Error('Повреждена расстановка меню.');
  if(l.footerHeight!==undefined&&!number(l.footerHeight,40,600))throw Error('Неверная высота нижнего меню.');
  const row={height:l.height,footerHeight:l.footerHeight||64,items:{}};
  for(const [id,p]of Object.entries(l.items)){
   if(!/^(id:|week-shift:|month-shift:)[a-zA-Z0-9_.-]{1,64}$/.test(id)||!p||!number(p.x,0,1)||!number(p.y,0,1800)||!number(p.w,24,600)||!number(p.h,20,160)||!number(p.scale,.65,2.4))throw Error('Неверный размер или положение кнопки.');
   if(p.area!==undefined&&!['top','bottom'].includes(p.area))throw Error('Неверная область меню.');
   row.items[id]={x:p.x,y:p.y,w:p.w,h:p.h,scale:p.scale,...(p.area?{area:p.area}:{})};
  }
  out.layouts[key]=row;
 }
 if(x.previous!==undefined){if(x.previous?.previous!==undefined)throw Error('Вложенная история не поддерживается.');out.previous=validate(x.previous);}
 return out;
}
try{const raw=storage?.getItem(KEY);if(raw)store=validate(JSON.parse(raw));}catch(_){notice='Не удалось прочитать настройки меню. Исходный вид сохранён.';}
const monthly=()=>!$('ts-panel').hidden;
const landscape=()=>document.documentElement.classList.contains('landscape-sheet');
const currentKey=()=> (matchMedia('(pointer: coarse)').matches?'coarse':'fine')+'-'+(matchMedia('(orientation: landscape)').matches?'landscape':'portrait')+'-'+(monthly()?'month':'week');
const db=()=>editing?draft:store;
const model=()=>db().layouts[context];
function save(next,{remember=true}={}){
 if(conflict){notice='Расстановка изменена в другой вкладке. Нажмите «Не сохранять» и откройте настройку заново.';updateBar();return false;}
 try{
  if(!storage)throw Error();const clean=validate(next);
  if(remember&&JSON.stringify(clean.layouts)!==JSON.stringify(store.layouts))clean.previous={version:1,layouts:clone(store.layouts)};
  if(!remember)delete clean.previous;
  storage.setItem(KEY,JSON.stringify(clean));store=clone(clean);notice='';return true;
 }catch(_){notice='Не удалось сохранить расстановку. Освободите место в браузере и повторите «Готово».';updateBar();return false;}
}
function undoSaved(){
 if(!store.previous){notice='Для этого старого сохранения истории нет. Можно вернуть исходное меню.';updateBar();return;}
 if(save(store.previous,{remember:false})){editing=false;draft=null;refresh(true);}
}

function label(node){return node.getAttribute('aria-label')||node.getAttribute('title')||node.textContent.trim().replace(/\s+/g,' ').slice(0,80)||'Кнопка';}
function candidates(root){
 const list=[];
 for(const e of root.querySelectorAll('button[id],a[id],output[id],#save-status,#team-count,#ts-status,.brand,.week-label,.ts-month-label,.ts-check,#shift-palette [data-brush],#ts-palette [data-ts-brush]')){
  if(e.id==='data-menu'||getComputedStyle(e).display==='none'||e.closest('dialog')||(e.closest('[hidden]')&&e.closest('[hidden]').id!=='mobile-menu')||list.some(x=>x.el.contains(e)))continue;
  let key=e.id?'id:'+e.id:e.hasAttribute('data-brush')?(e.dataset.brush?'week-shift:'+e.dataset.brush:'id:week-erase'):e.hasAttribute('data-ts-brush')?'month-shift:'+e.dataset.tsBrush:e.classList.contains('brand')?'id:brand':e.classList.contains('week-label')?'id:week-label':e.classList.contains('ts-month-label')?'id:month-label':e.querySelector('#ts-freeze')?'id:freeze-label':'id:fact-label';
  list.push({key,el:e});
 }
 return list;
}
function activePanels(){return panels.filter(p=>p.matches('.topbar,.view-switch')||(monthly()?p.matches('.ts-controls,.ts-paint,.ts-view-controls,.ts-bottom'):p.matches('.week-toolbar,.paint-toolbar,.table-hint,.table-bottom')));}
function dimensions(el){if(el.id==='ts-status')return {w:360,h:72};const r=el.getBoundingClientRect();return {w:Math.max(28,Math.min(230,r.width||100)),h:Math.max(28,Math.min(72,r.height||34))};}
function cancelGesture(){gesture=null;}
function teardown(){
 rebuilding=true;cancelGesture();observer.disconnect();
 for(const item of items){if(item.style===null)item.el.removeAttribute('style');else item.el.setAttribute('style',item.style);item.el.classList.remove('menu-layout-item','menu-layout-selected');item.el.inert=item.inert;}
 items=[];selected=null;pair=null;choosingPair=false;guides=null;
 if(dataMarker){dataMarker.replaceWith($('data-menu'));$('data-menu').classList.remove('menu-layout-access-button');dataMarker=null;}
 for(const r of roots){r.marker.replaceWith(r.el);r.el.classList.remove('menu-layout-panel');}roots=[];
 frame?.remove();footerFrame?.remove();frame=null;surface=null;footerFrame=null;footerSurface=null;bar=null;
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
function freePlace(row,p,width,area){
 const scale=Math.min(p.scale,(width-8)/p.w),pw=p.w*scale,ph=p.h*scale;
 for(let y=4;y<(area==='bottom'?580:1780);y+=38)for(let x=4;x+pw<=width-4;x+=8){
  const collision=Object.values(row.items).filter(q=>(q.area||'top')===area).some(q=>{const z=Math.min(q.scale,(width-8)/q.w),w=q.w*z,h=q.h*z,l=q.x*Math.max(0,width-w);return x<l+w+4&&x+pw+4>l&&y<q.y+h+4&&y+ph+4>q.y;});
  if(!collision)return{x:x/Math.max(1,width-pw),y};
 }
 return{x:0,y:Math.max(4,areaHeight(row,area)-40)};
}
function addItem(found,root,natural){
 const row=model(),area=root.area,target=areaSurface(area),width=target.clientWidth||320,size=natural||dimensions(found.el);
 let p=row.items[found.key];
 if(!p||p.area!==area){
  const initial=p?{w:p.w,h:p.h,scale:p.scale}:{w:Math.min(size.w,width-8),h:size.h,scale:1};
  delete row.items[found.key];const point=freePlace(row,initial,width,area);p=row.items[found.key]={...initial,...point,area};
  setAreaHeight(row,area,Math.min(area==='bottom'?600:1800,Math.max(areaHeight(row,area),point.y+initial.h*initial.scale+8)));
 }
 const item={...found,area,style:found.el.getAttribute('style'),inert:found.el.inert};items.push(item);found.el.classList.add('menu-layout-item');
}
function collect(){
 items=items.filter(item=>{if(areaSurface(item.area)?.contains(item.el))return true;item.hit?.remove();return false;});
 for(const r of roots)for(const found of candidates(r.el))if(!items.some(i=>i.el===found.el))addItem(found,r);
 if(editing)addHits();draw();
}

function draw(){
 if(!surface)return;const row=model();
 surface.style.height=row.height+'px';footerSurface.style.height=row.footerHeight+'px';
 for(const item of items){const p=row.items[item.key];if(!p)continue;const width=areaSurface(item.area).clientWidth||320,height=areaHeight(row,item.area);const scale=Math.min(p.scale,(width-8)/p.w),w=p.w*scale,h=p.h*scale,x=p.x*Math.max(0,width-w),y=Math.min(p.y,Math.max(0,height-h));
  item.box={x,y,w,h,scale};item.el.classList.toggle('menu-layout-selected',editing&&selected===item.key);item.el.style.setProperty('position','absolute','important');item.el.style.setProperty('left',x+'px','important');item.el.style.setProperty('top',y+'px','important');item.el.style.setProperty('width',p.w+'px','important');item.el.style.setProperty('height',p.h+'px','important');item.el.style.setProperty('min-width','0','important');item.el.style.setProperty('min-height','0','important');item.el.style.setProperty('max-width','none','important');item.el.style.setProperty('margin','0','important');item.el.style.setProperty('transform','scale('+scale+')','important');item.el.style.setProperty('transform-origin','0 0','important');item.el.inert=editing||item.inert;
  if(item.hit){Object.assign(item.hit.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px'});item.hit.classList.toggle('selected',selected===item.key);item.hit.classList.toggle('paired',pair===item.key);}
 }
 drawGuides();updateBar();
}
function updateBar(){
 if(!bar||!editing)return;const item=items.find(x=>x.key===selected),p=item&&model()?.items[selected];
 bar.querySelector('[data-layout-name]').textContent=notice||(choosingPair?'Нажмите вторую кнопку в той же панели':item?(item.area==='bottom'?'Нижняя панель: ':'Верхнее меню: ')+label(item.el):'Перетаскивайте кнопки в их панели');
 const chooser=bar.querySelector('[data-layout-select]'),signature=items.map(i=>i.key+':'+label(i.el)).join('|');
 if(chooser.dataset.signature!==signature){chooser.replaceChildren(new Option('Выберите элемент…',''));for(const i of items)chooser.append(new Option((i.area==='bottom'?'Низ: ':'Верх: ')+label(i.el),i.key));chooser.dataset.signature=signature;}chooser.value=selected||'';
 const slider=bar.querySelector('[data-layout-size]');slider.disabled=!p;slider.value=p?Math.round(p.scale*100):100;
 bar.querySelector('output').textContent=slider.value+'%';const bottom=item?.area==='bottom',height=bar.querySelector('[data-layout-height]');height.min=bottom?'40':'120';height.max=bottom?'600':'900';height.value=model()?areaHeight(model(),bottom?'bottom':'top'):240;bar.querySelector('[data-layout-height-title]').textContent=bottom?'Высота нижней панели':'Высота верхнего меню';
 bar.querySelector('[data-layout-undo]').disabled=!store.previous||conflict;bar.querySelector('[data-layout-undo]').title=store.previous?'Отменить последнюю сохранённую расстановку':'Предыдущий вариант не сохранён. Доступен возврат исходного меню.';bar.querySelector('[data-layout-pair]').disabled=!item;for(const b of bar.querySelectorAll('[data-layout-align]'))b.disabled=!pair;
}
function drawGuides(){
 for(const area of ['top','bottom']){const target=areaSurface(area);if(!target)continue;for(const e of target.querySelectorAll('.menu-layout-guide'))e.remove();
  if(!guides||guides.area!==area)continue;
  for(const axis of ['x','y'])if(guides[axis]!==null&&guides[axis]!==undefined){const e=document.createElement('i');e.className='menu-layout-guide guide-'+axis;e.style[axis==='x'?'left':'top']=guides[axis]+'px';target.append(e);}
 }
}
function snap(x,y,w,h,area){
 const target=areaSurface(area),height=areaHeight(model(),area),xs=[0,target.clientWidth/2,target.clientWidth],ys=[0,height/2,height];
 for(const item of items)if(item.key!==selected&&item.area===area){const b=item.box;if(!b)continue;xs.push(b.x,b.x+b.w/2,b.x+b.w);ys.push(b.y,b.y+b.h/2,b.y+b.h);}
 const axis=(value,size,targets)=>{let best=7,line=null;for(const own of [0,size/2,size])for(const t of targets){const d=t-(value+own);if(Math.abs(d)<Math.abs(best)){best=d;line=t;}}return line===null?{value:Math.round(value/8)*8,line:null}:{value:value+best,line};};
 const a=axis(x,w,xs),b=axis(y,h,ys);return{x:Math.max(0,Math.min(target.clientWidth-w,a.value)),y:Math.max(0,Math.min(height-h,b.value)),guides:{area,x:a.line,y:b.line}};
}
function alignPair(action){
 const a=items.find(i=>i.key===selected),b=items.find(i=>i.key===pair);if(!a||!b||a.area!==b.area)return;
 const row=model(),p=row.items[a.key],q=row.items[b.key],width=areaSurface(a.area).clientWidth;
 if(action==='size'){q.w=p.w;q.h=p.h;q.scale=p.scale;fitResized(q);draw();return;}
 const wa=a.box.w,wb=b.box.w,ha=a.box.h,hb=b.box.h,height=areaHeight(row,a.area),cy=Math.max(Math.max(ha,hb)/2,Math.min(height-Math.max(ha,hb)/2,a.box.y+ha/2));
 if(action==='mirror'){
  if(wa+wb+8>width){notice='Уменьшите кнопки: для симметрии не хватает ширины.';updateBar();return;}
  const center=a.box.x+wa/2,limit=width/2-Math.max(wa,wb)/2,d=Math.max((wa+wb)/4+4,Math.min(limit,Math.abs(center-width/2))),ca=width/2+(center<=width/2?-d:d),cb=width-ca;
  p.x=(ca-wa/2)/Math.max(1,width-wa);q.x=(cb-wb/2)/Math.max(1,width-wb);guides={area:a.area,x:width/2,y:cy};
 }else guides={area:a.area,x:null,y:cy};
 p.y=cy-ha/2;q.y=cy-hb/2;notice='';draw();
}
function fitResized(p){const row=model(),s=Math.min(p.scale,(areaSurface(p.area).clientWidth-8)/p.w),needed=p.y+p.h*s+8;setAreaHeight(row,p.area,Math.min(p.area==='bottom'?600:1800,Math.max(areaHeight(row,p.area),needed)));p.y=Math.min(p.y,Math.max(0,areaHeight(row,p.area)-p.h*s));}
function resizeSelected(value){const p=model()?.items[selected];if(!p)return;p.scale=Math.max(.65,Math.min(2.4,value));fitResized(p);draw();}
function makeBar(){
 bar=document.createElement('div');bar.className='menu-layout-bar';
 if(!editing){bar=null;return;}
 bar.innerHTML='<div class="menu-layout-actions"><strong>Расстановка</strong><select aria-label="Настраиваемое меню" data-layout-view><option value="week">График</option><option value="month">Табель</option></select><button class="button primary" data-layout-done>Готово</button><button class="button" data-layout-undo title="Отменить последнюю сохранённую расстановку">Отменить</button><button class="button" data-layout-cancel>Не сохранять</button></div><select data-layout-select aria-label="Выбрать элемент меню"></select><div data-layout-name class="menu-layout-name"></div><label class="menu-layout-size">Размер <input type="range" min="65" max="240" step="5" aria-label="Размер выбранной кнопки" data-layout-size><output>100%</output></label><label class="menu-layout-size"><span data-layout-height-title>Высота верхнего меню</span> <input type="range" min="120" max="900" step="10" aria-label="Высота области меню" data-layout-height></label><details class="menu-layout-alignment"><summary>Выравнивание и симметрия</summary><label><input type="checkbox" data-layout-snap checked> Привязка к кнопкам и сетке</label><div><button class="button small" data-layout-pair>Выбрать пару</button><button class="button small" data-layout-align="row">В один ряд</button><button class="button small" data-layout-align="mirror">Симметрично</button><button class="button small" data-layout-align="size">Одинаковый размер</button></div></details><button class="button small" data-layout-reset>Вернуть исходное меню</button>';
 bar.querySelector('[data-layout-select]').onchange=e=>{const key=e.target.value;if(!key)return;if(choosingPair&&selected&&key!==selected){if(model().items[key].area!==model().items[selected].area){notice='Выберите пару в той же панели.';updateBar();return;}pair=key;choosingPair=false;}else{selected=key;pair=null;choosingPair=false;}notice='';guides=null;draw();};
 bar.querySelector('[data-layout-view]').value=monthly()?'month':'week';
 bar.querySelector('[data-layout-view]').onchange=e=>e.target.value==='month'?window.LesnoyTimesheet.open():window.LesnoyTimesheet.close();
 bar.querySelector('[data-layout-done]').onclick=()=>{if(save(draft)){editing=false;draft=null;refresh(true);}};
 bar.querySelector('[data-layout-undo]').onclick=undoSaved;
 bar.querySelector('[data-layout-snap]').checked=snapping;bar.querySelector('[data-layout-snap]').onchange=e=>snapping=e.target.checked;
 bar.querySelector('[data-layout-pair]').onclick=()=>{choosingPair=true;notice='';updateBar();};
 for(const b of bar.querySelectorAll('[data-layout-align]'))b.onclick=()=>alignPair(b.dataset.layoutAlign);
 bar.querySelector('[data-layout-cancel]').onclick=()=>{editing=false;draft=null;conflict=false;notice='';refresh(true);};
 bar.querySelector('[data-layout-reset]').onclick=()=>{if(!confirm('Вернуть исходное меню для этой таблицы и ориентации?'))return;delete draft.layouts[context];if(save(draft)){editing=false;draft=null;refresh(true);}};
 bar.querySelector('[data-layout-size]').oninput=e=>resizeSelected(Number(e.target.value)/100);
 bar.querySelector('[data-layout-height]').oninput=e=>{const area=items.find(i=>i.key===selected)?.area||'top';const min=Math.max(area==='bottom'?40:120,...items.filter(i=>i.area===area).map(i=>{const p=model().items[i.key];return p.y+p.h*p.scale+8;}));setAreaHeight(model(),area,Math.max(min,Number(e.target.value)));draw();};
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
 surface=document.createElement('div');surface.id='menu-layout-surface';surface.className='menu-layout-surface';surface.dataset.area='top';frame.append(surface);
 footerFrame=document.createElement('section');footerFrame.className='menu-layout-footer';footerFrame.setAttribute('aria-label','Нижняя панель');footerSurface=document.createElement('div');footerSurface.className='menu-layout-surface';footerSurface.dataset.area='bottom';footerFrame.append(footerSurface);
 if(landscape())$('mobile-menu').append(frame,footerFrame);else{const view=monthly()?$('ts-body'):$('table-scroll');view.before(frame);view.after(footerFrame);}
 document.documentElement.classList.add('custom-menu-layout');document.documentElement.classList.toggle('menu-layout-editing',editing);
 if(!db().layouts[key])db().layouts[key]={height:160,footerHeight:64,items:{}};
 for(const el of active){const marker=document.createComment('Исходное место меню');el.before(marker);const area=areaOf(el);roots.push({el,marker,area});el.classList.add('menu-layout-panel');areaSurface(area).append(el);}
 for(const r of roots)for(const found of candidates(r.el))if(!items.some(i=>i.el===found.el))addItem(found,r,natural.get(found.el));
 if(editing){
  for(const id of ['table-scroll','ts-body']){$(id).dataset.layoutInert=String($(id).inert);$(id).inert=true;}
  addHits();
 }
 draw();rebuilding=false;watch();
}
function addHits(){for(const item of items)if(!item.hit){const hit=document.createElement('div');hit.className='menu-layout-hit';hit.dataset.layoutKey=item.key;hit.tabIndex=0;hit.setAttribute('role','button');hit.setAttribute('aria-label','Переместить: '+label(item.el));areaSurface(item.area).append(hit);item.hit=hit;}}
function start(){if(!ALLOW_EDIT)return;if(!editing){conflict=false;draft=clone(store);editing=true;}refresh(true);if(landscape()&&$('mobile-menu').hidden)$('mobile-menu-toggle').click();}
function begin(event){
 if(!editing)return;const hit=event.target.closest('.menu-layout-hit');if(!hit||event.button!==0)return;event.preventDefault();event.stopImmediatePropagation();
 const key=hit.dataset.layoutKey;
 if(choosingPair&&selected&&key!==selected){
  if(model().items[key].area!==model().items[selected].area){notice='Выберите пару в той же панели.';updateBar();return;}
  pair=key;choosingPair=false;notice='';guides=null;draw();return;
 }
 selected=key;pair=null;choosingPair=false;notice='';guides=null;
 const item=items.find(i=>i.key===selected);gesture={id:event.pointerId,x:event.clientX,y:event.clientY,bx:item.box.x,by:item.box.y,w:item.box.w,h:item.box.h,area:item.area};try{hit.setPointerCapture(event.pointerId);}catch(_){}draw();
}
document.addEventListener('pointerdown',begin,true);
window.addEventListener('pointermove',event=>{
 if(!editing||!gesture||event.pointerId!==gesture.id)return;event.preventDefault();event.stopImmediatePropagation();
 const p=model().items[selected],width=areaSurface(gesture.area).clientWidth,height=areaHeight(model(),gesture.area);
 let x=Math.max(0,Math.min(width-gesture.w,gesture.bx+event.clientX-gesture.x)),y=Math.max(0,Math.min(height-gesture.h,gesture.by+event.clientY-gesture.y));
 if(snapping){const point=snap(x,y,gesture.w,gesture.h,gesture.area);x=point.x;y=point.y;guides=point.guides;}else guides=null;
 p.x=Math.max(0,Math.min(1,x/Math.max(1,width-gesture.w)));p.y=Math.max(0,Math.min(height-gesture.h,y));draw();
},{capture:true,passive:false});
window.addEventListener('pointerup',cancelGesture,true);window.addEventListener('pointercancel',cancelGesture,true);
document.addEventListener('click',event=>{if(editing&&event.target.closest('.menu-layout-item,.menu-layout-hit')){event.preventDefault();event.stopImmediatePropagation();}},true);
document.addEventListener('keydown',event=>{
 if(!editing||event.target.closest('dialog')||document.querySelector('dialog[open]'))return;
 if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();editing=false;draft=null;conflict=false;refresh(true);return;}
 if(event.key==='Tab'){event.stopImmediatePropagation();return;}
 if(event.target.closest('.menu-layout-bar')){if((event.ctrlKey||event.metaKey)&&/^[zy]$/i.test(event.key)){event.preventDefault();event.stopImmediatePropagation();}return;}
 if(!event.target.closest('dialog')){event.preventDefault();event.stopImmediatePropagation();}
 if(event.target.closest('.menu-layout-hit'))selected=event.target.closest('.menu-layout-hit').dataset.layoutKey;
 const p=model()?.items[selected];if(!p)return;const delta=event.shiftKey?10:2,width=areaSurface(p.area).clientWidth,w=p.w*p.scale;
 if(event.key==='ArrowLeft'||event.key==='ArrowRight')p.x=Math.max(0,Math.min(1,p.x+(event.key==='ArrowLeft'?-delta:delta)/Math.max(1,width-w)));
 if(event.key==='ArrowUp'||event.key==='ArrowDown')p.y=Math.max(0,Math.min(areaHeight(model(),p.area)-p.h*p.scale,p.y+(event.key==='ArrowUp'?-delta:delta)));
 if(event.key==='+'||event.key==='=')resizeSelected(p.scale+.05);if(event.key==='-')resizeSelected(p.scale-.05);draw();
},true);
window.addEventListener('resize',()=>{cancelGesture();schedule();});
document.addEventListener('lesnoy:menu-before-move',teardown);document.addEventListener('lesnoy:menu-moved',()=>refresh(true));
window.addEventListener('storage',event=>{if(event.key===KEY||event.key===null){try{store=event.newValue?validate(JSON.parse(event.newValue)):{version:1,layouts:{}};if(editing){conflict=true;notice='Настройки изменены в другой вкладке. Нажмите «Не сохранять».';updateBar();return;}refresh(true);}catch(_){}}});
function toggle(){if(editing){if(save(draft)){editing=false;draft=null;refresh(true);}}else start();}
function downloadSettings(){const blob=new Blob([JSON.stringify(store,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Лесной-расстановка-меню.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
window.LesnoyMenuLayout={downloadSettings,available:ALLOW_EDIT,start,toggle,isEditing:()=>editing,getSettings:()=>clone(store)};
refresh();
})();
