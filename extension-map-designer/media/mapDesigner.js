const vscode = acquireVsCodeApi();

const TILE_META = {
  empty: { name: 'Empty', glyph: '·' },
  wall: { name: 'Wall', glyph: '█' },
  platform: { name: 'Platform', glyph: '▔' },
  hazard: { name: 'Hazard', glyph: '✹' },
  collectible: { name: 'Collectible', glyph: '◆' },
  spawn: { name: 'Spawn', glyph: '◉' },
  exit: { name: 'Exit', glyph: '⇥' },
};

const BUILTIN_TILE_ORDER = ['empty', 'wall', 'platform', 'hazard', 'collectible', 'spawn', 'exit'];

const CELL = 29;

const state = {
  map: createDefaultMap(),
  activeTile: 'wall',
  tileMeta: { ...TILE_META },
  drawing: false,
  eraser: false,
  playMode: false,
  keys: {
    left: false,
    right: false,
    jump: false,
  },
  player: {
    x: 1,
    y: 1,
    vx: 0,
    vy: 0,
    onGround: false,
    collectibles: 0,
  },
  collectedIndices: new Set(),
  lastFrameTs: 0,
  animationId: 0,
};

const app = document.getElementById('app');
app.innerHTML = `
  <div class="map-designer">
    <header class="toolbar">
      <button class="primary" id="btn-new">New</button>
      <button class="primary" id="btn-save">Save</button>
      <button id="btn-load">Load</button>
      <button id="btn-play">Play</button>
      <button id="btn-eraser">Eraser</button>
      <div class="spacer"></div>
      <span id="mode-text">Edit Mode</span>
    </header>

    <aside class="palette">
      <h3 class="section-title">Tiles</h3>
      <div id="tile-list" class="tile-list"></div>
    </aside>

    <main class="canvas-shell" id="canvas-shell">
      <div id="grid" class="grid"></div>
      <div id="player" class="player" style="display:none">@</div>
      <div id="toast" class="toast"></div>
    </main>

    <aside class="inspector">
      <h3 class="section-title">Map</h3>
      <div class="field">
        <label for="map-title">Title</label>
        <input id="map-title" type="text" />
      </div>
      <div class="field">
        <label for="map-width">Width</label>
        <input id="map-width" type="number" min="8" max="120" step="1" />
      </div>
      <div class="field">
        <label for="map-height">Height</label>
        <input id="map-height" type="number" min="6" max="80" step="1" />
      </div>
      <button id="btn-resize">Resize Grid</button>
    </aside>

    <footer class="status">
      <span id="status-text">Paint tiles to design your level.</span>
      <span class="help">Play controls: Arrow keys or A/D to move, W/Space to jump.</span>
    </footer>
  </div>
`;

const elements = {
  tileList: document.getElementById('tile-list'),
  grid: document.getElementById('grid'),
  canvas: document.getElementById('canvas-shell'),
  player: document.getElementById('player'),
  modeText: document.getElementById('mode-text'),
  statusText: document.getElementById('status-text'),
  playButton: document.getElementById('btn-play'),
  eraserButton: document.getElementById('btn-eraser'),
  titleInput: document.getElementById('map-title'),
  widthInput: document.getElementById('map-width'),
  heightInput: document.getElementById('map-height'),
  toast: document.getElementById('toast'),
};

renderTilePalette();
wireToolbar();
wireInspector();
wireKeyboard();
renderGrid();
updateInspector();

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message.type !== 'string') {
    return;
  }

  if (message.type === 'setTileAssets' && Array.isArray(message.payload)) {
    applyTileAssets(message.payload);
    return;
  }

  if (message.type === 'loadMapData' && isValidMap(message.payload)) {
    state.map = normalizeMap(message.payload);
    stopPlayMode();
    renderGrid();
    updateInspector();
    showToast('Map loaded');
  }
});

vscode.postMessage({ type: 'ready' });

