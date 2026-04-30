const GENE_LABELS = {
  bodyColor: 'Body Color',
  accentColor: 'Accent Color',
  shape: 'Shape Profile',
  bodyRadius: 'Body Radius',
  bodyVariance: 'Body Variance',
  bodyLobes: 'Body Lobes',
  bodyPinch: 'Body Pinch',
  shapeSeed: 'Shape Seed',
  interiorPalette: 'Interior Palette',
  interiorStyle: 'Interior Style',
  interiorSpread: 'Interior Spread',
  interiorScale: 'Interior Scale',
  interiorSeed: 'Interior Seed',
  interiorNodeEyes: 'Interior Node Eyes',
  fimbriaeSeed: 'Fimbriae Seed',
  organType: 'Organ Type',
  organSeed: 'Organ Seed',
  eyes: 'Eyes',
  eyeShape: 'Eye Shape',
  eyeSize: 'Eye Size',
  eyeColor: 'Eye Color',
  eyePreset: 'Eye Preset',
  limbs: 'Limbs',
  horns: 'Horns'
};

const GENE_KEYS = Object.keys(GENE_LABELS);

const OPTIONS = {
  bodyColor: ['#3FA7D6', '#FD7E14', '#8BC34A', '#7E57C2', '#EF476F', '#00A896', '#4D908E', '#577590'],
  accentColor: ['#F9C74F', '#FF6B6B', '#4CC9F0', '#90BE6D', '#F3722C', '#43AA8B', '#E5989B'],
  shape: ['organic', 'spiky', 'flat', 'wavy'],
  bodyRadius: [40, 46, 52, 58],
  bodyVariance: [5, 8, 11, 14],
  bodyLobes: [1, 2, 3, 4, 5, 6],
  bodyPinch: [-0.22, -0.1, 0, 0.1, 0.22],
  shapeSeed: [11, 23, 37, 51, 79, 97, 113],
  interiorPalette: ['dual', 'warm', 'cool', 'neon', 'mono'],
  interiorStyle: ['dots', 'orbs', 'shards', 'cells'],
  interiorSpread: [0.5, 0.65, 0.8, 0.92],
  interiorScale: [0.8, 1, 1.2, 1.45],
  interiorSeed: [13, 29, 47, 71, 89, 131],
  interiorNodeEyes: ['rare', 'mixed', 'dense'],
  fimbriaeSeed: [7, 17, 31, 53, 67, 83],
  organType: ['eye', 'leg', 'wing', 'claw'],
  organSeed: [5, 19, 41, 59, 73, 101],
  eyes: [1, 2, 3, 4],
  eyeShape: ['round', 'ellipse'],
  eyeSize: ['small', 'medium', 'large'],
  eyeColor: ['#1D3557', '#2A9D8F', '#8D99AE', '#6A4C93', '#E76F51', '#F4A261'],
  eyePreset: ['cute', 'angry', 'sleepy', 'alien'],
  limbs: [2, 4, 6, 8],
  horns: [0, 1, 2, 3]
};

const state = {
  monsters: [],
  parentA: {},
  parentB: {},
  child: null,
  game: {
    runners: [],
    scientist: null,
    running: false,
    rafId: 0,
    escaped: 0,
    caught: 0,
    lastTime: 0
  }
};

const refs = {
  pool: document.getElementById('monster-pool'),
  parentA: document.getElementById('parent-a-slots'),
  parentB: document.getElementById('parent-b-slots'),
  parentACard: document.getElementById('parent-a-card'),
  parentBCard: document.getElementById('parent-b-card'),
  childCard: document.getElementById('child-card'),
  rerollBtn: document.getElementById('reroll-btn'),
  breedBtn: document.getElementById('breed-btn'),
  escapeArena: document.getElementById('escape-arena'),
  escapeStatus: document.getElementById('escape-status'),
  escapeStartBtn: document.getElementById('escape-start-btn')
};

