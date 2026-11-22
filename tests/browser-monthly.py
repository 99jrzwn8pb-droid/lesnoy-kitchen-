#!/usr/bin/env python3
"""Real Chromium/WebKit checks using synthetic data only.

Install: PLAYWRIGHT_BROWSERS_PATH=/tmp/lesnoy-browsers python -m playwright install chromium webkit
Run with a static server on port 8765, then:
PLAYWRIGHT_BROWSERS_PATH=/tmp/lesnoy-browsers python tests/browser-monthly.py
These checks emulate device sizes; they do not certify a physical iPhone.
"""
import argparse
import json
import os
import struct
import zlib
from pathlib import Path

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/tmp/lesnoy-browsers")
# The local WebKit bundle uses extracted Debian libraries under its sys/lib.
# Playwright's system-path validator cannot see them; actual launch still checks
# every required shared library through the native dynamic loader.
if Path("/tmp/lesnoy-webkit-libs/root").is_dir():
    os.environ.setdefault("PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS", "1")
from playwright.sync_api import sync_playwright

ARTIFACTS = Path(__file__).parent / "artifacts" / "monthly-browser"


def download_file(page, selector, destination):
    with page.expect_download() as pending:
        page.locator(selector).click()
    download = pending.value
    assert download.failure() is None, "File download completed"
    download.save_as(str(destination))
    return destination.read_bytes()


def print_density(png):
    chunks = []
    at = 8
    while at + 12 <= len(png):
        length = struct.unpack(">I", png[at:at+4])[0]
        kind = png[at+4:at+8]
        data = png[at+8:at+8+length]
        assert zlib.crc32(kind + data) == struct.unpack(">I", png[at+8+length:at+12+length])[0]
        if kind == b"pHYs":
            chunks.append(struct.unpack(">IIB", data))
        at += length + 12
    assert chunks == [(15748, 15748, 1)], "PNG includes valid 400 dpi density"


def png_quality_checks(page, mobile, weekly=False):
    save = "#png-save" if weekly else "#ts-png-download"
    assert page.locator("#png-print, #png-phones, #ts-png-print").count() == 0
    page.locator(save).wait_for(state="visible")
    data = download_file(page, save, ARTIFACTS / ("weekly" if weekly else "monthly") / "print.png")
    print_density(data)
    width = struct.unpack(">I", data[16:20])[0]
    assert width > 4000, "High quality PNG is automatic on desktop and phone"
    assert page.locator(save).get_attribute("download").endswith("-a4.png")
    if weekly:
        assert page.locator('#dialog-title').inner_text()=='График сотрудников'
    assert page.evaluate("""weekly=>{
      const dialog=document.querySelector(weekly?'#editor-dialog':'#ts-dialog'),r=e=>e.getBoundingClientRect();
      const img=dialog.querySelector('.png-preview'),status=dialog.querySelector('.png-preview+.dialog-note'),buttons=dialog.querySelector('.png-actions'),share=buttons.querySelector('button'),save=buttons.querySelector('a');
      return !dialog.innerText.includes('Для печати:') && r(img).bottom<=r(status).top && buttons.firstElementChild===share && share.classList.contains('primary') && !save.classList.contains('primary') && save.classList.contains('small') && share.querySelector('svg') && save.querySelector('svg');
    }""",weekly), 'PNG dialog shows size below preview, share first/primary, compact download and both icons'



def totals(page, person="demo-a"):
    return page.evaluate("""id => LesnoyTimesheetCore.totals(
      LesnoyTimesheet.getBook(),id,LesnoyTimesheet.getMonth())""", person)


def submit(page, form):
    page.locator(f"{form} button[type=submit]").click()
    page.locator("#ts-dialog").wait_for(state="hidden")


