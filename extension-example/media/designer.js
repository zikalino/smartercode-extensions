const vscode = acquireVsCodeApi();

const NODE_TEMPLATES = {
  service: { label: 'Service Desk', w: 170, h: 92, typeLabel: 'Service' },
  process: { label: 'Incident Management', w: 190, h: 100, typeLabel: 'Process' },
  team: { label: 'Project Team', w: 170, h: 88, typeLabel: 'Team' },
  data: { label: 'PO', w: 120, h: 80, typeLabel: 'Data' },
  user: { label: 'User Group', w: 150, h: 78, typeLabel: 'User' },
};

const state = {
  model: {
    version: 1,
    nodes: [
      { id: uid('node'), type: 'service', label: 'Service Desk', x: 1300, y: 290, w: 170, h: 92 },
      { id: uid('node'), type: 'team', label: 'Project Team', x: 1600, y: 290, w: 170, h: 88 },
      { id: uid('node'), type: 'process', label: 'Incident Management', x: 1240, y: 520, w: 220, h: 105 },
      { id: uid('node'), type: 'user', label: 'User / Customer', x: 1130, y: 750, w: 160, h: 80 },
      { id: uid('node'), type: 'data', label: 'PO', x: 1720, y: 540, w: 120, h: 80 },
    ],
    edges: [],
  },
  selectedNodeId: null,
  selectedEdgeId: null,
  connectMode: false,
  connectFromNodeId: null,
  zoom: 1,
  dragging: null,
};

const app = document.getElementById('app');

app.innerHTML = `
  <div class="designer-root">
    <header class="toolbar">
      <button class="primary" id="btn-new">New</button>
      <button class="primary" id="btn-save">Save</button>
      <button id="btn-load">Load</button>
      <button id="btn-export">Export SVG</button>
      <button id="btn-connect">Connect</button>
      <button id="btn-delete">Delete</button>
      <div class="toolbar-spacer"></div>
      <button id="btn-zoom-out">-</button>
      <div id="zoom-readout" class="zoom-readout">100%</div>
      <button id="btn-zoom-in">+</button>
    </header>

    <aside class="palette">
      <h3 class="section-title">Shapes</h3>
      <div class="palette-list" id="palette-list"></div>
    </aside>

    <main class="canvas-shell">
      <div class="canvas-viewport" id="canvas-viewport">
        <div class="surface" id="surface">
          <svg class="edges-layer" id="edges-layer" width="3000" height="2000" viewBox="0 0 3000 2000" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L8,4 L0,8 z" fill="currentColor"></path>
              </marker>
            </defs>
          </svg>
          <div class="nodes-layer" id="nodes-layer"></div>
        </div>
      </div>
      <div id="toast" class="toast"></div>
    </main>

    <aside class="properties">
      <h3 class="section-title">Properties</h3>
      <div class="field">
        <label for="node-label">Label</label>
        <input id="node-label" type="text" placeholder="Select a node" />
      </div>
      <div class="field">
        <label for="node-type">Type</label>
        <select id="node-type">
          <option value="service">Service</option>
          <option value="process">Process</option>
          <option value="team">Team</option>
          <option value="data">Data</option>
          <option value="user">User</option>
        </select>
      </div>
      <div class="field">
        <label for="node-x">X</label>
        <input id="node-x" type="number" />
      </div>
      <div class="field">
        <label for="node-y">Y</label>
        <input id="node-y" type="number" />
      </div>
      <div id="empty-selection" class="empty-selection">Select a node or connector to edit.</div>
    </aside>

    <footer class="status">
      <span id="status-text">Drag shapes from the left panel onto the canvas.</span>
      <span class="hint">Tip: use Connect mode, then click source and target nodes.</span>
    </footer>
  </div>
`;

