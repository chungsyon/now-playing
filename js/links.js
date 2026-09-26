/**
 * PASTED LINKS
 * ------------
 * Work out what a pasted address points at, so the search box can take a link
 * as readily as it takes words.
 *
 * Apple and Deezer both put the kind of thing and its number straight in the
 * address, so no request is needed to tell an album from a single track:
 *
 *   music.apple.com/us/album/untrue/893175779?i=893175788   one track
 *   music.apple.com/us/album/untrue/893175779               a whole album
 *   music.apple.com/us/artist/burial/468355684              a performer
 *   deezer.com/track/80546728                               one track
 *
 * Spotify and YouTube cannot be read that way: their ids only mean something
 * inside their own service. Both publish a keyless oEmbed endpoint that names
 * the track, so those links are turned into a search instead of a lookup.
 * See js/oembed.js.
 */

/**
 * @returns null when this is not a link at all, otherwise
 *   { source, kind, id }            something we can look up
 *   { source, kind: 'oembed', url }  something to ask the service about
 *   { unsupported: '...' }          a link we can name but not open
 */
export function parseMusicLink(text) {
  // A share sheet rarely hands over a bare address. It usually pastes the
  // song's name, or a line of its own, with the address somewhere inside:
  //
  //   Something About You\nhttps://music.youtube.com/watch?v=...
  //
  // So the address is taken out of whatever came with it. A trailing full
  // stop or bracket belongs to the sentence, not the address.
  const raw = (text || '').trim();
  const inside = raw.match(/(?:https?:\/\/|spotify:)\S+/i);
  const trimmed = inside ? inside[0].replace(/[.,;:)\]}>'"]+$/, '') : raw;

  if (!/^https?:\/\//i.test(trimmed) && !/(music\.apple|deezer|spotify|youtu)/i.test(trimmed)) {
    return null;
  }

  // --- Apple -------------------------------------------------------------
  if (/music\.apple\.com/i.test(trimmed)) {
    // A track number in the query wins: an album address carrying one is a
    // link to that single track on that album.
    const inQuery = trimmed.match(/[?&]i=(\d+)/);
    if (inQuery) return { source: 'itunes', kind: 'track', id: inQuery[1] };

    const path = trimmed.match(/\/(album|song|artist)\/[^/]*\/(\d+)/i);
    if (path) {
      const kind = path[1].toLowerCase() === 'song' ? 'track'
        : path[1].toLowerCase() === 'album' ? 'album'
        : 'artist';
      return { source: 'itunes', kind, id: path[2] };
    }
    // A playlist, or a shape we do not know.
    return { unsupported: 'That Apple Music link' };
  }

  // --- Spotify ------------------------------------------------------------
  // Every shape goes the same way, including the spotify: URI, locale paths
  // like /intl-de/, and the spotify.link shortener, which the endpoint
  // resolves on its own side.
  if (/open\.spotify\.com|spotify\.link|^spotify:/i.test(trimmed)) {
    return { source: 'spotify', kind: 'oembed', url: trimmed };
  }

  // --- YouTube ------------------------------------------------------------
  // Ordinary videos, youtu.be, Shorts and music.youtube.com all answer here.
  if (/youtube\.com|youtu\.be/i.test(trimmed)) {
    return { source: 'youtube', kind: 'oembed', url: trimmed };
  }

  // --- Deezer ------------------------------------------------------------
  if (/(^|\.)deezer\.com/i.test(trimmed)) {
    // link.deezer.com shortens to the real address through a redirect this
    // app is not allowed to follow from the browser.
    if (/link\.deezer\.com/i.test(trimmed)) {
      return { unsupported: 'That shortened Deezer link' };
    }
    const path = trimmed.match(/\/(track|album|artist)\/(\d+)/i);
    if (path) return { source: 'deezer', kind: path[1].toLowerCase(), id: path[2] };
    return { unsupported: 'That Deezer link' };
  }

  return null;
}
