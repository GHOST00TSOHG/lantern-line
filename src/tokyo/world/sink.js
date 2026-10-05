// Once a building is picked, every other building sinks into the ground.
// The one you picked stays. Roofs go with their building.


function facadeSink(mesh) {
  if (mesh.userData.sink) return mesh.userData.sink;
  const ends = mesh.userData.ends;
  const info = mesh.userData.info;
  const pos = mesh.geometry?.getAttribute("position");
  if (!ends || !info || !pos) return null;
  const orig = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i += 1) orig[i] = pos.getY(i);
  const boxes = [];
  let start = 0;
  for (let b = 0; b < info.length; b += 1) {
    const end = Math.min(ends[b] ?? start, pos.count);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const last = Math.max(start, end);
    for (let v = start; v < last; v += 1) {
      const x = pos.getX(v);
      const y = orig[v];
      const z = pos.getZ(v);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (last > start && maxY > -1e8) {
      boxes.push({
        x: (minX + maxX) * 0.5,
        z: (minZ + maxZ) * 0.5,
        hx: Math.max(0.6, (maxX - minX) * 0.5),
        hz: Math.max(0.6, (maxZ - minZ) * 0.5),
        top: maxY,
        base: minY,
        start,
        end: last,
        index: b,
        shown: 0,
      });
    }
    start = end;
  }
  if (start < pos.count) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let v = start; v < pos.count; v += 1) {
      const x = pos.getX(v);
      const y = orig[v];
      const z = pos.getZ(v);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (maxY > -1e8) {
      boxes.push({
        x: (minX + maxX) * 0.5,
        z: (minZ + maxZ) * 0.5,
        hx: Math.max(0.6, (maxX - minX) * 0.5),
        hz: Math.max(0.6, (maxZ - minZ) * 0.5),
        top: maxY,
        base: minY,
        start,
        end: pos.count,
        index: -1,
        shown: 0,
      });
    }
  }
  const sink = { kind: "facade", orig, boxes, pos };
  mesh.userData.sink = sink;
  return sink;
}

function roofSink(mesh, boxes) {
  if (mesh.userData.sink) return mesh.userData.sink;
  const pos = mesh.geometry?.getAttribute("position");
  if (!pos || !boxes?.length) return null;
  const orig = new Float32Array(pos.count);
  const group = new Int16Array(pos.count);
  group.fill(-1);
  for (let v = 0; v < pos.count; v += 1) {
    orig[v] = pos.getY(v);
    const x = pos.getX(v);
    const z = pos.getZ(v);
    let best = -1;
    let bestArea = Infinity;
    for (let g = 0; g < boxes.length; g += 1) {
      const b = boxes[g];
      if (Math.abs(x - b.x) > b.hx + 1.2 || Math.abs(z - b.z) > b.hz + 1.2) continue;
      const area = b.hx * b.hz;
      if (area < bestArea) {
        bestArea = area;
        best = g;
      }
    }
    group[v] = best;
  }
  const sink = { kind: "roof", orig, group, boxes, pos };
  mesh.userData.sink = sink;
  return sink;
}

function dropOf(box) {
  return Math.max(0.5, box.top - box.base) + 1.2;
}

function writeFacade(sink) {
  const { pos, orig, boxes } = sink;
  let dirty = false;
  for (let g = 0; g < boxes.length; g += 1) {
    const box = boxes[g];
    if (!box.moved) continue;
    dirty = true;
    for (let v = box.start; v < box.end; v += 1) pos.setY(v, orig[v] - box.shown);
  }
  if (dirty) pos.needsUpdate = true;
}

