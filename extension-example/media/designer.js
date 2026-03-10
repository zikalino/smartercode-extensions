const vscode = acquireVsCodeApi();

const state = {
  payload: null,
  selectedHash: null,
};

const LANE_COLORS = [
  '#4DA3FF',
  '#FF8A5B',
  '#7AD47B',
  '#E8B644',
  '#64D6CC',
  '#F279A2',
  '#B2A1FF',
  '#8AA1B1',
];

const GRAPH = {
  rowHeight: 42,
  laneWidth: 16,
  laneOffset: 20,
  textGap: 18,
};

const app = document.getElementById('app');
app.innerHTML = `
  <div class="root">
    <header class="toolbar">
      <div class="title-wrap">
        <h1>Commit Graph</h1>
        <div class="meta" id="repo-meta">Waiting for repository...</div>
      </div>
      <button id="btn-refresh" class="primary">Refresh</button>
    </header>

    <main class="layout">
      <section class="graph-panel">
        <div class="graph-header">
          <span>History</span>
          <span id="graph-count"></span>
        </div>
        <div id="graph-scroll" class="graph-scroll">
          <svg id="graph-svg" xmlns="http://www.w3.org/2000/svg"></svg>
          <div id="rows" class="rows"></div>
        </div>
      </section>

      <aside class="details-panel">
        <h2>Commit Details</h2>
        <div id="details-empty" class="details-empty">Select a commit to view details.</div>
        <div id="details-content" class="details-content hidden">
          <div class="detail-row"><span>Hash</span><strong id="d-hash"></strong></div>
          <div class="detail-row"><span>Author</span><strong id="d-author"></strong></div>
          <div class="detail-row"><span>Date</span><strong id="d-date"></strong></div>
          <div class="detail-row refs"><span>Refs</span><div id="d-refs" class="refs-wrap"></div></div>
          <div class="detail-message" id="d-subject"></div>
          <button id="btn-copy">Copy Hash</button>
        </div>
      </aside>
    </main>
  </div>
`;

const elements = {
  repoMeta: document.getElementById('repo-meta'),
  graphCount: document.getElementById('graph-count'),
  graphScroll: document.getElementById('graph-scroll'),
  graphSvg: document.getElementById('graph-svg'),
  rows: document.getElementById('rows'),
  detailsEmpty: document.getElementById('details-empty'),
  detailsContent: document.getElementById('details-content'),
  dHash: document.getElementById('d-hash'),
  dAuthor: document.getElementById('d-author'),
  dDate: document.getElementById('d-date'),
  dRefs: document.getElementById('d-refs'),
  dSubject: document.getElementById('d-subject'),
};

document.getElementById('btn-refresh').addEventListener('click', () => {
  vscode.postMessage({ type: 'refresh' });
});

document.getElementById('btn-copy').addEventListener('click', () => {
  if (!state.selectedHash) {
    return;
  }

  vscode.postMessage({ type: 'copyCommit', payload: state.selectedHash });
});

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message.type !== 'string') {
    return;
  }

  if (message.type === 'graphError') {
    renderError(message.payload || 'Unable to load git graph.');
    return;
  }

  if (message.type === 'graphData' && message.payload) {
    renderGraph(message.payload);
  }
});

window.addEventListener('resize', () => {
  if (!state.payload || !Array.isArray(state.payload.commits)) {
    return;
  }

  renderLinks(state.payload.commits);
});

vscode.postMessage({ type: 'ready' });

function renderError(text) {
  state.payload = null;
  state.selectedHash = null;
  elements.repoMeta.textContent = text;
  elements.graphCount.textContent = '';
  elements.rows.innerHTML = '';
  elements.graphSvg.innerHTML = '';
  elements.detailsContent.classList.add('hidden');
  elements.detailsEmpty.classList.remove('hidden');
}

function renderGraph(payload) {
  state.payload = payload;
  state.selectedHash = null;

  const commits = Array.isArray(payload.commits) ? payload.commits : [];
  elements.repoMeta.textContent = `${payload.repositoryRoot} | ${new Date(payload.generatedAt).toLocaleString()}`;
  elements.graphCount.textContent = `${commits.length} commits`;

  renderRows(commits);
  renderLinks(commits);

  elements.detailsContent.classList.add('hidden');
  elements.detailsEmpty.classList.remove('hidden');
}

