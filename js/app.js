// Painel da gestão: lê o conjunto fictício + registros locais, calcula indicadores e desenha mapa esquemático.
const M = window.MOOV_METRICS;
const S = window.MOOV_STORE;

const ELEMENTS = {};
const state = { selectedCode: null, map: null, layers: [] };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function unitName(id) {
  return MOOV_DATA.units.find(unit => unit.id === id)?.name || "—";
}

function formatMin(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  if (value < 60) {
    return `${value} min`;
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
  const local = S.loadEvents();
  const now = S.demoNow(MOOV_DATA);
  const rows = MOOV_DATA.requests.map(request => {
    const events = M.eventsFor(request, local);
    return { request, events, summary: M.summarize(request, events, now, MOOV_DATA.config) };
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

function renderRequestTable(rows) {
  ELEMENTS.requestCount.textContent = `${rows.length} de ${MOOV_DATA.requests.length}`;
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
    ${s.flowType === "municipal" ? frontLinks(s.code) : ""}`;

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
        <span>${escapeHtml(stage.profile)} · ${escapeHtml(event.source)}${Number.isFinite(event.km) ? ` · km ${event.km}` : ""}${deltaText}</span>
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

  const retention = M.groupRetention(rows.map(r => r.summary), MOOV_DATA.units);
  ELEMENTS.retentionList.innerHTML = retention.length
    ? retention.map(r => `
      <div class="bottleneck-item">
        <div><strong>${escapeHtml(r.name)}</strong><span>média ${formatMin(r.mean)} · n=${r.n}${r.open ? ` · ${r.open} em aberto` : ""}</span></div>
        <div class="bottleneck-badge">${formatMin(r.totalMin)}</div>
      </div>`).join("")
    : `<p class="muted">Nenhuma chegada ao destino no recorte.</p>`;
}

function renderFleet(all) {
  const fleet = M.fleetSummary(MOOV_DATA.fleet, all.rows.map(r => r.summary), all.rows.map(r => r.events), all.now);
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

// ---------- mapa esquemático ----------

function initMap() {
  if (typeof L === "undefined") {
    const banner = document.createElement("div");
    banner.className = "map-error-banner";
    banner.setAttribute("role", "alert");
    banner.textContent = "Mapa indisponível. Indicadores, tabela e cronologia seguem funcionando.";
    document.body.prepend(banner);
    return;
  }
  state.map = L.map("map", { zoomControl: false }).setView([-20.3155, -40.3128], 12);
  L.control.zoom({ position: "bottomright" }).addTo(state.map);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
  }).addTo(state.map);

  state.map.fitBounds(L.latLngBounds(MOOV_DATA.units.map(u => u.coords)), { padding: [60, 60] });

  MOOV_DATA.units.forEach(unit => {
    const label = unit.type === "destino" ? "H" : unit.type === "origem" ? "P" : "•";
    L.marker(unit.coords, {
      icon: L.divIcon({ className: "", html: `<div class="unit-marker">${label}</div>`, iconSize: [38, 38], iconAnchor: [19, 19] }),
      title: unit.name,
      keyboard: true
    }).addTo(state.map).bindPopup(`<strong>${escapeHtml(unit.name)}</strong>`);
  });
}

function ambulanceSvg(flowType, label, alert) {
  const isSamu = flowType === "samu";
  const body = isSamu ? "#fff7e8" : "#eaffff";
  const stripe = isSamu ? "#ff7a32" : "#25e1dc";
  const cross = isSamu ? "#e84a4a" : "#169d9a";
  const safe = escapeHtml(label);
  return `
    <div class="vehicle-wrap ${flowType}${alert ? " alert" : ""}">
      <div class="vehicle-halo ${flowType}${alert ? " alert" : ""}"></div>
      <svg class="ambulance-svg" viewBox="0 0 120 86" aria-hidden="true">
        <g transform="rotate(-18 60 43)">
          <path d="M12 43 Q15 28 31 25 H67 Q79 25 87 36 L101 38 Q110 40 112 51 V62 H102 Q99 73 88 73 Q77 73 74 62 H45 Q42 73 31 73 Q20 73 17 62 H10 V51 Q10 47 12 43Z" fill="${body}" stroke="rgba(255,255,255,.9)" stroke-width="3"/>
          <path d="M68 30 H84 L95 41 H68Z" fill="#bfe8ff" opacity=".9"/>
          <path d="M22 35 H62 V57 H18 L20 43 Q21 38 22 35Z" fill="#f7ffff"/>
          <rect x="20" y="49" width="82" height="7" rx="3.5" fill="${stripe}" opacity=".96"/>
          <rect x="38" y="34" width="8" height="22" rx="2" fill="${cross}"/>
          <rect x="31" y="41" width="22" height="8" rx="2" fill="${cross}"/>
          <circle cx="31" cy="62" r="8" fill="#172536" stroke="#dceeff" stroke-width="3"/>
          <circle cx="88" cy="62" r="8" fill="#172536" stroke="#dceeff" stroke-width="3"/>
          <circle class="beacon" cx="47" cy="22" r="5" fill="#ff3159"/>
          <circle class="beacon right" cx="60" cy="22" r="5" fill="#2a9dff"/>
          <text x="58" y="47" text-anchor="middle" font-size="14" font-weight="900" fill="#102336">${isSamu ? "SAMU" : "PMV"}</text>
        </g>
      </svg>
      <div class="vehicle-label">${safe}</div>
    </div>`;
}

// Ponto esquemático: origem até o embarque, meio do trajeto após a saída, destino após a chegada.
function schematicPoint(summary) {
  const origin = MOOV_DATA.units.find(u => u.id === summary.originId)?.coords;
  const destination = MOOV_DATA.units.find(u => u.id === summary.destinationId)?.coords;
  if (!origin || !destination || !summary.vehicleId || summary.stage === "liberado") {
    return null;
  }
  const index = M.STAGE_INDEX[summary.stage];
  if (index >= M.STAGE_INDEX.chegada_destino) return destination;
  if (index >= M.STAGE_INDEX.saida_origem) return [(origin[0] + destination[0]) / 2, (origin[1] + destination[1]) / 2];
  return origin;
}

function drawMap(rows, all) {
  if (!state.map) {
    return;
  }
  state.layers.forEach(layer => layer.remove());
  state.layers = [];

  rows.forEach(({ summary: s }) => {
    const origin = MOOV_DATA.units.find(u => u.id === s.originId)?.coords;
    const destination = MOOV_DATA.units.find(u => u.id === s.destinationId)?.coords;
    if (!origin || !destination) return;
    const color = s.flowType === "samu" ? "#ffb13b" : "#25e1dc";
    const select = () => selectRequest(s.code, all.rows);
    const line = L.polyline([origin, destination], {
      color,
      weight: 4,
      opacity: s.stage === "liberado" ? 0.35 : 0.9,
      dashArray: s.alerts.length ? "8, 8" : "2, 8"
    }).addTo(state.map).on("click", select);
    state.layers.push(line);

    const point = schematicPoint(s);
    if (point) {
      const marker = L.marker(point, {
        icon: L.divIcon({ className: "", html: ambulanceSvg(s.flowType, s.vehicleId, s.alerts.length > 0), iconSize: [74, 60], iconAnchor: [37, 30] }),
        title: `${s.vehicleId} · ${s.code} · ${s.stageLabel} (posição esquemática)`,
        keyboard: true,
        zIndexOffset: 1000
      }).addTo(state.map);
      marker.on("click", select);
      state.layers.push(marker);
    }
  });
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

function exportAudit() {
  const { rows, now } = computeAll();
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
  download(`moov-resumo-solicitacoes-DEMO-${now.replace(/[:T]/g, "")}.csv`, M.toCsv(lines));
}

// ---------- ciclo ----------

function refreshDashboard() {
  const all = computeAll();
  const rows = filtered(all.rows);
  ELEMENTS.demoClock.textContent = formatTime(all.now);
  ELEMENTS.localCount.textContent = all.localCount ? `${all.localCount} registro(s) local(is) neste navegador.` : "Nenhum registro local.";
  updateKPIs(rows);
  renderRequestTable(rows);
  renderBottlenecks(rows);
  renderFleet(all);
  drawMap(rows, all);
  const keep = rows.some(r => r.summary.code === state.selectedCode);
  selectRequest(keep ? state.selectedCode : rows[0]?.summary.code ?? null, all.rows);
}

function fillSelect(select, options) {
  select.insertAdjacentHTML("beforeend", options.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join(""));
}

function initApp() {
  [
    "flowType", "stageFilter", "vehicleFilter", "destinationFilter", "resetFilters", "resetDemo", "demoClock", "localCount",
    "kpiTotal", "kpiTotalDetail", "kpiResponse", "kpiResponseDetail", "kpiTotalTime", "kpiTotalTimeDetail", "kpiRetention",
    "kpiRetentionDetail", "kpiKm", "kpiKmDetail", "kpiComplete", "kpiCompleteDetail", "selectedTransfer", "timeline",
    "timelineCode", "bottleneckList", "retentionList", "requestTable", "requestCount", "fleetTable", "exportAudit",
    "exportSummary", "cfgRetention", "cfgUnassigned"
  ].forEach(id => { ELEMENTS[id] = document.getElementById(id); });

  fillSelect(ELEMENTS.stageFilter, M.STAGES.map(s => [s.key, s.label]));
  fillSelect(ELEMENTS.vehicleFilter, MOOV_DATA.fleet.map(v => [v.id, `${v.id} · ${flowLabel(v.flowType)}`]));
  fillSelect(ELEMENTS.destinationFilter, MOOV_DATA.units.filter(u => u.type === "destino").map(u => [u.id, u.name]));
  ELEMENTS.cfgRetention.textContent = MOOV_DATA.config.retentionAlertMin;
  ELEMENTS.cfgUnassigned.textContent = MOOV_DATA.config.unassignedAlertMin;

  initMap();

  ["flowType", "stageFilter", "vehicleFilter", "destinationFilter"].forEach(id => ELEMENTS[id].addEventListener("change", refreshDashboard));
  ELEMENTS.resetFilters.addEventListener("click", () => {
    ["flowType", "stageFilter", "vehicleFilter", "destinationFilter"].forEach(id => { ELEMENTS[id].value = "all"; });
    refreshDashboard();
  });
  ELEMENTS.resetDemo.addEventListener("click", () => {
    S.resetDemo();
    refreshDashboard();
  });
  ELEMENTS.requestTable.addEventListener("click", event => {
    const button = event.target.closest("[data-select]");
    if (button) selectRequest(button.dataset.select, computeAll().rows);
  });
  ELEMENTS.exportAudit.addEventListener("click", exportAudit);
  ELEMENTS.exportSummary.addEventListener("click", exportSummary);

  // Registros feitos em outra aba (páginas da ponta) atualizam o painel.
  window.addEventListener("storage", event => {
    if (event.key === null || event.key.startsWith("moov-demo-")) refreshDashboard();
  });
  window.addEventListener("resize", () => state.map?.invalidateSize());
  // O relógio da demonstração avança após o primeiro registro local; recalcula a cada minuto.
  setInterval(refreshDashboard, 60000);

  refreshDashboard();
}

document.addEventListener("DOMContentLoaded", initApp);