def edit_checks(page):
    assert totals(page)["amount"] == 4000, "Only confirmed fractional shifts are paid"
    assert totals(page, "demo-b")["amount"] == 60000, "Fixed salary works without shifts"
    cell = page.locator('#ts-table [data-ts-person="demo-a"][data-date="2026-11-01"]')
    cell.click()
    page.locator('#ts-cell-form [name=value]').fill("1,5")
    page.locator('#ts-cell-form [name=note]').fill("Демонстрация правки")
    submit(page, "#ts-cell-form")
    assert totals(page)["amount"] == 6000, "Decimal comma updates payroll"
    page.locator("#ts-undo").click()
    assert totals(page)["amount"] == 4000
    page.locator('#ts-table [data-pay="demo-a"]').click()
    page.locator('#ts-pay-form [name=amount]').fill("12345,67")
    submit(page, "#ts-pay-form")
    assert totals(page)["amount"] == 12345.67, "Manual payout is exact"
    page.locator("#ts-undo").click()
    page.once("dialog", lambda dialog: dialog.accept())
    page.locator("#ts-confirm").click()
    assert totals(page)["amount"] == 6000, "Month confirmation pays draft shifts"
    page.locator("#ts-undo").click()
    assert totals(page)["amount"] == 4000


def pan_wheel(page, dx, dy):
    # Playwright has no mouse-wheel protocol in mobile WebKit. Dispatch the
    # same DOM event there; desktop checks use the native browser protocol.
    if page.context.browser.browser_type.name == "webkit" and page.evaluate("matchMedia('(pointer: coarse)').matches"):
        page.dispatch_event("#ts-body", "wheel", {"deltaX": dx, "deltaY": dy,
                            "bubbles": True, "cancelable": True})
    else:
        page.mouse.wheel(dx, dy)


def frozen_checks(page):
    for _ in range(3):
        page.locator("#ts-zoom-in").click()
    page.locator("#ts-body").hover()
    pan_wheel(page, 300, -10000)
    page.wait_for_timeout(100)
    geometry = page.evaluate("""() => {
      const v=document.querySelector('#ts-body').getBoundingClientRect();
      const left=document.querySelector('[data-frozen-edge=left]').getBoundingClientRect();
      const top=document.querySelector('[data-frozen-edge=top]').getBoundingClientRect();
      return {width:v.width,leftWidth:left.width,topHeight:top.height,
        topY:top.top,viewportY:v.top,viewportBottom:v.bottom};
    }""")
    assert 0 < geometry["leftWidth"] <= geometry["width"] * .45 + 1
    assert geometry["topHeight"] > 0
    assert geometry["viewportY"] - 1 <= geometry["topY"] < geometry["viewportBottom"]
    overlay = page.locator('[data-frozen-edge=left] [data-rate="demo-a"]').first
    overlay.click()
    assert page.locator("#ts-person-form").is_visible(), "Frozen name opens real profile editor"
    page.locator("#ts-dialog-close").click()
    page.locator("#ts-body").hover()
    pan_wheel(page, 300, 250)
    page.wait_for_timeout(100)
    assert page.locator('[data-frozen-edge=top]').is_visible(), "Header survives horizontal and vertical pan"
    page.locator("#ts-freeze").uncheck()
    assert page.locator('[data-frozen-edge=left]').evaluate("e=>getComputedStyle(e).display") == "none"
    page.locator("#ts-freeze").check()
    page.locator("#ts-zoom-fit").click()


def weekly_palette_checks(page):
    assert page.locator('#shift-palette [data-brush="work"]').count() == 0
    page.locator('#shift-palette [data-brush="midday"]').click()
    box = page.locator('#table-scroll').bounding_box()
    page.locator('#table-scroll').click(position={"x": 4, "y": box["height"]-3})
    assert page.locator('#shift-palette [aria-pressed="true"]').count() == 0
    page.locator('#revision-picker').click()
    page.locator('[data-revision-period="ночь"]').click()
    page.locator('#schedule-body [data-person="demo-a"][data-day="6"]').click()
    assert page.evaluate("""() => {
      const s=LesnoySchedule.getState(),id=s.weeks[s.selectedWeek]['demo-a'][6];
      return s.shifts.find(x=>x.id===id).label==='Ревизия ночь';
    }""")
    page.locator('#schedule-body [data-person="demo-a"][data-day="6"]').click()
    assert page.locator('#dialog-body [data-pick-shift="work"]').count() == 0
    page.locator('#pick-cell-revision').click()
    page.locator('[data-revision-period="утро"]').click()
    assert page.locator('#editor-dialog').is_hidden()
    assert page.locator('#shift-palette > button').nth(-1).get_attribute('id') == 'revision-picker'