function createDefaultMap() {
  const width = 32;
  const height = 18;
  const tiles = new Array(width * height).fill('empty');

  for (let x = 0; x < width; x += 1) {
    tiles[(height - 1) * width + x] = 'wall';
  }

  for (let x = 6; x < 13; x += 1) {
    tiles[12 * width + x] = 'platform';
  }

  for (let x = 16; x < 24; x += 1) {
    tiles[9 * width + x] = 'platform';
  }

  tiles[(height - 2) * width + 2] = 'spawn';
  tiles[(height - 2) * width + (width - 3)] = 'exit';
  tiles[(height - 2) * width + 10] = 'hazard';
  tiles[8 * width + 20] = 'collectible';

  return {
    version: 1,
    title: 'New Platform Map',
    width,
    height,
    tiles,
  };
}

function renderTilePalette() {
  elements.tileList.innerHTML = '';

  getPaletteEntries().forEach(([tile, meta]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tile-button${state.activeTile === tile ? ' active' : ''}`;
    button.dataset.tile = tile;
    button.innerHTML = `
      <span class="tile-glyph">${meta.glyph}</span>
      <span class="tile-name">${meta.name}</span>
    `;

    const glyph = button.querySelector('.tile-glyph');
    applyTileImage(glyph, meta.imageUri);

    button.addEventListener('click', () => {
      state.activeTile = tile;
      state.eraser = false;
      elements.eraserButton.classList.remove('active');
      renderTilePalette();
      renderStatus();
    });

    elements.tileList.appendChild(button);
  });
}

function wireToolbar() {
  document.getElementById('btn-new').addEventListener('click', () => {
    state.map = createDefaultMap();
    stopPlayMode();
    renderGrid();
    updateInspector();
    renderStatus();
    showToast('New map created');
  });

  document.getElementById('btn-save').addEventListener('click', () => {
    vscode.postMessage({ type: 'saveMap', payload: state.map });
    showToast('Saving map');
  });

  document.getElementById('btn-load').addEventListener('click', () => {
    vscode.postMessage({ type: 'loadMap' });
  });

  elements.playButton.addEventListener('click', () => {
    if (state.playMode) {
      stopPlayMode();
      showToast('Back to edit mode');
      return;
    }

    const spawnIndex = state.map.tiles.findIndex((tile) => tile === 'spawn');
    if (spawnIndex < 0) {
      showToast('Add a Spawn tile to play');
      return;
    }

    startPlayMode(spawnIndex);
    showToast('Play mode started');
  });

  elements.eraserButton.addEventListener('click', () => {
    state.eraser = !state.eraser;
    elements.eraserButton.classList.toggle('active', state.eraser);
    renderStatus();
  });
}

function wireInspector() {
  elements.titleInput.addEventListener('input', () => {
    state.map.title = elements.titleInput.value;
  });

  document.getElementById('btn-resize').addEventListener('click', () => {
    const width = clamp(Math.round(Number(elements.widthInput.value) || 0), 8, 120);
    const height = clamp(Math.round(Number(elements.heightInput.value) || 0), 6, 80);
    resizeMap(width, height);
    updateInspector();
    renderGrid();
    renderStatus();
    showToast(`Grid resized to ${width}×${height}`);
  });
}

function wireKeyboard() {
  window.addEventListener('keydown', (event) => {
    if (!state.playMode) {
      return;
    }

    if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') {
      state.keys.left = true;
      event.preventDefault();
    }
    if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') {
      state.keys.right = true;
      event.preventDefault();
    }
    if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w' || event.key === ' ') {
      state.keys.jump = true;
      event.preventDefault();
    }
  });

  window.addEventListener('keyup', (event) => {
    if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') {
      state.keys.left = false;
    }
    if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') {
      state.keys.right = false;
    }
    if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w' || event.key === ' ') {
      state.keys.jump = false;
    }
  });
}

function renderGrid() {
  elements.grid.style.setProperty('--grid-width', String(state.map.width));
  elements.grid.style.setProperty('--grid-height', String(state.map.height));
  elements.grid.innerHTML = '';

  state.map.tiles.forEach((tile, index) => {
    const cell = document.createElement('div');
    cell.className = `cell tile-${tile}`;
    cell.dataset.index = String(index);
    applyCellVisual(cell, tile);

    cell.addEventListener('mousedown', (event) => {
      if (state.playMode) {
        return;
      }
      state.drawing = event.button === 0;
      paintCell(index);
    });

    cell.addEventListener('mouseenter', () => {
      if (!state.playMode) {
        cell.classList.add('edit-hover');
      }
      if (state.drawing && !state.playMode) {
        paintCell(index);
      }
    });

    cell.addEventListener('mouseleave', () => {
      cell.classList.remove('edit-hover');
    });

    elements.grid.appendChild(cell);
  });

  window.onmouseup = () => {
    state.drawing = false;
  };

  renderStatus();
}

function paintCell(index) {
  const current = state.map.tiles[index];
  const next = state.eraser ? 'empty' : state.activeTile;

  if (current === next) {
    return;
  }

  if (next === 'spawn') {
    clearUniqueTile('spawn');
  }
  if (next === 'exit') {
    clearUniqueTile('exit');
  }

  state.map.tiles[index] = next;

  const cell = elements.grid.children[index];
  if (cell) {
    cell.className = `cell tile-${next}`;
    applyCellVisual(cell, next);
  }

  renderStatus();
}

function clearUniqueTile(tileType) {
  const existing = state.map.tiles.findIndex((tile) => tile === tileType);
  if (existing >= 0) {
    state.map.tiles[existing] = 'empty';
    const cell = elements.grid.children[existing];
    if (cell) {
      cell.className = 'cell tile-empty';
      applyCellVisual(cell, 'empty');
    }
  }
}

function resizeMap(newWidth, newHeight) {
  const oldWidth = state.map.width;
  const oldHeight = state.map.height;
  const oldTiles = state.map.tiles.slice();
  const nextTiles = new Array(newWidth * newHeight).fill('empty');

  const copyWidth = Math.min(oldWidth, newWidth);
  const copyHeight = Math.min(oldHeight, newHeight);

  for (let y = 0; y < copyHeight; y += 1) {
    for (let x = 0; x < copyWidth; x += 1) {
      nextTiles[y * newWidth + x] = oldTiles[y * oldWidth + x];
    }
  }

  state.map.width = newWidth;
  state.map.height = newHeight;
  state.map.tiles = nextTiles;
}

function updateInspector() {
  elements.titleInput.value = state.map.title;
  elements.widthInput.value = String(state.map.width);
  elements.heightInput.value = String(state.map.height);
}

function renderStatus() {
  if (state.playMode) {
    const totalCollectibles = countTiles('collectible');
    elements.statusText.textContent = `Play mode · Collected ${state.player.collectibles}/${totalCollectibles}`;
    return;
  }

  const tool = state.eraser ? 'Eraser' : `Tile: ${getTileMeta(state.activeTile).name}`;
  elements.statusText.textContent = `Edit mode · ${tool} · ${state.map.width}×${state.map.height}`;
}

function startPlayMode(spawnIndex) {
  state.playMode = true;
  state.collectedIndices = new Set();
  state.player.collectibles = 0;
  state.keys.left = false;
  state.keys.right = false;
  state.keys.jump = false;

  const spawn = indexToCoord(spawnIndex);
  state.player.x = spawn.x + 0.2;
  state.player.y = spawn.y + 0.1;
  state.player.vx = 0;
  state.player.vy = 0;
  state.player.onGround = false;

  elements.playButton.classList.add('active');
  elements.modeText.textContent = 'Play Mode';
  elements.player.style.display = 'grid';
  elements.grid.style.cursor = 'default';

  state.lastFrameTs = performance.now();
  state.animationId = requestAnimationFrame(gameLoop);
  renderStatus();
}

function stopPlayMode() {
  state.playMode = false;
  cancelAnimationFrame(state.animationId);
  state.animationId = 0;
  elements.playButton.classList.remove('active');
  elements.modeText.textContent = 'Edit Mode';
  elements.player.style.display = 'none';
  renderGrid();
  renderStatus();
}

function gameLoop(timestamp) {
  if (!state.playMode) {
    return;
  }

  const dt = Math.min((timestamp - state.lastFrameTs) / 1000, 0.033);
  state.lastFrameTs = timestamp;

  const walkSpeed = 7.8;
  const gravity = 28;
  const jumpVelocity = -11;

  if (state.keys.left && !state.keys.right) {
    state.player.vx = -walkSpeed;
  } else if (state.keys.right && !state.keys.left) {
    state.player.vx = walkSpeed;
  } else {
    state.player.vx = 0;
  }

  if (state.keys.jump && state.player.onGround) {
    state.player.vy = jumpVelocity;
    state.player.onGround = false;
  }

  state.player.vy += gravity * dt;

  movePlayerX(state.player.vx * dt);
  movePlayerY(state.player.vy * dt);

  handleInteractiveTiles();
  drawPlayer();
  renderStatus();

  state.animationId = requestAnimationFrame(gameLoop);
}

function movePlayerX(dx) {
  if (dx === 0) {
    return;
  }

  const sign = Math.sign(dx);
  let remaining = Math.abs(dx);

  while (remaining > 0) {
    const step = Math.min(remaining, 0.08) * sign;
    const nextX = state.player.x + step;

    if (isPlayerColliding(nextX, state.player.y)) {
      state.player.vx = 0;
      return;
    }

    state.player.x = nextX;
    remaining -= Math.abs(step);
  }
}

function movePlayerY(dy) {
  if (dy === 0) {
    state.player.onGround = isPlayerColliding(state.player.x, state.player.y + 0.04);
    return;
  }

  const sign = Math.sign(dy);
  let remaining = Math.abs(dy);
  state.player.onGround = false;

  while (remaining > 0) {
    const step = Math.min(remaining, 0.08) * sign;
    const nextY = state.player.y + step;

    if (isPlayerColliding(state.player.x, nextY)) {
      if (sign > 0) {
        state.player.onGround = true;
      }
      state.player.vy = 0;
      return;
    }

    state.player.y = nextY;
    remaining -= Math.abs(step);
  }
}

function isPlayerColliding(px, py) {
  const bounds = {
    left: px,
    right: px + 0.75,
    top: py,
    bottom: py + 0.9,
  };

  const minX = Math.floor(bounds.left);
  const maxX = Math.floor(bounds.right);
  const minY = Math.floor(bounds.top);
  const maxY = Math.floor(bounds.bottom);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) {
        return true;
      }

      const tile = state.map.tiles[coordToIndex(x, y)];
      if (tile === 'wall' || tile === 'platform') {
        return true;
      }
    }
  }

  return false;
}

function handleInteractiveTiles() {
  const centerX = Math.floor(state.player.x + 0.37);
  const centerY = Math.floor(state.player.y + 0.45);

  if (!isInside(centerX, centerY)) {
    return;
  }

  const index = coordToIndex(centerX, centerY);
  const tile = state.map.tiles[index];

  if (tile === 'hazard') {
    const spawnIndex = state.map.tiles.findIndex((candidate) => candidate === 'spawn');
    if (spawnIndex >= 0) {
      const spawn = indexToCoord(spawnIndex);
      state.player.x = spawn.x + 0.2;
      state.player.y = spawn.y + 0.1;
      state.player.vx = 0;
      state.player.vy = 0;
      showToast('Hit hazard, respawned');
    }
  }

  if (tile === 'collectible' && !state.collectedIndices.has(index)) {
    state.collectedIndices.add(index);
    state.player.collectibles += 1;
    updateCellVisual(index, 'empty');
    showToast('Collectible acquired');
  }

  if (tile === 'exit') {
    const totalCollectibles = countTiles('collectible');
    if (state.player.collectibles >= totalCollectibles) {
      showToast('Level complete!');
      stopPlayMode();
    } else {
      showToast('Collect all items before exiting');
    }
  }
}

function drawPlayer() {
  elements.player.style.left = `${Math.round(state.player.x * CELL + 3)}px`;
  elements.player.style.top = `${Math.round(state.player.y * CELL + 3)}px`;
}

function updateCellVisual(index, tile) {
  const cell = elements.grid.children[index];
  if (!cell) {
    return;
  }

  cell.className = `cell tile-${tile}`;
  applyCellVisual(cell, tile);
}

function countTiles(tileType) {
  return state.map.tiles.reduce((count, tile) => count + (tile === tileType ? 1 : 0), 0);
}

function coordToIndex(x, y) {
  return y * state.map.width + x;
}

function indexToCoord(index) {
  return {
    x: index % state.map.width,
    y: Math.floor(index / state.map.width),
  };
}

function isInside(x, y) {
  return x >= 0 && y >= 0 && x < state.map.width && y < state.map.height;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeMap(input) {
  const width = Number(input.width) || 32;
  const height = Number(input.height) || 18;
  const tiles = Array.isArray(input.tiles) ? input.tiles.slice(0, width * height) : [];

  while (tiles.length < width * height) {
    tiles.push('empty');
  }

  return {
    version: 1,
    title: String(input.title || 'Loaded Map'),
    width,
    height,
    tiles: tiles.map((tile) => {
      const candidate = String(tile || '').trim();
      return getTileMeta(candidate) ? candidate : 'empty';
    }),
  };
}

function getPaletteEntries() {
  const orderedBuiltins = BUILTIN_TILE_ORDER
    .filter((tileId) => state.tileMeta[tileId])
    .map((tileId) => [tileId, state.tileMeta[tileId]]);

  const customEntries = Object.keys(state.tileMeta)
    .filter((tileId) => !BUILTIN_TILE_ORDER.includes(tileId))
    .sort((a, b) => a.localeCompare(b))
    .map((tileId) => [tileId, state.tileMeta[tileId]]);

  return orderedBuiltins.concat(customEntries);
}

function getTileMeta(tileId) {
  return state.tileMeta[tileId] || state.tileMeta.empty;
}

function applyCellVisual(cell, tile) {
  const meta = getTileMeta(tile);
  cell.textContent = meta.glyph || '';
  applyTileImage(cell, meta.imageUri);
}

function applyTileImage(element, imageUri) {
  if (!element) {
    return;
  }

  if (imageUri) {
    element.classList.add('has-image');
    element.style.setProperty('--tile-image', `url("${imageUri}")`);
    return;
  }

  element.classList.remove('has-image');
  element.style.removeProperty('--tile-image');
}

function applyTileAssets(assets) {
  for (const asset of assets) {
    if (!asset || typeof asset !== 'object') {
      continue;
    }

    const tileId = String(asset.id || '').trim().toLowerCase();
    const imageUri = String(asset.imageUri || '').trim();
    if (!tileId || !imageUri) {
      continue;
    }

    if (!state.tileMeta[tileId]) {
      state.tileMeta[tileId] = {
        name: String(asset.name || humanizeTileName(tileId)),
        glyph: tileId.charAt(0).toUpperCase(),
      };
    }

    state.tileMeta[tileId] = {
      ...state.tileMeta[tileId],
      name: String(asset.name || state.tileMeta[tileId].name),
      imageUri,
    };
  }

  renderTilePalette();
  renderGrid();
  renderStatus();
}

function humanizeTileName(tileId) {
  return tileId
    .split(/[-_]/g)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function isValidMap(input) {
  return input
    && typeof input === 'object'
    && input.version === 1
    && Number.isInteger(input.width)
    && Number.isInteger(input.height)
    && Array.isArray(input.tiles);
}

function showToast(text) {
  elements.toast.textContent = text;
  elements.toast.classList.add('show');
  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    elements.toast.classList.remove('show');
  }, 1400);
}

showToast.timeoutId = 0;
