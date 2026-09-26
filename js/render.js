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
 */

import { valueAt, turnsPerLoop, formatTime } from './model.js';
import { EFFECTS, withDefaults } from './effects.js';

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

    this.effects = new EffectGL(width, height);
    this.blurCanvas = null;
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

    // Two blurs on one layer add up as the squares of their radii, the same
    // way two gaussians do. One blur is the case that actually happens.
    const radii = chain
      .filter(effect => effect.type === 'blur')
      .map(effect => withDefaults(effect).params.radius || 0);
    let source = radii.length
      ? this.blurred(this.layerCanvas, (Math.hypot(...radii) * this.width) / 1000)
      : this.layerCanvas;

    const shaders = chain.filter(effect => effect.type !== 'blur');
    if (shaders.length === 0 || !this.effects.ok) return source;
    try {
      return this.effects.run(source, shaders, t) ? this.effects.canvas : source;
    } catch (error) {
      console.warn('Effect failed, drawing the layer plain:', error);
      return source;
    }
  }

  dispose() {
    this.effects.dispose();
  }
}

// ===========================================================================
// render
// ===========================================================================

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

    const layerCtx = stage.beginLayer();
    drawLayer(layerCtx, layer, project, t, stage);

    const finished = stage.applyEffects(layer.effects, t);
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

function drawText(ctx, layer, project, t, stage) {
  const p = layer.props;
  let value = textFor(layer, project);
  if (p.uppercase) value = value.toUpperCase();
  if (!value) return;

  placed(ctx, layer, t, stage, (c, scale) => {
    const size = stage.width * valueAt(p.size, t) * scale;
    c.font = `${size}px ${FONTS[p.font] || FONTS.sans}`;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillStyle = p.color || '#F3EFE9';
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

  placed(ctx, layer, t, stage, (c, scale) => {
    const width = stage.width * scale;
    const half = width / 2;
    const thickness = Math.max(2, stage.width * 0.0045);
    const timeSize = stage.width * 0.024;

    // The line itself is always fully there.
    c.lineCap = 'round';
    c.lineWidth = thickness;
    c.strokeStyle = 'rgba(243,239,233,0.22)';
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
      c.strokeStyle = '#F2A65A';
      c.lineWidth = thickness;
      c.beginPath();
      c.moveTo(-half, 0);
      c.lineTo(x, 0);
      c.stroke();

      c.beginPath();
      c.arc(x, 0, thickness * 1.9, 0, Math.PI * 2);
      c.fillStyle = '#F2A65A';
      c.fill();

      if (p.showTimes) {
        c.font = `${timeSize}px ${FONTS.mono}`;
        c.textBaseline = 'middle';
        c.fillStyle = 'rgba(243,239,233,0.72)';
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
  placed(ctx, layer, t, stage, (c, scale) => {
    const width = stage.width * scale;
    const unit = width * 0.13;
    const gap = width * 0.32;
    c.fillStyle = 'rgba(243,239,233,0.82)';
    c.strokeStyle = 'rgba(243,239,233,0.82)';
    c.lineWidth = Math.max(1.5, unit * 0.12);
    c.lineJoin = 'round';

    const triangle = (cx, dir) => {
      c.beginPath();
      c.moveTo(cx + (unit / 2) * dir, 0);
      c.lineTo(cx - (unit / 2) * dir, -unit * 0.58);
      c.lineTo(cx - (unit / 2) * dir, unit * 0.58);
      c.closePath();
      c.fill();
    };

    // Previous.
    triangle(-gap - unit * 0.12, -1);
    c.fillRect(-gap - unit * 0.72, -unit * 0.58, c.lineWidth, unit * 1.16);

    // Play, drawn a little larger than its neighbours.
    c.save();
    c.scale(1.35, 1.35);
    triangle(0, 1);
    c.restore();

    // Next.
    triangle(gap + unit * 0.12, 1);
    c.fillRect(gap + unit * 0.72 - c.lineWidth, -unit * 0.58, c.lineWidth, unit * 1.16);
  });
}