def transfer_and_hold_checks(page):
    day='#schedule-body [data-person="demo-a"][data-day="0"]'
    page.locator('#shift-palette [data-brush="day"]').click()
    page.locator(day).click()
    page.locator('#sync-timesheet').click()
    assert page.evaluate("LesnoyTimesheet.getBook().days['demo-a']['2026-11-16'].value") == 1
    page.locator('#ts-open').click()
    page.locator('#ts-table [data-ts-person="demo-a"][data-date="2026-11-16"]').click()
    page.locator('#ts-cell-form [name=value]').fill('1,5')
    page.locator('#ts-cell-form [name=confirmed]').check()
    page.locator('#ts-cell-form [name=note]').fill('Ручная правка переноса')
    submit(page,'#ts-cell-form')
    page.reload(wait_until='networkidle')
    page.locator('#shift-palette [data-brush=""]').click()
    page.locator(day).click()
    assert page.evaluate("LesnoyTimesheet.getBook().days['demo-a']['2026-11-16'].value") == 1.5
    page.locator('#sync-timesheet').click()
    assert page.evaluate("!LesnoyTimesheet.getBook().days['demo-a']['2026-11-16']")
    page.locator('#shift-palette [data-brush="day"]').click()
    page.locator(day).click()
    page.locator('#sync-timesheet').click()
    weekly=page.evaluate('JSON.stringify(LesnoySchedule.getState().weeks)')
    page.once('dialog',lambda d:d.accept())
    page.locator('#cancel-timesheet-transfer').click()
    assert page.locator('#cancel-timesheet-transfer').is_disabled()
    assert page.evaluate("!LesnoyTimesheet.getBook().days['demo-a']['2026-11-16']")
    assert page.evaluate("LesnoyTimesheet.getBook().days['demo-a']['2026-11-01'].value") == .5
    assert page.evaluate('JSON.stringify(LesnoySchedule.getState().weeks)') == weekly
    target='#shift-palette [data-brush="day"]'
    page.locator(target).dispatch_event('pointerdown',{'button':0,'isPrimary':True,'pointerId':1,'clientX':10,'clientY':10})
    page.locator('#hide-time-button').wait_for(state='visible')
    page.locator(target).dispatch_event('pointerup',{'button':0,'pointerId':1})
    page.locator('#hide-time-button').click()
    assert page.locator(target).count() == 0
    page.reload(wait_until='networkidle')
    assert page.locator(target).count() == 0
    assert page.evaluate('JSON.stringify(LesnoySchedule.getState().weeks)') == weekly
    page.locator('#manage-shifts').click()
    page.locator('[data-show-shift="day"]').click()
    page.locator('#close-dialog').click()
    assert page.locator(target).is_visible()


def toolbar_layout_checks(page):
    assert page.evaluate("""() => {
      const r=k=>document.querySelector(k).getBoundingClientRect(),a=r('#sync-timesheet'),b=r('#cancel-timesheet-transfer'),nav=r('.week-navigation'),bar=r('.week-toolbar'),label=r('.week-label');
      return Math.abs(a.left-b.left)<1 && Math.abs(a.right-b.right)<1 && a.bottom<=b.top && nav.right<a.left && label.width>=110 && a.right<=bar.right && b.bottom<=bar.bottom;
    }"""), 'Transfer buttons stack on the right; week picker and arrows have room'


def menu_click(page,selector):
    if not page.locator('#mobile-menu').is_visible():
        page.locator('#mobile-menu-toggle').click()
    page.locator(selector).click()


def close_mobile_menu(page):
    if page.locator('#mobile-menu').is_visible():
        page.locator('#mobile-menu-toggle').click()


