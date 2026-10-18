const STATUS_LABELS = {
  solicitada: "Solicitada",
  designada: "Veículo designado",
  embarcado: "Paciente embarcado",
  deslocamento: "Em deslocamento",
  aguardando: "Aguardando recebimento",
  recebido: "Recebido",
  finalizado: "Finalizado"
};

const ELEMENTS = {
  flowType: null,
  statusFilter: null,
  resetFilters: null,
  kpiTotal: null,
  kpiAlerts: null,
  kpiAvg: null,
  kpiComplete: null,
  selectedTransfer: null,
  timeline: null,
  timelineCode: null,
  bottleneckList: null
};

let map = null;
let routeLayers = [];
let vehicleMarkers = [];
let unitMarkers = [];
let selectedTransferId = null;

function loadScript(src, integrity) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    if (integrity) {
      script.integrity = integrity;
      script.crossOrigin = "";
    }
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Falha ao carregar script ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureLeaflet() {
  if (typeof L !== "undefined") {
    return true;
  }

  try {
    await loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=");
    return true;
  } catch (primaryError) {
    console.warn("Falha ao carregar Leaflet da CDN principal, tentando fallback.", primaryError);
    try {
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js", "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=");
      return true;
    } catch (fallbackError) {
      console.error("Falha ao carregar Leaflet no fallback.", fallbackError);
      const errorBanner = document.createElement("div");
      errorBanner.className = "map-error-banner";
      errorBanner.textContent = "Erro ao carregar o mapa. Atualize a página ou verifique sua conexão.";
      document.body.prepend(errorBanner);
      return false;
    }
  }
}

function sanitize(value) {
  return String(value ?? "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function formatFlowLabel(item) {
  return item.flowType === "samu"
    ? "SAMU 192 — identificado, fora da frota municipal"
    : "PMV / Municipal — governança municipal";
}

function ambulanceSvg(flowType, label, alert = false) {
  const isSamu = flowType === "samu";
  const body = isSamu ? "#fff7e8" : "#eaffff";
  const stripe = isSamu ? "#ff7a32" : "#25e1dc";
  const cross = isSamu ? "#e84a4a" : "#169d9a";
  const haloClass = `${flowType}${alert ? " alert" : ""}`;
  const labelSafe = sanitize(label);

  return `
    <div class="vehicle-wrap ${flowType}${alert ? " alert" : ""}">
      <div class="vehicle-halo ${haloClass}"></div>
      <svg class="ambulance-svg" viewBox="0 0 120 86" aria-label="${labelSafe}">
        <g transform="rotate(-18 60 43)">
          <path d="M12 43 Q15 28 31 25 H67 Q79 25 87 36 L101 38 Q110 40 112 51 V62 H102 Q99 73 88 73 Q77 73 74 62 H45 Q42 73 31 73 Q20 73 17 62 H10 V51 Q10 47 12 43Z"
                fill="${body}" stroke="rgba(255,255,255,.9)" stroke-width="3"/>
          <path d="M68 30 H84 L95 41 H68Z" fill="#bfe8ff" opacity=".9"/>
          <path d="M22 35 H62 V57 H18 L20 43 Q21 38 22 35Z" fill="#f7ffff"/>
          <rect x="20" y="49" width="82" height="7" rx="3.5" fill="${stripe}" opacity=".96"/>
          <rect x="38" y="34" width="8" height="22" rx="2" fill="${cross}"/>
          <rect x="31" y="41" width="22" height="8" rx="2" fill="${cross}"/>
          <circle cx="31" cy="62" r="8" fill="#172536" stroke="#dceeff" stroke-width="3"/>
          <circle cx="88" cy="62" r="8" fill="#172536" stroke="#dceeff" stroke-width="3"/>
          <circle class="beacon" cx="47" cy="22" r="5" fill="#ff3159"/>
          <circle class="beacon right" cx="60" cy="22" r="5" fill="#2a9dff"/>
          <path class="headlight" d="M109 48 L121 43 L121 54 Z" fill="#dffcff" opacity=".8"/>
          <text x="58" y="47" text-anchor="middle" font-size="14" font-weight="900" fill="#102336">${isSamu ? "SAMU" : "PMV"}</text>
        </g>
      </svg>
      <div class="vehicle-label">${labelSafe}</div>
    </div>
  `;
}

function createDivIcon(html, iconSize, iconAnchor) {
  return L.divIcon({
    className: "",
    html,
    iconSize,
    iconAnchor
  });
}

function createUnitIcon(type) {
  const label = type === "Destino" ? "H" : "P";
  return createDivIcon(`<div class="unit-marker">${label}</div>`, [38, 38], [19, 19]);
}

function createVehicleIcon(item) {
  return createDivIcon(ambulanceSvg(item.flowType, item.vehicleLabel, item.alert), [74, 60], [37, 30]);
}

function initMap() {
  map = L.map("map", {
    zoomControl: false,
    preferCanvas: true
  }).setView([-20.3155, -40.3128], 12);

  L.control.zoom({ position: "bottomright" }).addTo(map);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap &copy; CARTO"
  }).addTo(map);
}

