// Regenerate the app icons (PNG) from the SVG sources in public/icons.
// Run: node scripts/icons.cjs (needs Playwright with Chromium installed).
// The maskable and Apple icons are full-bleed squares: Android and iOS apply
// their own mask. Their symbol stays inside the maskable 80% safe zone.
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("playwright");

const dir = join(__dirname, "..", "public", "icons");
const icons = [
  ["icon.svg", 192, "icon-192.png"],
  ["icon.svg", 512, "icon-512.png"],
  ["icon-maskable.svg", 512, "icon-maskable-512.png"],
  ["icon-maskable.svg", 180, "apple-touch-icon.png"],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [src, size, out] of icons) {
    await page.setViewportSize({ width: size, height: size });
    const svg = readFileSync(join(dir, src), "utf8").replace("<svg ", `<svg width="${size}" height="${size}" `);
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`);
    await page.screenshot({ path: join(dir, out), omitBackground: true });
  }
  await browser.close();
})();
