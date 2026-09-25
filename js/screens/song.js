/**
 * SONG
 * ----
 * Find the track, then say where your Instagram clip starts. The clip start is
 * what the progress bar on the slide counts from, so the numbers on the slide
 * match the ones in Instagram.
 */

import { h, clear, icon, sliderRow, emptyState, toast, decodeImage } from '../ui.js';
import { formatTime } from '../model.js';
import { searchSongs, fetchCoverBlob, parseAppleMusicLink, getCountry, setCountry } from '../itunes.js';

export async function enter(root, app) {
  clear(root);
  const project = app.state.project;

  const results = h('div', { class: 'rows' });
  const status = h('div', {});
  const clipBox = h('div', { class: 'stack' });
  const manualBox = h('div', { class: 'stack', hidden: true });

  const continueButton = h('button', {
    class: 'btn btn--primary btn--block',
    type: 'button',
    disabled: !project.song.title,
    onclick: () => app.go('editor'),
  }, 'Open the editor');

  const input = h('input', {
    class: 'input',
    type: 'search',
    enterkeyhint: 'search',
    placeholder: 'Song and artist, or an Apple Music link',
    'aria-label': 'Search for a song',
    value: app.state.lastQuery || '',
  });

  let runId = 0;
  let timer = null;

  const search = async () => {
    const term = input.value.trim();
    app.state.lastQuery = term;
    const mine = ++runId;

    if (!term) {
      clear(results);
      clear(status);
      return;
    }

    clear(results);
    clear(status).append(h('div', { class: 'developing' }));

    try {
      const found = await searchSongs(term);
      if (mine !== runId) return;
      clear(status);
      if (found.length === 0) {
        results.append(emptyState(
          parseAppleMusicLink(term)
            ? 'That link did not lead anywhere. Try the song name instead.'
            : 'Nothing came back for that. Try the artist name too.'));
        return;
      }
      for (const song of found) results.append(resultRow(song, app, refresh));
    } catch (error) {
      if (mine !== runId) return;
      clear(status);
      results.append(emptyState(error.message === 'offline'
        ? 'No connection. Song search needs one; everything else works offline.'
        : 'Something didn\'t come through. Try once more.'));
    }
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(search, 350);
  });
  input.addEventListener('search', search);

  function refresh() {
    // Mark the chosen row and rebuild the clip picker underneath.
    for (const row of results.querySelectorAll('.row')) {
      row.classList.toggle('is-selected', row.dataset.songId === project.song.id);
    }
    continueButton.disabled = !project.song.title;
    buildClipPicker(clipBox, app);
  }

  root.append(
    h('div', { class: 'stack stack--wide develops' },

      h('div', { class: 'search' },
        icon('magnifying-glass', { size: 'sm' }),
        input,
      ),

      status,
      results,
      clipBox,

      h('button', {
        class: 'btn btn--quiet btn--block',
        type: 'button',
        onclick: () => {
          manualBox.hidden = !manualBox.hidden;
          if (!manualBox.hidden) buildManualForm(manualBox, app, refresh);
        },
      }, 'Can\'t find it? Enter the details yourself'),

      manualBox,
      continueButton,

      h('div', { class: 'field' },
        h('label', { for: 'store-country' },
          'Store country. Change this if a song is missing from your catalogue.'),
        h('input', {
          class: 'input',
          id: 'store-country',
          maxlength: '2',
          autocapitalize: 'characters',
          style: { maxWidth: '110px' },
          value: getCountry(),
          onchange: event => {
            setCountry(event.target.value);
            event.target.value = getCountry();
            search();
          },
        }),
      ),
    ),
  );

  refresh();
  if (input.value.trim() && results.children.length === 0) search();
}

// ---------------------------------------------------------------------------