def landscape_function_checks(page):
    # Exercise actual controls while they live in the landscape minibar.
    menu_click(page,'#ts-open')
    menu_click(page,'#ts-backup')
    backup_path=ARTIFACTS / (page.context.browser.browser_type.name+'-landscape-backup.json')
    raw=download_file(page,'#ts-backup',backup_path)
    assert json.loads(raw)['type']=='lesnoy-combined-backup'
    close_mobile_menu(page)
    value=totals(page)['amount']
    page.locator('#ts-table [data-ts-person="demo-a"][data-date="2026-11-01"]').click()
    page.locator('#ts-cell-form [name=value]').fill('1,5')
    submit(page,'#ts-cell-form')
    assert totals(page)['amount']==value+2000
    menu_click(page,'#ts-undo')
    assert totals(page)['amount']==value
    page.once('dialog',lambda d:d.accept())
    page.locator('#ts-confirm').click()
    assert totals(page)['amount']==value+2000
    page.locator('#ts-undo').click()
    assert totals(page)['amount']==value
    page.locator('#ts-freeze').uncheck()
    page.locator('#ts-freeze').check()
    page.locator('#ts-zoom-in').click()
    close_mobile_menu(page)
    assert page.locator('[data-frozen-edge=left]').is_visible()
    pan_wheel(page,120,100)
    menu_click(page,'#ts-zoom-fit')
    excel=download_file(page,'#ts-export',ARTIFACTS / 'landscape-2026-11.xlsx')
    assert excel.startswith(b'PK')
    page.locator('#ts-file').set_input_files(str(ARTIFACTS / 'landscape-2026-11.xlsx'))
    page.locator('#ts-import-apply').wait_for(state='visible')
    page.locator('#ts-import-apply').click()
    assert totals(page)['amount']==value, 'Landscape Excel import preserves payroll'
    page.locator('#ts-png').click()
    page.locator('#ts-png-download').wait_for(state='visible')
    print_density(download_file(page,'#ts-png-download',ARTIFACTS / 'landscape-monthly.png'))
    page.locator('#ts-dialog-close').click()
    page.locator('#ts-back').click()
    menu_click(page,'#next-week')
    page.wait_for_function("LesnoySchedule.getState().selectedWeek==='2026-11-23'")
    page.locator('#prev-week').click()
    page.locator('#week-date').fill('2026-11-18')
    page.locator('#week-date').dispatch_event('change')
    assert page.evaluate('LesnoySchedule.getState().selectedWeek')=='2026-11-16'
    toolbar_layout_checks(page)
    close_mobile_menu(page)
    day='#schedule-body [data-person="demo-a"][data-day="0"]'
    page.locator(day).click()
    page.locator('#interval-form [name=start]').fill('12:00')
    page.locator('#interval-form [name=end]').fill('23:00')
    page.locator('#interval-form button[type=submit]').click()
    menu_click(page,'#undo')
    page.locator('#sync-timesheet').click()
    assert not page.locator('#cancel-timesheet-transfer').is_disabled()
    page.once('dialog',lambda d:d.accept())
    page.locator('#cancel-timesheet-transfer').click()
    assert page.locator('#cancel-timesheet-transfer').is_disabled()
    page.locator('#zoom-in').click()
    close_mobile_menu(page)
    before=page.locator('#schedule-surface').get_attribute('style')
    for event,x in [('pointerdown',500),('pointermove',450),('pointerup',450)]:
        page.locator('#table-scroll').dispatch_event(event,{'button':0,'buttons':0 if event=='pointerup' else 1,'pointerId':21,'pointerType':'touch','clientX':x,'clientY':200 if event=='pointerdown' else 150})
    page.wait_for_timeout(100)
    assert page.locator('#schedule-surface').get_attribute('style')!=before
    menu_click(page,'#zoom-fit')
    target='#shift-palette [data-brush="day"]'
    page.locator(target).dispatch_event('contextmenu')
    page.locator('#hide-time-button').click()
    page.locator('#manage-shifts').click()
    page.locator('[data-show-shift="day"]').click()
    page.locator('#close-dialog').click()
    page.locator('#export-png').click()
    page.locator('#png-save').wait_for(state='visible')
    print_density(download_file(page,'#png-save',ARTIFACTS / 'landscape-weekly.png'))
    page.locator('#close-dialog').click()
    close_mobile_menu(page)
    page.once('dialog',lambda d:d.accept())
    with page.expect_navigation(wait_until='networkidle'):
        page.locator('#ts-file').set_input_files(str(backup_path))
    page.wait_for_function("Boolean(window.LesnoyTimesheet)&&document.documentElement.classList.contains('landscape-sheet')")


