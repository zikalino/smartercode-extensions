const app = document.getElementById('app');

if (!app) {
  throw new Error('App element not found.');
}

app.innerHTML = `
  <div class="toolbar">
    <button id="startBtn" type="button">Start</button>
    <button id="pauseBtn" type="button">Pause</button>
    <button id="restartBtn" type="button">Restart</button>
    <span>Controls: A/D or Left/Right move, W/S or Up/Down climb shafts, Space jump, P pause</span>
  </div>
  <div class="stats">
    <span id="score">Score: 0</span>
    <span id="lives">Lives: 3</span>
    <span id="treasures">Treasures: 0 / 0</span>
    <span id="room">Room: S0</span>
    <span id="depth">Depth: Surface</span>
    <span id="status">Status: Ready</span>
  </div>
  <div class="canvas-wrap">
    <canvas id="gameCanvas" width="980" height="560"></canvas>
  </div>
`;

const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const restartBtn = document.getElementById('restartBtn');
const scoreLabel = document.getElementById('score');
const livesLabel = document.getElementById('lives');
const treasuresLabel = document.getElementById('treasures');
const roomLabel = document.getElementById('room');
const depthLabel = document.getElementById('depth');
const statusLabel = document.getElementById('status');

if (!startBtn || !pauseBtn || !restartBtn || !scoreLabel || !livesLabel || !treasuresLabel || !roomLabel || !depthLabel || !statusLabel) {
  throw new Error('Pitfall Adventure UI initialization failed.');
}

const canvas = document.getElementById('gameCanvas');
const context = canvas.getContext('2d');

if (!context) {
  throw new Error('2D context is unavailable.');
}

const WORLD = {
  width: canvas.width,
  height: canvas.height,
  gravity: 1500,
};

const DEPTH_NAME = {
  0: 'Surface',
  1: 'Caverns',
  2: 'Flooded Ruins',
};

const state = {
  running: false,
  paused: false,
  gameOver: false,
  won: false,
  score: 0,
  lives: 3,
  time: 0,
  rooms: {},
  roomId: 'S0',
  startRoomId: 'S0',
  startX: 72,
  startY: 430,
  transition: {
    active: false,
    timer: 0,
    duration: 0.34,
    fromRoomId: null,
    toRoomId: null,
    enterX: 0,
    enterY: 0,
    direction: 'right',
  },
  keys: {
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
  },
  player: {
    x: 72,
    y: 430,
    w: 28,
    h: 54,
    vx: 0,
    vy: 0,
    onGround: false,
    onLadder: false,
    ladderId: null,
    jumpLock: false,
    invulnerable: 0,
  },
};

function setStatus(text) {
  statusLabel.textContent = `Status: ${text}`;
}

function currentRoom() {
  return state.rooms[state.roomId];
}

