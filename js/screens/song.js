/**
 * SONG
 * ----
 * Find the track, then say where your Instagram clip starts. The clip start is
 * what the progress bar on the slide counts from, so the numbers on the slide
 * match the ones in Instagram.
 *
 * The screen has two states and only ever shows one of them:
 *
 *   CHOOSING  the search box and the results
 *   CHOSEN    the track you picked, the clip picker, and the way onward
 *
 * That is deliberate. With both on screen at once the button that continues
 * sits underneath twenty-five results, and you have to scroll past all of them
 * every single time.
 */

import { h, clear, icon, sliderRow, segmented, emptyState, toast, titleCard, bottle } from '../ui.js';
import { formatTime } from '../model.js';
import {
  searchSongs, fetchCoverBlob, parseMusicLink,
  getCountry, setCountry, getScope, setScope, SCOPES,
} from '../search.js';

export async function enter(root, app) {
  clear(root);
  const project = app.state.project;

  // Everything below the search box lives in here, and is rebuilt as a whole.
  const stage = h('div', { class: 'stack stack--wide' });

  let results = [];
  let artistName = null;
  let label = null;
  let noMatch = false;
  let unsupported = null;
  let linkFailed = false;
  let via = null;
  let notice = '';
  let searching = false;
  let runId = 0;
  let timer = null;

  const input = h('input', {
    class: 'input',
    type: 'search',
    enterkeyhint: 'search',
    placeholder: 'Song, artist, or a pasted link',
    'aria-label': 'Search for a song',
    value: app.state.lastQuery || '',
  });

  const scopeChoices = segmented(
    SCOPES.map(item => ({ value: item.id, label: item.label })),
    getScope(),
    value => {
      setScope(value);
      scopeChoices.select(value);
      if (input.value.trim()) search();
    },
    'What to match',
  );

  async function search() {
    const term = input.value.trim();
    app.state.lastQuery = term;
    const mine = ++runId;

    if (!term) {
      results = [];
      artistName = null;
      label = null;
      noMatch = false;
      unsupported = null;
      linkFailed = false;
      via = null;
      notice = '';
      searching = false;
      paint();
      return;
    }

    searching = true;
    paint();

    try {
      const found = await searchSongs(term);
      if (mine !== runId) return;
      results = found.songs;
      artistName = found.artistName;
      label = found.label || null;
      noMatch = found.noMatch;
      unsupported = found.unsupported || null;
      linkFailed = found.linkFailed || false;
      via = found.viaService ? { service: found.viaService, title: found.viaTitle } : null;
      notice = found.fellBack
        ? `The ${getCountry()} store had nothing, so this is the US store.`
        : '';
    } catch (error) {
      if (mine !== runId) return;
      results = [];
      artistName = null;
      label = null;
      noMatch = false;
      unsupported = null;
      linkFailed = false;
      via = null;
      notice = error.message === 'offline'
        ? 'No connection. Song search needs one; everything else works offline.'
        : 'Something didn\'t come through. Try once more.';
    } finally {
      if (mine === runId) {
        searching = false;
        paint();
      }
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    // Typing means you are looking again, so put the results back.
    if (project.song.title && input.value.trim() !== songLine(project.song)) {
      app.state.browsing = true;
    }
    timer = setTimeout(search, 350);
  });
  input.addEventListener('search', search);

  // --- the two states ------------------------------------------------------

  function paint() {
    clear(stage);
    const chosen = project.song.title && !app.state.browsing;
    if (chosen) paintChosen(stage, app, { onSearchAgain: () => { app.state.browsing = true; paint(); } });
    else paintChoosing(stage, app, {
      results, artistName, label, noMatch, unsupported, linkFailed, via, notice, searching, onPick: pick,
    });
    paintSettings(stage, app, search);
  }

  async function pick(song) {
    app.state.browsing = false;
    project.song = {
      id: song.id,
      source: song.source,
      title: song.title,
      artist: song.artist,
      album: song.album,
      year: song.year,
      durationMs: song.durationMs,
      version: song.version,
      artworkUrl100: song.artworkUrl100,
      coverUrls: song.coverUrls || [],
      clipStartSeconds: 0,
    };
    input.value = songLine(song);
    app.state.lastQuery = input.value;
    paint();

    const blob = await fetchCoverBlob(song);
    if (blob) {
      await app.setCover(blob);
    } else {
      app.state.media.cover = null;
      toast('The cover didn\'t come through. The rest still works.');
    }
    app.save();
  }

  root.append(
    h('div', { class: 'stack stack--wide develops', style: { paddingTop: '10px' } },
      titleCard('The song'),
      h('div', { class: 'stack', style: { gap: '4px' } },
        h('div', { class: 'search' }, icon('magnifying-glass', { size: 'sm' }), input),
        scopeChoices,
      ),
      stage,
    ),
  );

  if (app.state.browsing === undefined) app.state.browsing = !project.song.title;
  paint();
  if (app.state.browsing && input.value.trim() && results.length === 0) search();
}

