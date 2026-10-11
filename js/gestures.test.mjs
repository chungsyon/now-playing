/** Run with: node js/gestures.test.mjs */
import assert from 'node:assert/strict';
import { pullTo, pullAngle, placeMembers, handleAt, layerBounds, fitToSlide } from './gestures.js';
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

// --- corner handles --------------------------------------------------------
// A mouse cannot pinch, so the four dots are grabbable. These check that the
// grabbable area is where the dot is drawn, including on a turned layer.
{
  const p = createProject({ template: 'vinyl' });
  const st = { width: 1080, height: 1350 };
  const sleeve = p.layers.find(l => l.type === 'cover');
  const b = layerBounds(sleeve, p, st);
  const corner = { x: b.cx + b.w / 2, y: b.cy + b.h / 2 };
  const out = d => handleAt(sleeve, p, st, corner.x + d, corner.y + d);

  assert.equal(handleAt(sleeve, p, st, corner.x, corner.y), 'scale', 'on the dot');
  assert.equal(out(20), 'scale', 'near enough to the dot');
  assert.equal(out(45), 'rotate', 'just outside it');
  assert.equal(out(200), null, 'well clear of it');
  assert.equal(handleAt(sleeve, p, st, b.cx, b.cy), null, 'the middle is a plain drag');

  // Inside the box but level with a corner is still a drag, never a turn.
  assert.equal(handleAt(sleeve, p, st, b.cx, b.cy + b.h / 2 - 5), null, 'inside the edge');

  // A turned layer carries its corners round with it. The sleeve is square,
  // so a quarter turn puts a corner back where a corner was; the progress
  // bar is long and thin, which is what shows the difference.
  const wide = createProject({ template: 'player' });
  const bar = wide.layers.find(l => l.type === 'progressBar');
  const flat = layerBounds(bar, wide, st);
  const wasCorner = { x: flat.cx + flat.w / 2, y: flat.cy + flat.h / 2 };
  assert.equal(handleAt(bar, wide, st, wasCorner.x, wasCorner.y), 'scale', 'corner, flat');

  bar.props.rotation = 90;
  const turned = layerBounds(bar, wide, st);
  const nowCorner = { x: turned.cx - turned.h / 2, y: turned.cy + turned.w / 2 };
  assert.equal(handleAt(bar, wide, st, nowCorner.x, nowCorner.y), 'scale', 'corner, turned');
  assert.equal(handleAt(bar, wide, st, wasCorner.x, wasCorner.y), null, 'where it used to be');

  // A locked layer has no handles, because it cannot be moved at all.
  sleeve.locked = true;
  assert.equal(handleAt(sleeve, p, st, corner.x, corner.y), null, 'locked');
  sleeve.locked = false;
  assert.equal(handleAt(null, p, st, corner.x, corner.y), null, 'nothing selected');
}

// Grouping off leaves one layer on its own.
project.grouped = false;
assert.equal(movesWith(project, cover).length, 1);


// --- fitting a template to a landscape slide --------------------------------
for (const template of ['vinyl', 'player']) {
  const wide = fitToSlide(createProject({ aspect: { id: 'photo', w: 1080, h: 600 }, template }));
  const slide = { width: 1080, height: 600 };
  for (const layer of wide.layers.filter(l => l.type !== 'photo')) {
    const b = layerBounds(layer, wide, slide);
    assert.ok(b.cy - b.h / 2 >= 0 && b.cy + b.h / 2 <= 600, `${template} ${layer.name} spills`);
    assert.ok(b.cx - b.w / 2 >= 0 && b.cx + b.w / 2 <= 1080, `${template} ${layer.name} spills sideways`);
  }
  // The words stay clear of the sleeve, the way the template drew them.
  const sleeve = layerBounds(wide.layers.find(l => l.type === 'cover'), wide, slide);
  const title = layerBounds(wide.layers.find(l => l.name === 'Title'), wide, slide);
  assert.ok(title.cy > sleeve.cy + sleeve.h / 2, `${template} title sits on the sleeve`);
  // An upright slide already fits, so it is left exactly as the template made it.
  const tall = createProject({ template });
  assert.deepEqual(fitToSlide(structuredClone(tall)).layers, tall.layers);
}

console.log('gestures: ok');
