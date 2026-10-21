/**
 * Render the brand art in headless Chromium and write the PNG sources.
 *
 *   node design/brand/export.cjs [outDir]
 *
 * Needs Playwright resolvable (e.g. NODE_PATH pointing at an npx cache);
 * it is not a project dependency. scripts/build-icons.sh turns the PNGs
 * into assets/icon.icns, assets/icon.ico and the DMG background.
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

async function main() {
  const outDir = path.resolve(process.argv[2] || "design/brand/out");
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`file://${path.join(__dirname, "index.html")}`);
    // Runs in the page, where exportAll is defined by index.html.
    const out = await page.evaluate("window.exportAll()");
    if (errors.length) throw new Error(errors.join("\n"));
    for (const [name, value] of Object.entries(out)) {
      if (typeof value !== "string") continue;
      const data = Buffer.from(value.split(",")[1], "base64");
      fs.writeFileSync(path.join(outDir, `${name}.png`), data);
    }
    fs.writeFileSync(
      path.join(outDir, "dmg-layout.json"),
      JSON.stringify(out.layout, null, 2),
    );
    console.log(`Wrote brand art to ${outDir}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
