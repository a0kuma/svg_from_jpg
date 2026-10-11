// Regression for the reported case (Screenshot_20261012_020159): two higher
// plateaus each sit on the upper side of a flat–flat 90° step — a WIDE one and
// a NARROW one. Before the fix only the wide one was highlighted, because a
// plateau narrower than ~2·window had every column swallowed into a "step"
// class and never became a "flat" region. Now a step is a zero-width edge and
// each column's slope window is clipped at step edges, so even a 1-column
// plateau reads as flat — BOTH peaks are highlighted.
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

    // ---- 1. pure function: BOTH peaks form flat regions and are highlighted ---
    const pure = await page.evaluate(() => {
      const skyline = [];
      const push = (n, y) => { for (let k = 0; k < n; k++) skyline.push({ x: skyline.length, y }); };
      push(50, 250); push(6, 120); push(54, 250); push(50, 120); push(140, 250);   // 300 columns
      const opts = { window: 4, flatEps: 0.1, jumpMax: 6 };
      const { regions } = horizonRegions(skyline, opts);
      const flats = regions.filter(r => r.type === "flat").map(r => ({ y: r.y, startIndex: r.startIndex, endIndex: r.endIndex }));
      const highlights = flatHighlights(regions).map(r => ({ y: r.y, startIndex: r.startIndex })).sort((a, b) => a.startIndex - b.startIndex);
      return { flats, highlights };
    });

    // both peaks (y=120) are now genuine flat regions — the narrow one (cols
    // 50–55) as well as the wide one (cols 110–159).
    assert.ok(pure.flats.some(f => f.y === 120 && f.startIndex > 100), "the wide peak forms a flat region");
    assert.ok(pure.flats.some(f => f.y === 120 && f.startIndex < 60), "the narrow peak now forms a flat region too (clipped window)");

    // both higher plateaus are highlighted.
    assert.equal(pure.highlights.length, 2, "both peaks are highlighted");
    assert.deepEqual(pure.highlights.map(h => h.y), [120, 120], "both highlights are y=120 peaks");
    assert.ok(pure.highlights[0].startIndex < 60 && pure.highlights[1].startIndex > 100, "one narrow peak, one wide peak");

    // ---- 2. live DOM: both peaks lit ----------------------------------------
    await page.evaluate(markup => loadSvgText(markup), narrowSlopeSvg);
    await page.click("#slopeband");
    await page.waitForFunction(() => document.querySelector("#lbands").childElementCount > 0);
    const dom = await page.evaluate(() => ({
      slope: document.querySelectorAll("#lbands > div.slope").length,
      flat: [...document.querySelectorAll("#lbands > div.flat")].map(d => ({ left: parseFloat(d.style.left), width: parseFloat(d.style.width) }))
    }));
    const lit = pct => dom.flat.some(b => pct >= b.left && pct <= b.left + b.width);

    assert.equal(dom.slope, 0, "pure vertical steps give no slope bands");
    assert.equal(dom.flat.length, 2, "both plateaus are highlighted");
    assert.ok(lit(WIDE_PCT), "the WIDE peak (~45%) is highlighted — right circle");
    assert.ok(lit(NARROW_PCT), "the NARROW peak (~17.7%) is highlighted too — left circle, now fixed");

    assert.deepEqual(pageErrors, [], "the browser reported no runtime errors");
    console.log("Horizon narrow-plateau regression: OK (both wide and narrow peaks highlighted)");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
