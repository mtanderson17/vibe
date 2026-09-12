// Icon builder — crops the V region from vibe-logo.webp, produces PNGs at
// standard sizes, and packs .icns (macOS) + .ico (Windows).
//
// Usage: node scripts/build-icons.mjs
// Outputs to branding/icons/.
//
// If the crop is wrong, adjust CROP below and re-run.

import sharp from 'sharp'
import png2icons from 'png2icons'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'branding/vibe-logo.webp')
const OUT = path.join(ROOT, 'branding/icons')

// Source image is 512×512. The V + rainbow extrusion occupies roughly the
// left ~290px × y=25→475. Estimating a bounding box; adjust and re-run if the
// crop is off.
const CROP = { left: 0, top: 15, width: 308, height: 475 }

// Dark navy from the source background, used to pad the crop into a square.
const PAD_BG = { r: 5, g: 3, b: 20, alpha: 1 }

// Icon sizes we need: standard set for all three platforms.
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]

await mkdir(OUT, { recursive: true })

// 1. Crop the V region.
console.log(`Cropping V region from ${SRC} (${JSON.stringify(CROP)})`)
const cropped = await sharp(SRC).extract(CROP).toBuffer()

// 2. Pad to a square using the source's dark background so it feels seamless.
const dim = Math.max(CROP.width, CROP.height)
const squared = await sharp(cropped)
  .resize(dim, dim, { fit: 'contain', background: PAD_BG })
  .toBuffer()

// 3. Write the 1024 master + all smaller PNG sizes.
for (const size of SIZES) {
  const png = await sharp(squared).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer()
  await writeFile(path.join(OUT, `icon-${size}.png`), png)
  console.log(`  ✓ icon-${size}.png`)
}

// 4. Master 1024 PNG for downstream packing.
const master = await sharp(squared).resize(1024, 1024, { kernel: 'lanczos3' }).png().toBuffer()
await writeFile(path.join(OUT, 'icon.png'), master)

// 5. Windows .ico (multi-resolution).
const ico = png2icons.createICO(master, png2icons.BILINEAR, 0, false)
if (ico) {
  await writeFile(path.join(OUT, 'icon.ico'), ico)
  console.log(`  ✓ icon.ico`)
} else {
  console.error('  ✗ icon.ico generation failed')
}

// 6. macOS .icns (multi-resolution).
const icns = png2icons.createICNS(master, png2icons.BILINEAR, 0)
if (icns) {
  await writeFile(path.join(OUT, 'icon.icns'), icns)
  console.log(`  ✓ icon.icns`)
} else {
  console.error('  ✗ icon.icns generation failed')
}

console.log('\nDone. Preview: branding/icons/icon-256.png')
