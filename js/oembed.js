/**
 * SPOTIFY AND YOUTUBE LINKS
 * -------------------------
 * Neither one can be looked up the way Apple and Deezer can. Their addresses
 * carry an id that only means something inside their own service, and reading
 * it needs an account and a server.
 *
 * What both of them do offer is oEmbed: a public, keyless endpoint meant for
 * websites that want to show a little preview card. It answers with the title,
 * and in YouTube's case the channel as well. Both send the header a browser
 * needs to read the answer, so no script injection is involved.
 *
 * That is enough to turn a pasted link into a search. It is a search and not a
 * lookup, so the screen says so: Spotify gives no artist and no length, and
 * two songs can share a title.
 */

const ENDPOINTS = {
  spotify: url => `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
  youtube: url => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
};

/**
 * The words YouTube uploaders add that are about the video rather than the
 * song. Stripped so a search has a chance of matching the recording.
 * Anything that might be part of a real title, such as (feat. ...) or
 * (Acoustic), is deliberately left alone.
 */
const VIDEO_FURNITURE = [
  /\[[^\]]*\b(official|lyrics?|lyric|audio|video|mv|m\/v|visuali[sz]er|teaser|performance)\b[^\]]*\]/gi,
  /\([^)]*\b(official|lyrics?|lyric|audio|video|mv|m\/v|visuali[sz]er|teaser|performance)\b[^)]*\)/gi,
  /\([^)]*\b(\d+k|hd|hq|remaster(ed)?|full\s*version)\b[^)]*\)/gi,
  /\b(official\s+)?(music\s+)?video\b/gi,
  /\bfull\s+album\b/gi,
];

function tidyTitle(title) {
  let text = title || '';
  for (const pattern of VIDEO_FURNITURE) text = text.replace(pattern, ' ');
  return text.replace(/\s{2,}/g, ' ').replace(/[\s\-|·]+$/, '').trim();
}

/** "Rick Astley - Topic" and "ArtistVEVO" are channel names, not artist names. */
function tidyChannel(name) {
  return (name || '')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/\s*-\s*Official$/i, '')
    .trim();
}

/** Join the two without saying the artist twice. */
function buildQuery(title, artist) {
  const clean = tidyTitle(title);
  const who = tidyChannel(artist);
  if (!who) return clean;
  if (clean.toLowerCase().includes(who.toLowerCase())) return clean;
  return `${clean} ${who}`.trim();
}

/**
 * Ask the service what a link points at.
 * @returns { query, title, artist } or null when it cannot be read.
 */
export async function resolveByOEmbed(source, url) {
  const endpoint = ENDPOINTS[source];
  if (!endpoint) return null;

  const response = await fetch(endpoint(url));
  if (!response.ok) return null;
  const data = await response.json();

  const title = data.title || '';
  if (!title) return null;

  // YouTube names the channel; Spotify names nobody.
  const artist = source === 'youtube' ? tidyChannel(data.author_name || '') : '';

  return {
    query: buildQuery(title, artist),
    title: tidyTitle(title),
    artist,
  };
}
