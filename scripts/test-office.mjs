import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPeople } from '../src/office/people.js';
import { OFFICE_LAYOUT, wallSpans } from '../src/office/layout.js';

const { coding, meeting, wallThickness } = OFFICE_LAYOUT;
// Include the projecting frame and skirting, not only the plaster core.
const wallDepth = wallThickness + .024;
const walls = [];
const horizontal = (from, to, z, doors = []) => {
  for (const [a, b] of wallSpans(from, to, doors)) walls.push({ minX: a, maxX: b, minZ: z - wallDepth / 2, maxZ: z + wallDepth / 2 });
};
const vertical = (from, to, x, doors = []) => {
  for (const [a, b] of wallSpans(from, to, doors)) walls.push({ minX: x - wallDepth / 2, maxX: x + wallDepth / 2, minZ: a, maxZ: b });
};
horizontal(coding.west, coding.east, coding.north, coding.northDoors);
horizontal(coding.west, coding.east, coding.south, [{ center: -12.8, width: 1.8 }]);
horizontal(meeting.west, meeting.east, meeting.north, meeting.northDoors);
horizontal(meeting.west, meeting.east, meeting.south);
vertical(meeting.north, meeting.south, meeting.west, [meeting.westDoor]);
vertical(meeting.north, meeting.south, meeting.east);

function distanceToRect(x, z, rect) {
  return Math.hypot(Math.max(rect.minX - x, 0, x - rect.maxX), Math.max(rect.minZ - z, 0, z - rect.maxZ));
}

function fixture(dt) {
  const motion = { matches: false };
  globalThis.window = { matchMedia: () => motion };
  const scene = new THREE.Scene();
  const people = createPeople(scene);
  let elapsed = 0;
  let minBoard = Infinity, minWall = Infinity, minSeparation = Infinity;
  function step(seconds) {
    for (let i = 0; i < Math.ceil(seconds / dt); i++) {
      elapsed += dt;
      people.update(dt, elapsed);
      for (const person of people.agents) {
        const { x, z } = person.group.position;
        assert(Number.isFinite(x) && Number.isFinite(z), 'A teammate has an invalid position');
        const boardDistance = distanceToRect(x, z, meeting.board);
        const wallDistance = Math.min(...walls.map(wall => distanceToRect(x, z, wall)));
        minBoard = Math.min(minBoard, boardDistance);
        minWall = Math.min(minWall, wallDistance);
        assert(boardDistance >= .38, `${person.id} crossed the board at ${x},${z}`);
        assert(wallDistance >= .38, `${person.id} crossed a wall at ${x},${z}`);
      }
      for (let a = 0; a < people.agents.length; a++) {
        for (let b = a + 1; b < people.agents.length; b++) {
          const first = people.agents[a], second = people.agents[b];
          const distance = first.group.position.distanceTo(second.group.position);
          minSeparation = Math.min(minSeparation, distance);
          assert(distance >= .6, `${first.id} collided with ${second.id}`);
        }
      }
    }
  }
  return { people, motion, step,
    stats: () => ({ minBoard, minWall, minSeparation }),
    dispose: () => { people.dispose(); delete globalThis.window; },
  };
}

for (const dt of [1 / 30, 1 / 60, .05]) {
  const f = fixture(dt);
  try {
    for (const idle of [8, 35, 80]) {
      f.step(idle);
      assert(f.people.callMeeting(), 'Meeting should start');
      f.step(35);
      assert(f.people.getState().agents.every(a => a.state === 'meeting' && a.laptopState === 'open'), 'Everyone should arrive and open their laptop');
      assert(f.people.endMeeting(), 'Meeting should end');
      f.step(35);
      assert(f.people.getState().agents.every(a => a.state !== 'walking' && a.laptopState === 'hidden'), 'Everyone should return and put away their laptop');
    }
    console.log(`PASS three complete meetings at dt=${dt.toFixed(4)}: ${JSON.stringify(f.stats())}`);
  } finally { f.dispose(); }
}

const reduced = fixture(1 / 60);
try {
  reduced.motion.matches = true;
  reduced.people.callMeeting(); reduced.step(.1);
  assert(reduced.people.getState().agents.every(a => a.state === 'meeting' && a.laptopState === 'open'));
  reduced.people.endMeeting(); reduced.step(.1);
  assert(reduced.people.getState().agents.every(a => a.state !== 'walking' && a.laptopState === 'hidden'));
  console.log('PASS reduced-motion meeting and return');
} finally { reduced.dispose(); }