function renderRows(commits) {
  elements.rows.innerHTML = '';

  commits.forEach((commit, rowIndex) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'row';
    row.style.setProperty('--row-index', String(rowIndex));

    const subject = document.createElement('span');
    subject.className = 'subject';
    subject.textContent = commit.subject || '(no commit message)';

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${commit.shortHash} | ${commit.author} | ${commit.date}`;

    const refs = document.createElement('span');
    refs.className = 'refs';
    refs.innerHTML = '';
    (Array.isArray(commit.refs) ? commit.refs : []).slice(0, 3).forEach((refName) => {
      const tag = document.createElement('span');
      tag.className = 'ref-chip';
      tag.textContent = refName;
      refs.appendChild(tag);
    });

    const textWrap = document.createElement('span');
    textWrap.className = 'text-wrap';
    textWrap.style.marginLeft = `${GRAPH.laneOffset + commit.lane * GRAPH.laneWidth + GRAPH.textGap}px`;
    textWrap.append(subject, meta, refs);

    row.append(textWrap);
    row.addEventListener('click', () => {
      state.selectedHash = commit.hash;
      selectRow(commit.hash);
      renderDetails(commit);
    });

    row.dataset.hash = commit.hash;
    elements.rows.appendChild(row);
  });
}

function renderLinks(commits) {
  const laneWidth = GRAPH.laneWidth;
  const laneOffset = GRAPH.laneOffset;
  const laneCount = maxLane(commits);
  const width = Math.max(70, laneCount * laneWidth + 30);
  const rowCenters = getRowCenters();
  const lastRow = elements.rows.lastElementChild;
  const contentHeight = lastRow ? lastRow.offsetTop + lastRow.offsetHeight : 0;
  const height = Math.max(10, contentHeight + 8);

  elements.graphSvg.setAttribute('width', String(width));
  elements.graphSvg.setAttribute('height', String(height));
  elements.graphSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  elements.graphSvg.innerHTML = '';

  const byHash = new Map();
  commits.forEach((commit, index) => {
    byHash.set(commit.hash, {
      commit,
      y: rowCenters[index] ?? index * GRAPH.rowHeight + 21,
    });
  });

  commits.forEach((commit, index) => {
    const startX = laneOffset + commit.lane * laneWidth;
    const startY = rowCenters[index] ?? index * GRAPH.rowHeight + 21;

    (Array.isArray(commit.parents) ? commit.parents : []).forEach((parentHash) => {
      const target = byHash.get(parentHash);
      if (!target) {
        return;
      }

      const endX = laneOffset + target.commit.lane * laneWidth;
      const endY = target.y;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', buildSharpPath(startX, startY, endX, endY));
      path.setAttribute('stroke', laneColor(commit.lane));
      path.setAttribute('stroke-width', '2');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('opacity', '0.9');
      elements.graphSvg.appendChild(path);
    });
  });

  commits.forEach((commit, index) => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', String(laneOffset + commit.lane * laneWidth));
    circle.setAttribute('cy', String(rowCenters[index] ?? index * GRAPH.rowHeight + 21));
    circle.setAttribute('r', '4.5');
    circle.setAttribute('fill', laneColor(commit.lane));
    circle.setAttribute('stroke', 'var(--vscode-editor-background)');
    circle.setAttribute('stroke-width', '1.5');
    elements.graphSvg.appendChild(circle);
  });
}

function getRowCenters() {
  const rowElements = elements.rows.querySelectorAll('.row');
  const centers = [];

  rowElements.forEach((rowElement) => {
    centers.push(rowElement.offsetTop + rowElement.offsetHeight / 2);
  });

  return centers;
}

function buildSharpPath(startX, startY, endX, endY) {
  if (startX === endX) {
    return `M ${startX} ${startY} L ${endX} ${endY}`;
  }

  const verticalDirection = endY >= startY ? 1 : -1;
  const horizontalDirection = endX >= startX ? 1 : -1;
  const spanY = Math.abs(endY - startY);
  const radius = Math.min(8, Math.max(3, Math.round(spanY * 0.22)));
  const midY = startY + verticalDirection * Math.max(radius + 2, Math.round(spanY * 0.5));
  const beforeCornerY = midY - verticalDirection * radius;
  const afterCornerX = startX + horizontalDirection * radius;
  const beforeSecondCornerX = endX - horizontalDirection * radius;
  const afterSecondCornerY = midY + verticalDirection * radius;

  return [
    `M ${startX} ${startY}`,
    `L ${startX} ${beforeCornerY}`,
    `Q ${startX} ${midY} ${afterCornerX} ${midY}`,
    `L ${beforeSecondCornerX} ${midY}`,
    `Q ${endX} ${midY} ${endX} ${afterSecondCornerY}`,
    `L ${endX} ${endY}`,
  ].join(' ');
}

function selectRow(hash) {
  elements.rows.querySelectorAll('.row').forEach((element) => {
    element.classList.toggle('selected', element.dataset.hash === hash);
  });
}

function renderDetails(commit) {
  elements.detailsEmpty.classList.add('hidden');
  elements.detailsContent.classList.remove('hidden');

  elements.dHash.textContent = commit.hash;
  elements.dAuthor.textContent = commit.author;
  elements.dDate.textContent = commit.date;
  elements.dSubject.textContent = commit.subject || '(no message)';
  elements.dRefs.innerHTML = '';

  const refs = Array.isArray(commit.refs) ? commit.refs : [];
  if (refs.length === 0) {
    const none = document.createElement('span');
    none.className = 'ref-chip muted';
    none.textContent = 'none';
    elements.dRefs.appendChild(none);
  } else {
    refs.forEach((refName) => {
      const chip = document.createElement('span');
      chip.className = 'ref-chip';
      chip.textContent = refName;
      elements.dRefs.appendChild(chip);
    });
  }
}

function maxLane(commits) {
  let max = 0;
  commits.forEach((commit) => {
    if (Number.isInteger(commit.lane) && commit.lane > max) {
      max = commit.lane;
    }
  });
  return max + 1;
}

function laneColor(lane) {
  return LANE_COLORS[Math.abs(lane) % LANE_COLORS.length];
}
