import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { SceneModel, SceneRoom } from "@/lib/city-types";

type SlotCell = { slot: number; col: number; floor: number };
type Placement = {
  x: number;
  z: number;
  w: number;
  h: number;
  d: number;
  kind: "brick" | "concrete";
  floors: number;
  cols: number;
  slots: SlotCell[];
};

const PLACEMENTS: Placement[] = [
  {
    x: -6.7,
    z: 0.2,
    w: 5.5,
    h: 8.1,
    d: 2.7,
    kind: "brick",
    floors: 5,
    cols: 4,
    slots: [
      { slot: 0, col: 0, floor: 1 },
      { slot: 1, col: 2, floor: 1 },
      { slot: 2, col: 1, floor: 2 },
      { slot: 3, col: 3, floor: 3 },
      { slot: 4, col: 0, floor: 4 },
      { slot: 5, col: 2, floor: 4 },
    ],
  },
  {
    x: 6.55,
    z: 0.15,
    w: 5.7,
    h: 7.15,
    d: 2.75,
    kind: "concrete",
    floors: 4,
    cols: 4,
    slots: [
      { slot: 0, col: 0, floor: 0 },
      { slot: 1, col: 2, floor: 0 },
      { slot: 2, col: 1, floor: 1 },
      { slot: 3, col: 3, floor: 2 },
      { slot: 4, col: 0, floor: 3 },
      { slot: 5, col: 2, floor: 3 },
    ],
  },
  {
    x: -2.4,
    z: -3.55,
    w: 2.25,
    h: 5.5,
    d: 2.25,
    kind: "brick",
    floors: 4,
    cols: 2,
    slots: [
      { slot: 0, col: 0, floor: 0 },
      { slot: 1, col: 1, floor: 0 },
      { slot: 2, col: 0, floor: 1 },
      { slot: 3, col: 1, floor: 2 },
      { slot: 4, col: 0, floor: 3 },
      { slot: 5, col: 1, floor: 3 },
    ],
  },
  {
    x: 0.2,
    z: -4.15,
    w: 2.15,
    h: 6.7,
    d: 2.2,
    kind: "concrete",
    floors: 5,
    cols: 2,
    slots: [
      { slot: 0, col: 0, floor: 1 },
      { slot: 1, col: 1, floor: 1 },
      { slot: 2, col: 0, floor: 2 },
      { slot: 3, col: 1, floor: 3 },
      { slot: 4, col: 0, floor: 4 },
      { slot: 5, col: 1, floor: 4 },
    ],
  },
  {
    x: 2.65,
    z: -3.4,
    w: 2.3,
    h: 5.15,
    d: 2.2,
    kind: "brick",
    floors: 4,
    cols: 2,
    slots: [
      { slot: 0, col: 0, floor: 0 },
      { slot: 1, col: 1, floor: 1 },
      { slot: 2, col: 0, floor: 2 },
      { slot: 3, col: 1, floor: 2 },
      { slot: 4, col: 0, floor: 3 },
      { slot: 5, col: 1, floor: 3 },
    ],
  },
];

const POLES = [
  { x: -11.8, z: 2.55 },
  { x: -3.85, z: 2.7 },
  { x: 4.45, z: 2.62 },
  { x: 12.05, z: 2.5 },
];

type RoomMesh = {
  building: number;
  slot: number;
  fill: THREE.Mesh;
  glow: THREE.Mesh;
  reflection: THREE.Mesh;
  alive: number;
  phase: number;
};

type AmbientWin = { fill: THREE.Mesh; phase: number; base: number };
type DropLine = {
  building: number;
  curve: THREE.CatmullRomCurve3;
  wireT: number;
  glow: THREE.Mesh;
  pulses: THREE.Mesh[];
};

