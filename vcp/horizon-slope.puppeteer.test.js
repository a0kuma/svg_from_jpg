const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const puppeteer = require("puppeteer-core");

const repositoryRoot = path.resolve(__dirname, "..");
const fixturePath = path.join(repositoryRoot, "ex.svg");

function staticServer() {
  const server = createServer(async (request, response) => {
    try {
      const requestPath = new URL(request.url, "http://localhost").pathname;
      const filename = path.resolve(repositoryRoot, `.${requestPath}`);
      if (!filename.startsWith(`${repositoryRoot}${path.sep}`)) throw new Error("outside repository");
      const body = await readFile(filename);                       // read BEFORE writing the header
      const type = filename.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream";
      response.writeHead(200, { "content-type": type });
      response.end(body);
    } catch (_) {
      if (!response.headersSent) response.writeHead(404);
      response.end();
    }
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function main() {
  const server = await staticServer();
  const { port } = server.address();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/vcp/index.html`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => typeof window.d3 !== "undefined" && typeof window.Plotly !== "undefined");

    // ---- 1. pure segmentation logic on synthetic skylines --------------------
    const segments = await page.evaluate(() => {
      const mk = ys => ys.map((y, i) => ({ x: i, y }));
      const pair = s => s.map(g => [g.startIndex, g.endIndex]);
      const opts = { window: 1, flatEps: 0.01, jumpMax: 10 };
      return {
        flat: horizonSlopeSegments(mk([5, 5, 5, 5, 5]), opts),
        ramp: pair(horizonSlopeSegments(mk([0, 1, 2, 3, 4, 5]), opts)),
        staircase: pair(horizonSlopeSegments(mk([0, 0, 0, 1, 1, 1, 2, 2, 2]), { ...opts, window: 2 })),
        staircaseForward: pair(horizonSlopeSegments(mk([0, 0, 0, 1, 1, 1, 2, 2, 2]), { ...opts, window: 1 })),
        cliff: horizonSlopeSegments(mk([0, 0, 0, 50, 50, 50]), opts),
        cliffBetweenSlopes: pair(horizonSlopeSegments(mk([0, 1, 2, 50, 51, 52]), opts)),
        gap: pair(horizonSlopeSegments(mk([0, 1, 2, null, 4, 5, 6]), opts)),
        colors: [0, 1, 2].map(bandColor)
      };
    });

    assert.deepEqual(segments.flat, [], "a perfectly flat skyline yields 0 bands");
    assert.deepEqual(segments.ramp, [[0, 5]], "a constant slope is one unbroken band");

    // the RIGHT-circle case: a rasterised diagonal (flat tread + step, repeating)
    // must read as ONE segment, not fragment into a band per step.
    assert.deepEqual(segments.staircase, [[1, 7]], "a windowed slope merges the staircase into one band");
    assert.ok(segments.staircaseForward.length > 1, "a naive per-step read would fragment the same staircase");

    // the LEFT-circle case: a near-vertical step is a discontinuity, never marked.
    assert.deepEqual(segments.cliff, [], "a lone vertical jump is a discontinuity, not a band");
    assert.deepEqual(segments.cliffBetweenSlopes, [[0, 1], [4, 5]], "a jump splits two slopes and is left unmarked");

    assert.deepEqual(segments.gap, [[0, 1], [5, 6]], "a null (no-pixel) gap breaks the run and is unmarked");

    assert.equal(new Set(segments.colors).size, 3, "each band index gets a distinct colour");
    assert.ok(segments.colors.every(c => c.startsWith("hsla(")), "colours are hsla() strings");

    // ---- 2. clean geometric SVG: flat → vertical step → diagonal → flat -------
    // mirrors the reported screenshot: the step must stay unmarked, the diagonal
    // must be a single band.
    const stepSlopeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400"><polygon points="0,200 100,200 100,100 150,100 250,250 300,250 300,400 0,400" fill="#c9c4bd"/></svg>`;
    await page.evaluate(markup => loadSvgText(markup), stepSlopeSvg);
    await page.click("#slopeband");
    await page.waitForFunction(() => document.querySelector("#lbands").childElementCount > 0);
    const clean = await page.evaluate(() => [...document.querySelectorAll("#lbands > div")]
      .map(d => ({ left: parseFloat(d.style.left), width: parseFloat(d.style.width) })));

    assert.equal(clean.length, 1, "the diagonal yields exactly one band");
    const band = clean[0], right = band.left + band.width;
    assert.ok(band.left > 40 && band.left < 55, "the band starts at the diagonal (~50%), not the flat top");
    assert.ok(right > 80 && right < 90, "the band ends where the diagonal does (~83%)");
    assert.ok(!(33 >= band.left && 33 <= right), "the vertical step (~33%) is outside the band — the discontinuity is unmarked");

    // ---- 3. live DOM rendering over the real ex.svg skyline ------------------
    const fixture = await readFile(fixturePath, "utf8");
    await page.evaluate(markup => loadSvgText(markup), fixture);
    await page.click("#slopeband");
    await page.waitForFunction(() => document.querySelector("#lbands").childElementCount > 0);
    const bands = await page.evaluate(() => {
      const read = host => [...document.querySelectorAll(`#${host} > div`)].map(d => ({
        left: parseFloat(d.style.left), width: parseFloat(d.style.width), bg: d.style.background
      }));
      return { left: read("lbands"), right: read("rbands") };
    });

    assert.ok(bands.left.length > 0, "ex.svg's varied skyline produces bands");
    assert.ok(bands.left.length < 431, "windowing + discontinuity exclusion beats the naive per-pixel partition");
    assert.equal(bands.left.length, bands.right.length, "both panels show the same bands");
    assert.ok(bands.left.every(b => b.left >= 0 && b.left + b.width <= 100.0001), "bands stay within 0~100%");
    assert.ok(bands.left.every(b => b.width > 0), "every band has a positive width");
    assert.ok(bands.left.every(b => b.bg.includes("hsla") || /rgba?\(/.test(b.bg)), "every band is painted");
    const lefts = bands.left.map(b => b.left);
    assert.deepEqual(lefts, [...lefts].sort((a, b) => a - b), "bands are laid out left→right");

    // ---- 4. a second click clears the bands ---------------------------------
    await page.click("#slopeband");
    const cleared = await page.evaluate(() => ({
      left: document.querySelector("#lbands").childElementCount,
      right: document.querySelector("#rbands").childElementCount
    }));
    assert.deepEqual(cleared, { left: 0, right: 0 }, "clicking again clears both panels");

    assert.deepEqual(pageErrors, [], "the browser reported no runtime errors");
    console.log(`Horizon slope-band test: OK (${bands.left.length} bands on ex.svg)`);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