def landscape_checks(page):
    weekly = page.evaluate("localStorage.getItem(LesnoyCore.STORAGE_KEY)")
    monthly = page.evaluate("localStorage.getItem(LesnoyTimesheetCore.STORAGE_KEY)")
    page.set_viewport_size({"width": 844, "height": 390})
    page.wait_for_function("document.documentElement.classList.contains('landscape-sheet')")
    page.wait_for_timeout(150)
    assert page.locator("#mobile-menu-toggle").is_visible()
    assert not page.locator(".view-switch").is_visible()
    for selector in ["#table-scroll", "#ts-body"]:
        if selector == "#ts-body":
            page.locator("#mobile-menu-toggle").click()
            page.locator("#ts-open").click()
            page.wait_for_timeout(150)
        box = page.locator(selector).bounding_box()
        assert box["height"] >= 388 and box["width"] >= 842, "Landscape table fills screen"
        page.locator("#mobile-menu-toggle").click()
        if selector == "#table-scroll":
            assert page.locator("#mobile-menu .week-label").bounding_box()["width"] >= 120
        palette = "#shift-palette [data-brush]" if selector == "#table-scroll" else "#ts-palette [data-ts-brush]"
        page.locator(palette).first.click()
        assert not page.locator("#mobile-menu").is_visible()
    landscape_function_checks(page)
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_function("!document.documentElement.classList.contains('landscape-sheet')")
    assert page.locator(".view-switch").is_visible()
    assert not page.locator("#mobile-menu-toggle").is_visible()
    page.locator("#ts-back").click()
    assert page.locator("#shift-palette").is_visible()
    assert {k:v for k,v in json.loads(page.evaluate("localStorage.getItem(LesnoyCore.STORAGE_KEY)")).items() if k!="updatedAt"} == {k:v for k,v in json.loads(weekly).items() if k!="updatedAt"}
    assert {k:v for k,v in json.loads(page.evaluate("localStorage.getItem(LesnoyTimesheetCore.STORAGE_KEY)")).items() if k!="updatedAt"} == {k:v for k,v in json.loads(monthly).items() if k!="updatedAt"}


