import * as THREE from 'three';
import { AVATAR_AGENTS as AGENTS } from './config.js';
import { OFFICE_LAYOUT } from './layout.js';

/** Miniature people and local choreography. These states are a visual prototype. */
export function createPeople(scene, { onStateChange = () => {} } = {}) {
  const pickables = [];
  const materials = new Map();
  const geometry = new Set();
  const motionPreference = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let meeting = false;
  let disposed = false;
  const carryPosition = new THREE.Vector3(-.315, 1.08, .065);
  const tablePosition = new THREE.Vector3(0, 1.24, .94);
  const carryRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2 - .09));
  const tableRotation = new THREE.Quaternion();
  const smooth = (t) => { const n = THREE.MathUtils.clamp(t, 0, 1); return n * n * (3 - 2 * n); };
  const mat = (color, roughness = .87) => {
    const key = `${color}:${roughness}`;
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness }));
    return materials.get(key);
  };
  const mesh = (parent, geo, color, position, scale, rotation) => {
    geometry.add(geo);
    const object = new THREE.Mesh(geo, mat(color));
    if (position) object.position.set(...position);
    if (scale) object.scale.set(...scale);
    if (rotation) object.rotation.set(...rotation);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  };
  const sphere = (parent, color, pos, scale) => mesh(parent, new THREE.SphereGeometry(1, 12, 10), color, pos, scale);
  const box = (parent, color, pos, size, rot) => mesh(parent, new THREE.BoxGeometry(...size), color, pos, null, rot);
  const limb = (parent, color, length, radiusTop, radiusBottom = radiusTop) => mesh(parent, new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 9), color, [0, -length / 2, 0]);
  const part = (parent, position) => { const g = new THREE.Group(); g.position.set(...position); parent.add(g); return g; };

  function makePerson(config, index) {
    const group = new THREE.Group();
    group.name = `Agent: ${config.name}`;
    group.position.set(config.position[0], 0, config.position[1]);
    group.rotation.y = config.rotation;
    scene.add(group);
    const body = part(group, [0, .79, 0]);
    const darkPants = ['#3d4142', '#344453', '#4d4740', '#49413e', '#41424f', '#4f5350'][index];
    const shoes = '#34302d';
    const shirt = config.color;
    const skin = config.skin;
    const hair = config.hair;

    // A shaped shoulder line, waist, separate hips and visible clothing details.
    const torsoShape = new THREE.Shape();
    torsoShape.moveTo(-.16, .02);
    torsoShape.lineTo(.16, .02);
    torsoShape.lineTo(.225, .38);
    torsoShape.quadraticCurveTo(.225, .44, .14, .47);
    torsoShape.lineTo(-.14, .47);
    torsoShape.quadraticCurveTo(-.225, .44, -.225, .38);
    torsoShape.closePath();
    mesh(body, new THREE.ExtrudeGeometry(torsoShape, { depth: .23, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: .018, bevelThickness: .018 }), shirt, [0, 0, -.115]);
    sphere(body, darkPants, [0, .015, -.004], [.187, .135, .128]);
    box(body, '#62534b', [0, .062, .128], [.325, .033, .013]);
    box(body, '#aa9b83', [0, .063, .14], [.038, .03, .008]);
    mesh(body, new THREE.CylinderGeometry(.064, .072, .105, 10), skin, [0, .50, 0]);
    box(body, '#e9e3d8', [-.064, .463, .115], [.09, .06, .026], [0, 0, -.3]);
    box(body, '#e9e3d8', [.064, .463, .115], [.09, .06, .026], [0, 0, .3]);
    if (index === 0) {
      box(body, '#443f38', [0, .29, .143], [.04, .28, .018], [0, 0, -.025]);
      sphere(body, '#49423d', [0, .449, .139], [.031, .026, .016]);
      box(body, '#e9e3d8', [-.122, .34, .144], [.061, .025, .006]);
    } else if (index === 1) {
      box(body, '#d5d4c9', [0, .27, .137], [.052, .32, .009]);
      box(body, '#57758b', [-.125, .30, .144], [.09, .105, .014]);
    } else if (index === 3) {
      mesh(body, new THREE.TorusGeometry(.071, .009, 5, 16, Math.PI), '#d9b77b', [0, .391, .147], null, [0, 0, Math.PI]);
      sphere(body, '#dbbd82', [0, .315, .151], [.015, .022, .009]);
    }
    if (index !== 0) {
      for (let y = .16; y < .41; y += .085) sphere(body, '#d7ccbb', [.011, y, .145], [.009, .009, .006]);
    }

    const head = part(body, [0, .665, 0]);
    sphere(head, skin, [0, 0, 0], [.151, .179, .146]);
    sphere(head, skin, [-.148, -.01, 0], [.032, .047, .030]);
    sphere(head, skin, [.148, -.01, 0], [.032, .047, .030]);
    sphere(head, skin, [0, -.016, .144], [.027, .042, .033]);
    for (const x of [-.057, .057]) {
      sphere(head, '#e7dfd1', [x, .027, .129], [.025, .018, .014]);
      sphere(head, '#302b29', [x, .027, .14], [.012, .013, .008]);
      box(head, hair, [x, .065, .13], [.044, .012, .008], [0, 0, x < 0 ? -.1 : .1]);
    }
    box(head, '#925e4c', [0, -.079, .129], [.049, .010, .008]);
    mesh(head, new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI * .535), hair, [0, .02, -.006], [.161, .183, .155]);
    sphere(head, hair, [-.14, .031, -.045], [.028, .10, .102]);
    sphere(head, hair, [.14, .031, -.045], [.028, .10, .102]);
    if (index === 3) {
      // Back of a bob, with the face and front neck left clear.
      sphere(head, hair, [0, -.037, -.088], [.169, .211, .097]);
      sphere(head, hair, [-.143, -.09, -.007], [.048, .159, .073]);
      sphere(head, hair, [.143, -.08, -.007], [.046, .155, .073]);
      sphere(head, hair, [-.076, .143, .085], [.105, .061, .079]);
      for (const x of [-.175, .175]) sphere(head, '#d2b477', [x, -.059, .01], [.014, .019, .014]);
    } else if (index === 5) {
      for (let i = 0; i < 9; i++) {
        const angle = i / 9 * Math.PI * 2;
        sphere(head, hair, [Math.cos(angle) * .104, .142 + (i % 2) * .016, Math.sin(angle) * .09], [.070, .067, .062]);
      }
    } else {
      sphere(head, hair, [index % 2 ? -.052 : .053, .162, .028], [.13, .069, .116]);
      sphere(head, hair, [-.085, .114, .101], [.072, .052, .059]);
    }
    if (index === 4) {
      for (const x of [-.061, .061]) mesh(head, new THREE.TorusGeometry(.036, .006, 5, 12), '#554e45', [x, .03, .148]);
      box(head, '#554e45', [0, .032, .15], [.05, .006, .006]);
      box(head, '#554e45', [-.107, .033, .066], [.007, .007, .148]);
      box(head, '#554e45', [.107, .033, .066], [.007, .007, .148]);
    }
    if (index === 0) {
      // Small beard along jaw, rather than a second oversized head shape.
      sphere(head, '#655042', [0, -.13, .047], [.12, .045, .079]);
    }

    const arms = [-1, 1].map((side) => {
      const upper = part(body, [side * .228, .413, 0]);
      sphere(upper, shirt, [0, -.035, 0], [.078, .09, .085]);
      limb(upper, shirt, .277, .072, .057);
      const lower = part(upper, [0, -.277, 0]);
      sphere(lower, shirt, [0, 0, 0], [.06, .059, .062]);
      limb(lower, index === 3 || index === 5 ? skin : shirt, .246, .054, .041);
      mesh(lower, new THREE.CylinderGeometry(.044, .044, .035, 8), '#e7dfd1', [0, -.238, 0]);
      sphere(lower, skin, [0, -.292, .002], [.043, .066, .033]);
      sphere(lower, skin, [-side * .035, -.28, .014], [.023, .035, .023]);
      if (side === -1) {
        mesh(lower, new THREE.CylinderGeometry(.047, .047, .027, 8), '#514b42', [0, -.213, 0]);
        box(lower, '#b8b8ad', [0, -.213, .047], [.039, .034, .012]);
      }
      return { upper, lower, side };
    });
    const legs = [-1, 1].map((side) => {
      const upper = part(body, [side * .10, 0, 0]);
      limb(upper, darkPants, .43, .089, .071);
      const lower = part(upper, [0, -.43, 0]);
      sphere(lower, darkPants, [0, 0, 0], [.072, .071, .075]);
      limb(lower, darkPants, .43, .07, .051);
      mesh(lower, new THREE.CylinderGeometry(.052, .052, .055, 8), '#cbc8ba', [0, -.416, 0]);
      sphere(lower, shoes, [0, -.442, .055], [.073, .060, .133]);
      box(lower, '#56524d', [0, -.476, .064], [.139, .027, .231]);
      return { upper, lower, side };
    });
    // A hinged prop follows the person while carried and rests on the meeting table.
    const laptop = part(group, [0, 0, 0]);
    laptop.name = `${config.name}'s laptop`;
    laptop.visible = false;
    const metal = ['#afb6ac', '#9aa9b3', '#b6aaa0', '#b99d92', '#9fa3b8', '#afa588'][index];
    box(laptop, metal, [0, 0, 0], [.69, .035, .46]);
    box(laptop, '#737977', [0, .023, -.13], [.17, .004, .07]);
    for (let row = 0; row < 3; row++) {
      for (let key = 0; key < 9; key++) box(laptop, '#404b50', [(key - 4) * .065, .022, -.045 + row * .066], [.051, .006, .047]);
    }
    const hinge = part(laptop, [0, .024, .225]);
    box(hinge, metal, [0, .014, -.225], [.69, .026, .46]);
    box(hinge, '#293940', [0, -.003, -.225], [.625, .006, .393]);
    box(hinge, '#a9c6bc', [-.10, -.008, -.29], [.34, .003, .017]);
    box(hinge, '#8aa9c0', [-.063, -.008, -.237], [.41, .003, .015]);
    box(hinge, '#c4b69a', [-.126, -.008, -.186], [.28, .003, .015]);
    box(hinge, shirt, [.18, .032, -.225], [.075, .006, .075], [0, Math.PI / 4, 0]);
    group.traverse((object) => {
      if (object.isMesh) { object.userData.agentId = config.id; pickables.push(object); }
    });
    const person = { id: config.id, group, body, head, arms, legs, config, index, laptop, hinge, laptopState: 'hidden', laptopTime: 0, packing: false, state: config.room === 'chill' ? 'idle' : 'working', room: config.room, seated: 1, path: [], destination: null, delay: 0, progress: 0 };
    pose(person, 0, 0);
    return person;
  }

  function pose(person, dt, elapsed) {
    const walking = person.state === 'walking' && person.delay <= 0;
    const reduced = motionPreference?.matches;
    const targetSeat = person.state === 'walking' && !(person.packing && person.laptopTime < 1.25) ? 0 : 1;
    person.seated = THREE.MathUtils.damp(person.seated, targetSeat, 13, dt);
    const sit = person.seated;
    const phase = person.progress * 4.3;
    const walk = walking && !reduced ? Math.sin(phase) : 0;
    const idle = reduced ? 0 : Math.sin(elapsed * 1.35 + person.index * 1.4);
    person.body.position.y = THREE.MathUtils.lerp(.94, .79, sit) + (walking ? Math.abs(walk) * .022 : idle * .004);
    person.body.rotation.z = walking ? walk * .022 : 0;
    const atTable = person.state === 'meeting' || (person.packing && person.laptopTime < 1.25);
    person.body.position.z = atTable ? .10 * smooth(person.laptopTime / .8) : 0;
    person.head.rotation.y = walking || reduced ? 0 : Math.sin(elapsed * .49 + person.index * 2.1) * .065;
    person.head.rotation.x = walking ? -.025 : .045 + idle * .018;
    for (const arm of person.arms) {
      const swing = walk * .41 * arm.side;
      const typing = !reduced && person.state === 'working' ? Math.sin(elapsed * 4.7 + arm.side * 1.7 + person.index) * .018 : 0;
      arm.upper.rotation.x = THREE.MathUtils.lerp(swing, -.98 + typing, sit);
      arm.upper.rotation.z = -arm.side * THREE.MathUtils.lerp(.06, .12, sit);
      arm.lower.rotation.x = THREE.MathUtils.lerp(-.18, -.60 + typing, sit);
      if (person.state === 'idle') {
        arm.upper.rotation.x += .29 * sit;
        arm.lower.rotation.x -= .12 * sit;
      }
      if (person.state === 'meeting' && !reduced) {
        const gesture = Math.max(0, Math.sin(elapsed * .72 + person.index * 1.4));
        arm.lower.rotation.x -= gesture * .08;
      }
      if (person.laptop.visible && arm.side === -1) {
        const carrying = person.laptopState === 'carried' ? 1 : person.laptopState === 'placing' ? 1 - smooth(person.laptopTime / .72) : person.laptopState === 'picking-up' ? smooth((person.laptopTime - .6) / .65) : 0;
        arm.upper.rotation.x = THREE.MathUtils.lerp(arm.upper.rotation.x, -.38, carrying);
        arm.upper.rotation.z = THREE.MathUtils.lerp(arm.upper.rotation.z, .10, carrying);
        arm.lower.rotation.x = THREE.MathUtils.lerp(arm.lower.rotation.x, -1.04, carrying);
      }
    }
    for (const leg of person.legs) {
      leg.upper.rotation.x = THREE.MathUtils.lerp(-walk * .43 * leg.side, -1.12, sit);
      leg.lower.rotation.x = THREE.MathUtils.lerp(Math.max(0, walk * leg.side) * .43, 1.12, sit);
    }
  }

  const agents = AGENTS.map(makePerson);
  const emit = () => { if (!disposed) onStateChange(getState()); };
  function getState() {
    return { meeting, moving: agents.some((person) => person.state === 'walking'), agents: agents.map(({ id, state, room, laptopState }) => ({ id, state, room, laptopState })) };
  }
  function stationExit(config) {
    const [x, z] = config.position;
    if (config.room === 'coding') {
      const aisleX = OFFICE_LAYOUT.coding.northDoors[config.id === 'sam' ? 1 : 2].center;
      return [[aisleX, z], [aisleX, -2.5]];
    }
    if (config.room === 'chill') {
      const aisleX = OFFICE_LAYOUT.coding.northDoors[0].center;
      return [[aisleX, z], [aisleX, -2.5]];
    }
    const doorX = { head: -6.3, design: 2.9, review: 12.2 }[config.room] ?? x;
    return [[doorX, z], [doorX, -2.5]];
  }
  function meetingApproach(config, hallwayZ = -2.5) {
    const { entryX, insideZ, aisleX } = OFFICE_LAYOUT.meeting;
    const [seatX, seatZ] = config.seat;
    const side = seatX < 8.5 ? 'left' : 'right';
    // Cross the north wall through its doorway before turning toward a seat.
    // Keeping this corner explicit also prevents diagonal cuts into the board.
    return [[entryX[side], hallwayZ], [entryX[side], insideZ], [aisleX[side], insideZ], [aisleX[side], seatZ], [seatX, seatZ]];
  }
  function outbound(config) {
    return [...stationExit(config), ...meetingApproach(config)];
  }
  function begin(toMeeting) {
    if (agents.some((person) => person.state === 'walking') || meeting === toMeeting) return false;
    meeting = toMeeting;
    for (const person of agents) {
      const { config } = person;
      const route = toMeeting ? outbound(config) : [...outbound(config).slice(0, -1).reverse(), [...config.position]];
      person.path = route.map(([x, z]) => new THREE.Vector3(x, 0, z));
      person.destination = toMeeting ? 'meeting' : config.room;
      person.delay = motionPreference?.matches ? 0 : person.index * .32 + (toMeeting ? .2 : 1.5);
      person.state = 'walking';
      person.laptop.visible = true;
      person.laptopTime = 0;
      person.packing = !toMeeting;
      person.packingPosition = person.laptop.position.clone();
      person.packingRotation = person.laptop.quaternion.clone();
      person.packingAngle = person.hinge.rotation.x;
      person.laptopState = toMeeting ? 'carried' : 'closing';
      if (toMeeting) {
        person.laptop.position.copy(carryPosition);
        person.laptop.quaternion.copy(carryRotation);
        person.hinge.rotation.x = 0;
      }
      if (motionPreference?.matches) arrive(person);
    }
    emit();
    return true;
  }
  function arrive(person) {
    const atMeeting = person.destination === 'meeting';
    const pos = atMeeting ? person.config.seat : person.config.position;
    person.group.position.set(pos[0], 0, pos[1]);
    person.group.rotation.y = atMeeting ? person.config.meetingRotation : person.config.rotation;
    person.state = atMeeting ? 'meeting' : person.config.room === 'chill' ? 'idle' : 'working';
    person.room = atMeeting ? 'meeting' : person.config.room;
    person.path = [];
    person.destination = null;
    person.packing = false;
    person.laptopTime = 0;
    person.laptopState = atMeeting ? 'placing' : 'hidden';
    person.laptop.visible = atMeeting;
    if (motionPreference?.matches) {
      person.seated = 1;
      person.laptopState = atMeeting ? 'open' : 'hidden';
      person.laptop.position.copy(tablePosition);
      person.laptop.quaternion.copy(tableRotation);
      person.hinge.rotation.x = atMeeting ? 1.94 : 0;
    }
  }
  function updateLaptop(person, step) {
    const previous = person.laptopState;
    if (!person.laptop.visible || motionPreference?.matches) return false;
    person.laptopTime += step;
    if (person.packing) {
      if (person.laptopTime < .6) {
        person.laptopState = 'closing';
        person.hinge.rotation.x = person.packingAngle * (1 - smooth(person.laptopTime / .6));
      } else if (person.laptopTime < 1.25) {
        person.laptopState = 'picking-up';
        const t = smooth((person.laptopTime - .6) / .65);
        person.laptop.position.lerpVectors(person.packingPosition, carryPosition, t);
        person.laptop.position.y += Math.sin(t * Math.PI) * .13;
        person.laptop.quaternion.slerpQuaternions(person.packingRotation, carryRotation, t);
        person.hinge.rotation.x = 0;
      } else {
        person.laptopState = 'carried';
        person.laptop.position.copy(carryPosition);
        person.laptop.quaternion.copy(carryRotation);
        person.hinge.rotation.x = 0;
      }
    } else if (person.state === 'meeting') {
      if (person.laptopTime < .72) {
        person.laptopState = 'placing';
        const t = smooth(person.laptopTime / .72);
        person.laptop.position.lerpVectors(carryPosition, tablePosition, t);
        person.laptop.position.y += Math.sin(t * Math.PI) * .17;
        person.laptop.quaternion.slerpQuaternions(carryRotation, tableRotation, t);
        person.hinge.rotation.x = 0;
      } else {
        person.laptopState = person.laptopTime < 1.6 ? 'opening' : 'open';
        person.laptop.position.copy(tablePosition);
        person.laptop.quaternion.copy(tableRotation);
        person.hinge.rotation.x = 1.94 * smooth((person.laptopTime - .72) / .88);
      }
    } else {
      person.laptop.position.copy(carryPosition);
      person.laptop.quaternion.copy(carryRotation);
      person.hinge.rotation.x = 0;
    }
    return previous !== person.laptopState;
  }
  function update(dt, elapsed) {
    if (disposed) return;
    const step = Math.min(.06, Math.max(0, dt));
    let changed = false;
    for (const person of agents) {
      if (person.state === 'walking') {
        person.delay -= step;
        if (motionPreference?.matches) { arrive(person); changed = true; }
        else if (person.delay <= 0) {
          const point = person.path[0];
          if (!point) { arrive(person); changed = true; }
          else {
            const distance = person.group.position.distanceTo(point);
            const speed = 2.55 + person.index * .04;
            let movement = Math.min(speed * step, distance);
            const nextPosition = person.group.position.clone().lerp(point, distance > 0 ? movement / distance : 0);
            // Yield before the corridor funnels into the meeting-room doorway.
            for (const other of agents) {
              if (other === person || other.state !== 'walking') continue;
              const currentDistance = person.group.position.distanceTo(other.group.position);
              const nextDistance = nextPosition.distanceTo(other.group.position);
              if (nextDistance < .65 && nextDistance < currentDistance - .00001) { movement = 0; break; }
            }
            if (distance <= movement) {
              person.group.position.copy(point);
              person.path.shift();
              person.progress += distance;
              if (!person.path.length) { arrive(person); changed = true; }
            } else {
              const dx = point.x - person.group.position.x;
              const dz = point.z - person.group.position.z;
              person.group.position.x += dx / distance * movement;
              person.group.position.z += dz / distance * movement;
              const target = Math.atan2(dx, dz);
              const difference = Math.atan2(Math.sin(target - person.group.rotation.y), Math.cos(target - person.group.rotation.y));
              person.group.rotation.y += difference * Math.min(1, step * 12);
              person.progress += movement;
            }
          }
        }
      }
      if (updateLaptop(person, step)) changed = true;
      pose(person, step, elapsed);
    }
    if (changed) emit();
  }
  function dispose() {
    disposed = true;
    for (const person of agents) scene.remove(person.group);
    for (const item of geometry) item.dispose();
    for (const item of materials.values()) item.dispose();
    pickables.length = 0;
  }
  return { agents, pickables, update, callMeeting: () => begin(true), endMeeting: () => begin(false), getState, dispose };
}
