const vscode = acquireVsCodeApi();

const cityInput = document.getElementById('cityInput');
const drawRouteButton = document.getElementById('drawRoute');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');

const map = L.map('map', {
  zoomControl: true
}).setView([20, 0], 3);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const layerGroup = L.layerGroup().addTo(map);

drawRouteButton.addEventListener('click', () => {
  const value = String(cityInput.value || '').trim();
  if (!value) {
    setStatus('Enter at least two cities.');
    return;
  }

  setStatus('Resolving city locations...');
  clearResults();
  vscode.postMessage({
    type: 'resolveCities',
    cities: value
  });
});

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'routeError') {
    setStatus(message.error || 'Failed to build route.');
    return;
  }

  if (message.type === 'routeReady' && Array.isArray(message.points)) {
    renderRoute(message.points);
  }
});

function renderRoute(points) {
  layerGroup.clearLayers();

  if (points.length < 2) {
    setStatus('Enter at least two cities.');
    return;
  }

  const latLngs = points.map((point) => [point.latitude, point.longitude]);

  points.forEach((point, index) => {
    const marker = L.circleMarker([point.latitude, point.longitude], {
      radius: 7,
      color: '#1e3a8a',
      fillColor: index === 0 ? '#2563eb' : '#1e40af',
      fillOpacity: 0.95,
      weight: 2
    });
    marker.bindPopup(`<strong>${escapeHtml(point.name)}</strong><br/>Stop ${index + 1}`);
    marker.addTo(layerGroup);
  });

  L.polyline(latLngs, {
    color: '#3b82f6',
    weight: 4,
    opacity: 0.85
  }).addTo(layerGroup);

  const bounds = L.latLngBounds(latLngs);
  map.fitBounds(bounds, {
    padding: [36, 36],
    maxZoom: 8
  });

  setStatus(`Route created for ${points.length} cities.`);
  renderResults(points);
}

function renderResults(points) {
  resultsEl.innerHTML = '';
  points.forEach((point, index) => {
    const li = document.createElement('li');
    li.textContent = `${index + 1}. ${point.name} (${point.latitude.toFixed(3)}, ${point.longitude.toFixed(3)})`;
    resultsEl.appendChild(li);
  });
}

function clearResults() {
  resultsEl.innerHTML = '';
}

function setStatus(text) {
  statusEl.textContent = text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
