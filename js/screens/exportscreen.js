/**
 * EXPORT
 * ------
 * Both slides side by side, what the file is, and the two taps that get it
 * into Photos.
 *
 * Rendering and saving are deliberately separate buttons. iOS only opens the
 * share sheet in answer to a real tap, and that permission is gone by the time
 * a long render finishes.
 */

import { h, clear, icon, toast } from '../ui.js';
import { formatTime } from '../model.js';
import { Stage, render } from '../render.js';
import { renderToVideo, saveVideo, exportSupport, FPS } from '../export.js';

let lastResult = null;
let lastUrl = null;

export async function enter(root, app) {
  clear(root);
  const project = app.state.project;
  const { w, h: height } = project.aspect;

  // Slide 1: the photo, exactly as it is. This app never re-saves it.
  const photoThumb = h('img', { alt: 'Your photo, which stays untouched' });
  if (app.state.blobs.photo) {
    const url = URL.createObjectURL(app.state.blobs.photo);
    photoThumb.src = url;
    photoThumb.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
  }

  // Slide 2: one frame of what is about to be rendered.
  const slideThumb = h('canvas', { 'aria-label': 'The slide this app will make' });
  drawStill(app, slideThumb);

  const progress = h('div', { class: 'progress__fill' });
  const progressBar = h('div', { class: 'progress', hidden: true }, progress);
  const status = h('p', { class: 'body' });

  const saveButton = h('button', {
    class: 'btn btn--primary btn--block',
    type: 'button',
    hidden: true,
    onclick: () => save(app, status),
  }, icon('export'), 'Save to Photos');

  const renderButton = h('button', {
    class: 'btn btn--primary btn--block',
    type: 'button',
    onclick: async () => {
      renderButton.disabled = true;
      saveButton.hidden = true;
      progressBar.hidden = false;
      progress.style.width = '0%';
      status.textContent = 'Developing…';

      try {
        lastResult = await renderToVideo(project, app.state.media, fraction => {
          progress.style.width = `${Math.round(fraction * 100)}%`;
        });
        if (lastUrl) URL.revokeObjectURL(lastUrl);
        lastUrl = URL.createObjectURL(lastResult.blob);

        const video = h('video', {
          src: lastUrl, loop: true, muted: true, playsinline: true, controls: true,
        });
        video.addEventListener('error', () => {
          status.textContent =
            'The file is made, but this browser will not play it back. Save it and look in Photos.';
        });
        slideThumb.replaceWith(video);
        video.play().catch(() => {});

        status.textContent =
          `Your print is ready. ${(lastResult.blob.size / 1048576).toFixed(1)} MB, ` +
          `made in ${lastResult.seconds.toFixed(1)}s.`;
        saveButton.hidden = false;
        facts(factsBox, project, lastResult);
      } catch (error) {
        console.error(error);
        status.textContent = 'Something didn\'t come through. Try once more.';
      } finally {
        renderButton.disabled = false;
        progressBar.hidden = true;
      }
    },
  }, icon('aperture'), 'Make the slide');

  const factsBox = h('dl', { class: 'facts' });
  facts(factsBox, project, null);

  const support = await exportSupport();

  root.append(
    h('div', { class: 'stack stack--wide develops' },

      h('div', { class: 'slides' },
        h('figure', { class: 'slide-card', style: { margin: '0' } },
          photoThumb, h('figcaption', {}, 'Slide 1 · your photo')),
        h('figure', { class: 'slide-card', style: { margin: '0' } },
          slideThumb, h('figcaption', {}, 'Slide 2 · this app')),
      ),

      factsBox,
      progressBar,
      status,
      renderButton,
      saveButton,

      !support.hasVideoEncoder || !support.h264
        ? h('p', { class: 'body' },
            'This browser has no frame-by-frame encoder, so the slide is recorded in ' +
            'real time instead. It still comes out silent, just a little softer.')
        : null,

      h('div', { class: 'stack' },
        h('h2', { class: 'label' }, 'In Instagram'),
        h('ol', { class: 'checklist' },
          step(1, 'Add your photo first, as slide 1.'),
          step(2, 'Add this video second, as slide 2.'),
          project.song.title
            ? step(3, h('span', {}, 'In Music, add ', h('strong', {}, project.song.title),
                ' by ', h('strong', {}, project.song.artist), '.'))
            : step(3, 'Add the song in Music.'),
          step(4, h('span', {}, 'Start the clip at ',
            h('span', { class: 'mono' }, formatTime(project.song.clipStartSeconds)), '.')),
        ),
      ),
    ),
  );
}

export function leave() {
  // The object URL is kept while the screen is open so the preview can play.
  if (lastUrl) {
    URL.revokeObjectURL(lastUrl);
    lastUrl = null;
  }
  lastResult = null;
}

function step(number, content) {
  return h('li', {}, h('span', { class: 'step' }, String(number).padStart(2, '0')),
    h('span', {}, content));
}

function facts(box, project, result) {
  clear(box);
  const rows = [
    ['Format', 'MP4, H.264'],
    ['Size', `${project.aspect.w} x ${project.aspect.h}`],
    ['Loop', `${project.loopSeconds}s at ${FPS} fps`],
    ['Audio', 'none'],
  ];
  if (result) rows.push(['File', `${(result.blob.size / 1048576).toFixed(1)} MB`]);
  for (const [term, value] of rows) {
    box.append(h('dt', {}, term), h('dd', {}, value));
  }
}

function drawStill(app, canvas) {
  const project = app.state.project;
  const width = Math.min(540, project.aspect.w);
  const height = Math.round(width * (project.aspect.h / project.aspect.w));
  canvas.width = width;
  canvas.height = height;

  const stage = new Stage(width, height, app.state.media);
  try {
    render(stage, project, 0);
    canvas.getContext('2d').drawImage(stage.canvas, 0, 0);
  } finally {
    stage.dispose();
  }
}

async function save(app, status) {
  if (!lastResult) return;
  const name = (app.state.project.song.title || 'now-playing')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'now-playing';

  const outcome = await saveVideo(lastResult, name);
  if (outcome.shared) {
    status.textContent = 'Sent to the share sheet. Choose Save Video.';
  } else if (outcome.cancelled) {
    // Nothing to say: they changed their mind.
  } else if (outcome.downloaded) {
    status.textContent = 'Downloaded.';
  } else {
    toast('Saving didn\'t come through. Try once more.');
  }
}
