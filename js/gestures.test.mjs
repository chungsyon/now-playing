/** Run with: node js/gestures.test.mjs */
import assert from 'node:assert/strict';
import { pullTo, pullAngle, placeMembers } from './gestures.js';
import { createProject, movesWith } from './model.js';

const near = (a, b, slack = 1e-9) => assert.ok(Math.abs(a - b) <= slack, `${a} != ${b}`);

// --- snapping --------------------------------------------------------------
near(pullTo(0.508, [0.5], 0.014), -0.008);   // close enough: pulled to the middle
near(pullTo(0.540, [0.5], 0.014), 0);        // too far: left alone
near(pullTo(0.26, [0.5, 0.25], 0.014), -0.01); // the nearer of two targets wins

assert.equal(pullAngle(14), 15);
assert.equal(pullAngle(-31), -30);
assert.equal(pullAngle(22), 22);             // between two clean angles: free
assert.equal(pullAngle(0.5), 0);

// --- moving a group --------------------------------------------------------
const project = createProject({});
const stage = { width: 540, height: 675 };
const cover = project.layers.find(l => l.type === 'cover');
const members = movesWith(project, cover).map(layer => ({
  layer,
  x: layer.props.x, y: layer.props.y,
  scale: layer.props.scale, rotation: layer.props.rotation,
}));
assert.equal(members.length, 4, 'the photo stays out of the group');

const pivotX = members.reduce((s, m) => s + m.x, 0) / members.length;
const pivotY = members.reduce((s, m) => s + m.y, 0) / members.length;
const start = { members, pivotX, pivotY };

// A plain drag shifts everything by the same amount and changes nothing else.
placeMembers(start, stage, 1, 0, 0.1, -0.05);
for (const m of members) {
  near(m.layer.props.x, m.x + 0.1);
  near(m.layer.props.y, m.y - 0.05);
  near(m.layer.props.scale, m.scale);
  near(m.layer.props.rotation, m.rotation);
}

// A turn is about the pivot, so the pivot itself does not move...
placeMembers(start, stage, 1, 90, 0, 0);
const midX = members.reduce((s, m) => s + m.layer.props.x, 0) / members.length;
const midY = members.reduce((s, m) => s + m.layer.props.y, 0) / members.length;
near(midX, pivotX, 1e-9);
near(midY, pivotY, 1e-9);

// ...and the gaps between members keep their length, measured in pixels.
const gapBefore = Math.hypot(
  (members[0].x - members[1].x) * stage.width,
  (members[0].y - members[1].y) * stage.height,
);
const gapAfter = Math.hypot(
  (members[0].layer.props.x - members[1].layer.props.x) * stage.width,
  (members[0].layer.props.y - members[1].layer.props.y) * stage.height,
);
near(gapAfter, gapBefore, 1e-9);

// Resizing pulls members towards the pivot by the same factor.
placeMembers(start, stage, 0.5, 0, 0, 0);
const shrunk = Math.hypot(
  (members[0].layer.props.x - members[1].layer.props.x) * stage.width,
  (members[0].layer.props.y - members[1].layer.props.y) * stage.height,
);
near(shrunk, gapBefore * 0.5, 1e-9);
near(members[0].layer.props.scale, members[0].scale * 0.5);

// Every call measures from the start, so repeating one is not cumulative.
placeMembers(start, stage, 0.5, 0, 0, 0);
near(members[0].layer.props.scale, members[0].scale * 0.5);

// Grouping off leaves one layer on its own.
project.grouped = false;
assert.equal(movesWith(project, cover).length, 1);

console.log('gestures: ok');
