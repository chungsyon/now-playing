/**
 * APPLE
 * -----
 * The first catalogue. It is better than Deezer at two things: Korean artist
 * names, because it files 아이유 under IU and 뉴진스 under NewJeans, and
 * queries that name an artist and a title together.
 *
 * It sends permissive CORS headers, so a normal fetch works and the JSONP
 * path is only a fallback in case that ever changes.
 */

import { getJson } from './net.js';

const BASE = 'https://itunes.apple.com';

/**
 * Which store is searched.
 *
 * A warning about Korea: the KR store carries no songs on this API at all,
 * only music videos, which have no length and so are no use for the progress
 * bar. The default stays US and an empty result falls back to it.
 */
export function getCountry() {
  return localStorage.getItem('np-country') || 'US';
}

export function setCountry(code) {
  localStorage.setItem('np-country', (code || 'US').toUpperCase().slice(0, 2));
}

function call(path, params) {
  return getJson(`${BASE}${path}?${new URLSearchParams(params).toString()}`);
}

/** Ask for a big cover. Apple serves any size by rewriting the filename. */
export function artworkAt(url100, size = 1200) {
  if (!url100) return '';
  return url100.replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`);
}

function normalise(track) {
  return {
    id: `it${track.trackId}`,
    source: 'itunes',
    title: track.trackName || '',
    artist: track.artistName || '',
    album: track.collectionName || '',
    year: (track.releaseDate || '').slice(0, 4),
    durationMs: track.trackTimeMillis || 0,
    artworkUrl100: track.artworkUrl100 || '',
    coverUrls: [
      artworkAt(track.artworkUrl100, 1200),
      artworkAt(track.artworkUrl100, 600),
      track.artworkUrl100,
    ].filter(Boolean),
  };
}

function usable(track) {
  return track && track.trackId && track.trackTimeMillis;
}

export async function searchTracks(term, country = getCountry()) {
  const data = await call('/search', { term, entity: 'song', limit: 25, country });
  return (data.results || []).filter(usable).map(normalise);
}

/** Find the performer, then ask for their catalogue by id. */
export async function searchArtistTracks(term, country = getCountry()) {
  const found = await call('/search', { term, entity: 'musicArtist', limit: 5, country });
  const artist = (found.results || []).find(a => a.artistId);
  if (!artist) return { songs: [], artistName: null };

  const data = await call('/lookup', { id: artist.artistId, entity: 'song', limit: 50, country });
  return {
    // The first row that comes back is the artist, not a track.
    songs: (data.results || []).filter(r => r.wrapperType === 'track' && usable(r)).map(normalise),
    artistName: artist.artistName || null,
  };
}

export async function lookupById(id, country = getCountry()) {
  const data = await call('/lookup', { id, country });
  const first = (data.results || []).find(usable);
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
