/**
 * THE EFFECT REGISTRY
 * -------------------
 * One entry per effect. Adding a new effect means adding one entry here and
 * nothing else: the Effects panel builds its sliders from `params`, and the
 * renderer runs `frag` for each object `passes()` returns.
 *
 * Each entry:
 *   label   the name a human sees
 *   params  slider definitions, used to build the panel and the defaults
 *   frag    a fragment shader (GLSL ES 1.0)
 *   passes  turns slider values into one uniform object per drawing pass.
 *           Most effects need a single pass. Blur needs two, because a blur
 *           done sideways and then downwards is far cheaper than a round one.
 *
 * Every shader is handed these automatically:
 *   uTex    the layer so far, as a texture
 *   uSize   the layer size in pixels
 *   uTime   the current time in seconds
 *
 * Colours here are PREMULTIPLIED (the red, green and blue channels have
 * already been multiplied by alpha). That is what keeps blurred edges from
 * turning grey. Any effect that changes brightness must scale all four
 * channels together, and anything added must be scaled by alpha first.
 */

const GRAIN_FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;
uniform float uAmount;
uniform float uGrainSize;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec4 c = texture2D(uTex, vUv);
  // Grain sits on a coarse grid so it reads as film, not as screen noise.
  vec2 cell = floor(vUv * uSize / max(uGrainSize, 1.0));
  float n = hash(cell + floor(uTime * 24.0) * 1.7) - 0.5;
  c.rgb += n * uAmount * c.a;
  gl_FragColor = c;
}`;

const VIGNETTE_FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uAmount;
uniform float uSoftness;
varying vec2 vUv;

void main() {
  vec2 d = vUv - 0.5;
  d.x *= uSize.x / uSize.y;     // measure the distance in round units
  float r = length(d) * 1.41421356;
  float edge = 1.0 - uAmount * smoothstep(1.0 - uSoftness, 1.0, r);
  gl_FragColor = texture2D(uTex, vUv) * edge;
}`;

export const EFFECTS = {
  /**
   * Blur is the one effect that is not a shader.
   *
   * A five-tap gaussian only looks smooth over a few pixels. Stretched across
   * a wide radius the taps sit too far apart and the original edges survive
   * as ribbing: nine white bars blurred hard still read as nine bars. Canvas2D
   * has a real gaussian built into the browser that does not do that, and it
   * is cheaper as well, so blur is handed to it. See Stage.blurred.
   *
   * The radius is per 1000 pixels of slide width, not in pixels, because the
   * preview is drawn smaller than the export and a blur measured in pixels
   * would come out weaker in the file than it looked on screen.
   */
  blur: {
    label: 'Blur',
    byCanvas: true,
    params: {
      radius: { label: 'Radius', min: 0, max: 60, step: 1, default: 12 },
    },
  },

  grain: {
    label: 'Film grain',
    params: {
      amount: { label: 'Amount', min: 0, max: 0.5, step: 0.01, default: 0.09 },
      size: { label: 'Size', min: 1, max: 6, step: 0.5, default: 1.5 },
    },
    frag: GRAIN_FRAG,
    passes: v => [{ uAmount: v.amount, uGrainSize: v.size }],
  },

  vignette: {
    label: 'Vignette',
    params: {
      amount: { label: 'Amount', min: 0, max: 1, step: 0.02, default: 0.45 },
      softness: { label: 'Softness', min: 0.1, max: 1, step: 0.02, default: 0.8 },
    },
    frag: VIGNETTE_FRAG,
    passes: v => [{ uAmount: v.amount, uSoftness: v.softness }],
  },
};

/** The starting slider values for a freshly added effect. */
export function defaultParams(type) {
  const spec = EFFECTS[type];
  if (!spec) return {};
  const out = {};
  for (const [key, def] of Object.entries(spec.params)) out[key] = def.default;
  return out;
}

export function makeEffect(type) {
  return { type, params: defaultParams(type) };
}

/** Fill in any slider the saved file is missing, so old drafts keep working. */
export function withDefaults(effect) {
  return { ...effect, params: { ...defaultParams(effect.type), ...effect.params } };
}
