import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OFFICE_LAYOUT, wallSpans } from './layout.js';

// A little architectural model. Everything is generated locally, including the
// screen graphics, upholstery, floor grain, and printed material.
export function createEnvironment(scene) {
  const group = new THREE.Group();
  group.name = 'The office';
  scene.add(group);
  const materials = new Map();
  const geometries = new Map();
  const textureCache = new Map();
  const material = (color, options = {}) => {
    const key = color + JSON.stringify(options);
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: .8, ...options }));
    return materials.get(key);
  };
  const palette = {
    plaster: material('#eee9db'), wallEdge: material('#fffaf0'), base: material('#57584f'),
    oak: material('#b78b5d'), paleOak: material('#c5a178'), walnut: material('#75533c'),
    dark: material('#303b39'), black: material('#252c2c'), metal: material('#777d76', { metalness: .55, roughness: .43 }),
    cream: material('#e0d9ca'), fabric: material('#747e72'), blush: material('#b99179'),
    sage: material('#829387'), blue: material('#788a91'), lavender: material('#a09aab'),
    ceramic: material('#ded5c2'), white: material('#f5f1e7'), brass: material('#a98b53', { metalness: .65, roughness: .4 }),
    leaf: material('#4c6851'), leafLight: material('#73836a'), soil: material('#463d30'),
    glass: material('#bfdbd3', { transparent: true, opacity: .15, roughness: .1, metalness: .12, depthWrite: false }),
  };
  let seed = 9182;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const geo = (key, create) => { if (!geometries.has(key)) geometries.set(key, create()); return geometries.get(key); };
  function mesh(geometry, mat, x, y, z, parent = group) {
    const item = new THREE.Mesh(geometry, mat);
    item.position.set(x, y, z); item.castShadow = true; item.receiveShadow = true;
    parent.add(item); return item;
  }
  function box(w, h, d, mat, x, y, z, parent = group) {
    return mesh(geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)), mat, x, y, z, parent);
  }
  function cylinder(rt, rb, h, mat, x, y, z, parent = group, sides = 16) {
    return mesh(geo(`c${rt},${rb},${h},${sides}`, () => new THREE.CylinderGeometry(rt, rb, h, sides)), mat, x, y, z, parent);
  }
  function rounded(w, h, d, radius, mat, x, y, z, parent = group) {
    const geometry = geo(`r${w},${h},${d},${radius}`, () => {
      const shape = new THREE.Shape(); const a = w / 2; const b = d / 2; const r = Math.min(radius, a, b);
      shape.moveTo(-a + r, -b); shape.lineTo(a - r, -b); shape.quadraticCurveTo(a, -b, a, -b + r);
      shape.lineTo(a, b - r); shape.quadraticCurveTo(a, b, a - r, b); shape.lineTo(-a + r, b);
      shape.quadraticCurveTo(-a, b, -a, b - r); shape.lineTo(-a, -b + r); shape.quadraticCurveTo(-a, -b, -a + r, -b);
      const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 4 });
      g.rotateX(-Math.PI / 2); g.translate(0, -h / 2, 0); return g;
    });
    return mesh(geometry, mat, x, y, z, parent);
  }
  function local(x, z, angle = 0) { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = angle; group.add(g); return g; }
  function canvasTexture(key, width, height, draw) {
    if (textureCache.has(key)) return textureCache.get(key);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); draw(ctx, width, height);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4; textureCache.set(key, texture); return texture;
  }
  function print(key, w, h, draw, x, y, z, rotation = 0, parent = group, background = '#f3efe5') {
    const texture = canvasTexture(key, 1024, 512, (ctx, a, b) => { ctx.fillStyle = background; ctx.fillRect(0, 0, a, b); draw(ctx, a, b); });
    const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: .95 });
    const p = mesh(geo(`p${w},${h}`, () => new THREE.PlaneGeometry(w, h)), mat, x, y, z, parent);
    p.rotation.y = rotation; p.castShadow = false; return p;
  }
  const woodTexture = canvasTexture('wood', 512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#c6aa82'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1300; i++) {
      const x = random() * w; const y = random() * h;
      ctx.strokeStyle = `rgba(${random() > .5 ? '89,59,34' : '247,220,169'},${random() * .06 + .015})`;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x + 40, y - 2, x + 100, y + 2, x + 170, y); ctx.stroke();
    }
    for (let y = 0; y < h; y += 64) { ctx.fillStyle = 'rgba(57,42,23,.12)'; ctx.fillRect(0, y, w, 1); ctx.fillRect((y / 64 % 2) * 220 + 50, y, 1, 64); }
  });
  woodTexture.wrapS = woodTexture.wrapT = THREE.RepeatWrapping; woodTexture.repeat.set(4, 4);
  const woodFloor = new THREE.MeshStandardMaterial({ map: woodTexture, roughness: .89, color: '#faf1db' });
  const carpetTexture = canvasTexture('carpet', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#a6aa9a'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 11000; i++) { const l = Math.round(random() * 90 + 75); ctx.fillStyle = `rgba(${l},${l},${l},.16)`; ctx.fillRect(random() * w, random() * h, 1, 1); }
  });
  carpetTexture.wrapS = carpetTexture.wrapT = THREE.RepeatWrapping; carpetTexture.repeat.set(10, 10);
  const carpet = new THREE.MeshStandardMaterial({ map: carpetTexture, roughness: 1, color: '#e7e5d8' });
  const darkCarpet = new THREE.MeshStandardMaterial({ map: carpetTexture, roughness: 1, color: '#b8c2b7' });

  // Solid model base, a timber circulation strip, and subtly different floors.
  rounded(28.7, .58, 24.7, .18, palette.base, 0, -.4, 0);
  box(28.3, .14, 24.3, woodFloor, 0, -.045, 0);
  box(9.0, .035, 7.8, darkCarpet, -9.5, .05, -8);
  box(9.4, .035, 7.8, carpet, -.25, .05, -8);
  box(9.4, .035, 7.8, darkCarpet, 9.25, .05, -8);
  box(15.4, .035, 7.9, carpet, -6.25, .05, 3);
  box(10.7, .035, 12.5, carpet, 8.5, .05, 5.5);
  rounded(12.2, .025, 3.9, .18, material('#b5aca0'), -6.2, .065, 9.7);
  // Fine joints make the architectural boundaries easy to read from above.
  for (const x of [-5, 4.5]) box(.04, .04, 7.9, palette.walnut, x, .08, -8);
  box(28, .04, .05, palette.walnut, 0, .08, -4);
  box(.05, .04, 13, palette.walnut, 2.8, .08, 5.5);

  function wall(w, h, d, x, z, mat = palette.plaster) {
    box(w, h, d, mat, x, h / 2 + .07, z);
    box(w + .015, .09, d + .025, palette.wallEdge, x, h + .105, z);
    if (w > d) box(w, .12, d + .025, palette.cream, x, .17, z);
    else box(w + .025, .12, d, palette.cream, x, .17, z);
  }
  wall(28.4, 3.9, .27, 0, -12.12);
  wall(.27, 3.9, 24.3, -14.12, 0);
  wall(.24, 3.3, 8.1, -5, -8.05);
  wall(.24, 3.3, 8.1, 4.5, -8.05);
  // Keep the low outer edges outside the meeting room; that room receives
  // complete framed walls below instead of overlapping the old cutaway curbs.
  wall(.26, .6, OFFICE_LAYOUT.meeting.north + 12.15, OFFICE_LAYOUT.meeting.east, (OFFICE_LAYOUT.meeting.north - 12.15) / 2);
  wall(OFFICE_LAYOUT.meeting.west + 14.2, .34, .27, (OFFICE_LAYOUT.meeting.west - 14.2) / 2, OFFICE_LAYOUT.meeting.south);

  const architecturalWalls = [];
  const architecturalDoors = [];
  function framedPartition(id, axis, fixed, from, to, doors = [], baseMaterial = palette.plaster, baseHeight = .82) {
    const thickness = OFFICE_LAYOUT.wallThickness;
    const height = OFFICE_LAYOUT.wallHeight;
    const floor = .07;
    const top = floor + height;
    const postWidth = .075;
    const place = (length, h, depth, mat, coordinate, y) => axis === 'x'
      ? box(length, h, depth, mat, coordinate, y, fixed)
      : box(depth, h, length, mat, fixed, y, coordinate);
    for (const [a, b] of wallSpans(from, to, doors)) {
      const length = b - a;
      const center = (a + b) / 2;
      place(length, baseHeight, thickness, baseMaterial, center, floor + baseHeight / 2);
      place(length, .065, thickness + .022, palette.wallEdge, center, floor + baseHeight + .0325);
      place(length, .09, thickness + .016, palette.cream, center, floor + .055);
      const glassBottom = floor + baseHeight + .065;
      const glassTop = top - .07;
      place(length, glassTop - glassBottom, .042, palette.glass, center, (glassBottom + glassTop) / 2);
      // Mullions are inset into the solid span so the specified doorway width
      // remains genuinely clear, including the complete door jambs.
      const divisions = Math.max(1, Math.ceil(length / 2.8));
      for (let i = 0; i <= divisions; i++) {
        const coordinate = a + postWidth / 2 + (length - postWidth) * i / divisions;
        place(Math.min(postWidth, length), height, thickness + .024, palette.dark, coordinate, floor + height / 2);
      }
      place(length, .025, .058, palette.cream, center, 1.54);
      architecturalWalls.push({
        id, axis, minX: axis === 'x' ? a : fixed - (thickness + .024) / 2,
        maxX: axis === 'x' ? b : fixed + (thickness + .024) / 2,
        minZ: axis === 'x' ? fixed - (thickness + .024) / 2 : a,
        maxZ: axis === 'x' ? fixed + (thickness + .024) / 2 : b,
        minY: floor, maxY: top,
      });
    }
    // A single full-length head rail closes the upper frame across the doors.
    place(to - from, .085, thickness + .024, palette.dark, (from + to) / 2, top - .0425);
    for (const door of doors) {
      place(door.width, .016, thickness + .08, palette.brass, door.center, .087);
      architecturalDoors.push({ id, axis, fixed, center: door.center, width: door.width, min: door.center - door.width / 2, max: door.center + door.width / 2 });
    }
  }
  framedPartition('coding-north', 'x', OFFICE_LAYOUT.coding.north, OFFICE_LAYOUT.coding.west, OFFICE_LAYOUT.coding.east, OFFICE_LAYOUT.coding.northDoors);
  framedPartition('coding-meeting', 'z', OFFICE_LAYOUT.meeting.west, OFFICE_LAYOUT.meeting.north, OFFICE_LAYOUT.meeting.south, [OFFICE_LAYOUT.meeting.westDoor]);
  framedPartition('meeting-north', 'x', OFFICE_LAYOUT.meeting.north, OFFICE_LAYOUT.meeting.west, OFFICE_LAYOUT.meeting.east, OFFICE_LAYOUT.meeting.northDoors);
  framedPartition('meeting-east', 'z', OFFICE_LAYOUT.meeting.east, OFFICE_LAYOUT.meeting.north, OFFICE_LAYOUT.meeting.south);
  framedPartition('meeting-south', 'x', OFFICE_LAYOUT.meeting.south, OFFICE_LAYOUT.meeting.west, OFFICE_LAYOUT.meeting.east);
  // The colored far walls lend each room its own identity.
  box(8.9, 3.2, .035, material('#7d887a'), -9.55, 1.85, -11.964);
  box(9.2, 3.2, .035, material('#bb9b80'), -.24, 1.85, -11.964);
  box(9.25, 3.2, .035, material('#8f9ba0'), 9.26, 1.85, -11.964);
  box(.035, 2.95, 6.6, material('#8c9991'), -13.964, 1.68, 2.8);
  box(.035, 2.95, 4.35, material('#a197a7'), -13.964, 1.68, 9.7);

  function backWindow(x, width = 3.2) {
    const g = local(x, -11.87);
    box(width + .2, 2.2, .1, palette.white, 0, 2.32, 0, g);
    box(width, 2, .07, material('#b4c6c5', { roughness: .5 }), 0, 2.32, .07, g);
    for (let i = 0; i < 15; i++) {
      const b = box(width, .093, .105, palette.cream, 0, 1.43 + i * .126, .135, g); b.rotation.x = -.16;
    }
    box(width + .32, .12, .22, palette.white, 0, 3.42, .1, g);
    box(width + .3, .12, .32, palette.white, 0, 1.23, .1, g);
    for (const px of [-width / 2 + .23, width / 2 - .23]) box(.025, 1.9, .025, material('#b4b1a1'), px, 2.3, .206, g);
  }
  backWindow(-11.7, 3.0); backWindow(2.2, 2.45); backWindow(11.8, 3.15);

  function wallTitle(text, sub, x, z, width = 3.4) {
    print(`title-${text}`, width, width / 2, (ctx, w, h) => {
      ctx.fillStyle = '#eee9dd'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#4c554d'; ctx.font = '500 92px Georgia'; ctx.fillText(text, 65, 226);
      ctx.font = '500 24px sans-serif'; ctx.fillStyle = '#73776d'; ctx.fillText(sub, 72, 300);
      ctx.fillStyle = '#a28d6c'; ctx.fillRect(72, 350, 84, 5);
    }, x, 2.65, z);
  }
  wallTitle('The head', 'A LITTLE PERSPECTIVE', -7.54, -11.925, 3.2);
  wallTitle('Design', 'MAKE SOMETHING MATTER', -2.65, -11.925, 3.5);
  wallTitle('Review', 'THOUGHTFULLY CHECKED', 6.86, -11.925, 3.5);

  function glassFront(from, to, doorX) {
    const z = -4;
    for (const [a, b] of [[from, doorX - .84], [doorX + .84, to]]) {
      if (b - a < .2) continue;
      const middle = (a + b) / 2;
      box(b - a, .45, .16, palette.plaster, middle, .3, z);
      box(b - a, 2.46, .045, palette.glass, middle, 1.76, z);
      for (const x of [a, b]) box(.075, 3.13, .12, palette.dark, x, 1.63, z);
      box(b - a, .055, .1, palette.dark, middle, 1.5, z);
      box(b - a, .09, .12, palette.dark, middle, 3.18, z);
      box(b - a, .025, .01, material('#e2eee8', { transparent: true, opacity: .65 }), middle, 1.85, z + .031);
    }
    box(1.75, .09, .12, palette.dark, doorX, 3.18, z);
    // A thin brass doorway threshold, with plenty of clearance for people.
    box(1.7, .015, .2, palette.brass, doorX, .086, z);
  }
  glassFront(-14, -5, -6.3); glassFront(-5, 4.5, 2.9); glassFront(4.5, 14, 12.2);

  function plant(x, z, scale = 1, parent = group, y = 0) {
    cylinder(.31 * scale, .23 * scale, .57 * scale, palette.ceramic, x, y + .285 * scale, z, parent);
    cylinder(.285 * scale, .285 * scale, .045 * scale, palette.soil, x, y + .57 * scale, z, parent);
    cylinder(.042 * scale, .055 * scale, .75 * scale, palette.walnut, x, y + .9 * scale, z, parent, 7);
    for (let i = 0; i < 9; i++) {
      const angle = i * 2.4; const radius = (.23 + (i % 3) * .04) * scale;
      const leaf = mesh(geo('leaf', () => new THREE.SphereGeometry(1, 7, 5)), i % 3 ? palette.leaf : palette.leafLight,
        x + Math.cos(angle) * radius, y + (.87 + i * .065) * scale, z + Math.sin(angle) * radius, parent);
      leaf.scale.set(.17 * scale, .43 * scale, .09 * scale); leaf.rotation.set(Math.sin(angle) * .8, -angle, Math.cos(angle) * .8);
    }
  }
  function books(x, y, z, count, parent = group, axis = 'x') {
    const colors = ['#8e8b76', '#657e79', '#b09373', '#dbd3bd', '#737581', '#a37564'];
    let offset = 0;
    for (let i = 0; i < count; i++) {
      const bw = .12 + random() * .08; const bh = .45 + random() * .22;
      const px = axis === 'x' ? x + offset : x; const pz = axis === 'x' ? z : z + offset;
      box(axis === 'x' ? bw : .34, bh, axis === 'x' ? .34 : bw, material(colors[i % colors.length]), px, y + bh / 2, pz, parent);
      box(axis === 'x' ? bw * .75 : .006, .025, axis === 'x' ? .006 : bw * .75, palette.cream, px, y + bh * .7, pz + (axis === 'x' ? .176 : 0), parent);
      offset += bw + .015;
    }
  }
  function shelf(x, z, width = 2.5, rotation = 0) {
    const g = local(x, z, rotation);
    box(width, 2.8, .08, palette.walnut, 0, 1.4, -.3, g);
    for (const xx of [-width / 2, width / 2]) box(.12, 2.9, .66, palette.walnut, xx, 1.45, 0, g);
    for (let y = .13; y < 3; y += .86) {
      box(width, .1, .66, palette.paleOak, 0, y, 0, g);
      if (y < 2) books(-width / 2 + .21, y + .05, 0, y > 1 ? 6 : 9, g);
    }
    cylinder(.19, .14, .35, palette.cream, .48, 2.9, 0, g);
    return g;
  }
  function framedArt(x, y, z, width, height, type = 'abstract', rotation = 0) {
    const g = local(x, z, rotation);
    box(width + .15, height + .15, .08, palette.walnut, 0, y, 0, g);
    print(`art-${type}`, width, height, (ctx, w, h) => {
      if (type === 'abstract') {
        ctx.fillStyle = '#ede3ca'; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#b57d5e'; ctx.beginPath(); ctx.arc(w * .38, h * .44, h * .3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#6e8175'; ctx.fillRect(w * .5, h * .18, w * .23, h * .64);
        ctx.strokeStyle = '#454e44'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(w * .18, h * .7); ctx.bezierCurveTo(w * .3, h * .2, w * .8, h * .9, w * .82, h * .32); ctx.stroke();
      } else {
        ctx.fillStyle = '#dedbd0'; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#9ba995'; ctx.fillRect(0, h * .3, w, h * .7);
        ctx.fillStyle = '#758d7f'; ctx.beginPath(); ctx.moveTo(0, h * .8); ctx.lineTo(w * .4, h * .32); ctx.lineTo(w * .8, h); ctx.fill();
        ctx.fillStyle = '#c1ab82'; ctx.beginPath(); ctx.moveTo(w * .38, h); ctx.lineTo(w * .82, h * .45); ctx.lineTo(w, h * .68); ctx.lineTo(w, h); ctx.fill();
      }
    }, 0, y, .046, 0, g);
  }

  function screenTexture(type) {
    return canvasTexture(`screen-${type}`, 768, 460, (ctx, w, h) => {
      ctx.fillStyle = '#1f2b2d'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#344144'; ctx.fillRect(0, 0, w, 40);
      for (let i = 0; i < 3; i++) { ctx.fillStyle = ['#b47c6b', '#c8ad73', '#8aa38a'][i]; ctx.beginPath(); ctx.arc(20 + i * 20, 20, 5, 0, 7); ctx.fill(); }
      ctx.font = '16px monospace'; ctx.fillStyle = '#b0bcb9'; ctx.fillText(type === 'design' ? 'DESIGN / COMPONENTS' : type === 'review' ? 'RESERVATIONS / REVIEW' : type === 'head' ? 'TEAM / WORKSPACE' : 'RESERVATIONS / EDITOR', 210, 26);
      if (type === 'design') {
        ctx.fillStyle = '#d8d8cc'; ctx.fillRect(110, 65, 625, 370);
        ctx.fillStyle = '#fbf8ed'; ctx.fillRect(150, 93, 420, 305);
        ctx.fillStyle = '#809185'; ctx.fillRect(174, 122, 225, 20);
        ctx.fillStyle = '#cdcfc1'; ctx.fillRect(174, 158, 305, 8); ctx.fillRect(174, 180, 220, 8);
        for (let i = 0; i < 3; i++) { ctx.fillStyle = ['#c6b099', '#9aab9b', '#c1c6cb'][i]; ctx.fillRect(174 + i * 117, 215, 103, 99); }
        ctx.fillStyle = '#4e665a'; ctx.fillRect(174, 346, 115, 25);
        for (let i = 0; i < 5; i++) { ctx.fillStyle = ['#c59276', '#91a091', '#bcb4a1', '#9ba8b2', '#e7dfd1'][i]; ctx.beginPath(); ctx.arc(640, 123 + i * 58, 17, 0, 7); ctx.fill(); }
      } else if (type === 'head') {
        for (let col = 0; col < 3; col++) {
          ctx.fillStyle = '#b7c6bf'; ctx.fillText(['UP NEXT', 'IN PROGRESS', 'REVIEW'][col], 37 + col * 242, 90);
          for (let row = 0; row < 3 - (col % 2); row++) {
            ctx.fillStyle = '#38494a'; ctx.fillRect(28 + col * 242, 111 + row * 100, 214, 79);
            ctx.fillStyle = ['#b59d75', '#8da58e', '#9ca6b8'][col]; ctx.fillRect(42 + col * 242, 125 + row * 100, 57, 5);
            ctx.fillStyle = '#93a4a3'; ctx.fillRect(42 + col * 242, 146 + row * 100, 139, 5); ctx.fillRect(42 + col * 242, 163 + row * 100, 95, 4);
          }
        }
      } else {
        ctx.fillStyle = '#293637'; ctx.fillRect(0, 40, 126, h);
        ctx.font = '13px monospace'; ctx.fillStyle = '#8ba19c';
        ['EXPLORER', 'src', '  components', '  hooks', '  screens', '  services', 'tests'].forEach((t, i) => ctx.fillText(t, 13, 75 + i * 30));
        const lines = ['export function ReservationFlow() {', '  const { tables, update } = useTables();', '', '  const handleSelect = (table) => {', '    if (table.available) {', '      update({ selected: table.id });', '    }', '  };', '', '  return (', '    <ReservationView', '      tables={tables}', '      onSelect={handleSelect}', '    />', '  );', '}'];
        ctx.font = '15px monospace';
        lines.forEach((line, i) => {
          if (type === 'review' && [4, 5, 11, 12].includes(i)) { ctx.fillStyle = i === 4 ? '#55403b' : '#2e4a3e'; ctx.fillRect(135, 54 + i * 24, 610, 23); }
          ctx.fillStyle = '#5e7672'; ctx.fillText(String(i + 1).padStart(2), 144, 72 + i * 24);
          ctx.fillStyle = ['#a7baa5', '#a3c0c3', '#d1b995', '#b8a7bd'][i % 4]; ctx.fillText(line, 181, 72 + i * 24);
        });
      }
      ctx.fillStyle = '#718a7f'; ctx.fillRect(0, h - 13, w, 13);
    });
  }
  function monitor(x, z, type, parent, width = 1.62, angle = 0) {
    const m = new THREE.Group(); m.position.set(x, 1.18, z); m.rotation.y = angle; parent.add(m);
    rounded(.66, .04, .39, .07, palette.dark, 0, .015, .01, m);
    box(.095, .35, .095, palette.dark, 0, .18, -.06, m);
    rounded(width + .06, .82, .095, .035, palette.black, 0, .63, -.06, m);
    const display = new THREE.MeshBasicMaterial({ map: screenTexture(type), toneMapped: false });
    const face = mesh(geo(`display${width}`, () => new THREE.PlaneGeometry(width - .06, .71)), display, 0, .65, -.009, m); face.castShadow = false;
    cylinder(.012, .012, .008, material('#9dbda9', { emissive: '#759b81', emissiveIntensity: .7 }), width * .39, .24, -.002, m, 6).rotation.x = Math.PI / 2;
  }
  function keyboard(x, z, parent) {
    rounded(1.08, .045, .36, .045, palette.cream, x, 1.19, z, parent);
    // A single texture carries all individual keys without needless meshes.
    const keys = canvasTexture('keyboard', 256, 96, (ctx, w, h) => {
      ctx.fillStyle = '#dad9cd'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#aaa99f';
      for (let row = 0; row < 4; row++) for (let col = 0; col < 15; col++) ctx.fillRect(6 + col * 16, 6 + row * 20, 13, 16);
      ctx.fillStyle = '#c8c7bb'; ctx.fillRect(65, 68, 111, 14);
    });
    const top = mesh(geo('key-plane', () => new THREE.PlaneGeometry(1.03, .33)), new THREE.MeshStandardMaterial({ map: keys, roughness: .8 }), x, 1.216, z, parent); top.rotation.x = -Math.PI / 2; top.castShadow = false;
    rounded(.19, .075, .27, .07, palette.cream, x + .78, 1.218, z, parent);
    rounded(.42, .013, .43, .07, palette.fabric, x + .78, 1.174, z, parent);
  }
  function cup(x, z, parent, y = 1.18) {
    cylinder(.11, .087, .21, palette.white, x, y + .1, z, parent);
    cylinder(.088, .088, .012, palette.walnut, x, y + .209, z, parent);
    const handle = mesh(geo('cup-handle', () => new THREE.TorusGeometry(.075, .021, 5, 9)), palette.white, x + .105, y + .13, z, parent);
    handle.rotation.y = 0;
  }
  function desk(x, z, type = 'code', angle = 0, width = 4.5) {
    const g = local(x, z, angle);
    rounded(width, .15, 1.7, .075, palette.paleOak, 0, 1.095, 0, g);
    for (const px of [-width / 2 + .23, width / 2 - .23]) {
      box(.09, 1.02, 1.34, palette.dark, px, .555, 0, g);
      box(.45, .07, 1.45, palette.dark, px, .12, 0, g);
    }
    box(width - .4, .06, .08, palette.dark, 0, .75, -.5, g);
    if (type === 'code') {
      monitor(-.55, -.36, 'code', g, 1.52, .08); monitor(1.01, -.32, 'code', g, 1.25, -.14);
      keyboard(-.22, .45, g);
    } else { monitor(.1, -.28, type, g, 1.85); keyboard(.1, .45, g); }
    box(.7, .68, .75, palette.cream, -width / 2 + .55, .53, .1, g);
    for (let i = 0; i < 3; i++) {
      box(.65, .012, .018, material('#b8b8aa'), -width / 2 + .55, .33 + i * .19, .483, g);
      box(.2, .025, .025, palette.metal, -width / 2 + .55, .41 + i * .19, .496, g);
    }
    rounded(.57, .075, .77, .018, material(type === 'design' ? '#a7715d' : '#607469'), -width / 2 + .5, 1.21, .18, g);
    box(.013, .019, .43, palette.brass, -width / 2 + .5, 1.255, .15, g);
    cup(width / 2 - .43, .46, g);
    plant(-width / 2 + .45, -.46, .32, g, 1.17);
    return g;
  }
  function chair(x, z, angle = 0, mat = palette.fabric, meeting = false) {
    const g = local(x, z, angle);
    rounded(.83, .15, .79, .11, mat, 0, .73, 0, g);
    const back = rounded(.82, .75, .16, .07, mat, 0, 1.15, -.34, g); back.rotation.x = -.1;
    box(.15, .52, .12, palette.dark, 0, .74, -.35, g);
    for (const px of [-.47, .47]) {
      box(.05, .32, .05, palette.dark, px, .84, .06, g);
      rounded(.1, .07, .58, .04, palette.dark, px, 1.01, .04, g);
    }
    if (meeting) {
      for (const px of [-.31, .31]) for (const pz of [-.25, .25]) {
        const leg = box(.045, .64, .045, palette.dark, px, .38, pz, g); leg.rotation.z = px * -.17;
      }
    } else {
      cylinder(.07, .07, .51, palette.metal, 0, .39, 0, g);
      for (let i = 0; i < 5; i++) {
        const a = i * Math.PI * 2 / 5;
        const spoke = box(.055, .07, .53, palette.dark, Math.sin(a) * .21, .16, Math.cos(a) * .21, g); spoke.rotation.y = a;
        cylinder(.075, .075, .075, palette.black, Math.sin(a) * .45, .12, Math.cos(a) * .45, g, 8).rotation.z = Math.PI / 2;
      }
    }
  }
  function deskLamp(x, z, parent, y = 1.18) {
    cylinder(.18, .21, .055, palette.dark, x, y + .025, z, parent);
    cylinder(.025, .025, .53, palette.brass, x, y + .3, z, parent, 8);
    const shade = cylinder(.13, .25, .18, palette.dark, x, y + .61, z, parent); shade.rotation.z = -.18;
    cylinder(.18, .18, .018, material('#ffe4a2', { emissive: '#f6cf81', emissiveIntensity: .35 }), x, y + .515, z, parent);
  }

  // Three specialist rooms, each with its own tools and shelves.
  const headDesk = desk(-9.4, -6.65, 'head', Math.PI, 4.6); deskLamp(-1.67, -.55, headDesk);
  chair(-9.4, -8.1, 0, palette.fabric);
  shelf(-13.35, -8.4, 2.5, Math.PI / 2);
  plant(-6.05, -10.7, 1.25);
  framedArt(-13.92, 2.65, -5.6, 1.6, 1.2, 'landscape', Math.PI / 2);
  const designerDesk = desk(-.3, -6.65, 'design', Math.PI, 4.7); deskLamp(1.65, -.4, designerDesk);
  chair(-.3, -8.1, 0, palette.blush);
  plant(3.67, -10.74, 1.15);
  shelf(-3.65, -10.87, 1.85, 0);
  const reviewDesk = desk(9.2, -6.65, 'review', Math.PI, 4.6); deskLamp(-1.65, -.43, reviewDesk);
  chair(9.2, -8.1, 0, palette.blue);
  shelf(5.4, -9.2, 2.1, Math.PI / 2);
  plant(13.18, -10.5, 1.15);

  // A cork board of small swatches for the design studio's side wall.
  const board = local(-4.84, -7.6, Math.PI / 2);
  box(3.35, 1.9, .08, palette.walnut, 0, 2.27, 0, board);
  box(3.18, 1.73, .035, material('#c4ae8c'), 0, 2.27, .06, board);
  for (let i = 0; i < 9; i++) {
    const xx = (i % 3 - 1) * .92; const yy = 2.78 - Math.floor(i / 3) * .55;
    const swatch = box(.65, .4, .017, material(['#ede6d4', '#9cae9e', '#be9276', '#f1ede5', '#879a9e', '#d0bd97', '#ae9aaa', '#7d8b71', '#ece1ce'][i]), xx, yy, .09, board);
    swatch.rotation.z = (random() - .5) * .1;
    cylinder(.026, .026, .014, palette.brass, xx, yy + .15, .105, board, 6).rotation.x = Math.PI / 2;
  }

  // The coding floor: two occupied stations and two spare places to grow.
  desk(-10.2, 1.55, 'code'); desk(-3.8, 1.55, 'code');
  chair(-10.2, 2.9, Math.PI); chair(-3.8, 2.9, Math.PI);
  desk(-10.2, 5.35, 'code', Math.PI); desk(-3.8, 5.35, 'code', Math.PI);
  chair(-10.2, 4.02, 0, palette.blue); chair(-3.8, 4.02, 0, palette.blue);
  for (const x of [-10.2, -3.8]) {
    box(4.55, 1.3, .11, material('#a2aaa0'), x, .85, .64);
    box(4.58, .035, .13, palette.cream, x, 1.51, .64);
    box(4.55, 1.3, .11, material('#a2aaa0'), x, .85, 6.25);
    box(4.58, .035, .13, palette.cream, x, 1.51, 6.25);
    for (let i = 0; i < 3; i++) box(.18, .2, .008, material(['#d4bb77', '#d8c4a9', '#b9c4ac'][i]), x - 1.65 + i * .25, 1.32, .704);
  }
  // Low storage borders the room while the long circulation aisle stays open.
  const credenza = local(-13.68, 4.7, Math.PI / 2);
  box(3.15, .97, .64, palette.paleOak, 0, .56, 0, credenza);
  box(3.24, .08, .72, palette.oak, 0, 1.08, 0, credenza);
  for (const px of [-.98, 0, .98]) { box(.86, .82, .04, palette.cream, px, .58, .34, credenza); box(.28, .025, .04, palette.brass, px, .85, .38, credenza); }
  books(-1.18, 1.13, -.1, 7, credenza); plant(.98, .02, .42, credenza, 1.13);
  print('code-wall-title', 4.25, 2.13, (ctx, w, h) => {
    ctx.fillStyle = '#e9e7d8'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#64766a'; ctx.font = '88px Georgia'; ctx.fillText('Good work,', 70, 210); ctx.fillText('together.', 70, 312);
    ctx.font = '22px monospace'; ctx.fillStyle = '#90937d'; ctx.fillText('THE CODING ROOM  /  01', 77, 404);
  }, -13.92, 2.72, .22, Math.PI / 2);
  plant(1.6, 1.7, 1.04);
  plant(.65, 6.52, .92);

  // Shared meeting room: a long rounded oak table, six seats, and a whiteboard.
  rounded(2.65, .18, 9.1, .49, palette.paleOak, 8.5, 1.1, 5.5);
  for (const zz of [2.8, 8.2]) {
    box(1.5, 1.01, .21, palette.dark, 8.5, .55, zz);
    box(2, .065, .53, palette.dark, 8.5, .12, zz);
  }
  for (const z of [2.5, 5.5, 8.5]) {
    chair(6.5, z, Math.PI / 2, palette.fabric, true);
    chair(10.5, z, -Math.PI / 2, palette.fabric, true);
    for (const x of [7.65, 9.35]) {
      const pad = rounded(.61, .025, .78, .025, palette.white, x, 1.21, z, group);
      pad.rotation.y = x < 8.5 ? .05 : -.08;
      box(.018, .018, .54, palette.walnut, x + .22, 1.235, z);
    }
  }
  rounded(.55, .045, .63, .16, palette.dark, 8.5, 1.235, 5.5);
  cylinder(.055, .055, .045, material('#7caa99', { emissive: '#56776a', emissiveIntensity: .4 }), 8.5, 1.27, 5.5);
  cylinder(.16, .22, .54, palette.ceramic, 8.5, 1.46, 3.82);
  for (const [x, z] of [[8.3, 4.25], [8.7, 4.25]]) cup(x, z, group, 1.2);
  const whiteboard = local(8.5, -.61);
  box(6.9, 2.62, .12, palette.dark, 0, 2.09, 0, whiteboard);
  print('meeting-whiteboard', 6.64, 2.4, (ctx, w, h) => {
    ctx.fillStyle = '#f2f1e6'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#52695d'; ctx.font = '45px Georgia'; ctx.fillText('A place for good ideas.', 63, 84);
    ctx.font = '21px sans-serif'; ctx.fillStyle = '#8d9387'; ctx.fillText('MAKE SPACE. SHARE CONTEXT. FIND A WAY FORWARD.', 66, 123);
    const cards = [['THE QUESTION', 72, '#e0d2ad'], ['THE POSSIBILITIES', 383, '#ced8c6'], ['THE NEXT STEP', 694, '#d9c8bc']];
    cards.forEach(([t, x, color]) => { ctx.fillStyle = color; ctx.fillRect(x, 190, 252, 210); ctx.fillStyle = '#536357'; ctx.font = 'bold 20px sans-serif'; ctx.fillText(t, x + 18, 233); ctx.fillStyle = '#9a9e8d'; for (let i = 0; i < 3; i++) ctx.fillRect(x + 20, 280 + i * 30, 180 - i * 27, 4); });
  }, 0, 2.09, .068, 0, whiteboard);
  box(5.7, .065, .18, palette.metal, 0, .82, .12, whiteboard);
  for (let i = 0; i < 3; i++) box(.19, .04, .047, [palette.blue, palette.blush, palette.dark][i], -1.2 + i * .25, .87, .12, whiteboard);
  box(.075, .79, .075, palette.dark, -2.72, .47, 0, whiteboard); box(.075, .79, .075, palette.dark, 2.72, .47, 0, whiteboard);
  plant(4.1, 10.8, 1.3); plant(12.85, 10.8, 1.25);
  // A presentation cabinet on the far right is low enough to see over.
  box(.9, 1.12, 3.25, palette.paleOak, 13.22, .64, 6.05);
  box(.96, .07, 3.31, palette.oak, 13.22, 1.235, 6.05);
  books(13.2, 1.28, 4.75, 7, group, 'z');
  plant(13.2, 6.97, .4, group, 1.28);

  // Gaming room: a real partition makes this a separate room. A broad door
  // opening on the west side preserves the route from the shared corridor.
  framedPartition('coding-gaming', 'x', OFFICE_LAYOUT.coding.south, OFFICE_LAYOUT.coding.west, OFFICE_LAYOUT.coding.east, [OFFICE_LAYOUT.coding.northDoors[0]], material('#a29baa'), 1.03);
  box(13.35, .035, .028, material('#c2b4cf', { emissive: '#9884b9', emissiveIntensity: .35 }), -5.2, 1.115, 7.13);

  const gameArt = (title, variant = 0) => canvasTexture(`game-${title}`, 1024, 576, (ctx, w, h) => {
    ctx.fillStyle = '#192836'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#243747'; ctx.fillRect(0, h * .36, w, h * .64);
    // An original graphic: a sunset over a tiny racing circuit, built locally.
    ctx.fillStyle = variant ? '#87a6b1' : '#c79583';
    ctx.beginPath(); ctx.arc(w * .71, h * .37, 122, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 7; i++) { ctx.fillStyle = '#243747'; ctx.fillRect(w * .71 - 128, h * .4 + i * 13, 256, 3 + i); }
    ctx.fillStyle = '#344e58'; ctx.beginPath(); ctx.moveTo(0, 340); ctx.lineTo(190, 220); ctx.lineTo(325, 345); ctx.lineTo(485, 241); ctx.lineTo(630, 350); ctx.lineTo(w, 287); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
    ctx.fillStyle = '#192c36'; ctx.beginPath(); ctx.moveTo(300, h); ctx.lineTo(485, 309); ctx.lineTo(585, 309); ctx.lineTo(885, h); ctx.fill();
    ctx.strokeStyle = '#a9bea9'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(293, h); ctx.lineTo(485, 309); ctx.lineTo(585, 309); ctx.lineTo(892, h); ctx.stroke();
    ctx.fillStyle = '#d2c799';
    for (let i = 0; i < 4; i++) ctx.fillRect(541 + i * 13, 346 + i * 58, 7 + i * 4, 13 + i * 8);
    const carX = variant ? 643 : 412;
    ctx.fillStyle = '#1c2227'; ctx.fillRect(carX - 10, 455, 24, 52); ctx.fillRect(carX + 113, 455, 24, 52);
    ctx.fillStyle = variant ? '#97bba2' : '#c99c81'; ctx.fillRect(carX, 443, 127, 62); ctx.fillRect(carX + 19, 420, 88, 42);
    ctx.fillStyle = '#40596a'; ctx.fillRect(carX + 26, 426, 74, 25);
    ctx.fillStyle = '#efe4bb'; ctx.fillRect(carX + 9, 473, 22, 8); ctx.fillRect(carX + 96, 473, 22, 8);
    ctx.fillStyle = '#f0e8d8'; ctx.font = '700 57px sans-serif'; ctx.fillText(title, 53, 93);
    ctx.font = '20px monospace'; ctx.fillStyle = '#b5c9c5'; ctx.fillText('OFFICE ARCADE  /  A LITTLE PLAY GOES A LONG WAY', 56, 133);
    ctx.fillStyle = '#dbc3a6'; ctx.fillRect(57, 177, 144, 38);
    ctx.fillStyle = '#25343a'; ctx.font = 'bold 17px monospace'; ctx.fillText('PRESS START', 73, 202);
    ctx.font = '14px monospace'; ctx.fillStyle = '#c7d4c6'; ctx.fillText('01 / FREE PLAY', 810, 36);
  });
  const gameScreenMaterial = (title, variant = 0) => new THREE.MeshBasicMaterial({ map: gameArt(title, variant), toneMapped: false });
  const gamingGlow = material('#a8beb2', { emissive: '#6e9c8a', emissiveIntensity: .55 });
  // Wall-mounted television, small speakers, and a console underneath.
  rounded(4.9, 2.45, .16, .06, palette.black, -8.6, 2.0, 7.2);
  const television = mesh(geo('gaming-tv-face', () => new THREE.PlaneGeometry(4.64, 2.22)), gameScreenMaterial('AFTER HOURS'), -8.6, 2.02, 7.29);
  television.castShadow = false;
  box(4.14, .055, .07, gamingGlow, -8.6, .83, 7.22);
  rounded(4.65, .07, .51, .055, palette.oak, -8.6, .55, 7.3);
  rounded(.8, .2, .35, .035, palette.dark, -8.6, .687, 7.31);
  box(.025, .018, .025, gamingGlow, -8.31, .73, 7.494);
  for (const x of [-10.5, -6.7]) {
    rounded(.36, .6, .32, .05, palette.dark, x, .88, 7.33);
    for (const y of [.77, 1.0]) {
      const speaker = cylinder(.105, .105, .016, palette.black, x, y, 7.499, group, 16); speaker.rotation.x = Math.PI / 2;
    }
  }
  // The existing sofa and Robin's seat stay in place.
  const sofa = local(-8.6, 10.42, Math.PI);
  rounded(4.85, .42, 1.55, .16, palette.lavender, 0, .44, 0, sofa);
  rounded(4.85, .82, .31, .11, palette.lavender, 0, 1.02, -.6, sofa);
  for (const px of [-2.3, 2.3]) rounded(.34, .59, 1.5, .1, palette.lavender, px, .84, 0, sofa);
  for (const px of [-1.4, 0, 1.4]) rounded(1.33, .2, 1.13, .095, material('#b0a8b7'), px, .74, .035, sofa);
  for (const px of [-1.8, 1.8]) for (const pz of [-.45, .45]) cylinder(.06, .04, .24, palette.walnut, px, .16, pz, sofa, 8);
  const pillow1 = rounded(.57, .52, .18, .08, palette.cream, -1.62, 1.1, -.31, sofa); pillow1.rotation.z = -.14;
  const pillow2 = rounded(.56, .51, .2, .08, palette.sage, 1.6, 1.09, -.3, sofa); pillow2.rotation.z = .13;
  box(3.7, .035, .035, gamingGlow, -8.6, .3, 9.7);
  rounded(3.2, .11, 1.02, .35, palette.paleOak, -8.6, .63, 9.05);
  for (const x of [-9.7, -7.5]) for (const z of [8.73, 9.37]) cylinder(.055, .035, .53, palette.walnut, x, .35, z, group, 8);
  function controller(x, y, z, color, angle = 0) {
    const c = new THREE.Group(); c.position.set(x, y, z); c.rotation.y = angle; group.add(c);
    rounded(.48, .095, .24, .09, color, 0, 0, 0, c);
    for (const px of [-.18, .18]) {
      const grip = rounded(.15, .11, .22, .065, color, px, -.005, .075, c); grip.rotation.y = px * -1.4;
    }
    cylinder(.032, .032, .023, palette.black, -.08, .065, .015, c, 8);
    cylinder(.032, .032, .023, palette.black, .065, .065, .05, c, 8);
    box(.022, .018, .075, palette.black, -.155, .061, -.035, c);
    box(.075, .018, .022, palette.black, -.155, .061, -.035, c);
    for (let i = 0; i < 4; i++) cylinder(.011, .011, .018, [palette.blush, palette.blue, palette.sage, palette.brass][i], .154 + Math.sin(i * Math.PI / 2) * .035, .062, -.024 + Math.cos(i * Math.PI / 2) * .035, c, 6);
  }
  controller(-9.1, .745, 8.97, palette.cream, -.15);
  controller(-8.22, .745, 9.08, palette.dark, .13);
  cup(-7.44, 9.13, group, .7);
  cylinder(.2, .15, .14, palette.blush, -9.82, .77, 9.04);
  for (let i = 0; i < 6; i++) cylinder(.047, .043, .03, material('#d9b778'), -9.91 + (i % 3) * .075, .86 + Math.floor(i / 3) * .025, 9 + Math.floor(i / 3) * .07, group, 6);
  plant(-12.63, 10.9, 1.4);
  function arcade(x, z, title, variant = 0) {
    const g = local(x, z, .16);
    const accent = variant ? palette.blush : palette.sage;
    box(1.13, 1.07, .91, palette.dark, 0, .66, 0, g);
    box(1.16, .08, .96, palette.black, 0, .16, 0, g);
    for (const px of [-.565, .565]) {
      box(.095, 2.14, 1.0, accent, px, 1.18, -.03, g);
      box(.03, 1.97, .035, gamingGlow, px, 1.24, .482, g);
    }
    box(1.11, 1.26, .12, palette.black, 0, 1.56, -.45, g);
    box(1.1, .34, .96, palette.dark, 0, 2.12, -.035, g);
    box(1.12, .06, 1, accent, 0, 2.31, -.025, g);
    box(1.06, .85, .08, palette.black, 0, 1.58, .12, g);
    const display = mesh(geo('arcade-screen', () => new THREE.PlaneGeometry(.94, .7)), gameScreenMaterial(title, variant), 0, 1.6, .168, g); display.castShadow = false;
    box(1.07, .1, .7, palette.dark, 0, 1.11, .32, g);
    cylinder(.065, .065, .07, palette.black, -.25, 1.19, .43, g);
    cylinder(.025, .025, .18, palette.metal, -.25, 1.3, .43, g, 8);
    const knob = mesh(geo('arcade-stick', () => new THREE.SphereGeometry(.068, 10, 7)), accent, -.25, 1.41, .43, g);
    for (let i = 0; i < 4; i++) cylinder(.036, .036, .04, [palette.blush, palette.sage, palette.blue, palette.brass][i], .12 + (i % 2) * .13, 1.187, .37 + Math.floor(i / 2) * .13, g, 10);
    box(.25, .19, .027, palette.metal, 0, .71, .473, g);
    box(.085, .018, .03, palette.black, 0, .74, .49, g);
    print(`arcade-label-${title}`, .99, .25, (ctx, w, h) => {
      ctx.fillStyle = variant ? '#a98171' : '#7a9488'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fbf1d9'; ctx.font = 'bold 82px monospace'; ctx.textAlign = 'center'; ctx.fillText(title, w / 2, 300);
    }, 0, 2.13, .458, 0, g);
    const pad = rounded(1.24, .016, 1.85, .16, material('#85858a'), x, .097, z + .45); pad.rotation.y = .16;
    return { x, z, rotation: .16 };
  }
  const arcadeLocations = [arcade(-3.1, 10.5, 'NIGHT DRIVE'), arcade(-.9, 10.5, 'RALLY CLUB', 1)];
  print('gaming-wall-art', 2.5, 1.55, (ctx, w, h) => {
    ctx.fillStyle = '#e7e0d3'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#747681'; ctx.font = 'bold 95px Georgia'; ctx.fillText('One more', 77, 200); ctx.fillText('round.', 77, 309);
    ctx.fillStyle = '#ae866d'; ctx.font = '25px monospace'; ctx.fillText('THE GAMING ROOM  /  06', 82, 413);
  }, -13.92, 2.57, 9.45, Math.PI / 2);
  // A floor lamp beside the sofa, and a little analog clock in the hallway.
  cylinder(.29, .34, .055, palette.dark, -11.75, .11, 8.67);
  cylinder(.034, .034, 2.28, palette.brass, -11.75, 1.2, 8.67, group, 8);
  cylinder(.25, .5, .57, palette.cream, -11.75, 2.4, 8.67);
  cylinder(.46, .46, .023, material('#f4dba6', { emissive: '#e7c587', emissiveIntensity: .25 }), -11.75, 2.11, 8.67);
  const clock = local(-13.93, -2.36, Math.PI / 2);
  const clockBody = cylinder(.48, .48, .07, palette.dark, 0, 2.56, 0, clock, 32); clockBody.rotation.x = Math.PI / 2;
  const clockFace = cylinder(.433, .433, .015, palette.cream, 0, 2.56, .047, clock, 32); clockFace.rotation.x = Math.PI / 2;
  box(.035, .28, .018, palette.dark, 0, 2.69, .065, clock);
  const minute = box(.25, .026, .018, palette.dark, .1, 2.52, .069, clock); minute.rotation.z = -.25;
  // Keep the center of the shared hallway clear for meeting traffic.
  plant(-13.62, .15, .7);

  // Small ceiling-free architectural accents preserve the miniature silhouette.
  for (const x of [-14.05, -5, 4.5, 14.05]) {
    box(.32, .045, .48, palette.wallEdge, x, 3.98, -11.92);
  }
  group.traverse((object) => {
    if (object.isMesh && object.material.transparent) object.castShadow = false;
  });
  // Furniture is static. Batch meshes by material after construction so all the
  // small books, keys, and leaves do not each cost a separate draw every frame.
  group.updateMatrixWorld(true);
  const batches = new Map();
  const inverse = group.matrixWorld.clone().invert();
  group.traverse((object) => {
    if (!object.isMesh) return;
    const key = object.material.uuid + ':' + object.castShadow;
    if (!batches.has(key)) batches.set(key, { material: object.material, castShadow: object.castShadow, geometries: [] });
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld));
    batches.get(key).geometries.push(geometry);
  });
  group.clear();
  for (const batch of batches.values()) {
    const merged = mergeGeometries(batch.geometries, false);
    const item = new THREE.Mesh(merged, batch.material);
    item.castShadow = batch.castShadow; item.receiveShadow = true;
    item.name = 'Office furnishings';
    group.add(item);
    for (const geometry of batch.geometries) geometry.dispose();
  }
  for (const geometry of geometries.values()) geometry.dispose();
  // The TV and arcade cabinets are decorative parts of the office model.
  group.userData.gamingRoom = { doorway: [-12.8, 7], tv: [-8.6, 2, 7.22], arcades: arcadeLocations };
  group.userData.architecture = { walls: architecturalWalls, doors: architecturalDoors, board: OFFICE_LAYOUT.meeting.board };
  return { group, pickables: [], roomMarkers: [] };
}
