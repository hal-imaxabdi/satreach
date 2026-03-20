// Data: ITU / World Bank 2023 — internet penetration & population per region
const regions = [
  {
    name: "Sub-Saharan Africa",
    country: "Chad / Niger / Mali", 
    lat: 15.5, lng: 17.0,
    connectivity: 18,
    population: 180000000,
    status: "critical",
    notes: "Vast Sahel region with nearly no terrestrial infrastructure"
  },
  {
    name: "Papua New Guinea Highlands",
    country: "Papua New Guinea",
    lat: -6.3, lng: 144.0,
    connectivity: 11,
    population: 5000000,
    status: "critical",
    notes: "Mountainous terrain makes fibre & cell towers impractical"
  },
  {
    name: "Amazon Basin",
    country: "Brazil / Peru / Colombia",
    lat: -4.5, lng: -62.0,
    connectivity: 30,
    population: 33000000,
    status: "limited",
    notes: "Dense jungle; communities separated by hundreds of kilometres"
  },
  {
    name: "Central Asia Steppe",
    country: "Mongolia / Kyrgyzstan",
    lat: 46.5, lng: 100.0,
    connectivity: 38,
    population: 7000000,
    status: "limited",
    notes: "Nomadic populations spread across vast low-density steppes"
  },
  {
    name: "East African Rift",
    country: "Ethiopia / South Sudan",
    lat: 8.0, lng: 36.5,
    connectivity: 22,
    population: 60000000,
    status: "critical",
    notes: "Conflict and terrain limit ground infrastructure severely"
  },
  {
    name: "Indonesian Archipelago",
    country: "Indonesia (Eastern islands)",
    lat: -3.5, lng: 130.0,
    connectivity: 48,
    population: 20000000,
    status: "emerging",
    notes: "17,000 islands — only ~6,000 inhabited, most unconnected"
  }
];

const statusColor = {
  critical: "#f87171",
  limited:  "#fbbf24",
  emerging: "#4ade80"
};

// Map setup — dark CartoDB tiles, centered on Africa/Asia gap
const map = L.map('map', { center: [15, 30], zoom: 3 });

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap &copy; CartoDB',
  maxZoom: 18
}).addTo(map);

// Place a circle marker for each region and bind a popup
regions.forEach((r) => {
  const color = statusColor[r.status];

  const marker = L.circleMarker([r.lat, r.lng], {
    radius: 10,
    fillColor: color,
    color: color,
    weight: 2,
    opacity: 0.9,
    fillOpacity: 0.35
  }).addTo(map);

  marker.bindPopup(`
    <div class="popup-title">${r.name}</div>
    <div class="popup-row">Country/Region <span>${r.country}</span></div>
    <div class="popup-row">Internet penetration <span>${r.connectivity}%</span></div>
    <div class="popup-row">Est. population <span>${(r.population / 1e6).toFixed(1)}M</span></div>
    <div class="popup-row">Status <span style="color:${color}">${r.status.toUpperCase()}</span></div>
    <div style="margin-top:8px;font-size:0.75rem;color:#64748b">${r.notes}</div>
  `);

  r._marker = marker;
});

// Build sidebar region list dynamically from data
const list = document.getElementById('region-list');

regions.forEach((r, i) => {
  const el = document.createElement('div');
  el.className = 'region-item';
  el.innerHTML = `
    <div class="region-dot" style="background:${statusColor[r.status]}"></div>
    <div class="region-info">
      <div class="region-name">${r.name}</div>
      <div class="region-sub">${r.connectivity}% connected · ${(r.population / 1e6).toFixed(0)}M people</div>
    </div>
    <div class="region-badge badge-${r.status}">${r.status}</div>
  `;
  el.addEventListener('click', () => {
    document.querySelectorAll('.region-item').forEach(e => e.classList.remove('active'));
    el.classList.add('active');
    map.flyTo([r.lat, r.lng], 5, { duration: 1.5 });
    r._marker.openPopup();
  });
  list.appendChild(el);
});

// Satellite placement
let placingMode = false;
let satelliteMarkers = [];
let coverageCircles = [];

const tooltip = document.getElementById('map-tooltip');

// LEO footprint: ~1200km radius at 550km altitude (approx. Starlink-class orbit)
const SAT_RADIUS_KM = 1200;

function startPlacing() {
  placingMode = true;
  document.body.classList.add('placing-satellite');
  document.getElementById('btn-place').textContent = '🛰 Click map to place…';
}

map.on('mousemove', (e) => {
  if (!placingMode) return;
  tooltip.style.display = 'block';
  tooltip.style.left = (e.originalEvent.clientX + 14) + 'px';
  tooltip.style.top  = (e.originalEvent.clientY - 10) + 'px';
});

map.on('mouseout', () => { tooltip.style.display = 'none'; });

map.on('click', (e) => {
  if (!placingMode) return;

  const { lat, lng } = e.latlng;

  const satIcon = L.divIcon({
    html: `<div style="font-size:22px;line-height:1;filter:drop-shadow(0 0 6px #38bdf8)">🛰️</div>`,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });

  const m = L.marker([lat, lng], { icon: satIcon }).addTo(map);

  const circle = L.circle([lat, lng], {
    radius: SAT_RADIUS_KM * 1000,
    color: '#38bdf8',
    fillColor: '#38bdf8',
    fillOpacity: 0.07,
    weight: 1.5,
    dashArray: '6 4'
  }).addTo(map);

  satelliteMarkers.push(m);
  coverageCircles.push(circle);

  const reached  = estimatePeopleReached(lat, lng, SAT_RADIUS_KM);
  const areaSqKm = Math.PI * SAT_RADIUS_KM * SAT_RADIUS_KM;

  document.getElementById('res-radius').textContent = `${SAT_RADIUS_KM.toLocaleString()} km`;
  document.getElementById('res-people').textContent = reached;
  document.getElementById('res-area').textContent   = `~${(areaSqKm / 1e6).toFixed(2)}M km²`;
  document.getElementById('coverage-result').classList.add('visible');

  placingMode = false;
  document.body.classList.remove('placing-satellite');
  document.getElementById('btn-place').textContent = '📡 Place Satellite';
  tooltip.style.display = 'none';
});

// Estimate unconnected people reached based on proximity to known regions.
// Uses a simple overlap factor — not a precise GIS calculation.
function estimatePeopleReached(lat, lng, radiusKm) {
  let total = 0;
  regions.forEach(r => {
    const dist = haversine(lat, lng, r.lat, r.lng);
    if (dist < radiusKm) {
      const overlap      = Math.max(0, 1 - dist / radiusKm);
      const unconnected  = r.population * (1 - r.connectivity / 100);
      total += unconnected * overlap * 0.4;
    }
  });
  if (total < 1000) return "< 1,000";
  if (total < 1e6)  return `~${Math.round(total / 1000)}K`;
  return `~${(total / 1e6).toFixed(1)}M`;
}

// Haversine formula — returns distance in km between two lat/lng points
function haversine(lat1, lng1, lat2, lng2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2 +
               Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
               Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function clearSatellites() {
  satelliteMarkers.forEach(m => map.removeLayer(m));
  coverageCircles.forEach(c => map.removeLayer(c));
  satelliteMarkers = [];
  coverageCircles  = [];
  document.getElementById('coverage-result').classList.remove('visible');
}
