// @ts-nocheck
// World-locked rain over the whole ward. Drops only fall. The field does not follow the camera.
import * as THREE from "three";

const N = 16000;
const SPAN = 150;

export function createRain(bounds) {
  const minX = bounds.minX - 20;
  const maxX = bounds.maxX + 20;
  const minZ = bounds.minZ - 20;
  const maxZ = bounds.maxZ + 20;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const pos = new Float32Array(N * 6);
  const phase = new Float32Array(N * 2);
  const speed = new Float32Array(N * 2);
  const tip = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const x = minX + Math.random() * width;
    const z = minZ + Math.random() * depth;
    const ph = Math.random();
    const sp = 22 + Math.random() * 18;
    for (let k = 0; k < 2; k++) {
      const j = i * 2 + k;
      pos[j * 3] = x + k * 0.65;
      pos[j * 3 + 1] = 0;
      pos[j * 3 + 2] = z + k * 0.12;
      phase[j] = ph;
      speed[j] = sp;
      tip[j] = k;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  geo.setAttribute("aSpeed", new THREE.BufferAttribute(speed, 1));
  geo.setAttribute("aTip", new THREE.BufferAttribute(tip, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uGround: { value: 12 },
      uSpan: { value: SPAN },
    },
    vertexShader: /* glsl */ `
      attribute float aPhase;
      attribute float aSpeed;
      attribute float aTip;
      uniform float uTime;
      uniform float uGround;
      uniform float uSpan;
      void main() {
        float y = uGround + mod(aPhase * uSpan - uTime * aSpeed, uSpan) - aTip * (2.8 + aSpeed * 0.05);
        vec4 world = modelMatrix * vec4(position.x, y, position.z, 1.0);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      void main() {
        gl_FragColor = vec4(0.91, 0.95, 1.0, 0.5);
      }
    `,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 20;
  return {
    lines,
    update(wet, time) {
      lines.visible = wet > 0.25;
      mat.uniforms.uTime.value = time;
    },
  };
}
