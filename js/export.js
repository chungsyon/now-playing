/**
 * MAKING THE FILE
 * ---------------
 * Draws the project one frame at a time and encodes those frames into a silent
 * H.264 MP4. Nothing here is a screen recording: frame 41 is drawn by asking
 * the renderer for time 41/30, so the same project always produces the same
 * file.
 *
 * Only a video track is ever added to the output, so the file physically
 * cannot contain audio. The song is added later, in Instagram.
 */

import {
  Output,
  Mp4OutputFormat,
  BufferTarget,
  CanvasSource,
  Quality,
  canEncodeVideo,
} from '../vendor/mediabunny-1.59.1.min.mjs';

import { Stage, render } from './render.js';

export const FPS = 30;
export const BITRATE = 8_000_000;

/** What this device can do. Checked once, then remembered. */
let supportPromise = null;

export function exportSupport() {
  if (supportPromise) return supportPromise;
  supportPromise = (async () => {
    const hasVideoEncoder = typeof window.VideoEncoder === 'function';
    let h264 = false;
    if (hasVideoEncoder) {
      try {
        h264 = await canEncodeVideo('avc', {
          width: 1080,
          height: 1350,
          quality: new Quality(BITRATE),
        });
      } catch {
        h264 = false;
      }
    }
    const probe = new File([new Uint8Array([0])], 'probe.mp4', { type: 'video/mp4' });
    return {
      secureContext: window.isSecureContext,
      hasVideoEncoder,
      h264,
      canShareFiles: !!(navigator.canShare && navigator.canShare({ files: [probe] })),
      hasMediaRecorder: typeof window.MediaRecorder === 'function',
    };
  })();
  return supportPromise;
}

const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------
// The good path: WebCodecs, frame by frame
// ---------------------------------------------------------------------------

async function encodeWithWebCodecs(stage, project, totalFrames, onProgress) {
  const output = new Output({
    // 'in-memory' writes the index at the front of the file, which is what
    // Photos and Instagram expect to find.
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });

  const source = new CanvasSource(stage.canvas, {
    codec: 'avc',
    quality: new Quality(BITRATE),
    keyFrameInterval: 2,
  });
  output.addVideoTrack(source, { frameRate: FPS });
  await output.start();

  for (let frame = 0; frame < totalFrames; frame++) {
    const t = frame / FPS;
    render(stage, project, t);
    await source.add(t, 1 / FPS);
    onProgress((frame + 1) / totalFrames);
    if (frame % 5 === 0) await yieldToBrowser();
  }

  source.close();
  await output.finalize();

  return {
    blob: new Blob([output.target.buffer], { type: 'video/mp4' }),
    extension: 'mp4',
    path: 'WebCodecs',
  };
}

// ---------------------------------------------------------------------------
// The fallback: MediaRecorder, in real time
// ---------------------------------------------------------------------------

async function encodeWithMediaRecorder(stage, project, onProgress) {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9',
    'video/webm',
  ];
  const mimeType = candidates.find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error('This browser cannot record video.');

  const stream = stage.canvas.captureStream(FPS);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: BITRATE });
  const chunks = [];
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise(resolve => { recorder.onstop = resolve; });

  recorder.start();
  const startedAt = performance.now();

  // Driven by a timer, not requestAnimationFrame: rAF stops firing when the
  // screen locks, which would leave the recording hanging forever.
  await new Promise(resolve => {
    const tick = () => {
      const elapsed = (performance.now() - startedAt) / 1000;
      if (elapsed >= project.loopSeconds) { resolve(); return; }
      render(stage, project, elapsed);
      onProgress(elapsed / project.loopSeconds);
      setTimeout(tick, 1000 / FPS);
    };
    tick();
  });

  recorder.stop();
  await stopped;
  stream.getTracks().forEach(track => track.stop());

  const container = mimeType.split(';')[0];
  return {
    blob: new Blob(chunks, { type: container }),
    extension: container === 'video/mp4' ? 'mp4' : 'webm',
    path: 'MediaRecorder',
  };
}

// ---------------------------------------------------------------------------
// What the Export screen calls
// ---------------------------------------------------------------------------

/**
 * @param {object} project  the document
 * @param {object} media    decoded images, { photo, cover }
 * @param {function} onProgress  called with 0..1
 */
export async function renderToVideo(project, media, onProgress = () => {}) {
  const support = await exportSupport();
  const { w, h } = project.aspect;
  const stage = new Stage(w, h, media);
  const totalFrames = Math.round(project.loopSeconds * FPS);
  const startedAt = performance.now();

  try {
    const result = support.hasVideoEncoder && support.h264
      ? await encodeWithWebCodecs(stage, project, totalFrames, onProgress)
      : await encodeWithMediaRecorder(stage, project, onProgress);

    return {
      ...result,
      width: w,
      height: h,
      frames: totalFrames,
      seconds: (performance.now() - startedAt) / 1000,
    };
  } finally {
    stage.dispose();
  }
}

/**
 * Hand the file to iOS so it can go into Photos.
 *
 * This must be called straight from a tap. iOS only opens the share sheet in
 * response to a real gesture, and that permission has already expired by the
 * time a long render finishes, which is why saving is its own button.
 */
export async function saveVideo(result, filename) {
  const name = `${filename}.${result.extension}`;
  const file = new File([result.blob], name, { type: result.blob.type });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return { shared: true };
    } catch (error) {
      if (error.name === 'AbortError') return { shared: false, cancelled: true };
      return { shared: false, error };
    }
  }

  const url = URL.createObjectURL(result.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { shared: false, downloaded: true };
}