function resultRow(song, app, refresh) {
  const project = app.state.project;
  const row = h('button', {
    class: 'row',
    type: 'button',
    onclick: async () => {
      await chooseSong(app, song);
      refresh();
    },
  },
    h('img', {
      class: 'row__art',
      src: song.artworkUrl100,
      alt: '',
      loading: 'lazy',
      crossorigin: 'anonymous',
    }),
    h('div', { class: 'row__main' },
      h('div', { class: 'row__title' }, song.title),
      h('div', { class: 'row__sub' },
        [song.artist, song.album, song.year, formatTime(song.durationMs / 1000)]
          .filter(Boolean).join(' · ')),
    ),
    h('span', { class: 'tag' }, song.version),
  );
  row.dataset.songId = song.id;
  if (song.id === project.song.id) row.classList.add('is-selected');
  return row;
}

async function chooseSong(app, song) {
  const project = app.state.project;
  project.song = {
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    year: song.year,
    durationMs: song.durationMs,
    version: song.version,
    artworkUrl: song.artworkUrl,
    artworkUrl100: song.artworkUrl100,
    clipStartSeconds: 0,
  };

  const blob = await fetchCoverBlob(song);
  if (blob) {
    await app.setCover(blob);
  } else {
    app.state.media.cover = null;
    toast('The cover didn\'t come through. The rest still works.');
  }
  app.save();
}

// ---------------------------------------------------------------------------

function buildClipPicker(box, app) {
  clear(box);
  const project = app.state.project;
  const song = project.song;
  if (!song.title) return;

  const total = Math.max(1, Math.round((song.durationMs || 0) / 1000));

  box.append(
    h('h2', { class: 'label' }, 'Clip start'),
    h('p', { class: 'body' },
      'Set this to the same place you start the clip in Instagram, so the ' +
      'time on the slide matches the music.'),
    sliderRow({
      label: 'Starts at',
      min: 0,
      max: Math.max(1, total - 1),
      step: 1,
      value: Math.min(song.clipStartSeconds, total - 1),
      format: value => `${formatTime(value)} of ${formatTime(total)}`,
      onInput: value => {
        song.clipStartSeconds = value;
        app.save();
      },
    }),
  );
}

// ---------------------------------------------------------------------------

function buildManualForm(box, app, refresh) {
  clear(box);
  const project = app.state.project;
  const song = project.song;

  const title = h('input', { class: 'input', value: song.title, placeholder: 'Song title' });
  const artist = h('input', { class: 'input', value: song.artist, placeholder: 'Artist' });
  const minutes = h('input', {
    class: 'input', type: 'number', min: '0', max: '30',
    value: String(Math.floor((song.durationMs || 0) / 60000)),
  });
  const seconds = h('input', {
    class: 'input', type: 'number', min: '0', max: '59',
    value: String(Math.floor(((song.durationMs || 0) % 60000) / 1000)),
  });

  const coverInput = h('input', {
    type: 'file', accept: 'image/*', hidden: true,
    onchange: async event => {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!file) return;
      await app.setCover(file);
      toast('Cover added.');
    },
  });

  box.append(
    h('div', { class: 'field' }, h('label', {}, 'Title'), title),
    h('div', { class: 'field' }, h('label', {}, 'Artist'), artist),
    h('div', { class: 'field' },
      h('label', {}, 'Length'),
      h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
        minutes, h('span', { class: 'mono' }, ':'), seconds),
    ),
    h('button', {
      class: 'btn btn--block', type: 'button', onclick: () => coverInput.click(),
    }, icon('image', { size: 'sm' }), 'Add your own cover'),
    coverInput,
    h('button', {
      class: 'btn btn--block',
      type: 'button',
      onclick: () => {
        if (!title.value.trim()) {
          toast('A title is the one thing it needs.');
          return;
        }
        song.id = 'manual';
        song.title = title.value.trim();
        song.artist = artist.value.trim();
        song.album = '';
        song.year = '';
        song.version = '';
        song.durationMs = (Number(minutes.value) * 60 + Number(seconds.value)) * 1000;
        song.clipStartSeconds = 0;
        app.save();
        refresh();
        toast('Saved to this slide.');
      },
    }, icon('check', { size: 'sm' }), 'Use these details'),
  );
}
