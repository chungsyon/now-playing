/**
 * SONG SEARCH
 * -----------
 * The only network call this app makes. It asks Apple's public iTunes Search
 * API for song details, and loads the cover image that comes back.
 *
 * Nothing about your photo or your project is ever sent anywhere.
 *
 * The API does send permissive CORS headers, so a normal fetch works. The JSONP
 * path below is kept as a fallback in case that ever changes: JSONP works by
 * loading the response as a <script> tag, which the browser does not police the
 * same way.
 */

const BASE = 'https://itunes.apple.com';

/**
 * Which store is searched.
 *
 * A warning about Korea: the KR store carries no songs on this API at all,
 * only music videos, which have no length and so are no use for the progress
 * bar. Searching in Korean works perfectly well from any other store, so the
 * default stays US and an empty result falls back to it automatically.
 */
export function getCountry() {
  return localStorage.getItem('np-country') || 'US';
}

export function setCountry(code) {
  localStorage.setItem('np-country', (code || 'US').toUpperCase().slice(0, 2));
}

/**
 * What the words you typed are matched against.
 *
 * 'all' throws the words at titles, artists and albums together, which is what
 * you want most of the time.
 *
 * 'artist' is a different request entirely: it finds the performer first, then
 * asks for their catalogue. That matters when the name is also a common word.
 * Searching Burial the ordinary way returns a dozen unrelated songs called
 * Burial and never the artist; asking for the artist returns Archangel.
 *
 * There is deliberately no 'title' scope. The API takes an `attribute`
 * parameter that is supposed to do this, but it is silently ignored for music:
 * songTerm and artistTerm come back byte-identical to no attribute at all.
 * A scope that changed nothing would just be a lie on screen.
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
// Talking to the API
// ---------------------------------------------------------------------------

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const name = `npCallback${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const cleanup = () => {
      delete window[name];
      script.remove();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('The search timed out.'));
    }, 12000);

    window[name] = data => {
      clearTimeout(timer);
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error('The search could not be reached.'));
    };
    script.src = `${url}&callback=${name}`;
    document.head.appendChild(script);
  });
}

async function request(path, params) {
  const query = new URLSearchParams(params).toString();
  const url = `${BASE}${path}?${query}`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Search returned ${response.status}`);
    return await response.json();
  } catch (error) {
    if (!navigator.onLine) throw new Error('offline');
    // Blocked by the browser rather than broken: try the JSONP route.
    return jsonp(url);
  }
}

// ---------------------------------------------------------------------------
// Turning a result into something the app can use
// ---------------------------------------------------------------------------

/**
 * Guess which recording this is from the title and album. It is only a guess,
 * shown as a small tag so you can tell two near-identical results apart.
 */
export function versionTag(track) {
  const text = `${track.trackName || ''} ${track.collectionName || ''}`.toLowerCase();
  if (/\blive\b|live at|live from|live in/.test(text)) return 'Live';
  if (/remaster/.test(text)) return 'Remaster';
  if (/acoustic|unplugged/.test(text)) return 'Acoustic';
  if (/demo\b/.test(text)) return 'Demo';
  if (/instrumental/.test(text)) return 'Instrumental';
  return 'Original';
}

