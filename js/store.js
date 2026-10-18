// Registro local da demonstração: os eventos ficam SOMENTE no localStorage deste navegador.
// Nada é enviado a servidor. Sem localStorage (modo privado, bloqueio), o painel segue só leitura.
(function (global) {
  const EVENTS_KEY = "moov-demo-events-v1";
  const REQUESTS_KEY = "moov-demo-requests-v1";
  const CLOCK_KEY = "moov-demo-clock-v1";
  const MAX_NOTE = 300;
  const AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  const LOCAL_CODE = /^SOL-\d{6}-L(\d{3,6})$/; // até 999.999 solicitações locais
  const REGULATION = /^([A-Z0-9-]{3,30}|não informado)$/;
  // Veículos da frota municipal (MOOV_DATA é carregado antes deste arquivo).
  const MUNICIPAL_FLEET = () => new Set(
    (typeof MOOV_DATA !== "undefined" ? MOOV_DATA.fleet : []).filter(v => v.flowType === "municipal").map(v => v.id)
  );

  function readJson(key, fallback) {
    try {
      const raw = global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function loadEvents() {
    // Descarta registros malformados (o localStorage é compartilhado com outras páginas da mesma origem).
    const list = readJson(EVENTS_KEY, []);
    return Array.isArray(list)
      ? list.filter(e => e && typeof e.code === "string" && Object.hasOwn(MOOV_METRICS.STAGE_INDEX, e.key) &&
          typeof e.at === "string" && AT_PATTERN.test(e.at) &&
          (e.km === undefined || Number.isInteger(e.km)) &&
          (e.key === "designada" ? MUNICIPAL_FLEET().has(e.vehicleId) : e.vehicleId === undefined) &&
          (e.note === undefined || (typeof e.note === "string" && e.note.length <= MAX_NOTE)))
      : [];
  }

  // Relógio da demonstração: parte de MOOV_DATA.referenceTime e avança em tempo real
  // a partir do primeiro registro local, para que as durações façam sentido com o conjunto fictício.
  function demoNow(data) {
    const startedAt = readJson(CLOCK_KEY, null);
    const base = MOOV_METRICS.toMinutes(data.referenceTime);
    if (!Number.isFinite(startedAt) || startedAt <= 0 || startedAt > Date.now()) {
      return data.referenceTime;
    }
    const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 60000));
    return MOOV_METRICS.fromMinutes(base + elapsed);
  }

  // Solicitações abertas pela página da regulação (só metadados; as etapas ficam em EVENTS_KEY).
  function loadLocalRequests(data) {
    const list = readJson(REQUESTS_KEY, []);
    const unit = (id, type) => data.units.some(u => u.id === id && u.type === type);
    return Array.isArray(list)
      ? list.filter((r, i) => r && typeof r.code === "string" && LOCAL_CODE.test(r.code) &&
          typeof r.regulationCode === "string" && REGULATION.test(r.regulationCode) &&
          unit(r.originId, "origem") && unit(r.destinationId, "destino") &&
          list.findIndex(o => o && o.code === r.code) === i)
      : [];
  }

  // Conjunto fictício + solicitações locais, com o veículo resolvido pela designação registrada.
  function allRequests(data, events = loadEvents()) {
    const local = loadLocalRequests(data)
      .filter(r => !data.requests.some(d => d.code === r.code))
      .map(r => ({ ...r, flowType: "municipal", vehicleId: null, events: [] }));
    return [...data.requests, ...local].map(request => {
      if (request.vehicleId) return request;
      const designation = events.find(e => e.code === request.code && e.key === "designada" && e.vehicleId);
      return designation ? { ...request, vehicleId: designation.vehicleId } : request;
    });
  }

  function findRequest(data, code) {
    return allRequests(data).find(request => request.code === code) || null;
  }

  // Veículo municipal está ocupado se tem solicitação designada ainda não liberada (inclui retido no destino).
  function busyVehicles(data, events = loadEvents(), exceptCode = null) {
    const busy = new Set();
    for (const request of allRequests(data, events)) {
      if (!request.vehicleId || request.code === exceptCode) continue;
      const list = MOOV_METRICS.eventsFor(request, events);
      const last = list.length ? list[list.length - 1].key : null;
      if (last && last !== "liberado") busy.add(request.vehicleId);
    }
    return busy;
  }

  function availableVehicles(data) {
    const busy = busyVehicles(data);
    return data.fleet.filter(v => v.flowType === "municipal" && !busy.has(v.id));
  }

  function startClock() {
    if (!Number.isFinite(readJson(CLOCK_KEY, null))) {
      writeJson(CLOCK_KEY, Date.now());
    }
  }

  // Abre uma solicitação local (perfil regulação) e registra a etapa "solicitada".
  function createRequest(data, { originId, destinationId, regulationCode }) {
    const origin = data.units.find(u => u.id === originId && u.type === "origem");
    const destination = data.units.find(u => u.id === destinationId && u.type === "destino");
    if (!origin || !destination) {
      return { ok: false, error: "Selecione uma unidade de origem e uma de destino." };
    }
    const regulation = String(regulationCode || "").trim().toUpperCase();
    if (regulation && !/^[A-Z0-9-]{3,30}$/.test(regulation)) {
      return { ok: false, error: "Código de regulação inválido (letras, números e hífen)." };
    }
    // Próximo número: maior já usado em solicitações OU eventos (mesmo descartados), para nunca
    // reaproveitar um código que já tenha histórico.
    const raw = readJson(REQUESTS_KEY, []);
    const stored = Array.isArray(raw) ? raw : [];
    const rawEvents = readJson(EVENTS_KEY, []);
    const used = [...stored, ...(Array.isArray(rawEvents) ? rawEvents : [])]
      .map(item => LOCAL_CODE.exec(item && typeof item.code === "string" ? item.code : "")?.[1])
      .filter(Boolean)
      .map(Number);
    const next = (used.length ? Math.max(...used) : 0) + 1;
    if (next > 999999) {
      return { ok: false, error: "Limite de solicitações locais da demonstração atingido; apague os registros locais." };
    }
    startClock();
    const at = demoNow(data);
    const code = `SOL-${at.slice(2, 4)}${at.slice(5, 7)}${at.slice(8, 10)}-L${String(next).padStart(3, "0")}`;
    const request = { code, regulationCode: regulation || "não informado", originId, destinationId };
    const event = { code, key: "solicitada", at, profile: "regulacao" };
    // Grava o evento primeiro; se a solicitação não puder ser gravada, restaura o texto anterior exato.
    let previousRaw = null;
    try {
      previousRaw = global.localStorage.getItem(EVENTS_KEY);
    } catch {
      // Sem leitura, a gravação abaixo também falha e nada é registrado.
    }
    if (!writeJson(EVENTS_KEY, [...loadEvents(), event])) {
      return { ok: false, error: "Este navegador bloqueou o armazenamento local; nada foi registrado." };
    }
    if (!writeJson(REQUESTS_KEY, [...stored, request])) {
      let restored = false;
      try {
        if (previousRaw === null) global.localStorage.removeItem(EVENTS_KEY);
        else global.localStorage.setItem(EVENTS_KEY, previousRaw);
        restored = true;
      } catch {
        restored = false;
      }
      return {
        ok: false,
        error: restored
          ? "Este navegador bloqueou o armazenamento local; nada foi registrado."
          : "Armazenamento local falhou no meio da gravação; apague os registros locais da demonstração."
      };
    }
    return { ok: true, request, event };
  }

  // Valida e grava a próxima etapa. Retorna { ok, error?, event? }.
  function recordEvent(data, { code, key, profile, km, note, vehicleId }) {
    const request = findRequest(data, code);
    if (!request) {
      return { ok: false, error: "Código de solicitação não encontrado." };
    }
    if (request.flowType !== "municipal") {
      return { ok: false, error: "Fluxo SAMU 192 não é registrado pela frota municipal." };
    }
    if (!(MOOV_METRICS.PROFILE_STAGES[profile] || []).includes(key)) {
      return { ok: false, error: "Etapa não permitida para este perfil." };
    }
    const events = MOOV_METRICS.eventsFor(request, loadEvents());
    const next = MOOV_METRICS.nextStage(events);
    if (!next || next.key !== key) {
      return { ok: false, error: "Etapa fora de sequência; atualize a página." };
    }
    const stage = MOOV_METRICS.STAGES[MOOV_METRICS.STAGE_INDEX[key]];
    const kmValue = km === "" || km === undefined || km === null ? null : Number(km);
    if (stage.requiresKm && !(Number.isInteger(kmValue) && kmValue >= 0)) {
      return { ok: false, error: "Informe o km do hodômetro (número inteiro)." };
    }
    if (key === "designada") {
      const vehicle = data.fleet.find(v => v.id === vehicleId && v.flowType === "municipal");
      if (!vehicle) {
        return { ok: false, error: "Selecione um veículo da frota municipal." };
      }
      if (request.vehicleId && request.vehicleId !== vehicleId) {
        return { ok: false, error: `Solicitação já vinculada ao veículo ${request.vehicleId}.` };
      }
      if (busyVehicles(data, loadEvents(), code).has(vehicleId)) {
        return { ok: false, error: `${vehicleId} está em atendimento ou retido no destino.` };
      }
    }
    const previousKm = events.filter(e => Number.isFinite(e.km)).map(e => e.km).pop();
    if (stage.requiresKm && Number.isFinite(previousKm) && kmValue < previousKm) {
      return { ok: false, error: `Km menor que o registrado anteriormente (${previousKm}).` };
    }

    startClock();
    const event = {
      code,
      key,
      at: demoNow(data),
      profile,
      ...(stage.requiresKm ? { km: kmValue } : {}),
      ...(key === "designada" ? { vehicleId } : {}),
      ...(note ? { note: String(note).slice(0, MAX_NOTE) } : {})
    };
    if (!writeJson(EVENTS_KEY, [...loadEvents(), event])) {
      return { ok: false, error: "Este navegador bloqueou o armazenamento local; nada foi registrado." };
    }
    return { ok: true, event };
  }

  function resetDemo() {
    try {
      global.localStorage.removeItem(EVENTS_KEY);
      global.localStorage.removeItem(REQUESTS_KEY);
      global.localStorage.removeItem(CLOCK_KEY);
    } catch {
      // Sem armazenamento, não há o que limpar.
    }
  }

  global.MOOV_STORE = {
    EVENTS_KEY, REQUESTS_KEY, MAX_NOTE, loadEvents, loadLocalRequests, allRequests, demoNow, findRequest,
    busyVehicles, availableVehicles, createRequest, recordEvent, resetDemo
  };
})(typeof window !== "undefined" ? window : globalThis);
