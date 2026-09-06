"""Checks the actual HTTP-served publication, not merely an in-memory mock."""
import json,pathlib,subprocess,sys,time
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).parent;PUB=ROOT/'public';checks=[]
def check(name,ok):
 if not ok:raise AssertionError(name)
 checks.append(name)
p=subprocess.Popen([sys.executable,'-m','http.server','8876','--bind','127.0.0.1','--directory',str(PUB)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
 time.sleep(1)
 with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True,args=['--no-sandbox']);page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto('http://127.0.0.1:8876/',wait_until='networkidle');page.wait_for_selector('#lineup-20')
  check('Twenty cards served over HTTP',page.locator('#picks article').count()==20);check('180 complete roster rows',page.locator('#picks tbody tr').count()==180);check('No JavaScript errors at load',not errors);baseline=page.evaluate('JSON.stringify(Milly.data.lineups)');d=json.loads(baseline);r=json.loads((PUB/'latest.json').read_text());home=r['games'][0]['home'];phrase=('Saints' if home=='NO' else home)+' wins';page.locator('#belief').fill(phrase);page.locator('#interpret').click();check('Interpretation visible before results',page.locator('#understood').inner_text().find('Confirm')>=0 and page.locator('#results article').count()==0);page.locator('#generate').click();page.wait_for_selector('#results article',timeout=90000);check('Three real conditional lineups generated',page.locator('#results article').count()==3);check('Published baseline unchanged',baseline==page.evaluate('JSON.stringify(Milly.data.lineups)'));check('No scenario JavaScript errors',not errors)
  page.locator('#belief').fill(home+' does not win');page.locator('#interpret').click();check('Negation rejected instead of guessed','Negation' in page.locator('#error').inner_text());page.set_viewport_size({'width':390,'height':844});page.evaluate('scrollTo(0,0)');check('Mobile width does not overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+2'));page.screenshot(path=str(ROOT/'mobile-check.png'))
  context=browser.new_context(java_script_enabled=False);nojs=context.new_page();nojs.goto('http://127.0.0.1:8876/');check('All twenty visible with JavaScript disabled',nojs.locator('#picks article').count()==20);context.close();browser.close()
 receipt={'passed':True,'count':len(checks),'checks':checks,'mode':'Actual local HTTP plus Chromium; hosted deployment checked separately','release_id':r['release_id']};(PUB/'browser-verification.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt,indent=2))
finally:p.terminate()