function createRooms() {
  const rooms = {
    S0: buildSurfaceRoom('S0', { left: 'S3', right: 'S1', down: null }, [
      { x: 220, y: 500, w: 170, h: 20 },
      { x: 560, y: 460, w: 140, h: 20 },
    ], [
      { id: 'S0-T1', x: 602, y: 438, value: 180 },
    ], [
      { type: 'log', x: 310, y: 502, w: 44, h: 18, minX: 230, maxX: 430, vx: 92 },
      { type: 'scorpion', x: 730, y: 506, w: 34, h: 14, minX: 680, maxX: 880, vx: -64 },
    ], [], [
      { x: 438, w: 88, to: 'U0', enterX: 452, enterY: 26 },
    ]),
    S1: buildSurfaceRoom('S1', { left: 'S0', right: 'S2', down: 'U1' }, [
      { x: 120, y: 470, w: 150, h: 20 },
      { x: 680, y: 480, w: 180, h: 20 },
    ], [
      { id: 'S1-T1', x: 744, y: 458, value: 220 },
    ], [
      { type: 'log', x: 460, y: 502, w: 44, h: 18, minX: 360, maxX: 590, vx: 88 },
    ], [
      { id: 'S1-PD', x: 466, y: 478, w: 46, h: 42, direction: 'down', to: 'U1', enterX: 470, enterY: 38 },
    ], [
      { x: 546, w: 92, to: 'U1', enterX: 558, enterY: 28 },
    ]),
    S2: buildSurfaceRoom('S2', { left: 'S1', right: 'S3', down: 'U2' }, [
      { x: 260, y: 456, w: 170, h: 20 },
      { x: 640, y: 448, w: 180, h: 20 },
    ], [
      { id: 'S2-T1', x: 318, y: 434, value: 200 },
      { id: 'S2-T2', x: 708, y: 426, value: 240 },
    ], [
      { type: 'scorpion', x: 520, y: 506, w: 34, h: 14, minX: 470, maxX: 610, vx: 62 },
    ], [
      { id: 'S2-PD', x: 120, y: 478, w: 46, h: 42, direction: 'down', to: 'U2', enterX: 126, enterY: 44 },
    ], [
      { x: 72, w: 84, to: 'U2', enterX: 88, enterY: 30 },
    ]),
    S3: buildSurfaceRoom('S3', { left: 'S2', right: 'S0', down: 'U0' }, [
      { x: 180, y: 472, w: 150, h: 20 },
      { x: 510, y: 444, w: 180, h: 20 },
      { x: 810, y: 410, w: 120, h: 20 },
    ], [
      { id: 'S3-T1', x: 864, y: 388, value: 300 },
    ], [
      { type: 'log', x: 370, y: 502, w: 44, h: 18, minX: 350, maxX: 470, vx: -98 },
    ], [
      { id: 'S3-PD', x: 52, y: 478, w: 46, h: 42, direction: 'down', to: 'U0', enterX: 56, enterY: 40 },
    ], [
      { x: 104, w: 86, to: 'U0', enterX: 112, enterY: 30 },
    ]),
    U0: buildCaveRoom('U0', { left: 'U2', right: 'U1', up: 'S3', down: 'D1' }, [
      { x: 120, y: 440, w: 180, h: 18 },
      { x: 360, y: 390, w: 220, h: 18 },
      { x: 660, y: 430, w: 200, h: 18 },
    ], [
      { id: 'U0-T1', x: 410, y: 368, value: 260 },
    ], [
      { type: 'bat', x: 520, y: 260, w: 36, h: 16, minX: 260, maxX: 760, vx: 118, amp: 52 },
    ], [
      { id: 'U0-PU', x: 52, y: 2, w: 46, h: 40, direction: 'up', to: 'S3', enterX: 58, enterY: 430 },
      { id: 'U0-PD', x: 892, y: 500, w: 46, h: 42, direction: 'down', to: 'D1', enterX: 896, enterY: 42 },
    ]),
    U1: buildCaveRoom('U1', { left: 'U0', right: 'U2', up: 'S1', down: 'D2' }, [
      { x: 90, y: 460, w: 190, h: 18 },
      { x: 340, y: 420, w: 160, h: 18 },
      { x: 620, y: 370, w: 220, h: 18 },
    ], [
      { id: 'U1-T1', x: 670, y: 348, value: 280 },
    ], [
      { type: 'bat', x: 300, y: 250, w: 36, h: 16, minX: 130, maxX: 460, vx: -126, amp: 42 },
      { type: 'bat', x: 780, y: 290, w: 36, h: 16, minX: 540, maxX: 860, vx: 106, amp: 34 },
    ], [
      { id: 'U1-PU', x: 470, y: 2, w: 46, h: 40, direction: 'up', to: 'S1', enterX: 474, enterY: 432 },
      { id: 'U1-PD', x: 120, y: 500, w: 46, h: 42, direction: 'down', to: 'D2', enterX: 126, enterY: 40 },
    ]),
    U2: buildCaveRoom('U2', { left: 'U1', right: 'U0', up: 'S2', down: 'D0' }, [
      { x: 150, y: 420, w: 170, h: 18 },
      { x: 420, y: 452, w: 180, h: 18 },
      { x: 700, y: 404, w: 170, h: 18 },
    ], [
      { id: 'U2-T1', x: 228, y: 398, value: 260 },
      { id: 'U2-T2', x: 772, y: 382, value: 300 },
    ], [
      { type: 'bat', x: 560, y: 230, w: 36, h: 16, minX: 340, maxX: 860, vx: 120, amp: 50 },
    ], [
      { id: 'U2-PU', x: 130, y: 2, w: 46, h: 40, direction: 'up', to: 'S2', enterX: 130, enterY: 432 },
      { id: 'U2-PD', x: 780, y: 500, w: 46, h: 42, direction: 'down', to: 'D0', enterX: 786, enterY: 40 },
    ]),
    D0: buildFloodedRoom('D0', { left: 'D2', right: 'D1', up: 'U2' }, [
      { x: 80, y: 320, w: 190, h: 18 },
      { x: 380, y: 286, w: 160, h: 18 },
      { x: 680, y: 332, w: 200, h: 18 },
    ], [
      { x: 0, y: 360, w: 980, h: 200 },
    ], [
      { id: 'D0-T1', x: 724, y: 304, value: 320 },
    ], [
      { type: 'eel', x: 220, y: 408, w: 42, h: 18, minX: 60, maxX: 900, vx: 84, amp: 26 },
      { type: 'trap', x: 460, y: 542, w: 26, h: 18, cycle: 1.6, active: 0.7 },
    ], [
      { id: 'D0-PU', x: 790, y: 2, w: 46, h: 40, direction: 'up', to: 'U2', enterX: 794, enterY: 432 },
    ]),
    D1: buildFloodedRoom('D1', { left: 'D0', right: 'D2', up: 'U0' }, [
      { x: 140, y: 290, w: 190, h: 18 },
      { x: 460, y: 320, w: 150, h: 18 },
      { x: 700, y: 272, w: 160, h: 18 },
    ], [
      { x: 0, y: 350, w: 980, h: 210 },
    ], [
      { id: 'D1-T1', x: 748, y: 250, value: 340 },
    ], [
      { type: 'eel', x: 500, y: 404, w: 42, h: 18, minX: 120, maxX: 880, vx: -92, amp: 22 },
      { type: 'trap', x: 252, y: 542, w: 26, h: 18, cycle: 1.8, active: 0.6 },
      { type: 'trap', x: 588, y: 542, w: 26, h: 18, cycle: 1.4, active: 0.45 },
    ], [
      { id: 'D1-PU', x: 892, y: 2, w: 46, h: 40, direction: 'up', to: 'U0', enterX: 896, enterY: 428 },
    ]),
    D2: buildFloodedRoom('D2', { left: 'D1', right: 'D0', up: 'U1' }, [
      { x: 120, y: 306, w: 180, h: 18 },
      { x: 380, y: 274, w: 150, h: 18 },
      { x: 620, y: 314, w: 220, h: 18 },
    ], [
      { x: 0, y: 348, w: 980, h: 212 },
    ], [
      { id: 'D2-T1', x: 414, y: 252, value: 360 },
      { id: 'D2-T2', x: 770, y: 292, value: 420 },
    ], [
      { type: 'eel', x: 260, y: 396, w: 42, h: 18, minX: 90, maxX: 850, vx: 96, amp: 20 },
      { type: 'trap', x: 168, y: 542, w: 26, h: 18, cycle: 1.5, active: 0.5 },
      { type: 'trap', x: 812, y: 542, w: 26, h: 18, cycle: 1.7, active: 0.75 },
    ], [
      { id: 'D2-PU', x: 122, y: 2, w: 46, h: 40, direction: 'up', to: 'U1', enterX: 126, enterY: 428 },
    ]),
    T0: buildTempleRoom('T0', { left: 'U2', right: 'U0', down: 'U1' }, [
      { x: 120, y: 410, w: 200, h: 20 },
      { x: 380, y: 350, w: 220, h: 20 },
      { x: 700, y: 270, w: 180, h: 20 },
    ], [
      { id: 'T0-T1', x: 760, y: 248, value: 600 },
    ], [
      { type: 'bat', x: 470, y: 180, w: 36, h: 16, minX: 290, maxX: 800, vx: -120, amp: 56 },
    ], {
      x: 880,
      y: 190,
      w: 56,
      h: 80,
    }, [
      { id: 'T0-PD', x: 470, y: 500, w: 46, h: 42, direction: 'down', to: 'U1', enterX: 474, enterY: 40 },
    ]),
  };

  rooms.S2.portals.push({ id: 'S2-PU', x: 880, y: 2, w: 46, h: 40, direction: 'up', to: 'T0', enterX: 886, enterY: 430 });
  rooms.T0.portals.push({ id: 'T0-PU', x: 20, y: 2, w: 46, h: 40, direction: 'up', to: 'S2', enterX: 20, enterY: 430 });

  // Keep water visible in frequently visited surface rooms so the game reads as Pitfall-like immediately.
  rooms.S0.water = [{ x: 580, y: 500, w: 120, h: 60 }];
  rooms.S2.water = [{ x: 360, y: 500, w: 118, h: 60 }];

  return rooms;
}

