const puppeteer = require('/home/andyxu/pspace/node_modules/puppeteer-core');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome-stable',
    headless:'new',args:['--no-sandbox']});
  const page=await browser.newPage();
  await page.setViewport({width:412,height:820,deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await page.goto('http://127.0.0.1:5000/',{waitUntil:'networkidle0'});
  // open the editor directly with a test SVG: top region (y0-40) + bottom region (y60-100)
  const res = await page.evaluate(async () => {
    const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'+
      '<path fill="#c33" d="M0 0 100 0 100 40 0 40 Z"/>'+
      '<path fill="#39c" d="M0 60 100 60 100 100 0 100 Z"/></svg>';
    window.SvgEditor.open(svg);
    await new Promise(r=>setTimeout(r,150));
    const cv=document.querySelector('#svged canvas');
    const r=cv.getBoundingClientRect();
    // draw a horizontal line left->right across vertical middle of the canvas
    const y=r.top+r.height*0.5;
    const xs=[r.left+r.width*0.15, r.left+r.width*0.4, r.left+r.width*0.65, r.left+r.width*0.85];
    const mk=(x,yy)=>new Touch({identifier:1,target:cv,clientX:x,clientY:yy});
    const fire=(type,x)=>{const t=mk(x,y);cv.dispatchEvent(new TouchEvent(type,{touches:type==='touchend'?[]:[t],changedTouches:[t],bubbles:true,cancelable:true}));};
    fire('touchstart',xs[0]);
    for(let i=1;i<xs.length;i++) fire('touchmove',xs[i]);
    fire('touchend',xs[xs.length-1]);
    await new Promise(r=>setTimeout(r,80));
    // read hint text + trigger cut
    const hint=document.querySelector('#svged .cnt').textContent;
    document.querySelector('#svged [data-a="cut"]').click();
    await new Promise(r=>setTimeout(r,80));
    const after=document.querySelector('#svged .cnt').textContent;
    return {hint, after};
  });
  await page.screenshot({path:'/home/andyxu/svg_workspace/shot_touch.png'});
  console.log('hint after touch-draw:', res.hint);
  console.log('after cut           :', res.after);
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
