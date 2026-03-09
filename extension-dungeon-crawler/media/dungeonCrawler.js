const app = document.getElementById('app');

if (!app) {
  throw new Error('App root was not found.');
}

app.innerHTML = `
  <div class="toolbar">
    <button id="startBtn" type="button">Start</button>
    <button id="pauseBtn" type="button">Pause</button>
    <button id="restartBtn" type="button">Restart</button>
    <span>Controls: W/S move, A/D strafe, Q/E turn, Space attack, M map, P pause</span>
  </div>
  <div class="stats">
    <span id="health">Health: 100</span>
    <span id="kills">Kills: 0 / 10</span>
    <span id="keys">Keys: none</span>
    <span id="status">Status: Ready</span>
  </div>
  <div class="layout">
    <div class="canvas-wrap">
      <canvas id="gameCanvas" width="940" height="560"></canvas>
    </div>
    <aside class="sidebar">
      <div>
        <h3>Current Objective</h3>
        <p id="log">Find keys, unlock doors, defeat all 10 monster types, and reach the exit.</p>
      </div>
      <div>
        <h3>Bestiary</h3>
        <ul id="bestiary"></ul>
      </div>
    </aside>
  </div>
`;

const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const restartBtn = document.getElementById('restartBtn');
const healthLabel = document.getElementById('health');
const killsLabel = document.getElementById('kills');
const keysLabel = document.getElementById('keys');
const statusLabel = document.getElementById('status');
const logLabel = document.getElementById('log');
const bestiaryList = document.getElementById('bestiary');

if (!startBtn || !pauseBtn || !restartBtn || !healthLabel || !killsLabel || !keysLabel || !statusLabel || !logLabel || !bestiaryList) {
  throw new Error('Dungeon crawler UI failed to initialize.');
}

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

if (!ctx) {
  throw new Error('2D context is not available for dungeon crawler canvas.');
}

const fov = Math.PI / 3;
const maxDepth = 18;
const playerRadius = 0.2;
const attackRange = 1.6;

const keyInfo = {
  r: { name: 'Ruby Key', color: '#d34f4f' },
  g: { name: 'Emerald Key', color: '#3cad63' },
  b: { name: 'Sapphire Key', color: '#5096f0' },
  y: { name: 'Sun Key', color: '#d3b74f' },
};

const doorInfo = {
  R: { key: 'r', color: '#d34f4f' },
  G: { key: 'g', color: '#3cad63' },
  B: { key: 'b', color: '#5096f0' },
  Y: { key: 'y', color: '#d3b74f' },
};

const monsterCatalog = [
  { name: 'Skeleton Guard', color: '#d9d9d9', hp: 30, speed: 0.85, damage: 9 },
  { name: 'Cave Bat', color: '#7f6ee4', hp: 20, speed: 1.4, damage: 6 },
  { name: 'Rat Swarm', color: '#7d5f43', hp: 24, speed: 1.2, damage: 7 },
  { name: 'Goblin Skirmisher', color: '#63b862', hp: 34, speed: 1.0, damage: 10 },
  { name: 'Spider Matriarch', color: '#3f3f3f', hp: 40, speed: 0.95, damage: 11 },
  { name: 'Wraith', color: '#81b1cc', hp: 45, speed: 1.05, damage: 12 },
  { name: 'Stone Golem', color: '#8a7f74', hp: 70, speed: 0.62, damage: 15 },
  { name: 'Dark Mage', color: '#9a4fcf', hp: 52, speed: 0.9, damage: 14 },
  { name: 'Lizard Knight', color: '#58a88a', hp: 58, speed: 0.78, damage: 13 },
  { name: 'Dread Minotaur', color: '#be5e35', hp: 88, speed: 0.72, damage: 18 },
];

bestiaryList.innerHTML = monsterCatalog
  .map((monster, index) => `<li><span>${index + 1}. ${monster.name}</span><span style="color:${monster.color}">HP ${monster.hp}</span></li>`)
  .join('');