function buildLaddersFromPortals(portals) {
  const ladders = [];

  for (let index = 0; index < portals.length; index += 1) {
    const portal = portals[index];
    if (portal.direction !== 'up' && portal.direction !== 'down') {
      continue;
    }

    const centerX = portal.x + portal.w / 2;

    if (portal.direction === 'up') {
      ladders.push({
        id: `L-${portal.id}`,
        x: centerX - 12,
        y: portal.y,
        w: 24,
        h: 220,
      });
    } else {
      const top = Math.max(38, portal.y - 220);
      ladders.push({
        id: `L-${portal.id}`,
        x: centerX - 12,
        y: top,
        w: 24,
        h: portal.y + portal.h - top,
      });
    }
  }

  return ladders;
}

function withCommonRuntime(room) {
  room.depth = room.depth || 0;
  room.hazards = room.hazards || [];
  room.solids = room.solids || [];
  room.treasures = room.treasures || [];
  room.portals = room.portals || [];
  room.ladders = room.ladders || buildLaddersFromPortals(room.portals);
  room.pits = room.pits || [];
  room.water = room.water || [];
  room.neighbors = room.neighbors || {};
  return room;
}

function buildGroundSegmentsFromPits(pits) {
  const sorted = [...(pits || [])].sort((a, b) => a.x - b.x);
  const segments = [];
  let cursor = 0;

  for (const pit of sorted) {
    const pitStart = Math.max(0, pit.x);
    const pitEnd = Math.min(WORLD.width, pit.x + pit.w);
    if (pitStart > cursor) {
      segments.push({ x: cursor, y: 520, w: pitStart - cursor, h: 40 });
    }
    cursor = Math.max(cursor, pitEnd);
  }

  if (cursor < WORLD.width) {
    segments.push({ x: cursor, y: 520, w: WORLD.width - cursor, h: 40 });
  }

  return segments;
}

function buildSurfaceRoom(id, neighbors, platforms, treasures, hazards, portals, pits) {
  const normalizedPits = pits || [];
  return withCommonRuntime({
    id,
    depth: 0,
    neighbors,
    solids: [
      ...buildGroundSegmentsFromPits(normalizedPits),
      ...platforms,
    ],
    hazards,
    treasures,
    portals: portals || [],
    pits: normalizedPits,
    water: [],
    exit: null,
  });
}

