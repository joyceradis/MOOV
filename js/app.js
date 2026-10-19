// Painel da gestão: calcula indicadores e desenha o mapa ao vivo (posição esquemática, trajeto pelas ruas).
// Conectado ao servidor (MOOV_API), lê /api/dashboard após login; senão, conjunto fictício + registros locais.
const M = window.MOOV_METRICS;
const S = window.MOOV_STORE;
const API = window.MOOV_API;
const R = window.MOOV_ROUTES;

const ELEMENTS = {};
const state = { selectedCode: null, map: null, layers: [], markers: new Map() };
// Fonte de unidades, frota e parâmetros: conjunto fictício ou servidor.
let DATA = MOOV_DATA;
// Modo conectado: usuário logado e último retrato do servidor.
const live = { user: null, dashboard: null };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function unitName(id) {
  return DATA.units.find(unit => unit.id === id)?.name || "—";
}

function formatMin(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  if (value < 60) {
    return `${value} min`;
  }
  if (value >= 2 * 1440) {
    return `${Math.floor(value / 1440)} d ${Math.floor((value % 1440) / 60)} h`;
  }
  return `${Math.floor(value / 60)} h ${String(value % 60).padStart(2, "0")} min`;
}

function formatTime(iso) {
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}` : "—";
}

function flowLabel(flowType) {
  return flowType === "samu" ? "SAMU 192" : "Municipal";
}

// ---------- dados derivados ----------

function computeAll() {
  if (live.dashboard) {
    const rows = live.dashboard.requests.map(request => ({ request, events: request.events, summary: request.summary }));
    return { rows, now: live.dashboard.now, localCount: 0 };
  }
  const local = S.loadEvents();
  const now = S.demoNow(DATA);
  const rows = S.allRequests(DATA, local).map(request => {
    const events = M.eventsFor(request, local);
    return { request, events, summary: M.summarize(request, events, now, DATA.config) };
  });
  return { rows, now, localCount: local.length };
}

function filtered(rows) {
  const f = {
    flow: ELEMENTS.flowType.value,
    stage: ELEMENTS.stageFilter.value,
    vehicle: ELEMENTS.vehicleFilter.value,
    destination: ELEMENTS.destinationFilter.value
  };
  return rows.filter(({ summary: s }) =>
    (f.flow === "all" || s.flowType === f.flow) &&
    (f.stage === "all" || s.stage === f.stage) &&
    (f.vehicle === "all" || s.vehicleId === f.vehicle) &&
    (f.destination === "all" || s.destinationId === f.destination)
  );
}

// ---------- KPIs ----------

// Indicadores de frota usam só a frota municipal; SAMU 192 é contado à parte.
function updateKPIs(rows) {
  const summaries = rows.map(r => r.summary).filter(s => s.municipal);
  const samu = rows.length - summaries.length;
  const response = M.mean(summaries.map(s => s.responseMin));
  const total = M.mean(summaries.filter(s => s.finished).map(s => s.totalMin));
  const retention = summaries.map(s => s.retentionMin).filter(Number.isFinite);
  const km = summaries.map(s => s.km).filter(Number.isFinite);
  const done = summaries.reduce((a, s) => a + s.completeness.done, 0);
  const required = summaries.reduce((a, s) => a + s.completeness.total, 0);
  const alerts = summaries.filter(s => s.alerts.length).length;

  ELEMENTS.kpiTotal.textContent = String(summaries.length);
  ELEMENTS.kpiTotalDetail.textContent = `frota municipal · ${alerts ? `${alerts} com alerta` : "nenhuma com alerta"}` +
    (samu ? ` · +${samu} SAMU 192 fora dos indicadores` : "");
  ELEMENTS.kpiResponse.textContent = formatMin(response.mean);
  ELEMENTS.kpiResponseDetail.textContent = `solicitação → chegada à origem · n=${response.n}`;
  ELEMENTS.kpiTotalTime.textContent = formatMin(total.mean);
  ELEMENTS.kpiTotalTimeDetail.textContent = `solicitação → recebimento · n=${total.n}`;
  ELEMENTS.kpiRetention.textContent = formatMin(retention.reduce((a, b) => a + b, 0) || (retention.length ? 0 : null));
  ELEMENTS.kpiRetentionDetail.textContent = `acumulado · ${summaries.filter(s => s.retentionOpen).length} em aberto`;
  ELEMENTS.kpiKm.textContent = km.length ? `${km.reduce((a, b) => a + b, 0)} km` : "—";
  ELEMENTS.kpiKmDetail.textContent = `${km.length} de ${summaries.filter(s => s.stage && M.STAGE_INDEX[s.stage] >= M.STAGE_INDEX.chegada_destino).length} trajetos com km completo`;
  ELEMENTS.kpiComplete.textContent = required ? `${Math.round((done / required) * 100)}%` : "—";
  ELEMENTS.kpiCompleteDetail.textContent = `${done} de ${required} registros exigidos`;
}

// ---------- tabela de solicitações ----------

function renderRequestTable(rows, total) {
  ELEMENTS.requestCount.textContent = `${rows.length} de ${total}`;
  const body = ELEMENTS.requestTable.querySelector("tbody");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="9" class="muted">Nenhuma solicitação no recorte filtrado.</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(({ summary: s }) => {
    const c = s.completeness;
    return `
      <tr class="${s.code === state.selectedCode ? "selected" : ""} ${s.alerts.length ? "has-alert" : ""}" data-code="${escapeHtml(s.code)}">
        <th scope="row"><button type="button" class="link-button" data-select="${escapeHtml(s.code)}" aria-pressed="${s.code === state.selectedCode}">${escapeHtml(s.code)}</button></th>
        <td><span class="flow-tag ${escapeHtml(s.flowType)}">${flowLabel(s.flowType)}</span></td>
        <td>${escapeHtml(s.vehicleId || "não designado")}</td>
        <td>${escapeHtml(unitName(s.originId))} → ${escapeHtml(unitName(s.destinationId))}</td>
        <td>${escapeHtml(s.stageLabel)}${s.alerts.length ? `<br><small class="alert-text">${escapeHtml(s.alerts.join("; "))}</small>` : ""}</td>
        <td>${formatMin(s.totalMin)}${s.finished ? "" : " <small>(em curso)</small>"}</td>
        <td>${formatMin(s.retentionMin)}${s.retentionOpen ? " <small>(aberta)</small>" : ""}</td>
        <td>${Number.isFinite(s.km) ? `${s.km}` : "—"}</td>
        <td>${c.total ? `${c.done}/${c.total}` : "—"}</td>
      </tr>`;
  }).join("");
}

// ---------- seleção e cronologia ----------

function frontLinks(code) {
  const q = encodeURIComponent(code);
  return `
    <div class="front-links">
      <small>Páginas da ponta para este código</small>
      <a href="./pages/motorista.html?codigo=${q}">Motorista</a>
      <a href="./pages/enfermagem.html?codigo=${q}">Equipe</a>
      <a href="./pages/destino.html?codigo=${q}">Destino</a>
    </div>`;
}

function renderSelected(row) {
  if (!row) {
    ELEMENTS.selectedTransfer.innerHTML = `
      <p class="eyebrow">Solicitação selecionada</p>
      <h3>Nenhuma solicitação no recorte</h3>
      <p class="muted">Ajuste os filtros ou selecione um código na tabela.</p>`;
    ELEMENTS.timelineCode.textContent = "Sem seleção";
    ELEMENTS.timeline.className = "chronology empty";
    ELEMENTS.timeline.innerHTML = "<li>Selecione uma solicitação.</li>";
    return;
  }
  const s = row.summary;
  ELEMENTS.selectedTransfer.innerHTML = `
    <p class="eyebrow">${s.flowType === "samu" ? "SAMU 192 — identificado, fora da frota municipal" : "Frota municipal — governança do contrato"}</p>
    <h3>${escapeHtml(s.code)}</h3>
    <p class="muted">${escapeHtml(unitName(s.originId))} → ${escapeHtml(unitName(s.destinationId))} · regulação ${escapeHtml(s.regulationCode)}</p>
    <div class="transfer-meta">
      <div><small>Etapa</small><b>${escapeHtml(s.stageLabel)}</b></div>
      <div><small>Veículo</small><b>${escapeHtml(s.vehicleId || "não designado")}</b></div>
      <div><small>Próxima etapa</small><b>${escapeHtml(s.next ? s.next.label : "Concluída")}</b></div>
      <div><small>Lastro</small><b>${s.completeness.total ? `${s.completeness.done}/${s.completeness.total}` : "—"}</b></div>
    </div>
    ${s.flowType === "municipal" && !live.user ? frontLinks(s.code) : ""}`;
  if (s.flowType === "municipal" && live.user) {
    // Conectado: links da ponta são individuais e emitidos pela regulação.
    ELEMENTS.selectedTransfer.append(live.user.role === "regulacao"
      ? API.frontLinksBlock(s.code)
      : API.el("p", { class: "muted small front-links-note", text: "Os links da ponta (motorista, equipe, destino) são emitidos pela regulação." }));
  }

  ELEMENTS.timelineCode.textContent = s.code;
  ELEMENTS.timeline.className = "chronology";
  const items = row.events.map((event, i) => {
    const stage = M.STAGES[M.STAGE_INDEX[event.key]];
    const delta = i ? M.minutesBetween(row.events[i - 1].at, event.at) : null;
    const deltaText = delta === null ? "" : delta < 0 ? " · inconsistência: horário anterior à etapa precedente" : ` · +${formatMin(delta)}`;
    return `
      <li class="done">
        <time datetime="${escapeHtml(event.at)}">${escapeHtml(formatTime(event.at))}</time>
        <strong>${escapeHtml(stage.label)}</strong>
        <span>${escapeHtml(stage.profile)} · ${escapeHtml(event.actor || event.source)}${Number.isFinite(event.km) ? ` · km ${event.km}` : ""}${deltaText}</span>
        ${event.note ? `<em>${escapeHtml(event.note)}</em>` : ""}
      </li>`;
  });
  if (s.next) {
    items.push(`
      <li class="pending">
        <time>—</time>
        <strong>${escapeHtml(s.next.label)}</strong>
        <span>Aguardando registro · ${escapeHtml(s.next.profile)}</span>
      </li>`);
  }
  const gaps = s.completeness.missing.map(m => `<li class="gap"><strong>Lacuna</strong><span>${escapeHtml(m)}</span></li>`);
  ELEMENTS.timeline.innerHTML = items.join("") + gaps.join("");
}

function selectRequest(code, rows) {
  state.selectedCode = code;
  renderSelected(rows.find(r => r.summary.code === code) || null);
  ELEMENTS.requestTable.querySelectorAll("tbody tr").forEach(tr => {
    const on = tr.dataset.code === code;
    tr.classList.toggle("selected", on);
    tr.querySelector("[data-select]")?.setAttribute("aria-pressed", String(on));
  });
  ELEMENTS.fleetLive.querySelectorAll("[data-focus]").forEach(button => {
    button.classList.toggle("selected", button.dataset.focus === code);
  });
  markSelectedMarker(code);
}

// ---------- gargalos e frota ----------

function renderBottlenecks(allRows) {
  const rows = allRows.filter(r => r.summary.municipal);
  const durations = M.stageDurations(rows.map(r => r.events)).filter(d => d.n).sort((a, b) => b.mean - a.mean);
  ELEMENTS.bottleneckList.innerHTML = durations.length
    ? durations.slice(0, 4).map(d => `
      <div class="bottleneck-item">
        <div><strong>${escapeHtml(d.label)}</strong><span>média de ${d.n} registro(s)</span></div>
        <div class="bottleneck-badge">${formatMin(d.mean)}</div>
      </div>`).join("")
    : `<p class="muted">Sem pares de etapas registrados no recorte.</p>`;

  const retention = M.groupRetention(rows.map(r => r.summary), DATA.units);
  ELEMENTS.retentionList.innerHTML = retention.length
    ? retention.map(r => `
      <div class="bottleneck-item">
        <div><strong>${escapeHtml(r.name)}</strong><span>média ${formatMin(r.mean)} · n=${r.n}${r.open ? ` · ${r.open} em aberto` : ""}</span></div>
        <div class="bottleneck-badge">${formatMin(r.totalMin)}</div>
      </div>`).join("")
    : `<p class="muted">Nenhuma chegada ao destino no recorte.</p>`;
}

function renderFleet(all) {
  const fleet = M.fleetSummary(DATA.fleet, all.rows.map(r => r.summary), all.rows.map(r => r.events), all.now);
  ELEMENTS.fleetTable.querySelector("tbody").innerHTML = fleet.map(v => `
    <tr>
      <th scope="row">${escapeHtml(v.id)}</th>
      <td>${escapeHtml(v.type)}</td>
      <td>${v.requests}</td>
      <td>${formatMin(v.serviceMin)}</td>
      <td>${formatMin(v.retentionMin)}</td>
      <td>${v.km === null ? "—" : `${v.km} km`}${v.kmMissing ? ` <small class="alert-text">(${v.kmMissing} sem km)</small>` : ""}</td>
      <td>${v.current ? `Em atendimento: ${escapeHtml(v.current)}` : "Disponível"}</td>
    </tr>`).join("");
}

// ---------- ao vivo: mapa e frota municipal ----------

// Ícone de ambulância (vista lateral), herda a cor do marcador; a cruz usa a classe .cross.
const AMBULANCE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M2.5 7.2c0-.94.76-1.7 1.7-1.7h9.6c.94 0 1.7.76 1.7 1.7V9h2.9c.55 0 1.06.26 1.38.7l1.9 2.6c.2.28.32.62.32.97V16c0 .55-.45 1-1 1h-.85a2.6 2.6 0 0 0-5.1 0H9.95a2.6 2.6 0 0 0-5.1 0H3.5c-.55 0-1-.45-1-1Z" fill="currentColor"/>
  <path class="cross" d="M7.7 7.6h1.9v1.9h1.9v1.9H9.6v1.9H7.7v-1.9H5.8V9.5h1.9Z"/>
  <path class="window" d="M16.2 10.3h2.1l1.5 2.1h-3.6Z"/>
  <circle cx="7.4" cy="17.3" r="1.7" fill="currentColor"/><circle cx="17.6" cy="17.3" r="1.7" fill="currentColor"/>
</svg>`;