def verify_page(browser, base_url, mobile=False):
    options = {"viewport": {"width": 390, "height": 844}, "device_scale_factor": 2,
               "is_mobile": True, "has_touch": True} if mobile else {
                   "viewport": {"width": 1440, "height": 1000}}
    context = browser.new_context(accept_downloads=True, locale="ru-RU", **options)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(base_url, wait_until="networkidle")
    page.wait_for_function("Boolean(window.LesnoyCore && window.LesnoyTimesheetCore)")
    page.evaluate("""() => {
      const c=window.LesnoyCore,s=c.createState('2026-11-16');
      s.employees=[{id:'demo-a',name:'Демо повар',phone:'',department:'hot'},
        {id:'demo-b',name:'Демо кондитер',phone:'',department:'cold'}];
      for(let i=3;i<=20;i++)s.employees.push({id:'demo-'+i,
        name:'Демо сотрудник '+String(i).padStart(2,'0'),phone:'',department:i%2?'hot':'cold'});
      localStorage.clear();localStorage.setItem(c.STORAGE_KEY,JSON.stringify(s));
      const t=window.LesnoyTimesheetCore,book=t.createBook('2026-11');
      book.people={'demo-a':{type:'shift',rate:2000},'demo-b':{type:'salary',rate:60000}};
      book.days={'demo-a':{
        '2026-11-01':{value:.5,confirmed:true,note:'Демонстрация половины смены'},
        '2026-11-02':{value:1.5,confirmed:true,note:''},
        '2026-11-03':{value:1,confirmed:false,note:'Черновик'}
      }};
      localStorage.setItem(t.STORAGE_KEY,JSON.stringify(t.validateBook(book)));
    }""")
    page.reload(wait_until="networkidle")
    assert page.locator('#shift-palette [aria-pressed="true"]').count()==0, "Reload never preselects a shift"
    assert page.locator("#schedule-panel").is_visible(), "Weekly schedule is visible"
    assert "Демо повар" in page.locator("#schedule-body").inner_text()
    toolbar_layout_checks(page)
    page.locator("#ts-open").click()
    assert not errors, f"Browser errors: {errors}"
    assert page.locator("#ts-panel").is_visible(), "Monthly panel opens"
    page.wait_for_function("document.querySelector('#ts-month').value === '2026-11'")
    assert page.evaluate("""() => {
      const link=document.querySelector('link[href^="glass.css"]');
      const snapshot=()=>JSON.stringify([...document.querySelectorAll('#schedule td,#schedule th,#ts-table td,#ts-table th')].map(e=>{
        const s=getComputedStyle(e);return [s.font,s.color,s.backgroundColor,s.padding,s.border,s.width,s.height];
      }));
      const before=snapshot();link.disabled=true;const base=snapshot();link.disabled=false;
      const bg=getComputedStyle(document.querySelector('#ts-open')).backgroundImage;
      return before===base && bg.includes('102, 102, 102') && bg.includes('61, 61, 61') && getComputedStyle(document.querySelector('#export-png')).backgroundImage.includes('0.38');
    }"""), "Grey glass menu preserves all table cell styles"
    weekly_before = page.evaluate("localStorage.getItem(LesnoyCore.STORAGE_KEY)")
    page.locator("#ts-next").click()
    page.wait_for_function("document.querySelector('#ts-month').value === '2026-12'")
    page.locator("#ts-prev").click()
    page.wait_for_function("document.querySelector('#ts-month').value === '2026-11'")
    edit_checks(page)
    frozen_checks(page)
    assert not errors, f"Browser errors: {errors}"
    label = f"{browser.browser_type.name}-{'iphone' if mobile else 'desktop'}"
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    page.locator("#toast").wait_for(state="hidden", timeout=10000)
    page.screenshot(path=str(ARTIFACTS / f"{label}.png"), full_page=True)
    for _ in range(3):
        page.locator("#ts-zoom-in").click()
    page.screenshot(path=str(ARTIFACTS / f"{label}-zoomed.png"), full_page=True)
    page.locator("#ts-zoom-fit").click()
    backup_bytes = download_file(page, "#ts-backup", ARTIFACTS / f"{label}-backup.json")
    backup = json.loads(backup_bytes)
    assert backup["type"] == "lesnoy-combined-backup"
    assert backup["timesheet"]["days"]["demo-a"]["2026-11-01"]["value"] == .5
    excel = download_file(page, "#ts-export", ARTIFACTS / f"{label}-2026-11.xlsx")
    assert excel.startswith(b"PK\x03\x04"), "Excel download is an XLSX archive"
    page.locator("#ts-png").click()
    page.locator("#ts-png-download").wait_for(state="visible")
    png = download_file(page, "#ts-png-download", ARTIFACTS / f"{label}-export.png")
    assert png.startswith(b"\x89PNG\r\n\x1a\n"), "PNG download is a PNG image"
    width, height = struct.unpack(">II", png[16:24])
    assert width > 1200 and height > 150, "Full monthly PNG contains all 30 days"
    png_quality_checks(page, mobile)
    page.locator("#ts-dialog-close").click()
    page.locator('#ts-table [data-ts-person="demo-a"][data-date="2026-11-01"]').click()
    page.locator('#ts-cell-form [name=value]').fill("1,5")
    submit(page, "#ts-cell-form")
    page.reload(wait_until="networkidle")
    page.locator("#ts-open").click()
    assert totals(page)["amount"] == 6000, "Saved edits survive browser reload"
    page.locator("#ts-file").set_input_files(str(ARTIFACTS / f"{label}-2026-11.xlsx"))
    page.locator("#ts-import-apply").wait_for(state="visible")
    page.locator("#ts-import-apply").click()
    assert totals(page)["amount"] == 4000, "Excel import restores fractional shifts and payroll"
    assert totals(page)["drafts"] == 1, "Excel round trip preserves draft status"
    assert totals(page, "demo-b")["amount"] == 60000, "Excel preserves fixed salary"
    page.once("dialog", lambda dialog: dialog.accept())
    page.locator("#ts-file").set_input_files(str(ARTIFACTS / f"{label}-backup.json"))
    page.wait_for_load_state("networkidle")
    page.wait_for_function("Boolean(window.LesnoyTimesheet)")
    page.locator("#ts-open").click()
    assert totals(page)["amount"] == 4000, "Combined JSON restores payroll"
    assert page.evaluate("localStorage.getItem(LesnoyCore.STORAGE_KEY)") == weekly_before
    page.locator("#ts-back").click()
    assert page.locator("#schedule-panel").is_visible()
    assert "Демо повар" in page.locator("#schedule-body").inner_text()
    assert not errors, f"Browser errors: {errors}"
    weekly_palette_checks(page)
    transfer_and_hold_checks(page)
    page.locator("#export-png").click()
    png_quality_checks(page, mobile, weekly=True)
    page.locator("#close-dialog").click()
    if mobile:
        landscape_checks(page)
    assert not errors, f"Browser errors after rotation: {errors}"
    context.close()
    return {"browser": browser.browser_type.name, "viewport": label, "passed": True}


