const puppeteer = require('/home/andyxu/pspace/node_modules/puppeteer-core');
const OUT='/home/andyxu/svg_2_workspace';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome-stable',
    headless:'new',args:['--no-sandbox','--force-device-scale-factor=1']});
  const page=await browser.newPage();
  await page.setViewport({width:390,height:844,deviceScaleFactor:1,isMobile:true}); // iPhone-ish portrait
  await page.goto('http://127.0.0.1:48489/',{waitUntil:'networkidle0'});
  await (await page.$('#fin')).uploadFile(OUT+'/sample.svg');
  await page.waitForFunction(()=>document.querySelector('#host svg')&&getComputedStyle(document.querySelector('#drop')).display==='none');
  await sleep(400);
  // report layout: are panels stacked (top/bottom)?
  const layout=await page.evaluate(()=>{
    const s=getComputedStyle(document.querySelector('#stage')).flexDirection;
    const l=document.querySelector('#left').getBoundingClientRect();
    const r=document.querySelector('#right').getBoundingClientRect();
    return {flexDir:s, left:{x:Math.round(l.x),y:Math.round(l.y),w:Math.round(l.width),h:Math.round(l.height)},
            right:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}};
  });
  // click the door column to prove copy still works in portrait
  const c=await page.evaluate(()=>{const el=document.querySelector('#door'),b=el.getBBox(),m=el.getScreenCTM();const p=new DOMPoint(b.x+b.width/2,b.y+b.height/2).matrixTransform(m);return{x:p.x,y:p.y};});
  await page.mouse.click(c.x,c.y); await sleep(900);
  const copied=await page.evaluate(()=>[...document.querySelectorAll('#rsvg > *')].map(e=>e.id).sort().join(', '));
  await page.screenshot({path:OUT+'/shot_portrait.png'});
  console.log('flex-direction:',layout.flexDir);
  console.log('left  panel:',JSON.stringify(layout.left));
  console.log('right panel:',JSON.stringify(layout.right));
  console.log('stacked top/bottom:', layout.right.y >= layout.left.y+layout.left.h-2 && Math.abs(layout.left.x-layout.right.x)<2);
  console.log('copied after click:',copied);
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
