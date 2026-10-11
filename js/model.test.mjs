/** Run with: node js/model.test.mjs */
import assert from 'node:assert/strict';
import { valueAt, setValueAt, toggleKeyAt, keyIndexAt, isKeyed, moveKeyAt } from './model.js';

const params = { radius: 0 };

// Unkeyed, a slider just sets the value.
setValueAt(params, 'radius', 3, 10);
assert.equal(params.radius, 10);

// The first ◆ starts keying, holding the value as it is.
toggleKeyAt(params, 'radius', 0, 0);
assert.ok(isKeyed(params.radius));
assert.equal(valueAt(params.radius, 0), 10);

// Moving the slider somewhere else on the timeline records a keyframe there.
setValueAt(params, 'radius', 4, 50);
assert.equal(params.radius.keyframes.length, 2);
assert.equal(valueAt(params.radius, 4), 50);
const middle = valueAt(params.radius, 2);
assert.ok(middle > 10 && middle < 50, 'eases between the two');

// At a keyframe's moment, the slider edits that keyframe rather than adding one.
setValueAt(params, 'radius', 4.02, 40);
assert.equal(params.radius.keyframes.length, 2);
assert.equal(valueAt(params.radius, 4), 40);

// Keyframes stay in time order whichever order they are made in.
setValueAt(params, 'radius', 1, 20);
assert.deepEqual(params.radius.keyframes.map(k => k.t), [0, 1, 4]);

// ◆ on a keyframe removes it; removing the last one leaves a plain value.
toggleKeyAt(params, 'radius', 1, 0);
assert.equal(keyIndexAt(params.radius, 1), -1);
toggleKeyAt(params, 'radius', 4, 0);
toggleKeyAt(params, 'radius', 0, 0);
assert.equal(params.radius, 10);

// Sliding a keyframe along the timeline moves it and keeps the order.
const moving = { x: { keyframes: [{ t: 0, value: 0 }, { t: 2, value: 1 }, { t: 6, value: 0 }] } };
moveKeyAt(moving, 'x', 2, 7);
assert.deepEqual(moving.x.keyframes.map(k => k.t), [0, 6, 7]);
assert.equal(valueAt(moving.x, 7), 1);

console.log('model: ok');