function drawUnits() {
  unitMarkers.forEach(marker => marker.remove());
  unitMarkers = [];

  MOOV_DATA.units.forEach(unit => {
    const marker = L.marker(unit.coords, { icon: createUnitIcon(unit.type) })
      .addTo(map)
      .bindPopup(`<strong>${sanitize(unit.name)}</strong><br>${sanitize(unit.type)}`);

    unitMarkers.push(marker);
  });
}

function clearMapLayers() {
  routeLayers.forEach(layer => layer.remove());
  vehicleMarkers.forEach(marker => marker.remove());
  routeLayers = [];
  vehicleMarkers = [];
}

function getFilters() {
  return {
    flowType: ELEMENTS.flowType.value,
    status: ELEMENTS.statusFilter.value
  };
}

function filteredTransfers() {
  const filters = getFilters();

  return MOOV_DATA.transfers.filter(item => {
    const matchFlow = filters.flowType === "all" || item.flowType === filters.flowType;
    const matchStatus = filters.status === "all" || item.status === filters.status;
    return matchFlow && matchStatus;
  });
}

function drawTransfers(transfers) {
  if (!map) {
    return;
  }

  clearMapLayers();

  transfers.forEach(item => {
    const routeColor = item.flowType === "samu" ? "#ffb13b" : "#25e1dc";
    const clickHandler = () => selectTransfer(item.id);

    const glow = L.polyline(item.route, {
      color: routeColor,
      weight: 11,
      opacity: 0.18,
      dashArray: item.alert ? "8, 8" : null,
      interactive: true
    }).addTo(map);

    const route = L.polyline(item.route, {
      color: routeColor,
      weight: 4,
      opacity: 0.95,
      dashArray: item.alert ? "8, 8" : null,
      interactive: true
    }).addTo(map);

    const setHover = () => {
      route.setStyle({ weight: 6, opacity: 1 });
      glow.setStyle({ opacity: 0.28 });
    };

    const resetHover = () => {
      route.setStyle({ weight: 4, opacity: 0.95 });
      glow.setStyle({ opacity: 0.18 });
    };

    glow.on("click", clickHandler).on("mouseover", setHover).on("mouseout", resetHover);
    route.on("click", clickHandler).on("mouseover", setHover).on("mouseout", resetHover);
    routeLayers.push(glow, route);

    const marker = L.marker(item.vehicleCoords, {
      icon: createVehicleIcon(item),
      zIndexOffset: 1000
    }).addTo(map);

    marker.bindPopup(`
      <strong>${sanitize(item.vehicleLabel)}</strong><br>
      ${sanitize(item.vehicleType)}<br>
      <small>${statusLabel(item.status)}</small>
    `);

    marker.on("click", clickHandler);
    marker.on("mouseover", () => {
      const el = marker.getElement();
      if (el) el.classList.add("marker-hover");
    });
    marker.on("mouseout", () => {
      const el = marker.getElement();
      if (el) el.classList.remove("marker-hover");
    });

    vehicleMarkers.push(marker);
  });

  map.invalidateSize(true);
}

function updateKPIs(transfers) {
  const events = transfers.flatMap(t => t.microevents);
  const doneEvents = events.filter(event => event.state === "done").length;
  const completion = events.length ? Math.round((doneEvents / events.length) * 100) : 0;

  ELEMENTS.kpiTotal.textContent = transfers.length;
  ELEMENTS.kpiAlerts.textContent = transfers.filter(t => t.alert).length;
  ELEMENTS.kpiAvg.textContent = "—";
  ELEMENTS.kpiComplete.textContent = `${completion}%`;
}

