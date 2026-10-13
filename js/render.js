/**
 * THE RENDERER
 * ------------
 * One function draws a slide: `render(stage, project, t)`. The small preview on
 * the editor screen and the full-size export both call it, with nothing
 * different but the size of the stage. If it looks right in the preview it is
 * right in the file.
 *
 * How a frame is built:
 *   1. fill the stage with the room colour
 *   2. for each visible layer, draw it alone onto a scratch canvas
 *   3. run that scratch canvas through the layer's effects (blur on the 2D
 *      canvas, the rest in WebGL)
 *   4. composite the result onto the stage
 *
 * Drawing a layer on its own is what makes per-layer effects possible, and it
 * is also what will make a corner-pin warp possible later: a warp is just
 * another pass on step 3.
 *
 * A layer with no effects and nothing to see through skips steps 2 to 4 and
 * goes straight onto the slide. It looks identical and costs a fraction: a
 * clear and a copy of the whole slide, per layer, per frame, is most of what
 * a frame was spending.
 */

import { valueAt, turnsPerLoop, formatTime, isKeyed } from './model.js';
import { EFFECTS, withDefaults } from './effects.js';
import { coverTones, withAlpha } from './color.js';

const ROOM = '#0E0D0C';

const FONTS = {
  serif: '"Instrument Serif", Georgia, "Times New Roman", serif',
  sans: '"DM Sans", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
};

// ===========================================================================
// WebGL: running a layer through its effects
// ===========================================================================

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/**
 * A small WebGL helper. It holds two textures and swaps between them, so a
 * chain of effects can read the result of the one before it.
 */
class EffectGL {
  constructor(width, height) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl = this.canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      // Kept true so the 2D canvas can copy this one straight after a draw.
      preserveDrawingBuffer: true,
    });
    this.programs = new Map();
    this.ok = !!this.gl;
    if (!this.ok) return;

    const gl = this.gl;
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    this.sourceTexture = this.makeTexture(width, height);
    this.targets = [this.makeTarget(width, height), this.makeTarget(width, height)];
  }

  makeTexture(width, height) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return tex;
  }

  makeTarget(width, height) {
    const gl = this.gl;
    const texture = this.makeTexture(width, height);
    const frame = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texture, frame };
  }

  program(frag) {
    if (this.programs.has(frag)) return this.programs.get(frag);
    const gl = this.gl;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error('Shader failed: ' + gl.getShaderInfoLog(shader));
      }
      return shader;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Program failed: ' + gl.getProgramInfoLog(prog));
    }
    const entry = { prog, uniforms: new Map() };
    this.programs.set(frag, entry);
    return entry;
  }

  location(entry, name) {
    if (!entry.uniforms.has(name)) {
      entry.uniforms.set(name, this.gl.getUniformLocation(entry.prog, name));
    }
    return entry.uniforms.get(name);
  }

  /**
   * Run `chain` over `source` (a canvas) and leave the result on this.canvas.
   * Returns false if there was nothing to do.
   */
  run(source, chain, t) {
    const gl = this.gl;
    const { width, height } = this.canvas;

    // Flatten the chain into a list of drawing passes up front, so we know
    // which one is last and should go to the screen rather than a texture.
    const steps = [];
    for (const raw of chain) {
      const spec = EFFECTS[raw.type];
      if (!spec) continue;
      const effect = withDefaults(raw);
      for (const uniforms of spec.passes(effect.params)) {
        steps.push({ frag: spec.frag, uniforms });
      }
    }
    if (steps.length === 0) return false;

    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);

    let input = this.sourceTexture;
    steps.forEach((step, index) => {
      const last = index === steps.length - 1;
      const target = this.targets[index % 2];
      gl.bindFramebuffer(gl.FRAMEBUFFER, last ? null : target.frame);

      const entry = this.program(step.frag);
      gl.useProgram(entry.prog);

      const aPos = gl.getAttribLocation(entry.prog, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, input);
      gl.uniform1i(this.location(entry, 'uTex'), 0);
      gl.uniform2f(this.location(entry, 'uSize'), width, height);
      gl.uniform1f(this.location(entry, 'uTime'), t);

      for (const [name, value] of Object.entries(step.uniforms)) {
        const loc = this.location(entry, name);
        if (loc === null) continue;
        if (Array.isArray(value)) {
          if (value.length === 2) gl.uniform2f(loc, value[0], value[1]);
          else if (value.length === 3) gl.uniform3f(loc, value[0], value[1], value[2]);
          else gl.uniform4f(loc, value[0], value[1], value[2], value[3]);
        } else {
          gl.uniform1f(loc, value);
        }
      }

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      input = target.texture;
    });

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  }

  dispose() {
    const lose = this.gl && this.gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  }
}

