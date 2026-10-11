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

import {
  h, clear, icon, sliderRow, segmented, emptyState, toast, largeTitle, sectionHead, section, footnote,
} from '../ui.js';
import { formatTime } from '../model.js';
import {
  searchSongs, fetchCoverBlob, parseMusicLink,
  getCountry, setCountry, getScope, setScope, SCOPES,
} from '../search.js';

export async function enter(root, app) {
  clear(root);
  const project = app.state.project;

  // Everything below the search box lives in here, and is rebuilt as a whole.
  const stage = h('div', { class: 'page' });

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
    h('div', { class: 'page' },
      largeTitle('Song'),
      h('div', { class: 'section', style: { gap: '10px', marginTop: '-12px' } },
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
    || (results.length ? `${results.length} found` : '');
  stage.append(section(sectionHead('Results', reading),
    searching ? h('div', { class: 'spinner', role: 'status', 'aria-label': 'Searching' }) : null,
    notice ? h('p', { class: 'footnote', style: { paddingTop: '0', paddingBottom: '8px' } }, notice) : null,
    buildResults(results, { searching, noMatch, unsupported, linkFailed }, app, onPick),
    // A link from a service we cannot look up became a search, so say that
    // rather than letting it look like an exact answer.
    via && !searching && results.length > 0
      ? footnote(`${via.service} only gives the name, so these are matches for `
          + `"${via.title}". Check the artist before you pick.`)
      : null,
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
      return h('div', {},
        emptyState(`${unsupported} cannot be opened here.`),
        footnote('Apple Music, Spotify, YouTube and full Deezer links all work. '
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
      return h('div', {},
        emptyState(`That ${via.service} link is "${via.title}", but neither catalogue has it.`),
        footnote('Try the artist name alongside the title, or use By artist.'),
      );
    }
    if (noMatch) {
      // Apple did send something back, but none of it contained the words
      // typed, so it was thrown away. Say what usually works instead.
      return h('div', {},
        emptyState(`Nothing on Apple matches ${term}.`),
        footnote('Short words often match nothing at all. More of the title usually ' +
          'finds it, or switch to By artist and use the performer\'s name.'),
      );
    }
    return emptyState(getScope() === 'artist'
      ? 'No performer by that name. Try Everything instead.'
      : 'Nothing came back for that. If it is a performer, try By artist.');
  }

  const list = h('div', { class: 'group group--art' });
  for (const song of results) list.append(resultRow(song, onPick));
  return list;
}

function resultRow(song, onPick) {
  return h('button', { class: 'row', type: 'button', onclick: () => onPick(song) },
    h('img', {
      class: 'art',
      src: song.artworkUrl100,
      alt: '',
      loading: 'lazy',
      crossorigin: 'anonymous',
    }),
    h('span', { class: 'row__main' },
      h('span', { class: 'row__title' }, song.title),
      h('span', { class: 'row__sub' },
        [song.artist, song.album, song.year].filter(Boolean).join(' · ')),
    ),
    h('span', { class: 'row__value row__value--stack' },
      h('span', {}, formatTime(song.durationMs / 1000)),
      song.version ? h('span', { class: 'tag' }, song.version) : null,
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

  const cover = song.artworkUrl100
    ? h('img', {
        class: 'now__art',
        // The store's thumbnail address takes a size, so ask for one that
        // stays sharp at this size instead of stretching the 100px one.
        src: song.artworkUrl100.replace(/100x100/, '600x600'),
        alt: '',
        crossorigin: 'anonymous',
      })
    : h('div', { class: 'now__art', style: { display: 'grid', placeItems: 'center' } },
        icon('music-notes'));

  const clipValue = h('span', { class: 'section__value' },
    `${formatTime(song.clipStartSeconds)} of ${formatTime(total)}`);

  stage.append(
    h('div', { class: 'now' },
      cover,
      h('p', { class: 'now__title' }, song.title),
      h('p', { class: 'now__sub' }, [song.artist, song.year].filter(Boolean).join(' · ')),
      song.version ? h('span', { class: 'tag', style: { marginTop: '6px' } }, song.version) : null,
      h('button', {
        class: 'btn btn--plain',
        type: 'button',
        onclick: onSearchAgain,
      }, 'Choose a Different Song'),
    ),

    section(h('p', { class: 'section__head' }, h('span', {}, 'Clip start'), clipValue),
      h('div', { class: 'group group--pad' },
        sliderRow({
          label: 'Starts at',
          min: 0,
          max: Math.max(1, total - 1),
          step: 1,
          value: Math.min(song.clipStartSeconds, total - 1),
          format: value => formatTime(value),
          onInput: value => {
            song.clipStartSeconds = value;
            clipValue.textContent = `${formatTime(value)} of ${formatTime(total)}`;
            app.save();
          },
        }),
      ),
      footnote('Set this where you start the clip in Instagram, so the time on the ' +
        'slide matches the music.'),
    ),

    h('button', {
      class: 'btn btn--primary btn--block',
      type: 'button',
      onclick: () => app.go('editor'),
    }, 'Continue'),
  );
}

// ---------------------------------------------------------------------------
// The settings that sit at the bottom of both states
// ---------------------------------------------------------------------------

function paintSettings(stage, app, search) {
  const manual = h('div', { class: 'group group--pad', style: { marginTop: '8px' }, hidden: true });
  const chevron = icon('caret-down', { size: 'sm' });
  chevron.style.color = 'var(--label-3)';
  chevron.style.transition = 'transform var(--t-ui) var(--ease)';

  const country = h('input', {
    class: 'input input--inline',
    id: 'store-country',
    maxlength: '2',
    autocapitalize: 'characters',
    value: getCountry(),
    onchange: event => {
      setCountry(event.target.value);
      event.target.value = getCountry();
      search();
    },
  });

  stage.append(
    section('Not listed',
      h('div', { class: 'group' },
        h('button', {
          class: 'row',
          type: 'button',
          'aria-expanded': 'false',
          onclick: event => {
            manual.hidden = !manual.hidden;
            event.currentTarget.setAttribute('aria-expanded', String(!manual.hidden));
            chevron.style.transform = manual.hidden ? '' : 'rotate(180deg)';
            if (!manual.hidden) buildManualForm(manual, app);
          },
        }, h('span', { class: 'row__main', style: { color: 'var(--tint)' } },
          'Enter the Details Yourself'), chevron),
      ),
      manual,
    ),

    section('Store',
      h('div', { class: 'group' },
        h('label', { class: 'row', for: 'store-country' },
          h('span', { class: 'row__main' }, 'Country'), country),
      ),
      footnote('Two-letter country code. Korea has no songs in this catalogue, ' +
        'only videos, so searches there fall back to the US store.'),
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
      h('label', {}, 'Length, minutes and seconds'),
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
        minutes, h('span', {}, ':'), seconds),
    ),
    h('button', {
      class: 'btn btn--block', type: 'button', onclick: () => coverInput.click(),
    }, icon('image', { size: 'sm' }), 'Add Your Own Cover'),
    coverInput,
    h('button', {
      class: 'btn btn--primary btn--block',
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
    }, 'Use These Details'),
  );
}
