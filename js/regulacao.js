// Página da regulação: abre solicitações locais e designa veículo municipal disponível.
(function () {
  const M = window.MOOV_METRICS;
  const S = window.MOOV_STORE;

  function $(selector) {
    return document.querySelector(selector);
  }

  function unitName(id) {
    return MOOV_DATA.units.find(unit => unit.id === id)?.name || "—";
  }

  function option(value, label) {
    const el = document.createElement("option");
    el.value = value;
    el.textContent = label;
    return el;
  }

  function showResult(box, ok, text) {
    box.classList.add("show");
    box.classList.toggle("error", !ok);
    box.textContent = text;
  }

  // Lista das solicitações municipais cuja próxima etapa é a designação.
  function renderPending() {
    const events = S.loadEvents();
    const available = S.availableVehicles(MOOV_DATA);
    $("#availableSummary").textContent = available.length
      ? `Disponíveis agora: ${available.map(v => v.id).join(", ")}.`
      : "Nenhum veículo municipal disponível no momento.";

    const pending = S.allRequests(MOOV_DATA, events)
      .filter(r => r.flowType === "municipal" && M.nextStage(M.eventsFor(r, events))?.key === "designada");
    const list = $("#pendingList");
    list.replaceChildren();
    if (!pending.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "Nenhuma solicitação aguardando veículo.";
      list.append(li);
      return;
    }
    for (const request of pending) {
      const li = document.createElement("li");
      li.dataset.code = request.code;
      const title = document.createElement("strong");
      title.textContent = request.code;
      const route = document.createElement("span");
      const opened = M.eventsFor(request, events)[0]?.at;
      route.textContent = `${unitName(request.originId)} → ${unitName(request.destinationId)}${opened ? ` · solicitada às ${opened.slice(11, 16)}` : ""}`;
      const label = document.createElement("label");
      label.className = "sr-only";
      label.htmlFor = `vehicle-${request.code}`;
      label.textContent = `Veículo para ${request.code}`;
      const select = document.createElement("select");
      select.id = `vehicle-${request.code}`;
      select.append(option("", "Selecione o veículo"));
      available.forEach(v => select.append(option(v.id, `${v.id} · ${v.type}`)));
      select.disabled = !available.length;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Designar";
      button.disabled = !available.length;
      button.addEventListener("click", () => assign(request.code, select.value));
      li.append(title, route, label, select, button);
      list.append(li);
    }
  }

  function assign(code, vehicleId) {
    const result = S.recordEvent(MOOV_DATA, { code, key: "designada", profile: "regulacao", vehicleId });
    showResult($("#assignResult"), result.ok, result.ok
      ? `${vehicleId} designado para ${code} às ${result.event.at.slice(11, 16)} (relógio da demonstração), apenas neste navegador.`
      : `Não registrado: ${result.error}`);
    renderPending();
  }

  function frontLinks(code) {
    const wrap = document.createElement("div");
    wrap.className = "front-links";
    const small = document.createElement("small");
    small.textContent = "Links da ponta para esta solicitação";
    wrap.append(small);
    for (const [page, label] of [["motorista", "Motorista"], ["enfermagem", "Equipe"], ["destino", "Destino"]]) {
      const a = document.createElement("a");
      a.href = `./${page}.html?codigo=${encodeURIComponent(code)}`;
      a.textContent = label;
      wrap.append(a);
    }
    return wrap;
  }

  function init() {
    MOOV_DATA.units.filter(u => u.type === "origem").forEach(u => $("#originField").append(option(u.id, u.name)));
    MOOV_DATA.units.filter(u => u.type === "destino").forEach(u => $("#destinationField").append(option(u.id, u.name)));

    $("#newRequest").addEventListener("submit", event => {
      event.preventDefault();
      const result = S.createRequest(MOOV_DATA, {
        originId: $("#originField").value,
        destinationId: $("#destinationField").value,
        regulationCode: $("#regulationField").value
      });
      const box = $("#createResult");
      showResult(box, result.ok, result.ok
        ? `Solicitação ${result.request.code} aberta às ${result.event.at.slice(11, 16)} (relógio da demonstração), apenas neste navegador. Designe um veículo acima.`
        : `Não registrado: ${result.error}`);
      if (result.ok) {
        box.append(frontLinks(result.request.code));
        event.currentTarget.reset();
        renderPending();
      }
    });

    window.addEventListener("storage", event => {
      if (event.key === null || event.key.startsWith("moov-demo-")) renderPending();
    });
    renderPending();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
