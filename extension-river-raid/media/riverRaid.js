const app = document.getElementById('app');

app.innerHTML = `
  <div class="toolbar">
    <button id="startBtn" type="button">Start</button>
    <button id="pauseBtn" type="button">Pause</button>
    <button id="resetBtn" type="button">Restart</button>
    <span>Controls: ← → or A D to steer, Space to fire, P to pause</span>
  </div>
  <div class="stats">
    <span id="score">Score: 0</span>
    <span id="fuel">Fuel: 100</span>
    <span id="speed">Speed: 1.0x</span>
    <span id="status">Status: Ready</span>
  </div>
  <div class="canvas-wrap">
    <canvas id="gameCanvas" width="420" height="680"></canvas>
  </div>
`;

const scoreLabel = document.getElementById('score');
const fuelLabel = document.getElementById('fuel');
const speedLabel = document.getElementById('speed');
const statusLabel = document.getElementById('status');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');

const canvas = document.getElementById('gameCanvas');
const context = canvas.getContext('2d');

if (!context) {
  throw new Error('2D canvas context is not available.');
}

const world = {
  width: canvas.width,
  height: canvas.height,
  scroll: 0,
  speed: 100,
  maxSpeed: 270,
  acceleration: 0.06,
};

const state = {
  running: false,
  paused: false,
  gameOver: false,
  score: 0,
  fuel: 100,
  bestScore: Number(localStorage.getItem('riverRaidBest') || 0),
  riverCenter: world.width / 2,
  riverHalfWidth: 120,
  player: {
    x: world.width / 2,
    y: world.height - 80,
    width: 24,
    height: 36,
    vx: 0,
  },
  bullets: [],
  enemies: [],
  fuels: [],
  explosions: [],
  keys: {
    left: false,
    right: false,
    fire: false,
  },
  fireCooldown: 0,
  spawnCooldown: 0,
  fuelSpawnCooldown: 0,
};

function resetGame() {
  state.running = false;
  state.paused = false;
  state.gameOver = false;
  state.score = 0;
  state.fuel = 100;
  world.scroll = 0;
  world.speed = 100;
  state.riverCenter = world.width / 2;
  state.riverHalfWidth = 120;
  state.player.x = world.width / 2;
  state.player.vx = 0;
  state.bullets.length = 0;
  state.enemies.length = 0;
  state.fuels.length = 0;
  state.explosions.length = 0;
  state.fireCooldown = 0;
  state.spawnCooldown = 0.6;
  state.fuelSpawnCooldown = 3.2;
  setStatus('Ready');
  updateHud();
}

function startGame() {
  if (state.gameOver) {
    resetGame();
  }

  state.running = true;
  state.paused = false;
  setStatus('Running');
}

function pauseGame() {
  if (!state.running || state.gameOver) {
    return;
  }

  state.paused = !state.paused;
  setStatus(state.paused ? 'Paused' : 'Running');
}

function setStatus(text) {
  statusLabel.textContent = `Status: ${text}`;
}

function updateHud() {
  scoreLabel.textContent = `Score: ${Math.floor(state.score)}`;
  fuelLabel.textContent = `Fuel: ${Math.max(0, Math.floor(state.fuel))}`;
  speedLabel.textContent = `Speed: ${(world.speed / 100).toFixed(1)}x | Best: ${state.bestScore}`;
}

function spawnEnemy() {
  const lane = (Math.random() * 2 - 1) * (state.riverHalfWidth - 20);
  const type = Math.random() < 0.35 ? 'bridge' : 'plane';

  if (type === 'bridge') {
    const bridgeWidth = state.riverHalfWidth * 2 - 20;
    state.enemies.push({
      type,
      x: state.riverCenter,
      y: -16,
      width: bridgeWidth,
      height: 18,
      hp: 1,
      score: 45,
    });
    return;
  }

  state.enemies.push({
    type,
    x: state.riverCenter + lane,
    y: -24,
    width: 22,
    height: 26,
    hp: 1,
    score: 25,
  });
}

function spawnFuel() {
  const lane = (Math.random() * 2 - 1) * (state.riverHalfWidth - 18);
  state.fuels.push({
    x: state.riverCenter + lane,
    y: -24,
    width: 18,
    height: 24,
  });
}

function shootBullet() {
  state.bullets.push({
    x: state.player.x,
    y: state.player.y - 16,
    vy: -420,
    width: 3,
    height: 10,
  });
}

function updateRiver(dt) {
  world.scroll += world.speed * dt;
  const centerNoise = Math.sin(world.scroll * 0.004) * 40 + Math.sin(world.scroll * 0.0018) * 55;
  const widthNoise = Math.sin(world.scroll * 0.0025) * 22;

  state.riverCenter = world.width / 2 + centerNoise;
  state.riverHalfWidth = 100 + widthNoise;
}

