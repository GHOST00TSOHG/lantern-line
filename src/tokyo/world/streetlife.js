// @ts-nocheck
// The compiled Shibuya extract ships with an empty road graph and almost no trees.
// This rebuilds both from the real tile polygons: cars follow carriageway centerlines,
// trees line the sidewalks, and parks and car parks fill in.
import { decodeTile, AREA, PROP } from '../shared/tileformat.js';

const TREE_CAP = 2400;
const PARKED_CAP = 420;

function rnd(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function toPts(ring) {
  const pts = [];
  for (let i = 0; i < ring.length; i += 2) pts.push({ x: ring[i], z: ring[i + 1] });
  return pts;
}

function areaOf(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].z - pts[j].x * pts[i].z;
  }
  return Math.abs(a) * 0.5;
}

function centroid(pts) {
  let x = 0, z = 0;
  for (const p of pts) { x += p.x; z += p.z; }
  const n = pts.length || 1;
  return { x: x / n, z: z / n };
}

function inside(x, z, pts) {
  let inn = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, zi = pts[i].z, xj = pts[j].x, zj = pts[j].z;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / ((zj - zi) || 1e-9) + xi) inn = !inn;
  }
  return inn;
}

function insidePoly(x, z, rings) {
  if (!rings.length || !inside(x, z, rings[0])) return false;
  for (let h = 1; h < rings.length; h++) if (inside(x, z, rings[h])) return false;
  return true;
}

function axis(pts) {
  const c = centroid(pts);
  let xx = 0, zz = 0, xz = 0;
  for (const p of pts) {
    const dx = p.x - c.x, dz = p.z - c.z;
    xx += dx * dx; zz += dz * dz; xz += dx * dz;
  }
  const tr = xx + zz;
  const disc = Math.max(0, (tr * tr) / 4 - (xx * zz - xz * xz));
  const l1 = tr / 2 + Math.sqrt(disc);
  let vx = Math.abs(xz) > 1e-6 ? l1 - zz : xx >= zz ? 1 : 0;
  let vz = Math.abs(xz) > 1e-6 ? xz : xx >= zz ? 0 : 1;
  const len = Math.hypot(vx, vz) || 1;
  vx /= len; vz /= len;
  let min = Infinity, max = -Infinity, half = 0;
  for (const p of pts) {
    const dx = p.x - c.x, dz = p.z - c.z;
    const t = dx * vx + dz * vz;
    min = Math.min(min, t);
    max = Math.max(max, t);
    half = Math.max(half, Math.abs(-dx * vz + dz * vx));
  }
  return { c, vx, vz, min, max, length: max - min, width: half * 2 };
}

function polysOf(areas, kinds) {
  const out = [];
  for (const area of areas) {
    if (!kinds.includes(area.kind)) continue;
    for (const poly of area.polygons) {
      const rings = poly.map(toPts).filter((r) => r.length >= 3);
      if (rings.length) out.push(rings);
    }
  }
  return out;
}

