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
      const { box, points } = await horizonSamples();
      return { box: { x: box.x, y: box.y, width: box.width, height: box.height }, points };
    }, fixture);

    assert.deepEqual(result.box, { x: 0, y: 0, width: 300, height: 400 });
    assert.equal(result.points.length, 300, "ex.svg is sampled once per x-unit");
    assert.equal(result.points.filter(point => point.y !== null).length, 300, "ex.svg fills every x column");
    for (const point of result.points) {
      assert.ok(Math.abs(point.y - 399.5) < 0.01, "the maximum filled y reaches the bottom edge of ex.svg");
    }

    await page.click("#horizon");
    await page.waitForSelector(".swal2-popup #horizon-chart svg");
    const chart = await page.$eval("#horizon-chart path", element => element.getAttribute("d"));
    assert.ok(chart && chart.length > 0, "D3 renders ex.svg as a skyline path");
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
