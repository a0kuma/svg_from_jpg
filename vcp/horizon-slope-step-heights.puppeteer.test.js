// Guards the discontinuity rule against step HEIGHT (originally reported with
// Screenshot_20261011_205051, where a block staircase of pure vertical 90°
// steps had some steps banded and some not).
//
// A vertical step concentrates its whole rise into a single column, so it is a
// discontinuity no matter how tall it is. horizonSlopeSegments flags any
// single-column jump |Δy|/Δx above `jumpMax`, independent of the windowed
// slope — so a 20px step and a 130px step are treated identically (both
// unmarked), while a genuine diagonal (rise spread over many columns) is still
// marked. This test pins both halves of that: steps of mixed heights → zero
// bands; a diagonal in the same canvas → exactly one band.
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

// A staircase of flat-topped blocks: every edge is a vertical 90° step, and the
// step heights deliberately mix short (20px) and tall (130px).
//   tops:  370 → 350 → 220 → 200 → 70 → 50   (steps 20,130,20,130,20)
const TOPS = [370, 350, 220, 200, 70, 50];
const BLOCK = 50;
const PALETTE = ["#4caf50", "#8bc34a", "#cddc39", "#ffc107", "#ff9800", "#f44336"];
const stairSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400">`
  + TOPS.map((top, i) => `<rect x="${i * BLOCK}" y="${top}" width="${BLOCK}" height="${400 - top}" fill="${PALETTE[i]}"/>`).join("")
  + `</svg>`;
const STEP_PCT = [50, 100, 150, 200, 250].map(x => (x / 300) * 100);   // all five step x positions

// Same idea, but one edge is a DIAGONAL ramp (flat → slope → flat → vertical
// step → flat): the diagonal must be marked, the vertical step must not.
const rampSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400">`
  + `<polygon points="0,300 80,300 160,180 240,180 240,60 300,60 300,400 0,400" fill="#8bc34a"/></svg>`;
const DIAGONAL_PCT = (120 / 300) * 100;   // 40% — middle of the ramp
const RAMP_STEP_PCT = (240 / 300) * 100;  // 80% — the vertical step

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

    // ---- 1. pure function: mixed-height steps all stay unmarked --------------
    const staircaseSegments = await page.evaluate((tops, block) => {
      const points = [];
      tops.forEach(top => { for (let k = 0; k < block; k++) points.push({ x: points.length, y: top }); });
      return horizonSlopeSegments(points, { window: 4, flatEps: 0.1, jumpMax: 6 });
    }, TOPS, BLOCK);
    assert.deepEqual(staircaseSegments, [], "every vertical step is a discontinuity — 20px and 130px alike — so nothing is sloped");

    // a monotonic staircase has exactly one local-maximum plateau (the top): an
    // intermediate block has a HIGHER block to its right, so it is not a peak and
    // is not highlighted.
    const highlights = await page.evaluate((tops, block) => {
      const points = [];
      tops.forEach(top => { for (let k = 0; k < block; k++) points.push({ x: points.length, y: top }); });
      const { regions } = horizonRegions(points, { window: 4, flatEps: 0.1, jumpMax: 6 });
      return flatHighlights(regions).map(h => h.y).sort((a, b) => a - b);
    }, TOPS, BLOCK);
    assert.deepEqual(highlights, [50], "only the peak (top=50) is highlighted; blocks with a higher neighbour are not");

    // ---- 2. live DOM: steps give no slope bands; only the peak plateau lit ----
    await page.evaluate(markup => loadSvgText(markup), stairSvg);
    await page.click("#slopeband");
    await page.waitForFunction(() => document.querySelector("#lbands").childElementCount > 0);
    const stair = await page.evaluate(() => ({
      slope: document.querySelectorAll("#lbands > div.slope").length,
      flat: [...document.querySelectorAll("#lbands > div.flat")].map(d => ({ left: parseFloat(d.style.left), width: parseFloat(d.style.width) }))
    }));
    const litStair = pct => stair.flat.some(b => pct >= b.left && pct <= b.left + b.width);
    assert.equal(stair.slope, 0, "a staircase of five 90° steps produces no slope bands");
    assert.equal(stair.flat.length, 1, "only the peak plateau is highlighted");
    assert.ok(litStair((275 / 300) * 100), "the tallest block (~92%) is highlighted");
    assert.ok(!litStair((175 / 300) * 100), "an intermediate block (~58%) is NOT highlighted — it has a higher neighbour");
    assert.ok(!litStair((25 / 300) * 100), "the lowest block (~8%) is not highlighted");

    // ---- 3. the classifier still marks a real slope -------------------------
    await page.evaluate(markup => loadSvgText(markup), rampSvg);
    await page.click("#slopeband");
    await page.waitForFunction(() => document.querySelector("#lbands > div.slope") !== null);
    const ramp = await page.evaluate(() => ({
      slope: [...document.querySelectorAll("#lbands > div.slope")].map(d => ({ left: parseFloat(d.style.left), width: parseFloat(d.style.width) })),
      flat: [...document.querySelectorAll("#lbands > div.flat")].map(d => ({ left: parseFloat(d.style.left), width: parseFloat(d.style.width) }))
    }));
    const covered = (arr, pct) => arr.some(b => pct >= b.left && pct <= b.left + b.width);

    assert.equal(ramp.slope.length, 1, "the lone diagonal yields exactly one slope band");
    assert.ok(covered(ramp.slope, DIAGONAL_PCT), "the diagonal (40%) IS a gridded slope band");
    assert.ok(!covered(ramp.slope, RAMP_STEP_PCT), "the vertical step (80%) is NOT a slope band");
    assert.equal(ramp.flat.length, 1, "the taller plateau past the step is highlighted");
    assert.ok(covered(ramp.flat, 90), "the highlight sits on the top plateau (~80–100%)");

    assert.deepEqual(pageErrors, [], "the browser reported no runtime errors");
    console.log("Horizon slope-band discontinuity test: OK (steps unmarked at any height; tallest plateau highlighted; diagonal gridded)");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
