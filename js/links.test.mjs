/** Run with: node js/links.test.mjs */
import assert from 'node:assert/strict';
import { parseMusicLink } from './links.js';

const yt = 'https://music.youtube.com/watch?v=hY7eMYA5VyQ&si=MSDqIYOwKadajc9q';

// The address on its own, and the address as a share sheet pastes it.
for (const text of [yt, `Something About You\n${yt}`, `check this out ${yt} !`]) {
  assert.deepEqual(parseMusicLink(text), { source: 'youtube', kind: 'oembed', url: yt }, text);
}

// A sentence's punctuation is not part of the address.
assert.equal(parseMusicLink(`listen (${yt}).`).url, yt);

// Apple and Deezer still read straight out of the address, text or no text.
assert.deepEqual(
  parseMusicLink('i love this https://music.apple.com/us/album/untrue/893175779?i=893175788'),
  { source: 'itunes', kind: 'track', id: '893175788' },
);
assert.deepEqual(
  parseMusicLink('https://www.deezer.com/track/80546728'),
  { source: 'deezer', kind: 'track', id: '80546728' },
);
assert.deepEqual(
  parseMusicLink('spotify:track:2TpxZ7JUBn3uw46aR7qd6V'),
  { source: 'spotify', kind: 'oembed', url: 'spotify:track:2TpxZ7JUBn3uw46aR7qd6V' },
);

// Words are words.
assert.equal(parseMusicLink('radiohead creep'), null);

console.log('links: ok');