function writeRoof(sink, hero) {
  const { pos, orig, group, boxes } = sink;
  let dirty = false;
  const hx = hero.box;
  for (let v = 0; v < group.length; v += 1) {
    const g = group[v];
    if (g >= 0) {
      if (!boxes[g].moved) continue;
      dirty = true;
      pos.setY(v, orig[v] - boxes[g].shown);
      continue;
    }
    if (!hero.on) {
      if (pos.getY(v) === orig[v]) continue;
      dirty = true;
      pos.setY(v, orig[v]);
      continue;
    }
    const inside = hx && Math.abs(pos.getX(v) - hx.x) <= hx.hx + 0.4 && Math.abs(pos.getZ(v) - hx.z) <= hx.hz + 0.4;
    const y = inside ? orig[v] : orig[v] - 80;
    if (pos.getY(v) === y) continue;
    dirty = true;
    pos.setY(v, y);
  }
  if (dirty) pos.needsUpdate = true;
}

export function createSink(streamer) {
  const hero = { on: false, key: "", x: 0, z: 0, y: 0, hx: 8, hz: 8, top: 20, box: null };
  const held = new Set();

  function hold(keys) {
    held.clear();
    if (!keys) return;
    for (const key of keys) held.add(key);
  }

  function stays(box, tileKey) {
    if (box.keep) return true;
    if (tileKey && box.index >= 0 && held.has(`${tileKey}:${box.index}`)) return true;
    return Math.abs(box.x - hero.x) < 0.35 && Math.abs(box.z - hero.z) < 0.35;
  }

  function select(box, key) {
    if (hero.box && hero.box !== box) hero.box.keep = false;
    box.keep = true;
    hero.box = box;
    hero.on = true;
    hero.key = key;
    hero.x = box.x;
    hero.z = box.z;
    hero.y = box.base + (box.top - box.base) * 0.45;
    hero.hx = box.hx;
    hero.hz = box.hz;
    hero.top = box.top;
  }

  function clear() {
    if (hero.box) hero.box.keep = false;
    hero.box = null;
    hero.on = false;
    hero.key = "";
  }

  function tick(dt) {
    const ease = Math.min(1, dt * 6);
    for (const tile of streamer.tiles.values()) {
      const group = tile.group;
      if (!group) continue;
      const facades = [];
      const roofs = [];
      group.traverse((obj) => {
        if (obj.userData?.facade) facades.push(obj);
        else if (obj.userData?.roofPhoto) roofs.push(obj);
      });
      for (const facade of facades) {
        const tileKey = facade.userData.tile;
        const sink = facadeSink(facade);
        if (!sink) continue;
        let any = false;
        for (let g = 0; g < sink.boxes.length; g += 1) {
          const box = sink.boxes[g];
          const target = hero.on && !stays(box, tileKey) ? dropOf(box) : 0;
          let next = box.shown + (target - box.shown) * ease;
          if (Math.abs(next - target) < 0.05) next = target;
          box.moved = next !== box.shown;
          if (box.moved) {
            box.shown = next;
            any = true;
          }
        }
        if (!any) continue;
        writeFacade(sink);
        for (const roof of roofs) {
          const linked = roofSink(roof, sink.boxes);
          if (linked) writeRoof(linked, hero);
        }
        for (let g = 0; g < sink.boxes.length; g += 1) sink.boxes[g].moved = false;
      }
    }
  }

  function pick(x, z) {
    let best = null;
    let bestArea = Infinity;
    for (const tile of streamer.tiles.values()) {
      const group = tile.group;
      if (!group) continue;
      group.traverse((obj) => {
        if (obj.userData?.facade) facadeSink(obj);
        const boxes = obj.userData?.sink?.boxes;
        const tileKey = obj.userData?.tile;
        if (!boxes || !tileKey) return;
        for (let i = 0; i < boxes.length; i += 1) {
          const box = boxes[i];
          if (box.index < 0) continue;
          if (Math.abs(x - box.x) > box.hx || Math.abs(z - box.z) > box.hz) continue;
          const area = box.hx * box.hz;
          if (area < bestArea) {
            bestArea = area;
            best = { box, key: `${tileKey}:${box.index}` };
          }
        }
      });
    }
    return best;
  }

  return { hero, select, clear, tick, pick, hold };
}

export function buildingBox(mesh, index) {
  const sink = facadeSink(mesh);
  return sink?.boxes[index] ?? null;
}
