// @ts-nocheck
// Mounts the procedural Tokyo client (jeantimex/tokyo, MIT) inside a page element.
// Night is locked on. Bot houses are five real buildings; their service lines glow RGB while a bot works.
import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { makeProjection } from "./shared/geo.js";
import { createMaterials, shared } from "./world/materials.js";
import { loadTextures } from "./world/textures.js";
import { Streamer } from "./world/streamer.js";
import { Props, cableGeometry, cableMaterial } from "./world/props.js";
import { Signs } from "./world/signs.js";
import { buildRailways } from "./world/rails.js";
import { buildFlyovers } from "./world/flyovers.js";
import { loadStreetLife } from "./world/streetlife.js";
import { Traffic } from "./world/traffic.js";
import { buildStructures } from "./world/structures.js";
import { loadOrtho } from "./world/ortho.js";
import { Environment } from "./world/environment.js";
import { createBirds } from "./world/birds.js";
import { loadBackdrop } from "./world/backdrop.js";
import { LampLight, installLampLight, LAMP_LAYER, lampMaterial } from "./world/lamplight.js";
import { createRain } from "./world/rain.js";
import { buildInterior, disposeInterior } from "./world/interior.js";

installLampLight();

const AREA = "shibuya";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function catalog(scene) {
  const found = [];
  scene.traverse((obj) => {
    if (!obj.userData?.facade) return;
    const pos = obj.geometry?.getAttribute?.("position");
    const { info, ends } = obj.userData;
    if (!pos || !info || !ends) return;
    let start = 0;
    for (let i = 0; i < ends.length; i += 1) {
      const end = ends[i];
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let n = 0;
      let minY = 1e9;
      let maxY = -1e9;
      let minX = 1e9;
      let maxX = -1e9;
      let minZ = 1e9;
      let maxZb = -1e9;
      let maxZ = -1e9;
      let cx = 0;
      for (let v = start; v < end; v += 1) {
        const x = pos.getX(v);
        const y = pos.getY(v);
        const z = pos.getZ(v);
        sx += x;
        sy += y;
        sz += z;
        if (z > maxZ) {
          maxZ = z;
          cx = x;
        }
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZb = Math.max(maxZb, z);
        n += 1;
      }
      start = end;
      if (n < 24) continue;
      const h = maxY - minY;
      if (h < 6) continue;
      const [usage, storeys] = info[i];
      found.push({
        cx: sx / n,
        cz: sz / n,
        faceX: cx,
        minY,
        maxY,
        maxZ,
        minX,
        maxX,
        minZ,
        maxZb,
        h,
        usage,
        storeys: storeys || Math.max(2, Math.round(h / 3.2)),
      });
    }
  });
  return found;
}

function pickFive(list) {
  const mid = list.filter((b) => b.h >= 10 && b.h <= 55);
  const pool = (mid.length >= 5 ? mid : list).slice().sort((a, b) => a.cx - b.cx || a.cz - b.cz);
  if (pool.length < 5) return null;
  const used = new Set();
  const picks = [];
  for (let i = 0; i < 5; i += 1) {
    let idx = Math.min(pool.length - 1, Math.floor(((i + 0.5) * pool.length) / 5));
    while (used.has(idx) && idx + 1 < pool.length) idx += 1;
    used.add(idx);
    picks.push(pool[idx]);
  }
  return picks;
}

function wallToward(building, x, z) {
  let ax = Math.min(Math.max(x, building.minX), building.maxX);
  let az = Math.min(Math.max(z, building.minZ), building.maxZb);
  if (x >= building.minX && x <= building.maxX && z >= building.minZ && z <= building.maxZb) {
    const left = x - building.minX;
    const right = building.maxX - x;
    const south = z - building.minZ;
    const north = building.maxZb - z;
    const edge = Math.min(left, right, south, north);
    if (edge === left) ax = building.minX;
    else if (edge === right) ax = building.maxX;
    else if (edge === south) az = building.minZ;
    else az = building.maxZb;
  }
  const vx = x - ax;
  const vz = z - az;
  const len = Math.hypot(vx, vz) || 1;
  const y = building.maxY + 2.4;
  return new THREE.Vector3(ax + (vx / len) * 0.3, y, az + (vz / len) * 0.3);
}

function sagSamples(a, b) {
  const dist = a.distanceTo(b);
  const steps = Math.max(2, Math.min(8, Math.ceil(dist / 12)));
  const droop = Math.min(7, dist * 0.055);
  const pts = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const p = a.clone().lerp(b, t);
    p.y -= droop * 4 * t * (1 - t);
    pts.push(p);
  }
  return pts;
}

const NIGHT_SUN = new THREE.Vector3(0.15, -0.55, 0.25).normalize();
const DAY_SUN = new THREE.Vector3(0.35, 0.75, 0.2).normalize();
const NIGHT_MOON = new THREE.Vector3(-0.35, 0.72, -0.2).normalize();

