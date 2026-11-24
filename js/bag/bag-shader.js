// GLSL port of the game's bag shader `Shared/Bag/Look/Resources/HeavyBagV2/HeavyBagV2.shader`, with its includes
// `HeavyBagDent.hlsl` (elastic dent + end bulge, residual sites, travelling wave) and `HeavyBagMark.hlsl` (the one
// fixed-size impact stamp). The probe SH of the gym is replaced by a fixed L0+L1 set picked to sit the bag in the
// night gym (warm ring spot overhead, cool window fill); everything else (form term, satin sheen, metal, dent cavity,
// crest lift, stamp tone, soft impact cue, hoist-chain jolt) is the shipped maths.

export const VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec3 normal; in vec4 tangent; in vec4 color; in vec2 uv; in vec2 uv1;
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform vec4 uJolt; uniform vec4 uJoltShape; uniform vec2 uJoltSpan;
#ifdef DENT
uniform vec4 uDentC; uniform float uDentR;
uniform vec4 uRes[6]; uniform float uResR[6]; uniform float uResN;
uniform vec4 uWaveO; uniform float uWaveAmp; uniform vec4 uWaveA; uniform vec2 uWaveB;
#endif
out vec4 vUv; out vec3 vPos; out vec3 vN; out vec4 vT; out vec4 vCol;
const float PI = 3.14159265;
#ifdef DENT
float waveDist(vec3 wp, vec3 yA, out vec3 gD) {
  vec3 dv = wp - uWaveO.xyz; float a = dot(dv, yA); vec3 sv = dv - a * yA; float ch = length(sv);
  float R = max(uWaveB.x, 0.02); float cf = ch / (2.0 * R); float x = clamp(cf, 0.0, 0.999);
  float arc = 2.0 * R * asin(x); float d = sqrt(a * a + arc * arc);
  float J = cf < 0.999 ? 1.0 / sqrt(max(1.0e-4, 1.0 - x * x)) : 0.0;
  vec3 sh = ch > 1.0e-5 ? sv / ch : vec3(0.0);
  gD = d > 1.0e-5 ? (yA * a + sh * (arc * J)) / d : vec3(0.0);
  return d;
}
float waveDisp(vec3 wp, vec3 yA, out vec3 g) {
  g = vec3(0.0);
  if (uWaveAmp <= 0.0 || uWaveO.w < 0.0) return 0.0;
  vec3 gD; float d = waveDist(wp, yA, gD);
  float Wl = max(uWaveA.y, 0.01); float u = (d - uWaveA.x * uWaveO.w) / Wl; float gg = exp(-0.5 * u * u);
  float m = 1.0 - clamp(uWaveB.y, 0.0, 1.0);
  float P = gg * ((1.0 - m) + m * u * 1.6487212);
  float Pp = gg * (m * 1.6487212 * (1.0 - u * u) - u * (1.0 - m));
  float Ld = max(uWaveA.z, 0.02);
  float E = exp(-d / Ld) * exp(-uWaveO.w / max(uWaveA.w, 0.02));
  float h = uWaveAmp * P * E;
  g = -(uWaveAmp * E * (Pp / Wl - P / Ld)) * gD;
  return h;
}
float dentAt(vec3 wp, vec3 yA, vec3 c, float depth, float radius, out vec3 g) {
  vec3 dv = wp - c; float r2 = max(1.0e-6, radius * radius);
  float h = depth * exp(-dot(dv, dv) / r2);
  g = (-2.0 / r2) * h * dv;
  float La = 2.2 * radius, Lt = 1.4 * radius, La2 = max(1.0e-6, La * La), Lt2 = max(1.0e-6, Lt * Lt);
  float B = 2.0 * depth / (2.2 * 1.4);
  float a = dot(dv, yA); vec3 sv = dv - a * yA; float u2 = (a * a) / La2;
  float E = exp(-u2 - dot(sv, sv) / Lt2); float b = B * u2 * E;
  vec3 gb = yA * ((2.0 * a / La2) * (1.0 - u2) * E) - sv * ((2.0 / Lt2) * u2 * E);
  g -= B * gb;
  return b - h;
}
#endif
void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  mat3 m3 = mat3(modelMatrix);
  vec3 nW = normalize(m3 * normal);
  float s = 0.0;
#ifdef DENT
  vec3 yA = normalize(m3 * vec3(0.0, 1.0, 0.0));
  vec3 gW = vec3(0.0), g;
  if (uDentC.w > 1.0e-4) { s += dentAt(wp, yA, uDentC.xyz, uDentC.w, uDentR, g); gW += g; }
  for (int i = 0; i < 6; i++) { if (float(i) < uResN) { s += dentAt(wp, yA, uRes[i].xyz, uRes[i].w, uResR[i], g); gW += g; } }
  s += waveDisp(wp, yA, g); gW += g;
  vec3 gTan = gW - dot(gW, nW) * nW;
  vec3 nW2 = normalize(nW + gTan);
  wp += nW * s; nW = nW2;
#endif
  // hoist/chain jolt (HeavyBagV2 BagV2Jolt)
  if (uJolt.w >= 0.0 && color.a > 0.0) {
    float dist = uv1.y, w = color.a;
    if (uv1.x > 0.5) {
      float span = max(0.05, uJoltSpan.y - uJoltSpan.x); float hh = clamp((wp.y - uJoltSpan.x) / span, 0.0, 1.0);
      w *= sin(PI * hh); dist = wp.y - uJoltSpan.x;
    }
    float t = uJolt.w - dist / max(0.1, uJoltShape.z);
    if (t > 0.0) wp += uJolt.xyz * (w * exp(-uJolt.w / max(0.02, uJoltShape.y)) * sin(2.0 * PI * uJoltShape.x * t));
  }
  vPos = wp; vN = nW; vT = vec4(normalize(m3 * tangent.xyz), tangent.w);
  vUv = vec4(uv, uv1);
  vCol = vec4(color.rg, clamp(-s / 0.009, 0.0, 1.0), clamp(s / 0.02, 0.0, 1.0));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

