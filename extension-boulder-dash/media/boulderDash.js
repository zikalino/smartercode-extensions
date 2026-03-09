const app = document.getElementById('app');

app.innerHTML = `
  <div class="toolbar">
    <button id="startBtn" type="button">Start</button>
    <button id="pauseBtn" type="button">Pause</button>
    <button id="resetBtn" type="button">Restart</button>
    <span>Controls: Arrow keys / WASD to move</span>
  </div>
  <div class="stats">
    <span id="status">Status: Ready</span>
    <span id="gems">Gems: 0 / 0</span>
    <span id="moves">Moves: 0</span>
    <span id="time">Time: 0s</span>
  </div>
  <div class="board-wrap">
    <div id="board" class="board"></div>
  </div>
`;

const TILE = {
  EMPTY: ' ',
  WALL: '#',
  DIRT: '.',
  ROCK: 'O',
  GEM: '*',
  EXIT: 'E',
  PLAYER: 'P',
};

const GLYPH = {
  [TILE.EMPTY]: '',
  [TILE.WALL]: '█',
  [TILE.DIRT]: '·',
  [TILE.ROCK]: '●',
  [TILE.GEM]: '◆',
  [TILE.EXIT]: '⇥',
  [TILE.PLAYER]: '☺',
};

const CLASS = {
  [TILE.EMPTY]: 'empty',
  [TILE.WALL]: 'wall',
  [TILE.DIRT]: 'dirt',
  [TILE.ROCK]: 'rock',
  [TILE.GEM]: 'gem',
  [TILE.EXIT]: 'exit',
  [TILE.PLAYER]: 'player',
};

const LEVELS = [
  [
    '############################',
    '#....*...O....*......O....E#',
    '#.####...####...####....####',
    '#....#..............#.......#',
    '#.O..#..***....O....#..O....#',
    '#....#######....#####.......#',
    '#.............P.............#',
    '#....O...***....O...***.....#',
    '#............####............#',
    '#..####..O...........####....#',
    '#..............*.............#',
    '############################',
  ],
  [
    '############################',
    '#P....O....*......O......E.#',
    '#.#######..###..####..######',
    '#....*.........O......*.....#',
    '#..O....####....####....O...#',
    '#.......#..#....#..#........#',
    '#..***..#..#....#..#..***...#',
    '#.......####....####........#',
    '#....O..........O...........#',
    '#..######....*.....######...#',
    '#.................*.........#',
    '############################',
  ],
];

const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');
const statusEl = document.getElementById('status');
const gemsEl = document.getElementById('gems');
const movesEl = document.getElementById('moves');
const timeEl = document.getElementById('time');
const boardEl = document.getElementById('board');

const state = {
  running: false,
  paused: false,
  gameOver: false,
  levelIndex: 0,
  grid: [],
  width: 0,
  height: 0,
  playerX: 0,
  playerY: 0,
  gemsCollected: 0,
  totalGems: 0,
  moves: 0,
  elapsed: 0,
  tickAccumulator: 0,
};

function setStatus(text) {
  statusEl.textContent = `Status: ${text}`;
}

function loadLevel(index) {
  const layout = LEVELS[index % LEVELS.length];
  state.height = layout.length;
  state.width = layout[0].length;
  state.grid = layout.map((row) => row.split(''));
  state.gemsCollected = 0;
  state.totalGems = 0;
  state.moves = 0;
  state.elapsed = 0;
  state.tickAccumulator = 0;

  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      const tile = state.grid[y][x];
      if (tile === TILE.PLAYER) {
        state.playerX = x;
        state.playerY = y;
      }
      if (tile === TILE.GEM) {
        state.totalGems += 1;
      }
    }
  }

  boardEl.style.gridTemplateColumns = `repeat(${state.width}, 24px)`;
  setStatus(`Ready (Level ${state.levelIndex + 1})`);
  render();
}

function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < state.width && y < state.height;
}

function getTile(x, y) {
  if (!inBounds(x, y)) {
    return TILE.WALL;
  }
  return state.grid[y][x];
}

function setTile(x, y, tile) {
  if (inBounds(x, y)) {
    state.grid[y][x] = tile;
  }
}

function canWalkOn(tile) {
  return tile === TILE.EMPTY || tile === TILE.DIRT || tile === TILE.GEM || tile === TILE.EXIT;
}

function movePlayer(dx, dy) {
  if (state.gameOver || !state.running || state.paused) {
    return;
  }

  const fromX = state.playerX;
  const fromY = state.playerY;
  const toX = fromX + dx;
  const toY = fromY + dy;
  const target = getTile(toX, toY);

  if (target === TILE.WALL) {
    return;
  }

  if (target === TILE.ROCK) {
    if (dy !== 0) {
      return;
    }

    const pushX = toX + dx;
    const pushTile = getTile(pushX, toY);
    if (pushTile !== TILE.EMPTY) {
      return;
    }

    setTile(pushX, toY, TILE.ROCK);
    setTile(toX, toY, TILE.PLAYER);
    setTile(fromX, fromY, TILE.EMPTY);
    state.playerX = toX;
    state.playerY = toY;
    state.moves += 1;
    render();
    return;
  }

  if (!canWalkOn(target)) {
    return;
  }

  if (target === TILE.GEM) {
    state.gemsCollected += 1;
  }

  if (target === TILE.EXIT) {
    if (state.gemsCollected < state.totalGems) {
      setStatus('Collect all gems first');
      return;
    }

    state.levelIndex += 1;
    if (state.levelIndex >= LEVELS.length) {
      endGame('You won all levels');
      return;
    }

    loadLevel(state.levelIndex);
    state.running = true;
    state.paused = false;
    setStatus(`Running (Level ${state.levelIndex + 1})`);
    return;
  }

  setTile(toX, toY, TILE.PLAYER);
  setTile(fromX, fromY, TILE.EMPTY);
  state.playerX = toX;
  state.playerY = toY;
  state.moves += 1;
  render();
}