function renderSelectedCard(item) {
  if (!item) {
    ELEMENTS.selectedTransfer.innerHTML = `
      <p class="eyebrow">Transferência selecionada</p>
      <h3>Selecione uma ambulância no mapa</h3>
      <p class="muted">A linha do tempo e os dados de governança aparecerão aqui.</p>
    `;
    return;
  }

  ELEMENTS.selectedTransfer.innerHTML = `
    <p class="eyebrow">${formatFlowLabel(item)}</p>
    <h3>${sanitize(item.id)}</h3>
    <p class="muted">${sanitize(item.origin)} → ${sanitize(item.destination)}</p>

    <div class="transfer-meta">
      <div>
        <small>Status</small>
        <b>${statusLabel(item.status)}</b>
      </div>
      <div>
        <small>Veículo</small>
        <b>${sanitize(item.vehicleLabel)}</b>
      </div>
      <div>
        <small>ETA</small>
        <b>${sanitize(item.eta)}</b>
      </div>
      <div>
        <small>KM</small>
        <b>${sanitize(item.kmInitial) || "--"} → ${sanitize(item.kmFinal) || "--"}</b>
      </div>
    </div>
  `;
}

function renderTimeline(item) {
  if (!item) {
    ELEMENTS.timelineCode.textContent = "Sem seleção";
    ELEMENTS.timeline.className = "timeline empty";
    ELEMENTS.timeline.textContent = "Selecione uma transferência no mapa.";
    return;
  }

  ELEMENTS.timelineCode.textContent = sanitize(item.requestCode);
  ELEMENTS.timeline.className = "timeline";
  ELEMENTS.timeline.innerHTML = item.microevents.map(event => `
    <div class="timeline-step ${event.state}">
      <span>${sanitize(event.profile)}</span>
      <strong>${sanitize(event.label)}</strong>
      <small>${sanitize(event.time)}</small>
    </div>
  `).join("");
}

function renderBottlenecks() {
  ELEMENTS.bottleneckList.innerHTML = MOOV_DATA.bottlenecks.map(item => `
    <div class="bottleneck-item">
      <div>
        <strong>${sanitize(item.label)}</strong>
        <span>${sanitize(item.detail)}</span>
      </div>
      <div class="bottleneck-badge">${sanitize(item.value)}</div>
    </div>
  `).join("");
}

function selectTransfer(id) {
  selectedTransferId = id;
  const item = MOOV_DATA.transfers.find(t => t.id === id);
  renderSelectedCard(item);
  renderTimeline(item);
}

function refreshDashboard() {
  const transfers = filteredTransfers();
  drawTransfers(transfers);
  updateKPIs(transfers);

  if (!transfers.some(t => t.id === selectedTransferId)) {
    if (transfers.length) {
      selectTransfer(transfers[0].id);
    } else {
      selectedTransferId = null;
      renderSelectedCard(null);
      renderTimeline(null);
    }
  }
}

function bindControls() {
  ELEMENTS.flowType.addEventListener("change", refreshDashboard);
  ELEMENTS.statusFilter.addEventListener("change", refreshDashboard);
  ELEMENTS.resetFilters.addEventListener("click", () => {
    ELEMENTS.flowType.value = "all";
    ELEMENTS.statusFilter.value = "all";
    refreshDashboard();
  });
}

async function initApp() {
  ELEMENTS.flowType = document.getElementById("flowType");
  ELEMENTS.statusFilter = document.getElementById("statusFilter");
  ELEMENTS.resetFilters = document.getElementById("resetFilters");
  ELEMENTS.kpiTotal = document.getElementById("kpiTotal");
  ELEMENTS.kpiAlerts = document.getElementById("kpiAlerts");
  ELEMENTS.kpiAvg = document.getElementById("kpiAvg");
  ELEMENTS.kpiComplete = document.getElementById("kpiComplete");
  ELEMENTS.selectedTransfer = document.getElementById("selectedTransfer");
  ELEMENTS.timeline = document.getElementById("timeline");
  ELEMENTS.timelineCode = document.getElementById("timelineCode");
  ELEMENTS.bottleneckList = document.getElementById("bottleneckList");

  // Sem Leaflet, o painel segue funcional sem o mapa: KPIs, linha do tempo e gargalos não dependem dele.
  if (await ensureLeaflet()) {
    initMap();
    drawUnits();
  }

  renderBottlenecks();
  bindControls();
  refreshDashboard();

  if (!selectedTransferId && MOOV_DATA.transfers.length) {
    selectTransfer(MOOV_DATA.transfers[0].id);
  }

  window.addEventListener("resize", () => {
    if (map) {
      map.invalidateSize(true);
    }
  });
}

document.addEventListener("DOMContentLoaded", initApp);