function hash(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function canvasTexture(draw: (ctx: CanvasRenderingContext2D, size: number) => void, size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function radialTexture() {
  return canvasTexture((g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.4, "rgba(255,255,255,0.45)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  });
}

function towerTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 512;
  const g = canvas.getContext("2d");
  if (!g) return new THREE.CanvasTexture(canvas);
  g.fillStyle = "#07090d";
  g.fillRect(0, 0, 256, 512);
  const cols = 8;
  const rows = 18;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const n = hash(x * 19 + y * 53);
      const on = n > 0.46;
      const warm = hash(x * 7 + y * 13) > 0.62;
      g.fillStyle = on ? (warm ? "#f0c48a" : "#b7c7d6") : "#10151c";
      g.globalAlpha = on ? 0.28 + hash(x + y * 3) * 0.72 : 1;
      g.fillRect(10 + x * 31, 12 + y * 27, 16, 14);
      g.globalAlpha = 1;
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function loadRepeat(loader: THREE.TextureLoader, url: string, anisotropy: number) {
  const tex = loader.load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  return tex;
}

function windowCenter(p: Placement, col: number, floor: number) {
  const marginX = p.w * 0.1;
  const pitchX = (p.w - marginX * 2) / p.cols;
  const bottom = p.h * 0.12;
  const top = p.h * 0.9;
  const pitchY = (top - bottom) / p.floors;
  return {
    x: -p.w / 2 + marginX + pitchX * (col + 0.5),
    y: bottom + pitchY * (floor + 0.56),
    ww: pitchX * 0.62,
    hh: Math.min(pitchY * 0.58, 1.15),
  };
}

function addMullion(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  mat: THREE.Material,
) {
  const t = Math.min(0.045, w * 0.08);
  const bars: [number, number, number, number][] = [
    [w + t, t, x, y + h / 2],
    [w + t, t, x, y - h / 2],
    [t, h + t, x - w / 2, y],
    [t, h + t, x + w / 2, y],
  ];
  for (const [bw, bh, px, py] of bars) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.045), mat);
    bar.position.set(px, py, z);
    parent.add(bar);
  }
}

function spanCurve(y: number, sag: number) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < POLES.length - 1; i += 1) {
    const a = POLES[i]!;
    const b = POLES[i + 1]!;
    pts.push(new THREE.Vector3(a.x, y, a.z));
    pts.push(new THREE.Vector3((a.x + b.x) / 2, y - sag, (a.z + b.z) / 2 + 0.08));
  }
  const last = POLES[POLES.length - 1]!;
  pts.push(new THREE.Vector3(last.x, y, last.z));
  return new THREE.CatmullRomCurve3(pts);
}