function applyGravityStep() {
  let crushed = false;

  for (let y = state.height - 2; y >= 0; y -= 1) {
    for (let x = 1; x < state.width - 1; x += 1) {
      if (getTile(x, y) !== TILE.ROCK) {
        continue;
      }

      const below = getTile(x, y + 1);
      if (below === TILE.EMPTY) {
        setTile(x, y, TILE.EMPTY);
        if (state.playerX === x && state.playerY === y + 1) {
          crushed = true;
        }
        setTile(x, y + 1, TILE.ROCK);
        continue;
      }

      const belowIsSolid = below === TILE.ROCK || below === TILE.WALL || below === TILE.GEM;
      if (!belowIsSolid) {
        continue;
      }

      const right = getTile(x + 1, y);
      const downRight = getTile(x + 1, y + 1);
      if (right === TILE.EMPTY && downRight === TILE.EMPTY) {
        setTile(x, y, TILE.EMPTY);
        if (state.playerX === x + 1 && state.playerY === y + 1) {
          crushed = true;
        }
        setTile(x + 1, y + 1, TILE.ROCK);
        continue;
      }

      const left = getTile(x - 1, y);
      const downLeft = getTile(x - 1, y + 1);
      if (left === TILE.EMPTY && downLeft === TILE.EMPTY) {
        setTile(x, y, TILE.EMPTY);
        if (state.playerX === x - 1 && state.playerY === y + 1) {
          crushed = true;
        }
        setTile(x - 1, y + 1, TILE.ROCK);
      }
    }
  }

  if (crushed) {
    endGame('Crushed by a boulder');
  }
}

function updateHud() {
  gemsEl.textContent = `Gems: ${state.gemsCollected} / ${state.totalGems}`;
  movesEl.textContent = `Moves: ${state.moves}`;
  timeEl.textContent = `Time: ${Math.floor(state.elapsed)}s`;
}

function render() {
  boardEl.innerHTML = '';

  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      const tile = state.grid[y][x];
      const cell = document.createElement('div');
      cell.className = `cell ${CLASS[tile] || 'empty'}`;
      cell.textContent = GLYPH[tile] || '';
      boardEl.appendChild(cell);
    }
  }

  updateHud();
}

function endGame(reason) {
  state.running = false;
  state.paused = false;
  state.gameOver = true;
  setStatus(`Game Over (${reason})`);
}

function startGame() {
  if (state.gameOver) {
    state.levelIndex = 0;
    loadLevel(0);
    state.gameOver = false;
  }

  state.running = true;
  state.paused = false;
  setStatus(`Running (Level ${state.levelIndex + 1})`);
}

function pauseGame() {
  if (!state.running || state.gameOver) {
    return;
  }

  state.paused = !state.paused;
  setStatus(state.paused ? 'Paused' : `Running (Level ${state.levelIndex + 1})`);
}

function resetGame() {
  state.running = false;
  state.paused = false;
  state.gameOver = false;
  state.levelIndex = 0;
  loadLevel(0);
}

function update(deltaSeconds) {
  if (!state.running || state.paused || state.gameOver) {
    return;
  }

  state.elapsed += deltaSeconds;
  state.tickAccumulator += deltaSeconds;

  const gravityTick = 0.16;
  if (state.tickAccumulator >= gravityTick) {
    state.tickAccumulator = 0;
    applyGravityStep();
    render();
  } else {
    updateHud();
  }
}

function handleKey(event) {
  const key = event.key.toLowerCase();

  if (key === 'arrowleft' || key === 'a') {
    movePlayer(-1, 0);
    event.preventDefault();
    return;
  }

  if (key === 'arrowright' || key === 'd') {
    movePlayer(1, 0);
    event.preventDefault();
    return;
  }

  if (key === 'arrowup' || key === 'w') {
    movePlayer(0, -1);
    event.preventDefault();
    return;
  }

  if (key === 'arrowdown' || key === 's') {
    movePlayer(0, 1);
    event.preventDefault();
    return;
  }

  if (key === 'p') {
    pauseGame();
    event.preventDefault();
  }
}

let previous = performance.now();
function loop(now) {
  const delta = Math.min(0.05, (now - previous) / 1000);
  previous = now;
  update(delta);
  requestAnimationFrame(loop);
}

window.addEventListener('keydown', handleKey);

startBtn.addEventListener('click', startGame);
pauseBtn.addEventListener('click', pauseGame);
resetBtn.addEventListener('click', resetGame);

resetGame();
requestAnimationFrame(loop);