const ROUTE = { municipal: "#0d9488", alert: "#dc2626", samu: "#94a3b8", casing: "#ffffff" };

function unitCoords(id) {
  return DATA.units.find(u => u.id === id)?.coords;
}

// Espaço ocupado pelos painéis sobre o mapa (desktop), para enquadrar as unidades na área livre.
function mapPadding() {
  return window.innerWidth > 1100
    ? { paddingTopLeft: [380, 90], paddingBottomRight: [440, 50] }
    : { padding: [36, 36] };
}

function initMap() {
  if (typeof L === "undefined") {
    const banner = document.createElement("div");
    banner.className = "map-error-banner";
    banner.setAttribute("role", "alert");
    banner.textContent = "Mapa indisponível. Indicadores, tabela e cronologia seguem funcionando.";
    document.body.prepend(banner);
    return;
  }
  state.map = L.map("map", { zoomControl: false, zoomSnap: 0.25 }).setView([-20.3155, -40.3128], 12);
  L.control.zoom({ position: "topright" }).addTo(state.map);
  // Tiles do OpenStreetMap (sem chave). A política de uso do OSM exige atribuição e Referer válido:
  // as páginas usam no-referrer, então só as imagens de tile enviam a origem.
  // O visual claro e dessaturado vem de filtro CSS em .leaflet-tile-pane.
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    referrerPolicy: "strict-origin-when-cross-origin",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">colaboradores do OpenStreetMap</a> · rotas <a href="https://project-osrm.org/">OSRM</a>'
  }).addTo(state.map);

  state.map.fitBounds(L.latLngBounds(DATA.units.map(u => u.coords)), mapPadding());

  DATA.units.forEach(unit => {
    const label = unit.type === "destino" ? "H" : unit.type === "origem" ? "PA" : "";
    const size = unit.type === "ocorrencia" ? 14 : 30;
    L.marker(unit.coords, {
      icon: L.divIcon({ className: "", html: `<div class="unit-marker ${unit.type}">${label}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
      title: unit.name,
      keyboard: true
    }).addTo(state.map).bindPopup(`<strong>${escapeHtml(unit.name)}</strong>`);
  });
}

// Marcador do veículo: municipal grande e pulsante; SAMU 192 pequeno e neutro.
function vehicleHtml(s, selected) {
  const kind = s.flowType === "samu" ? "samu" : "municipal";
  return `
    <div class="vehicle-wrap ${kind}${s.alerts.length ? " alert" : ""}${selected ? " selected" : ""}">
      ${kind === "municipal" ? '<span class="vehicle-pulse"></span>' : ""}
      <span class="vehicle-dot">${AMBULANCE_ICON}</span>
      <span class="vehicle-label">${escapeHtml(s.vehicleId)}</span>
    </div>`;
}

// Progresso esquemático no trajeto: origem até o embarque, metade após a saída, destino após a chegada.
function progressOf(summary) {
  const index = M.STAGE_INDEX[summary.stage];
  if (index >= M.STAGE_INDEX.chegada_destino) return 1;
  if (index >= M.STAGE_INDEX.saida_origem) return 0.5;
  return 0;
}

// Posição do veículo e trajeto pelas ruas dividido em percorrido/restante.
// Sem a rota pelas ruas, não há linha (nada de reta sobre o mar) e o veículo fica na unidade da última etapa.
function placement(summary) {
  const origin = unitCoords(summary.originId);
  const destination = unitCoords(summary.destinationId);
  if (!origin || !destination) return null;
  const route = R.get(origin, destination);
  const progress = progressOf(summary);
  const hasVehicle = Boolean(summary.vehicleId);
  if (!route) {
    return { done: [], rest: [], point: hasVehicle ? (progress === 1 ? destination : origin) : null };
  }
  if (!hasVehicle || progress === 0) return { done: [], rest: route, point: hasVehicle ? origin : null };
  if (progress === 1) return { done: route, rest: [], point: destination };
  const { point, index } = R.along(route, progress);
  return { done: [...route.slice(0, index), point], rest: [point, ...route.slice(index)], point };
}

function addLine(coords, options, onClick) {
  if (coords.length < 2) return null;
  const line = L.polyline(coords, options).addTo(state.map);
  if (onClick) line.on("click", onClick);
  state.layers.push(line);
  return line;
}

// Mapa ao vivo: todas as solicitações em curso (independe dos filtros da gestão).
// Rota municipal no estilo de navegação: trecho percorrido cheio, restante tracejado.
function drawMap(all) {
  if (!state.map) {
    return;
  }
  state.layers.forEach(layer => layer.remove());
  state.layers = [];
  state.markers = new Map();

  all.rows.forEach(({ summary: s }) => {
    if (s.stage === "liberado") return;
    const place = placement(s);
    if (!place) return;
    const select = () => selectRequest(s.code, all.rows);
    const samu = s.flowType === "samu";

    if (samu) {
      addLine([...place.done, ...place.rest], { color: ROUTE.samu, weight: 3, opacity: .7, dashArray: "4 8" }, select);
    } else {
      const color = s.alerts.length ? ROUTE.alert : ROUTE.municipal;
      addLine(place.done, { color: ROUTE.casing, weight: 10, opacity: .95 });
      addLine(place.done, { color, weight: 6, opacity: 1 }, select);
      addLine(place.rest, { color: ROUTE.casing, weight: 8, opacity: .8 });
      addLine(place.rest, { color, weight: 4, opacity: place.point ? .6 : .4, dashArray: "1 9", lineCap: "round" }, select);
    }

    if (place.point && s.vehicleId) {
      const size = samu ? 30 : 46;
      const marker = L.marker(place.point, {
        icon: L.divIcon({ className: "", html: vehicleHtml(s, s.code === state.selectedCode), iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
        title: `${s.vehicleId} · ${s.code} · ${s.stageLabel} (posição esquemática)`,
        keyboard: true,
        zIndexOffset: samu ? 500 : 1000
      }).addTo(state.map);
      marker.on("click", select);
      state.layers.push(marker);
      state.markers.set(s.code, marker);
    }
  });
}

// Pede as rotas pelas ruas que faltam e redesenha quando chegam.
function loadRoutes(all) {
  if (!state.map) return;
  const pairs = all.rows
    .filter(r => r.summary.stage !== "liberado")
    .map(r => [unitCoords(r.summary.originId), unitCoords(r.summary.destinationId)]);
  R.ensure(pairs).then(added => {
    if (added) {
      drawMap(computeAll());
      markSelectedMarker(state.selectedCode);
    }
  });
}

// Centraliza o mapa na solicitação (veículo ou rota).
function focusRequest(code, rows) {
  if (!state.map) return;
  const marker = state.markers?.get(code);
  if (marker) {
    state.map.flyTo(marker.getLatLng(), Math.max(state.map.getZoom(), 14), { duration: .6 });
    return;
  }
  const s = rows.find(r => r.summary.code === code)?.summary;
  const route = s && [unitCoords(s.originId), unitCoords(s.destinationId)].filter(Boolean);
  if (route?.length) state.map.flyToBounds(L.latLngBounds(route), { ...mapPadding(), duration: .6 });
}

function markSelectedMarker(code) {
  state.markers?.forEach((marker, key) => {
    marker.getElement()?.querySelector(".vehicle-wrap")?.classList.toggle("selected", key === code);
  });
}

// Situação de cada ambulância municipal + solicitações sem veículo, para o painel ao vivo.
function liveFleet(all) {
  const active = all.rows.map(r => r.summary).filter(s => s.stage && s.stage !== "liberado");
  const municipal = active.filter(s => s.municipal);
  const vehicles = DATA.fleet.filter(v => v.flowType === "municipal").map(vehicle => {
    const s = municipal.find(x => x.vehicleId === vehicle.id) || null;
    return { vehicle, s, status: !s ? "free" : s.alerts.length ? "alert" : "busy" };
  });
  const waiting = municipal.filter(s => !s.vehicleId);
  const order = { alert: 0, busy: 1, free: 2 };
  vehicles.sort((a, b) => order[a.status] - order[b.status] || a.vehicle.id.localeCompare(b.vehicle.id));
  return { vehicles, waiting, samu: active.filter(s => !s.municipal) };
}

function renderLive(all) {
  const { vehicles, waiting, samu } = liveFleet(all);
  ELEMENTS.liveBusy.textContent = String(vehicles.filter(v => v.s).length);
  ELEMENTS.liveFree.textContent = String(vehicles.filter(v => !v.s).length);
  ELEMENTS.liveAlerts.textContent = String(vehicles.filter(v => v.status === "alert").length + waiting.filter(s => s.alerts.length).length);
  ELEMENTS.liveAlerts.parentElement.hidden = ELEMENTS.liveAlerts.textContent === "0";

  const card = (code, status, title, line1, line2, badge) => `
    <li>
      <button type="button" class="fleet-card ${status}${code && code === state.selectedCode ? " selected" : ""}" ${code ? `data-focus="${escapeHtml(code)}"` : "disabled"}>
        <span class="fleet-icon">${AMBULANCE_ICON}</span>
        <span class="fleet-info">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(line1)}</span>
          ${line2 ? `<small>${escapeHtml(line2)}</small>` : ""}
        </span>
        ${badge ? `<span class="fleet-badge">${escapeHtml(badge)}</span>` : ""}
      </button>
    </li>`;

  ELEMENTS.fleetLive.innerHTML = [
    ...waiting.map(s => card(s.code, s.alerts.length ? "alert waiting" : "waiting", "Aguardando veículo",
      `${unitName(s.originId)} → ${unitName(s.destinationId)}`, s.code, formatMin(s.totalMin))),
    ...vehicles.map(({ vehicle, s, status }) => s
      ? card(s.code, status, vehicle.id,
        s.retentionOpen ? `Retido no destino há ${formatMin(s.retentionMin)}` : s.stageLabel,
        `${unitName(s.originId)} → ${unitName(s.destinationId)}`, formatMin(s.totalMin))
      : card(null, "free", vehicle.id, "Disponível", vehicle.type, ""))
  ].join("");
  ELEMENTS.samuLive.textContent = samu.length
    ? `${samu.length} atendimento(s) SAMU 192 no mapa, em cinza: fora da frota municipal.`
    : "";
}

// ---------- exportação ----------

function download(filename, text) {
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportAudit() {
  const { rows, now } = computeAll();
  if (live.user) {
    // Conectado: a trilha vem do servidor, com autoria, e a exportação fica registrada no log de acesso.
    try {
      const csv = await API.call("GET", "/api/export/audit.csv");
      download(`moov-trilha-auditoria-${now.replace(/[:T]/g, "")}.csv`, String(csv).replace(/^﻿/, ""));
    } catch (error) {
      ELEMENTS.localCount.textContent = `Exportação não concluída: ${error.message}`;
    }
    return;
  }
  const lines = [["codigo", "regulacao", "fluxo", "veiculo", "origem", "destino", "etapa", "horario", "perfil", "km", "fonte", "observacao"]];
  filtered(rows).forEach(({ request, events }) => events.forEach(e => lines.push([
    request.code, request.regulationCode, request.flowType, request.vehicleId || "", unitName(request.originId),
    unitName(request.destinationId), M.stageLabel(e.key), e.at, M.STAGES[M.STAGE_INDEX[e.key]].profile,
    Number.isFinite(e.km) ? e.km : "", e.source, e.note || ""
  ])));
  download(`moov-trilha-auditoria-DEMO-${now.replace(/[:T]/g, "")}.csv`, M.toCsv(lines));
}

function exportSummary() {
  const { rows, now } = computeAll();
  const lines = [["codigo", "regulacao", "fluxo", "veiculo", "origem", "destino", "etapa_atual", "tempo_total_min", "concluida", "resposta_min", "retencao_min", "retencao_aberta", "km", "lastro_presente", "lastro_exigido", "lacunas", "alertas"]];
  filtered(rows).forEach(({ summary: s }) => lines.push([
    s.code, s.regulationCode, s.flowType, s.vehicleId || "", unitName(s.originId), unitName(s.destinationId), s.stageLabel,
    s.totalMin, s.finished ? "sim" : "nao", s.responseMin ?? "", s.retentionMin ?? "", s.retentionOpen ? "sim" : "nao",
    s.km ?? "", s.completeness.done, s.completeness.total, s.completeness.missing.join(" | "), s.alerts.join(" | ")
  ]));
  download(`moov-resumo-solicitacoes-${live.user ? "" : "DEMO-"}${now.replace(/[:T]/g, "")}.csv`, M.toCsv(lines));
}

// ---------- relatório para impressão ----------

function selectedText(select) {
  return select.options[select.selectedIndex]?.textContent || "Todos";
}

// Cabeçalho do relatório: recorte aplicado, relógio, data de geração e indicadores do painel.
function renderPrintHeader() {
  const generated = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const kpis = [...document.querySelectorAll(".metrics article")].map(article => `
    <div><small>${escapeHtml(article.querySelector("small").textContent)}</small>
    <b>${escapeHtml(article.querySelector("strong").textContent)}</b>
    <span>${escapeHtml(article.querySelector("span").textContent)}</span></div>`).join("");
  document.getElementById("printHeader").innerHTML = `
    <h1>MOOV · Relatório de governança da frota</h1>
    <p>Recorte: fluxo ${escapeHtml(selectedText(ELEMENTS.flowType))} · etapa ${escapeHtml(selectedText(ELEMENTS.stageFilter))} ·
      veículo ${escapeHtml(selectedText(ELEMENTS.vehicleFilter))} · destino ${escapeHtml(selectedText(ELEMENTS.destinationFilter))}</p>
    <p>${live.user ? "Horário do servidor" : "Relógio da demonstração"}: ${escapeHtml(ELEMENTS.demoClock.textContent)} · gerado em ${escapeHtml(generated)}</p>
    <div class="print-kpis">${kpis}</div>
    <p class="print-small">Definições e limites metodológicos ao final. SAMU 192 fora dos indicadores da frota municipal.
      A tabela de frota considera todas as solicitações do conjunto, independentemente do recorte.</p>`;
}

// ---------- ciclo ----------

function refreshDashboard() {
  const all = computeAll();
  const rows = filtered(all.rows);
  ELEMENTS.demoClock.textContent = formatTime(all.now);
  ELEMENTS.localCount.textContent = live.user
    ? `Conectado como ${live.user.username} · ${API.ROLE_LABEL[live.user.role] || live.user.role}`
    : all.localCount ? `${all.localCount} registro(s) local(is) neste navegador.` : "Nenhum registro local.";
  updateKPIs(rows);
  renderRequestTable(rows, all.rows.length);
  renderBottlenecks(rows);
  renderFleet(all);
  drawMap(all);
  loadRoutes(all);
  renderLive(all);
  const keep = rows.some(r => r.summary.code === state.selectedCode);
  selectRequest(keep ? state.selectedCode : rows[0]?.summary.code ?? null, all.rows);
}

function fillSelect(select, options) {
  select.insertAdjacentHTML("beforeend", options.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join(""));
}

// Busca o retrato atual no servidor e redesenha.
async function reloadLive() {
  try {
    live.dashboard = await API.call("GET", "/api/dashboard");
    refreshDashboard();
  } catch (error) {
    ELEMENTS.localCount.textContent = `Não foi possível atualizar: ${error.message}`;
  }
}

// Textos e controles do modo conectado (o HTML estático descreve a demonstração).
function applyLiveChrome(user) {
  document.body.classList.add("is-live");
  const notice = document.querySelector(".demo-notice");
  notice.classList.add("live");
  notice.replaceChildren(API.el("strong", { text: "Conectado ao servidor MOOV" }),
    " · cada registro entra na trilha de auditoria e aparece para toda a equipe.");
  document.getElementById("contextLabel").textContent = "Ambiente conectado";
  document.getElementById("clockLabel").textContent = "Horário do servidor";
  ELEMENTS.resetDemo.textContent = "Sair";
  // Exportação da trilha completa é da gestão e da administração.
  ELEMENTS.exportAudit.hidden = user.role === "regulacao";
}

async function initApp() {
  [
    "flowType", "stageFilter", "vehicleFilter", "destinationFilter", "resetFilters", "resetDemo", "demoClock", "localCount",
    "kpiTotal", "kpiTotalDetail", "kpiResponse", "kpiResponseDetail", "kpiTotalTime", "kpiTotalTimeDetail", "kpiRetention",
    "kpiRetentionDetail", "kpiKm", "kpiKmDetail", "kpiComplete", "kpiCompleteDetail", "selectedTransfer", "timeline",
    "timelineCode", "bottleneckList", "retentionList", "requestTable", "requestCount", "fleetTable", "exportAudit",
    "exportSummary", "printReport", "cfgRetention", "cfgUnassigned", "fleetLive", "samuLive", "liveBusy", "liveFree",
    "liveAlerts"
  ].forEach(id => { ELEMENTS[id] = document.getElementById(id); });

  if (await API.detect()) {
    live.user = await API.ensureLogin(["admin", "gestor", "regulacao"], "Painel de governança da frota.");
    try {
      live.dashboard = await API.call("GET", "/api/dashboard");
    } catch (error) {
      ELEMENTS.localCount.textContent = `Não foi possível carregar os dados: ${error.message}`;
      return;
    }
    DATA = { units: live.dashboard.units, fleet: live.dashboard.fleet, config: live.dashboard.config };
    applyLiveChrome(live.user);
  }

  fillSelect(ELEMENTS.stageFilter, M.STAGES.map(s => [s.key, s.label]));
  fillSelect(ELEMENTS.vehicleFilter, DATA.fleet.map(v => [v.id, `${v.id} · ${flowLabel(v.flowType)}`]));
  fillSelect(ELEMENTS.destinationFilter, DATA.units.filter(u => u.type === "destino").map(u => [u.id, u.name]));
  ELEMENTS.cfgRetention.textContent = DATA.config.retentionAlertMin;
  ELEMENTS.cfgUnassigned.textContent = DATA.config.unassignedAlertMin;

  initMap();

  ["flowType", "stageFilter", "vehicleFilter", "destinationFilter"].forEach(id => ELEMENTS[id].addEventListener("change", refreshDashboard));
  ELEMENTS.resetFilters.addEventListener("click", () => {
    ["flowType", "stageFilter", "vehicleFilter", "destinationFilter"].forEach(id => { ELEMENTS[id].value = "all"; });
    refreshDashboard();
  });
  ELEMENTS.resetDemo.addEventListener("click", () => {
    if (live.user) {
      API.logout();
      return;
    }
    S.resetDemo();
    refreshDashboard();
  });
  // Tabela da gestão: seleciona e leva ao mapa, onde fica o detalhe da solicitação.
  ELEMENTS.requestTable.addEventListener("click", event => {
    const button = event.target.closest("[data-select]");
    if (!button) return;
    const { rows } = computeAll();
    selectRequest(button.dataset.select, rows);
    document.getElementById("aoVivo").scrollIntoView({ behavior: "smooth", block: "start" });
    focusRequest(button.dataset.select, rows);
  });
  // Painel ao vivo: seleciona a ambulância e centraliza o mapa nela.
  ELEMENTS.fleetLive.addEventListener("click", event => {
    const button = event.target.closest("[data-focus]");
    if (!button) return;
    const { rows } = computeAll();
    selectRequest(button.dataset.focus, rows);
    focusRequest(button.dataset.focus, rows);
    // No celular o detalhe fica abaixo da lista.
    if (window.innerWidth <= 1100) document.querySelector(".detail-card").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  ELEMENTS.exportAudit.addEventListener("click", exportAudit);
  ELEMENTS.exportSummary.addEventListener("click", exportSummary);
  ELEMENTS.printReport.addEventListener("click", () => window.print());
  window.addEventListener("beforeprint", () => {
    refreshDashboard();
    renderPrintHeader();
  });

  window.addEventListener("resize", () => state.map?.invalidateSize());
  if (live.user) {
    // Registros da regulação e da ponta chegam pelo servidor: atualiza a cada 30 s.
    setInterval(reloadLive, 30000);
  } else {
    // Registros feitos em outra aba (páginas da ponta) atualizam o painel.
    window.addEventListener("storage", event => {
      if (event.key === null || event.key.startsWith("moov-demo-")) refreshDashboard();
    });
    // O relógio da demonstração avança após o primeiro registro local; recalcula a cada minuto.
    setInterval(refreshDashboard, 60000);
  }

  refreshDashboard();
}

document.addEventListener("DOMContentLoaded", initApp);