function updatePlayer(dt) {
  const accel = 520;
  const drag = 0.84;

  if (state.keys.left) {
    state.player.vx -= accel * dt;
  }
  if (state.keys.right) {
    state.player.vx += accel * dt;
  }

  state.player.vx *= drag;
  state.player.x += state.player.vx * dt;

  const leftBank = state.riverCenter - state.riverHalfWidth + state.player.width / 2;
  const rightBank = state.riverCenter + state.riverHalfWidth - state.player.width / 2;

  if (state.player.x < leftBank || state.player.x > rightBank) {
    endGame('Crashed into river bank');
  }

  state.player.x = Math.max(leftBank, Math.min(rightBank, state.player.x));

  state.fireCooldown -= dt;
  if (state.keys.fire && state.fireCooldown <= 0) {
    shootBullet();
    state.fireCooldown = 0.15;
  }
}

function updateEntities(dt) {
  const scrollSpeed = world.speed;

  state.spawnCooldown -= dt;
  if (state.spawnCooldown <= 0) {
    spawnEnemy();
    state.spawnCooldown = Math.max(0.38, 1.15 - world.speed / 300);
  }

  state.fuelSpawnCooldown -= dt;
  if (state.fuelSpawnCooldown <= 0) {
    spawnFuel();
    state.fuelSpawnCooldown = 6.5;
  }

  for (const bullet of state.bullets) {
    bullet.y += bullet.vy * dt;
  }

  for (const enemy of state.enemies) {
    enemy.y += scrollSpeed * dt;
  }

  for (const fuel of state.fuels) {
    fuel.y += scrollSpeed * dt;
  }

  for (const blast of state.explosions) {
    blast.life -= dt;
  }

  state.bullets = state.bullets.filter((b) => b.y + b.height > -20);
  state.enemies = state.enemies.filter((e) => e.y - e.height < world.height + 40);
  state.fuels = state.fuels.filter((f) => f.y - f.height < world.height + 40);
  state.explosions = state.explosions.filter((e) => e.life > 0);
}

function overlaps(a, b) {
  return (
    Math.abs(a.x - b.x) * 2 < a.width + b.width
    && Math.abs(a.y - b.y) * 2 < a.height + b.height
  );
}

function handleCollisions() {
  const playerBox = {
    x: state.player.x,
    y: state.player.y,
    width: state.player.width,
    height: state.player.height,
  };

  for (const enemy of state.enemies) {
    if (overlaps(playerBox, enemy)) {
      endGame(enemy.type === 'bridge' ? 'Hit a bridge' : 'Hit an enemy plane');
      return;
    }
  }

  for (const fuel of state.fuels) {
    if (overlaps(playerBox, fuel)) {
      state.fuel = Math.min(100, state.fuel + 35);
      fuel.y = world.height + 200;
      state.score += 20;
    }
  }

  for (const bullet of state.bullets) {
    for (const enemy of state.enemies) {
      if (!overlaps(bullet, enemy)) {
        continue;
      }

      enemy.hp -= 1;
      bullet.y = -100;
      if (enemy.hp <= 0) {
        state.score += enemy.score;
        state.explosions.push({ x: enemy.x, y: enemy.y, life: 0.32, size: Math.max(18, enemy.width / 2) });
        enemy.y = world.height + 200;
      }
    }
  }
}

function updateGame(dt) {
  if (!state.running || state.paused || state.gameOver) {
    return;
  }

  world.speed = Math.min(world.maxSpeed, world.speed + world.acceleration);
  state.score += dt * 8 + (world.speed - 100) * 0.02;
  state.fuel -= dt * (4.2 + world.speed / 80);

  if (state.fuel <= 0) {
    state.fuel = 0;
    endGame('Out of fuel');
    return;
  }

  updateRiver(dt);
  updatePlayer(dt);
  updateEntities(dt);
  handleCollisions();
  updateHud();
}

function drawRiver() {
  context.fillStyle = '#2a2d34';
  context.fillRect(0, 0, world.width, world.height);

  const segmentHeight = 34;
  for (let y = -segmentHeight; y < world.height + segmentHeight; y += segmentHeight) {
    const sample = y + world.scroll;
    const center = world.width / 2 + Math.sin(sample * 0.004) * 40 + Math.sin(sample * 0.0018) * 55;
    const half = 100 + Math.sin(sample * 0.0025) * 22;

    context.fillStyle = '#0a213a';
    context.fillRect(center - half, y, half * 2, segmentHeight + 1);

    context.fillStyle = '#1360b0';
    context.fillRect(center - half + 3, y + 3, half * 2 - 6, segmentHeight - 6);
  }
}