function roadsFromTiles(tiles) {
  const nodes = [];
  const edges = [];
  const seen = new Set();
  const nodeAt = (x, z) => {
    for (let i = 0; i < nodes.length; i++) {
      if (Math.hypot(nodes[i].x - x, nodes[i].z - z) < 22) {
        nodes[i].x = (nodes[i].x * 3 + x) / 4;
        nodes[i].z = (nodes[i].z * 3 + z) / 4;
        return i;
      }
    }
    nodes.push({ x, z });
    return nodes.length - 1;
  };
  for (const tile of tiles) {
    const drive = polysOf(tile.areas, [AREA.CARRIAGEWAY]);
    const polys = drive.length ? drive : polysOf(tile.areas, [AREA.ROAD]);
    for (const rings of polys) {
      const pts = rings[0];
      if (areaOf(pts) < 45) continue;
      const ax = axis(pts);
      if (ax.length < 24 || ax.width < 3.2 || ax.length < ax.width * 1.35) continue;
      const a = nodeAt(ax.c.x + ax.vx * ax.min, ax.c.z + ax.vz * ax.min);
      const b = nodeAt(ax.c.x + ax.vx * ax.max, ax.c.z + ax.vz * ax.max);
      if (a === b) continue;
      const pair = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      const lanes = Math.max(1, Math.min(4, Math.round(ax.width / 3.3)));
      const wide = ax.width > 16;
      const mid = ax.width > 9;
      edges.push({
        a, b,
        pts: [
          nodes[a].x, 0, nodes[a].z,
          nodes[b].x, 0, nodes[b].z,
        ],
        highway: wide ? 'primary' : mid ? 'secondary' : 'residential',
        lanes,
        oneway: ax.width < 5.2 ? 1 : 0,
        maxspeed: wide ? 50 : mid ? 40 : 30,
        flyover: false,
        tunnel: false,
        span: false,
      });
    }
  }
  for (const e of edges) {
    e.pts = [nodes[e.a].x, 0, nodes[e.a].z, nodes[e.b].x, 0, nodes[e.b].z];
  }
  const deg = nodes.map(() => 0);
  for (const e of edges) { deg[e.a]++; deg[e.b]++; }
  const signals = [];
  deg.forEach((d, i) => { if (d >= 3) signals.push(i); });
  return { nodes, edges, signals };
}

