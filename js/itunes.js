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

/** Country affects which catalogue is searched. Changeable in Settings. */
export function getCountry() {
  return localStorage.getItem('np-country') || 'US';
}

export function setCountry(code) {
  localStorage.setItem('np-country', (code || 'US').toUpperCase().slice(0, 2));
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
// The two things the app asks for
// ---------------------------------------------------------------------------

export async function searchSongs(term, { signal } = {}) {
  const trimmed = (term || '').trim();
  if (!trimmed) return [];

  const link = parseAppleMusicLink(trimmed);
  if (link) {
    const one = await lookupById(link);
    return one ? [one] : [];
  }

  const data = await request('/search', {
    term: trimmed,
    entity: 'song',
    limit: 25,
    country: getCountry(),
  });
  if (signal && signal.aborted) return [];
  return (data.results || []).filter(r => r.trackId).map(normalise);
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
