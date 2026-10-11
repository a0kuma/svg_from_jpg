// Reproduces the reported case (Screenshot_20261012_020159): two higher
// plateaus each sit on the upper side of a flat–flat 90° step, but only one is
// highlighted.
//
//   right circle (OK):  a WIDE higher plateau → highlighted.
//   left circle (NOT):  a NARROW higher plateau → no highlight.
//
// Why: a plateau narrower than ~2·window has every column within `window` of
// one of its two bounding jumps, so every column classifies as "step" and the
// peak never becomes a "flat" region — it cannot be highlighted. A wide peak
// has interior columns far from both edges, forms a flat region, and is
// highlighted. This test pins that width-dependent miss (the repro, not the
// desired behaviour — both peaks are genuine higher plateaus at 90° steps).
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const puppeteer = require("puppeteer-core");

const repositoryRoot = path.resolve(__dirname, "..");

function staticServer() {
  const server = createServer(async (request, response) => {
    try {
      const requestPath = new URL(request.url, "http://localhost").pathname;
      const filename = path.resolve(repositoryRoot, `.${requestPath}`);
      if (!filename.startsWith(`${repositoryRoot}${path.sep}`)) throw new Error("outside repository");
      const body = await readFile(filename);
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

// Skyline (screen y, smaller = higher): a low base plateau at y=250 with two
// peaks that rise to y=120 — a NARROW one (6px wide, cols 50–56) and a WIDE one
// (50px wide, cols 110–160). Both are the upper side of a flat–flat 90° step.
const narrowSlopeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400">`
  + `<polygon points="0,250 50,250 50,120 56,120 56,250 110,250 110,120 160,120 160,250 300,250 300,400 0,400" fill="#8bc34a"/></svg>`;
const NARROW_PCT = (53 / 300) * 100;   // ~17.7% — centre of the narrow peak
const WIDE_PCT = (135 / 300) * 100;    // 45% — centre of the wide peak

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

    // ---- 1. pure function: the narrow peak never becomes a flat region --------
    const pure = await page.evaluate(() => {
      const skyline = [];
      const push = (n, y) => { for (let k = 0; k < n; k++) skyline.push({ x: skyline.length, y }); };
      push(50, 250); push(6, 120); push(54, 250); push(50, 120); push(140, 250);   // 300 columns
      const opts = { window: 4, flatEps: 0.1, jumpMax: 6 };
      const { regions } = horizonRegions(skyline, opts);
      const flats = regions.filter(r => r.type === "flat").map(r => ({ y: r.y, startIndex: r.startIndex, endIndex: r.endIndex }));
      const highlights = flatHighlights(regions).map(r => ({ y: r.y, startIndex: r.startIndex }));
      return { flats, highlights };
    });

    // a flat region exists for the wide peak (y=120), but NONE covers the narrow peak (cols 50–55)
    assert.ok(pure.flats.some(f => f.y === 120 && f.startIndex > 100), "the wide peak forms a flat region");
    assert.ok(!pure.flats.some(f => f.y === 120 && f.startIndex < 60), "the narrow peak never becomes a flat region — it is swallowed as 'step'");

    // so only the wide peak is highlighted; the narrow peak (a genuine higher
    // plateau at a 90° step) is missed.
    assert.equal(pure.highlights.length, 1, "exactly one plateau is highlighted");
    assert.equal(pure.highlights[0].y, 120, "the highlight is a y=120 peak");
    assert.ok(pure.highlights[0].startIndex > 100, "...the WIDE peak, not the narrow one");

    // ---- 2. live DOM: wide peak lit, narrow peak dark ------------------------
    await page.evaluate(markup => loadSvgText(markup), narrowSlopeSvg);
    await page.click("#slopeband");
    await page.waitForFunction(() => document.querySelector("#lbands").childElementCount > 0);
    const dom = await page.evaluate(() => ({
      slope: document.querySelectorAll("#lbands > div.slope").length,
      flat: [...document.querySelectorAll("#lbands > div.flat")].map(d => ({ left: parseFloat(d.style.left), width: parseFloat(d.style.width) }))
    }));
    const lit = pct => dom.flat.some(b => pct >= b.left && pct <= b.left + b.width);

    assert.equal(dom.slope, 0, "pure vertical steps give no slope bands");
    assert.equal(dom.flat.length, 1, "only one plateau is highlighted");
    assert.ok(lit(WIDE_PCT), "the WIDE peak (~45%) is highlighted — right circle, OK");
    assert.ok(!lit(NARROW_PCT), "the NARROW peak (~17.7%) is NOT highlighted — left circle, the reported issue");

    assert.deepEqual(pageErrors, [], "the browser reported no runtime errors");
    console.log("Horizon narrow-plateau repro: OK (wide peak highlighted, narrow peak missed)");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