function buildCaveRoom(id, neighbors, platforms, treasures, hazards, portals) {
  return withCommonRuntime({
    id,
    depth: 1,
    neighbors,
    solids: [
      { x: 0, y: 520, w: WORLD.width, h: 40 },
      ...platforms,
    ],
    hazards,
    treasures,
    portals: portals || [],
    water: [],
    exit: null,
  });
}

function buildFloodedRoom(id, neighbors, platforms, water, treasures, hazards, portals) {
  return withCommonRuntime({
    id,
    depth: 2,
    neighbors,
    solids: [
      { x: 0, y: 540, w: WORLD.width, h: 20 },
      ...platforms,
    ],
    hazards,
    treasures,
    portals: portals || [],
    water,
    exit: null,
  });
}

function buildTempleRoom(id, neighbors, platforms, treasures, hazards, exit, portals) {
  return withCommonRuntime({
    id,
    depth: 1,
    neighbors,
    solids: [
      { x: 0, y: 520, w: WORLD.width, h: 40 },
      ...platforms,
    ],
    hazards,
    treasures,
    portals: portals || [],
    water: [],
    exit,
  });
}

function playerRect() {
  return { x: state.player.x, y: state.player.y, w: state.player.w, h: state.player.h };
}

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function rectInWater(rect, room) {
  for (const pool of room.water) {
    if (overlaps(rect, pool)) {
      return true;
    }
  }
  return false;
}

function startTransition(toRoomId, enterX, enterY, direction) {
  if (state.transition.active) {
    return;
  }

  state.transition.active = true;
  state.transition.timer = 0;
  state.transition.fromRoomId = state.roomId;
  state.transition.toRoomId = toRoomId;
  state.transition.enterX = enterX;
  state.transition.enterY = enterY;
  state.transition.direction = direction;

  state.player.vx = 0;
  state.player.vy = 0;
  state.player.onGround = false;
  state.player.onLadder = false;
  state.player.ladderId = null;
}

function finishTransition() {
  state.roomId = state.transition.toRoomId;
  state.player.x = state.transition.enterX;
  state.player.y = state.transition.enterY;
  state.transition.active = false;
  state.transition.fromRoomId = null;
  state.transition.toRoomId = null;
}

function updateHud() {
  scoreLabel.textContent = `Score: ${Math.floor(state.score)}`;
  livesLabel.textContent = `Lives: ${state.lives}`;

  let collected = 0;
  let total = 0;
  for (const room of Object.values(state.rooms)) {
    for (const treasure of room.treasures) {
      total += 1;
      if (treasure.taken) {
        collected += 1;
      }
    }
  }

  treasuresLabel.textContent = `Treasures: ${collected} / ${total}`;
  roomLabel.textContent = `Room: ${state.roomId}`;
  const depthName = DEPTH_NAME[currentRoom().depth] || 'Unknown';
  depthLabel.textContent = `Depth: ${depthName}`;
}

function resetGame() {
  state.running = false;
  state.paused = false;
  state.gameOver = false;
  state.won = false;
  state.score = 0;
  state.lives = 3;
  state.time = 0;
  state.rooms = createRooms();
  state.roomId = state.startRoomId;
  state.player.x = state.startX;
  state.player.y = state.startY;
  state.player.vx = 0;
  state.player.vy = 0;
  state.player.onGround = false;
  state.player.onLadder = false;
  state.player.ladderId = null;
  state.player.jumpLock = false;
  state.player.invulnerable = 0;
  state.transition.active = false;
  setStatus('Ready');
  updateHud();
}

function hurtPlayer(reason) {
  if (state.player.invulnerable > 0 || state.gameOver || state.won || state.transition.active) {
    return;
  }

  state.lives -= 1;
  if (state.lives <= 0) {
    state.lives = 0;
    state.running = false;
    state.gameOver = true;
    setStatus('Game Over');
  } else {
    state.roomId = state.startRoomId;
    state.player.x = state.startX;
    state.player.y = state.startY;
    state.player.vx = 0;
    state.player.vy = 0;
    state.player.onGround = false;
    state.player.onLadder = false;
    state.player.ladderId = null;
    state.player.jumpLock = false;
    state.player.invulnerable = 1.4;
    setStatus(reason);
  }

  updateHud();
}

