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
/** One track, by id. Deezer gives a release date here, which search does not. */
export async function trackById(id) {
  const track = await call(`/track/${id}`, {});
  if (!usable(track)) return null;
  const song = normalise(track);
  song.year = (track.release_date || '').slice(0, 4);
  return song;
}

/** Everything on an album. */
export async function tracksFromAlbum(id) {
  const album = await call(`/album/${id}`, {});
  const rows = (album.tracks && album.tracks.data) || [];
  const year = (album.release_date || '').slice(0, 4);
  return {
    // Tracks listed inside an album carry no album block of their own, so the
    // cover and title are taken from the album around them.
    songs: rows.filter(usable).map(track => {
      const song = normalise({ ...track, album });
      song.year = year;
      return song;
    }),
    label: album.title || null,
  };
}

/** Everything by a performer, from their id. */
export async function tracksFromArtistId(id) {
  const [artist, top] = await Promise.all([
    call(`/artist/${id}`, {}),
    call(`/artist/${id}/top`, { limit: 50 }),
  ]);
  return {
    songs: (top.data || []).filter(usable).map(normalise),
    label: artist.name || null,
  };
}

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
