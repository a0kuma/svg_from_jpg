const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const puppeteer = require("puppeteer-core");

const repositoryRoot = path.resolve(__dirname, "..");
const sampleSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <path fill="#e55" d="M0 2H4V8H0Z"/>
  <path fill="#5ae" d="M6 1H10V6H6Z"/>
  <path fill="none" stroke="#fff" d="M4 9H6"/>
</svg>`;

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

    const points = await page.evaluate(async markup => {
      loadSvgText(markup);
      return (await horizonSamples()).points;
    }, sampleSvg);

    assert.equal(points.length, 10, "one sample is collected for each SVG x-unit");
    for (const index of [0, 1, 2, 3]) assert.ok(Math.abs(points[index].y - 7.5) < 0.01);
    assert.equal(points[4].y, null, "the unfilled gap has no horizon value");
    assert.equal(points[5].y, null, "the stroke-only path is ignored");
    for (const index of [6, 7, 8, 9]) assert.ok(Math.abs(points[index].y - 5.5) < 0.01);

    await page.click("#horizon");
    await page.waitForSelector(".swal2-popup #horizon-chart svg");
    const chart = await page.$eval("#horizon-chart path", path => path.getAttribute("d"));
    assert.ok(chart && chart.length > 0, "D3 renders a skyline path");
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
