/**
 * SEARCH
 * ------
 * Asks both catalogues at once and works out what to show.
 *
 * Neither one is good enough alone, and they fail in opposite directions.
 * Measured on the same queries:
 *
 *   작업              Deezer 23 real hits of 25   Apple 0 of 25
 *   작업실            Deezer 21                   Apple 2
 *   radiohead creep   Deezer finds the Radiohead recording first
 *   아이유            Apple finds IU              Deezer finds AKMU
 *   뉴진스            Apple finds NewJeans        Deezer finds a cover
 *   archangel burial  Apple finds Burial          Deezer finds meditation music
 *
 * So both are asked, the answers are merged, and every result is scored by how
 * many of the words you typed it actually contains. That one rule sorts all
 * six cases out: 작업 rises from Deezer, Archangel by Burial beats Archangel
 * Uriel because it matches both words rather than one.
 */

import * as apple from './itunes.js';
import * as deezer from './deezer.js';
import { getCountry } from './itunes.js';

export { getCountry, setCountry, parseAppleMusicLink } from './itunes.js';

/**
 * What the words you typed are matched against.
 *
 * 'artist' is a different request, not a filter: it finds the performer first
 * and then asks for their catalogue. That matters when the name is also a
 * common word, as Burial is.
 *
 * There is deliberately no 'title' scope. Apple takes an `attribute` parameter
 * that is supposed to do this and silently ignores it for music; songTerm and
 * artistTerm come back byte-identical to no attribute at all.
 */
export const SCOPES = [
  { id: 'all', label: 'Everything' },
  { id: 'artist', label: 'By artist' },
];

export function getScope() {
  return localStorage.getItem('np-scope') || 'all';
}