def verify_private_excel(browser, base_url, source, expected_path):
    """Never save screenshots, downloads, source content or private metrics."""
    expected = json.loads(Path(expected_path).read_text())
    context = browser.new_context()
    page = context.new_page()
    page.goto(base_url, wait_until="networkidle")
    page.evaluate("""() => {
      localStorage.clear();
      localStorage.setItem(LesnoyCore.STORAGE_KEY,JSON.stringify(LesnoyCore.createState('2026-11-16')));
    }""")
    page.reload(wait_until="networkidle")
    page.locator("#ts-open").click()
    weekly_before = page.evaluate("localStorage.getItem(LesnoyCore.STORAGE_KEY)")
    page.locator("#ts-file").set_input_files(str(source))
    page.locator("#ts-import-apply").wait_for(state="visible", timeout=30000)
    page.locator("#ts-import-apply").click()
    result = page.evaluate("""expected => {
      const t=LesnoyTimesheetCore,actual=LesnoyTimesheet.getBook();
      const a=t.employees(actual,null),e=t.employees(expected,null),m=expected.selectedMonth;
      const map=rows=>Object.fromEntries(rows.map(p=>[t.normalizeName(p.name),p.id]));
      const am=map(a),em=map(e);
      const rowsMatch=a.length===e.length&&Object.keys(em).every(name=>{
        const ai=am[name],ei=em[name];if(!ai)return false;
        const at=t.totals(actual,ai,m),et=t.totals(expected,ei,m);
        return at.shifts===et.shifts&&at.amount===et.amount&&at.profile.rate===et.profile.rate
          &&at.profile.type===et.profile.type;
      });
      return {rowsMatch,payrollMatches:t.monthlyTotal(actual,a,m)===t.monthlyTotal(expected,e,m),
        monthMatches:LesnoyTimesheet.getMonth()===m};
    }""", expected)
    assert all(result.values()), "Private workbook import differs from local audited expected book"
    assert page.evaluate("localStorage.getItem(LesnoyCore.STORAGE_KEY)") == weekly_before
    context.close()
    return {"browser": browser.browser_type.name, "private_excel_import": "passed"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8765")
    parser.add_argument("--engine", choices=["chromium", "webkit", "all"], default="all")
    parser.add_argument("--private-xlsx", type=Path)
    parser.add_argument("--private-expected", type=Path)
    args = parser.parse_args()
    results = []
    with sync_playwright() as playwright:
        for name in (["chromium", "webkit"] if args.engine == "all" else [args.engine]):
            browser = getattr(playwright, name).launch(headless=True)
            try:
                for mobile in [False, True]:
                    results.append(verify_page(browser, args.url, mobile))
                if args.private_xlsx and args.private_expected:
                    results.append(verify_private_excel(browser,args.url,args.private_xlsx,args.private_expected))
            finally:
                browser.close()
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