const levelRows = [
  '##############################',
  '#S..#....0.....#.....r.....##',
  '#.#.#.######.#.#.#########..#',
  '#.#...#....#.#...#.....R.#..#',
  '#.###.#.1..#.#####.#####.#.##',
  '#...#...#..#...g.#...#...#..#',
  '###.###.#.#######.#G.#.###..#',
  '#...#...#..2..#...#..#...#..#',
  '#.###.#####.###.#####.#.#.###',
  '#.#...#..b#...#...B...#.#...#',
  '#.#.###.###.#.###.#####.###.#',
  '#...#...3...#..#....4..#....#',
  '###.#.#####.##.#.#######.##.#',
  '#...#..y..#....#...Y...#..#.#',
  '#.#######.###########.#.#.#.#',
  '#.....5.#.....6.....#.#...#.#',
  '#.#####.#.#########.#.#####.#',
  '#...7.#.#...8.....#.#.....#.#',
  '###.#.#.###.#####.#.#####.#.#',
  '#...#...#.....9...#......E..#',
  '##############################',
];

const state = {
  running: false,
  paused: false,
  won: false,
  gameOver: false,
  showMap: true,
  health: 100,
  kills: 0,
  totalMonsters: 10,
  keys: { r: 0, g: 0, b: 0, y: 0 },
  lastMessage: 'Ready for descent.',
  player: {
    x: 1.5,
    y: 1.5,
    dir: 0,
    turnSpeed: 2.2,
    moveSpeed: 2.55,
  },
  monsters: [],
  pressed: {
    forward: false,
    backward: false,
    left: false,
    right: false,
    turnLeft: false,
    turnRight: false,
    attack: false,
  },
  attackCooldown: 0,
  map: [],
  width: 0,
  height: 0,
};

function createLevel() {
  const width = Math.max(...levelRows.map((row) => row.length));
  const map = levelRows.map((row) => row.padEnd(width, '#').split(''));

  const monsters = [];
  let startFound = false;

  for (let y = 0; y < map.length; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tile = map[y][x];

      if (tile === 'S') {
        state.player.x = x + 0.5;
        state.player.y = y + 0.5;
        state.player.dir = 0;
        map[y][x] = '.';
        startFound = true;
        continue;
      }

      if (tile >= '0' && tile <= '9') {
        const typeIndex = Number(tile);
        const config = monsterCatalog[typeIndex];
        monsters.push({
          id: typeIndex,
          name: config.name,
          color: config.color,
          hp: config.hp,
          maxHp: config.hp,
          speed: config.speed,
          damage: config.damage,
          x: x + 0.5,
          y: y + 0.5,
          alive: true,
          attackCooldown: 0,
        });
        map[y][x] = '.';
      }
    }
  }

  if (!startFound) {
    throw new Error('The level does not contain a player spawn tile S.');
  }

  state.map = map;
  state.width = width;
  state.height = map.length;
  state.monsters = monsters;
}

function resetGame() {
  state.running = false;
  state.paused = false;
  state.won = false;
  state.gameOver = false;
  state.showMap = true;
  state.health = 100;
  state.kills = 0;
  state.keys.r = 0;
  state.keys.g = 0;
  state.keys.b = 0;
  state.keys.y = 0;
  state.lastMessage = 'Ready for descent.';
  state.attackCooldown = 0;
  state.pressed.attack = false;
  createLevel();
  updateHud();
}

function setMessage(message) {
  state.lastMessage = message;
  logLabel.textContent = message;
}

function setStatus(text) {
  statusLabel.textContent = `Status: ${text}`;
}

function getKeysText() {
  const names = [];
  for (const key of Object.keys(state.keys)) {
    const amount = state.keys[key];
    if (amount > 0) {
      names.push(`${keyInfo[key].name} x${amount}`);
    }
  }
  return names.length > 0 ? names.join(', ') : 'none';
}