// ===========================================================================
// The stage: everything one render needs, at one size
// ===========================================================================

export class Stage {
  /**
   * @param {number} width  pixels
   * @param {number} height pixels
   * @param {object} media  decoded images, e.g. { photo: ImageBitmap, cover: ImageBitmap }
   */
  constructor(width, height, media = {}) {
    this.width = width;
    this.height = height;
    this.media = media;

    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d', { alpha: false });

    this.layerCanvas = document.createElement('canvas');
    this.layerCanvas.width = width;
    this.layerCanvas.height = height;
    this.layerCtx = this.layerCanvas.getContext('2d');

    // Made on demand. Grain and vignette are the only things that need it,
    // and most slides have neither; a WebGL context costs real time to set
    // up, and a phone will only hand out so many of them.
    this.effects = null;
    this.blurCanvas = null;

    // ponytail: one slot. Only a layer with effects is worth keeping, and in
    // both templates that is the photo and nothing else. Two effect-laden
    // layers would take turns and neither would hit. Make it a Map keyed by
    // layer id if that ever becomes a real arrangement.
    this.kept = { key: null, canvas: null };
  }

  /** Changes whenever a different photo or cover has been handed over. */
  mediaKey() {
    if (this.lastPhoto !== this.media.photo || this.lastCover !== this.media.cover) {
      this.lastPhoto = this.media.photo;
      this.lastCover = this.media.cover;
      this.mediaCount = (this.mediaCount || 0) + 1;
    }
    return this.mediaCount;
  }

  /** The finished layer saved under this key, or null. */
  fromKept(key) {
    return this.kept.key === key ? this.kept.canvas : null;
  }

  /** Save a finished layer. The copy happens once, not once a frame. */
  keep(key, finished) {
    if (!this.kept.canvas) {
      this.kept.canvas = document.createElement('canvas');
      this.kept.canvas.width = this.width;
      this.kept.canvas.height = this.height;
      this.keptCtx = this.kept.canvas.getContext('2d');
    }
    this.keptCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.keptCtx.clearRect(0, 0, this.width, this.height);
    this.keptCtx.drawImage(finished, 0, 0);
    this.kept.key = key;
    return this.kept.canvas;
  }

  /** Clear the scratch canvas and hand back its context. */
  beginLayer() {
    this.layerCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.layerCtx.clearRect(0, 0, this.width, this.height);
    return this.layerCtx;
  }

  /**
   * The browser's own gaussian, on a scratch canvas of the same size.
   *
   * `pixels` is in this stage's pixels, so the caller converts from the
   * stored radius first. Anything smaller than half a pixel is not a blur.
   */
  blurred(source, pixels) {
    if (!(pixels >= 0.5)) return source;
    // Safari only learned this in 17. On anything older the layer is drawn
    // sharp rather than wrong, and nothing else about the slide changes.
    if (!('filter' in this.layerCtx)) return source;
    if (!this.blurCanvas) {
      this.blurCanvas = document.createElement('canvas');
      this.blurCanvas.width = this.width;
      this.blurCanvas.height = this.height;
      this.blurCtx = this.blurCanvas.getContext('2d');
    }
    const c = this.blurCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.filter = 'none';
    c.clearRect(0, 0, this.width, this.height);
    c.filter = `blur(${pixels}px)`;
    c.drawImage(source, 0, 0);
    c.filter = 'none';
    return this.blurCanvas;
  }

  /**
   * Whichever canvas holds the finished layer.
   *
   * Blur runs first and on the 2D canvas; everything else runs after it, on
   * the GPU. That is also the order that makes sense: film grain belongs on
   * top of a blurred photo, not underneath it where the blur would wipe it.
   */
  applyEffects(chain, t) {
    if (!chain || chain.length === 0) return this.layerCanvas;
    // A keyed slider is read at this moment; everything below sees numbers.
    chain = chain.map(effect => ({
      ...effect,
      params: Object.fromEntries(Object.entries(effect.params || {})
        .map(([key, value]) => [key, valueAt(value, t)])),
    }));

    // Two blurs on one layer add up as the squares of their radii, the same
    // way two gaussians do. One blur is the case that actually happens.
    const radii = chain
      .filter(effect => effect.type === 'blur')
      .map(effect => withDefaults(effect).params.radius || 0);
    let source = radii.length
      ? this.blurred(this.layerCanvas, (Math.hypot(...radii) * this.width) / 1000)
      : this.layerCanvas;

    const shaders = chain.filter(effect => effect.type !== 'blur');
    if (shaders.length === 0) return source;
    if (!this.effects) this.effects = new EffectGL(this.width, this.height);
    if (!this.effects.ok) return source;
    try {
      return this.effects.run(source, shaders, t) ? this.effects.canvas : source;
    } catch (error) {
      console.warn('Effect failed, drawing the layer plain:', error);
      return source;
    }
  }