function songLine(song) {
  return [song.title, song.artist].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Choosing
// ---------------------------------------------------------------------------

function paintChoosing(stage, app, {
  results, artistName, label, noMatch, unsupported, linkFailed, via, notice, searching, onPick,
}) {
  // The heading names the album or performer a pasted link opened, or whose
  // catalogue an artist search found, because it may not be the one you meant.
  const reading = searching ? ''
    : label || artistName
    || (results.length ? `${String(results.length).padStart(2, '0')} found` : '');
  const head = bottle('Results', reading);
  stage.append(h('div', { class: 'stack', style: { gap: '10px' } },
    head,
    searching ? h('div', { class: 'developing' }) : null,
    notice ? h('p', { class: 'body body--tight' }, notice) : null,
    // A link from a service we cannot look up became a search, so say that
    // rather than letting it look like an exact answer.
    via && !searching && results.length > 0
      ? h('p', { class: 'body body--tight' },
          `${via.service} only gives the name, so these are matches for `
          + `"${via.title}". Check the artist before you pick.`)
      : null,
    buildResults(results, { searching, noMatch, unsupported, linkFailed }, app, onPick),
  ));
}

function buildResults(results, state, app, onPick) {
  const { searching, noMatch, unsupported, linkFailed } = state;
  if (results.length === 0) {
    if (searching) return h('div');
    const term = (app.state.lastQuery || '').trim();
    if (!term) {
      return emptyState('Type a song or an artist, or paste a link. '
        + 'Korean and any other script work fine.');
    }
    if (unsupported) {
      return h('div', { class: 'stack', style: { gap: '10px' } },
        emptyState(`${unsupported} cannot be opened here.`),
        h('p', { class: 'body body--tight' },
          'Apple Music, Spotify, YouTube and full Deezer links all work. '
          + 'For anything else, type the song and the artist instead.'),
      );
    }
    if (linkFailed) {
      return emptyState('That link did not lead anywhere. Try the song name instead.');
    }
    if (parseMusicLink(term)) {
      return emptyState('That link did not lead anywhere. Try the song name instead.');
    }
    if (via) {
      return h('div', { class: 'stack', style: { gap: '10px' } },
        emptyState(`That ${via.service} link is "${via.title}", but neither catalogue has it.`),
        h('p', { class: 'body body--tight' },
          'Try the artist name alongside the title, or use By artist.'),
      );
    }
    if (noMatch) {
      // Apple did send something back, but none of it contained the words
      // typed, so it was thrown away. Say what usually works instead.
      return h('div', { class: 'stack', style: { gap: '10px' } },
        emptyState(`Nothing on Apple matches ${term}.`),
        h('p', { class: 'body body--tight' },
          'Short words often match nothing at all. More of the title usually ' +
          'finds it, or switch to By artist and use the performer\'s name.'),
      );
    }
    return emptyState(getScope() === 'artist'
      ? 'No performer by that name. Try Everything instead.'
      : 'Nothing came back for that. If it is a performer, try By artist.');
  }

  const list = h('div', { class: 'items' });
  for (const song of results) list.append(resultRow(song, onPick));
  return list;
}

function resultRow(song, onPick) {
  return h('button', { class: 'item', type: 'button', onclick: () => onPick(song) },
    h('img', {
      class: 'item__frame',
      src: song.artworkUrl100,
      alt: '',
      loading: 'lazy',
      crossorigin: 'anonymous',
    }),
    h('span', { class: 'item__main' },
      h('span', { class: 'item__title' }, song.title),
      h('span', { class: 'item__sub' },
        [song.artist, song.album, song.year].filter(Boolean).join('  /  ')),
    ),
    h('span', { class: 'item__value item__value--stack' },
      h('span', {}, formatTime(song.durationMs / 1000)),
      h('span', { class: 'tag' }, song.version),
    ),
  );
}

// ---------------------------------------------------------------------------
// Chosen
// ---------------------------------------------------------------------------

function paintChosen(stage, app, { onSearchAgain }) {
  const project = app.state.project;
  const song = project.song;
  const total = Math.max(1, Math.round((song.durationMs || 0) / 1000));

  const clipReading = bottle('Clip start',
    `${formatTime(song.clipStartSeconds)} / ${formatTime(total)}`);

  stage.append(
    h('div', { class: 'stack', style: { gap: '10px' } },
      bottle('Chosen', song.durationMs ? formatTime(song.durationMs / 1000) : null),
      h('div', { class: 'items' },
        h('div', { class: 'item', style: { cursor: 'default' } },
          h('img', { class: 'item__frame', src: song.artworkUrl100, alt: '', crossorigin: 'anonymous' }),
          h('span', { class: 'item__main' },
            h('span', { class: 'item__title' }, song.title),
            h('span', { class: 'item__sub' },
              [song.artist, song.album, song.year].filter(Boolean).join('  /  ')),
          ),
          song.version ? h('span', { class: 'tag' }, song.version) : null,
        ),
      ),
      h('button', {
        class: 'btn btn--bare btn--block',
        type: 'button',
        onclick: onSearchAgain,
      }, icon('magnifying-glass', { size: 'sm' }), 'Search again'),
    ),

    h('div', { class: 'stack', style: { gap: '6px' } },
      clipReading,
      sliderRow({
        label: 'Starts at',
        min: 0,
        max: Math.max(1, total - 1),
        step: 1,
        value: Math.min(song.clipStartSeconds, total - 1),
        format: value => formatTime(value),
        onInput: value => {
          song.clipStartSeconds = value;
          const reading = clipReading.querySelector('.bottle__value');
          if (reading) reading.textContent = `${formatTime(value)} / ${formatTime(total)}`;
          app.save();
        },
      }),
      h('p', { class: 'body body--tight' },
        'Set this where you start the clip in Instagram, so the time on the ' +
        'slide matches the music.'),
    ),

    h('button', {
      class: 'btn btn--primary btn--block',
      type: 'button',
      onclick: () => app.go('editor'),
    }, 'Open the editor'),
  );
}

// ---------------------------------------------------------------------------
// The settings that sit at the bottom of both states
// ---------------------------------------------------------------------------

function paintSettings(stage, app, search) {
  const manual = h('div', { class: 'stack', hidden: true });

  stage.append(
    h('div', { class: 'stack', style: { gap: '8px' } },
      bottle('Not listed'),
      h('button', {
        class: 'btn btn--bare btn--block',
        type: 'button',
        onclick: () => {
          manual.hidden = !manual.hidden;
          if (!manual.hidden) buildManualForm(manual, app);
        },
      }, 'Type the details in yourself'),
      manual,
    ),

    h('div', { class: 'stack', style: { gap: '8px' } },
      bottle('Store', getCountry()),
      h('div', { class: 'field' },
        h('label', { for: 'store-country' },
          'Two-letter country code. Korea has no songs in this catalogue, ' +
          'only videos, so searches there fall back to the US store.'),
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
}

function buildManualForm(box, app) {
  clear(box);
  const song = app.state.project.song;

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
      class: 'btn btn--bare btn--block', type: 'button', onclick: () => coverInput.click(),
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
        app.state.browsing = false;
        app.save();
        toast('Saved to this slide.');
        app.go('song');
      },
    }, icon('check', { size: 'sm' }), 'Use these details'),
  );
}