function updateHud() {
  healthLabel.textContent = `Health: ${Math.max(0, Math.floor(state.health))}`;
  killsLabel.textContent = `Kills: ${state.kills} / ${state.totalMonsters}`;
  keysLabel.textContent = `Keys: ${getKeysText()}`;
}

function startGame() {
  if (state.won || state.gameOver) {
    resetGame();
  }
  state.running = true;
  state.paused = false;
  setStatus('Exploring');
  setMessage('Find the exit after slaying all ten monsters.');
}

function togglePause() {
  if (!state.running || state.won || state.gameOver) {
    return;
  }
  state.paused = !state.paused;
  setStatus(state.paused ? 'Paused' : 'Exploring');
}

function isSolidTile(tile) {
  return tile === '#' || doorInfo[tile] !== undefined;
}

function getTile(x, y) {
  if (x < 0 || y < 0 || x >= state.width || y >= state.height) {
    return '#';
  }
  return state.map[Math.floor(y)][Math.floor(x)];
}

function setTile(x, y, tile) {
  state.map[Math.floor(y)][Math.floor(x)] = tile;
}

function tryUnlockDoor(x, y) {
  const tile = getTile(x, y);
  const door = doorInfo[tile];
  if (!door) {
    return false;
  }

  const keyCount = state.keys[door.key];
  if (keyCount > 0) {
    state.keys[door.key] -= 1;
    setTile(x, y, '.');
    setMessage(`Unlocked ${tile} door using ${keyInfo[door.key].name}.`);
    updateHud();
  } else {
    setMessage(`Need ${keyInfo[door.key].name} to open this door.`);
  }

  return true;
}

function canMoveTo(x, y) {
  const tile = getTile(x, y);
  if (!isSolidTile(tile)) {
    return true;
  }
  tryUnlockDoor(x, y);
  return false;
}

function movePlayer(dx, dy) {
  const nextX = state.player.x + dx;
  const nextY = state.player.y + dy;

  if (dx !== 0) {
    const aheadX = nextX + Math.sign(dx) * playerRadius;
    const aheadY = state.player.y;
    if (canMoveTo(aheadX, aheadY)) {
      state.player.x = nextX;
    }
  }

  if (dy !== 0) {
    const sideX = state.player.x;
    const sideY = nextY + Math.sign(dy) * playerRadius;
    if (canMoveTo(sideX, sideY)) {
      state.player.y = nextY;
    }
  }
}

function updatePlayer(dt) {
  let moveForward = 0;
  let strafe = 0;

  if (state.pressed.forward) {
    moveForward += 1;
  }
  if (state.pressed.backward) {
    moveForward -= 1;
  }
  if (state.pressed.right) {
    strafe += 1;
  }
  if (state.pressed.left) {
    strafe -= 1;
  }

  if (state.pressed.turnLeft) {
    state.player.dir -= state.player.turnSpeed * dt;
  }
  if (state.pressed.turnRight) {
    state.player.dir += state.player.turnSpeed * dt;
  }

  const forwardX = Math.cos(state.player.dir);
  const forwardY = Math.sin(state.player.dir);
  const rightX = Math.cos(state.player.dir + Math.PI / 2);
  const rightY = Math.sin(state.player.dir + Math.PI / 2);

  const speed = state.player.moveSpeed * dt;
  if (moveForward !== 0 || strafe !== 0) {
    movePlayer(
      (forwardX * moveForward + rightX * strafe) * speed,
      (forwardY * moveForward + rightY * strafe) * speed
    );
  }

  const tile = getTile(state.player.x, state.player.y);
  if (tile === 'r' || tile === 'g' || tile === 'b' || tile === 'y') {
    state.keys[tile] += 1;
    setTile(state.player.x, state.player.y, '.');
    setMessage(`Picked up ${keyInfo[tile].name}.`);
    updateHud();
  }

  if (tile === 'E') {
    if (state.kills < state.totalMonsters) {
      setMessage('Exit is sealed by dark magic. Defeat all monster champions first.');
    } else {
      state.won = true;
      state.running = false;
      setStatus('Victory');
      setMessage('You cleared the dungeon and escaped alive.');
    }
  }

  state.attackCooldown -= dt;
  if (state.pressed.attack && state.attackCooldown <= 0) {
    performAttack();
    state.attackCooldown = 0.4;
  }
}