  dispose() {
    if (this.effects) this.effects.dispose();
    this.effects = null;
  }
}

// ===========================================================================
// render
// ===========================================================================

/**
 * These two draw a different picture at every moment of the loop. Everything
 * else draws the same picture the whole way round, whatever `t` says.
 */
const MOVES_WITH_TIME = new Set(['disc', 'progressBar']);

/** True when this layer looks the same at every moment of the loop. */
function holdsStill(layer) {
  if (MOVES_WITH_TIME.has(layer.type)) return false;
  // The card shows the photo through it, which its own signature knows
  // nothing about. glassBehind keeps the expensive part instead.
  if (layer.type === 'card') return false;
  if (Object.values(layer.props).some(isKeyed)) return false;
  return !(layer.effects || []).some(effect => Object.values(effect.params || {}).some(isKeyed));
}

/**
 * Everything the drawing of this layer depends on, as one string. Different
 * string, different picture; same string, the saved one will do.
 */
function layerSignature(layer, project, stage) {
  return JSON.stringify([
    layer.id, layer.props, layer.effects,
    stage.width, stage.height, stage.mediaKey(),
    project.palette, project.song.title, project.song.artist,
  ]);
}

export function render(stage, project, t) {
  const ctx = stage.ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = ROOM;
  ctx.fillRect(0, 0, stage.width, stage.height);

  for (const layer of project.layers) {
    if (!layer.visible) continue;
    if (layer.type === 'cover' && !project.showCover) continue;

    const opacity = valueAt(layer.props.opacity, t);
    if (opacity <= 0.001) continue;

    // The scratch canvas is only needed when something has to see the layer
    // whole: an effect, or a part-transparent layer whose own shapes overlap.
    // Most layers are neither, and going straight onto the slide saves them a
    // full-size clear and a full-size copy every frame. With five or six
    // layers that is most of the drawing a frame does.
    if (opacity > 0.999 && (!layer.effects || layer.effects.length === 0)) {
      ctx.save();
      drawLayer(ctx, layer, project, t, stage);
      ctx.restore();
      continue;
    }

    // The expensive path. A layer that holds still only has to go down it
    // once: a blurred photo is the same blurred photo at every moment of the
    // loop, and blurring it thirty times a second is most of what the Player
    // template was spending a frame on.
    const key = holdsStill(layer) ? layerSignature(layer, project, stage) : null;
    let finished = key === null ? null : stage.fromKept(key);

    if (!finished) {
      const layerCtx = stage.beginLayer();
      drawLayer(layerCtx, layer, project, t, stage);
      finished = stage.applyEffects(layer.effects, t);
      if (key !== null) finished = stage.keep(key, finished);
    }

    ctx.globalAlpha = opacity;
    ctx.drawImage(finished, 0, 0, stage.width, stage.height);
    ctx.globalAlpha = 1;
  }

  return stage.canvas;
}

// ---------------------------------------------------------------------------
// Drawing one layer
// ---------------------------------------------------------------------------

function drawLayer(ctx, layer, project, t, stage) {
  switch (layer.type) {
    case 'photo': return drawPhoto(ctx, layer, project, t, stage);
    case 'disc': return drawDisc(ctx, layer, project, t, stage);
    case 'cover': return drawCover(ctx, layer, project, t, stage);
    case 'text': return drawText(ctx, layer, project, t, stage);
    case 'progressBar': return drawProgressBar(ctx, layer, project, t, stage);
    case 'controls': return drawControls(ctx, layer, project, t, stage);
    case 'card': return drawCard(ctx, layer, project, t, stage);
    default: return undefined;
  }
}

/** Put the layer's own position, size and angle into effect. */
function placed(ctx, layer, t, stage, draw) {
  const p = layer.props;
  ctx.save();
  ctx.translate(valueAt(p.x, t) * stage.width, valueAt(p.y, t) * stage.height);
  ctx.rotate((valueAt(p.rotation, t) * Math.PI) / 180);
  draw(ctx, valueAt(p.scale, t));
  ctx.restore();
}

// --- photo -----------------------------------------------------------------

function drawPhoto(ctx, layer, project, t, stage) {
  const p = layer.props;
  if (p.mode === 'solid') {
    ctx.fillStyle = p.solidColor || project.palette[0] || ROOM;
    ctx.fillRect(0, 0, stage.width, stage.height);
    return;
  }

  const image = stage.media.photo;
  if (!image) {
    ctx.fillStyle = '#1A1817';
    ctx.fillRect(0, 0, stage.width, stage.height);
    return;
  }

  // Fill the whole stage, keeping the photo's own shape. A blurred background
  // is drawn slightly large so the blur has something to pull in at the edges.
  const grow = layer.effects.some(e => e.type === 'blur') ? 1.08 : 1;
  const scale = Math.max(stage.width / image.width, stage.height / image.height) * grow
    * valueAt(p.scale, t);
  const w = image.width * scale;
  const h = image.height * scale;

  ctx.save();
  ctx.translate(valueAt(p.x, t) * stage.width, valueAt(p.y, t) * stage.height);
  ctx.rotate((valueAt(p.rotation, t) * Math.PI) / 180);
  ctx.drawImage(image, -w / 2, -h / 2, w, h);
  ctx.restore();
}

