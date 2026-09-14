// Shared architectural boundaries keep the visible doors and walking routes
// in agreement. Coordinates are floor-plane x/z, in office model units.
export const OFFICE_LAYOUT = {
  wallThickness: .18,
  wallHeight: 3.1,
  coding: {
    west: -14,
    east: 2.75,
    north: -1,
    south: 7,
    northDoors: [
      { center: -12.8, width: 1.8 },
      { center: -7, width: 2.6 },
      { center: 0, width: 1.8 },
    ],
  },
  meeting: {
    west: 2.75,
    east: 14.12,
    north: -1,
    south: 12.12,
    northDoors: [
      { center: 4, width: 1.8 },
      { center: 13, width: 1.8 },
    ],
    westDoor: { center: 4.8, width: 1.8 },
    board: { minX: 5.05, maxX: 11.95, minZ: -.73, maxZ: -.4 },
    entryX: { left: 4, right: 13 },
    insideZ: .35,
    aisleX: { left: 5.5, right: 11.5 },
  },
};

export function wallSpans(from, to, doors = []) {
  const spans = [];
  let edge = from;
  for (const door of [...doors].sort((a, b) => a.center - b.center)) {
    const start = Math.max(from, door.center - door.width / 2);
    const end = Math.min(to, door.center + door.width / 2);
    if (start > edge) spans.push([edge, start]);
    edge = Math.max(edge, end);
  }
  if (edge < to) spans.push([edge, to]);
  return spans;
}