function updateHazards(dt, room) {
  for (const hazard of room.hazards) {
    if (hazard.type === 'trap') {
      continue;
    }

    hazard.x += hazard.vx * dt;
    if (hazard.x < hazard.minX) {
      hazard.x = hazard.minX;
      hazard.vx *= -1;
    } else if (hazard.x > hazard.maxX) {
      hazard.x = hazard.maxX;
      hazard.vx *= -1;
    }

    if (hazard.type === 'bat') {
      hazard.yBase = hazard.yBase || hazard.y;
      hazard.y = hazard.yBase + Math.sin(state.time * 3.4 + hazard.x * 0.01) * (hazard.amp || 30);
    }

    if (hazard.type === 'eel') {
      hazard.yBase = hazard.yBase || hazard.y;
      hazard.y = hazard.yBase + Math.sin(state.time * 4 + hazard.x * 0.012) * (hazard.amp || 22);
    }
  }

  const pRect = playerRect();

  for (const hazard of room.hazards) {
    if (hazard.type === 'trap') {
      const phase = (state.time + hazard.x * 0.01) % hazard.cycle;
      const active = phase < hazard.active;
      hazard.activeNow = active;
      if (!active) {
        continue;
      }
    }

    if (overlaps(pRect, hazard)) {
      if (hazard.type === 'log') {
        hurtPlayer('Crushed by rolling log');
      } else if (hazard.type === 'scorpion') {
        hurtPlayer('Bitten by scorpion');
      } else if (hazard.type === 'bat') {
        hurtPlayer('Bat swarm attack');
      } else if (hazard.type === 'eel') {
        hurtPlayer('Eel shock');
      } else {
        hurtPlayer('Triggered trap spikes');
      }
      return;
    }
  }
}

function collectTreasures(room) {
  const pRect = playerRect();
  for (const treasure of room.treasures) {
    if (treasure.taken) {
      continue;
    }

    if (overlaps(pRect, treasure)) {
      treasure.taken = true;
      state.score += treasure.value;
      setStatus(`Treasure +${treasure.value}`);
      updateHud();
    }
  }
}

function tryPortalTransition(room) {
  const pRect = playerRect();

  for (const portal of room.portals) {
    if (!overlaps(pRect, portal)) {
      continue;
    }

    if (portal.direction === 'down' && state.keys.down) {
      startTransition(portal.to, portal.enterX, portal.enterY, 'down');
      return;
    }

    if (portal.direction === 'up' && state.keys.up) {
      startTransition(portal.to, portal.enterX, portal.enterY, 'up');
      return;
    }
  }
}

function isNearLadder(room) {
  const cx = state.player.x + state.player.w / 2;
  const cy = state.player.y + state.player.h / 2;

  for (const ladder of room.ladders) {
    const lx = ladder.x + ladder.w / 2;
    const ly = ladder.y + ladder.h / 2;
    if (Math.abs(cx - lx) < 22 && Math.abs(cy - ly) < ladder.h * 0.55) {
      return ladder;
    }
  }

  return null;
}

function resolveHorizontal(room, nextX) {
  const player = state.player;
  let adjustedX = nextX;
  const testRect = { x: adjustedX, y: player.y, w: player.w, h: player.h };

  for (const solid of room.solids) {
    if (!overlaps(testRect, solid)) {
      continue;
    }

    if (player.vx > 0) {
      adjustedX = solid.x - player.w;
    } else if (player.vx < 0) {
      adjustedX = solid.x + solid.w;
    }
  }

  return adjustedX;
}

function resolveVertical(room, nextY) {
  const player = state.player;
  let adjustedY = nextY;
  let landed = false;
  const testRect = { x: player.x, y: adjustedY, w: player.w, h: player.h };

  for (const solid of room.solids) {
    if (!overlaps(testRect, solid)) {
      continue;
    }

    if (player.vy > 0) {
      adjustedY = solid.y - player.h;
      player.vy = 0;
      landed = true;
    } else if (player.vy < 0) {
      adjustedY = solid.y + solid.h;
      player.vy = 0;
    }
  }

  return { y: adjustedY, landed };
}

function updatePlayer(dt, room) {
  const player = state.player;

  const accel = 1360;
  const maxRun = 320;
  const ladderSpeed = 195;

  const ladder = isNearLadder(room);
  if (!player.onLadder && ladder && (state.keys.up || state.keys.down)) {
    player.onLadder = true;
    player.ladderId = ladder.id;
    player.vx = 0;
    player.vy = 0;
  }

  if (player.onLadder) {
    const activeLadder = room.ladders.find((item) => item.id === player.ladderId) || ladder;
    if (!activeLadder) {
      player.onLadder = false;
      player.ladderId = null;
    } else {
      player.x = activeLadder.x + activeLadder.w / 2 - player.w / 2;

      const climb = (state.keys.up ? -1 : 0) + (state.keys.down ? 1 : 0);
      player.y += climb * ladderSpeed * dt;

      if (state.keys.left) {
        player.x -= 80 * dt;
      }
      if (state.keys.right) {
        player.x += 80 * dt;
      }

      if (state.keys.jump && !player.jumpLock) {
        player.onLadder = false;
        player.vy = -480;
        player.vx = ((state.keys.right ? 1 : 0) - (state.keys.left ? 1 : 0)) * 180;
        player.jumpLock = true;
      }

      if (!state.keys.jump) {
        player.jumpLock = false;
      }

      player.x = Math.max(0, Math.min(WORLD.width - player.w, player.x));
      const minY = activeLadder.y - player.h + 6;
      const maxY = activeLadder.y + activeLadder.h - 8;
      player.y = Math.max(minY, Math.min(maxY, player.y));
      return;
    }
  }

  if (state.keys.left) {
    player.vx -= accel * dt;
  }
  if (state.keys.right) {
    player.vx += accel * dt;
  }

  player.vx = Math.max(-maxRun, Math.min(maxRun, player.vx));

  const pRect = playerRect();
  const inWater = rectInWater(pRect, room);

  if (inWater) {
    player.vx *= 0.85;
    player.vy += WORLD.gravity * dt * 0.3;
    player.vy = Math.min(player.vy, 230);
  } else {
    player.vx *= player.onGround ? 0.8 : 0.93;
    player.vy += WORLD.gravity * dt;
  }

  if (state.keys.jump && player.onGround && !player.jumpLock) {
    player.vy = inWater ? -330 : -560;
    player.onGround = false;
    player.jumpLock = true;
  }

  if (!state.keys.jump) {
    player.jumpLock = false;
  }

  const nextX = player.x + player.vx * dt;
  player.x = resolveHorizontal(room, nextX);

  const nextY = player.y + player.vy * dt;
  const v = resolveVertical(room, nextY);
  player.y = v.y;
  player.onGround = v.landed;

  if (player.y > WORLD.height + 24) {
    if (room.depth === 0 && room.pits.length > 0) {
      const centerX = player.x + player.w * 0.5;
      const pit = room.pits.find((item) => centerX >= item.x && centerX <= item.x + item.w);
      if (pit) {
        startTransition(pit.to, pit.enterX, pit.enterY, 'down');
        return;
      }
    }

    hurtPlayer('Fell into abyss');
    return;
  }

  if (player.x < -player.w) {
    if (room.neighbors.left) {
      startTransition(room.neighbors.left, WORLD.width - player.w - 4, player.y, 'left');
      return;
    }
    player.x = 0;
  } else if (player.x > WORLD.width) {
    if (room.neighbors.right) {
      startTransition(room.neighbors.right, 4, player.y, 'right');
      return;
    }
    player.x = WORLD.width - player.w;
  }

  tryPortalTransition(room);
}

