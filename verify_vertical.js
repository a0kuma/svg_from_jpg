const puppeteer = require('/home/andyxu/pspace/node_modules/puppeteer-core');
const OUT = '/home/andyxu/svg_2_workspace';
(async () => {
  const browser = await puppeteer.launch({ executablePath:'/usr/bin/google-chrome-stable',
    headless:'new', args:['--no-sandbox','--force-device-scale-factor=1','--window-size=1440,820'] });
  const page = await browser.newPage();
  await page.setViewport({ width:1440, height:820, deviceScaleFactor:1 });
  await page.goto('http://127.0.0.1:48489/', { waitUntil:'networkidle0' });
  await (await page.$('#fin')).uploadFile(OUT+'/sample.svg');
  await page.waitForFunction(() => document.querySelector('#host svg') && getComputedStyle(document.querySelector('#drop')).display==='none');
  await new Promise(r=>setTimeout(r,300));
  const info = await page.evaluate(() => {
    const svg=document.querySelector('#host svg');
    const geoms=[...svg.querySelectorAll('path,rect,circle,ellipse,polygon,polyline,line')];
    const sbox = el => { const b=el.getBBox(), m=el.getScreenCTM();
      const cs=[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]];
      let ys=[],xs=[]; for(const[x,y]of cs){const p=new DOMPoint(x,y).matrixTransform(m);xs.push(p.x);ys.push(p.y);}
      return {y:Math.min(...ys), yh:Math.max(...ys), x:Math.min(...xs), xw:Math.max(...xs)}; };
    const door=document.querySelector('#door'); const db=sbox(door);
    const clientX=(db.x+db.xw)/2, clientY=(db.y+db.yh)/2;
    const expected=[];
    for(const el of geoms){ if(getComputedStyle(el).fill==='none')continue; const b=sbox(el);
      if(clientX>=b.x && clientX<=b.xw) expected.push(el.id||el.dataset.rid); }
    return {clientX, clientY, expected};
  });
  await page.mouse.click(info.clientX, info.clientY);
  await new Promise(r=>setTimeout(r,900));
  const got = await page.evaluate(() => [...document.querySelectorAll('#rsvg > *')].map(e=>e.id||e.getAttribute('data-rid')||e.tagName));
  await page.screenshot({ path: OUT+'/shot_vertical.png' });
  console.log('click x =', Math.round(info.clientX));
  console.log('expected strip members:', info.expected.sort().join(', '));
  console.log('copied to right       :', got.sort().join(', '));
  console.log('dog excluded:', !got.some(g=>String(g).startsWith('dog')));
  console.log('MATCH:', JSON.stringify(info.expected.sort())===JSON.stringify(got.sort()));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