function addScramble(scene, ground) {
  const y = ground(0, 0) + 0.4;
  const group = new THREE.Group();
  group.name = "scramble";
  const n = 64;
  const bytes = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const u = ((i + 0.5) / n) * 2 - 1;
      const v = ((j + 0.5) / n) * 2 - 1;
      const fall = Math.max(0, 1 - Math.hypot(u, v));
      const val = fall * fall * 255;
      bytes.set([val, val, val, 255], (j * n + i) * 4);
    }
  }
  const tex = new THREE.DataTexture(bytes, n, n);
  tex.needsUpdate = true;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  const warm = lampMaterial(tex);
  warm.color.setRGB(2.8, 1.9, 0.9);
  const cool = lampMaterial(tex);
  cool.color.setRGB(0.55, 0.95, 2.1);
  const disc = (mat, x, z, r) => {
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(r, 28), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.layers.set(LAMP_LAYER);
    group.add(mesh);
  };
  disc(warm, 0, 0, 52);
  disc(warm, 18, 14, 18);
  disc(cool, -16, -10, 16);
  disc(warm, 10, -70, 40);
  const paint = new THREE.MeshStandardMaterial({
    color: 0xf3f0e8,
    roughness: 0.5,
    emissive: new THREE.Color(0.45, 0.4, 0.28),
  });
  const bar = new THREE.BoxGeometry(0.5, 0.04, 7.5);
  for (const [x, z, rot] of [[0, 12, 0], [0, -12, 0], [12, 0, Math.PI / 2], [-12, 0, Math.PI / 2]]) {
    for (let i = -4; i <= 4; i += 1) {
      const mesh = new THREE.Mesh(bar, paint);
      const along = i * 1.05;
      mesh.position.set(x + (rot ? along : 0), y + 0.06, z + (rot ? 0 : along));
      mesh.rotation.y = rot;
      group.add(mesh);
    }
  }
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 9, 96, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffe6ae, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }),
  );
  shaft.position.set(0, y + 48, 0);
  group.add(shaft);
  scene.add(group);
}