function checkVictory(room) {
  if (!room.exit) {
    return;
  }

  const totalTreasures = Object.values(state.rooms).reduce((sum, item) => sum + item.treasures.length, 0);
  const collected = Object.values(state.rooms).reduce((sum, item) => sum + item.treasures.filter((t) => t.taken).length, 0);

  if (collected < totalTreasures) {
    return;
  }

  if (overlaps(playerRect(), room.exit)) {
    state.won = true;
    state.running = false;
    state.score += 1200;
    setStatus('Victory');
    updateHud();
  }
}

function updateTransition(dt) {
  if (!state.transition.active) {
    return;
  }

  state.transition.timer += dt;
  if (state.transition.timer >= state.transition.duration) {
    finishTransition();
  }
}

function updateGame(dt) {
  if (!state.running || state.paused || state.gameOver || state.won) {
    return;
  }

  state.time += dt;
  state.player.invulnerable = Math.max(0, state.player.invulnerable - dt);

  if (state.transition.active) {
    updateTransition(dt);
    return;
  }

  const room = currentRoom();
  updatePlayer(dt, room);
  updateHazards(dt, room);
  collectTreasures(room);
  checkVictory(room);
  updateHud();
}

function drawBackground(room) {
  if (room.depth === 0) {
    const gradient = context.createLinearGradient(0, 0, 0, WORLD.height);
    gradient.addColorStop(0, '#7eb769');
    gradient.addColorStop(0.55, '#4d7d4a');
    gradient.addColorStop(1, '#223523');
    context.fillStyle = gradient;
  } else if (room.depth === 1) {
    const gradient = context.createLinearGradient(0, 0, 0, WORLD.height);
    gradient.addColorStop(0, '#4a5c3f');
    gradient.addColorStop(0.55, '#2f3b2f');
    gradient.addColorStop(1, '#161d1a');
    context.fillStyle = gradient;
  } else {
    const gradient = context.createLinearGradient(0, 0, 0, WORLD.height);
    gradient.addColorStop(0, '#2b4f58');
    gradient.addColorStop(0.45, '#1d3340');
    gradient.addColorStop(1, '#111f2a');
    context.fillStyle = gradient;
  }

  context.fillRect(0, 0, WORLD.width, WORLD.height);

  for (let index = 0; index < 20; index += 1) {
    const x = (index * 160 + Math.sin(state.time + index) * 20) % (WORLD.width + 240) - 120;
    const y = 60 + (index % 5) * 90;

    if (room.depth === 0) {
      context.fillStyle = 'rgba(35, 75, 35, 0.25)';
    } else if (room.depth === 1) {
      context.fillStyle = 'rgba(52, 67, 52, 0.3)';
    } else {
      context.fillStyle = 'rgba(24, 54, 72, 0.28)';
    }

    context.fillRect(x, y, 14, WORLD.height - y);
    context.beginPath();
    context.arc(x + 7, y, 38, Math.PI, Math.PI * 2);
    context.fill();
  }
}

