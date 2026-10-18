// Cálculos de governança do MOOV. Funções puras: recebem dados e eventos, não tocam no DOM.
// Carregado no navegador (global MOOV_METRICS) e nos testes Node (vm).
(function (global) {
  // Etapas da solicitação, em ordem. "profile" indica quem registra a etapa.
  const STAGES = [
    { key: "solicitada", label: "Solicitada", profile: "Origem/Regulação" },
    { key: "designada", label: "Veículo designado", profile: "Regulação/Central" },
    { key: "chegada_origem", label: "Chegada à origem", profile: "Motorista" },
    { key: "embarque", label: "Embarque", profile: "Equipe" },
    { key: "saida_origem", label: "Saída da origem", profile: "Motorista", requiresKm: true },
    { key: "chegada_destino", label: "Chegada ao destino", profile: "Motorista", requiresKm: true },
    { key: "recebido", label: "Recebido no destino", profile: "Destino" },
    { key: "liberado", label: "Veículo liberado", profile: "Motorista" }
  ];

  const STAGE_INDEX = Object.fromEntries(STAGES.map((stage, index) => [stage.key, index]));

  // Etapas que cada página da ponta pode registrar.
  const PROFILE_STAGES = {
    motorista: ["chegada_origem", "saida_origem", "chegada_destino", "liberado"],
    enfermagem: ["embarque"],
    destino: ["recebido"]
  };

  // "2026-05-06T08:15" → minutos desde a época, sem depender do fuso do navegador.
  function toMinutes(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || "");
    if (!match) {
      return null;
    }
    const [, y, mo, d, h, mi] = match.map(Number);
    return Date.UTC(y, mo - 1, d, h, mi) / 60000;
  }

  function fromMinutes(minutes) {
    return new Date(minutes * 60000).toISOString().slice(0, 16);
  }

  function minutesBetween(start, end) {
    const a = toMinutes(start);
    const b = toMinutes(end);
    return a === null || b === null ? null : b - a;
  }

  function stageLabel(key) {
    return STAGES[STAGE_INDEX[key]]?.label || key;
  }

  // Eventos do conjunto de dados + registros locais da demonstração, ordenados pela etapa.
  function eventsFor(request, localEvents = []) {
    const base = request.events.map(event => ({ ...event, source: "conjunto fictício" }));
    const local = localEvents
      .filter(event => event.code === request.code && !base.some(b => b.key === event.key))
      .map(event => ({ ...event, source: "registro local" }));
    return [...base, ...local]
      .filter(event => event.key in STAGE_INDEX)
      .sort((a, b) => STAGE_INDEX[a.key] - STAGE_INDEX[b.key]);
  }

  function lastStage(events) {
    return events.length ? events[events.length - 1].key : null;
  }

  function nextStage(events) {
    const last = lastStage(events);
    const index = last === null ? 0 : STAGE_INDEX[last] + 1;
    return STAGES[index] || null;
  }

  function at(events, key) {
    return events.find(event => event.key === key)?.at || null;
  }

  // Lastro documental: cada etapa alcançada exige as anteriores e, quando aplicável, o km.
  function completeness(events) {
    const reached = lastStage(events);
    if (reached === null) {
      return { done: 0, total: 0, missing: [] };
    }
    const missing = [];
    let total = 0;
    for (const stage of STAGES.slice(0, STAGE_INDEX[reached] + 1)) {
      const event = events.find(e => e.key === stage.key);
      total += 1;
      if (!event) {
        missing.push(`${stage.label}: etapa sem registro`);
      }
      if (stage.requiresKm) {
        total += 1;
        if (!event || !Number.isFinite(event.km)) {
          missing.push(`${stage.label}: km não informado`);
        }
      }
    }
    return { done: total - missing.length, total, missing };
  }

  function summarize(request, events, now, config = {}) {
    const last = lastStage(events);
    const finishedAt = at(events, "recebido");
    const arrivedAt = at(events, "chegada_destino");
    const releasedAt = at(events, "liberado");
    const kmStart = events.find(e => e.key === "saida_origem")?.km;
    const kmEnd = events.find(e => e.key === "chegada_destino")?.km;

    const summary = {
      code: request.code,
      regulationCode: request.regulationCode,
      flowType: request.flowType,
      vehicleId: request.vehicleId,
      originId: request.originId,
      destinationId: request.destinationId,
      stage: last,
      stageLabel: last ? stageLabel(last) : "Sem registro",
      next: nextStage(events),
      // Solicitação → recebimento (ou até agora, se em andamento).
      totalMin: minutesBetween(at(events, "solicitada"), finishedAt || now),
      finished: Boolean(finishedAt),
      // Solicitação → chegada do veículo à origem.
      responseMin: minutesBetween(at(events, "solicitada"), at(events, "chegada_origem")),
      // Tempo do veículo parado no destino até ser liberado (ou até agora).
      retentionMin: arrivedAt ? minutesBetween(arrivedAt, releasedAt || now) : null,
      retentionOpen: Boolean(arrivedAt && !releasedAt),
      km: Number.isFinite(kmStart) && Number.isFinite(kmEnd) ? kmEnd - kmStart : null,
      completeness: completeness(events),
      alerts: []
    };

    if (summary.retentionOpen && summary.retentionMin >= (config.retentionAlertMin ?? Infinity)) {
      summary.alerts.push(`Veículo retido no destino há ${summary.retentionMin} min`);
    }
    if (last === "solicitada") {
      const waiting = minutesBetween(at(events, "solicitada"), now);
      if (waiting >= (config.unassignedAlertMin ?? Infinity)) {
        summary.alerts.push(`Sem veículo designado há ${waiting} min`);
      }
    }
    return summary;
  }

  function mean(values) {
    const valid = values.filter(Number.isFinite);
    if (!valid.length) {
      return { mean: null, n: 0 };
    }
    return { mean: Math.round(valid.reduce((sum, v) => sum + v, 0) / valid.length), n: valid.length };
  }

  // Duração média de cada transição entre etapas consecutivas (apenas pares registrados).
  function stageDurations(eventLists) {
    return STAGES.slice(1).map((stage, i) => {
      const previous = STAGES[i];
      const values = eventLists.map(events => minutesBetween(at(events, previous.key), at(events, stage.key)));
      return { from: previous.key, to: stage.key, label: `${previous.label} → ${stage.label}`, ...mean(values) };
    });
  }

  function groupRetention(summaries, units) {
    const byDestination = new Map();
    for (const s of summaries) {
      if (s.retentionMin === null) continue;
      const entry = byDestination.get(s.destinationId) || { values: [], open: 0 };
      entry.values.push(s.retentionMin);
      if (s.retentionOpen) entry.open += 1;
      byDestination.set(s.destinationId, entry);
    }
    return [...byDestination.entries()]
      .map(([id, entry]) => ({
        destinationId: id,
        name: units.find(u => u.id === id)?.name || id,
        totalMin: entry.values.reduce((a, b) => a + b, 0),
        open: entry.open,
        ...mean(entry.values)
      }))
      .sort((a, b) => b.totalMin - a.totalMin);
  }

  function fleetSummary(fleet, summaries, eventLists, now) {
    return fleet
      .filter(vehicle => vehicle.flowType === "municipal")
      .map(vehicle => {
        const own = summaries.map((s, i) => [s, eventLists[i]]).filter(([s]) => s.vehicleId === vehicle.id);
        const kms = own.map(([s]) => s.km).filter(Number.isFinite);
        const busy = own.find(([s]) => s.stage !== "liberado" && s.stage !== null);
        return {
          ...vehicle,
          requests: own.length,
          km: kms.length ? kms.reduce((a, b) => a + b, 0) : null,
          kmMissing: own.filter(([s]) => s.stage && STAGE_INDEX[s.stage] >= STAGE_INDEX.chegada_destino && s.km === null).length,
          serviceMin: own
            .map(([, events]) => minutesBetween(at(events, "designada"), at(events, "liberado") || now))
            .filter(Number.isFinite)
            .reduce((a, b) => a + b, 0),
          retentionMin: own.map(([s]) => s.retentionMin).filter(Number.isFinite).reduce((a, b) => a + b, 0),
          current: busy ? busy[0].code : null
        };
      });
  }

  // CSV com escape de aspas e proteção contra injeção de fórmulas em planilhas.
  function toCsv(rows) {
    const cell = value => {
      let text = value === null || value === undefined ? "" : String(value);
      if (/^[=+\-@\t\r]/.test(text)) {
        text = "'" + text;
      }
      return /[",;\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return rows.map(row => row.map(cell).join(";")).join("\r\n");
  }

  global.MOOV_METRICS = {
    STAGES,
    STAGE_INDEX,
    PROFILE_STAGES,
    toMinutes,
    fromMinutes,
    minutesBetween,
    stageLabel,
    eventsFor,
    nextStage,
    completeness,
    summarize,
    mean,
    stageDurations,
    groupRetention,
    fleetSummary,
    toCsv
  };
})(typeof window !== "undefined" ? window : globalThis);