export const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uAlb, uPack, uGrain;
uniform vec3 cameraPosition;
uniform float uDetail, uExposure, uSpecLeather;
uniform vec3 uTintA, uTintB;
uniform vec3 uKeyDir, uKeyCol, uSh0, uShX, uShY, uShZ;
uniform vec4 uMarkAo, uMarkFresh, uMarkN, uMarkAxis; uniform vec3 uMarkC;
uniform vec4 uImp, uImpB, uImpC;
in vec4 vUv; in vec3 vPos; in vec3 vN; in vec4 vT; in vec4 vCol;
out vec4 outC;
const float FORM_FLOOR = 0.62, FORM_GAIN = 0.85, RIM_SHEEN = 0.18, SPEC_METAL = 2.0, ENV_METAL = 1.6;
const float DENT_CAVITY = 0.55, CREST_LIFT = 0.30, IMPACT_R = 0.10;
const vec3 IMPACT_COLOR = vec3(1.25, 0.92, 0.62);
vec3 sh(vec3 n) { return uSh0 + uShX * n.x + uShY * n.y + uShZ * n.z; }
vec3 markTone(vec3 p) {
  if (uMarkAo.x <= 0.0001 || uMarkFresh.w < 0.5 || uMarkFresh.x <= 0.0001 || uMarkFresh.y <= 0.0001) return vec3(1.0);
  if (dot(p - uMarkAxis.xyz, uMarkN.xyz) <= 0.0) return vec3(1.0);
  vec3 dv = p - uMarkC; dv -= uMarkN.xyz * dot(dv, uMarkN.xyz);
  float q = dot(dv, dv) / max(1.0e-6, uMarkFresh.y * uMarkFresh.y);
  if (q >= 1.0) return vec3(1.0);
  float mask = 1.0 - smoothstep(0.18, 1.0, q);
  float amount = clamp(uMarkAo.x * uMarkFresh.x * uMarkFresh.z * mask, 0.0, 1.0);
  return mix(vec3(1.0), mix(vec3(0.16), vec3(0.19, 0.13, 0.09), clamp(uMarkAo.z, 0.0, 1.0)), amount);
}
vec3 srgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec4 alb = texture(uAlb, vUv.xy);
  vec4 pack = texture(uPack, vUv.xy);
  float metal = clamp(vCol.r + vCol.g, 0.0, 1.0);
  vec2 nxy = pack.rg * 2.0 - 1.0;
  vec2 dxy = texture(uGrain, vUv.zw).rg * 2.0 - 1.0;
  nxy += dxy * (uDetail * (1.0 - metal));
  vec3 nTS = vec3(nxy, sqrt(clamp(1.0 - dot(nxy, nxy), 0.0, 1.0)));
  vec3 nV = normalize(vN); vec3 tV = normalize(vT.xyz - nV * dot(nV, vT.xyz)); vec3 bV = vT.w * cross(nV, tV);
  vec3 N = normalize(nTS.x * tV + nTS.y * bV + nTS.z * nV);
  vec3 V = normalize(cameraPosition - vPos);
  vec3 L = uKeyDir;
  vec3 tint = mix(mix(vec3(1.0), uTintA, vCol.r), uTintB, vCol.g);
  vec3 albedo = alb.rgb * tint;
  vec3 shN = max(vec3(0.0), sh(N));
  float ndl = dot(N, L);
  float form = clamp(ndl * 0.5 + 0.5, 0.0, 1.0); form *= form;
  float gloss = pack.b;
  float specPow = exp2(gloss * 9.0 + 2.0);
  vec3 H = normalize(L + V);
  float spec = pow(clamp(dot(N, H), 0.0, 1.0), specPow) * (specPow + 8.0) * 0.0398 * clamp(ndl * 3.0, 0.0, 1.0);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  vec3 leather = albedo * shN * (FORM_FLOOR + FORM_GAIN * form) + uKeyCol * (spec * 0.04 * uSpecLeather * gloss)
               + shN * (pow(1.0 - ndv, 4.0) * RIM_SHEEN);
  vec3 env = max(vec3(0.0), sh(reflect(-V, N)));
  vec3 metalCol = albedo * (env * ENV_METAL * (0.35 + 0.65 * form) + uKeyCol * spec * SPEC_METAL);
  vec3 col = mix(leather, metalCol, metal);
  col *= (1.0 - DENT_CAVITY * vCol.b) * (1.0 + CREST_LIFT * vCol.a);
  col *= markTone(vPos);
  col *= uExposure;
  if (uImp.w >= 0.0) {
    float age = uImp.w;
    float cue = smoothstep(0.0, uImpB.y, age) * (1.0 - smoothstep(uImpB.y, uImpB.z, age));
    vec3 d = vPos - uImp.xyz;
    float f = exp(-dot(d, d) / (IMPACT_R * IMPACT_R)) * cue * uImpB.x;
    col = col * (1.0 + uImpC.rgb * f) + IMPACT_COLOR * (f * uImpB.w);
  }
  outC = vec4(srgb(col), 1.0);
}`;
