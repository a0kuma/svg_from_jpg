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
      return {
        flat: horizonSlopeSegments(mk([5, 5, 5, 5, 5])),
        oneRun: horizonSlopeSegments(mk([0, 0, 1, 2, 2])),
        twoRuns: horizonSlopeSegments(mk([0, 1, 1, 2])),
        gap: horizonSlopeSegments(mk([0, 1, null, 2, 3])),
        trailing: horizonSlopeSegments(mk([0, 0, 1, 2])),
        colors: [0, 1, 2].map(bandColor)
      };
    });

    assert.deepEqual(segments.flat, [], "a perfectly flat skyline yields 0 bands");

    assert.equal(segments.oneRun.length, 1, "a single rise→fall is one non-flat run");
    assert.deepEqual(
      { s: segments.oneRun[0].startIndex, e: segments.oneRun[0].endIndex },
      { s: 1, e: 3 }, "the run spans exactly the non-flat indices");
    assert.equal(segments.oneRun[0].startPct, 25, "startIndex 1 of 4 → 25%");
    assert.equal(segments.oneRun[0].endPct, 75, "endIndex 3 of 4 → 75%");

    assert.equal(segments.twoRuns.length, 2, "a flat step between two slopes splits into 2 bands");
    assert.ok(segments.twoRuns[0].endPct <= segments.twoRuns[1].startPct, "bands do not overlap");

    assert.equal(segments.gap.length, 2, "a null (no-pixel) gap breaks the run in two");
    assert.deepEqual(
      segments.gap.map(s => [s.startIndex, s.endIndex]),
      [[0, 1], [3, 4]], "the gap at index 2 is excluded from every band");

    assert.equal(segments.trailing.length, 1, "a run reaching the last sample is closed");
    assert.equal(segments.trailing[0].endPct, 100, "the trailing run ends at 100%");

    assert.equal(new Set(segments.colors).size, 3, "each band index gets a distinct colour");
    assert.ok(segments.colors.every(c => c.startsWith("hsla(")), "colours are hsla() strings");

    // ---- 2. live DOM rendering over the real ex.svg skyline ------------------
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

    assert.ok(bands.left.length > 1, "ex.svg's varied skyline produces multiple bands");
    assert.equal(bands.left.length, bands.right.length, "both panels show the same bands");
    assert.ok(bands.left.every(b => b.left >= 0 && b.left + b.width <= 100.0001), "bands stay within 0~100%");
    assert.ok(bands.left.every(b => b.width > 0), "every band has a positive width");
    assert.ok(bands.left.every(b => b.bg.includes("hsla") || /rgba?\(/.test(b.bg)), "every band is painted");
    const lefts = bands.left.map(b => b.left);
    assert.deepEqual(lefts, [...lefts].sort((a, b) => a - b), "bands are laid out left→right");

    // ---- 3. a second click clears the bands ---------------------------------
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