// --- record ----------------------------------------------------------------

function drawDisc(ctx, layer, project, t, stage) {
  const p = layer.props;
  const turns = turnsPerLoop(valueAt(p.rpm, t), project.loopSeconds);
  const direction = valueAt(p.direction, t) >= 0 ? 1 : -1;
  const angle = (t / project.loopSeconds) * turns * Math.PI * 2 * direction;

  const labelColor = p.labelColor || project.palette[0] || '#F2A65A';
  const cover = stage.media.cover;

  placed(ctx, layer, t, stage, (c, scale) => {
    const R = stage.width * 0.5 * scale;
    const labelR = R * 0.34;
    const holeR = R * 0.033;

    // A soft warm shadow under the record, never a hard black one.
    c.save();
    c.shadowColor = 'rgba(12, 8, 4, 0.55)';
    c.shadowBlur = R * 0.22;
    c.shadowOffsetY = R * 0.05;
    c.beginPath();
    c.arc(0, 0, R, 0, Math.PI * 2);
    c.fillStyle = '#0B0B0B';
    c.fill();
    c.restore();

    c.save();
    c.rotate(angle);

    const body = c.createRadialGradient(0, 0, labelR * 0.8, 0, 0, R);
    body.addColorStop(0, '#1B1A19');
    body.addColorStop(0.7, '#121110');
    body.addColorStop(1, '#070706');
    c.beginPath();
    c.arc(0, 0, R, 0, Math.PI * 2);
    c.fillStyle = body;
    c.fill();

    // Grooves.
    c.lineWidth = Math.max(1, R * 0.0035);
    const gap = R * 0.013;
    for (let r = labelR + gap * 2; r < R - gap; r += gap) {
      const bright = Math.round(r / gap) % 2 === 0 ? 0.055 : 0.018;
      c.beginPath();
      c.arc(0, 0, r, 0, Math.PI * 2);
      c.strokeStyle = `rgba(255,240,225,${bright})`;
      c.stroke();
    }

    // The lead-out. Being off-centre, it is what makes the turning visible.
    c.beginPath();
    c.moveTo(labelR + gap * 2, 0);
    c.lineTo(R - gap * 2, 0);
    c.lineWidth = Math.max(1, R * 0.005);
    c.strokeStyle = 'rgba(255,240,225,0.09)';
    c.stroke();

    // The label.
    c.beginPath();
    c.arc(0, 0, labelR, 0, Math.PI * 2);
    c.fillStyle = labelColor;
    c.fill();

    if (p.showLabelArt && cover && project.showCover) {
      c.save();
      c.beginPath();
      c.arc(0, 0, labelR, 0, Math.PI * 2);
      c.clip();
      c.drawImage(cover, -labelR, -labelR, labelR * 2, labelR * 2);
      c.restore();
    } else {
      c.strokeStyle = 'rgba(20,15,10,0.28)';
      c.lineWidth = Math.max(1, R * 0.008);
      for (const f of [0.74, 0.5]) {
        c.beginPath();
        c.arc(0, 0, labelR * f, 0, Math.PI * 2);
        c.stroke();
      }
    }

    c.beginPath();
    c.arc(0, 0, holeR, 0, Math.PI * 2);
    c.fillStyle = '#0E0D0C';
    c.fill();
    c.restore();

    // The safelight does not turn with the record, so this is outside the
    // rotation. It is a soft sweep, not a glossy highlight.
    c.save();
    c.beginPath();
    c.arc(0, 0, R, 0, Math.PI * 2);
    c.clip();
    const sheen = c.createLinearGradient(-R, -R, R, R);
    sheen.addColorStop(0.0, 'rgba(255,238,214,0)');
    sheen.addColorStop(0.34, 'rgba(255,238,214,0.05)');
    sheen.addColorStop(0.46, 'rgba(255,238,214,0)');
    sheen.addColorStop(0.74, 'rgba(255,238,214,0.028)');
    sheen.addColorStop(1.0, 'rgba(255,238,214,0)');
    c.fillStyle = sheen;
    c.fillRect(-R, -R, R * 2, R * 2);
    c.restore();
  });
}

// --- cover -----------------------------------------------------------------

