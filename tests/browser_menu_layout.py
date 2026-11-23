#!/usr/bin/env python3
"""Custom menu placement checks with synthetic data; no physical iPhone claim."""
import argparse
import json
import os
from pathlib import Path
os.environ.setdefault('PLAYWRIGHT_BROWSERS_PATH','/tmp/lesnoy-browsers')
if Path('/tmp/lesnoy-webkit-libs/root').is_dir():
    os.environ.setdefault('PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS','1')
from playwright.sync_api import sync_playwright

KEY='lesnoy-kitchen:menu-layout:v1'

def read_data(page):
    return page.evaluate("JSON.stringify([localStorage.getItem(LesnoyCore.STORAGE_KEY),localStorage.getItem(LesnoyTimesheetCore.STORAGE_KEY)])")

def editor(page):
    page.locator('#data-menu').click()
    page.locator('#layout-settings').click()
    page.locator('[data-layout-done]').wait_for(state='visible')


def run(browser,url,mobile):
    context=browser.new_context(viewport={'width':390 if mobile else 1440,'height':844 if mobile else 1000},is_mobile=mobile,has_touch=mobile)
    page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(url,wait_until='networkidle')
    page.evaluate("""() => {
      const s=LesnoyCore.createState('2026-11-16');s.employees=[{id:'demo',name:'Тестовый повар',phone:'',department:'hot'}];s.weeks[s.selectedWeek]={demo:['day','','','','','','']};
      localStorage.setItem(LesnoyCore.STORAGE_KEY,JSON.stringify(s));localStorage.setItem(LesnoyTimesheetCore.STORAGE_KEY,JSON.stringify(LesnoyTimesheetCore.createBook('2026-11')));
    }""")
    page.reload(wait_until='networkidle');page.locator('#next-week').click();page.locator('#prev-week').click();original=read_data(page)
    assert page.locator('.menu-layout-frame').count()==0
    editor(page)
    assert page.locator('.menu-layout-hit').count()>20
    png=page.locator('[data-layout-key="id:export-png"]')
    before=png.bounding_box();png.dispatch_event('pointerdown',{'pointerId':11,'button':0,'clientX':before['x']+10,'clientY':before['y']+10})
    page.dispatch_event('body','pointermove',{'pointerId':11,'clientX':before['x']+42,'clientY':before['y']+30})
    page.dispatch_event('body','pointerup',{'pointerId':11})
    assert abs(png.bounding_box()['y']-before['y'])>5
    png.dispatch_event('click')
    assert not page.locator('#editor-dialog').is_visible(),'Dragging must never trigger PNG export'
    page.locator('[data-layout-size]').fill('130');page.locator('[data-layout-size]').dispatch_event('input')
    assert png.bounding_box()['width']>before['width']*1.2
    page.locator('[data-layout-done]').focus();page.keyboard.press('Control+z')
    assert read_data(page)==original,'Editor keyboard shortcuts must not undo schedule data'
    page.locator('#data-menu').click()
    assert 'Выключить' in page.locator('#layout-settings').inner_text()
    page.locator('#layout-settings').click()
    saved=json.loads(page.evaluate(f'localStorage.getItem({json.dumps(KEY)})'));assert len(saved['layouts'])==1
    assert read_data(page)==original
    page.reload(wait_until='networkidle');assert page.locator('.menu-layout-frame').count()==1
    assert page.locator('.menu-layout-hit').count()==0
    assert page.evaluate('LesnoyMenuLayout.getSettings()')==saved
    # Moving originals must preserve palette delegation after every render.
    page.locator('#shift-palette [data-brush="midday"]').click()
    assert page.locator('#shift-palette [data-brush="midday"]').get_attribute('aria-pressed')=='true'
    page.locator('#shift-palette [data-brush="midday"]').click()
    assert page.locator('#shift-palette [aria-pressed="true"]').count()==0
    assert read_data(page)==original
    editor(page)
    page.locator('[data-layout-view]').select_option('month')
    page.locator('[data-layout-key="month-shift:0.5"]').wait_for(state='visible')
    page.locator('[data-layout-key="month-shift:0.5"]').click()
    page.locator('[data-layout-size]').fill('150');page.locator('[data-layout-size]').dispatch_event('input')
    page.locator('[data-layout-done]').click()
    both=json.loads(page.evaluate(f'localStorage.getItem({json.dumps(KEY)})'));assert len(both['layouts'])==2
    assert read_data(page)==original
    page.locator('#ts-back').click();editor(page)
    page.locator('[data-layout-key="id:copy-week"]').click();page.locator('[data-layout-size]').fill('180');page.locator('[data-layout-size]').dispatch_event('input')
    page.locator('[data-layout-cancel]').click()
    assert json.loads(page.evaluate(f'localStorage.getItem({json.dumps(KEY)})'))==both
    if mobile:
        # Drafts can be edited in both orientations and saved together.
        editor(page);page.set_viewport_size({'width':844,'height':390})
        page.wait_for_function("document.documentElement.classList.contains('landscape-sheet')")
        page.locator('[data-layout-done]').wait_for(state='visible')
        assert page.locator('#mobile-menu .menu-layout-frame').count()==1
        page.locator('[data-layout-key="id:export-png"]').click()
        page.locator('[data-layout-size]').fill('115');page.locator('[data-layout-size]').dispatch_event('input')
        page.locator('[data-layout-height]').fill('700');page.locator('[data-layout-height]').dispatch_event('input')
        page.locator('#mobile-menu').evaluate('e=>e.scrollTop=180')
        assert page.locator('#data-menu').bounding_box()['y']>=45
        page.locator('#mobile-menu').evaluate('e=>e.scrollTop=0')
        page.locator('[data-layout-done]').click()
        rotated=json.loads(page.evaluate(f'localStorage.getItem({json.dumps(KEY)})'));assert len(rotated['layouts'])==3
        assert rotated['layouts']['coarse-portrait-week']==both['layouts']['coarse-portrait-week']
        page.locator('#mobile-menu-toggle').click();assert not page.locator('#mobile-menu').is_visible()
        page.locator('#mobile-menu-toggle').click();editor(page)
        page.locator('[data-layout-view]').select_option('month')
        page.locator('[data-layout-key="month-shift:1.5"]').wait_for(state='visible');page.locator('[data-layout-done]').click()
        assert len(json.loads(page.evaluate(f'localStorage.getItem({json.dumps(KEY)})'))['layouts'])==4
        page.set_viewport_size({'width':390,'height':844});page.wait_for_function("!document.documentElement.classList.contains('landscape-sheet')")
        page.locator('#ts-back').click()
    # Storage failure must leave a reviewable draft with Cancel available.
    editor(page)
    page.evaluate("() => {window.layoutOriginalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='lesnoy-kitchen:menu-layout:v1')throw new DOMException('Full','QuotaExceededError');return window.layoutOriginalSet.call(this,k,v)}}")
    page.locator('[data-layout-done]').click();assert page.locator('[data-layout-done]').is_visible()
    assert 'Не удалось' in page.locator('[data-layout-name]').inner_text()
    page.evaluate('() => {Storage.prototype.setItem=window.layoutOriginalSet}');page.locator('[data-layout-cancel]').click()
    assert read_data(page)==original
    # Reset affects only the current table/orientation and restores source DOM.
    editor(page);page.once('dialog',lambda d:d.accept());page.locator('[data-layout-reset]').click()
    assert page.locator('.menu-layout-frame').count()==0
    assert page.locator('#schedule-panel .week-toolbar').is_visible()
    assert page.locator('.topbar #export-png').is_visible()
    assert read_data(page)==original
    page.reload(wait_until='networkidle');assert page.locator('.menu-layout-frame').count()==0
    # Other tabs must not be silently overwritten while a draft is open.
    editor(page)
    disk=page.evaluate(f'localStorage.getItem({json.dumps(KEY)})')
    page.evaluate("key=>window.dispatchEvent(new StorageEvent('storage',{key,newValue:JSON.stringify({version:1,layouts:{}})}))",KEY)
    page.locator('[data-layout-done]').click()
    assert 'другой вкладке' in page.locator('[data-layout-name]').inner_text()
    assert page.evaluate(f'localStorage.getItem({json.dumps(KEY)})')==disk
    page.locator('[data-layout-cancel]').click()
    assert read_data(page)==original
    # Invalid saved preferences fall back to the unmodified site.
    page.evaluate("key=>localStorage.setItem(key,JSON.stringify({version:1,layouts:{'coarse-portrait-week':{height:-1,items:{}}}}))",KEY)
    page.reload(wait_until='networkidle')
    assert page.locator('.menu-layout-frame').count()==0
    assert not errors,errors
    context.close();return {'browser':browser.browser_type.name,'mobile':mobile,'menu_layout':'passed'}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:8765');parser.add_argument('--engine',choices=['all','chromium','webkit'],default='all');args=parser.parse_args();results=[]
    with sync_playwright() as p:
        for name in (['chromium','webkit'] if args.engine=='all' else [args.engine]):
            browser=getattr(p,name).launch()
            try:
                for mobile in [False,True]:results.append(run(browser,args.url,mobile))
            finally:browser.close()
    print(json.dumps(results,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
