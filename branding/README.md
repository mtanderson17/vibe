# Vibe branding

**Chosen direction:** `vibe-logo.webp` — big block V tilted forward, rainbow-striped 3D extrusion, chrome-blue front face, "ibe" wordmark integrated to the right, space background. 80s nostalgic / retrowave, but rainbow-forward.

The file in `logo-concepts/` is the original reference (raster). The concepts numbered 01–07 are earlier exploration and are kept for reference only — they aren't the brand.

## Assets

- `vibe-logo.webp` — full logo (scene). Used for README hero, sidebar brand, splash.
- `icons/` — V-only crop for app icons. Sizes 16, 24, 32, 48, 64, 128, 256, 512, 1024 as PNG, plus `icon.ico` (Windows multi-res) and `icon.icns` (macOS multi-res).
- Regenerate icons with `npm run build:icons` (edit `CROP` in `scripts/build-icons.mjs` if the source ever changes).

## Followups

1. ~~App icons~~ ✅ Done.
2. ~~Sidebar~~ ✅ Done (`src/App.tsx` uses `vibe-logo.webp`).
3. ~~README hero~~ ✅ Done.
4. **Vector version** — raster works everywhere but for extra crispness on Hi-DPI we may want SVG. Two paths: hand-trace in SVG with matching rainbow extrusion, or accept raster + density-doubled PNGs. Not urgent.
5. **Splash / setup screen hero** — full logo shown on first-run / setup screen. Pair with #74 onboarding polish.
6. **Wire icons into electron-builder** — when packaging (#66) happens, point at `branding/icons/icon.ico`, `icon.icns`, and `icon.png` (Linux) in the electron-builder config.

## Palette (extracted from the chosen logo, for use in UI accents)

- Rainbow stripe (extrusion side): `#ff2b2b` `#ff8a2b` `#ffd42b` `#4de74d` `#3ba6ff` `#a35aff`
- V front face chrome-blue: `#5a48ff` → `#a866ff` (gradient)
- Space background: `#0a0018` → `#1a0033`
- Nebula magenta accent: `#a11a90`
