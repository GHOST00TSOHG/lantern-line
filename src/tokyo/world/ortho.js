// @ts-nocheck
// Aerial photo of the area (GSI seamlessphoto tiles fetched by tools/pipeline/fetch.mjs into
// public/ortho/<area>/), stitched into one texture that the terrain material drapes over the open ground.
import * as THREE from 'three';
import { shared } from './materials.js';

const MAX = 8192;
const GSI = "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto";

// Web Mercator tile corner -> lon / lat
const tileLon = (x, z) => (x / 2 ** z) * 360 - 180;
const tileLat = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

// proj: makeProjection() of the area; bounds: manifest.bounds. Resolves to true if a photo was loaded.
export async function loadOrtho(base, proj, bounds, renderer) {
  // no photo fetched for this area: a dev server answers a missing file with its HTML page, hence the catch
  const index = await fetch(`${base}/index.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!index) return false;
  let { z, x0, x1, y0, y1 } = index;
  // One zoom closer from GSI (~0.5 m) so lane paint and paving read on every street.
  // Local z17 tiles stay the fallback if that fetch fails.
  let urlFor = (x, y) => `${base}/${z}_${x}_${y}.jpg`;
  if (z < 18) {
    const probe = await fetch(`${GSI}/${z + 1}/${x0 * 2}/${y0 * 2}.jpg`).then((r) => r.ok).catch(() => false);
    if (probe) {
      z += 1;
      x0 *= 2; x1 = x1 * 2 + 1; y0 *= 2; y1 = y1 * 2 + 1;
      urlFor = (x, y) => `${GSI}/${z}/${x}/${y}.jpg`;
    }
  }
  const sizeX = bounds.maxX - bounds.minX, sizeZ = bounds.maxZ - bounds.minZ;
  const span = Math.max(sizeX, sizeZ);
  const k = Math.min(MAX, (x1 - x0 + 1) * 256) / span;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sizeX * k); canvas.height = Math.round(sizeZ * k);
  const g = canvas.getContext('2d');
  g.fillStyle = '#6f6e68'; g.fillRect(0, 0, canvas.width, canvas.height);
  const jobs = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    jobs.push(fetch(urlFor(x, y)).then((r) => (r.ok ? r.blob() : null)).then((b) => b && createImageBitmap(b)).then((img) => {
      if (!img) return;
      // over a 150 m tile the Mercator grid is as good as linear in our local metres
      const [ax, az] = proj.project(tileLon(x, z), tileLat(y, z)), [bx, bz] = proj.project(tileLon(x + 1, z), tileLat(y + 1, z));
      g.drawImage(img, (ax - bounds.minX) * k, (az - bounds.minZ) * k, (bx - ax) * k + 0.5, (bz - az) * k + 0.5);
    }).catch(() => {}));
  }
  await Promise.all(jobs);
  sharpen(g, canvas);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  shared.uOrtho.value = texture;
  shared.uOrthoRect.value.set(bounds.minX, bounds.minZ, sizeX, sizeZ);
  shared.uOrthoOn.value = 1;
  return true;
}

// Pull lane paint, curbs and paving joints out of a soft aerial.
function sharpen(g, canvas) {
  const w = canvas.width, h = canvas.height;
  if (w < 8 || h < 8 || w * h > 8000 * 8000) return;
  const img = g.getImageData(0, 0, w, h);
  const s = img.data;
  const o = new Uint8ClampedArray(s);
  const at = (x, y, c) => s[((y * w + x) << 2) + c];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) << 2;
      for (let c = 0; c < 3; c++) {
        const blur = (at(x - 1, y, c) + at(x + 1, y, c) + at(x, y - 1, c) + at(x, y + 1, c)) * 0.25;
        let v = s[i + c] + (s[i + c] - blur) * 0.9;
        v = (v - 124) * 1.22 + 124;
        o[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  img.data.set(o);
  g.putImageData(img, 0, 0);
}