export async function mountTokyo(container, gate) {
  if (gate?.dead) {
    return { focus() {}, street() {}, setWork() {}, destroy() {} };
  }
  const token = Symbol("tokyo");
  container.__tokyo = token;
  const alive = () => !gate?.dead && container.__tokyo === token;
  const canvas = el("canvas");
  canvas.className = "absolute inset-0 h-full w-full touch-none";
  canvas.setAttribute("aria-label", "Tokyo at night");
  const loader = el(
    "div",
    "pointer-events-none absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/20 bg-black/60 px-4 py-2 text-white",
  );
  const step = el("p", "text-xs tracking-wide", "Opening the city");
  const bar = el("div", "h-1 w-28 overflow-hidden rounded bg-white/20");
  const fill = el("div", "h-full w-0 bg-white");
  bar.append(fill);
  loader.append(step, bar);
  container.append(canvas, loader);

  const setStep = (fraction, label) => {
    fill.style.width = `${Math.round(fraction * 100)}%`;
    if (label) step.textContent = label;
    container.dataset.city = label || "";
  };

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 1, 60000);
  const controls = new MapControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.maxPolarAngle = THREE.MathUtils.degToRad(92);
  controls.minPolarAngle = THREE.MathUtils.degToRad(6);
  controls.minDistance = 1.4;
  controls.maxDistance = 900;
  controls.enableZoom = false;

  let stopped = false;
  let frameId = 0;
  let torn = false;
  let streamer = null;
  let atmosphere = null;
  let observer = null;
  let onWheel = null;
  const windowListeners = [];
  function shutdown() {
    if (torn) return;
    torn = true;
    stopped = true;
    cancelAnimationFrame(frameId);
    for (const worker of streamer?.workers ?? []) worker.terminate();
    observer?.disconnect();
    for (const item of windowListeners) window.removeEventListener(item.type, item.fn, item.opts);
    canvas.removeEventListener("wheel", onWheel);
    controls.dispose();
    atmosphere?.composer?.dispose();
    renderer.dispose();
    canvas.remove();
    loader.remove();
    if (container.__tokyo === token) {
      container.__tokyo = null;
      container.__lantern = null;
    }
  }
  function abandon() {
    shutdown();
    return { focus() {}, street() {}, setWork() {}, destroy() {} };
  }

  const env = new Environment(scene, renderer);
  renderer.shadowMap.enabled = false;
  env.sun.castShadow = false;
  const clockTime = {
    live: false,
    hour: 22,
    date() {
      const JST = 9 * 3600e3;
      const now = Date.now();
      const midnight = Math.floor((now + JST) / 864e5) * 864e5 - JST;
      return new Date(midnight + this.hour * 3600e3);
    },
  };

  setStep(0.05, "Textures");
  const materials = createMaterials(await loadTextures(renderer));
  if (!alive()) return abandon();
  const props = new Props();
  const signs = new Signs();
  streamer = new Streamer(scene, materials, props, signs, { base: `tiles/${AREA}`, radius: 8000 });
  setStep(0.12, "Terrain");
  const manifest = await streamer.init();
  if (!alive()) return abandon();
  for (const w of streamer.workers ?? []) {
    w.addEventListener("error", (event) => {
      const message = event.message || "Tile worker failed";
      setStep(0.2, message);
      console.error(message);
    });
  }
  const proj = makeProjection(manifest.origin.lon, manifest.origin.lat);
  {
    const b = manifest.bounds;
    const groundDiff = new THREE.TextureLoader().load("textures/ground/diff.jpg");
    const groundNor = new THREE.TextureLoader().load("textures/ground/nor.jpg");
    for (const tex of [groundDiff, groundNor]) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(700, 700);
      tex.anisotropy = 8;
    }
    groundDiff.colorSpace = THREE.SRGBColorSpace;
    const plain = new THREE.Mesh(
      new THREE.CircleGeometry(50000, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: 0xc4beB0,
        map: groundDiff,
        normalMap: groundNor,
        normalScale: new THREE.Vector2(1.3, 1.3),
        roughness: 0.94,
        metalness: 0,
      }),
    );
    plain.position.set((b.minX + b.maxX) / 2, manifest.terrain.min - 1, (b.minZ + b.maxZ) / 2);
    plain.receiveShadow = true;
    scene.add(plain);
    if (manifest.backdrop) {
      plain.position.y = -0.5;
      plain.material.color.set(0x163044);
      loadBackdrop(`tiles/${AREA}`, `ortho/${AREA}/backdrop`, manifest, proj, renderer).then((mesh) => scene.add(mesh));
    }
  }
  const birds = createBirds();
  scene.add(birds);
  const lampLight = new LampLight(renderer);
  // The volumetric atmosphere pass stays off: it blanks the star sky and stalls the picture.
  // Night is the engine's own sky, window lights and moonlight.
  loadOrtho(`ortho/${AREA}`, proj, manifest.bounds, renderer).then((ok) => {
    shared.uOrthoOn.value = ok ? 1 : 0;
  });
  const railways = await buildRailways(`tiles/${AREA}/${manifest.rails}`, (x, z) => streamer.ground(x, z), streamer.cover);
  if (!alive()) return abandon();
  scene.add(railways);
  scene.add(await buildFlyovers(`tiles/${AREA}/${manifest.roads}`, (x, z) => streamer.ground(x, z)));
  if (!alive()) return abandon();
  if (manifest.structures) scene.add(await buildStructures(`tiles/${AREA}/${manifest.structures}`, (x, z) => streamer.ground(x, z)));
  const roadData = await (await fetch(`tiles/${AREA}/${manifest.roads}`)).json();
  if (!alive()) return abandon();
  const life = await loadStreetLife(`tiles/${AREA}`, manifest);
  if (!alive()) return abandon();
  const roads = roadData.edges?.length ? roadData : life.roads;
  const traffic = roads.edges?.length ? new Traffic(roads, streamer.surface) : null;
  if (traffic) {
    traffic.headlights = 18;
    traffic.count = 420;
    scene.add(traffic.group);
  }
  addScramble(scene, (x, z) => streamer.ground(x, z));
  const rain = createRain(manifest.bounds);
  scene.add(rain.lines);
  let streetTrees = null;
  if (life.props) {
    streetTrees = props.build(life.props, new Float32Array(0), (x, z) => streamer.ground(x, z));
    streetTrees.near.visible = false;
    scene.add(streetTrees.group);
  }

  const midX = (manifest.bounds.minX + manifest.bounds.maxX) / 2;
  const midZ = (manifest.bounds.minZ + manifest.bounds.maxZ) / 2;
  const [cx, cz, , az] = (manifest.view || `${midX},${midZ},560,208,28`).split(",").map(Number);
  const heading = THREE.MathUtils.degToRad(az);
  const standX = cx + Math.sin(heading) * 16;
  const standZ = cz + Math.cos(heading) * 16;
  const standY = streamer.ground(standX, standZ) + 1.65;
  const lookY = streamer.ground(cx, cz) + 1.65;
  camera.position.set(standX, standY, standZ);
  controls.target.set(cx, lookY, cz);
  controls.update();
  const home = { target: controls.target.clone(), cam: camera.position.clone() };

  const linkGroup = new THREE.Group();
  scene.add(linkGroup);
  const cableMat = cableMaterial();
  const glows = [];
  const markers = [];
  let anchors = [];
  let service = null;
  let serviceAt = -1;
  let serviceTries = 0;

  function buildLinks(list) {
    linkGroup.clear();
    glows.length = 0;
    markers.length = 0;
    const ordered = list.map((building, index) => ({ building, index }));
    ordered.sort((p, q) => p.building.cx - q.building.cx || p.building.cz - q.building.cz);
    const heads = ordered.map(({ building }) => wallToward(building, building.cx, building.maxZb + 12));
    const curves = [];
    heads.forEach((head) => {
      const entry = head.clone();
      entry.y -= 3.8;
      curves.push([head, entry]);
      const drop = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([head, entry]),
        new THREE.LineBasicMaterial({ color: 0xffd28a }),
      );
      drop.frustumCulled = false;
      linkGroup.add(drop);
    });
    for (let i = 0; i < heads.length - 1; i += 1) curves.push(sagSamples(heads[i], heads[i + 1]));
    linkGroup.add(new THREE.Mesh(cableGeometry(curves, 0.12), cableMat));
    for (let i = 0; i < heads.length - 1; i += 1) {
      const samples = sagSamples(heads[i], heads[i + 1]);
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0xff3355,
        transparent: true,
        opacity: 0.92,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const glow = new THREE.Mesh(cableGeometry([samples], 0.42), glowMat);
      glow.visible = false;
      linkGroup.add(glow);
      const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 8), glowMat.clone());
      pulse.visible = false;
      linkGroup.add(pulse);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(samples), new THREE.LineBasicMaterial({ color: 0xffd28a }));
      line.frustumCulled = false;
      linkGroup.add(line);
      glows.push({ glow, pulse, line, samples, a: ordered[i].index, b: ordered[i + 1].index });
    }
    ordered.forEach(({ building, index }, order) => {
      const mark = new THREE.Mesh(
        new THREE.PlaneGeometry(2.6, 3.6),
        new THREE.MeshBasicMaterial({
          color: 0xffd7a8,
          transparent: true,
          opacity: 0.9,
          toneMapped: false,
          side: THREE.DoubleSide,
        }),
      );
      mark.visible = false;
      mark.position.copy(heads[order]);
      mark.position.y -= 0.4;
      linkGroup.add(mark);
      markers[index] = mark;
    });
  }

  function rebuildService() {
    const buildings = catalog(scene);
    if (buildings.length < 8) return;
    const cell = 48;
    const grid = new Map();
    for (const building of buildings) {
      const key = `${Math.floor(building.cx / cell)}:${Math.floor(building.cz / cell)}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(building);
      else grid.set(key, [building]);
    }
    const poles = [];
    const basis = new THREE.Matrix4();
    const at = new THREE.Vector3();
    scene.traverse((obj) => {
      if (obj.userData?.role !== "pole" || !obj.isInstancedMesh) return;
      for (let i = 0; i < obj.count; i += 1) {
        obj.getMatrixAt(i, basis);
        at.setFromMatrixPosition(basis);
        poles.push(at.x, at.y, at.z);
      }
    });
    const curves = [];
    const linePos = [];
    for (let i = 0; i < poles.length; i += 3) {
      const x = poles[i];
      const y = poles[i + 1];
      const z = poles[i + 2];
      let best = null;
      let bestD = 70 * 70;
      const gx = Math.floor(x / cell);
      const gz = Math.floor(z / cell);
      for (let dx = -2; dx <= 2; dx += 1) {
        for (let dz = -2; dz <= 2; dz += 1) {
          const list = grid.get(`${gx + dx}:${gz + dz}`);
          if (!list) continue;
          for (const building of list) {
            const d = (building.cx - x) ** 2 + (building.cz - z) ** 2;
            if (d < bestD && d > 9) {
              bestD = d;
              best = building;
            }
          }
        }
      }
      if (!best) continue;
      const top = new THREE.Vector3(x, y + 9.55, z);
      const attach = wallToward(best, x, z);
      if (top.distanceTo(attach) > 72) continue;
      const samples = sagSamples(top, attach);
      curves.push(samples);
      for (let k = 0; k < samples.length - 1; k += 1) {
        linePos.push(samples[k].x, samples[k].y, samples[k].z, samples[k + 1].x, samples[k + 1].y, samples[k + 1].z);
      }
    }
    if (service) {
      scene.remove(service);
      service.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
      });
    }
    service = new THREE.Group();
    if (curves.length) service.add(new THREE.Mesh(cableGeometry(curves, 0.04), cableMat));
    if (linePos.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(linePos, 3));
      service.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x14161a })));
    }
    scene.add(service);
  }

  const jobs = [];
  let focusReq = null;
  const fly = {
    on: false,
    room: false,
    t: 0,
    fromCam: new THREE.Vector3(),
    fromTarget: new THREE.Vector3(),
    midCam: new THREE.Vector3(),
    midTarget: new THREE.Vector3(),
    toCam: new THREE.Vector3(),
    toTarget: new THREE.Vector3(),
    poseCam: new THREE.Vector3(),
    poseTarget: new THREE.Vector3(),
  };

  function focus(building, slot = 0) {
    focusReq = { building, slot };
    const b = anchors[building];
    if (!b) return;
    const floors = Math.max(2, b.storeys || 4);
    const y = THREE.MathUtils.clamp(b.minY + ((slot + 0.65) / floors) * b.h, b.minY + 1.5, b.maxY - 0.8);
    fly.fromCam.copy(camera.position);
    fly.fromTarget.copy(controls.target);
    fly.toTarget.set(b.faceX, y, b.maxZ + 0.4);
    fly.toCam.set(b.faceX + 2.5, y + 1.4, b.maxZ + 18);
    fly.room = false;
    fly.t = 0;
    fly.on = true;
    if (markers[building]) markers[building].position.set(b.faceX, y, b.maxZ + 0.45);
  }

  function street() {
    focusReq = null;
    insideRoom = false;
    if (container) container.dataset.inside = "0";
    camera.near = 1;
    camera.updateProjectionMatrix();
    controls.minDistance = 1.4;
    controls.maxDistance = 900;
    controls.minPolarAngle = THREE.MathUtils.degToRad(6);
    controls.maxPolarAngle = THREE.MathUtils.degToRad(92);
    fly.fromCam.copy(camera.position);
    fly.fromTarget.copy(controls.target);
    fly.toCam.copy(home.cam);
    fly.toTarget.copy(home.target);
    fly.room = false;
    fly.t = 0;
    fly.on = true;
  }

  const keys = new Set();
  const MOVE = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyQ", "KeyE"]);
  const onKeyDown = (e) => {
    const typing = document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA";
    if (typing) return;
    if (MOVE.has(e.code)) {
      e.preventDefault();
      fly.on = false;
      focusReq = null;
    }
    if (e.code === "KeyN") clockTime.hour = env.dark > 0.5 ? 12 : 22;
    keys.add(e.code);
  };
  const onKeyUp = (e) => keys.delete(e.code);
  const onBlur = () => keys.clear();
  window.addEventListener("keydown", onKeyDown, { capture: true });
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  windowListeners.push(
    { type: "keydown", fn: onKeyDown, opts: { capture: true } },
    { type: "keyup", fn: onKeyUp },
    { type: "blur", fn: onBlur },
  );
  controls.addEventListener("start", () => {
    fly.on = false;
    focusReq = null;
  });

  const zoom = { pending: 0, pivot: new THREE.Vector3(), ray: new THREE.Raycaster(), plane: new THREE.Plane() };
  onWheel = (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const notches = (e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY) / 100;
    zoom.pending = THREE.MathUtils.clamp(zoom.pending + notches * 0.28, -2.4, 2.4);
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    zoom.ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
    zoom.plane.set(THREE.Object3D.DEFAULT_UP, -controls.target.y);
    const hit = zoom.ray.ray.intersectPlane(zoom.plane, new THREE.Vector3());
    zoom.pivot.copy(hit && hit.distanceTo(controls.target) < camera.position.distanceTo(controls.target) * 3 ? hit : controls.target);
    fly.on = false;
  };
  canvas.addEventListener("wheel", onWheel, { passive: false });

  const roomMark = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xffe2a8 }),
  );
  roomMark.visible = false;
  scene.add(roomMark);
  let interior = null;
  let insideRoom = false;
  let roomHold = null;
  let panCursor = null;
  let pinchGap = 0;

  function clientPoint(event) {
    return { x: event.clientX ?? event.pageX ?? 0, y: event.clientY ?? event.pageY ?? 0 };
  }

  function otherClient(event) {
    const other = controls._getSecondPointerPosition(event);
    const ox = (event.pageX ?? event.clientX ?? 0) - (event.clientX ?? event.pageX ?? 0);
    const oy = (event.pageY ?? event.clientY ?? 0) - (event.clientY ?? event.pageY ?? 0);
    return { x: other.x - ox, y: other.y - oy };
  }

  function beginDrag(x, y) {
    panCursor = { x, y };
  }

  function dragSelf(x, y) {
    if (insideRoom || !panCursor) {
      panCursor = { x, y };
      return;
    }
    const mx = x - panCursor.x;
    const my = y - panCursor.y;
    panCursor = { x, y };
    if (mx === 0 && my === 0) return;
    const rect = canvas.getBoundingClientRect();
    const span = THREE.MathUtils.clamp(camera.position.distanceTo(controls.target), 4, 420);
    const meters = (2 * span * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5)) / Math.max(1, rect.height);
    const forward = new THREE.Vector3().subVectors(controls.target, camera.position);
    forward.y = 0;
    if (forward.lengthSq() < 1e-4) forward.set(0, 0, -1);
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, THREE.Object3D.DEFAULT_UP).normalize();
    const move = right.multiplyScalar(-mx * meters).addScaledVector(forward, my * meters);
    controls.target.add(move);
    camera.position.add(move);
    fly.on = false;
    focusReq = null;
  }

  controls.touches.TWO = 2;
  const origRotate = controls._handleMouseMoveRotate.bind(controls);
  controls._handleMouseMoveRotate = (event) => {
    if (!insideRoom) {
      origRotate(event);
      return;
    }
    const dx = event.clientX - controls._rotateStart.x;
    const dy = event.clientY - controls._rotateStart.y;
    controls._rotateStart.set(event.clientX, event.clientY);
    const offset = new THREE.Vector3().subVectors(controls.target, camera.position);
    offset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, -dx * 0.005);
    const right = new THREE.Vector3().crossVectors(offset, THREE.Object3D.DEFAULT_UP);
    if (right.lengthSq() > 1e-6) {
      right.normalize();
      offset.applyAxisAngle(right, -dy * 0.004);
    }
    const len = Math.max(0.6, offset.length());
    offset.y = THREE.MathUtils.clamp(offset.y, -len * 0.55, len * 0.72);
    controls.target.copy(camera.position).add(offset);
  };
  controls._handleMouseDownPan = (event) => {
    const p = clientPoint(event);
    beginDrag(p.x, p.y);
  };
  controls._handleMouseMovePan = (event) => {
    const p = clientPoint(event);
    dragSelf(p.x, p.y);
  };
  controls._handleTouchStartPan = (event) => {
    const p = clientPoint(event);
    beginDrag(p.x, p.y);
  };
  controls._handleTouchMovePan = (event) => {
    const p = clientPoint(event);
    dragSelf(p.x, p.y);
  };
  controls._handleTouchStartDollyPan = (event) => {
    const a = clientPoint(event);
    const b = otherClient(event);
    pinchGap = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    beginDrag((a.x + b.x) / 2, (a.y + b.y) / 2);
  };
  controls._handleTouchMoveDollyPan = (event) => {
    const a = clientPoint(event);
    const b = otherClient(event);
    const gap = Math.hypot(a.x - b.x, a.y - b.y) || pinchGap;
    const spread = gap / pinchGap;
    zoom.pending = THREE.MathUtils.clamp(zoom.pending - Math.log(spread) * 1.7, -2.4, 2.4);
    pinchGap = gap;
    dragSelf((a.x + b.x) / 2, (a.y + b.y) / 2);
  };

  let pointerDown = null;
  let activePointers = 0;
  const onPointerDown = (event) => {
    activePointers += 1;
    if (event.button !== 0) return;
    pointerDown = { x: event.clientX, y: event.clientY, n: activePointers };
  };
  const onPointerUp = (event) => {
    activePointers = Math.max(0, activePointers - 1);
    if (!pointerDown || event.button !== 0) return;
    const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
    const multi = pointerDown.n > 1 || activePointers > 0;
    pointerDown = null;
    if (moved > 6 || multi) return;
    const rect = canvas.getBoundingClientRect();
    const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    zoom.ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
    const hits = zoom.ray.intersectObjects(scene.children, true);
    if (hits[0]?.object?.userData?.interior) return;
    const hit = hits.find((item) => item.object.userData?.facade && item.face);
    if (!hit) return;
    const built = streamer.buildingAt(hit);
    if (!built) return;
    const floors = Math.max(1, built.storeys || Math.round((built.height || 1) / 3.2));
    const span = Math.max(built.height || 3, 2.4);
    const floorH = span / floors;
    const along = hit.point.y - (built.base || 0);
    const slot = Math.max(0, Math.min(floors - 1, Math.floor(along / floorH)));
    const outward = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    let floorY = (built.base || hit.point.y - 1.2) + slot * floorH;
    if (outward.y > 0.45) {
      floorY = Math.max(built.base || 0, hit.point.y - floorH);
      outward.copy(camera.position).sub(hit.point);
      outward.y = 0;
      if (outward.lengthSq() < 0.01) outward.set(0, 0, 1);
      outward.normalize();
    }
    const pick = {
      key: `${built.tile}:${built.index}`,
      slot,
      x: hit.point.x,
      y: hit.point.y,
      z: hit.point.z,
      floorY,
    };
    if (interior) {
      scene.remove(interior);
      disposeInterior(interior);
    }
    const room = buildInterior(pick, outward);
    interior = room.group;
    scene.add(interior);
    insideRoom = true;
    roomHold = {
      origin: room.group.position.clone(),
      quat: room.group.quaternion.clone(),
      inv: room.group.quaternion.clone().invert(),
      span: room.span,
    };
    container.dataset.inside = "1";
    camera.near = 0.08;
    camera.updateProjectionMatrix();
    controls.minDistance = 0.3;
    controls.maxDistance = 8;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = Math.PI * 0.92;
    roomMark.visible = false;
    fly.fromCam.copy(camera.position);
    fly.fromTarget.copy(controls.target);
    fly.midCam.set(pick.x, pick.floorY + 1.6, pick.z).addScaledVector(outward, 2.6);
    fly.midTarget.set(pick.x, pick.floorY + 1.35, pick.z);
    fly.toTarget.copy(room.look);
    fly.toCam.copy(room.eye);
    fly.room = true;
    fly.t = 0;
    fly.on = true;
    focusReq = { building: -1, slot };
    container.__onWindow?.(pick);
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);

  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    atmosphere?.setSize(w, h);
  }
  resize();
  observer = new ResizeObserver(() => resize());
  observer.observe(container);

  const clock = new THREE.Clock();
  let loading = true;

  function frame() {
    if (stopped) return;
    frameId = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    renderer.info.reset();

    const f = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const strafe = (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0);
    const turn = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const rise = (keys.has("KeyE") ? 1 : 0) - (keys.has("KeyQ") ? 1 : 0);
    if ((f || strafe || turn || rise) && !fly.on) {
      const dist = Math.max(1.4, camera.position.distanceTo(controls.target));
      const fast = keys.has("ShiftLeft") || keys.has("ShiftRight");
      if (turn && insideRoom) {
        const offset = new THREE.Vector3().subVectors(controls.target, camera.position);
        offset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, -turn * (fast ? 2.1 : 1.15) * dt);
        controls.target.copy(camera.position).add(offset);
      } else if (turn) {
        const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
        offset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, turn * (fast ? 2.4 : 1.2) * dt);
        camera.position.copy(controls.target).add(offset);
      }
      if (rise && !insideRoom) {
        const step = (fast ? 28 : 10) * dt * THREE.MathUtils.clamp(dist / 18, 0.6, 8);
        controls.target.y += rise * step;
        camera.position.y += rise * step;
      }
      if (f || strafe) {
        const fwd = new THREE.Vector3().subVectors(controls.target, camera.position).setY(0).normalize();
        const right = new THREE.Vector3().crossVectors(fwd, THREE.Object3D.DEFAULT_UP);
        const speed = insideRoom ? (fast ? 4.2 : 2.1) : THREE.MathUtils.clamp(dist * 1.2, 3.5, 320) * (fast ? 2.4 : 1);
        const move = fwd.multiplyScalar(f).addScaledVector(right, strafe);
        if (move.lengthSq() > 0) {
          move.normalize().multiplyScalar(speed * dt);
          controls.target.add(move);
          camera.position.add(move);
        }
      }
    }
    if (Math.abs(zoom.pending) > 1e-4 && !fly.on) {
      const stepAmt = zoom.pending * (1 - Math.exp(-dt * 11));
      zoom.pending -= stepAmt;
      const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
      const distNow = Math.max(0.4, offset.length());
      const distNext = THREE.MathUtils.clamp(distNow * Math.exp(stepAmt), controls.minDistance, controls.maxDistance);
      offset.multiplyScalar(distNext / distNow);
      if (!insideRoom && stepAmt > 0) offset.y = THREE.MathUtils.lerp(offset.y, distNext * 0.46, 0.5);
      if (!insideRoom && stepAmt < 0 && distNext < 22) offset.y = THREE.MathUtils.lerp(offset.y, 0.35, 0.4);
      camera.position.copy(controls.target).add(offset);
    }

    if (fly.on) {
      const rate = fly.room ? 0.42 : 0.7;
      fly.t = Math.min(1, fly.t + dt * rate);
      const s = fly.t;
      const k = s * s * s * (s * (s * 6 - 15) + 10);
      if (fly.room) {
        if (k < 0.55) {
          const u = k / 0.55;
          const e = u * u * (3 - 2 * u);
          fly.poseTarget.lerpVectors(fly.fromTarget, fly.midTarget, e);
          fly.poseCam.lerpVectors(fly.fromCam, fly.midCam, e);
        } else {
          const u = (k - 0.55) / 0.45;
          const e = u * u * (3 - 2 * u);
          fly.poseTarget.lerpVectors(fly.midTarget, fly.toTarget, e);
          fly.poseCam.lerpVectors(fly.midCam, fly.toCam, e);
        }
      } else {
        fly.poseTarget.lerpVectors(fly.fromTarget, fly.toTarget, k);
        fly.poseCam.lerpVectors(fly.fromCam, fly.toCam, k);
      }
      controls.target.copy(fly.poseTarget);
      camera.position.copy(fly.poseCam);
    } else if (!focusReq && !insideRoom) {
      const dist = camera.position.distanceTo(controls.target);
      if (dist < 26) {
        const next = streamer.ground(controls.target.x, controls.target.z) + 1.6;
        camera.position.y += next - controls.target.y;
        controls.target.y = next;
      }
    }
    camera.lookAt(controls.target);
    controls.update();
    if (fly.on) {
      controls.target.copy(fly.poseTarget);
      camera.position.copy(fly.poseCam);
      camera.lookAt(controls.target);
      if (fly.t >= 1) fly.on = false;
    } else if (insideRoom && roomHold) {
      const look = new THREE.Vector3().subVectors(controls.target, camera.position);
      const local = camera.position.clone().sub(roomHold.origin).applyQuaternion(roomHold.inv);
      const box = roomHold.span;
      const forward = keys.has("KeyW") || keys.has("ArrowUp");
      const throughWindow = forward && local.z > box.maxZ && Math.abs(local.x) < 1.15 && local.y > 0.55 && local.y < 2.15;
      if (throughWindow) {
        const out = new THREE.Vector3(0, 1.6, 1.5).applyQuaternion(roomHold.quat).add(roomHold.origin);
        const ahead = new THREE.Vector3(0, 1.45, 8).applyQuaternion(roomHold.quat).add(roomHold.origin);
        camera.position.copy(out);
        controls.target.copy(ahead);
        insideRoom = false;
        roomHold = null;
        if (container) container.dataset.inside = "0";
        camera.near = 1;
        camera.updateProjectionMatrix();
        controls.minDistance = 1.4;
        controls.maxDistance = 900;
        controls.minPolarAngle = THREE.MathUtils.degToRad(6);
        controls.maxPolarAngle = THREE.MathUtils.degToRad(92);
      } else {
        local.x = THREE.MathUtils.clamp(local.x, box.minX, box.maxX);
        local.y = THREE.MathUtils.clamp(local.y, box.minY, box.maxY);
        local.z = THREE.MathUtils.clamp(local.z, box.minZ, box.maxZ);
        const world = local.applyQuaternion(roomHold.quat).add(roomHold.origin);
        const shift = world.clone().sub(camera.position);
        camera.position.copy(world);
        controls.target.copy(camera.position).add(look);
        if (shift.lengthSq() > 1e-8 && look.lengthSq() < 1e-6) controls.target.add(shift);
      }
    } else if (!insideRoom) {
      const floor = streamer.ground(camera.position.x, camera.position.z) + 1.35;
      if (camera.position.y < floor) camera.position.y = floor;
    }

    streamer.update(controls.target, camera.position);
    if (loading) {
      const size = manifest.tileSize;
      const wanted = manifest.tiles.filter((tile) => Math.hypot((tile.x + 0.5) * size - controls.target.x, (tile.z + 0.5) * size - controls.target.z) <= 900).length || 1;
      const got = Math.min(1, streamer.stats.loaded / wanted);
      setStep(0.2 + 0.75 * got, `City tiles ${streamer.stats.loaded} / ${manifest.tiles.length}`);
      if (streamer.stats.loaded >= Math.min(8, manifest.tiles.length)) {
        loading = false;
        loader.style.opacity = "0";
      }
    }
    if (!anchors.length && streamer.stats.loaded >= Math.min(12, manifest.tiles.length)) {
      const picks = pickFive(catalog(scene));
      if (picks) {
        anchors = picks;
        buildLinks(picks);
        container.dataset.houses = String(picks.length);
        if (focusReq) focus(focusReq.building, focusReq.slot);
      }
    }

    if (serviceTries < 3 && streamer.stats.loaded >= 10 && streamer.stats.loaded - serviceAt >= 8) {
      rebuildService();
      serviceAt = streamer.stats.loaded;
      serviceTries += 1;
    }

    props.update(dt);
    if (birds.geometry.instanceCount) birds.userData.update(dt, controls.target, camera, streamer);
    signs.update();
    railways.userData.trains.update(dt, env.night);
    if (traffic?.group.parent) traffic.update(dt, controls.target);
    if (streetTrees) {
      const close = camera.position.distanceTo(controls.target) < 900;
      streetTrees.near.visible = close;
      streetTrees.far.visible = !close;
    }
    const night = clockTime.hour < 6 || clockTime.hour >= 18;
    env.setSky(night ? NIGHT_SUN : DAY_SUN, NIGHT_MOON);
    env.update(dt);
    env.follow(controls.target, camera);
    lampLight.update(scene, controls.target, camera.position, env.night);
    shared.uWet.value = env.night;
    rain.update(shared.uWet.value, shared.uTime.value);
    for (let i = 0; i < 5; i += 1) {
      const bot = shared.uBots.value[i];
      const house = anchors[i];
      const job = jobs[i];
      if (!house) {
        bot.set(0, 0, 0, 0);
        continue;
      }
      const floors = Math.max(2, house.storeys || 4);
      const slot = job?.slot || 0;
      const y = THREE.MathUtils.clamp(house.minY + ((slot + 0.65) / floors) * house.h, house.minY + 1.5, house.maxY - 0.8);
      bot.set(house.cx, y, house.cz, job?.working ? 1 : 0);
    }

    for (let i = 0; i < markers.length; i += 1) {
      const mark = markers[i];
      if (!mark) continue;
      const on = Boolean(jobs[i]?.working);
      mark.visible = on || focusReq?.building === i;
      if (!on) continue;
      mark.material.color.setHSL((t * 0.33 + i * 0.2) % 1, 0.75, 0.62);
      mark.material.opacity = 0.55 + Math.sin(t * 3 + i) * 0.2;
    }
    for (const item of glows) {
      const on = Boolean(jobs[item.a]?.working || jobs[item.b]?.working);
      item.glow.visible = on;
      item.pulse.visible = on;
      if (!on) {
        item.line.material.color.set(0xffd28a);
        continue;
      }
      const hue = (t * 0.33 + item.a * 0.2) % 1;
      item.glow.material.color.setHSL(hue, 1, 0.55);
      item.pulse.material.color.setHSL((hue + 0.33) % 1, 1, 0.6);
      item.line.material.color.setHSL(hue, 0.85, 0.55);
      const along = (t * 0.35 + item.a * 0.13) % 1;
      const step = Math.min(item.samples.length - 1, Math.floor(along * (item.samples.length - 1)));
      item.pulse.position.copy(item.samples[step]);
    }
    renderer.render(scene, camera);
  }
  frame();

  const api = {
    focus,
    street,
    setWork(next) {
      jobs.length = 0;
      if (Array.isArray(next)) jobs.push(...next);
    },
    destroy() {
      shutdown();
    },
  };
  container.__lantern = api;
  return api;
}