function drawCover(ctx, layer, project, t, stage) {
  const p = layer.props;
  const image = stage.media.cover;

  placed(ctx, layer, t, stage, (c, scale) => {
    const size = stage.width * scale;
    const half = size / 2;

    c.save();
    c.shadowColor = `rgba(10, 6, 3, ${valueAt(p.shadow, t) ?? 0.5})`;
    c.shadowBlur = size * 0.16;
    c.shadowOffsetY = size * 0.035;
    c.fillStyle = project.palette[1] || '#2A2724';
    c.fillRect(-half, -half, size, size);
    c.restore();

    // The cover art itself is never blurred, tinted or stretched.
    if (image) {
      c.drawImage(image, -half, -half, size, size);
    }

    c.strokeStyle = 'rgba(255,240,225,0.10)';
    c.lineWidth = Math.max(1, size * 0.004);
    c.strokeRect(-half, -half, size, size);
  });
}

// --- text ------------------------------------------------------------------

function textFor(layer, project) {
  const bind = layer.props.bind;
  if (bind === 'title') return project.song.title || 'Untitled';
  if (bind === 'artist') return project.song.artist || 'Unknown artist';
  return layer.props.text || '';
}

/**
 * Draw text with letter spacing, one character at a time.
 * Canvas has a `letterSpacing` property now, but it arrived late in Safari,
 * so the spacing is done by hand and works everywhere.
 */
function drawTracked(ctx, text, tracking, align, emSize) {
  const chars = [...text];
  const widths = chars.map(ch => ctx.measureText(ch).width);
  const extra = tracking * emSize;   // tracking is in em, like CSS letter-spacing
  const total = widths.reduce((sum, w) => sum + w, 0) + extra * Math.max(0, chars.length - 1);

  let x = align === 'center' ? -total / 2 : align === 'right' ? -total : 0;
  chars.forEach((ch, i) => {
    ctx.fillText(ch, x, 0);
    x += widths[i] + extra;
  });
}

// The colours the templates used to write in by hand. A layer that still has
// one of them was never given a colour on purpose, so it takes the cover's.
const OLD_DEFAULTS = { '#F3EFE9': 'ink', '#A8A097': 'ink' };

// The artist is the title's own colour, a touch quieter, rather than the
// cover's soft tone, which sank into busy photos.
function textColour(p, project) {
  const tones = coverTones(project.palette);
  const auto = !p.color || OLD_DEFAULTS[p.color];
  if (!auto) return p.color;
  return p.bind === 'artist' ? withAlpha(tones.ink, 0.85) : tones.ink;
}

// The artist line is small, so it is set semibold to hold its own.
const weightOf = p => (p.bind === 'artist' ? '600 ' : '');

function drawText(ctx, layer, project, t, stage) {
  const p = layer.props;
  let value = textFor(layer, project);
  if (p.uppercase) value = value.toUpperCase();
  if (!value) return;

  placed(ctx, layer, t, stage, (c, scale) => {
    let size = stage.width * valueAt(p.size, t) * scale;
    c.font = `${weightOf(p)}${size}px ${FONTS[p.font] || FONTS.sans}`;
    // A line with a limit shrinks to fit it, so a long title stays inside
    // the card rather than running off its sides.
    if (p.maxWidth) {
      const room = stage.width * p.maxWidth * scale;
      const chars = [...value];
      const wide = c.measureText(value).width + (p.tracking || 0) * size * Math.max(0, chars.length - 1);
      if (wide > room) {
        size *= room / wide;
        c.font = `${weightOf(p)}${size}px ${FONTS[p.font] || FONTS.sans}`;
      }
    }
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillStyle = textColour(p, project);
    c.shadowColor = 'rgba(8, 5, 3, 0.55)';
    c.shadowBlur = size * 0.5;
    drawTracked(c, value, p.tracking || 0, p.align || 'center', size);
  });
}

// --- progress bar ----------------------------------------------------------

/** Where the bar sits, in seconds into the track. */
function positionAt(project, layer, t) {
  const speed = valueAt(layer.props.speed, t) || 1;
  return project.song.clipStartSeconds + t * speed;
}