function drawWater(room) {
  if (room.water.length === 0) {
    return;
  }

  for (const pool of room.water) {
    context.fillStyle = 'rgba(34, 126, 170, 0.68)';
    context.fillRect(pool.x, pool.y, pool.w, pool.h);

    context.fillStyle = 'rgba(94, 198, 228, 0.45)';
    for (let x = pool.x; x < pool.x + pool.w; x += 40) {
      const waveY = pool.y + 8 + Math.sin(state.time * 5 + x * 0.06) * 2;
      context.fillRect(x, waveY, 24, 2);
    }

    context.fillStyle = 'rgba(176, 236, 255, 0.36)';
    for (let x = pool.x + 14; x < pool.x + pool.w; x += 46) {
      const bob = Math.sin(state.time * 3.7 + x * 0.04) * 4;
      context.fillRect(x, pool.y + 22 + bob, 3, 3);
    }
  }
}

function drawPits(room) {
  if (!room.pits || room.pits.length === 0) {
    return;
  }

  for (const pit of room.pits) {
    context.fillStyle = '#0f1518';
    context.fillRect(pit.x, 520, pit.w, WORLD.height - 520);

    context.fillStyle = 'rgba(32, 50, 58, 0.8)';
    for (let y = 530; y < WORLD.height; y += 22) {
      const inset = Math.sin((state.time * 2.1) + y * 0.04) * 3;
      context.fillRect(pit.x + 10 + inset, y, pit.w - 20, 2);
    }
  }
}

function drawLadders(room) {
  if (!room.ladders || room.ladders.length === 0) {
    return;
  }

  context.fillStyle = '#8f6f43';
  for (const ladder of room.ladders) {
    context.fillRect(ladder.x + 3, ladder.y, 4, ladder.h);
    context.fillRect(ladder.x + ladder.w - 7, ladder.y, 4, ladder.h);

    context.fillStyle = '#b08c57';
    for (let y = ladder.y + 10; y < ladder.y + ladder.h; y += 16) {
      context.fillRect(ladder.x + 4, y, ladder.w - 8, 3);
    }
    context.fillStyle = '#8f6f43';
  }
}

function drawSolids(room) {
  for (const solid of room.solids) {
    context.fillStyle = room.depth === 0 ? '#4f3a28' : room.depth === 1 ? '#4d4a40' : '#445264';
    context.fillRect(solid.x, solid.y, solid.w, solid.h);
    context.fillStyle = room.depth === 0 ? '#76a44d' : room.depth === 1 ? '#6b7a64' : '#5ea1b8';
    context.fillRect(solid.x, solid.y - 6, solid.w, 6);
  }
}

function drawPortals(room) {
  for (const portal of room.portals) {
    context.fillStyle = portal.direction === 'down' ? 'rgba(38, 44, 55, 0.48)' : 'rgba(82, 90, 60, 0.38)';
    context.fillRect(portal.x, portal.y, portal.w, portal.h);
    context.strokeStyle = 'rgba(210, 220, 185, 0.42)';
    context.strokeRect(portal.x + 1, portal.y + 1, portal.w - 2, portal.h - 2);
  }
}

function drawHazards(room) {
  for (const hazard of room.hazards) {
    if (hazard.type === 'log') {
      context.fillStyle = '#6a4224';
      context.fillRect(hazard.x, hazard.y, hazard.w, hazard.h);
      context.strokeStyle = '#4f2f18';
      context.strokeRect(hazard.x, hazard.y, hazard.w, hazard.h);
    } else if (hazard.type === 'scorpion') {
      context.fillStyle = '#7e2130';
      context.fillRect(hazard.x, hazard.y, hazard.w, hazard.h);
      context.fillStyle = '#a82f42';
      context.fillRect(hazard.x + 6, hazard.y - 4, hazard.w - 12, 4);
    } else if (hazard.type === 'bat') {
      context.fillStyle = '#40464e';
      context.fillRect(hazard.x, hazard.y + 5, hazard.w, hazard.h - 5);
      context.fillStyle = '#616b76';
      context.fillRect(hazard.x + 6, hazard.y, hazard.w - 12, 6);
    } else if (hazard.type === 'eel') {
      context.fillStyle = '#3f7f94';
      context.fillRect(hazard.x, hazard.y, hazard.w, hazard.h);
      context.fillStyle = '#84c4d2';
      context.fillRect(hazard.x + 8, hazard.y + 4, hazard.w - 14, 6);
    } else if (hazard.type === 'trap' && hazard.activeNow) {
      context.fillStyle = '#b3bcc6';
      context.beginPath();
      context.moveTo(hazard.x, hazard.y + hazard.h);
      context.lineTo(hazard.x + hazard.w * 0.5, hazard.y);
      context.lineTo(hazard.x + hazard.w, hazard.y + hazard.h);
      context.closePath();
      context.fill();
    }
  }
}

function drawTreasures(room) {
  for (const treasure of room.treasures) {
    if (treasure.taken) {
      continue;
    }

    context.fillStyle = '#d6b24b';
    context.fillRect(treasure.x, treasure.y, treasure.w || 20, treasure.h || 20);
    context.fillStyle = '#f5df9a';
    context.fillRect(treasure.x + 4, treasure.y + 4, 12, 12);
  }
}

function drawExit(room) {
  if (!room.exit) {
    return;
  }

  context.fillStyle = '#8b6b3d';
  context.fillRect(room.exit.x, room.exit.y, room.exit.w, room.exit.h);
  context.fillStyle = '#e2d395';
  context.fillRect(room.exit.x + 10, room.exit.y + 12, room.exit.w - 20, room.exit.h - 18);
}

