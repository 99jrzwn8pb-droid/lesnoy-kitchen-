#!/usr/bin/env python3
"""Compact menu geometry, migration and secondary actions, with synthetic data."""
import os,json,argparse
from pathlib import Path
os.environ.setdefault('PLAYWRIGHT_BROWSERS_PATH','/tmp/lesnoy-browsers')
if Path('/tmp/lesnoy-webkit-libs/root').is_dir():os.environ.setdefault('PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS','1')
from playwright.sync_api import sync_playwright
KEY='lesnoy-kitchen:menu-layout:v1'
def geometry(page):
    result=page.evaluate('''() => {
      const selectors='.topbar button,.week-toolbar button,.paint-toolbar button,.table-hint button,.ts-controls button,.ts-paint button,.ts-view-controls button';
      const list=[...document.querySelectorAll(selectors)].filter(e=>e.getBoundingClientRect().width&&e.checkVisibility());
      const overlaps=[];for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){const a=list[i].getBoundingClientRect(),b=list[j].getBoundingClientRect();if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlaps.push([list[i].id||list[i].textContent,list[j].id||list[j].textContent]);}
      return {overlaps,outside:list.filter(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth+1}).map(e=>e.id),fonts:[...new Set(list.filter(e=>!e.classList.contains('square')&&e.id!=='data-menu').map(e=>getComputedStyle(e).fontSize))]};
    }''')
    assert result=={'overlaps':[],'outside':[],'fonts':['13px']},result

def run(browser,url):
    c=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(url,wait_until='networkidle')
    # Simulate updating a browser with a user-designed old menu.
    page.evaluate('''key=>{localStorage.setItem(key,JSON.stringify({version:1,layouts:{'coarse-portrait-week':{height:380,footerHeight:100,items:{'id:next-week':{x:.9,y:110,w:40,h:35,scale:1}}}}}));localStorage.removeItem('lesnoy-kitchen:compact-menu:v1');}''',KEY)
    data=page.evaluate("JSON.stringify([localStorage.getItem(LesnoyCore.STORAGE_KEY),localStorage.getItem(LesnoyTimesheetCore.STORAGE_KEY)])")
    page.reload(wait_until='networkidle');saved=page.evaluate('LesnoyMenuLayout.getSettings()');assert not saved['layouts'];assert saved['previous']['layouts']['coarse-portrait-week']['height']==380
    assert page.evaluate("JSON.stringify([localStorage.getItem(LesnoyCore.STORAGE_KEY),localStorage.getItem(LesnoyTimesheetCore.STORAGE_KEY)])")==data
    for width in [320,390,590,1440]:
        page.set_viewport_size({'width':width,'height':1000 if width>650 else 844})
        for monthly in [False,True]:
            page.locator('#ts-open' if monthly else '#ts-back').click();geometry(page)
            if monthly:
                for id in ['ts-png','ts-export','ts-backup','ts-restore','ts-csv','ts-brush-confirmed']:assert not page.locator('#'+id).is_visible()
                page.locator('#data-menu').click();assert page.locator('[data-month-action=ts-export]').is_visible();assert page.locator('#menu-fact').is_checked();page.locator('#menu-fact').uncheck();assert not page.locator('#ts-brush-confirmed').is_checked();page.locator('#menu-fact').check();page.locator('#close-dialog').click()
    page.set_viewport_size({'width':844,'height':390});page.wait_for_function("document.documentElement.classList.contains('landscape-sheet')")
    for monthly in [False,True]:
        if not page.locator('#mobile-menu').is_visible():page.locator('#mobile-menu-toggle').click()
        page.locator('#ts-open' if monthly else '#ts-back').click()
        page.locator('#mobile-menu-toggle').click();geometry(page)
        assert page.locator('#ts-body' if monthly else '#table-scroll').bounding_box()['height']>380
    assert not errors,errors;c.close();return {'browser':browser.browser_type.name,'compact_menu':'passed at 320/390/590/1440 and landscape','old_layout':'archived; table data unchanged'}
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:8765');args=parser.parse_args()
    with sync_playwright() as p:
        results=[]
        for engine in ['chromium','webkit']:
            b=getattr(p,engine).launch();results.append(run(b,args.url));b.close()
        print(json.dumps(results,ensure_ascii=False,indent=2))