function drawProgressBar(ctx, layer, project, t, stage) {
  const p = layer.props;
  const trackSeconds = (project.song.durationMs || 0) / 1000;
  const tones = coverTones(project.palette);

  placed(ctx, layer, t, stage, (c, scale) => {
    const width = stage.width * scale;
    const half = width / 2;
    // Both go with the bar's own length, so the numbers shrink and grow with
    // it rather than staying one size while the bar is pinched smaller.
    const thickness = Math.max(2, width * 0.0075);
    const timeSize = width * 0.036;

    // The line itself is always fully there.
    c.lineCap = 'round';
    c.lineWidth = thickness;
    c.strokeStyle = withAlpha(tones.ink, 0.24);
    c.beginPath();
    c.moveTo(-half, 0);
    c.lineTo(half, 0);
    c.stroke();

    // At the end of the loop the bar has to go back to where it started. Rather
    // than snap, the ending state dissolves into the starting state over the
    // last fraction of a second, so the reset reads as a soft cut.
    const fade = Math.min(0.35, project.loopSeconds * 0.06);
    const intoFade = t - (project.loopSeconds - fade);
    const blend = intoFade > 0 ? Math.min(1, intoFade / fade) : 0;

    const states = blend > 0
      ? [
          { at: positionAt(project, layer, t), alpha: 1 - blend },
          { at: positionAt(project, layer, 0), alpha: blend },
        ]
      : [{ at: positionAt(project, layer, t), alpha: 1 }];

    for (const state of states) {
      const fraction = trackSeconds > 0 ? Math.min(1, Math.max(0, state.at / trackSeconds)) : 0;
      const x = -half + width * fraction;

      c.globalAlpha = state.alpha;
      c.strokeStyle = tones.accent;
      c.lineWidth = thickness;
      c.beginPath();
      c.moveTo(-half, 0);
      c.lineTo(x, 0);
      c.stroke();

      c.beginPath();
      c.arc(x, 0, thickness * 1.9, 0, Math.PI * 2);
      c.fillStyle = tones.ink;
      c.fill();

      if (p.showTimes) {
        c.font = `${timeSize}px ${FONTS.mono}`;
        c.textBaseline = 'middle';
        c.fillStyle = withAlpha(tones.soft, 0.85);
        c.textAlign = 'left';
        c.fillText(formatTime(state.at), -half, timeSize * 1.9);
        c.textAlign = 'right';
        c.fillText(
          trackSeconds > 0 ? '-' + formatTime(Math.max(0, trackSeconds - state.at)) : '0:00',
          half,
          timeSize * 1.9,
        );
      }
      c.globalAlpha = 1;
    }
  });
}

// --- transport icons (decorative) ------------------------------------------

function drawControls(ctx, layer, project, t, stage) {
  const ink = withAlpha(coverTones(project.palette).ink, 0.9);
  placed(ctx, layer, t, stage, (c, scale) => {
    const width = stage.width * scale;
    const unit = width * 0.13;
    const gap = width * 0.32;
    c.fillStyle = ink;
    c.strokeStyle = ink;
    c.lineWidth = Math.max(1.5, unit * 0.12);
    c.lineJoin = 'round';

    const triangle = (cx, dir, size = unit) => {
      c.beginPath();
      c.moveTo(cx + (size / 2) * dir, 0);
      c.lineTo(cx - (size / 2) * dir, -size * 0.58);
      c.lineTo(cx - (size / 2) * dir, size * 0.58);
      c.closePath();
      c.fill();
    };
    // Back and forward as a pair of arrows each, like Apple Music.
    const double = (cx, dir) => {
      triangle(cx - unit * 0.3 * dir, dir, unit * 0.75);
      triangle(cx + unit * 0.3 * dir, dir, unit * 0.75);
    };

    double(-gap, -1);

    // Pause, a little larger than its neighbours: two rounded bars.
    const barW = unit * 0.3;
    const barH = unit * 1.05;
    for (const side of [-1, 1]) {
      roundedRect(c, side * unit * 0.24 - barW / 2, -barH / 2, barW, barH, barW * 0.3);
      c.fill();
    }

    double(gap, 1);
  });
}