function clearLineOfSight(fromX, fromY, toX, toY, maxDistance) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > maxDistance) {
    return false;
  }

  const steps = Math.ceil(dist * 18);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const x = fromX + dx * t;
    const y = fromY + dy * t;
    const tile = getTile(x, y);
    if (isSolidTile(tile)) {
      return false;
    }
  }

  return true;
}

function performAttack() {
  if (!state.running || state.paused || state.gameOver || state.won) {
    return;
  }

  let hitMonster = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const monster of state.monsters) {
    if (!monster.alive) {
      continue;
    }

    const dx = monster.x - state.player.x;
    const dy = monster.y - state.player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > attackRange || dist >= closestDistance) {
      continue;
    }

    const angle = Math.atan2(dy, dx);
    const diff = normalizeAngle(angle - state.player.dir);

    if (Math.abs(diff) < 0.32 && clearLineOfSight(state.player.x, state.player.y, monster.x, monster.y, attackRange)) {
      closestDistance = dist;
      hitMonster = monster;
    }
  }

  if (!hitMonster) {
    setMessage('Your strike hit only stale air.');
    return;
  }

  const damage = 26 + Math.floor(Math.random() * 9);
  hitMonster.hp -= damage;
  if (hitMonster.hp <= 0) {
    hitMonster.alive = false;
    state.kills += 1;
    setMessage(`You defeated ${hitMonster.name}.`);
    updateHud();
    return;
  }

  setMessage(`Hit ${hitMonster.name} for ${damage} damage.`);
}

function updateMonsters(dt) {
  for (const monster of state.monsters) {
    if (!monster.alive) {
      continue;
    }

    monster.attackCooldown -= dt;

    const dx = state.player.x - monster.x;
    const dy = state.player.y - monster.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (!clearLineOfSight(monster.x, monster.y, state.player.x, state.player.y, 7)) {
      continue;
    }

    if (dist > 0.8) {
      const nx = dx / (dist || 1);
      const ny = dy / (dist || 1);
      const step = monster.speed * dt;
      const nextX = monster.x + nx * step;
      const nextY = monster.y + ny * step;
      if (!isSolidTile(getTile(nextX, nextY))) {
        monster.x = nextX;
        monster.y = nextY;
      }
    } else if (monster.attackCooldown <= 0) {
      state.health -= monster.damage;
      monster.attackCooldown = 1.15;
      if (state.health <= 0) {
        state.health = 0;
        state.gameOver = true;
        state.running = false;
        setStatus('Defeated');
        setMessage('You were overwhelmed in the dark halls.');
      } else {
        setMessage(`${monster.name} strikes for ${monster.damage} damage.`);
      }
      updateHud();
    }
  }
}

function castRay(rayAngle) {
  const sin = Math.sin(rayAngle);
  const cos = Math.cos(rayAngle);
  let distance = 0;
  let hitTile = '#';

  while (distance < maxDepth) {
    distance += 0.02;
    const sampleX = state.player.x + cos * distance;
    const sampleY = state.player.y + sin * distance;
    const tile = getTile(sampleX, sampleY);

    if (isSolidTile(tile)) {
      hitTile = tile;
      break;
    }
  }

  return { distance, tile: hitTile };
}

function wallColorByTile(tile, shade) {
  if (doorInfo[tile]) {
    return shadeColor(doorInfo[tile].color, shade);
  }
  return `rgb(${48 + shade}, ${66 + shade}, ${80 + shade})`;
}

