const puppeteer = require('/home/andyxu/pspace/node_modules/puppeteer-core');
const OUT = '/home/andyxu/svg_2_workspace';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    headless: 'new',
    args: ['--no-sandbox', '--force-device-scale-factor=1', '--window-size=1440,820'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 820, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:48489/', { waitUntil: 'networkidle0' });

  // upload the sample SVG
  const input = await page.$('#fin');
  await input.uploadFile(OUT + '/sample.svg');
  await page.waitForFunction(() => document.querySelector('#host svg') && window.getComputedStyle(document.querySelector('#drop')).display === 'none');
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: OUT + '/shot_1_loaded.png' });

  // Find a screen point where `id` is the TOPMOST filled hit (mirrors the app's
  // hitTest) — guarantees a real interior click and self-checks the logic.
  const goodPoint = id => page.evaluate((id) => {
    const svg = document.querySelector('#host svg'), target = document.querySelector('#' + id);
    const geoms = [...svg.querySelectorAll('path,rect,circle,ellipse,polygon,polyline,line')];
    const topmostAt = (ux, uy) => {
      let hit = null;
      for (const el of geoms) {
        if (getComputedStyle(el).fill === 'none') continue;
        const s = new DOMPoint(ux, uy).matrixTransform(svg.getScreenCTM());
        const p = new DOMPoint(s.x, s.y).matrixTransform(el.getScreenCTM().inverse());
        if (el.isPointInFill(p)) hit = el;
      }
      return hit;
    };
    const b = target.getBBox();
    let best = null, bestD = 1e9;                 // most-interior match (avoids edge rounding)
    for (let gy = 1; gy <= 15; gy++) for (let gx = 1; gx <= 15; gx++) {
      const ux = b.x + b.width * gx / 16, uy = b.y + b.height * gy / 16;
      if (topmostAt(ux, uy) !== target) continue;
      const d = Math.hypot(gx / 16 - 0.5, gy / 16 - 0.5);
      if (d < bestD) { bestD = d; best = { ux, uy }; }
    }
    if (!best) return null;
    const s = new DOMPoint(best.ux, best.uy).matrixTransform(svg.getScreenCTM());
    return { x: s.x, y: s.y };
  }, id);

  const clicks = [];
  for (const id of ['sun', 'roof', 'door', 'win', 'ring']) {
    const c = await goodPoint(id);
    if (!c) { console.error('no interior point found for', id); process.exit(2); }
    clicks.push(c);
  }
  for (const c of clicks) {
    await page.mouse.click(c.x, c.y);
    await new Promise(r => setTimeout(r, 720));   // let the fly animation finish
  }
  await page.screenshot({ path: OUT + '/shot_2_copied.png' });

  const n = await page.evaluate(() => document.querySelectorAll('#rsvg > *').length);
  console.log('copied regions on right:', n);

  // zoom in (synced both sides) to show pan/zoom + mid-flight animation of a new pick
  await page.mouse.move(360, 470);
  await page.mouse.wheel({ deltaY: -520 });
  await new Promise(r => setTimeout(r, 200));
  const c = await goodPoint('house');
  await page.mouse.click(c.x, c.y);
  await new Promise(r => setTimeout(r, 230));
  await page.screenshot({ path: OUT + '/shot_3_flying.png' });

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
