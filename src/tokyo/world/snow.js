// Falling snow. Flakes are soft billboards in a volume that follows the camera.
import * as THREE from "three";

export function createSnow(camera, count = 12000) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const seeds = new Float32Array(count * 3);
  const rand = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    seeds[i * 3] = Math.random();
    seeds[i * 3 + 1] = Math.random();
    seeds[i * 3 + 2] = Math.random();
    rand[i] = Math.random();
  }
  geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 3));
  geometry.setAttribute("aRand", new THREE.InstancedBufferAttribute(rand, 1));
  geometry.instanceCount = count;

  const uniforms = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector3(0.6, 0, 0.25) },
    uCameraPos: { value: new THREE.Vector3() },
    uVolume: { value: new THREE.Vector3(70, 46, 70) },
    uSpeed: { value: 2.4 },
    uSize: { value: 0.11 },
    uSway: { value: 0.65 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uWind;
      uniform vec3 uCameraPos;
      uniform vec3 uVolume;
      uniform float uSpeed;
      uniform float uSize;
      uniform float uSway;
      attribute vec3 aSeed;
      attribute float aRand;
      varying vec2 vUv;
      varying float vRand;
      void main() {
        vUv = uv;
        vRand = aRand;
        vec3 origin = uCameraPos - vec3(uVolume.x * 0.5, uVolume.y * 0.35, uVolume.z * 0.5);
        float speed = uSpeed * (0.55 + 0.7 * aRand);
        float phase = aRand * 6.2831853;
        vec3 sway = vec3(
          sin(uTime * 0.7 + phase),
          0.0,
          cos(uTime * 0.55 + phase)
        ) * uSway * (0.4 + 0.6 * aRand);
        vec3 disp = vec3(uWind.x, -speed, uWind.z) * uTime + sway;
        vec3 pos = mod(aSeed * uVolume + disp - origin, uVolume) + origin;
        float size = uSize * (0.45 + aRand);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 world = pos + right * (position.x * size) + up * (position.y * size);
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying float vRand;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float alpha = smoothstep(1.0, 0.15, d) * (0.45 + 0.5 * vRand);
        if (alpha < 0.02) discard;
        gl_FragColor = vec4(0.93, 0.95, 1.0, alpha);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 12;
  mesh.name = "snow";
  return {
    mesh,
    update(time, cameraPosition) {
      uniforms.uTime.value = time;
      uniforms.uCameraPos.value.copy(cameraPosition);
    },
  };
}
