import roster from '../../agent-library/roster.json' with { type: 'json' };
import catalog from '../../agent-library/catalog.json' with { type: 'json' };

export const ROOMS = [
  { id: 'coding', name: 'Coding room', short: 'Code', label: 'BUILD & CREATE', color: '#72887b', center: [-6.1, 2.6], target: [-6, 0, 2.5] },
  { id: 'design', name: 'Design studio', short: 'Design', label: 'EXPLORE & REFINE', color: '#ad826b', center: [-0.3, -8], target: [-0.3, 0, -7.4] },
  { id: 'review', name: 'Review room', short: 'Review', label: 'CHECK & IMPROVE', color: '#72859a', center: [9.2, -8], target: [9.2, 0, -7.4] },
  { id: 'head', name: 'Head’s cabin', short: 'Head', label: 'PLAN & COORDINATE', color: '#9a9475', center: [-9.5, -8], target: [-9.5, 0, -7.4] },
  { id: 'meeting', name: 'Meeting room', short: 'Meet', label: 'THINK TOGETHER', color: '#b39772', center: [8.5, 5.8], target: [8.5, 0, 5] },
  { id: 'chill', name: 'Gaming lounge', short: 'Play', label: 'TAKE A PLAY BREAK', color: '#95849c', center: [-6, 9.6], target: [-6, 0, 9.5] },
];

const AVATAR_LAYOUT = [
  { id: 'nora', name: 'Alex', role: 'Team lead', room: 'head', color: '#727b66', skin: '#d3a07b', hair: '#42342a', position: [-9.4, -8.1], rotation: 0, seat: [6.5, 2.5], meetingRotation: Math.PI / 2, description: 'Coordinates the team, plans assignments, and brings decisions to you.' },
  { id: 'sam', name: 'Sam', role: 'Developer', room: 'coding', color: '#66869e', skin: '#bd8663', hair: '#342a27', position: [-10.2, 2.9], rotation: Math.PI, seat: [6.5, 5.5], meetingRotation: Math.PI / 2, description: 'Builds features and works through implementation details.' },
  { id: 'ava', name: 'Leo', role: 'Developer', room: 'coding', color: '#987d69', skin: '#ead0af', hair: '#65503d', position: [-3.8, 2.9], rotation: Math.PI, seat: [6.5, 8.5], meetingRotation: Math.PI / 2, description: 'Works on application behavior, integrations, and fixes.' },
  { id: 'maya', name: 'Maya', role: 'Designer', room: 'design', color: '#b27b68', skin: '#b97e5e', hair: '#35272b', position: [-0.3, -8.1], rotation: 0, seat: [10.5, 2.5], meetingRotation: -Math.PI / 2, description: 'Explores interfaces and checks the visual language of the product.' },
  { id: 'theo', name: 'Jules', role: 'Reviewer', room: 'review', color: '#7e839b', skin: '#e1b492', hair: '#493a31', position: [9.2, -8.1], rotation: 0, seat: [10.5, 5.5], meetingRotation: -Math.PI / 2, description: 'Reviews changes against project guidelines and checks the results.' },
  { id: 'noor', name: 'Robin', role: 'Available agent', room: 'chill', color: '#aa9260', skin: '#a97553', hair: '#272526', position: [-8.6, 10.1], rotation: Math.PI, seat: [10.5, 8.5], meetingRotation: -Math.PI / 2, description: 'A free seat on your team, ready for its next assignment.' },
];

export const DEPARTMENTS = roster.departments;
export const SKILLS = catalog.skills;
export const AGENTS = roster.agents.map(profile => ({ ...AVATAR_LAYOUT.find(avatar => avatar.id === profile.id), ...profile }));
export const AVATAR_AGENTS = AGENTS.filter(agent => Array.isArray(agent.position));
