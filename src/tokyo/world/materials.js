// @ts-nocheck
// Materials. Buildings and ground are MeshStandardMaterials patched with procedural detail, so they keep
// three's lighting, shadows, fog and environment reflections.
//
// Building vertex attributes (see meshing.js):
//   color    surface colour (linear); the wall texture only adds detail on top
//   aFacade  x: window column coordinate (integer = bay edge), y: height above the base (m),
//            z: floor height (m), w: building seed in [0, 1)
//   aBldg    x: building height (m), y: category + 8 * texture layer, z: kind (KIND), w: bay width (m, 0 = no windows)
import * as THREE from 'three';

export const shared = {
  uNight: { value: 0 }, // 0 day .. 1 night: how far the lights are on
  uDark: { value: 0 },  // 0 day .. 1 night: how dark it is
  uTime: { value: 0 },  // seconds, for wind and signals
  // aerial photo over the area: texture, and its rectangle in world x/z as (minX, minZ, sizeX, sizeZ)
  uOrtho: { value: null }, uOrthoRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uOrthoOn: { value: 0 },
  // lit windows at night: the share of rooms whose light comes and goes, and how fast (1: every 1.5 to 5.5 minutes)
  uWindowLife: { value: new THREE.Vector2(0.5, 4) },
  // how strongly the glass of tall buildings mirrors the lights of the city at night (0: off)
  uCityGlass: { value: 1 },
  // how blue the lights of the city are at night (0: mostly warm, 1: a cool blue city)
  uNightBlue: { value: 0.55 },
  uWet: { value: 0 },
  uSnow: { value: 1 },
  uBots: { value: Array.from({ length: 5 }, () => new THREE.Vector4()) },
  // lamp light on the ground (src/world/lamplight.js): on at night, the light map, where it lies
  uLampOn: { value: 0 }, uLampMap: { value: null }, uLampRect: { value: new THREE.Vector4(0, 0, 1, 0) },
  // the sun in the window glass: direction to the sun (world), and its colour times how much of it there is
  uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunGlint: { value: new THREE.Color(0, 0, 0) }, uGlintOn: { value: 1 },
  // wall photos: the distances (m) between which a facade goes from generated to photo, and how much photo at most
  uPhotoRange: { value: new THREE.Vector2(140, 420) }, uPhotoMix: { value: 1 },
};


const NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Anti-aliased box [a, b] in x with filter width w.
float box(float x, float a, float b, float w) {
  return smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x);
}
vec3 hue(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
`;

const WORLD_VARYINGS_VERT = 'varying vec3 vWPos;\nvarying vec3 vWNrm;';
const WORLD_VARYINGS_SET = 'vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * normal);';
// Replaces the shading normal with the tangent-space normal gNm in the world frame (gT, gB, gN).
const APPLY_NORMAL = /* glsl */ `
normal = normalize((viewMatrix * vec4(normalize(gT * gNm.x + gB * gNm.y + gN * gNm.z), 0.0)).xyz);
`;

// ---------------------------------------------------------------- facade
const FACADE_PARS = /* glsl */ `
uniform float uNight;
uniform float uTime;
uniform vec2 uWindowLife;
uniform float uCityGlass;
uniform float uNightBlue;
uniform float uSnow;
uniform vec4 uBots[5];
uniform vec3 uSunDir;
uniform vec3 uSunGlint;
uniform float uGlintOn;
uniform sampler2DArray uWallAlb;
uniform sampler2DArray uWallNor;
uniform float uWallScale[6];
uniform float uWallDetail[6];
varying vec4 vFacade;
varying vec4 vBldg;
varying vec3 vWPos;
varying vec3 vWNrm;
float gRough, gMetal;
vec3 gGlint = vec3(0.0); // the sun mirrored in a pane (added to the specular light where the sun reaches it)
float gPane = 0.0; // how much of a mirror this fragment is: window glass (written to alpha for the reflection pass)
float gStyle = 0.0; // 1 cyber, 2 blade runner: keeps the aerial photo off these blocks
vec3 gEmissive, gT, gB, gN, gNm;
void markBot(vec4 bot, float paneAmt) {
  float live = step(0.5, bot.w);
  float house = 1.0 - smoothstep(10.0, 26.0, length(vWPos.xz - bot.xz));
  float floorHit = 1.0 - smoothstep(0.8, 2.6, abs(vWPos.y - bot.y));
  gEmissive *= mix(1.0, 0.2, live * house * (1.0 - floorHit));
  gEmissive += paneAmt * live * house * floorHit * uNight * vec3(1.0, 0.76, 0.38) * 8.0;
}
${NOISE}
`;

const FACADE_MAIN = /* glsl */ `
{
  gN = normalize(vWNrm);
  gT = abs(gN.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), gN));
  gB = cross(gN, gT);
  float seed = vFacade.w, height = vBldg.x, kind = vBldg.z, cellW = vBldg.w;
  float layer = floor(vBldg.y / 8.0 + 0.01), cat = vBldg.y - layer * 8.0;
  float u = vFacade.x, v = vFacade.y, floorH = vFacade.z;

  // surface texture: detail (mean 1) over the vertex colour, plus a normal map
  vec2 st = vec2(dot(vWPos, gT), dot(vWPos, gB));
  vec3 tuv = vec3(st / uWallScale[int(layer)], layer);
  vec3 wall = diffuseColor.rgb * mix(vec3(1.0), texture(uWallAlb, tuv).rgb * 2.0, uWallDetail[int(layer)]);
  wall *= 0.9 + 0.2 * vnoise(st * 0.11 + seed * 50.0);          // breaks up tiling over large walls
  gNm = texture(uWallNor, tuv).xyz * 2.0 - 1.0;
  gNm = normalize(vec3(gNm.xy * 1.35, gNm.z));
  gRough = 0.82; gMetal = 0.0; gEmissive = vec3(0.0);
  if (layer > 3.5 && layer < 4.5) { gRough = 0.5; gMetal = 0.35; }  // metal siding and roofs

  // weathering on walls: rain streaks, a dirty base, run-off under the roofline
  if (kind < 0.5 || (kind > 1.5 && kind < 2.5)) {
    float streak = vnoise(vec2(st.x * 2.2, st.y * 0.13 + seed * 40.0));
    float grime = smoothstep(0.55, 0.95, streak) * 0.1
      + (1.0 - smoothstep(0.0, 1.6, v)) * 0.1
      + smoothstep(height - 2.5, height, v) * streak * 0.14;
    wall *= 1.0 - grime;
  }
  diffuseColor.rgb = wall;

  // Same blocks. Tall shells split into Blade Runner and cyberpunk.
  // Some of the low houses take the cyberpunk treatment too.
  float styleRoll = fract(seed * 19.7);
  float small = step(height, 16.0) * step(5.5, height);
  float blade = step(0.4, styleRoll) * step(styleRoll, 0.7) * step(16.0, height);
  float cyber = max(step(0.7, styleRoll) * step(16.0, height), small * step(0.48, fract(seed * 7.3)));
  gStyle = cyber + blade * 2.0;
  if (blade > 0.5) {
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.04, 0.035, 0.032), 0.84);
    gRough = 0.48; gMetal = 0.28;
  } else if (cyber > 0.5) {
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.025, 0.03, 0.042), 0.9);
    gRough = 0.28; gMetal = 0.62;
  }

  // Every roof is a solid charcoal or grey cap. No tile colour, no neon on the top.
  if (kind > 0.5 && kind < 3.5) {
    float tone = fract(seed * 13.1);
    vec3 cap = tone < 0.34 ? vec3(0.07, 0.072, 0.075) : tone < 0.67 ? vec3(0.16, 0.162, 0.168) : vec3(0.27, 0.272, 0.278);
    diffuseColor.rgb = cap;
    gRough = 0.9;
    gMetal = 0.02;
    gNm = vec3(0.0, 0.0, 1.0);
    gEmissive = vec3(0.0);
    gStyle = max(gStyle, 1.0);
  }

  // steelwork of a lattice tower (src/world/tower.js): painted steel in the vertex colour, floodlit at night
  if (kind > 3.5) {
    // (a colour brighter than 1 is a lamp: dark glass by day, lit at night; the steel keeps its own paint
    // under the floodlights)
    float lampOn = step(1.5, max(vColor.r, max(vColor.g, vColor.b)));
    diffuseColor.rgb = mix(vColor.rgb * (0.94 + 0.12 * vnoise(st * 0.7)), vec3(0.12), lampOn);
    gRough = 0.5; gMetal = 0.25; gNm = vec3(0.0, 0.0, 1.0);
    gEmissive = mix(vColor.rgb * 0.75, vColor.rgb * 1.6, lampOn) * uNight;
  }

  if (kind < 0.5 && cellW > 0.5) {
    float fyAll = v / floorH, row = floor(fyAll), col = floor(u);
    // Per-room random numbers. The seed is interpolated, so it carries rounding noise: hash only
    // integers derived from it (meshing.js stores seeds as multiples of 1/4096).
    float sid = floor(seed * 4096.0 + 0.5);
    vec2 room = vec2(col + mod(sid, 61.0) * 17.0, row + mod(sid, 53.0) * 13.0);
    float fx = fract(u), fy = fract(fyAll);
    float wx = max(fwidth(u), 1e-4), wy = max(fwidth(fyAll), 1e-4);
    float far = smoothstep(0.2, 0.6, max(wx, wy));                   // the grid aliases far away

    // window rectangle within one bay: [x0, x1] x [y0, y1]
    vec4 r = vec4(0.14, 0.86, 0.3, 0.82);                            // apartments, offices
    if (cat < 0.5) r = vec4(0.26, 0.74, 0.36, 0.78);                 // houses
    else if (cat > 3.5 && cat < 4.5) r = vec4(0.16, 0.84, 0.3, 0.8); // public
    else if (cat > 4.5) r = vec4(0.0, 1.0, 0.26, 1.0);               // curtain wall: glass above a spandrel
    bool shop = row < 0.5 && cat > 1.5 && cat < 3.5;
    if (shop) r = vec4(0.05, 0.95, 0.03, 0.8);                       // ground-floor shopfront
    float valid = step(0.0, v) * step(v, height - 0.9);
    // houses and apartments: some bays are plain wall
    if (cat < 2.5 && !shop) valid *= step(0.2, hash12(room + 41.0));
    float inWin = box(fx, r.x, r.y, wx) * box(fy, r.z, r.w, wy) * valid;

    // frame and mullions, measured in metres from the window edge
    vec2 wmin = vec2(r.x * cellW, r.z * floorH), wmax = vec2(r.y * cellW, r.w * floorH);
    vec2 pm = vec2(fx * cellW, fy * floorH);
    float edge = min(min(pm.x - wmin.x, wmax.x - pm.x), min(pm.y - wmin.y, wmax.y - pm.y));
    float fw = cat > 4.5 ? 0.045 : 0.065, ew = max(fwidth(edge), 1e-4);
    float frame = 1.0 - smoothstep(fw - ew, fw + ew, edge);
    float panes = max(1.0, floor((wmax.x - wmin.x) / 1.25 + 0.5));
    float mx = fract((pm.x - wmin.x) / (wmax.x - wmin.x) * panes);
    float mw = 0.03 * panes / (wmax.x - wmin.x);
    frame = max(frame, panes > 1.5 ? 1.0 - box(mx, mw, 1.0 - mw, max(fwidth(mx), 1e-4)) : 0.0);
    frame *= 1.0 - far;
    float pane = inWin * (1.0 - frame);

    // interior mapping: intersect the view ray with a room box behind the glass
    vec3 V = normalize(vWPos - cameraPosition);
    vec3 rd = vec3(dot(V, gT) / cellW, dot(V, gB) / floorH, dot(V, gN) / 4.5) + vec3(1e-5, 1e-5, 0.0);
    vec3 ro = vec3(fx, fy, 0.0);
    vec2 tA = (step(0.0, rd.xy) - ro.xy) / rd.xy;
    float tz = -1.0 / min(rd.z, -1e-4);
    float tHit = min(min(tA.x, tA.y), tz);
    vec3 hp = ro + rd * tHit;
    float rh = hash12(room);
    vec3 interior = mix(vec3(0.74, 0.69, 0.6), vec3(0.6, 0.63, 0.68), rh);
    float shade = 0.62;                                              // side walls
    if (tHit == tz) shade = 0.5 + 0.28 * step(0.42, hp.y);          // back wall above a furniture band
    else if (tHit == tA.y) shade = rd.y > 0.0 ? 1.0 : 0.38;         // ceiling, floor
    interior *= shade * mix(1.0, 0.5, clamp(-hp.z, 0.0, 1.0));
    // blinds or curtains pulled part-way down some windows
    float blind = step(0.5, hash12(room + 7.7)) * hash12(room + 3.1);
    float wyLocal = (fy - r.z) / (r.w - r.z);
    if (!shop && wyLocal > 1.0 - blind * 0.85) interior = mix(vec3(0.8, 0.78, 0.72), vec3(0.68, 0.7, 0.74), rh) * 0.75;
    interior = mix(interior, vec3(0.42, 0.42, 0.4), far);            // far away: the average room

    // lit rooms at night: shops and offices more often than homes
    float onRate = shop ? 0.75 : cat > 2.5 ? 0.32 : 0.22;
    if (blade > 0.5) onRate = shop ? 0.92 : 0.58;
    if (cyber > 0.5) onRate = max(onRate, 0.7);
    // No two buildings alike: one is asleep and the next is busy; many offices are lit by the floor (a whole
    // storey working late, the one above dark).
    float b1 = fract(seed * 11.7), b2 = fract(seed * 17.3), b3 = fract(seed * 23.9);
    onRate *= mix(0.35, 1.9, b1);
    if (!shop && cat > 2.5 && b2 > 0.4) onRate = mix(0.05, 0.9, step(0.5, hash12(vec2(row * 3.0 + mod(sid, 37.0), mod(sid, 53.0)))));
    // A tower at night is mostly dark glass: a few storeys lit as bands, the rest a mirror for the city.
    float tall = smoothstep(70.0, 110.0, height);
    if (!shop) onRate = mix(onRate, 0.02 + 0.8 * step(0.9, hash12(vec2(row * 5.0 + mod(sid, 41.0), mod(sid, 59.0)))), tall);
    onRate = clamp(onRate, 0.0, 0.95);
    // Some rooms stay as they are all night. The others (uWindowLife.x of them) are lived in: every so often,
    // each room on its own clock (90 to 330 s, divided by the pace uWindowLife.y), someone may come in or
    // leave, and the light goes on or off over a second.
    float fickle = step(1.0 - uWindowLife.x, hash12(room + 31.0));
    float period = (90.0 + 240.0 * hash12(room + 37.0)) / max(uWindowLife.y, 0.01);
    float clock = uTime / period + hash12(room + 41.0), slot = floor(clock);
    float lit = mix(step(1.0 - onRate, hash12(room + 43.0 + (slot - 1.0) * 7.0)), step(1.0 - onRate, hash12(room + 43.0 + slot * 7.0)), smoothstep(0.0, 1.2 / period, fract(clock)));
    float on = mix(step(1.0 - onRate, hash12(room + 23.0)), lit, fickle);
    // The colour of the light: homes mostly warm bulbs, some cool, the odd blue of a television; an office
    // building one kind of tube throughout, cool white more often than warm. Brightness varies room by room
    // and building by building.
    float tint = hash12(room + 61.0), office = step(2.5, cat);
    vec3 warm = mix(vec3(1.0, 0.6, 0.3), vec3(1.0, 0.82, 0.6), hash12(room + 67.0));
    // (uNightBlue leans the city towards blue: bluer cool lamps, more of them, more rooms in screen light)
    vec3 cool = mix(vec3(1.0, 0.95, 0.86), mix(vec3(0.78, 0.9, 1.0), vec3(0.42, 0.66, 1.0), uNightBlue), hash12(room + 71.0));
    float coolShare = mix(0.25, mix(0.12, 0.95, step(0.35, b2)), office) + 0.45 * uNightBlue;
    vec3 lamp = mix(warm, cool, step(1.0 - coolShare, mix(tint, 0.5 * b3 + 0.5 * tint, office)));
    lamp = mix(lamp, vec3(0.3, 0.55, 1.0), step(0.93 - 0.22 * uNightBlue, tint) * mix(1.0 - office, 1.0, uNightBlue));
    if (blade > 0.5) lamp = mix(vec3(1.0, 0.52, 0.14), vec3(1.0, 0.22, 0.48), step(0.8, hash12(room + 9.0)));
    if (cyber > 0.5) {
      float neonPick = hash12(room + 4.4);
      lamp = neonPick > 0.66 ? vec3(1.0, 0.06, 0.5) : neonPick > 0.33 ? vec3(0.12, 0.9, 1.0) : vec3(0.48, 0.16, 1.0);
    }
    float glow = mix(0.3, 1.35, hash12(room + 1.3)) * mix(0.65, 1.25, b3);
    if (blade > 0.5) glow *= 1.45;
    if (cyber > 0.5) glow *= 1.65;

    // glass: mostly a mirror of the sky; the room behind shows through as emitted light
    vec3 glassTint = cat > 4.5 ? mix(vec3(0.2, 0.3, 0.38), vec3(0.3, 0.33, 0.34), fract(seed * 5.7)) : vec3(0.1, 0.11, 0.12);
    if (blade > 0.5) glassTint = vec3(0.045, 0.04, 0.038);
    if (cyber > 0.5) glassTint = vec3(0.02, 0.035, 0.05);
    vec3 frameCol = fract(seed * 3.3) < 0.5 ? vec3(0.16, 0.17, 0.18) : vec3(0.62, 0.63, 0.63);
    diffuseColor.rgb = mix(diffuseColor.rgb, frameCol, inWin * frame);
    diffuseColor.rgb = mix(diffuseColor.rgb, glassTint, pane);
    gRough = mix(gRough, 0.45, inWin * frame);
    gRough = mix(gRough, 0.05, pane);
    gMetal = mix(gMetal, 0.92, pane);
    gNm = mix(gNm, normalize(vec3((hash12(room + 5.1) - 0.5) * 0.03, (hash12(room + 9.4) - 0.5) * 0.03, 1.0)), inWin);
    float daylight = (1.0 - uNight) * (shop ? 0.3 : cat > 4.5 ? 0.06 : 0.12);
    gEmissive = pane * interior * (daylight + uNight * on * glow * 1.25 * lamp);
    // The sun in the glass. Each pane sits a little out of true and float glass is never quite flat, so the
    // mirrored sun is a hot core with a glare around it that wanders from pane to pane as the view moves. The
    // third, wide term is not physics: the true mirror image is only seen from below the sun's own height, and
    // this lets glass facing the sun catch some of its light from the air too.
    {
      vec3 wobble = vec3(vnoise(st * 0.8 + seed * 9.0) - 0.5, vnoise(st * 0.8 + 31.0 + seed * 9.0) - 0.5, 0.0) * 0.035;
      vec3 paneN = normalize(gT * (gNm.x + wobble.x) + gB * (gNm.y + wobble.y) + gN * gNm.z);
      float s = max(dot(reflect(normalize(vWPos - cameraPosition), paneN), uSunDir), 0.0);
      gGlint = pane * uGlintOn * uSunGlint * (pow(s, 1400.0) * 14.0 + pow(s, 90.0) * 0.35 + pow(s, 7.0) * 0.1) * step(0.0, dot(gN, uSunDir));
    }
    // Some towers (more of them as uNightBlue rises) are lit in one colour throughout: their lit rooms shine
    // blue or golden yellow — a few cyan or violet — instead of white. (Window light only: thin lines of light
    // along edges and floors shimmer at a distance.)
    {
      float pickA = fract(seed * 31.7), hue = fract(seed * 47.3);
      float accent = tall * step(0.7 - 0.45 * uNightBlue, pickA) * uNight * (1.0 - max(blade, cyber));
      vec3 accentCol = hue < 0.42 ? vec3(0.12, 0.38, 1.0) : hue < 0.76 ? vec3(1.0, 0.72, 0.16) : hue < 0.89 ? vec3(0.1, 0.85, 1.0) : vec3(0.75, 0.3, 1.0);
      gEmissive = mix(gEmissive, accentCol * dot(gEmissive, vec3(0.9)), accent * 0.8);
    }
    // The city in the glass of a tower at night. The mirrored view ray is followed down to street level, where
    // the lights of the city lie as a field of points fixed to the ground (a lamp or a window every 26 m or
    // so, warm or cool), so the reflection slides over the glass as the view moves, as a real one does.
    if (tall > 0.0 && uNight > 0.01 && uCityGlass > 0.0) {
      vec3 paneN = normalize(gT * gNm.x + gB * gNm.y + gN * gNm.z), R = reflect(V, paneN);
      float fresnel = 0.1 + 0.9 * pow(1.0 - max(dot(-V, paneN), 0.0), 4.0);
      vec3 city = vec3(0.0);
      if (R.y < -0.015) {
        float reach = (vWPos.y - 12.0) / -R.y;                      // metres along the ray to street level
        vec2 g = (vWPos.xz + R.xz * reach) / 26.0, cell = floor(g);
        vec2 at = vec2(hash12(cell + 3.1), hash12(cell + 7.7));
        float d = length(fract(g) - at) * 26.0, kind = hash12(cell + 13.0);
        float spot = exp(-d * d / (3.0 + reach * 0.03)) * step(0.3, kind);
        vec3 tintC = kind > 0.8 - 0.3 * uNightBlue ? mix(vec3(0.8, 0.9, 1.0), vec3(0.4, 0.65, 1.0), uNightBlue) : kind > 0.42 && kind < 0.5 ? vec3(1.0, 0.25, 0.2) : vec3(1.0, 0.72, 0.42);
        city = tintC * spot * 5.0 / (1.0 + reach * reach / 4.0e5);
        city += vec3(1.0, 0.75, 0.5) * 0.035 * smoothstep(0.0, 900.0, reach);  // and their haze towards the horizon
      }
      gEmissive += city * fresnel * pane * tall * uNight * uCityGlass * (1.0 - on * 0.9);
    }
    gPane = pane * (1.0 - 0.7 * far) * (1.0 - 0.85 * uNight * on); // (a lit room shows itself, not a reflection)
    // the lintel shades the top of the opening
    diffuseColor.rgb *= 1.0 - 0.35 * inWin * (1.0 - smoothstep(0.0, 0.18, wmax.y - pm.y)) * (1.0 - far);

    // sign band over shopfronts
    if (shop) {
      float sign = box(fy, 0.84, 0.985, wy) * box(fx, 0.03, 0.97, wx) * valid * step(0.25, hash12(room + 57.0));
      vec3 sc = mix(hue(hash12(room + 71.0)), vec3(0.95), 0.35 * step(0.6, hash12(room + 83.0)));
      diffuseColor.rgb = mix(diffuseColor.rgb, sc * 0.75, sign);
      gEmissive += sign * sc * uNight * 1.6;
      gRough = mix(gRough, 0.4, sign);
    }
    float nightSign = 0.2 + 0.8 * uNight;
    if (blade > 0.5) {
      float spine = step(0.7, hash12(vec2(col, sid))) * box(fx, 0.02, 0.09, wx) * valid;
      vec3 sodium = fract(seed * 9.1) > 0.5 ? vec3(1.0, 0.16, 0.32) : vec3(1.0, 0.68, 0.18);
      gEmissive += spine * sodium * 5.0 * nightSign;
      float crown = step(height - floorH * 1.35, v) * step(v, height - 0.35) * box(fx, 0.05, 0.95, wx);
      vec3 bill = hue(fract(seed * 3.7 + col * 0.17));
      float board = crown * step(0.28, hash12(vec2(floor(u / 2.0), sid)));
      diffuseColor.rgb = mix(diffuseColor.rgb, bill * 0.35, board);
      gEmissive += board * bill * 4.2 * nightSign;
      diffuseColor.rgb *= mix(1.0, 0.4, smoothstep(0.78, 0.96, fy));
    }
    if (cyber > 0.5) {
      float plate = 1.0 - smoothstep(0.0, 0.07, abs(fy - 0.06));
      vec3 edgeCol = fract(row * 0.17 + seed * 5.0) > 0.5 ? vec3(1.0, 0.04, 0.42) : vec3(0.08, 0.95, 1.0);
      gEmissive += plate * valid * edgeCol * 4.6 * nightSign;
      float corner = step(0.9, fx) * valid;
      gEmissive += corner * vec3(0.15, 1.0, 0.8) * 2.8 * nightSign;
      float slat = step(0.45, hash12(vec2(row, sid))) * box(fy, 0.42, 0.5, wy) * box(fx, 0.12, 0.88, wx) * valid;
      gEmissive += slat * edgeCol * 2.2 * nightSign;
      if (height < 16.5) {
        float porch = step(v, floorH * 0.98) * box(fx, 0.1, 0.9, wx) * box(fy, 0.7, 0.92, wy) * valid;
        gEmissive += porch * edgeCol * 3.6 * nightSign;
      }
    }
    markBot(uBots[0], pane);
    markBot(uBots[1], pane);
    markBot(uBots[2], pane);
    markBot(uBots[3], pane);
    markBot(uBots[4], pane);
  }
}
`;

const NO_PHOTO = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
NO_PHOTO.needsUpdate = true;

// One instance per tile that has a wall photo atlas (they share the program); set it with material.userData.photo.
// The real wall, from PLATEAU's aerial photo: too smeared to stand in front of, right from across the city.
const PHOTO_PARS = /* glsl */ `
uniform sampler2D uPhoto;
uniform float uPhotoOn;
uniform vec2 uPhotoRange;
uniform float uPhotoMix;
varying vec2 vPhoto;
`;
const PHOTO_MAIN = /* glsl */ `
{
  vec3 photo = texture2D(uPhoto, vPhoto).rgb; // (sampled outside the branch: derivatives)
  float k = uPhotoOn * uPhotoMix * step(0.0, vPhoto.x) * smoothstep(uPhotoRange.x, uPhotoRange.y, distance(cameraPosition, vWPos)) * step(gStyle, 0.5);
  diffuseColor.rgb = mix(diffuseColor.rgb, photo * 1.12, k);
  gRough = mix(gRough, 0.85, k);
  gMetal *= 1.0 - k;
  float cap = smoothstep(0.62, 0.92, normalize(vWNrm).y);
  cap *= 0.72 + 0.28 * hash12(floor(vWPos.xz * 0.4));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.85, 0.93), cap * uSnow);
  gRough = mix(gRough, 0.78, cap * uSnow);
}
`;

function facadeMaterial(tex) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0 });
  m.userData.photo = { value: NO_PHOTO }; m.userData.photoOn = { value: 0 };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uLampOn: { value: 0 }, uLampMap: shared.uLampMap, // (no lamp light on buildings; the sampler still needs its texture)
      uPhoto: m.userData.photo, uPhotoOn: m.userData.photoOn, uPhotoRange: shared.uPhotoRange, uPhotoMix: shared.uPhotoMix,
      uNight: shared.uNight, uTime: shared.uTime, uWindowLife: shared.uWindowLife, uCityGlass: shared.uCityGlass, uNightBlue: shared.uNightBlue, uSnow: shared.uSnow, uBots: shared.uBots, uSunDir: shared.uSunDir, uSunGlint: shared.uSunGlint, uGlintOn: shared.uGlintOn, uWallAlb: { value: tex.wall.albedo }, uWallNor: { value: tex.wall.normal },
      uWallScale: { value: tex.wall.scales }, uWallDetail: { value: tex.wall.details },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aFacade;\nattribute vec4 aBldg;\nattribute vec2 aPhoto;\nvarying vec4 vFacade;\nvarying vec4 vBldg;\nvarying vec2 vPhoto;\n${WORLD_VARYINGS_VERT}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvFacade = aFacade;\nvBldg = aBldg;\nvPhoto = aPhoto;\n${WORLD_VARYINGS_SET}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FACADE_PARS + PHOTO_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FACADE_MAIN + PHOTO_MAIN)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = gMetal;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + APPLY_NORMAL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmissive;')
      // (the direct diffuse light is zero in shadow: it tells whether the sun reaches this pane)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directSpecular += gGlint * smoothstep(0.0, 0.002, dot(reflectedLight.directDiffuse, vec3(0.333)));')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a = 1.0 - 0.95 * gPane;');
  };
  m.customProgramCacheKey = () => 'facade-v28';
  return m;
}

// ---------------------------------------------------------------- ground
// Terrain and road surfaces: vertex colour x texture detail, layer from the aLayer attribute
// (roads) or fixed (terrain).
const GROUND_PARS = /* glsl */ `
uniform sampler2DArray uGroundAlb;
uniform sampler2DArray uGroundNor;
uniform float uGroundScale[4];
uniform float uFixedLayer;
uniform sampler2D uOrtho;
uniform vec4 uOrthoRect;
uniform float uOrthoOn;
uniform float uDark;
uniform float uWet;
uniform float uSnow;
uniform float uTime;
varying float vLayer;
varying vec3 vWPos;
varying vec3 vWNrm;
vec3 gT, gB, gN, gNm;
float gRough;
${NOISE}
`;
const GROUND_MAIN = /* glsl */ `
{
  gN = normalize(vWNrm);
  gT = normalize(cross(gN, vec3(0.0, 0.0, 1.0)) + vec3(1e-4, 0.0, 0.0));
  gB = cross(gT, gN); // +z on flat ground, matching the texture's v axis
  vec3 tint = diffuseColor.rgb;
  float layer = uFixedLayer >= 0.0 ? uFixedLayer : floor(vLayer + 0.5);
  bool water = layer > 3.5;
  layer = min(layer, 3.0);
  float sc = uGroundScale[int(layer)];
  vec2 st = abs(gN.y) > 0.5 ? vWPos.xz : vec2(vWPos.x + vWPos.z, vWPos.y);
  vec3 a = texture(uGroundAlb, vec3(st / sc, layer)).rgb * 2.0;
  vec3 b = texture(uGroundAlb, vec3(st / (sc * 3.7) + 0.37, layer)).rgb * 2.0;
  float blotch = vnoise(st * 0.045);
  vec3 grain = mix(vec3(1.0), mix(a, b, 0.4), 1.65);
  float grit = vnoise(st * 6.5) * 0.65 + vnoise(st * 17.0) * 0.35;
  float wear = vnoise(st * 0.16);
  diffuseColor.rgb *= grain * (0.72 + 0.5 * blotch) * (0.86 + 0.28 * grit) * (0.9 + 0.18 * wear);
  float nStrength = layer < 0.5 ? 1.85 : layer < 1.5 ? 1.45 : 0.9;
  gNm = texture(uGroundNor, vec3(st / sc, layer)).xyz * 2.0 - 1.0;
  gNm = normalize(vec3(gNm.xy * nStrength, gNm.z));
  gRough = layer < 0.5 ? 0.82 - 0.16 * grit : 0.9 - 0.08 * blotch;
  if (uOrthoOn > 0.5 && !water) {
    vec2 ouv = (vWPos.xz - uOrthoRect.xy) / uOrthoRect.zw;
    if (ouv.x > 0.0 && ouv.x < 1.0 && ouv.y > 0.0 && ouv.y < 1.0) {
      vec3 photo = texture2D(uOrtho, vec2(ouv.x, 1.0 - ouv.y)).rgb;
      photo *= mix(1.0, 0.48, uDark);
      float luma = max(tint.r, max(tint.g, tint.b));
      float paint = smoothstep(0.75, 0.92, luma);
      float cover = 0.55;
      if (layer < 0.5) cover = 0.92;
      else if (layer < 1.5) cover = 0.86;
      else if (uFixedLayer >= 0.0) cover = 0.62;
      cover = mix(cover, 0.08, paint);
      diffuseColor.rgb = mix(diffuseColor.rgb, photo * (0.9 + 0.16 * (grain.r - 0.5)), cover);
    }
  }
  // Close-up street surface. The photo carries the real paint; this puts grit and hardware on it.
  if (layer < 0.5) {
    float chips = vnoise(st * 26.0);
    float ruts = vnoise(vec2(st.x * 0.42, st.y * 1.8));
    diffuseColor.rgb *= 0.9 + 0.2 * chips;
    diffuseColor.rgb *= 0.93 + 0.12 * ruts;
    vec2 cell = floor(st / 21.0);
    vec2 jitter = vec2(hash12(cell), hash12(cell + 7.2));
    vec2 lidAt = (cell + 0.22 + 0.56 * jitter) * 21.0;
    float d = distance(st, lidAt);
    float cap = 1.0 - smoothstep(0.26, 0.46, d);
    float rim = 1.0 - smoothstep(0.0, 0.045, abs(d - 0.4));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.58, 0.6, 0.62), cap * 0.9);
    diffuseColor.rgb += rim * 0.16;
    vec2 radial = st - lidAt;
    radial *= inversesqrt(dot(radial, radial) + 1e-4);
    gNm.xy += vec2(chips - 0.5, ruts - 0.5) * 0.55 + radial * cap * 0.35;
    gNm = normalize(gNm);
    gRough = mix(gRough, 0.48, cap * 0.55);
  } else if (layer < 1.5) {
    vec2 slabCell = floor(st / 0.9);
    float slab = hash12(slabCell);
    vec2 sf = abs(fract(st / 0.9) - 0.5);
    float seam = smoothstep(0.44, 0.49, max(sf.x, sf.y));
    diffuseColor.rgb *= (0.93 + 0.12 * slab) * mix(1.0, 0.8, seam);
  }
  if (uWet > 0.15 && !water && layer < 1.5) {
    float wet = uWet * (layer < 0.5 ? 1.0 : 0.65);
    diffuseColor.rgb *= mix(1.0, layer < 0.5 ? 0.5 : 0.68, wet);
    gRough = mix(gRough, 0.035, wet);
    float rip = vnoise(vec2(st.x * 1.6, st.y * 0.42 + uTime * 2.4));
    float rip2 = vnoise(vec2(st.x * 0.55 + uTime * 0.8, st.y * 2.2));
    gNm.xy += vec2(rip - 0.5, rip2 - 0.5) * 1.1 * wet;
    gNm = normalize(gNm);
    vec3 sheen = vec3(0.62, 0.7, 0.78) * pow(max(rip, 0.0), 2.4) * wet * 0.35;
    if (uLampOn > 0.5 && uLampRect.z > 1.0) {
      vec2 lampUv = vec2(vWPos.x - uLampRect.x, uLampRect.y - vWPos.z) / (2.0 * uLampRect.z) + 0.5;
      lampUv += gNm.xy * 0.015;
      vec3 lamps = texture2D(uLampMap, lampUv).rgb;
      sheen += lamps * wet * (0.45 + 0.55 * rip) * (layer < 0.5 ? 2.8 : 1.1);
    }
    diffuseColor.rgb += sheen;
  }
  if (water) {
    vec2 flow = st * 0.32 + vec2(uTime * 0.4, uTime * 0.15);
    float w1 = vnoise(flow);
    float w2 = vnoise(flow * 2.4 + 11.0);
    diffuseColor.rgb = mix(vec3(0.015, 0.04, 0.055), vec3(0.06, 0.12, 0.15), w1);
    gNm = normalize(vec3((w1 - 0.5) * 0.7, (w2 - 0.5) * 0.7, 1.0));
    gRough = 0.03;
    if (uLampOn > 0.5 && uLampRect.z > 1.0) {
      vec2 lampUv = vec2(vWPos.x - uLampRect.x + gNm.x * 8.0, uLampRect.y - vWPos.z + gNm.y * 8.0) / (2.0 * uLampRect.z) + 0.5;
      diffuseColor.rgb += texture2D(uLampMap, lampUv).rgb * (1.4 + 0.8 * w2);
    }
    diffuseColor.rgb += vec3(0.35, 0.55, 0.7) * pow(w2, 4.0) * 0.25;
  }
  if (!water) {
    float cap = smoothstep(0.55, 0.9, gN.y);
    cap *= 0.7 + 0.3 * vnoise(vWPos.xz * 0.32);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.86, 0.93), cap * uSnow);
    gRough = mix(gRough, 0.8, cap * uSnow);
  }
}
`;

function groundMaterial(tex, { fixedLayer = -1, ...params } = {}) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.92, ...params });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uGroundAlb: { value: tex.ground.albedo }, uGroundNor: { value: tex.ground.normal },
      uGroundScale: { value: tex.ground.scales }, uFixedLayer: { value: fixedLayer },
      uOrtho: shared.uOrtho, uOrthoRect: shared.uOrthoRect, uOrthoOn: shared.uOrthoOn,
      uDark: shared.uDark, uWet: shared.uWet, uSnow: shared.uSnow, uTime: shared.uTime,
      uLampOn: shared.uLampOn, uLampMap: shared.uLampMap, uLampRect: shared.uLampRect,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aLayer;\nvarying float vLayer;\n${WORLD_VARYINGS_VERT}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvLayer = aLayer;\n${WORLD_VARYINGS_SET}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GROUND_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + GROUND_MAIN)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + APPLY_NORMAL);
  };
  m.customProgramCacheKey = () => 'ground-v13';
  return m;
}

function grainMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrain;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrain = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vGrain;
float gHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float gNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float gn = gNoise(vGrain.xz * 2.4) * 0.65 + gNoise(vGrain.xy * 5.5) * 0.35;
        diffuseColor.rgb *= 0.78 + 0.44 * gn;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(0.45 + 0.5 * gNoise(vGrain.xz * 3.1), 0.15, 1.0);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 gdx = dFdx(vGrain), gdy = dFdy(vGrain);
        vec3 gwn = normalize(cross(gdx, gdy) + gdx * (gNoise(vGrain.yz * 8.0) - 0.5) * 0.45 + gdy * (gNoise(vGrain.xy * 8.0) - 0.5) * 0.45);
        normal = normalize(mat3(viewMatrix) * gwn);`);
  };
  m.customProgramCacheKey = () => 'models-grain-v1';
  return m;
}

export function createMaterials(tex) {
  return {
    facade: facadeMaterial(tex),
    facadeFor: () => facadeMaterial(tex), // a tile's own instance, for its wall photos
    // Ground not covered by roads or buildings: private lots, car parks, yards.
    terrain: groundMaterial(tex, { fixedLayer: 3, color: new THREE.Color().setRGB(0.2, 0.2, 0.185) }),
    road: groundMaterial(tex, { vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    // lane lines and crossings: drawn over the road surface, with a stronger depth bias so they never flicker
    paint: groundMaterial(tex, { vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -8 }),
    // PLATEAU models (bridges, street furniture, trees): painted, then broken up so no face stays flat
    models: grainMaterial(),
  };
}