const elements = {
  paletteList: document.getElementById('palette-list'),
  viewport: document.getElementById('canvas-viewport'),
  surface: document.getElementById('surface'),
  nodesLayer: document.getElementById('nodes-layer'),
  edgesLayer: document.getElementById('edges-layer'),
  connectButton: document.getElementById('btn-connect'),
  statusText: document.getElementById('status-text'),
  zoomReadout: document.getElementById('zoom-readout'),
  labelInput: document.getElementById('node-label'),
  typeSelect: document.getElementById('node-type'),
  xInput: document.getElementById('node-x'),
  yInput: document.getElementById('node-y'),
  emptySelection: document.getElementById('empty-selection'),
  toast: document.getElementById('toast'),
};

renderPalette();
wireToolbar();
wireCanvasInteractions();
wirePropertyPanel();
render();

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message.type !== 'string') {
    return;
  }

  if (message.type === 'loadDiagramData' && message.payload) {
    if (isValidModel(message.payload)) {
      state.model = normalizeModel(message.payload);
      state.selectedNodeId = null;
      state.selectedEdgeId = null;
      state.connectFromNodeId = null;
      showToast('Diagram loaded');
      render();
    }
  }
});

vscode.postMessage({ type: 'ready' });

function renderPalette() {
  elements.paletteList.innerHTML = '';
  Object.entries(NODE_TEMPLATES).forEach(([type, template]) => {
    const item = document.createElement('div');
    item.className = 'palette-item';
    item.draggable = true;
    item.dataset.nodeType = type;
    item.innerHTML = `<strong>${template.label}</strong><span>${template.typeLabel}</span>`;
    item.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('application/x-node-type', type);
      event.dataTransfer?.setData('text/plain', type);
    });
    elements.paletteList.appendChild(item);
  });
}

function wireToolbar() {
  document.getElementById('btn-new').addEventListener('click', () => {
    state.model = { version: 1, nodes: [], edges: [] };
    state.selectedNodeId = null;
    state.selectedEdgeId = null;
    state.connectFromNodeId = null;
    showToast('New diagram');
    render();
  });

  document.getElementById('btn-save').addEventListener('click', () => {
    vscode.postMessage({ type: 'saveDiagram', payload: state.model });
    showToast('Saving diagram');
  });

  document.getElementById('btn-load').addEventListener('click', () => {
    vscode.postMessage({ type: 'loadDiagram' });
  });

  document.getElementById('btn-export').addEventListener('click', () => {
    const svg = buildExportSvg();
    vscode.postMessage({ type: 'exportSvg', payload: svg });
    showToast('Exporting SVG');
  });

  elements.connectButton.addEventListener('click', () => {
    state.connectMode = !state.connectMode;
    state.connectFromNodeId = null;
    renderStatus();
    elements.connectButton.classList.toggle('active', state.connectMode);
    showToast(state.connectMode ? 'Connect mode enabled' : 'Connect mode disabled');
  });

  document.getElementById('btn-delete').addEventListener('click', () => {
    if (state.selectedNodeId) {
      const nodeId = state.selectedNodeId;
      state.model.nodes = state.model.nodes.filter((node) => node.id !== nodeId);
      state.model.edges = state.model.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
      state.selectedNodeId = null;
      showToast('Node deleted');
      render();
      return;
    }

    if (state.selectedEdgeId) {
      const edgeId = state.selectedEdgeId;
      state.model.edges = state.model.edges.filter((edge) => edge.id !== edgeId);
      state.selectedEdgeId = null;
      showToast('Connector deleted');
      render();
    }
  });

  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    state.zoom = Math.min(2, round2(state.zoom + 0.1));
    applyZoom();
  });

  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    state.zoom = Math.max(0.5, round2(state.zoom - 0.1));
    applyZoom();
  });
}