/** roundRect arrived in Safari 16; older phones get the same shape by hand. */
function roundedRect(c, x, y, w, h, r, fresh = true) {
  if (fresh) c.beginPath();
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (c.roundRect) {
    c.roundRect(x, y, w, h, r);
    return;
  }
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// --- card ------------------------------------------------------------------

/**
 * What the card is made from: everything drawn so far, blurred by the card's
 * own amount and read back as pixels for the lens. Under the card that is the
 * photo, which holds still, so this is kept and only redone when the photo,
 * its effects or the slide's size change.
 *
 * ponytail: the key only knows about the photo, which is right while the card
 * sits straight above it, as the Player template puts it. A layer slipped in
 * between would freeze into the glass until the photo next changed.
 */
function glassBehind(stage, project, t, pixels) {
  const photo = project.layers.find(l => l.type === 'photo');
  const key = JSON.stringify([
    photo && [photo.visible, photo.props, photo.effects],
    stage.width, stage.height, stage.mediaKey(),
    // ponytail: a keyed photo changes under the glass, so the glass is redone
    // ten times a second rather than every frame. Through glass the steps do
    // not show; every frame if they ever do.
    photo && !holdsStill(photo) ? Math.round(t * 10) : 0,
    Math.round(pixels * 2),
  ]);
  if (stage.glassKey === key) return stage.glass;

  if (!stage.glass) {
    stage.glass = document.createElement('canvas');
    stage.glass.width = stage.width;
    stage.glass.height = stage.height;
  }
  // Glass lifts the colour of what is behind it rather than dulling it.
  // Safari before 17 has no canvas filter: the glass is then simply clear.
  const g = stage.glass.getContext('2d');
  g.filter = 'saturate(1.5) brightness(1.06)';
  g.drawImage(stage.blurred(stage.canvas, pixels), 0, 0);
  g.filter = 'none';
  try {
    stage.glassPixels = g.getImageData(0, 0, stage.width, stage.height).data;
  } catch {
    stage.glassPixels = null; // a photo the browser will not let us read
  }
  stage.glassKey = key;
  return stage.glass;
}

/**
 * The rim of a pane of Liquid Glass, worked out once per card shape.
 *
 * The pane is a slab whose edge rounds over like a squircle, (1 - (1 - x)^4)^¼
 * across a bezel. Light coming up through that curved edge is bent by Snell's
 * law (glass, n = 1.5), so each point of the rim shows the backdrop from a
 * little further in: a thin band where the picture is drawn in toward the
 * middle, strongest right at the edge, gone a bezel's width inside. The flat
 * middle bends nothing and is drawn straight. Each point also keeps its
 * outward normal, which the highlight uses.
 */
function lensFor(stage, w, h, r) {
  const W = Math.ceil(w);
  const H = Math.ceil(h);
  const bezel = Math.max(4, Math.min(w, h) * 0.11);
  const key = [W, H, Math.round(r), Math.round(bezel)].join();
  if (stage.lens && stage.lens.key === key) return stage.lens;

  const sheen = Math.max(1.2, Math.min(w, h) * 0.006);
  const index = [], at = [], nx = [], ny = [], bend = [], line = [], glow = [], cover = [];
  const hx = w / 2 - r;
  const hy = h / 2 - r;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const px = i + 0.5 - w / 2;
      const py = j + 0.5 - h / 2;
      const qx = Math.abs(px) - hx;
      const qy = Math.abs(py) - hy;
      // Distance in from the edge of the rounded rectangle, and the way out.
      let d, ox, oy;
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy) || 1;
        d = r - len;
        ox = (qx / len) * Math.sign(px);
        oy = (qy / len) * Math.sign(py);
      } else if (qx > qy) {
        d = r - qx; ox = Math.sign(px); oy = 0;
      } else {
        d = r - qy; ox = 0; oy = Math.sign(py);
      }
      if (d <= -0.5 || d >= bezel) continue;

      const x = Math.max(0, d) / bezel;
      const inner = 1 - x;
      const rest = 1 - inner ** 4;
      const slope = Math.min(40, inner ** 3 / Math.max(1e-3, rest) ** 0.75);
      const tilt = Math.atan(slope);
      const bent = tilt - Math.asin(Math.sin(tilt) / 1.5);

      index.push((j * W + i) * 4);
      at.push(px, py);
      nx.push(ox);
      ny.push(oy);
      bend.push(Math.min(bezel, bezel * 0.6 * Math.tan(bent)));
      line.push(Math.exp(-Math.max(0, d) / sheen));
      glow.push(inner ** 3);
      cover.push(Math.min(1, d + 0.5));
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  stage.lens = {
    key, W, H, canvas, ctx,
    image: ctx.createImageData(W, H),
    index: Int32Array.from(index),
    at: Float32Array.from(at),
    nx: Float32Array.from(nx), ny: Float32Array.from(ny),
    bend: Float32Array.from(bend),
    line: Float32Array.from(line), glow: Float32Array.from(glow),
    cover: Uint8ClampedArray.from(cover, v => v * 255),
    drawn: null,
  };
  return stage.lens;
}

/**
 * Bend the backdrop through the rim and light its edge, into the lens's own
 * canvas, in the card's own coordinates. `m` maps those onto the slide.
 *
 * Red, green and blue bend by slightly different amounts, as they do in real
 * glass, which leaves a faint rainbow fringe where the bend is strongest.
 * The highlight follows the normal: brightest where the edge faces a light
 * up and to the left, fainter where it faces away, as light leaving the
 * glass catches the far side.
 */
