// @ts-nocheck
// A furnished room just inside a clicked window. One room at a time.
import * as THREE from "three";

function paint(draw) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  draw(canvas.getContext("2d"), 64, 64);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 4;
  return map;
}

let maps = null;
function textures() {
  if (maps) return maps;
  maps = {
    wood: paint((g, w, h) => {
      g.fillStyle = "#6a4630";
      g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 8) {
        g.fillStyle = y % 16 === 0 ? "#4a3122" : "#7c5438";
        g.fillRect(0, y, w, 7);
        g.strokeStyle = "rgba(30,18,10,0.35)";
        g.beginPath();
        for (let x = 2; x < w; x += 5) {
          g.moveTo(x, y);
          g.lineTo(x + ((y / 8) % 2), y + 7);
        }
        g.stroke();
      }
    }),
    plaster: paint((g, w, h) => {
      g.fillStyle = "#d7cfc3";
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 500; i += 1) {
        g.fillStyle = `rgba(70,60,50,${Math.random() * 0.18})`;
        g.fillRect(Math.random() * w, Math.random() * h, 2, 1);
      }
    }),
    cloth: paint((g, w, h) => {
      g.fillStyle = "#3c4b54";
      g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 3) {
        g.fillStyle = y % 6 === 0 ? "#2a363d" : "#51636c";
        g.fillRect(0, y, w, 1);
      }
    }),
  };
  return maps;
}

function hash(text) {
  let n = 2166136261;
  for (let i = 0; i < text.length; i += 1) n = Math.imul(n ^ text.charCodeAt(i), 16777619);
  return n >>> 0;
}

function box(w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.userData.interior = true;
  return mesh;
}

export function buildInterior(pick, outward) {
  const wide = 3.5;
  const deep = 4.1;
  const tall = 2.62;
  const street = outward.clone();
  street.y = 0;
  if (street.lengthSq() < 0.2) street.set(0, 0, 1);
  street.normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), street);
  const group = new THREE.Group();
  group.name = "room";
  group.quaternion.copy(quat);
  group.position.set(pick.x, pick.floorY, pick.z);

  const seed = hash(`${pick.key}:${pick.slot}`);
  const side = seed % 2 === 0 ? -1 : 1;
  const tex = textures();
  const plaster = new THREE.MeshStandardMaterial({
    map: tex.plaster,
    color: new THREE.Color().setHSL(0.08, 0.12, 0.62 + (seed % 4) * 0.03),
    roughness: 0.94,
  });
  const wood = new THREE.MeshStandardMaterial({ map: tex.wood, roughness: 0.58 });
  const cloth = new THREE.MeshStandardMaterial({ map: tex.cloth, roughness: 0.88 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x2c2824, roughness: 0.48 });
  const linen = new THREE.MeshStandardMaterial({ map: tex.plaster, color: 0xcbbfae, roughness: 0.9 });
  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0xffe2b0,
    emissive: 0xffb45c,
    emissiveIntensity: 1.6,
    roughness: 0.4,
  });
  const screen = new THREE.MeshStandardMaterial({
    color: 0xb7d7ff,
    emissive: 0x7eb6ef,
    emissiveIntensity: 0.85,
    roughness: 0.25,
  });
  const rug = new THREE.MeshStandardMaterial({ color: seed % 3 === 0 ? 0x6a3030 : 0x2f3d46, roughness: 0.95 });

  group.add(box(wide, 0.08, deep, wood, 0, 0.04, -deep / 2));
  group.add(box(wide, 0.08, deep, plaster, 0, tall, -deep / 2));
  group.add(box(wide, tall, 0.1, plaster, 0, tall / 2, -deep));
  group.add(box(0.1, tall, deep, plaster, -wide / 2, tall / 2, -deep / 2));
  group.add(box(0.1, tall, deep, plaster, wide / 2, tall / 2, -deep / 2));
  group.add(box(wide, 0.16, 0.08, frame, 0, tall - 0.08, -0.06));
  group.add(box(wide, 0.42, 0.08, frame, 0, 0.22, -0.06));
  group.add(box(0.12, tall, 0.08, frame, -wide / 2 + 0.08, tall / 2, -0.06));
  group.add(box(0.12, tall, 0.08, frame, wide / 2 - 0.08, tall / 2, -0.06));
  group.add(box(0.05, 1.35, 0.05, frame, 0, 1.25, -0.04));

  group.add(box(1.25, 0.06, 0.58, wood, side * 0.85, 0.74, -1.15));
  group.add(box(0.06, 0.68, 0.5, wood, side * 0.4, 0.38, -1.15));
  group.add(box(0.06, 0.68, 0.5, wood, side * 1.28, 0.38, -1.15));
  group.add(box(0.58, 0.36, 0.04, screen, side * 0.85, 1.05, -1.38));
  group.add(box(0.4, 0.07, 0.4, cloth, side * 0.85, 0.46, -0.55));
  group.add(box(0.4, 0.42, 0.06, cloth, side * 0.85, 0.7, -0.36));
  group.add(box(1.15, 0.32, 1.9, linen, -side * 0.9, 0.28, -2.55));
  group.add(box(1.05, 0.14, 0.32, cloth, -side * 0.9, 0.48, -1.75));
  group.add(box(0.28, 1.35, 0.7, wood, -side * 1.45, 0.72, -3.35));
  group.add(box(2.0, 0.025, 2.15, rug, 0, 0.09, -2.15));
  group.add(box(0.32, 0.14, 0.32, shadeMat, -side * 0.15, 1.55, -3.15));

  const lamp = new THREE.PointLight(0xffc58a, 4, 8, 2);
  lamp.position.set(-side * 0.15, 1.42, -3.15);
  group.add(lamp);

  const eye = new THREE.Vector3(-side * 1.05, 1.55, -0.85).applyQuaternion(quat).add(group.position);
  const look = new THREE.Vector3(side * 0.35, 0.85, -2.5).applyQuaternion(quat).add(group.position);
  return {
    group,
    eye,
    look,
    span: { minX: -1.35, maxX: 1.35, minY: 1.05, maxY: 2.05, minZ: -3.55, maxZ: -0.5 },
  };
}

export function disposeInterior(group) {
  group.traverse((obj) => {
    obj.geometry?.dispose();
    if (obj.material && !obj.material.map) obj.material.dispose();
    else if (obj.material && obj.material.map) obj.material.dispose();
  });
}
