import sharp from "sharp";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = resolve(__dirname, "../src/frontend/icon.svg");
const outDir = resolve(__dirname, "../src/frontend");

async function main() {
  const svg = sharp(svgPath);

  // 192x192 — minimum size Chrome requires for beforeinstallprompt
  await svg.clone().resize(192, 192).png().toFile(resolve(outDir, "icon-192.png"));
  console.log("Generated icon-192.png");

  // 512x512 — standard PWA icon
  await svg.clone().resize(512, 512).png().toFile(resolve(outDir, "icon-512.png"));
  console.log("Generated icon-512.png");

  // 512x512 maskable — same source (already has safe-zone padding in SVG)
  await svg.clone().resize(512, 512).png().toFile(resolve(outDir, "icon-maskable.png"));
  console.log("Generated icon-maskable.png");

  console.log("All icons generated.");
}

main().catch((err) => {
  console.error("Icon generation failed:", err);
  process.exit(1);
});