function hashClaim() {
  const cells = new Map();
  return (x, z, min) => {
    const ix = Math.floor(x / 8), iz = Math.floor(z / 8);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const bucket = cells.get(`${ix + dx},${iz + dz}`);
      if (!bucket) continue;
      for (const p of bucket) if ((p.x - x) ** 2 + (p.z - z) ** 2 < min * min) return false;
    }
    const key = `${ix},${iz}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push({ x, z });
    return true;
  };
}

function pushTree(list, claim, x, z, variant, scale, rot, state) {
  if (state.n >= state.cap) return;
  if (!claim(x, z, 6.5)) return;
  list.push(PROP.TREE, variant, rot, x, z, scale);
  state.n++;
}

function propsFromTiles(tiles, roads) {
  let existing = 0;
  for (const tile of tiles) for (const p of tile.props) if (p.kind === PROP.TREE) existing++;
  const rand = rnd(0x51b);
  const claim = hashClaim();
  const list = [];
  const state = { n: 0, cap: TREE_CAP };
  const skipTrees = existing >= 80;

  if (!skipTrees) for (const tile of tiles) {
    for (const rings of polysOf(tile.areas, [AREA.PARK, AREA.WOOD, AREA.ISLAND])) {
      const pts = rings[0];
      const area = areaOf(pts);
      if (area < 28) continue;
      const step = area > 4000 ? 9 : 7;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const p of pts) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      }
      for (let x = minX + step * 0.5; x < maxX && state.n < state.cap; x += step) {
        for (let z = minZ + step * 0.5; z < maxZ && state.n < state.cap; z += step) {
          const jx = x + (rand() - 0.5) * step * 0.55;
          const jz = z + (rand() - 0.5) * step * 0.55;
          if (!insidePoly(jx, jz, rings)) continue;
          const park = rand() < 0.15 ? 4 : rand() < 0.08 ? 5 : 2 + (rand() < 0.5 ? 0 : 1);
          pushTree(list, claim, jx, jz, park, 0.9 + rand() * 0.75, rand() * Math.PI * 2, state);
        }
      }
    }
  }

  if (!skipTrees) for (const tile of tiles) {
    for (const rings of polysOf(tile.areas, [AREA.SIDEWALK, AREA.PATH])) {
      const pts = rings[0];
      if (areaOf(pts) < 12 || pts.length < 4) continue;
      const c = centroid(pts);
      let carry = 5;
      for (let i = 0; i < pts.length && state.n < state.cap; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 0.4) continue;
        let walked = 0;
        while (carry <= len - walked && state.n < state.cap) {
          const t = (walked + carry) / len;
          const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          const dx = c.x - x, dz = c.z - z, dl = Math.hypot(dx, dz) || 1;
          pushTree(list, claim, x + (dx / dl) * 1.15, z + (dz / dl) * 1.15, rand() < 0.5 ? 0 : 1, 1.05 + rand() * 0.55, rand() * Math.PI * 2, state);
          walked += carry;
          carry = 8;
        }
        carry -= len - walked;
      }
    }
  }

  let parked = 0;
  if (!skipTrees) for (const tile of tiles) {
    for (const rings of polysOf(tile.areas, [AREA.PARKING])) {
      const pts = rings[0];
      if (areaOf(pts) < 50) continue;
      const ax = axis(pts);
      const ang = Math.atan2(ax.vx, ax.vz);
      const across = Math.min(ax.width * 0.5 - 1.4, 40);
      const along = ax.length * 0.5 - 1.6;
      if (across < 1 || along < 2) continue;
      for (let t = -along; t <= along && parked < PARKED_CAP; t += 4.6) {
        for (let u = -across; u <= across && parked < PARKED_CAP; u += 2.5) {
          const x = ax.c.x + ax.vx * t + -ax.vz * u;
          const z = ax.c.z + ax.vz * t + ax.vx * u;
          if (!insidePoly(x, z, rings)) continue;
          const type = rand() < 0.34 ? 0 : rand() < 0.6 ? 1 : 2;
          const color = Math.floor(rand() * 4);
          list.push(PROP.PARKED, type + color * 4, ang + (u > 0 ? Math.PI : 0), x, z, 1);
          parked++;
        }
      }
    }
  }

  let vend = 0;
  for (const tile of tiles) {
    for (const rings of polysOf(tile.areas, [AREA.SIDEWALK])) {
      const pts = rings[0];
      if (areaOf(pts) < 20 || pts.length < 4) continue;
      const c = centroid(pts);
      let carry = 9;
      for (let i = 0; i < pts.length && vend < 180; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 8) continue;
        let walked = 0;
        while (carry <= len - walked && vend < 180) {
          const t = (walked + carry) / len;
          const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          const dx = c.x - x, dz = c.z - z, dl = Math.hypot(dx, dz) || 1;
          const px = x + (dx / dl) * 0.7, pz = z + (dz / dl) * 0.7;
          if (claim(px, pz, 7)) {
            list.push(PROP.VENDING, Math.floor(rand() * 4), Math.atan2(-(dx / dl), -(dz / dl)), px, pz, 1);
            vend++;
          }
          walked += carry;
          carry = 22;
        }
        carry -= len - walked;
      }
    }
  }

  if (roads) {
    let signals = 0;
    for (const id of roads.signals) {
      if (signals >= 80) break;
      const node = roads.nodes[id];
      const edge = roads.edges.find((e) => e.a === id || e.b === id);
      const other = edge ? roads.nodes[edge.a === id ? edge.b : edge.a] : { x: node.x + 1, z: node.z };
      const ang = Math.atan2(other.x - node.x, other.z - node.z);
      const ox = node.x + Math.sin(ang + 1.15) * 8;
      const oz = node.z + Math.cos(ang + 1.15) * 8;
      if (!claim(ox, oz, 6)) continue;
      list.push(PROP.SIGNAL, 0, ang, ox, oz, 1);
      signals++;
    }
  }

  return list.length ? new Float32Array(list) : null;
}

export async function loadStreetLife(base, manifest) {
  const tiles = await Promise.all(manifest.tiles.map(async (info) => {
    const buf = await fetch(`${base}/${info.file}`).then((r) => r.arrayBuffer());
    return decodeTile(buf);
  }));
  const roads = roadsFromTiles(tiles);
  return { roads, props: propsFromTiles(tiles, roads) };
}
