// Regression for the reported case (Screenshot_20261012_022440): the white
// circle marks a plateau that must NOT be coloured, because the plateau to its
// right is HIGHER — so the circled one is not the highest ("非最高") and falls
// outside the colouring condition.
//
// A plateau is coloured only if it is a LOCAL MAXIMUM: higher than at least one
// flat neighbour across a 90° step AND lower than none. Having a lower neighbour
// on one side is not enough — a higher neighbour on the other side disqualifies
// it. Only genuine peaks are coloured (but every separate peak is, not just the
// global highest).
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

// Three plateaus rising left→right: LOW (y=250, cols 0–100), MIDDLE (y=150,
// cols 100–200) and HIGH (y=50, cols 200–300). The MIDDLE plateau is higher
// than LOW but lower than HIGH — it is the "white circle" case.
const risingSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400">`
  + `<polygon points="0,250 100,250 100,150 200,150 200,50 300,50 300,400 0,400" fill="#8bc34a"/></svg>`;
const LOW_PCT = (50 / 300) * 100;     // ~16.7%
const MIDDLE_PCT = (150 / 300) * 100; // 50% — the circled plateau
const HIGH_PCT = (250 / 300) * 100;   // ~83.3% — the peak

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

    // ---- 1. pure function: only the HIGH plateau is a local maximum ----------
    const highlights = await page.evaluate(() => {
      const skyline = [];
      const push = (n, y) => { for (let k = 0; k < n; k++) skyline.push({ x: skyline.length, y }); };
      push(100, 250); push(100, 150); push(100, 50);   // low → middle → high
      const { regions } = horizonRegions(skyline, { window: 4, flatEps: 0.1, jumpMax: 6 });
      return flatHighlights(regions).map(h => h.y);
    });
    assert.deepEqual(highlights, [50], "only the peak (y=50) is highlighted; the middle plateau has a higher neighbour, so it is excluded");

    // ---- 2. live DOM: middle plateau stays dark ------------------------------
    await page.evaluate(markup => loadSvgText(markup), risingSvg);
    await page.click("#slopeband");
    await page.waitForFunction(() => document.querySelector("#lbands").childElementCount > 0);
    const flat = await page.evaluate(() => [...document.querySelectorAll("#lbands > div.flat")]
      .map(d => ({ left: parseFloat(d.style.left), width: parseFloat(d.style.width) })));
    const lit = pct => flat.some(b => pct >= b.left && pct <= b.left + b.width);

    assert.equal(flat.length, 1, "exactly one plateau is highlighted");
    assert.ok(lit(HIGH_PCT), "the peak (~83%) is highlighted");
    assert.ok(!lit(MIDDLE_PCT), "the middle plateau (~50%) is NOT highlighted — it has a higher neighbour (the reported issue)");
    assert.ok(!lit(LOW_PCT), "the low plateau (~17%) is not highlighted");

    assert.deepEqual(pageErrors, [], "the browser reported no runtime errors");
    console.log("Horizon peak-only regression: OK (a plateau with a higher neighbour is not coloured)");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
