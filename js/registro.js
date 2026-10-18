// Páginas da ponta (motorista, equipe, destino). Abertas com ?codigo=<código da solicitação>.
// Mostram apenas dados logísticos e registram a próxima etapa no armazenamento local da demonstração.
(function () {
  const M = window.MOOV_METRICS;
  const S = window.MOOV_STORE;
  const CODE_PATTERN = /^[A-Z0-9-]{5,40}$/;

  function $(selector) {
    return document.querySelector(selector);
  }

  function unitName(id) {
    return MOOV_DATA.units.find(unit => unit.id === id)?.name || "—";
  }

  function setText(selector, value) {
    const el = $(selector);
    if (el) el.textContent = value;
  }

  function show(selector, visible) {
    const el = $(selector);
    if (el) el.hidden = !visible;
  }

  function readCode() {
    const raw = (new URLSearchParams(window.location.search).get("codigo") || "").trim().toUpperCase();
    return { code: CODE_PATTERN.test(raw) ? raw : "", invalid: raw !== "" && !CODE_PATTERN.test(raw) };
  }

  // Monta a observação a partir dos campos marcados com data-note-label (sem dados de paciente).
  function collectNote(form) {
    const parts = [];
    form.querySelectorAll("[data-note-label]").forEach(field => {
      const value = field.type === "checkbox" ? (field.checked ? "sim" : "") : field.value.trim();
      if (value) parts.push(`${field.dataset.noteLabel}: ${value}`);
    });
    return parts.join(" · ");
  }

  function render(profile, code, invalid = false) {
    const request = code ? S.findRequest(MOOV_DATA, code) : null;
    show("#codeLookup", !request);
    show("#requestView", Boolean(request));
    if (!request) {
      setText("#lookupMessage",
        invalid ? "Código inválido no link. Use letras maiúsculas, números e hífen."
          : code ? `Código ${code} não encontrado no conjunto fictício.`
            : "Abra esta página pelo link da solicitação ou informe o código.");
      return;
    }

    const events = M.eventsFor(request, S.loadEvents());
    const next = M.nextStage(events);
    const last = events[events.length - 1];
    setText("#sumCode", request.code);
    setText("#sumRegulation", request.regulationCode);
    setText("#sumOrigin", unitName(request.originId));
    setText("#sumDestination", unitName(request.destinationId));
    setText("#sumVehicle", request.vehicleId || "não designado");
    setText("#sumStage", last ? `${M.stageLabel(last.key)} (${last.at.slice(11, 16)})` : "Sem registro");

    const allowed = M.PROFILE_STAGES[profile] || [];
    let blocked = "";
    if (request.flowType !== "municipal") {
      blocked = "Fluxo SAMU 192: identificado no painel, mas não registrado pela frota municipal.";
    } else if (!next) {
      blocked = "Solicitação concluída: todas as etapas foram registradas.";
    } else if (!allowed.includes(next.key)) {
      blocked = `Próxima etapa: ${next.label} — registro pelo perfil ${next.profile}.`;
    }
    show("#stageForm", !blocked);
    show("#blockedMessage", Boolean(blocked));
    setText("#blockedMessage", blocked);
    if (blocked) return;

    setText("#nextStage", next.label);
    const km = $("#kmField");
    if (km) {
      show("#kmGroup", Boolean(next.requiresKm));
      km.required = Boolean(next.requiresKm);
      km.disabled = !next.requiresKm;
    }
    $("#stageForm").dataset.stage = next.key;
  }

  function init() {
    const profile = document.body.dataset.profile;
    const { code, invalid } = readCode();

    $("#codeLookup").addEventListener("submit", event => {
      event.preventDefault();
      const value = $("#codeInput").value.trim().toUpperCase();
      if (!CODE_PATTERN.test(value)) {
        setText("#lookupMessage", "Código inválido. Use letras maiúsculas, números e hífen.");
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.set("codigo", value);
      window.location.assign(url.toString());
    });

    $("#stageForm").addEventListener("submit", event => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("button[type='submit']");
      const result = S.recordEvent(MOOV_DATA, {
        code,
        key: form.dataset.stage,
        profile,
        km: $("#kmField") && !$("#kmField").disabled ? $("#kmField").value.trim() : undefined,
        note: collectNote(form)
      });
      const box = $("#success");
      box.classList.add("show");
      box.classList.toggle("error", !result.ok);
      box.textContent = result.ok
        ? `Etapa "${M.stageLabel(result.event.key)}" registrada às ${result.event.at.slice(11, 16)} (relógio da demonstração), apenas neste navegador. Nenhum dado foi enviado a servidor.`
        : `Não registrado: ${result.error}`;
      if (result.ok) {
        form.reset();
        render(profile, code);
      }
      button?.focus();
    });

    // Registro feito em outra aba (outro perfil) libera ou bloqueia a etapa desta página.
    window.addEventListener("storage", event => {
      if (event.key === null || event.key.startsWith("moov-demo-")) render(profile, code);
    });

    render(profile, code, invalid);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