function shadeColor(hex, shade) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgb(${Math.max(0, Math.min(255, r + shade - 62))}, ${Math.max(0, Math.min(255, g + shade - 62))}, ${Math.max(0, Math.min(255, b + shade - 62))})`;
}

function drawWorld() {
  const width = canvas.width;
  const height = canvas.height;

  const sky = ctx.createLinearGradient(0, 0, 0, height * 0.55);
  sky.addColorStop(0, '#2e3f53');
  sky.addColorStop(1, '#0f1620');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height * 0.55);

  const floor = ctx.createLinearGradient(0, height * 0.48, 0, height);
  floor.addColorStop(0, '#22231f');
  floor.addColorStop(1, '#090b0d');
  ctx.fillStyle = floor;
  ctx.fillRect(0, height * 0.48, width, height * 0.52);

  const depthBuffer = new Array(width);

  for (let x = 0; x < width; x += 1) {
    const rayAngle = state.player.dir - fov / 2 + (x / width) * fov;
    const cast = castRay(rayAngle);
    const correctedDistance = cast.distance * Math.cos(rayAngle - state.player.dir);
    const clampedDistance = Math.max(0.001, correctedDistance);
    depthBuffer[x] = clampedDistance;

    const wallHeight = Math.min(height, (height / clampedDistance) * 0.9);
    const wallTop = (height - wallHeight) / 2;
    const shade = Math.max(20, 190 - clampedDistance * 24);
    ctx.fillStyle = wallColorByTile(cast.tile, shade);
    ctx.fillRect(x, wallTop, 1, wallHeight);
  }

  const visibleMonsters = state.monsters
    .filter((m) => m.alive)
    .map((monster) => {
      const dx = monster.x - state.player.x;
      const dy = monster.y - state.player.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const angleToMonster = Math.atan2(dy, dx);
      const relative = normalizeAngle(angleToMonster - state.player.dir);
      return { monster, distance, relative };
    })
    .filter((entry) => Math.abs(entry.relative) < fov * 0.65 && entry.distance < maxDepth)
    .sort((a, b) => b.distance - a.distance);

  for (const entry of visibleMonsters) {
    const spriteHeight = Math.min(height * 0.9, height / entry.distance);
    const spriteWidth = spriteHeight * 0.52;
    const screenX = ((entry.relative + fov / 2) / fov) * width;
    const left = Math.floor(screenX - spriteWidth / 2);
    const top = Math.floor((height - spriteHeight) / 2);

    const start = Math.max(0, left);
    const end = Math.min(width - 1, Math.floor(left + spriteWidth));

    for (let x = start; x <= end; x += 1) {
      if (entry.distance > depthBuffer[x]) {
        continue;
      }
      const fog = Math.max(0.35, 1 - entry.distance / maxDepth);
      ctx.fillStyle = applyFog(entry.monster.color, fog);
      ctx.fillRect(x, top, 1, spriteHeight);
    }

    const hpRatio = Math.max(0, entry.monster.hp / entry.monster.maxHp);
    const hpY = top - 8;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(left, hpY, spriteWidth, 4);
    ctx.fillStyle = hpRatio > 0.4 ? '#4cd46c' : '#e36a6a';
    ctx.fillRect(left, hpY, spriteWidth * hpRatio, 4);
  }

  if (state.showMap) {
    drawMiniMap(12, 12, 180);
  }
}

function applyFog(hex, factor) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const fogColor = { r: 26, g: 30, b: 36 };

  const fr = Math.round(fogColor.r + (r - fogColor.r) * factor);
  const fg = Math.round(fogColor.g + (g - fogColor.g) * factor);
  const fb = Math.round(fogColor.b + (b - fogColor.b) * factor);

  return `rgb(${fr}, ${fg}, ${fb})`;
}

function drawMiniMap(x, y, size) {
  const scale = size / Math.max(state.width, state.height);
  ctx.fillStyle = 'rgba(3, 5, 7, 0.76)';
  ctx.fillRect(x, y, state.width * scale + 8, state.height * scale + 8);

  for (let row = 0; row < state.height; row += 1) {
    for (let col = 0; col < state.width; col += 1) {
      const tile = state.map[row][col];
      let color = '#141922';

      if (tile === '#') {
        color = '#4b5560';
      } else if (doorInfo[tile]) {
        color = doorInfo[tile].color;
      } else if (tile === 'E') {
        color = '#f0de8c';
      } else if (keyInfo[tile]) {
        color = keyInfo[tile].color;
      }

      ctx.fillStyle = color;
      ctx.fillRect(x + 4 + col * scale, y + 4 + row * scale, scale, scale);
    }
  }

  for (const monster of state.monsters) {
    if (!monster.alive) {
      continue;
    }
    ctx.fillStyle = monster.color;
    ctx.fillRect(x + 4 + (monster.x - 0.2) * scale, y + 4 + (monster.y - 0.2) * scale, scale * 0.4, scale * 0.4);
  }

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x + 4 + state.player.x * scale, y + 4 + state.player.y * scale, Math.max(2, scale * 0.25), 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(x + 4 + state.player.x * scale, y + 4 + state.player.y * scale);
  ctx.lineTo(
    x + 4 + (state.player.x + Math.cos(state.player.dir) * 0.8) * scale,
    y + 4 + (state.player.y + Math.sin(state.player.dir) * 0.8) * scale
  );
  ctx.stroke();
}

function normalizeAngle(value) {
  let angle = value;
  while (angle < -Math.PI) {
    angle += Math.PI * 2;
  }
  while (angle > Math.PI) {
    angle -= Math.PI * 2;
  }
  return angle;
}

function renderOverlay() {
  if (!(state.gameOver || state.won || !state.running || state.paused)) {
    return;
  }

  let text = '';
  if (state.won) {
    text = 'VICTORY';
  } else if (state.gameOver) {
    text = 'YOU DIED';
  } else if (state.paused) {
    text = 'PAUSED';
  } else if (!state.running) {
    text = 'PRESS START';
  }

  if (!text) {
    return;
  }

  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f3efe1';
  ctx.font = 'bold 52px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 - 8);
  ctx.font = '16px sans-serif';
  ctx.fillText(state.lastMessage, w / 2, h / 2 + 34);
}

let previousTime = performance.now();

function tick(now) {
  const dt = Math.min(0.035, (now - previousTime) / 1000);
  previousTime = now;

  if (state.running && !state.paused && !state.won && !state.gameOver) {
    updatePlayer(dt);
    updateMonsters(dt);
  }

  drawWorld();
  renderOverlay();
  requestAnimationFrame(tick);
}

function onKeyChange(event, down) {
  const key = event.key.toLowerCase();

  if (key === 'w') {
    state.pressed.forward = down;
  } else if (key === 's') {
    state.pressed.backward = down;
  } else if (key === 'a') {
    state.pressed.left = down;
  } else if (key === 'd') {
    state.pressed.right = down;
  } else if (key === 'q') {
    state.pressed.turnLeft = down;
  } else if (key === 'e') {
    state.pressed.turnRight = down;
  } else if (key === ' ') {
    state.pressed.attack = down;
  } else if (down && key === 'p') {
    togglePause();
  } else if (down && key === 'm') {
    state.showMap = !state.showMap;
  }
}

window.addEventListener('keydown', (event) => {
  onKeyChange(event, true);
});

window.addEventListener('keyup', (event) => {
  onKeyChange(event, false);
});

startBtn.addEventListener('click', startGame);
pauseBtn.addEventListener('click', togglePause);
restartBtn.addEventListener('click', () => {
  resetGame();
  setStatus('Ready');
});

resetGame();
setStatus('Ready');
requestAnimationFrame(tick);