function wireCanvasInteractions() {
  elements.viewport.addEventListener('dragover', (event) => {
    event.preventDefault();
  });

  elements.viewport.addEventListener('drop', (event) => {
    event.preventDefault();
    const type = event.dataTransfer?.getData('application/x-node-type') || event.dataTransfer?.getData('text/plain');
    if (!NODE_TEMPLATES[type]) {
      return;
    }

    const point = clientToSurface(event.clientX, event.clientY);
    const template = NODE_TEMPLATES[type];
    const node = {
      id: uid('node'),
      type,
      label: template.label,
      x: Math.max(0, Math.round(point.x - template.w / 2)),
      y: Math.max(0, Math.round(point.y - template.h / 2)),
      w: template.w,
      h: template.h,
    };

    state.model.nodes.push(node);
    state.selectedNodeId = node.id;
    state.selectedEdgeId = null;
    showToast(`${template.label} added`);
    render();
  });

  elements.viewport.addEventListener('mousedown', () => {
    state.selectedNodeId = null;
    state.selectedEdgeId = null;
    renderProperties();
    renderEdges();
    renderNodes();
  });

  window.addEventListener('mousemove', (event) => {
    if (!state.dragging) {
      return;
    }

    const node = state.model.nodes.find((candidate) => candidate.id === state.dragging.nodeId);
    if (!node) {
      return;
    }

    const point = clientToSurface(event.clientX, event.clientY);
    node.x = Math.max(0, Math.round(point.x - state.dragging.offsetX));
    node.y = Math.max(0, Math.round(point.y - state.dragging.offsetY));
    renderNodes();
    renderEdges();
    renderProperties();
  });

  window.addEventListener('mouseup', () => {
    state.dragging = null;
  });
}

function wirePropertyPanel() {
  elements.labelInput.addEventListener('input', () => {
    const node = getSelectedNode();
    if (!node) {
      return;
    }

    node.label = elements.labelInput.value;
    renderNodes();
  });

  elements.typeSelect.addEventListener('change', () => {
    const node = getSelectedNode();
    if (!node) {
      return;
    }

    node.type = elements.typeSelect.value;
    renderNodes();
  });

  elements.xInput.addEventListener('change', () => {
    const node = getSelectedNode();
    if (!node) {
      return;
    }

    node.x = Math.max(0, Number(elements.xInput.value) || 0);
    renderNodes();
    renderEdges();
    renderProperties();
  });

  elements.yInput.addEventListener('change', () => {
    const node = getSelectedNode();
    if (!node) {
      return;
    }

    node.y = Math.max(0, Number(elements.yInput.value) || 0);
    renderNodes();
    renderEdges();
    renderProperties();
  });
}

function render() {
  applyZoom();
  renderNodes();
  renderEdges();
  renderProperties();
  renderStatus();
}

function renderNodes() {
  elements.nodesLayer.innerHTML = '';

  state.model.nodes.forEach((node) => {
    const element = document.createElement('div');
    element.className = `diagram-node type-${node.type}${state.selectedNodeId === node.id ? ' selected' : ''}`;
    element.style.left = `${node.x}px`;
    element.style.top = `${node.y}px`;
    element.style.width = `${node.w}px`;
    element.style.height = `${node.h}px`;

    const title = document.createElement('div');
    title.className = 'node-label';
    title.textContent = node.label;

    const subtitle = document.createElement('div');
    subtitle.className = 'node-type';
    subtitle.textContent = NODE_TEMPLATES[node.type]?.typeLabel || node.type;

    element.appendChild(title);
    element.appendChild(subtitle);

    element.addEventListener('mousedown', (event) => {
      event.stopPropagation();
      if (state.connectMode) {
        onNodeConnectClick(node.id);
        return;
      }

      state.selectedNodeId = node.id;
      state.selectedEdgeId = null;
      const point = clientToSurface(event.clientX, event.clientY);
      state.dragging = {
        nodeId: node.id,
        offsetX: point.x - node.x,
        offsetY: point.y - node.y,
      };
      renderProperties();
      renderNodes();
      renderEdges();
    });

    element.addEventListener('dblclick', (event) => {
      event.stopPropagation();
      state.selectedNodeId = node.id;
      elements.labelInput.focus();
      elements.labelInput.select();
      renderProperties();
    });

    elements.nodesLayer.appendChild(element);
  });
}