/** Ask for a big cover. Apple serves any size by rewriting the filename. */
export function artworkAt(url100, size = 1200) {
  if (!url100) return '';
  return url100.replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`);
}

function normalise(track) {
  return {
    id: String(track.trackId || ''),
    title: track.trackName || '',
    artist: track.artistName || '',
    album: track.collectionName || '',
    year: (track.releaseDate || '').slice(0, 4),
    durationMs: track.trackTimeMillis || 0,
    version: versionTag(track),
    artworkUrl100: track.artworkUrl100 || '',
    artworkUrl: artworkAt(track.artworkUrl100, 1200),
  };
}

// ---------------------------------------------------------------------------
// Is a result actually about what you asked for?
// ---------------------------------------------------------------------------

/**
 * Apple does not return an empty list when it cannot match your words. It
 * returns popular songs instead. Type 작업 and back come Taylor Swift and
 * Fleetwood Mac, with nothing to say they are filler.
 *
 * So every result is checked against the words you typed. Ones that genuinely
 * contain them are floated to the top, and if not a single result contains any
 * of them, the whole batch is filler and is thrown away.
 */

/** Lower case, and with spacing and punctuation taken out, so 너랑 나 matches 너랑나. */
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

function matchesQuery(song, tokens) {
  if (tokens.length === 0) return true;
  const haystack = flatten(`${song.title} ${song.artist} ${song.album}`);
  return tokens.some(token => haystack.includes(token));
}

/**
 * The performer who accounts for the largest share of a batch.
 *
 * This is how a Korean artist name is told apart from a Korean word that
 * matches nothing. Apple files 아이유 under "IU", so none of the results
 * contain the letters typed, yet 84% of them are by the same performer. Type a
 * word it cannot place and the batch scatters across twenty-three different
 * artists. Measured: real artist searches come back at 0.63 to 0.92, filler at
 * 0.08 to 0.15, so half is a safe line to draw.
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
 * Put the results that really contain your words first, and report how many
 * there were. The order within each group is left exactly as Apple sent it.
 */
function rankByRelevance(songs, term) {
  const tokens = queryTokens(term);
  if (tokens.length === 0) return { songs, relevant: songs.length };
  const hits = songs.filter(song => matchesQuery(song, tokens));
  const rest = songs.filter(song => !matchesQuery(song, tokens));
  return { songs: [...hits, ...rest], relevant: hits.length };
}

// ---------------------------------------------------------------------------
// The two things the app asks for
// ---------------------------------------------------------------------------

/**
 * Search. Returns { songs, searchedCountry, fellBack }.
 *
 * Korean, Japanese and every other script work fine here. What comes back is
 * whatever name Apple files the track under internationally, which for Korean
 * releases is usually the English or romanised one: search 밤편지 and the
 * result reads "Through the Night by IU". The artist is the thing to
 * recognise it by.
 */
export async function searchSongs(term, { scope = getScope() } = {}) {
  const trimmed = (term || '').trim();
  const empty = {
    songs: [], artistName: null, noMatch: false,
    searchedCountry: getCountry(), fellBack: false,
  };
  if (!trimmed) return empty;

  const link = parseAppleMusicLink(trimmed);
  if (link) {
    const one = await lookupById(link);
    return { ...empty, songs: one ? [one] : [] };
  }

  const country = getCountry();
  const run = scope === 'artist' ? runByArtist : runEverything;

  let found = await run(trimmed, country);

  // Some stores sell no songs at all through this API. Rather than show an
  // empty screen, ask the US store, which carries nearly everything.
  if (found.songs.length === 0 && country !== 'US') {
    const fallback = await run(trimmed, 'US');
    if (fallback.songs.length > 0) {
      return { ...fallback, searchedCountry: 'US', fellBack: true };
    }
  }

  return { ...found, searchedCountry: country, fellBack: false };
}

/** The ordinary search: the words go against everything at once. */
async function runEverything(term, country) {
  const data = await request('/search', { term, entity: 'song', limit: 25, country });
  const all = (data.results || [])
    .filter(r => r.trackId && r.trackTimeMillis)
    .map(normalise);

  const { songs, relevant } = rankByRelevance(all, term);
  if (relevant > 0) return { songs, artistName: null, noMatch: false };
  if (all.length === 0) return { songs: [], artistName: null, noMatch: false };

  // Nothing contains a word you typed. Apple may still have understood it as a
  // performer it files under another spelling, so check whether the batch is
  // really one artist before throwing it away.
  const { artist, share } = dominantArtist(all);
  if (artist && share >= 0.5) {
    return {
      songs: [
        ...all.filter(song => song.artist === artist),
        ...all.filter(song => song.artist !== artist),
      ],
      artistName: artist,
      noMatch: false,
    };
  }

  // A scatter of unrelated performers: this is Apple's filler, not an answer.
  return { songs: [], artistName: null, noMatch: true };
}

/**
 * Find the performer, then ask for their catalogue. Two requests instead of
 * one, which is why it is a separate mode rather than the default.
 */
async function runByArtist(term, country) {
  const found = await request('/search', { term, entity: 'musicArtist', limit: 5, country });
  const artist = (found.results || []).find(a => a.artistId);
  if (!artist) return { songs: [], artistName: null, noMatch: false };

  const data = await request('/lookup', {
    id: artist.artistId,
    entity: 'song',
    limit: 50,
    country,
  });
  const songs = (data.results || [])
    // The first row that comes back is the artist, not a track.
    .filter(r => r.wrapperType === 'track' && r.trackId && r.trackTimeMillis)
    .map(normalise);
  // No relevance check here: this is a whole catalogue by one performer, and
  // the heading names who that was, so a wrong guess is visible at a glance.
  return { songs, artistName: artist.artistName || null, noMatch: false };
}

export async function lookupById(id) {
  const data = await request('/lookup', { id, country: getCountry() });
  const first = (data.results || [])[0];
  return first ? normalise(first) : null;
}

/** Pull the track id out of a pasted Apple Music link. */
export function parseAppleMusicLink(text) {
  if (!/music\.apple\.com/i.test(text)) return null;
  const byQuery = text.match(/[?&]i=(\d+)/);
  if (byQuery) return byQuery[1];
  const bySegment = text.match(/\/(\d{6,})(?:[/?#]|$)/);
  return bySegment ? bySegment[1] : null;
}

// ---------------------------------------------------------------------------
// Loading the cover so it can be drawn onto a canvas
// ---------------------------------------------------------------------------

/**
 * Fetch the cover as a blob rather than pointing an <img> at Apple directly.
 * A blob belongs to this page, so drawing it onto a canvas never marks that
 * canvas as "tainted", which would stop the export from working.
 *
 * Falls back to a smaller size if the big one is not available.
 */
export async function fetchCoverBlob(song) {
  const sizes = [1200, 600, 100];
  const base = song.artworkUrl100 || song.artworkUrl;
  if (!base) return null;

  for (const size of sizes) {
    const url = artworkAt(base, size);
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (response.ok) return await response.blob();
    } catch (error) {
      // Try the next size down.
    }
  }
  return null;
}