export function setScope(id) {
  localStorage.setItem('np-scope', SCOPES.some(s => s.id === id) ? id : 'all');
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Lower case, with spacing and punctuation taken out, so 너랑 나 matches 너랑나. */
function flatten(text) {
  return (text || '').toLowerCase().replace(/[\s\-_'".,()\[\]/&!?:;]+/g, '');
}

/** The words worth matching on. Single characters are too loose to count. */
function queryTokens(term) {
  return (term || '')
    .toLowerCase()
    .split(/[\s,./&\-_]+/)
    .map(flatten)
    .filter(token => token.length >= 2);
}

/**
 * How well a result answers what you typed.
 *
 * Counting the words rather than just asking yes or no is what puts Archangel
 * by Burial above Archangel Uriel Destroying All Negative Energy: two words
 * matched against one.
 *
 * A word in the title or the artist is worth more than a word in the album,
 * because a track called 작업실 is a better answer than an unrelated track
 * that happens to sit on an album of that name. And a title that is exactly
 * what you typed takes one more point, so searching radiohead creep finds
 * Creep before Creep (Acoustic).
 */
function score(song, tokens) {
  if (tokens.length === 0) return 1;
  const front = flatten(`${song.title} ${song.artist}`);
  const back = flatten(song.album);

  let points = 0;
  for (const token of tokens) {
    if (front.includes(token)) points += 2;
    else if (back.includes(token)) points += 1;
  }
  if (points > 0 && tokens.includes(flatten(song.title))) points += 1;
  return points;
}

/**
 * The performer who accounts for the largest share of a batch.
 *
 * This is how a Korean artist name is told apart from a word that matches
 * nothing. Apple files 아이유 under "IU", so no result contains the letters
 * typed, yet 84% of them are by one performer. A word it cannot place scatters
 * across twenty-three artists. Measured: real matches run 0.63 to 0.92, filler
 * 0.08 to 0.15, so half is a safe line.
 */
function dominantArtist(songs) {
  const counts = new Map();
  for (const song of songs) counts.set(song.artist, (counts.get(song.artist) || 0) + 1);
  let artist = null;
  let best = 0;
  for (const [name, count] of counts) {
    if (count > best) { best = count; artist = name; }
  }
  return { artist, share: songs.length ? best / songs.length : 0 };
}

/**
 * Guess which recording this is. Only a guess, shown as a small tag so two
 * near-identical results can be told apart.
 */
export function versionTag(song) {
  const text = `${song.title} ${song.album}`.toLowerCase();
  if (/\blive\b|live at|live from|live in/.test(text)) return 'Live';
  if (/remaster/.test(text)) return 'Remaster';
  if (/acoustic|unplugged/.test(text)) return 'Acoustic';
  if (/\bdemo\b/.test(text)) return 'Demo';
  if (/instrumental|\(inst\.?\)|\[inst\.?\]/.test(text)) return 'Instrumental';
  if (/\bcover\b/.test(text)) return 'Cover';
  return 'Original';
}

/** The same recording from both catalogues is still one recording. */
function dedupe(songs) {
  const seen = new Map();
  for (const song of songs) {
    const key = `${flatten(song.title)}|${flatten(song.artist)}`;
    const existing = seen.get(key);
    // Apple wins ties: it carries the release year, which Deezer does not.
    if (!existing || (existing.source === 'deezer' && song.source === 'itunes')) {
      seen.set(key, song);
    }
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// The search itself
// ---------------------------------------------------------------------------

/** Ask a source, and treat a failure as an empty answer rather than a crash. */
async function tryEach(promises) {
  const settled = await Promise.allSettled(promises);
  const failures = settled.filter(r => r.status === 'rejected');
  // Only a total failure is worth reporting: if one catalogue is down, the
  // other one still has an answer.
  if (failures.length === settled.length && failures.length > 0) {
    throw failures[0].reason;
  }
  return settled.map(r => (r.status === 'fulfilled' ? r.value : null));
}

/**
 * Search both catalogues.
 * Returns { songs, artistName, noMatch, searchedCountry, fellBack }.
 */
export async function searchSongs(term, { scope = getScope() } = {}) {
  const trimmed = (term || '').trim();
  const country = getCountry();
  const empty = { songs: [], artistName: null, noMatch: false, searchedCountry: country, fellBack: false };
  if (!trimmed) return empty;

  const linkId = apple.parseAppleMusicLink(trimmed);
  if (linkId) {
    const one = await apple.lookupById(linkId);
    return { ...empty, songs: one ? [withTag(one)] : [] };
  }

  const found = scope === 'artist'
    ? await gatherByArtist(trimmed, country)
    : await gatherEverything(trimmed, country);

  // Apple's store may carry no songs at all in some countries. If nothing came
  // back anywhere, try the US store before giving up.
  if (found.songs.length === 0 && !found.noMatch && country !== 'US') {
    const retry = scope === 'artist'
      ? await gatherByArtist(trimmed, 'US')
      : await gatherEverything(trimmed, 'US');
    if (retry.songs.length > 0) {
      return { ...retry, searchedCountry: 'US', fellBack: true };
    }
  }

  return { ...found, searchedCountry: country, fellBack: false };
}

async function gatherEverything(term, country) {
  const [fromApple, fromDeezer] = await tryEach([
    apple.searchTracks(term, country),
    deezer.searchTracks(term),
  ]);

  const all = dedupe([...(fromApple || []), ...(fromDeezer || [])]);
  if (all.length === 0) return { songs: [], artistName: null, noMatch: false };

  const tokens = queryTokens(term);
  const hits = all
    .map(song => ({ song, points: score(song, tokens) }))
    .filter(entry => entry.points > 0)
    .sort((a, b) => b.points - a.points)
    .map(entry => entry.song);

  // Apple may also have read the words as a performer it files under another
  // spelling. Both signals are used, because either one alone gets a case
  // wrong: 뉴진스 turns up a single cover version by name while Apple quietly
  // has the whole NewJeans catalogue under a name that matches nothing.
  const onlyApple = fromApple || [];
  const { artist, share } = dominantArtist(onlyApple);
  const byArtist = artist && share >= 0.5
    ? onlyApple.filter(song => song.artist === artist)
    : [];

  if (hits.length === 0 && byArtist.length === 0) {
    // A scatter of unrelated performers: this is filler, not an answer.
    return { songs: [], artistName: null, noMatch: true };
  }

  const ordered = byId([...hits, ...byArtist]);
  return {
    songs: ordered.map(withTag),
    artistName: byArtist.length > 0 ? artist : null,
    noMatch: false,
  };
}

/** Keep the first of each track, by id. */
function byId(songs) {
  const seen = new Set();
  return songs.filter(song => {
    if (seen.has(song.id)) return false;
    seen.add(song.id);
    return true;
  });
}

async function gatherByArtist(term, country) {
  const [fromApple, fromDeezer] = await tryEach([
    apple.searchArtistTracks(term, country),
    deezer.searchArtistTracks(term),
  ]);

  const appleSongs = (fromApple && fromApple.songs) || [];
  const deezerSongs = (fromDeezer && fromDeezer.songs) || [];
  const songs = dedupe([...appleSongs, ...deezerSongs]);

  // Name whichever catalogue actually found somebody, Apple first.
  const artistName = (fromApple && fromApple.artistName)
    || (fromDeezer && fromDeezer.artistName)
    || null;

  return { songs: songs.map(withTag), artistName, noMatch: false };
}

function withTag(song) {
  return { ...song, version: versionTag(song) };
}

// ---------------------------------------------------------------------------
// The cover
// ---------------------------------------------------------------------------

/**
 * Fetch the cover as a blob rather than pointing an <img> at the catalogue.
 * A blob belongs to this page, so drawing it onto a canvas never marks that
 * canvas as tainted, which would stop the export working. Both catalogues
 * serve their images with the header that allows this.
 */
export async function fetchCoverBlob(song) {
  const urls = song.coverUrls && song.coverUrls.length
    ? song.coverUrls
    : [song.artworkUrl100].filter(Boolean);

  for (const url of urls) {
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (response.ok) return await response.blob();
    } catch (error) {
      // Try the next size down.
    }
  }
  return null;
}