function renderEdges() {
  const defs = elements.edgesLayer.querySelector('defs');
  elements.edgesLayer.innerHTML = '';
  if (defs) {
    elements.edgesLayer.appendChild(defs);
  }

  state.model.edges.forEach((edge) => {
    const fromNode = state.model.nodes.find((node) => node.id === edge.from);
    const toNode = state.model.nodes.find((node) => node.id === edge.to);
    if (!fromNode || !toNode) {
      return;
    }

    const startX = fromNode.x + fromNode.w / 2;
    const startY = fromNode.y + fromNode.h / 2;
    const endX = toNode.x + toNode.w / 2;
    const endY = toNode.y + toNode.h / 2;
    const delta = Math.max(40, Math.abs(endX - startX) * 0.35);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', `edge${state.selectedEdgeId === edge.id ? ' selected' : ''}`);
    path.setAttribute('d', `M ${startX} ${startY} C ${startX + delta} ${startY}, ${endX - delta} ${endY}, ${endX} ${endY}`);
    path.setAttribute('marker-end', 'url(#arrow)');

    path.addEventListener('mousedown', (event) => {
      event.stopPropagation();
      state.selectedEdgeId = edge.id;
      state.selectedNodeId = null;
      renderProperties();
      renderEdges();
      renderNodes();
    });

    elements.edgesLayer.appendChild(path);
  });
}

function renderProperties() {
  const node = getSelectedNode();
  const hasNode = Boolean(node);

  elements.labelInput.disabled = !hasNode;
  elements.typeSelect.disabled = !hasNode;
  elements.xInput.disabled = !hasNode;
  elements.yInput.disabled = !hasNode;
  elements.emptySelection.style.display = hasNode ? 'none' : 'block';

  if (!node) {
    elements.labelInput.value = '';
    elements.typeSelect.value = 'service';
    elements.xInput.value = '';
    elements.yInput.value = '';
    return;
  }

  elements.labelInput.value = node.label;
  elements.typeSelect.value = node.type;
  elements.xInput.value = String(Math.round(node.x));
  elements.yInput.value = String(Math.round(node.y));
}

function renderStatus() {
  const count = `${state.model.nodes.length} nodes · ${state.model.edges.length} connectors`;
  if (state.connectMode) {
    if (state.connectFromNodeId) {
      elements.statusText.textContent = `Connect mode: pick target node. (${count})`;
      return;
    }

    elements.statusText.textContent = `Connect mode: pick source node. (${count})`;
    return;
  }

  elements.statusText.textContent = `Drag shapes from the left panel onto the canvas. (${count})`;
}

function onNodeConnectClick(nodeId) {
  if (!state.connectFromNodeId) {
    state.connectFromNodeId = nodeId;
    state.selectedNodeId = nodeId;
    renderStatus();
    renderNodes();
    showToast('Source selected. Click target node.');
    return;
  }

  if (state.connectFromNodeId === nodeId) {
    showToast('Choose a different target node');
    return;
  }

  const duplicate = state.model.edges.some(
    (edge) => edge.from === state.connectFromNodeId && edge.to === nodeId
      || edge.from === nodeId && edge.to === state.connectFromNodeId
  );

  if (duplicate) {
    showToast('Connection already exists');
    return;
  }

  state.model.edges.push({ id: uid('edge'), from: state.connectFromNodeId, to: nodeId });
  state.connectFromNodeId = null;
  state.selectedNodeId = null;
  state.selectedEdgeId = null;
  showToast('Connector created');
  render();
}

function applyZoom() {
  elements.surface.style.transform = `scale(${state.zoom})`;
  elements.zoomReadout.textContent = `${Math.round(state.zoom * 100)}%`;
}