function drawPlayer() {
  const blink = state.player.invulnerable > 0 && Math.floor(state.time * 14) % 2 === 0;
  if (blink) {
    return;
  }

  const p = state.player;

  context.fillStyle = '#d4a15e';
  context.fillRect(p.x + 8, p.y + 4, 12, 12);
  context.fillStyle = '#f4d8aa';
  context.fillRect(p.x + 10, p.y + 6, 8, 8);

  context.fillStyle = '#2f4c98';
  context.fillRect(p.x + 7, p.y + 18, 14, 20);

  context.fillStyle = '#8a5e39';
  context.fillRect(p.x + 5, p.y + 22, 4, 14);
  context.fillRect(p.x + 19, p.y + 22, 4, 14);

  context.fillStyle = '#513523';
  context.fillRect(p.x + 8, p.y + 38, 5, 15);
  context.fillRect(p.x + 16, p.y + 38, 5, 15);
}

function drawTransitionOverlay() {
  if (!state.transition.active) {
    return;
  }

  const t = Math.min(1, state.transition.timer / state.transition.duration);
  const fade = t < 0.5 ? t * 2 : (1 - t) * 2;
  const width = Math.floor(canvas.width * Math.min(1, t * 1.25));

  context.fillStyle = `rgba(8, 10, 12, ${0.45 * fade})`;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = `rgba(0, 0, 0, ${0.55 * fade})`;
  if (state.transition.direction === 'right') {
    context.fillRect(0, 0, width, canvas.height);
  } else if (state.transition.direction === 'left') {
    context.fillRect(canvas.width - width, 0, width, canvas.height);
  } else if (state.transition.direction === 'down') {
    context.fillRect(0, 0, canvas.width, Math.floor(canvas.height * Math.min(1, t * 1.25)));
  } else {
    context.fillRect(0, canvas.height - Math.floor(canvas.height * Math.min(1, t * 1.25)), canvas.width, Math.floor(canvas.height * Math.min(1, t * 1.25)));
  }
}

function drawOverlay() {
  if (!(state.paused || state.gameOver || state.won || !state.running)) {
    return;
  }

  let title = '';
  let subtitle = '';

  if (state.won) {
    title = 'YOU CLEARED THE LOST MAZE';
    subtitle = `Final Score: ${Math.floor(state.score)}`;
  } else if (state.gameOver) {
    title = 'GAME OVER';
    subtitle = 'Press Restart to try again';
  } else if (state.paused) {
    title = 'PAUSED';
    subtitle = 'Press Pause or P to continue';
  } else if (!state.running) {
    title = 'PITFALL ADVENTURE';
    subtitle = 'Screen-to-screen jungle and caverns. Explore both horizontal and vertical routes.';
  }

  context.fillStyle = 'rgba(0, 0, 0, 0.44)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#f0e9cc';
  context.textAlign = 'center';
  context.font = 'bold 42px serif';
  context.fillText(title, canvas.width / 2, canvas.height / 2 - 20);
  context.font = '17px sans-serif';
  context.fillText(subtitle, canvas.width / 2, canvas.height / 2 + 24);
}

function render() {
  const room = currentRoom();

  drawBackground(room);
  drawSolids(room);
  drawPits(room);
  drawWater(room);
  drawLadders(room);
  drawPortals(room);
  drawHazards(room);
  drawTreasures(room);
  drawExit(room);
  drawPlayer();
  drawTransitionOverlay();
  drawOverlay();
}

function startGame() {
  if (state.gameOver || state.won) {
    resetGame();
  }

  state.running = true;
  state.paused = false;
  setStatus('Running');
}

function togglePause() {
  if (!state.running || state.gameOver || state.won) {
    return;
  }

  state.paused = !state.paused;
  setStatus(state.paused ? 'Paused' : 'Running');
}

function updateKeys(event, isDown) {
  const key = event.key.toLowerCase();

  if (key === 'arrowleft' || key === 'a') {
    state.keys.left = isDown;
    event.preventDefault();
  } else if (key === 'arrowright' || key === 'd') {
    state.keys.right = isDown;
    event.preventDefault();
  } else if (key === 'arrowup' || key === 'w') {
    state.keys.up = isDown;
    event.preventDefault();
  } else if (key === 'arrowdown' || key === 's') {
    state.keys.down = isDown;
    event.preventDefault();
  } else if (key === ' ') {
    state.keys.jump = isDown;
    event.preventDefault();
  } else if (isDown && key === 'p') {
    togglePause();
    event.preventDefault();
  }
}

let previous = performance.now();
function loop(now) {
  const dt = Math.min(0.04, (now - previous) / 1000);
  previous = now;

  updateGame(dt);
  render();
  requestAnimationFrame(loop);
}

window.addEventListener('keydown', (event) => updateKeys(event, true));
window.addEventListener('keyup', (event) => updateKeys(event, false));

startBtn.addEventListener('click', startGame);
pauseBtn.addEventListener('click', togglePause);
restartBtn.addEventListener('click', () => {
  resetGame();
  setStatus('Ready');
});

resetGame();
requestAnimationFrame(loop);
