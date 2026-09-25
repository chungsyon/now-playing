/**
 * DEEZER
 * ------
 * The second catalogue. It is here for one reason: it indexes Korean song
 * titles properly. Searching 작업 returns twenty-three real 작업 tracks here
 * and none at all from Apple.
 *
 * It needs no key and no account. Its search endpoint sends no CORS header,
 * so every request goes through JSONP; its cover images do send one, so
 * covers can still be drawn onto the canvas without spoiling the export.
 *
 * Deezer's search results carry no release year. That is why a year is
 * sometimes missing from a result line.
 */

import { jsonp } from './net.js';

const BASE = 'https://api.deezer.com';

function call(path, params) {
  const query = new URLSearchParams({ ...params, output: 'jsonp' }).toString();
  return jsonp(`${BASE}${path}?${query}`);
}

function normalise(track) {
  const album = track.album || {};
  return {
    id: `dz${track.id}`,
    source: 'deezer',
    title: track.title || '',
    artist: (track.artist && track.artist.name) || '',
    album: album.title || '',
    year: '',                                   // not in Deezer search results
    durationMs: (track.duration || 0) * 1000,
    artworkUrl100: album.cover_small || album.cover_medium || '',
    // Biggest first: whichever loads is the one that gets drawn.
    coverUrls: [album.cover_xl, album.cover_big, album.cover_medium].filter(Boolean),
  };
}

function usable(track) {
  return track && track.id && track.duration && track.title;
}

export async function searchTracks(term) {
  const data = await call('/search', { q: term, limit: 25 });
  return (data.data || []).filter(usable).map(normalise);
}

/**
 * Find the performer, then ask for their most played tracks. Deezer handles
 * Korean artist names too: 뉴진스 finds NewJeans.
 */
export async function searchArtistTracks(term) {
  const found = await call('/search/artist', { q: term, limit: 5 });
  const artist = (found.data || [])[0];
  if (!artist) return { songs: [], artistName: null };

  const top = await call(`/artist/${artist.id}/top`, { limit: 50 });
  return {
    songs: (top.data || []).filter(usable).map(normalise),
    artistName: artist.name || null,
  };
}
