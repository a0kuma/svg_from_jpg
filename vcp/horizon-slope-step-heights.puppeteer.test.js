// Reproduces the reported case (Screenshot_20261011_205051): a pure block
// staircase whose edges are ALL vertical 90° steps — no diagonals at all — yet
// some steps get a colour band and some do not.
//
// Why: horizonSlopeSegments classifies a discontinuity by the magnitude of the
// *windowed* slope, |Δy| / (2·window·Δx). A tall step produces a slope above
// `steepMax` (correctly treated as a discontinuity and left unmarked), but a
// SHORT step produces a small slope that lands in the "sloped" band and gets
// marked. The cutoff here is |Δy| ≈ steepMax·2·window = 4·8 = 32 px, so a
// 20px step is marked while a 130px step is not.
//
// This test characterises that height-dependent behaviour; it is the repro, not
// an endorsement — a true fix would detect verticality from the single-sample
// jump, independent of its height.
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

// A staircase of flat-topped blocks. Steps alternate short (20px) and tall
// (130px); every block is 50px wide inside a 300×400 canvas.
//   tops:  370 → 350 → 220 → 200 → 70 → 50
//   steps:    20   130   20   130   20
//   x:        50   100  150   200  250   (→ 16.67% 33.33% 50% 66.67% 83.33%)
const TOPS = [370, 350, 220, 200, 70, 50];
const BLOCK = 50;
const PALETTE = ["#4caf50", "#8bc34a", "#cddc39", "#ffc107", "#ff9800", "#f44336"];
const stairSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400">`
  + TOPS.map((top, i) => `<rect x="${i * BLOCK}" y="${top}" width="${BLOCK}" height="${400 - top}" fill="${PALETTE[i]}"/>`).join("")
  + `</svg>`;

const SHORT_STEP_PCT = [50, 150, 250].map(x => (x / 300) * 100);   // marked (16.67/50/83.33%)
const TALL_STEP_PCT = [100, 200].map(x => (x / 300) * 100);        // unmarked (33.33/66.67%)

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

    // ---- 1. pure function: short steps become bands, tall steps do not -------
    const segments = await page.evaluate((tops, block) => {
      const points = [];
      tops.forEach(top => { for (let k = 0; k < block; k++) points.push({ x: points.length, y: top }); });
      const segs = horizonSlopeSegments(points, { window: 4, flatEps: 0.1, steepMax: 4 });
      // the band straddles the boundary symmetrically, so its centre is the step x
      return segs.map(s => ({ center: (s.startIndex + s.endIndex + 1) / 2, startIndex: s.startIndex, endIndex: s.endIndex }));
    }, TOPS, BLOCK);

    assert.equal(segments.length, 3, "only the three SHORT steps are marked");
    assert.deepEqual(segments.map(s => s.center), [50, 150, 250], "the marked bands sit on the 20px steps, not the 130px ones");

    // ---- 2. live DOM: same split, visible on screen -------------------------
    await page.evaluate(markup => loadSvgText(markup), stairSvg);
    await page.click("#slopeband");
    await page.waitForFunction(() => document.querySelector("#lbands").childElementCount > 0);
    const bands = await page.evaluate(() => [...document.querySelectorAll("#lbands > div")]
      .map(d => ({ left: parseFloat(d.style.left), width: parseFloat(d.style.width) })));

    const covered = pct => bands.some(b => pct >= b.left && pct <= b.left + b.width);

    assert.equal(bands.length, 3, "three bands render for a staircase of five 90° steps");
    for (const pct of SHORT_STEP_PCT) assert.ok(covered(pct), `the short step at ${pct.toFixed(2)}% IS marked`);
    for (const pct of TALL_STEP_PCT) assert.ok(!covered(pct), `the tall step at ${pct.toFixed(2)}% is NOT marked`);

    assert.deepEqual(pageErrors, [], "the browser reported no runtime errors");
    console.log(`Horizon slope-band step-height repro: OK (short steps marked, tall steps skipped — ${bands.length} bands)`);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
