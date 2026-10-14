/** Run with: node js/gestures.test.mjs */
import assert from 'node:assert/strict';
import { pullTo, pullAngle, placeMembers, handleAt, layerBounds, selectionBounds, fitToSlide, setCard } from './gestures.js';
import { createProject, movesWith, valueAt, isKeyed } from './model.js';

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
  // One layer on its own; the group's box is checked below.
  const p = createProject({ template: 'vinyl' });
  p.grouped = false;
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
  wide.grouped = false;
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

// Moving together, whichever piece is selected, the box is the whole group's.
{
  const p = createProject({ template: 'window' });
  const st = { width: 1080, height: 1350 };
  const pane = p.layers.find(l => l.type === 'window');
  const title = p.layers.find(l => l.type === 'text');
  const group = selectionBounds(pane, p, st);
  assert.deepEqual(selectionBounds(title, p, st), group, 'same box from any member');
  const own = layerBounds(pane, p, st);
  assert.ok(group.h > own.h, 'bigger than the window alone');
  const corner = { x: group.cx + group.w / 2, y: group.cy + group.h / 2 };
  assert.equal(handleAt(title, p, st, corner.x, corner.y), 'scale', 'group corner');
  p.grouped = false;
  assert.deepEqual(selectionBounds(pane, p, st), own, 'on its own, its own box');
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


// --- keyframes and groups ---------------------------------------------------
{
  // One member keyed, the rest plain: a drag at t=4 must move the group only
  // at t=4, not drag the plain ones along at every moment.
  const p = createProject({});
  const [sleeve, ...rest] = movesWith(p, p.layers.find(l => l.type === 'cover'));
  sleeve.props.x = { keyframes: [{ t: 0, value: 0.36 }] };
  const stage = { width: 1080, height: 1350 };
  const group = [sleeve, ...rest];
  const start = {
    t: 4, pivotX: 0.5, pivotY: 0.5,
    members: group.map(layer => ({
      layer, x: valueAt(layer.props.x, 4), y: valueAt(layer.props.y, 4),
      scale: valueAt(layer.props.scale, 4), rotation: valueAt(layer.props.rotation, 4),
    })),
  };
  const before = rest.map(layer => valueAt(layer.props.x, 0));
  placeMembers(start, stage, 1, 0, 0.1, 0);
  rest.forEach((layer, i) => {
    assert.ok(isKeyed(layer.props.x), `${layer.name} was given keyframes`);
    near(valueAt(layer.props.x, 0), before[i]);          // unmoved at the start
    near(valueAt(layer.props.x, 4), before[i] + 0.1);    // moved where it was dragged
  });
}
{
  // A keyed style fitted onto a wide slide keeps its keyframes.
  const p = createProject({ aspect: { id: 'x', w: 1080, h: 600 } });
  const cover = p.layers.find(l => l.type === 'cover');
  cover.props.y = { keyframes: [{ t: 0, value: 0.5 }, { t: 2, value: 0.7 }] };
  fitToSlide(p, { w: 1080, h: 1350 });
  assert.ok(isKeyed(cover.props.y) && cover.props.y.keyframes.length === 2, 'keyframes survive a fit');
}
{
  // A card added to an animated group is keyed to travel with it.
  const p = createProject({});
  for (const layer of movesWith(p, p.layers.find(l => l.type === 'cover'))) {
    const y = layer.props.y;
    layer.props.y = { keyframes: [{ t: 0, value: y }, { t: 4, value: y - 0.2 }] };
  }
  setCard(p, true);
  const card = p.layers.find(l => l.type === 'card');
  assert.ok(isKeyed(card.props.y), 'the card is keyed');
  near(valueAt(card.props.y, 0) - valueAt(card.props.y, 4), 0.2, 1e-6);
}

console.log('gestures: ok');
