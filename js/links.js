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
 * Spotify and YouTube addresses are recognised only so the app can say plainly
 * that it cannot open them. Resolving a Spotify link needs an account and a
 * server, and neither exists here.
 */

/**
 * @returns null when this is not a link at all, otherwise
 *   { source, kind, id }            something we can look up
 *   { unsupported: 'Spotify' }      a link we can name but not open
 */
export function parseMusicLink(text) {
  const trimmed = (text || '').trim();
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

  // --- The ones we can only name ----------------------------------------
  if (/open\.spotify\.com|spotify:/i.test(trimmed)) return { unsupported: 'Spotify' };
  if (/youtube\.com|youtu\.be/i.test(trimmed)) return { unsupported: 'YouTube' };

  return null;
}