function closestT(curve: THREE.CatmullRomCurve3, x: number) {
  let best = 0.5;
  let bestD = 1e9;
  for (let i = 0; i <= 48; i += 1) {
    const t = i / 48;
    const d = Math.abs(curve.getPoint(t).x - x);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

function tube(curve: THREE.CatmullRomCurve3, radius: number, mat: THREE.Material, segments = 72) {
  return new THREE.Mesh(new THREE.TubeGeometry(curve, segments, radius, 6, false), mat);
}

export function NightCity({
  model,
  onPick,
}: {
  model: SceneModel;
  onPick: (building: number, slot: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modelRef = useRef(model);
  const pickRef = useRef(onPick);
  modelRef.current = model;
  pickRef.current = onPick;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const surface = canvas;
    const renderer = new THREE.WebGLRenderer({
      canvas: surface,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    if (!renderer.getContext()) return;
    renderer.setClearColor(0x070b14, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0b1220, 28, 62);
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 120);
    const timer = new THREE.Timer();
    timer.connect(document);

    scene.add(new THREE.AmbientLight(0xb9c7d8, 0.28));
    scene.add(new THREE.HemisphereLight(0xc9d7ea, 0x2a241c, 0.42));
    const moonLight = new THREE.DirectionalLight(0xe4ecff, 1.35);
    moonLight.position.set(12, 20, 9);
    moonLight.castShadow = true;
    moonLight.shadow.mapSize.set(1024, 1024);
    moonLight.shadow.camera.near = 2;
    moonLight.shadow.camera.far = 48;
    moonLight.shadow.camera.left = -18;
    moonLight.shadow.camera.right = 18;
    moonLight.shadow.camera.top = 16;
    moonLight.shadow.camera.bottom = -8;
    moonLight.shadow.bias = -0.00035;
    moonLight.shadow.normalBias = 0.03;
    scene.add(moonLight);
    const fill = new THREE.DirectionalLight(0x8ea4be, 0.38);
    fill.position.set(-8, 9, 14);
    scene.add(fill);

    const loader = new THREE.TextureLoader();
    const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const brickTex = loadRepeat(loader, "/city/brick.jpg", anisotropy);
    const concreteTex = loadRepeat(loader, "/city/concrete.jpg", anisotropy);
    const asphaltTex = loadRepeat(loader, "/city/asphalt.jpg", anisotropy);
    asphaltTex.repeat.set(7, 7);
    const glassTex = loadRepeat(loader, "/city/glass.jpg", anisotropy);
    const sidewalkTex = concreteTex.clone();
    sidewalkTex.repeat.set(6, 1.2);
    sidewalkTex.needsUpdate = true;
    const skyTex = loader.load("/city/sky.jpg");
    skyTex.colorSpace = THREE.SRGBColorSpace;
    const birdTex = [0, 1, 2, 3].map((i) => {
      const meshes: THREE.Mesh[] = [];
      const tex = loader.load(`/city/bird-${i}.png`, (loaded) => {
        const image = loaded.image as { width?: number; height?: number };
        const aspect = (image.width ?? 1) / Math.max(1, image.height ?? 1);
        for (const mesh of meshes) {
          const height = Math.abs(mesh.scale.y) || 0.7;
          mesh.scale.x = Math.sign(mesh.scale.x || 1) * height * aspect;
          mesh.scale.y = height;
        }
      });
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.userData.meshes = meshes;
      return tex;
    });

    const sky = new THREE.Mesh(
      new THREE.PlaneGeometry(96, 41),
      new THREE.MeshBasicMaterial({ map: skyTex, depthWrite: false, fog: false }),
    );
    sky.position.set(0, 12.4, -26);
    scene.add(sky);

    const starPositions: number[] = [];
    const starPhase: number[] = [];
    const starSize: number[] = [];
    for (let i = 0; i < 160; i += 1) {
      starPositions.push((Math.random() - 0.5) * 70, 7.5 + Math.random() * 16, -24.2);
      starPhase.push(Math.random() * Math.PI * 2);
      starSize.push(6 + Math.random() * 16);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3));
    starGeo.setAttribute("aPhase", new THREE.Float32BufferAttribute(starPhase, 1));
    starGeo.setAttribute("aSize", new THREE.Float32BufferAttribute(starSize, 1));
    const starMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      fog: false,
      vertexShader: `
        attribute float aPhase;
        attribute float aSize;
        uniform float uTime;
        varying float vTw;
        void main() {
          vTw = 0.55 + 0.45 * sin(uTime * 1.6 + aPhase);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * vTw * (140.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying float vTw;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float d = length(p);
          if (d > 0.5) discard;
          float core = smoothstep(0.5, 0.05, d);
          gl_FragColor = vec4(vec3(0.93, 0.96, 1.0) * (0.7 + vTw), core);
        }
      `,
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    const street = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 70),
      new THREE.MeshStandardMaterial({
        map: asphaltTex,
        color: 0xffffff,
        roughness: 0.62,
        metalness: 0.18,
      }),
    );
    street.rotation.x = -Math.PI / 2;
    street.position.set(0, 0, 6);
    street.receiveShadow = true;
    scene.add(street);

    const walk = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 2.4),
      new THREE.MeshStandardMaterial({
        map: sidewalkTex,
        color: 0xc5c8cc,
        roughness: 0.84,
        metalness: 0.02,
      }),
    );
    walk.rotation.x = -Math.PI / 2;
    walk.position.set(0, 0.015, 2.55);
    walk.receiveShadow = true;
    scene.add(walk);
    const curb = new THREE.Mesh(
      new THREE.BoxGeometry(30, 0.08, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.7 }),
    );
    curb.position.set(0, 0.04, 1.32);
    scene.add(curb);

    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x1a1e24,
      roughness: 0.35,
      metalness: 0.72,
    });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.82, metalness: 0.08 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x8d9398, roughness: 0.32, metalness: 0.84 });
    const cableMat = new THREE.MeshStandardMaterial({ color: 0x14171b, roughness: 0.42, metalness: 0.64 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x3a332c, roughness: 0.78, metalness: 0.04 });
    const glowTex = radialTexture();
    const rooms: RoomMesh[] = [];
    const ambient: AmbientWin[] = [];
    const pickables: THREE.Object3D[] = [];
    const masts: THREE.Vector3[] = [];
    const fans: THREE.Mesh[] = [];

    const warm = new THREE.Color("#ffd7a8");
    const cool = new THREE.Color("#c5d4e4");
    const dim = new THREE.Color("#241c16");

    PLACEMENTS.forEach((placement, index) => {
      const { x, z, w, h, d, kind } = placement;
      const group = new THREE.Group();
      group.position.set(x, 0, z);
      const baseTex = kind === "brick" ? brickTex : concreteTex;
      const map = baseTex.clone();
      map.repeat.set(w / 2.15, h / 2.15);
      map.needsUpdate = true;
      const bodyMat = new THREE.MeshStandardMaterial({
        map,
        color: kind === "brick" ? 0xf2ebe4 : 0xd5d8dc,
        roughness: kind === "brick" ? 0.86 : 0.72,
        metalness: kind === "brick" ? 0.02 : 0.08,
      });
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
      body.position.y = h / 2;
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      const parapet = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.28, d + 0.12), roofMat);
      parapet.position.y = h + 0.08;
      parapet.castShadow = true;
      group.add(parapet);
      const cornice = new THREE.Mesh(new THREE.BoxGeometry(w + 0.28, 0.1, 0.18), roofMat);
      cornice.position.set(0, h - 0.02, d / 2 + 0.04);
      group.add(cornice);

      const hvac = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.38, 0.55), metalMat);
      hvac.position.set(-w * 0.18, h + 0.38, -d * 0.12);
      group.add(hvac);
      const fan = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, 0.04, 16),
        new THREE.MeshStandardMaterial({ color: 0x2a2e32, roughness: 0.5, metalness: 0.4 }),
      );
      fan.position.set(-w * 0.18, h + 0.6, -d * 0.12);
      group.add(fan);
      fans.push(fan);

      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.85, 8), metalMat);
      mast.position.set(w * 0.22, h + 0.5, d / 2 - 0.12);
      group.add(mast);
      const knob = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 10, 10),
        new THREE.MeshStandardMaterial({ color: 0xd7dde2, roughness: 0.22, metalness: 0.15 }),
      );
      knob.position.set(w * 0.22, h + 0.92, d / 2 - 0.12);
      group.add(knob);
      masts.push(new THREE.Vector3(x + w * 0.22, h + 0.92, z + d / 2 - 0.12));

      const slotSet = new Map(placement.slots.map((cell) => [`${cell.col}:${cell.floor}`, cell.slot]));
      const front = d / 2;
      for (let floor = 0; floor < placement.floors; floor += 1) {
        for (let col = 0; col < placement.cols; col += 1) {
          const cell = windowCenter(placement, col, floor);
          const key = `${col}:${floor}`;
          const slot = slotSet.get(key);
          addMullion(group, cell.x, cell.y, front + 0.03, cell.ww, cell.hh, frameMat);
          const sill = new THREE.Mesh(new THREE.BoxGeometry(cell.ww + 0.08, 0.045, 0.1), concreteTex ? roofMat : roofMat);
          sill.position.set(cell.x, cell.y - cell.hh / 2 - 0.02, front + 0.05);
          group.add(sill);

          const glass = new THREE.Mesh(
            new THREE.PlaneGeometry(cell.ww * 0.92, cell.hh * 0.9),
            new THREE.MeshStandardMaterial({
              map: glassTex,
              color: 0x9eb0c0,
              roughness: 0.08,
              metalness: 0.62,
              transparent: true,
              opacity: 0.42,
              depthWrite: false,
            }),
          );
          glass.position.set(cell.x, cell.y, front + 0.045);
          group.add(glass);

          const n = hash(index * 100 + floor * 17 + col * 3);
          const isSlot = typeof slot === "number";
          const lit = isSlot ? n > 0.28 : n > 0.48;
          const fillMat = new THREE.MeshBasicMaterial({
            color: n > 0.55 ? warm : cool,
            transparent: true,
            opacity: lit ? 0.18 + n * 0.28 : 0.02,
            toneMapped: false,
            depthWrite: false,
          });
          const fill = new THREE.Mesh(new THREE.PlaneGeometry(cell.ww * 0.78, cell.hh * 0.74), fillMat);
          fill.position.set(cell.x, cell.y, front + 0.02);
          group.add(fill);

          if (isSlot && typeof slot === "number") {
            fill.userData = { building: index, slot };
            pickables.push(fill);
            const glow = new THREE.Mesh(
              new THREE.PlaneGeometry(cell.ww * 1.45, cell.hh * 1.45),
              new THREE.MeshBasicMaterial({
                map: glowTex,
                color: warm,
                transparent: true,
                opacity: 0,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                toneMapped: false,
              }),
            );
            glow.position.set(cell.x, cell.y, front + 0.01);
            glow.visible = false;
            group.add(glow);
            const reflection = new THREE.Mesh(
              new THREE.PlaneGeometry(cell.ww * 0.7, 1.35),
              new THREE.MeshBasicMaterial({
                color: warm,
                transparent: true,
                opacity: 0,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                toneMapped: false,
              }),
            );
            reflection.rotation.x = -Math.PI / 2;
            reflection.position.set(cell.x, 0.03, front + 0.95);
            reflection.visible = false;
            group.add(reflection);
            rooms.push({
              building: index,
              slot,
              fill,
              glow,
              reflection,
              alive: lit ? 0.18 + n * 0.22 : 0.04,
              phase: n * 6,
            });
          } else if (lit) {
            ambient.push({ fill, phase: n * 8, base: 0.16 + n * 0.34 });
          }
        }
      }
      scene.add(group);
    });

    const phases = [0, 1, 2].map((i) => spanCurve(10.15 - i * 0.2, 0.42 + i * 0.06));
    for (const curve of phases) {
      const line = tube(curve, 0.02, cableMat, 96);
      line.castShadow = true;
      scene.add(line);
    }
    const feeder = phases[2]!;
    const feederGlowMat = new THREE.MeshBasicMaterial({
      color: 0xffe1b0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const feederGlow = tube(feeder, 0.045, feederGlowMat, 96);
    feederGlow.visible = false;
    scene.add(feederGlow);

    const poleMat = woodMat;
    for (const pole of POLES) {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 10.4, 8), poleMat);
      shaft.position.set(pole.x, 5.2, pole.z);
      shaft.castShadow = true;
      scene.add(shaft);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.06, 0.08), poleMat);
      arm.position.set(pole.x, 9.95, pole.z);
      scene.add(arm);
      for (const dy of [0.18, 0, -0.18]) {
        const bell = new THREE.Mesh(
          new THREE.CylinderGeometry(0.045, 0.055, 0.12, 8),
          new THREE.MeshStandardMaterial({ color: 0xd5dbe0, roughness: 0.25, metalness: 0.05 }),
        );
        bell.position.set(pole.x + 0.22, 10.12 + dy, pole.z);
        scene.add(bell);
      }
    }
    const can = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 0.42, 12),
      new THREE.MeshStandardMaterial({ color: 0x6e7470, roughness: 0.45, metalness: 0.55 }),
    );
    can.position.set(POLES[1]!.x, 8.7, POLES[1]!.z + 0.16);
    scene.add(can);

    const drops: DropLine[] = PLACEMENTS.map((placement, index) => {
      const mastTop = masts[index]!;
      const wireT = closestT(feeder, mastTop.x);
      const attach = feeder.getPoint(wireT);
      const mid = new THREE.Vector3(
        (attach.x + mastTop.x) / 2,
        Math.min(attach.y, mastTop.y) - 0.72,
        (attach.z + mastTop.z) / 2,
      );
      const curve = new THREE.CatmullRomCurve3([attach, mid, mastTop]);
      scene.add(tube(curve, 0.016, cableMat, 28));
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0xffd7a8,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const glow = tube(curve, 0.04, glowMat, 28);
      glow.visible = false;
      scene.add(glow);
      const pulses = [0, 1, 2].map((i) => {
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(0.28, 0.28),
          new THREE.MeshBasicMaterial({
            map: glowTex,
            color: 0xffd7a8,
            transparent: true,
            opacity: 0.95,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          }),
        );
        mesh.visible = false;
        mesh.userData = { offset: i / 3 };
        scene.add(mesh);
        return mesh;
      });
      return { building: index, curve, wireT, glow, pulses };
    });

    const mainPulses = [0, 1, 2, 3, 4, 5].map((i) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.34, 0.34),
        new THREE.MeshBasicMaterial({
          map: glowTex,
          color: 0xffe1b0,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      mesh.visible = false;
      mesh.userData = { offset: i / 6 };
      scene.add(mesh);
      return mesh;
    });

    const beamMeshes = [0, 1, 2, 3, 4].map((i) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.62 - i * 0.08, 0.62 - i * 0.08),
        new THREE.MeshBasicMaterial({
          map: glowTex,
          color: 0xffffff,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      mesh.visible = false;
      scene.add(mesh);
      return mesh;
    });

    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xffc48a,
      emissive: 0xffb15a,
      emissiveIntensity: 2.4,
      toneMapped: false,
    });
    for (const lx of [-8.4, -0.4, 7.6]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 4.3, 8), metalMat);
      pole.position.set(lx, 2.15, 3.55);
      pole.castShadow = true;
      scene.add(pole);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), lampMat);
      head.position.set(lx, 4.35, 3.55);
      scene.add(head);
      const pool = new THREE.Mesh(
        new THREE.CircleGeometry(1.5, 20),
        new THREE.MeshBasicMaterial({
          map: glowTex,
          color: 0xffb56a,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(lx, 0.03, 3.35);
      scene.add(pool);
      const light = new THREE.PointLight(0xffb56a, 6.5, 10, 2);
      light.position.set(lx, 4.2, 3.55);
      scene.add(light);
    }

    const carPaint = new THREE.MeshStandardMaterial({ color: 0x121418, roughness: 0.28, metalness: 0.72 });
    const carGlass = new THREE.MeshStandardMaterial({
      color: 0x1c2833,
      roughness: 0.08,
      metalness: 0.4,
      transparent: true,
      opacity: 0.85,
    });
    for (const [cx, cz, rot] of [
      [-3.4, 4.15, 0.04],
      [4.8, 4.55, -0.05],
    ] as const) {
      const car = new THREE.Group();
      const bodyBox = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.42, 0.82), carPaint);
      bodyBox.position.y = 0.38;
      bodyBox.castShadow = true;
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.32, 0.74), carGlass);
      cabin.position.set(-0.08, 0.7, 0);
      car.add(bodyBox, cabin);
      car.position.set(cx, 0, cz);
      car.rotation.y = rot;
      scene.add(car);
    }

    const winTex = towerTexture();
    const towerMat = new THREE.MeshStandardMaterial({
      color: 0x05070a,
      emissive: 0xffffff,
      emissiveMap: winTex,
      emissiveIntensity: 0.85,
      roughness: 0.62,
      metalness: 0.18,
    });
    const towers = [
      { x: -13.6, z: -11.2, w: 2.3, d: 2.2, h: 11.8 },
      { x: -9.1, z: -14.2, w: 2.9, d: 2.4, h: 16.4 },
      { x: -4.6, z: -12.4, w: 1.7, d: 1.8, h: 9.2 },
      { x: 5.4, z: -14.4, w: 3.1, d: 2.4, h: 15.1 },
      { x: 9.6, z: -11.6, w: 2.1, d: 2.1, h: 10.8 },
      { x: 13.4, z: -15.1, w: 2.7, d: 2.3, h: 18.6 },
      { x: 1.5, z: -16.2, w: 2.4, d: 2.3, h: 12.4 },
    ];
    const beacons: THREE.Mesh[] = [];
    for (const tower of towers) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(tower.w, tower.h, tower.d), towerMat);
      mesh.position.set(tower.x, tower.h / 2, tower.z);
      mesh.castShadow = true;
      scene.add(mesh);
      if (tower.h > 15) {
        const beacon = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 10, 10),
          new THREE.MeshBasicMaterial({ color: 0xff3b3b, toneMapped: false }),
        );
        beacon.position.set(tower.x, tower.h + 0.2, tower.z);
        scene.add(beacon);
        beacons.push(beacon);
      }
    }

    const birds = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
      const tex = birdTex[i % birdTex.length]!;
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      const dir = i % 3 === 0 ? -1 : 1;
      const height = 1.25 + (i % 3) * 0.38;
      mesh.scale.set(dir * height, height, 1);
      (tex.userData.meshes as THREE.Mesh[]).push(mesh);
      const image = tex.image as { width?: number; height?: number } | undefined;
      if (image?.width && image.height) {
        mesh.scale.x = Math.sign(mesh.scale.x || dir) * height * (image.width / image.height);
      }
      mesh.userData = {
        offset: (i * 0.137) % 1,
        speed: 0.018 + (i % 4) * 0.006,
        y: 10.4 + (i % 5) * 0.85,
        bob: 0.18 + (i % 3) * 0.08,
        z: -7.5 - (i % 4) * 1.15,
        dir,
        phase: i * 1.3,
      };
      scene.add(mesh);
      return mesh;
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const base = new THREE.Vector3();
    const look = new THREE.Vector3(0, 4.15, -1);
    const tmp = new THREE.Color();
    const picked = new THREE.Color("#f4f7f8");

    function frameCamera() {
      const aspect = camera.aspect;
      if (aspect < 0.85) {
        camera.fov = 40;
        camera.position.set(-0.6, 5.15, 19.8);
        base.copy(camera.position);
        look.set(-0.8, 4.05, -1);
      } else {
        camera.fov = 30;
        camera.position.set(0.1, 4.85, 17.2);
        base.copy(camera.position);
        look.set(0.05, 4.25, -1);
      }
      camera.lookAt(look);
      camera.updateProjectionMatrix();
    }

    function resize() {
      const w = surface.clientWidth || 1;
      const h = surface.clientHeight || 1;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      frameCamera();
    }
    resize();
    const observer = new ResizeObserver(() => resize());
    observer.observe(surface);

    function pick(event: PointerEvent) {
      const rect = surface.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(pickables, false)[0];
      return hit?.object.userData as { building?: number; slot?: number } | undefined;
    }
    const onMove = (event: PointerEvent) => {
      const data = pick(event);
      surface.style.cursor = typeof data?.building === "number" ? "pointer" : "default";
    };
    const onDown = (event: PointerEvent) => {
      const data = pick(event);
      if (typeof data?.building === "number" && typeof data.slot === "number") {
        pickRef.current(data.building, data.slot);
      }
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);

    const workersOf = (building: number, current: SceneModel) => {
      const roomsHere = current.buildings[building]?.rooms ?? [];
      return roomsHere.filter((room) => room.working);
    };

    renderer.setAnimationLoop((stamp) => {
      timer.update(stamp);
      const t = timer.getElapsed();
      const current = modelRef.current;
      const drift = current.reduced ? 0 : 1;
      camera.position.x = base.x + Math.sin(t * 0.07) * 0.22 * drift;
      camera.position.y = base.y + Math.sin(t * 0.1) * 0.04 * drift;
      camera.lookAt(look);
      starMat.uniforms.uTime!.value = current.reduced ? 0 : t;

      const activeColors: string[] = [];
      for (const room of rooms) {
        const bot = current.buildings[room.building]?.rooms.find((entry) => entry.slot === room.slot);
        const working = Boolean(bot?.working);
        const selected = current.selected?.building === room.building && current.selected.slot === room.slot;
        const mat = room.fill.material as THREE.MeshBasicMaterial;
        const glowMat = room.glow.material as THREE.MeshBasicMaterial;
        const refMat = room.reflection.material as THREE.MeshBasicMaterial;
        if (working && bot) {
          tmp.set(bot.color || "#ffd7a8");
          mat.color.copy(warm).lerp(tmp, 0.45);
          mat.opacity = 0.95;
          glowMat.color.copy(tmp);
          refMat.color.copy(tmp);
          room.glow.visible = true;
          glowMat.opacity = 0.7;
          room.reflection.visible = true;
          refMat.opacity = 0.28;
          activeColors.push(bot.color || "#ffd7a8");
        } else if (selected) {
          mat.color.copy(picked);
          mat.opacity = 0.55;
          room.glow.visible = true;
          glowMat.color.set("#d5ddd8");
          glowMat.opacity = 0.28;
          room.reflection.visible = false;
        } else {
          const breathe = current.reduced ? 1 : 0.86 + Math.sin(t * 0.7 + room.phase) * 0.14;
          mat.color.copy(room.alive > 0.2 ? warm : dim);
          mat.opacity = room.alive * breathe;
          room.glow.visible = false;
          room.reflection.visible = false;
        }
      }

      if (!current.reduced) {
        for (const win of ambient) {
          const mat = win.fill.material as THREE.MeshBasicMaterial;
          mat.opacity = win.base * (0.82 + Math.sin(t * 0.55 + win.phase) * 0.18);
        }
        for (const fan of fans) fan.rotation.y = t * 1.4;
        for (const beacon of beacons) {
          const on = Math.sin(t * 2.2) > 0.2;
          beacon.visible = on;
        }
      }

      let anyWorking = false;
      drops.forEach((drop) => {
        const workers = workersOf(drop.building, current);
        const glowMat = drop.glow.material as THREE.MeshBasicMaterial;
        if (workers.length) {
          anyWorking = true;
          drop.glow.visible = true;
          const lead = workers[0] as SceneRoom;
          glowMat.color.set(lead.color || "#ffd7a8");
          glowMat.opacity = 0.42 + Math.min(workers.length, 3) * 0.16;
          drop.pulses.forEach((pulse, i) => {
            const worker = workers[i % workers.length] as SceneRoom;
            const data = pulse.userData as { offset: number };
            const u = current.reduced ? data.offset : (data.offset + t * 0.22) % 1;
            pulse.visible = true;
            pulse.position.copy(drop.curve.getPoint(1 - u));
            (pulse.material as THREE.MeshBasicMaterial).color.set(worker.color || "#ffd7a8");
            (pulse.material as THREE.MeshBasicMaterial).opacity = 0.95;
          });
        } else {
          drop.glow.visible = false;
          for (const pulse of drop.pulses) pulse.visible = false;
        }
      });
      feederGlow.visible = anyWorking;
      feederGlowMat.opacity = anyWorking ? 0.22 : 0;
      if (anyWorking && activeColors[0]) feederGlowMat.color.set(activeColors[0]);
      mainPulses.forEach((pulse, i) => {
        pulse.visible = anyWorking;
        if (!anyWorking) return;
        const data = pulse.userData as { offset: number };
        const u = current.reduced ? data.offset : (data.offset + t * 0.05) % 1;
        pulse.position.copy(feeder.getPoint(u));
        const color = activeColors[i % activeColors.length] ?? "#ffe1b0";
        (pulse.material as THREE.MeshBasicMaterial).color.set(color);
      });

      for (const bird of birds) {
        const data = bird.userData as {
          offset: number;
          speed: number;
          y: number;
          bob: number;
          z: number;
          dir: number;
          phase: number;
        };
        const u = current.reduced ? data.offset : (data.offset + t * data.speed) % 1;
        const x = data.dir > 0 ? -16 + u * 34 : 16 - u * 34;
        bird.position.set(x, data.y + Math.sin(u * Math.PI * 2 + data.phase) * data.bob, data.z);
        bird.rotation.z = Math.cos(u * Math.PI * 2 + data.phase) * 0.22 * data.dir;
      }

      const live = current.beams[current.beams.length - 1];
      const age = live ? (performance.now() - live.born) / 1000 : 99;
      const showBeam = Boolean(live && age >= 0 && age < 2.8);
      const fromDrop = live ? drops[live.from] : undefined;
      beamMeshes.forEach((mesh, index) => {
        mesh.visible = showBeam && Boolean(fromDrop);
        if (!showBeam || !live || !fromDrop) return;
        const u = Math.min(age / 2.6, 1);
        const lag = index * 0.045;
        const head = Math.max(0, u - lag);
        let point: THREE.Vector3;
        if (head < 0.42) {
          point = fromDrop.curve.getPoint(1 - head / 0.42);
        } else {
          const k = (head - 0.42) / 0.58;
          const end = fromDrop.wireT > 0.55 ? 0.06 : 0.94;
          const along = fromDrop.wireT + (end - fromDrop.wireT) * Math.min(k, 1);
          point = feeder.getPoint(THREE.MathUtils.clamp(along, 0, 1));
        }
        mesh.position.copy(point);
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.color.set(live.color);
        mat.opacity = Math.max(0, 0.95 - index * 0.16) * (1 - Math.max(0, age - 2.15) / 0.65);
      });

      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      timer.disconnect();
      observer.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material;
        const disposeMat = (entry: THREE.Material) => {
          entry.dispose();
        };
        if (Array.isArray(material)) material.forEach(disposeMat);
        else if (material) disposeMat(material);
      });
      brickTex.dispose();
      concreteTex.dispose();
      asphaltTex.dispose();
      glassTex.dispose();
      sidewalkTex.dispose();
      skyTex.dispose();
      birdTex.forEach((tex) => tex.dispose());
      glowTex.dispose();
      winTex.dispose();
      starGeo.dispose();
      starMat.dispose();
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" aria-label="Night city" />;
}
