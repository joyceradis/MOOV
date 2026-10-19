// Página da regulação: abre solicitações e designa veículo municipal disponível.
// Conectada ao servidor (perfil regulação), grava pela API e emite os links da ponta; senão, registro local da demonstração.
(function () {
  const M = window.MOOV_METRICS;
  const S = window.MOOV_STORE;
  const API = window.MOOV_API;

  let DATA = MOOV_DATA;
  const live = { user: null, dashboard: null };

  function $(selector) {
    return document.querySelector(selector);
  }

  function unitName(id) {
    return DATA.units.find(unit => unit.id === id)?.name || "—";
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

  // Solicitações com etapas ordenadas, da fonte em uso.
  function currentRequests() {
    if (live.dashboard) {
      return live.dashboard.requests.map(request => ({ request, events: request.events }));
    }
    const events = S.loadEvents();
    return S.allRequests(MOOV_DATA, events).map(request => ({ request, events: M.eventsFor(request, events) }));
  }

  // Veículo municipal ocupado: designado e ainda não liberado (inclui retido no destino).
  function availableVehicles(rows) {
    if (!live.dashboard) return S.availableVehicles(MOOV_DATA);
    const busy = new Set(rows
      .filter(({ request, events }) => request.vehicleId && events.length && events[events.length - 1].key !== "liberado")
      .map(({ request }) => request.vehicleId));
    return DATA.fleet.filter(v => v.flowType === "municipal" && !busy.has(v.id));
  }

  // Lista das solicitações municipais cuja próxima etapa é a designação.
  function renderPending() {
    const rows = currentRequests();
    const available = availableVehicles(rows);
    $("#availableSummary").textContent = available.length
      ? `Disponíveis agora: ${available.map(v => v.id).join(", ")}.`
      : "Nenhum veículo municipal disponível no momento.";

    const pending = rows.filter(({ request, events }) => request.flowType === "municipal" && M.nextStage(events)?.key === "designada");
    const list = $("#pendingList");
    list.replaceChildren();
    if (!pending.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "Nenhuma solicitação aguardando veículo.";
      list.append(li);
      return;
    }
    for (const { request, events } of pending) {
      const li = document.createElement("li");
      li.dataset.code = request.code;
      const title = document.createElement("strong");
      title.textContent = request.code;
      const route = document.createElement("span");
      const opened = events[0]?.at;
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
      button.setAttribute("aria-label", `Designar veículo para ${request.code}`);
      button.disabled = !available.length;
      button.addEventListener("click", () => assign(request.code, select.value));
      li.append(title, route, label, select, button);
      list.append(li);
    }
  }

  async function reloadLive() {
    live.dashboard = await API.call("GET", "/api/dashboard");
    renderPending();
  }

  async function assign(code, vehicleId) {
    const box = $("#assignResult");
    if (live.user) {
      try {
        const event = await API.call("POST", `/api/requests/${encodeURIComponent(code)}/designate`, { vehicleId });
        showResult(box, true, `${vehicleId} designado para ${code} às ${event.at.slice(11, 16)}. Envie os links da ponta:`);
        box.append(API.frontLinksBlock(code));
        await reloadLive();
      } catch (error) {
        showResult(box, false, `Não registrado: ${error.message}`);
      }
      box.focus();
      return;
    }
    const result = S.recordEvent(MOOV_DATA, { code, key: "designada", profile: "regulacao", vehicleId });
    showResult(box, result.ok, result.ok
      ? `${vehicleId} designado para ${code} às ${result.event.at.slice(11, 16)} (relógio da demonstração), apenas neste navegador.`
      : `Não registrado: ${result.error}`);
    renderPending();
    // A lista é recriada; o foco vai para o resultado em vez de cair no body.
    box.focus();
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

  async function createRequest(form) {
    const input = {
      originId: $("#originField").value,
      destinationId: $("#destinationField").value,
      regulationCode: $("#regulationField").value
    };
    const box = $("#createResult");
    if (live.user) {
      try {
        const { code } = await API.call("POST", "/api/requests", input);
        showResult(box, true, `Solicitação ${code} aberta. Designe um veículo em "Aguardando veículo".`);
        form.reset();
        await reloadLive();
      } catch (error) {
        showResult(box, false, `Não registrado: ${error.message}`);
      }
      return;
    }
    const result = S.createRequest(MOOV_DATA, input);
    showResult(box, result.ok, result.ok
      ? `Solicitação ${result.request.code} aberta às ${result.event.at.slice(11, 16)} (relógio da demonstração), apenas neste navegador. Designe um veículo acima.`
      : `Não registrado: ${result.error}`);
    if (result.ok) {
      box.append(frontLinks(result.request.code));
      form.reset();
      renderPending();
    }
  }

  function applyLiveChrome(user) {
    document.body.classList.add("is-live");
    const notice = $(".demo-notice");
    notice.classList.add("live");
    notice.replaceChildren(API.el("strong", { text: "Conectado ao servidor MOOV" }),
      " · solicitações e designações entram na trilha de auditoria.");
    const logout = API.el("button", { type: "button", class: "ghost-button", text: "Sair" });
    logout.addEventListener("click", () => API.logout());
    $(".form-shell header").append(API.el("div", { class: "user-bar" },
      API.el("span", { text: `${user.username} · ${API.ROLE_LABEL[user.role]}` }), logout));
    $("label[for='regulationField']").textContent = "Código da regulação (opcional)";
  }

  async function init() {
    if (await API.detect()) {
      live.user = await API.ensureLogin(["regulacao"], "Página da regulação: abertura de solicitações e designação de veículo.");
      try {
        live.dashboard = await API.call("GET", "/api/dashboard");
      } catch (error) {
        showResult($("#assignResult"), false, `Não foi possível carregar os dados: ${error.message}`);
        return;
      }
      DATA = { units: live.dashboard.units, fleet: live.dashboard.fleet, config: live.dashboard.config };
      applyLiveChrome(live.user);
    }

    DATA.units.filter(u => u.type === "origem").forEach(u => $("#originField").append(option(u.id, u.name)));
    DATA.units.filter(u => u.type === "destino").forEach(u => $("#destinationField").append(option(u.id, u.name)));

    $("#newRequest").addEventListener("submit", event => {
      event.preventDefault();
      createRequest(event.currentTarget);
    });

    if (live.user) {
      setInterval(() => reloadLive().catch(() => {}), 30000);
    } else {
      window.addEventListener("storage", event => {
        if (event.key === null || event.key.startsWith("moov-demo-")) renderPending();
      });
    }
    renderPending();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
