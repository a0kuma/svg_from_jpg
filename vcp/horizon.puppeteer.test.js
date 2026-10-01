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
      const type = filename.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream";
      response.writeHead(200, { "content-type": type });
      response.end(await readFile(filename));
    } catch (_) {
      response.writeHead(404).end();
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
    await page.waitForFunction(() => typeof window.d3 !== "undefined");

    const fixture = await readFile(fixturePath, "utf8");
    const result = await page.evaluate(async markup => {
      loadSvgText(markup);
      const { box, points, sampleWidth, sampleHeight } = await horizonSamples();
      return { box: { x: box.x, y: box.y, width: box.width, height: box.height }, points, sampleWidth, sampleHeight };
    }, fixture);

    assert.deepEqual(result.box, { x: 0, y: 0, width: 300, height: 400 });
    assert.equal(result.sampleWidth, 3024, "ex.svg uses every source x-pixel");
    assert.equal(result.sampleHeight, 4032, "ex.svg uses every source y-pixel");
    assert.equal(result.points.length, 3024, "ex.svg produces one point per source x-pixel");
    assert.equal(result.points.filter(point => point.y !== null).length, 3024, "ex.svg has a skyline value for every source x-pixel");
    const at20Percent = result.points[Math.floor(result.points.length * 0.2)].y;
    const at70Percent = result.points[Math.floor(result.points.length * 0.7)].y;
    assert.ok(Math.abs(at20Percent - 124.05754) < 0.01, "20% x has the expected skyline y");
    assert.ok(Math.abs(at70Percent - 94.99008) < 0.01, "70% x has the expected skyline y");
    assert.notEqual(at20Percent, at70Percent, "the real skyline varies across ex.svg");

    const csv = await page.evaluate(async markup => {
      loadSvgText(markup);
      return horizonCsv((await horizonSamples()).points);
    }, fixture);
    const rows = csv.trim().split("\n").map(row => row.split(","));
    assert.equal(rows.length, 3025, "CSV contains each D3 data point plus a header");
    assert.deepEqual(rows[0], ["x", "y", "x_normalized", "y_normalized"]);
    assert.equal(rows[1][2], "0.000000", "the first x point normalizes to 0");
    assert.equal(rows.at(-1)[2], "100.000000", "the last x point normalizes to 100");
    assert.ok(rows.every((row, index) => index === 0 || (Number(row[2]) >= 0 && Number(row[2]) <= 100 && Number(row[3]) >= 0 && Number(row[3]) <= 100)), "normalized CSV values stay within 0 to 100");

    await page.click("#horizon");
    await page.waitForSelector(".swal2-popup #horizon-chart svg");
    await page.waitForSelector("#download-horizon-csv");
    await page.evaluate(() => {
      window.horizonDownload = null;
      HTMLAnchorElement.prototype.click = function() { window.horizonDownload = { href: this.href, name: this.download }; };
    });
    await page.click("#download-horizon-csv");
    const download = await page.evaluate(() => window.horizonDownload);
    assert.equal(download.name, "horizon.csv", "the CSV button requests the Horizon filename");
    assert.ok(download.href.startsWith("blob:"), "the CSV button creates a downloadable blob");
    const chart = await page.$eval("#horizon-chart path", element => element.getAttribute("d"));
    assert.ok(chart && chart.length > 0, "D3 renders ex.svg as a skyline path");
    const background = await page.$eval("#horizon-chart image.horizon-source", element => element.getAttribute("href"));
    assert.ok(background.startsWith("data:image/svg+xml"), "D3 uses the loaded SVG as the skyline background");
    assert.deepEqual(pageErrors, [], "the browser reported no runtime errors");
    console.log("Horizon Puppeteer test: OK");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