function paintLens(stage, lens, m) {
  const { index, at, nx, ny, bend, line, glow, cover } = lens;
  const src = stage.glassPixels;
  const SW = stage.width;
  const SH = stage.height;
  const out = lens.image.data;
  // The light, as a direction on the card. Turning the card turns the edge,
  // not the light, so the light is brought into the card's own frame.
  const angle = Math.atan2(m.b, m.a);
  const lx = -0.6 * Math.cos(angle) - 0.8 * Math.sin(angle);
  const ly = 0.6 * Math.sin(angle) - 0.8 * Math.cos(angle);
  // Plain numbers: a DOMMatrix's fields are slow to read a million times.
  const { a, b, c, d, e, f } = m;
  const sample = (x, y, ch) => {
    let X = (a * x + c * y + e) | 0;
    let Y = (b * x + d * y + f) | 0;
    X = X < 0 ? 0 : X >= SW ? SW - 1 : X;
    Y = Y < 0 ? 0 : Y >= SH ? SH - 1 : Y;
    return src[(Y * SW + X) * 4 + ch];
  };

  for (let k = 0, n = nx.length; k < n; k++) {
    const px = at[k * 2];
    const py = at[k * 2 + 1];
    const o = index[k];
    const ox = nx[k] * bend[k];
    const oy = ny[k] * bend[k];
    const red = sample(px - ox * 0.9, py - oy * 0.9, 0);
    const green = sample(px - ox, py - oy, 1);
    const blue = sample(px - ox * 1.12, py - oy * 1.12, 2);
    // Light. A thin bright line right at the edge where it faces the light,
    // a softer glow fading in across the bezel, more on the lit side.
    const facing = nx[k] * lx + ny[k] * ly;
    const lit = facing > 0 ? facing * facing : 0.35 * facing * facing;
    let light = line[k] * (0.24 + 0.71 * lit) + glow[k] * (0.1 + 0.12 * lit);
    if (light > 1) light = 1;
    out[o] = red + (255 - red) * light;
    out[o + 1] = green + (255 - green) * light;
    out[o + 2] = blue + (255 - blue) * light;
    out[o + 3] = cover[k];
  }
  lens.ctx.putImageData(lens.image, 0, 0);
}

/**
 * The panel the player sits on, made as Apple's Liquid Glass: a clear pane
 * that lets the picture through, bends it at a rounded rim like a lens, takes
 * a breath of the cover's colour, and catches the light along its edge.
 */
function drawCard(ctx, layer, project, t, stage) {
  const p = layer.props;
  const tones = coverTones(project.palette);
  // Blur is per 1000 pixels of slide width, like the Blur effect, so the
  // preview and the file agree. None at all is perfectly clear glass.
  const pixels = ((valueAt(p.blur, t) ?? 12) * stage.width) / 1000;
  const glass = glassBehind(stage, project, t, pixels);

  placed(ctx, layer, t, stage, (c, scale) => {
    const w = stage.width * scale;
    const h = w * (valueAt(p.ratio, t) || 1.2);
    if (!(w >= 2 && h >= 2)) return;
    // Roundness is a fraction of the card's width; at its most the short
    // sides become full semicircles.
    const r = Math.min(Math.min(w, h) / 2, w * Math.max(0, valueAt(p.radius, t) ?? 0.075));
    const shape = () => roundedRect(c, -w / 2, -h / 2, w, h, r);

    // A soft shadow under the pane, drawn on its own so it never darkens the
    // glass itself.
    c.save();
    c.shadowColor = 'rgba(0, 0, 0, 0.35)';
    c.shadowBlur = w * 0.08;
    c.shadowOffsetY = w * 0.025;
    shape();
    c.fillStyle = withAlpha(tones.deep, 0.3);
    c.fill();
    c.restore();

    // The flat middle: the picture behind, straight through, drawn back
    // exactly over the part of the slide it was made from.
    c.save();
    shape();
    c.clip();
    const m = c.getTransform();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(glass, 0, 0);
    c.setTransform(m);
    c.restore();

    if (stage.glassPixels) {
      // The rim. Redone only when the card, or what is behind it, changes.
      const lens = lensFor(stage, w, h, r);
      const drawn = [stage.glassKey, m.a, m.b, m.c, m.d, Math.round(m.e * 4), Math.round(m.f * 4)].join();
      if (lens.drawn !== drawn) {
        paintLens(stage, lens, m);
        lens.drawn = drawn;
      }
      c.drawImage(lens.canvas, -w / 2, -h / 2);
    }

    // A breath of the cover's colour over the whole pane, rim and all, and
    // the faintest lift so it still reads as there on a dark photo.
    c.save();
    shape();
    c.clip();
    c.fillStyle = withAlpha(tones.deep, 0.1);
    c.fillRect(-w / 2, -h / 2, w, h);
    c.fillStyle = 'rgba(255, 255, 255, 0.05)';
    c.fillRect(-w / 2, -h / 2, w, h);
    if (!stage.glassPixels) {
      // No pixels to bend: light the edge with a plain stroke instead.
      c.lineWidth = Math.max(2, w * 0.008);
      c.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      shape();
      c.stroke();
    }
    c.restore();
  });
}
