# Vibe branding

**Chosen direction:** `vibe-logo.webp` — big block V tilted forward, rainbow-striped 3D extrusion, chrome-blue front face, "ibe" wordmark integrated to the right, space background. 80s nostalgic / retrowave, but rainbow-forward.

The file in `logo-concepts/` is the original reference (raster). The concepts numbered 01–07 are earlier exploration and are kept for reference only — they aren't the brand.

## Followups needed before we ship

1. **App icons.** Electron needs `.icns` (macOS), `.ico` (Windows), and `.png` (Linux) at multiple sizes: 16, 32, 64, 128, 256, 512, 1024. The current raster is a scene, not a mark — it needs to be simplified for tiny sizes (below ~64px the "ibe" text becomes unreadable). Options:
   - Crop to just the V (drops the wordmark) for the app-icon variant.
   - Commission or vector-recreate a simplified glyph-only version for icons.
2. **Vector version.** The raster works for splash / marketing / README hero, but for the in-app sidebar we want SVG so it stays crisp at any DPR. Two paths: hand-trace the V shape in SVG with a matching rainbow-striped extrusion, or accept raster and just ship multiple density-doubled PNGs (@1x, @2x, @3x).
3. **Sidebar treatment.** Replace the current text-only "VIBE" in `src/App.tsx` (sidebar-brand) with the logo. Small size (~24px tall) so it doesn't dominate the sidebar.
4. **Splash / setup screen hero.** Full logo shown once on first-run / setup.
5. **README hero shot.** Full logo at the top of the project README.

## Palette (extracted from the chosen logo, for use in UI accents)

- Rainbow stripe (extrusion side): `#ff2b2b` `#ff8a2b` `#ffd42b` `#4de74d` `#3ba6ff` `#a35aff`
- V front face chrome-blue: `#5a48ff` → `#a866ff` (gradient)
- Space background: `#0a0018` → `#1a0033`
- Nebula magenta accent: `#a11a90`