function getSelectedNode() {
  return state.model.nodes.find((node) => node.id === state.selectedNodeId) || null;
}

function clientToSurface(clientX, clientY) {
  const rect = elements.viewport.getBoundingClientRect();
  const x = (clientX - rect.left + elements.viewport.scrollLeft) / state.zoom;
  const y = (clientY - rect.top + elements.viewport.scrollTop) / state.zoom;
  return { x, y };
}

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function normalizeModel(model) {
  return {
    version: 1,
    nodes: Array.isArray(model.nodes) ? model.nodes.map((node) => ({
      id: String(node.id),
      type: String(node.type),
      label: String(node.label),
      x: Number(node.x) || 0,
      y: Number(node.y) || 0,
      w: Number(node.w) || 140,
      h: Number(node.h) || 80,
    })) : [],
    edges: Array.isArray(model.edges) ? model.edges.map((edge) => ({
      id: String(edge.id),
      from: String(edge.from),
      to: String(edge.to),
    })) : [],
  };
}

function isValidModel(model) {
  if (!model || !Array.isArray(model.nodes) || !Array.isArray(model.edges)) {
    return false;
  }

  return model.nodes.every((node) => node && typeof node.id === 'string')
    && model.edges.every((edge) => edge && typeof edge.id === 'string');
}

function showToast(text) {
  elements.toast.textContent = text;
  elements.toast.classList.add('show');
  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    elements.toast.classList.remove('show');
  }, 1500);
}

showToast.timeoutId = 0;

function buildExportSvg() {
  const width = 3000;
  const height = 2000;
  const styles = getComputedStyle(document.body);
  const lineColor = readThemeColor(styles, '--vscode-foreground', 'currentColor');
  const nodeBorder = readThemeColor(styles, '--vscode-focusBorder', 'currentColor');
  const nodeFill = readThemeColor(styles, '--vscode-editor-background', 'white');
  const textColor = readThemeColor(styles, '--vscode-foreground', 'currentColor');
  const typeColor = readThemeColor(styles, '--vscode-descriptionForeground', textColor);

  const edges = state.model.edges
    .map((edge) => {
      const fromNode = state.model.nodes.find((node) => node.id === edge.from);
      const toNode = state.model.nodes.find((node) => node.id === edge.to);
      if (!fromNode || !toNode) {
        return '';
      }

      const startX = fromNode.x + fromNode.w / 2;
      const startY = fromNode.y + fromNode.h / 2;
      const endX = toNode.x + toNode.w / 2;
      const endY = toNode.y + toNode.h / 2;
      const delta = Math.max(40, Math.abs(endX - startX) * 0.35);
      return `<path d="M ${startX} ${startY} C ${startX + delta} ${startY}, ${endX - delta} ${endY}, ${endX} ${endY}" stroke="${lineColor}" stroke-width="2" fill="none" marker-end="url(#arrow)"/>`;
    })
    .join('');

  const nodes = state.model.nodes
    .map((node) => {
      const cx = node.x + node.w / 2;
      const title = escapeXml(node.label);
      const typeText = escapeXml(NODE_TEMPLATES[node.type]?.typeLabel || node.type);
      return `<g>
        <rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="12" ry="12" fill="${nodeFill}" stroke="${nodeBorder}" stroke-width="1.4"/>
        <text x="${cx}" y="${node.y + node.h / 2 - 6}" text-anchor="middle" font-size="13" font-family="Segoe UI, Arial" fill="${textColor}">${title}</text>
        <text x="${cx}" y="${node.y + node.h / 2 + 14}" text-anchor="middle" font-size="10" font-family="Segoe UI, Arial" fill="${typeColor}">${typeText}</text>
      </g>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L8,4 L0,8 z" fill="${lineColor}"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>
  ${edges}
  ${nodes}
</svg>`;
}

function readThemeColor(styles, token, fallback) {
  const value = styles.getPropertyValue(token).trim();
  return value || fallback;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