function randomFrom(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function titleFrom(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

function defaultGeneValue(geneKey, salt) {
  const options = OPTIONS[geneKey] ?? [];
  if (options.length === 0) {
    return undefined;
  }

  let hash = 0;
  const token = `${geneKey}:${salt}`;
  for (let i = 0; i < token.length; i += 1) {
    hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
  }

  return options[Math.abs(hash) % options.length];
}

function synthesizeGenes(partialGenes, salt = 0) {
  const genes = {};
  for (const geneKey of GENE_KEYS) {
    if (partialGenes[geneKey] !== undefined) {
      genes[geneKey] = partialGenes[geneKey];
    } else {
      genes[geneKey] = defaultGeneValue(geneKey, salt);
    }
  }
  return genes;
}

function createMonster(index) {
  return {
    id: `monster-${Date.now()}-${index}-${Math.floor(Math.random() * 10000)}`,
    name: `Specimen ${index + 1}`,
    genes: {
      bodyColor: randomFrom(OPTIONS.bodyColor),
      accentColor: randomFrom(OPTIONS.accentColor),
      shape: randomFrom(OPTIONS.shape),
      bodyRadius: randomFrom(OPTIONS.bodyRadius),
      bodyVariance: randomFrom(OPTIONS.bodyVariance),
      bodyLobes: randomFrom(OPTIONS.bodyLobes),
      bodyPinch: randomFrom(OPTIONS.bodyPinch),
      shapeSeed: randomFrom(OPTIONS.shapeSeed),
      interiorPalette: randomFrom(OPTIONS.interiorPalette),
      interiorStyle: randomFrom(OPTIONS.interiorStyle),
      interiorSpread: randomFrom(OPTIONS.interiorSpread),
      interiorScale: randomFrom(OPTIONS.interiorScale),
      interiorSeed: randomFrom(OPTIONS.interiorSeed),
      interiorNodeEyes: randomFrom(OPTIONS.interiorNodeEyes),
      fimbriaeSeed: randomFrom(OPTIONS.fimbriaeSeed),
      organType: randomFrom(OPTIONS.organType),
      organSeed: randomFrom(OPTIONS.organSeed),
      eyes: randomFrom(OPTIONS.eyes),
      eyeShape: randomFrom(OPTIONS.eyeShape),
      eyeSize: randomFrom(OPTIONS.eyeSize),
      eyeColor: randomFrom(OPTIONS.eyeColor),
      eyePreset: randomFrom(OPTIONS.eyePreset),
      limbs: randomFrom(OPTIONS.limbs),
      horns: randomFrom(OPTIONS.horns)
    }
  };
}

function generateMonsters() {
  state.monsters = Array.from({ length: 8 }, (_, idx) => createMonster(idx));
}

function createGeneSlot(parentKey, geneKey) {
  const wrapper = document.createElement('div');
  wrapper.className = 'gene-slot';
  wrapper.dataset.parent = parentKey;
  wrapper.dataset.gene = geneKey;

  const label = document.createElement('span');
  label.className = 'slot-label';
  label.textContent = GENE_LABELS[geneKey];

  const value = document.createElement('span');
  value.className = 'slot-value';
  value.textContent = titleFrom(state[parentKey][geneKey] ?? 'drop gene');

  wrapper.appendChild(label);
  wrapper.appendChild(value);

  wrapper.addEventListener('dragover', (event) => {
    event.preventDefault();
    wrapper.classList.add('drag-over');
  });

  wrapper.addEventListener('dragleave', () => {
    wrapper.classList.remove('drag-over');
  });

  wrapper.addEventListener('drop', (event) => {
    event.preventDefault();
    wrapper.classList.remove('drag-over');
    const payload = event.dataTransfer?.getData('application/json');
    if (!payload) {
      return;
    }

    const gene = JSON.parse(payload);
    if (gene.geneKey !== geneKey) {
      return;
    }

    state[parentKey][geneKey] = gene.geneValue;
    renderParentSlots();
    autoBreedPreview();
  });

  return wrapper;
}

function renderParentSlots() {
  refs.parentA.innerHTML = '';
  refs.parentB.innerHTML = '';

  for (const geneKey of GENE_KEYS) {
    refs.parentA.appendChild(createGeneSlot('parentA', geneKey));
    refs.parentB.appendChild(createGeneSlot('parentB', geneKey));
  }

  renderParentPreviews();
}

function renderParentPreview(parentKey, cardRef, label, salt) {
  const assigned = state[parentKey];
  const assignedCount = Object.keys(assigned).length;

  if (assignedCount === 0) {
    cardRef.classList.add('empty');
    cardRef.innerHTML = '<div class="monster-name">No parent genes yet</div>';
    return;
  }

  cardRef.classList.remove('empty');
  cardRef.innerHTML = '';

  const genes = synthesizeGenes(assigned, salt);
  const name = document.createElement('div');
  name.className = 'monster-name';
  name.textContent = `${label} (${assignedCount}/${GENE_KEYS.length})`;

  const viz = document.createElement('div');
  viz.className = 'monster-viz';
  viz.style.cssText = monsterVizStyle(genes.bodyColor);
  viz.innerHTML = monsterSvg(genes);

  const notes = document.createElement('div');
  notes.className = 'gene-chip-list';
  const shortGenes = ['shape', 'interiorStyle', 'eyePreset'].map((key) => `${GENE_LABELS[key]}: ${titleFrom(genes[key])}`);
  notes.innerHTML = shortGenes.map((text) => `<span class="gene-chip">${text}</span>`).join('');

  cardRef.appendChild(name);
  cardRef.appendChild(viz);
  cardRef.appendChild(notes);
}

function renderParentPreviews() {
  renderParentPreview('parentA', refs.parentACard, 'Parent A', 17);
  renderParentPreview('parentB', refs.parentBCard, 'Parent B', 61);
}

function monsterVizStyle(bodyColor) {
  return `background: linear-gradient(150deg, #fff6e8, ${bodyColor}22);`;
}

function stableNoise(index, seed) {
  const value = Math.sin((index + 1) * 12.9898 + seed * 78.233) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

function hexToRgb(hex) {
  const normalized = String(hex).replace('#', '');
  const full = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized;

  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16)
  };
}

function rgbToHex(r, g, b) {
  const toHex = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function mixHexColor(colorA, colorB, ratio) {
  const t = Math.max(0, Math.min(1, ratio));
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);

  return rgbToHex(
    a.r + (b.r - a.r) * t,
    a.g + (b.g - a.g) * t,
    a.b + (b.b - a.b) * t
  );
}

function hashGenes(genes) {
  let hash = 0;
  for (const key of GENE_KEYS) {
    const token = `${key}:${String(genes[key] ?? '')}|`;
    for (let i = 0; i < token.length; i += 1) {
      hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
    }
  }
  return Math.abs(hash);
}

function interiorPaletteColors(genes) {
  const palettes = {
    dual: [genes.bodyColor, genes.accentColor, '#ffffff'],
    warm: ['#ff9f6e', '#ffd166', '#e76f51'],
    cool: ['#5ec2f0', '#6c8ef5', '#8bd3dd'],
    neon: ['#9cff57', '#00f5d4', '#f15bb5'],
    mono: ['#edf2f4', '#adb5bd', '#6c757d']
  };

  return palettes[genes.interiorPalette] ?? palettes.dual;
}

function buildInteriorPoints(genes, bodyPoints, pointCount = 64) {
  const cx = 90;
  const cy = 52;
  const seed = Number(genes.interiorSeed ?? 29);
  const spread = Number(genes.interiorSpread ?? 0.75);
  const sizeScale = Number(genes.interiorScale ?? 1);
  const palette = interiorPaletteColors(genes);
  const eyeMode = genes.interiorNodeEyes ?? 'mixed';
  const eyeProfile = {
    rare: { small: 0.12, big: 0.03 },
    mixed: { small: 0.22, big: 0.1 },
    dense: { small: 0.32, big: 0.18 }
  }[eyeMode] ?? { small: 0.22, big: 0.1 };
  const interiorPoints = [];

  for (let i = 0; i < pointCount; i += 1) {
    const unitAngle = (stableNoise(i + 211, seed) + 1) / 2;
    const angle = unitAngle * Math.PI * 2;
    const bodyIndex = Math.floor((unitAngle * bodyPoints.length) % bodyPoints.length);
    const shell = bodyPoints[bodyIndex] ?? { distance: 42 };
    const radialRatio = 0.08 + ((stableNoise(i + 307, seed) + 1) / 2) * spread;
    const distance = Math.max(shell.distance * radialRatio, 3);

    const x = cx + Math.cos(angle) * distance;
    const y = cy + Math.sin(angle) * distance * (1 - Number(genes.bodyPinch ?? 0) * 0.25);

    const baseSize = (1.2 + ((stableNoise(i + 401, seed) + 1) / 2) * 3.8) * sizeScale;
    const ovality = 1 + stableNoise(i + 503, seed) * 0.45;
    const alpha = 0.24 + ((stableNoise(i + 607, seed) + 1) / 2) * 0.56;
    const tone = (stableNoise(i + 709, seed) + 1) / 2;
    const colorA = palette[Math.floor(tone * palette.length) % palette.length];
    const colorB = palette[(Math.floor(tone * palette.length) + 1) % palette.length];
    const color = mixHexColor(colorA, colorB, tone % 1);
    const rotation = stableNoise(i + 811, seed) * 38;
    const eyeRoll = (stableNoise(i + 907, seed) + 1) / 2;
    const nodeEye = eyeRoll < eyeProfile.big
      ? 'big'
      : eyeRoll < eyeProfile.big + eyeProfile.small
        ? 'small'
        : 'none';
    const nodeEyeColor = mixHexColor(color, genes.eyeColor, 0.68);

    interiorPoints.push({
      x,
      y,
      distance,
      size: baseSize,
      rx: Math.max(baseSize * ovality, 0.8),
      ry: Math.max(baseSize / Math.max(ovality, 0.35), 0.8),
      alpha,
      color,
      rotation,
      nodeEye,
      nodeEyeColor
    });
  }

  return interiorPoints;
}

function interiorEyeOverlay(point) {
  if (point.nodeEye === 'none') {
    return '';
  }

  const scale = point.nodeEye === 'big' ? 0.62 : 0.42;
  const scleraRx = Math.max(point.rx * scale, 0.9);
  const scleraRy = Math.max(point.ry * scale * 0.9, 0.75);
  const irisRx = Math.max(scleraRx * 0.48, 0.5);
  const irisRy = Math.max(scleraRy * 0.48, 0.5);
  const pupil = Math.max(Math.min(irisRx, irisRy) * 0.45, 0.35);
  const gloss = Math.max(pupil * 0.35, 0.2);

  return `<g>
    <ellipse cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" rx="${scleraRx.toFixed(2)}" ry="${scleraRy.toFixed(2)}" fill="#fdfdfd" fill-opacity="0.96" />
    <ellipse cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" rx="${irisRx.toFixed(2)}" ry="${irisRy.toFixed(2)}" fill="${point.nodeEyeColor}" fill-opacity="0.95" />
    <circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${pupil.toFixed(2)}" fill="#131313" />
    <circle cx="${(point.x - pupil * 0.35).toFixed(2)}" cy="${(point.y - pupil * 0.35).toFixed(2)}" r="${gloss.toFixed(2)}" fill="#ffffff" fill-opacity="0.7" />
  </g>`;
}

function interiorPointSvg(point, style) {
  const eyeOverlay = interiorEyeOverlay(point);

  if (style === 'shards') {
    return `<g><ellipse cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" rx="${(point.rx * 1.05).toFixed(2)}" ry="${(point.ry * 0.55).toFixed(2)}" fill="${point.color}" fill-opacity="${point.alpha.toFixed(2)}" transform="rotate(${point.rotation.toFixed(2)} ${point.x.toFixed(2)} ${point.y.toFixed(2)})" />${eyeOverlay}</g>`;
  }

  if (style === 'cells') {
    return `<g><circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${(point.size * 0.72).toFixed(2)}" fill="${point.color}" fill-opacity="${(point.alpha * 0.7).toFixed(2)}" stroke="#ffffff" stroke-opacity="0.45" stroke-width="0.55" />${eyeOverlay}</g>`;
  }

  if (style === 'orbs') {
    return `<g><circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${(point.size * 0.85).toFixed(2)}" fill="${point.color}" fill-opacity="${(point.alpha * 0.64).toFixed(2)}" /><circle cx="${(point.x - point.size * 0.24).toFixed(2)}" cy="${(point.y - point.size * 0.24).toFixed(2)}" r="${(point.size * 0.24).toFixed(2)}" fill="#ffffff" fill-opacity="0.35" />${eyeOverlay}</g>`;
  }

  return `<g><circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${(point.size * 0.62).toFixed(2)}" fill="${point.color}" fill-opacity="${point.alpha.toFixed(2)}" />${eyeOverlay}</g>`;
}

function buildBodyPoints(genes, pointCount = 64) {
  const cx = 90;
  const cy = 52;
  const baseRadius = Number(genes.bodyRadius ?? 50);
  const variance = Number(genes.bodyVariance ?? 10);
  const lobes = Number(genes.bodyLobes ?? 3);
  const pinch = Number(genes.bodyPinch ?? 0);
  const seed = Number(genes.shapeSeed ?? 37);
  const profile = genes.shape ?? 'organic';

  const profileParams = {
    organic: { harmonicMul: 0.9, jaggedMul: 0.25, yStretch: 1.0, xStretch: 1.0 },
    spiky: { harmonicMul: 1.5, jaggedMul: 0.7, yStretch: 0.98, xStretch: 1.0 },
    flat: { harmonicMul: 0.55, jaggedMul: 0.2, yStretch: 0.78, xStretch: 1.08 },
    wavy: { harmonicMul: 1.1, jaggedMul: 0.35, yStretch: 1.06, xStretch: 0.96 }
  }[profile] ?? { harmonicMul: 0.9, jaggedMul: 0.25, yStretch: 1.0, xStretch: 1.0 };

  const points = [];
  for (let i = 0; i < pointCount; i += 1) {
    const t = i / pointCount;
    const angle = t * Math.PI * 2;

    const harmonic = Math.sin(angle * lobes + seed * 0.03) * variance * profileParams.harmonicMul;
    const secondary = Math.cos(angle * (lobes + 2) - seed * 0.02) * variance * 0.38;
    const localNoise = stableNoise(i, seed) * variance * profileParams.jaggedMul;

    // Per-point data model: distance is primary, but each point also carries local variation and edge weight.
    const distance = Math.max(baseRadius + harmonic + secondary + localNoise, 20);
    const edgeWeight = 1 + stableNoise(i + 97, seed) * 0.18;
    const radialBias = 1 + pinch * Math.cos(angle * 2 + seed * 0.01);

    const x = cx + Math.cos(angle) * distance * radialBias * profileParams.xStretch;
    const y = cy + Math.sin(angle) * distance * (1 - pinch * 0.45) * profileParams.yStretch;

    // Boundary gene expression values (0-1): fimbriae threshold 0.5, organ threshold 0.9
    const fimbriaeSeed = Number(genes.fimbriaeSeed ?? 17);
    const organSeed = Number(genes.organSeed ?? 41);
    const fimbriaValue = (stableNoise(i + 1013, fimbriaeSeed) + 1) / 2;
    const organValue = (stableNoise(i + 1117, organSeed) + 1) / 2;

    points.push({ x, y, distance, localNoise, edgeWeight, angle, fimbriaValue, organValue });
  }

  return points;
}

function renderFimbriae(point, genes) {
  const count = 3 + Math.floor((point.fimbriaValue - 0.5) * 8);
  const hairLength = 3.5 + (point.fimbriaValue - 0.5) * 10;
  const parts = [];
  for (let j = 0; j < count; j += 1) {
    const spread = count > 1 ? (j / (count - 1) - 0.5) * 0.55 : 0;
    const a = point.angle + spread;
    const x2 = (point.x + Math.cos(a) * hairLength).toFixed(2);
    const y2 = (point.y + Math.sin(a) * hairLength).toFixed(2);
    parts.push(`<line x1="${point.x.toFixed(2)}" y1="${point.y.toFixed(2)}" x2="${x2}" y2="${y2}" stroke="${genes.accentColor}" stroke-width="0.75" stroke-linecap="round" opacity="0.78" />`);
  }
  return parts.join('');
}

function renderOrgan(point, organType, genes) {
  const a = point.angle;
  const reach = 7;
  const ox = (point.x + Math.cos(a) * reach).toFixed(2);
  const oy = (point.y + Math.sin(a) * reach).toFixed(2);
  if (organType === 'eye') {
    return `<circle cx="${ox}" cy="${oy}" r="3.5" fill="#fff" /><circle cx="${ox}" cy="${oy}" r="2" fill="${genes.eyeColor}" /><circle cx="${ox}" cy="${oy}" r="1" fill="#111" />`;
  }
  if (organType === 'leg') {
    const tipX = (point.x + Math.cos(a) * (reach + 6)).toFixed(2);
    const tipY = (point.y + Math.sin(a) * (reach + 6)).toFixed(2);
    return `<line x1="${point.x.toFixed(2)}" y1="${point.y.toFixed(2)}" x2="${tipX}" y2="${tipY}" stroke="${genes.accentColor}" stroke-width="2.2" stroke-linecap="round" />`;
  }
  if (organType === 'wing') {
    const wx1 = (point.x + Math.cos(a - 0.7) * (reach + 9)).toFixed(2);
    const wy1 = (point.y + Math.sin(a - 0.7) * (reach + 9)).toFixed(2);
    const wx2 = (point.x + Math.cos(a + 0.7) * (reach + 9)).toFixed(2);
    const wy2 = (point.y + Math.sin(a + 0.7) * (reach + 9)).toFixed(2);
    return `<path d="M ${point.x.toFixed(2)} ${point.y.toFixed(2)} Q ${ox} ${oy} ${wx1} ${wy1}" fill="none" stroke="${genes.accentColor}" stroke-width="1.2" opacity="0.7" /><path d="M ${point.x.toFixed(2)} ${point.y.toFixed(2)} Q ${ox} ${oy} ${wx2} ${wy2}" fill="none" stroke="${genes.accentColor}" stroke-width="1.2" opacity="0.7" />`;
  }
  if (organType === 'claw') {
    const cx1 = (point.x + Math.cos(a - 0.35) * (reach + 5)).toFixed(2);
    const cy1 = (point.y + Math.sin(a - 0.35) * (reach + 5)).toFixed(2);
    const cx2 = (point.x + Math.cos(a + 0.35) * (reach + 5)).toFixed(2);
    const cy2 = (point.y + Math.sin(a + 0.35) * (reach + 5)).toFixed(2);
    return `<line x1="${point.x.toFixed(2)}" y1="${point.y.toFixed(2)}" x2="${cx1}" y2="${cy1}" stroke="${genes.accentColor}" stroke-width="1.8" stroke-linecap="round" /><line x1="${point.x.toFixed(2)}" y1="${point.y.toFixed(2)}" x2="${cx2}" y2="${cy2}" stroke="${genes.accentColor}" stroke-width="1.8" stroke-linecap="round" />`;
  }
  return '';
}

function buildBoundaryExtras(genes, bodyPoints) {
  const organType = genes.organType ?? 'eye';
  const parts = [];
  for (const point of bodyPoints) {
    if (point.fimbriaValue > 0.5) { parts.push(renderFimbriae(point, genes)); }
    if (point.organValue > 0.9)   { parts.push(renderOrgan(point, organType, genes)); }
  }
  return parts.join('');
}

function bodyPathFromPoints(points) {
  if (!points.length) {
    return '';
  }

  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length; i += 1) {
    path += ` L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
  }
  path += ' Z';
  return path;
}

function monsterSvg(genes) {
  const width = 180;
  const height = 96;
  const eyeCount = Number(genes.eyes);
  const limbCount = Number(genes.limbs);
  const hornCount = Number(genes.horns);
  const eyeShape = genes.eyeShape === 'ellipse' ? 'ellipse' : 'round';
  const eyePreset = genes.eyePreset ?? 'cute';

  const eyeScale = {
    small: { rx: 5, ry: 4, pupil: 2 },
    medium: { rx: 7, ry: 6, pupil: 3 },
    large: { rx: 9, ry: 7, pupil: 4 }
  }[genes.eyeSize] ?? { rx: 7, ry: 6, pupil: 3 };

  const eyePresetStyle = {
    cute: { pupilDx: 0, pupilDy: 0.2, lidTop: 0, lidBottom: 0, browTilt: 0, irisRxMult: 1, irisRyMult: 1, eyeSpacing: 24 },
    angry: { pupilDx: 0, pupilDy: -0.35, lidTop: 0.22, lidBottom: 0, browTilt: 6, irisRxMult: 1, irisRyMult: 1, eyeSpacing: 24 },
    sleepy: { pupilDx: -0.08, pupilDy: 0.3, lidTop: 0.38, lidBottom: 0.12, browTilt: 0, irisRxMult: 1, irisRyMult: 1, eyeSpacing: 24 },
    alien: { pupilDx: 0, pupilDy: 0, lidTop: 0.08, lidBottom: 0, browTilt: 0, irisRxMult: 0.55, irisRyMult: 1.6, eyeSpacing: 28 }
  }[eyePreset] ?? { pupilDx: 0, pupilDy: 0, lidTop: 0, lidBottom: 0, browTilt: 0, irisRxMult: 1, irisRyMult: 1, eyeSpacing: 24 };

  const bodyPoints = buildBodyPoints(genes, 64);
  const bodyPath = bodyPathFromPoints(bodyPoints);
  const strokeWeight = (bodyPoints.reduce((sum, point) => sum + point.edgeWeight, 0) / Math.max(bodyPoints.length, 1)) * 2.3;
  const interiorPoints = buildInteriorPoints(genes, bodyPoints, 64);
  const interiorStyle = genes.interiorStyle ?? 'dots';
  const boundaryExtras = buildBoundaryExtras(genes, bodyPoints);
  const uid = `m${hashGenes(genes).toString(36)}`;
  const clipId = `body-clip-${uid}`;

  const eyes = [];
  const eyeVertical = eyeShape === 'ellipse' ? eyeScale.ry : eyeScale.rx;
  const eyeHorizontal = eyeScale.rx;
  const eyeGap = eyePresetStyle.eyeSpacing;
  for (let i = 0; i < eyeCount; i += 1) {
    const x = 90 - ((eyeCount - 1) * eyeGap) / 2 + i * eyeGap;
    const y = 50;
    const irisRx = Math.max((eyeScale.pupil - 0.8) * eyePresetStyle.irisRxMult, 1.1);
    const irisRy = Math.max((eyeScale.pupil - 1.2) * eyePresetStyle.irisRyMult, 1);
    const pupilDx = eyePresetStyle.pupilDx * eyeHorizontal;
    const pupilDy = eyePresetStyle.pupilDy * eyeVertical;
    const topLidHeight = eyeVertical * 2 * eyePresetStyle.lidTop;
    const bottomLidHeight = eyeVertical * 2 * eyePresetStyle.lidBottom;
    const left = x - eyeHorizontal - 1;
    const widthPx = eyeHorizontal * 2 + 2;

    const irisEllipse = `<ellipse cx="${x + pupilDx}" cy="${y + pupilDy}" rx="${irisRx}" ry="${irisRy}" fill="${genes.eyeColor}" />`;
    const pupilShape = eyePreset === 'alien'
      ? `<ellipse cx="${x + pupilDx}" cy="${y + pupilDy}" rx="${Math.max(irisRx * 0.35, 0.7)}" ry="${Math.max(irisRy * 0.88, 1)}" fill="#141414" />`
      : `<circle cx="${x + pupilDx}" cy="${y + pupilDy}" r="${Math.max(eyeScale.pupil - 1.7, 0.8)}" fill="#141414" />`;

    const topLid = topLidHeight > 0
      ? `<rect x="${left}" y="${y - eyeVertical - 1}" width="${widthPx}" height="${topLidHeight}" fill="${genes.bodyColor}" fill-opacity="0.92" />`
      : '';

    const bottomLid = bottomLidHeight > 0
      ? `<rect x="${left}" y="${y + eyeVertical - bottomLidHeight + 1}" width="${widthPx}" height="${bottomLidHeight}" fill="${genes.bodyColor}" fill-opacity="0.9" />`
      : '';

    const brow = eyePresetStyle.browTilt !== 0
      ? `<line x1="${x - eyeHorizontal - 3}" y1="${y - eyeVertical - 4}" x2="${x + eyeHorizontal + 3}" y2="${y - eyeVertical - 4 + (i % 2 === 0 ? eyePresetStyle.browTilt : -eyePresetStyle.browTilt)}" stroke="${genes.accentColor}" stroke-width="2.2" stroke-linecap="round" />`
      : '';

    if (eyeShape === 'ellipse') {
      eyes.push(`<ellipse cx="${x}" cy="${y}" rx="${eyeScale.rx}" ry="${eyeScale.ry}" fill="#fff" />${irisEllipse}${pupilShape}${topLid}${bottomLid}${brow}`);
    } else {
      eyes.push(`<circle cx="${x}" cy="${y}" r="${eyeScale.rx}" fill="#fff" />${irisEllipse}${pupilShape}${topLid}${bottomLid}${brow}`);
    }
  }

  const limbs = [];
  for (let i = 0; i < limbCount; i += 1) {
    const x = 24 + i * ((132) / Math.max(limbCount - 1, 1));
    const y2 = i % 2 === 0 ? 93 : 88;
    limbs.push(`<line x1="${x}" y1="82" x2="${x}" y2="${y2}" stroke="${genes.accentColor}" stroke-width="4" stroke-linecap="round" />`);
  }

  const horns = [];
  for (let i = 0; i < hornCount; i += 1) {
    const x = 90 - (hornCount - 1) * 11 + i * 22;
    horns.push(`<polygon points="${x - 5},20 ${x},4 ${x + 5},20" fill="${genes.accentColor}" />`);
  }

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="monster">
      <defs>
        <clipPath id="${clipId}">
          <path d="${bodyPath}" />
        </clipPath>
      </defs>
      ${boundaryExtras}
      ${limbs.join('')}
      <path d="${bodyPath}" fill="${genes.bodyColor}" stroke="${genes.accentColor}" stroke-width="${strokeWeight.toFixed(2)}" stroke-linejoin="round" />
      <g clip-path="url(#${clipId})">
        ${interiorPoints.map((point) => interiorPointSvg(point, interiorStyle)).join('')}
      </g>
      ${horns.join('')}
      ${eyes.join('')}
    </svg>
  `;
}

function geneChip(monsterId, geneKey, geneValue) {
  const chip = document.createElement('span');
  chip.className = 'gene-chip';
  chip.draggable = true;
  chip.textContent = `${GENE_LABELS[geneKey]}: ${titleFrom(geneValue)}`;
  chip.addEventListener('dragstart', (event) => {
    const payload = JSON.stringify({ monsterId, geneKey, geneValue });
    event.dataTransfer?.setData('application/json', payload);
    event.dataTransfer?.setData('text/plain', `${geneKey}:${geneValue}`);
  });
  return chip;
}

function scientistSvg() {
  return `
    <svg viewBox="0 0 60 60" role="img" aria-label="scientist">
      <circle cx="30" cy="17" r="10" fill="#f5d4b3" stroke="#2a2a2a" stroke-width="1.5" />
      <path d="M 15 56 L 45 56 L 42 29 L 18 29 Z" fill="#ebf4ff" stroke="#3d4e61" stroke-width="1.5" />
      <line x1="21" y1="12" x2="13" y2="8" stroke="#3f3f3f" stroke-width="3" stroke-linecap="round" />
      <line x1="39" y1="12" x2="47" y2="8" stroke="#3f3f3f" stroke-width="3" stroke-linecap="round" />
      <circle cx="26" cy="16" r="1.2" fill="#1d1d1d" />
      <circle cx="34" cy="16" r="1.2" fill="#1d1d1d" />
      <path d="M 25 22 Q 30 25 35 22" fill="none" stroke="#91534f" stroke-width="1.4" />
      <rect x="23" y="32" width="14" height="10" fill="#d5e7f9" stroke="#7f9eb6" stroke-width="1" />
    </svg>
  `;
}

function stopEscapeLoop() {
  if (state.game.rafId) {
    cancelAnimationFrame(state.game.rafId);
    state.game.rafId = 0;
  }
  state.game.running = false;
}

function clearArena() {
  if (refs.escapeArena) {
    refs.escapeArena.innerHTML = '';
  }
}

function randomEdgeTarget(width, height) {
  const side = Math.floor(Math.random() * 4);
  const pad = 10;
  if (side === 0) {
    return { x: pad, y: 28 + Math.random() * (height - 56) };
  }
  if (side === 1) {
    return { x: width - pad, y: 28 + Math.random() * (height - 56) };
  }
  if (side === 2) {
    return { x: 28 + Math.random() * (width - 56), y: pad };
  }
  return { x: 28 + Math.random() * (width - 56), y: height - pad };
}

function setupEscapeScene() {
  if (!refs.escapeArena || !refs.escapeStatus || !refs.escapeStartBtn) {
    return;
  }

  stopEscapeLoop();
  clearArena();

  const width = refs.escapeArena.clientWidth;
  const height = refs.escapeArena.clientHeight;
  const runnerCount = Math.min(state.monsters.length, 6);
  const sampled = state.monsters.slice(0, runnerCount);
  const runners = [];

  for (let i = 0; i < sampled.length; i += 1) {
    const monster = sampled[i];
    const token = document.createElement('div');
    token.className = 'runner-token';
    token.innerHTML = monsterSvg(monster.genes);
    refs.escapeArena.appendChild(token);

    const x = width * 0.32 + Math.random() * width * 0.36;
    const y = height * 0.3 + Math.random() * height * 0.4;
    const target = randomEdgeTarget(width, height);
    const speed = 42 + Number(monster.genes.bodyVariance ?? 8) * 2.2;

    runners.push({
      token,
      monster,
      x,
      y,
      vx: 0,
      vy: 0,
      target,
      speed,
      alive: true
    });
  }

  const scientistToken = document.createElement('div');
  scientistToken.className = 'scientist-token';
  scientistToken.innerHTML = scientistSvg();
  refs.escapeArena.appendChild(scientistToken);

  state.game.runners = runners;
  state.game.scientist = {
    token: scientistToken,
    x: width / 2,
    y: height / 2,
    speed: 84
  };
  state.game.escaped = 0;
  state.game.caught = 0;
  state.game.lastTime = 0;

  refs.escapeStatus.textContent = 'Scene prepared: monsters are ready to run.';
  refs.escapeStartBtn.textContent = 'Start Escape Run';

  for (const runner of runners) {
    runner.token.style.transform = `translate(${runner.x.toFixed(1)}px, ${runner.y.toFixed(1)}px)`;
  }
  state.game.scientist.token.style.transform = `translate(${state.game.scientist.x.toFixed(1)}px, ${state.game.scientist.y.toFixed(1)}px)`;
}

function stepEscape(now) {
  if (!state.game.running || !refs.escapeArena || !refs.escapeStatus || !refs.escapeStartBtn || !state.game.scientist) {
    return;
  }

  if (!state.game.lastTime) {
    state.game.lastTime = now;
  }
  const dt = Math.min((now - state.game.lastTime) / 1000, 0.05);
  state.game.lastTime = now;

  const width = refs.escapeArena.clientWidth;
  const height = refs.escapeArena.clientHeight;
  const scientist = state.game.scientist;
  const activeRunners = state.game.runners.filter((runner) => runner.alive);

  for (const runner of activeRunners) {
    const dx = runner.target.x - runner.x;
    const dy = runner.target.y - runner.y;
    const dist = Math.hypot(dx, dy) || 1;

    runner.vx = (dx / dist) * runner.speed;
    runner.vy = (dy / dist) * runner.speed;
    runner.x += runner.vx * dt;
    runner.y += runner.vy * dt;

    if (dist < 12) {
      runner.alive = false;
      runner.token.remove();
      state.game.escaped += 1;
      continue;
    }

    runner.x = Math.max(2, Math.min(width - 2, runner.x));
    runner.y = Math.max(2, Math.min(height - 2, runner.y));
    runner.token.style.transform = `translate(${runner.x.toFixed(1)}px, ${runner.y.toFixed(1)}px)`;
  }

  const survivors = state.game.runners.filter((runner) => runner.alive);
  if (survivors.length > 0) {
    let nearest = survivors[0];
    let nearestDist = Infinity;
    for (const runner of survivors) {
      const d = Math.hypot(runner.x - scientist.x, runner.y - scientist.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = runner;
      }
    }

    const chaseDx = nearest.x - scientist.x;
    const chaseDy = nearest.y - scientist.y;
    const chaseDist = Math.hypot(chaseDx, chaseDy) || 1;
    scientist.x += (chaseDx / chaseDist) * scientist.speed * dt;
    scientist.y += (chaseDy / chaseDist) * scientist.speed * dt;

    scientist.x = Math.max(12, Math.min(width - 12, scientist.x));
    scientist.y = Math.max(12, Math.min(height - 12, scientist.y));

    for (const runner of survivors) {
      if (!runner.alive) {
        continue;
      }
      const d = Math.hypot(runner.x - scientist.x, runner.y - scientist.y);
      if (d < 24) {
        runner.alive = false;
        runner.token.remove();
        state.game.caught += 1;
      }
    }
  }

  scientist.token.style.transform = `translate(${scientist.x.toFixed(1)}px, ${scientist.y.toFixed(1)}px)`;

  const remaining = state.game.runners.filter((runner) => runner.alive).length;
  refs.escapeStatus.textContent = `Escaped: ${state.game.escaped} | Caught: ${state.game.caught} | Remaining: ${remaining}`;

  if (remaining === 0) {
    stopEscapeLoop();
    refs.escapeStartBtn.textContent = 'Restart Escape Run';
    refs.escapeStatus.textContent = `Run complete. Escaped: ${state.game.escaped} | Caught: ${state.game.caught}`;
    return;
  }

  state.game.rafId = requestAnimationFrame(stepEscape);
}

function startEscapeRun() {
  if (!refs.escapeArena || !refs.escapeStatus || !refs.escapeStartBtn) {
    return;
  }

  if (state.game.running) {
    stopEscapeLoop();
    refs.escapeStartBtn.textContent = 'Resume Escape Run';
    refs.escapeStatus.textContent = 'Simulation paused.';
    return;
  }

  if (state.game.runners.length === 0 || state.game.runners.every((runner) => !runner.alive)) {
    setupEscapeScene();
  }

  state.game.running = true;
  state.game.lastTime = 0;
  refs.escapeStartBtn.textContent = 'Pause Escape Run';
  refs.escapeStatus.textContent = 'Scientist in pursuit.';
  state.game.rafId = requestAnimationFrame(stepEscape);
}

function setParentFromMonster(parentKey, monster) {
  state[parentKey] = { ...monster.genes };
  renderParentSlots();
  autoBreedPreview();
}

function monsterCard(monster) {
  const card = document.createElement('article');
  card.className = 'monster-card';

  const name = document.createElement('div');
  name.className = 'monster-name';
  name.textContent = monster.name;

  const viz = document.createElement('div');
  viz.className = 'monster-viz';
  viz.style.cssText = monsterVizStyle(monster.genes.bodyColor);
  viz.innerHTML = monsterSvg(monster.genes);

  const chips = document.createElement('div');
  chips.className = 'gene-chip-list';
  for (const key of GENE_KEYS) {
    chips.appendChild(geneChip(monster.id, key, monster.genes[key]));
  }

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const useA = document.createElement('button');
  useA.textContent = 'Use as Parent A';
  useA.className = 'parent-a';
  useA.addEventListener('click', () => {
    setParentFromMonster('parentA', monster);
  });

  const useB = document.createElement('button');
  useB.textContent = 'Use as Parent B';
  useB.className = 'parent-b';
  useB.addEventListener('click', () => {
    setParentFromMonster('parentB', monster);
  });

  actions.appendChild(useA);
  actions.appendChild(useB);

  card.appendChild(name);
  card.appendChild(viz);
  card.appendChild(chips);
  card.appendChild(actions);
  return card;
}

function renderMonsterPool() {
  refs.pool.innerHTML = '';
  for (const monster of state.monsters) {
    refs.pool.appendChild(monsterCard(monster));
  }
}

function combineGenes() {
  const genes = {};
  for (const key of GENE_KEYS) {
    const aValue = state.parentA[key];
    const bValue = state.parentB[key];

    if (aValue !== undefined && bValue !== undefined) {
      genes[key] = Math.random() > 0.5 ? aValue : bValue;
    } else if (aValue !== undefined) {
      genes[key] = aValue;
    } else if (bValue !== undefined) {
      genes[key] = bValue;
    } else {
      genes[key] = randomFrom(OPTIONS[key]);
    }

    // Small mutation chance to keep the playground surprising.
    if (Math.random() < 0.06) {
      genes[key] = randomFrom(OPTIONS[key]);
    }
  }

  return {
    id: `child-${Date.now()}`,
    name: `Hybrid ${Math.floor(Math.random() * 900 + 100)}`,
    genes
  };
}

function renderChild() {
  refs.childCard.classList.remove('empty');
  refs.childCard.innerHTML = '';

  if (!state.child) {
    refs.childCard.classList.add('empty');
    refs.childCard.innerHTML = '<div class="monster-name">No child yet</div>';
    return;
  }

  const child = state.child;

  const name = document.createElement('div');
  name.className = 'monster-name';
  name.textContent = child.name;

  const viz = document.createElement('div');
  viz.className = 'monster-viz';
  viz.style.cssText = monsterVizStyle(child.genes.bodyColor);
  viz.innerHTML = monsterSvg(child.genes);

  const chips = document.createElement('div');
  chips.className = 'gene-chip-list';
  for (const key of GENE_KEYS) {
    chips.appendChild(geneChip(child.id, key, child.genes[key]));
  }

  refs.childCard.appendChild(name);
  refs.childCard.appendChild(viz);
  refs.childCard.appendChild(chips);
}

function autoBreedPreview() {
  const aCount = Object.keys(state.parentA).length;
  const bCount = Object.keys(state.parentB).length;
  if (aCount === 0 && bCount === 0) {
    return;
  }

  state.child = combineGenes();
  renderChild();
}

function breedChild() {
  state.child = combineGenes();
  renderChild();

  const nextGeneration = { ...state.child, name: `Specimen ${state.monsters.length + 1}` };
  state.monsters = [nextGeneration, ...state.monsters.slice(0, 7)];
  renderMonsterPool();
  setupEscapeScene();
}

function reroll() {
  state.parentA = {};
  state.parentB = {};
  state.child = null;
  generateMonsters();
  renderParentSlots();
  renderMonsterPool();
  renderChild();
  setupEscapeScene();
}

refs.rerollBtn.addEventListener('click', reroll);
refs.breedBtn.addEventListener('click', breedChild);
refs.escapeStartBtn?.addEventListener('click', startEscapeRun);

reroll();
