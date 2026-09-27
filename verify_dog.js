const puppeteer = require('/home/andyxu/pspace/node_modules/puppeteer-core');
const OUT = '/home/andyxu/svg_2_workspace';
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath:'/usr/bin/google-chrome-stable',
    headless:'new', args:['--no-sandbox','--force-device-scale-factor=1','--window-size=1440,820'] });
  const page = await browser.newPage();
  await page.setViewport({ width:1440, height:820, deviceScaleFactor:1 });
  await page.goto('http://127.0.0.1:48489/', { waitUntil:'networkidle0' });
  await (await page.$('#fin')).uploadFile(OUT+'/sample.svg');
  await page.waitForFunction(() => document.querySelector('#host svg') && getComputedStyle(document.querySelector('#drop')).display==='none');
  await sleep(300);

  const centerOf = id => page.evaluate((id) => {
    const el=document.querySelector('#'+id), b=el.getBBox(), m=el.getScreenCTM();
    const c=new DOMPoint(b.x+b.width/2, b.y+b.height/2).matrixTransform(m);
    return {x:c.x, y:c.y};
  }, id);
  const copied = () => page.evaluate(()=>[...document.querySelectorAll('#rsvg > *')].map(e=>e.id||e.tagName).sort().join(', '));
  const clearRight = () => page.click('#clrcp');

  for (const [id,out] of [['dog-body','shot_click_body.png'],['dog-head','shot_click_head.png']]) {
    await clearRight(); await sleep(150);
    const c = await centerOf(id);
    await page.mouse.click(c.x, c.y);
    await sleep(900);
    await page.screenshot({ path: OUT+'/'+out });
    console.log(`click ${id} @x=${Math.round(c.x)} -> copied: ${await copied()}`);
  }
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
