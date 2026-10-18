// Registro local da demonstração: os eventos ficam SOMENTE no localStorage deste navegador.
// Nada é enviado a servidor. Sem localStorage (modo privado, bloqueio), o painel segue só leitura.
(function (global) {
  const EVENTS_KEY = "moov-demo-events-v1";
  const CLOCK_KEY = "moov-demo-clock-v1";
  const MAX_NOTE = 300;
  const AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

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

  function findRequest(data, code) {
    return data.requests.find(request => request.code === code) || null;
  }

  // Valida e grava a próxima etapa. Retorna { ok, error?, event? }.
  function recordEvent(data, { code, key, profile, km, note }) {
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
    const previousKm = events.filter(e => Number.isFinite(e.km)).map(e => e.km).pop();
    if (stage.requiresKm && Number.isFinite(previousKm) && kmValue < previousKm) {
      return { ok: false, error: `Km menor que o registrado anteriormente (${previousKm}).` };
    }

    if (!Number.isFinite(readJson(CLOCK_KEY, null))) {
      writeJson(CLOCK_KEY, Date.now());
    }
    const event = {
      code,
      key,
      at: demoNow(data),
      profile,
      ...(stage.requiresKm ? { km: kmValue } : {}),
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
      global.localStorage.removeItem(CLOCK_KEY);
    } catch {
      // Sem armazenamento, não há o que limpar.
    }
  }

  global.MOOV_STORE = { EVENTS_KEY, MAX_NOTE, loadEvents, demoNow, findRequest, recordEvent, resetDemo };
})(typeof window !== "undefined" ? window : globalThis);