function drawPlayer() {
  const { x, y, width, height } = state.player;
  context.save();
  context.translate(x, y);
  context.fillStyle = '#f2f2f2';
  context.beginPath();
  context.moveTo(0, -height / 2);
  context.lineTo(width / 2, height / 2);
  context.lineTo(0, height / 3);
  context.lineTo(-width / 2, height / 2);
  context.closePath();
  context.fill();

  context.fillStyle = '#ff6f3d';
  context.beginPath();
  context.moveTo(0, -height / 2 + 8);
  context.lineTo(5, -height / 2 + 18);
  context.lineTo(-5, -height / 2 + 18);
  context.closePath();
  context.fill();
  context.restore();
}

function drawBullets() {
  context.fillStyle = '#ffe082';
  for (const bullet of state.bullets) {
    context.fillRect(bullet.x - bullet.width / 2, bullet.y - bullet.height / 2, bullet.width, bullet.height);
  }
}

function drawEnemies() {
  for (const enemy of state.enemies) {
    if (enemy.type === 'bridge') {
      context.fillStyle = '#7a4e2d';
      context.fillRect(enemy.x - enemy.width / 2, enemy.y - enemy.height / 2, enemy.width, enemy.height);
      context.fillStyle = '#5a3a21';
      context.fillRect(enemy.x - enemy.width / 2, enemy.y - 2, enemy.width, 4);
      continue;
    }

    context.save();
    context.translate(enemy.x, enemy.y);
    context.fillStyle = '#f24b4b';
    context.beginPath();
    context.moveTo(0, -enemy.height / 2);
    context.lineTo(enemy.width / 2, enemy.height / 2);
    context.lineTo(0, enemy.height / 4);
    context.lineTo(-enemy.width / 2, enemy.height / 2);
    context.closePath();
    context.fill();
    context.restore();
  }
}

function drawFuel() {
  for (const fuel of state.fuels) {
    context.fillStyle = '#79d95e';
    context.fillRect(fuel.x - fuel.width / 2, fuel.y - fuel.height / 2, fuel.width, fuel.height);
    context.fillStyle = '#1f2f1a';
    context.fillRect(fuel.x - 3, fuel.y - 6, 6, 12);
  }
}

function drawExplosions() {
  for (const blast of state.explosions) {
    const alpha = Math.max(0, blast.life / 0.32);
    context.globalAlpha = alpha;
    context.fillStyle = '#ffb347';
    context.beginPath();
    context.arc(blast.x, blast.y, blast.size * (1 - alpha * 0.5), 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
  }
}

function drawOverlay() {
  if (!state.gameOver) {
    return;
  }

  context.fillStyle = 'rgba(0, 0, 0, 0.5)';
  context.fillRect(0, 0, world.width, world.height);

  context.fillStyle = '#ffffff';
  context.font = 'bold 28px sans-serif';
  context.textAlign = 'center';
  context.fillText('Game Over', world.width / 2, world.height / 2 - 18);

  context.font = '16px sans-serif';
  context.fillText(`Score: ${Math.floor(state.score)}`, world.width / 2, world.height / 2 + 10);
  context.fillText('Press Start to play again', world.width / 2, world.height / 2 + 36);
}

function render() {
  drawRiver();
  drawFuel();
  drawEnemies();
  drawBullets();
  drawPlayer();
  drawExplosions();
  drawOverlay();
}

function endGame(reason) {
  if (state.gameOver) {
    return;
  }

  state.gameOver = true;
  state.running = false;
  state.paused = false;
  state.bestScore = Math.max(state.bestScore, Math.floor(state.score));
  localStorage.setItem('riverRaidBest', String(state.bestScore));
  setStatus(`Game Over (${reason})`);
  updateHud();
}

let previous = performance.now();
function loop(now) {
  const delta = Math.min(0.05, (now - previous) / 1000);
  previous = now;

  updateGame(delta);
  render();
  requestAnimationFrame(loop);
}

function setKeyState(event, value) {
  const key = event.key.toLowerCase();
  if (key === 'arrowleft' || key === 'a') {
    state.keys.left = value;
    event.preventDefault();
  }

  if (key === 'arrowright' || key === 'd') {
    state.keys.right = value;
    event.preventDefault();
  }

  if (key === ' ') {
    state.keys.fire = value;
    event.preventDefault();
  }

  if (value && key === 'p') {
    pauseGame();
  }
}

window.addEventListener('keydown', (event) => {
  setKeyState(event, true);
});

window.addEventListener('keyup', (event) => {
  setKeyState(event, false);
});

startBtn.addEventListener('click', () => {
  startGame();
});

pauseBtn.addEventListener('click', () => {
  pauseGame();
});

resetBtn.addEventListener('click', () => {
  resetGame();
});

resetGame();
requestAnimationFrame(loop);
