// Conexão com o servidor MOOV. Se a página foi entregue pelo servidor (GET /api/health responde),
// o painel e as páginas usam a API com login; senão (GitHub Pages, arquivo local), seguem em modo demonstração.
// A sessão fica em sessionStorage (some ao fechar a aba); o link da ponta vem no fragmento # e nunca vai à URL do servidor.
(function (global) {
  const SESSION_KEY = "moov-session";
  const LINK_KEY = "moov-link-";
  const ROLE_LABEL = { admin: "Administração", gestor: "Gestão", regulacao: "Regulação" };
  const PROFILE_PAGES = [["motorista", "Motorista"], ["enfermagem", "Equipe"], ["destino", "Destino"]];

  function storage(kind) {
    try {
      return global[kind];
    } catch {
      return null;
    }
  }

  function read(key) {
    try {
      return storage("sessionStorage")?.getItem(key) || null;
    } catch {
      return null;
    }
  }

  function write(key, value) {
    try {
      const s = storage("sessionStorage");
      if (value === null) s?.removeItem(key);
      else s?.setItem(key, value);
    } catch {
      // Sem sessionStorage: a sessão vale só enquanto a página estiver aberta.
    }
  }

  const memory = {};
  const getSession = () => memory.session || read(SESSION_KEY);
  function setSession(token) {
    memory.session = token;
    write(SESSION_KEY, token);
  }

  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  const url = path => new URL(path, global.location.origin).toString();

  async function request(method, path, { body, auth } = {}) {
    const headers = {};
    if (auth) headers.authorization = auth;
    if (body !== undefined) headers["content-type"] = "application/json";
    let res;
    try {
      res = await fetch(url(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
    } catch {
      throw new ApiError(0, "Sem conexão com o servidor. Verifique a internet e tente de novo.");
    }
    const type = res.headers.get("content-type") || "";
    const payload = type.includes("application/json") ? await res.json().catch(() => null) : await res.text();
    if (!res.ok) {
      throw new ApiError(res.status, (payload && payload.error) || `Erro ${res.status}.`);
    }
    return payload;
  }

  // Chamada autenticada como usuário; sessão expirada volta para a tela de login.
  async function call(method, path, body) {
    try {
      return await request(method, path, { body, auth: `Bearer ${getSession()}` });
    } catch (error) {
      if (error.status === 401) {
        setSession(null);
        global.location.reload();
      }
      throw error;
    }
  }

  // Detecta o servidor uma vez por página.
  let detected = null;
  function detect() {
    if (!detected) {
      detected = global.location.protocol.startsWith("http")
        ? request("GET", "/api/health").then(r => Boolean(r && r.ok === true), () => false)
        : Promise.resolve(false);
    }
    return detected;
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else node.setAttribute(key, value);
    }
    node.append(...children);
    return node;
  }

  // Tela de login sobre a página. Resolve com o usuário quando o perfil é um dos aceitos.
  function loginScreen(roles, title) {
    document.body.classList.add("auth-pending");
    return new Promise(resolve => {
      const message = el("p", { class: "login-error", role: "alert" });
      const user = el("input", { id: "loginUser", autocomplete: "username", autocapitalize: "none", required: "" });
      const pass = el("input", { id: "loginPassword", type: "password", autocomplete: "current-password", required: "" });
      const submit = el("button", { type: "submit", class: "primary-button", text: "Entrar" });
      const form = el("form", { class: "panel form-card login-card", id: "loginForm" },
        el("span", { class: "brand-mark", text: "MOOV" }),
        el("h1", { text: "Entrar" }),
        el("p", { class: "muted", text: title }),
        el("label", { for: "loginUser", text: "Usuário" }), user,
        el("label", { for: "loginPassword", text: "Senha" }), pass,
        message,
        el("div", { class: "form-actions" }, submit));
      const screen = el("main", { class: "login-screen", id: "loginScreen" }, form);
      document.body.append(screen);
      user.focus();

      form.addEventListener("submit", async event => {
        event.preventDefault();
        message.textContent = "";
        submit.disabled = true;
        try {
          const session = await request("POST", "/api/session", { body: { username: user.value.trim(), password: pass.value } });
          if (!roles.includes(session.role)) {
            await request("DELETE", "/api/session", { auth: `Bearer ${session.token}` }).catch(() => {});
            message.textContent = `O perfil ${ROLE_LABEL[session.role] || session.role} não tem acesso a esta página.`;
            return;
          }
          setSession(session.token);
          screen.remove();
          document.body.classList.remove("auth-pending");
          resolve({ username: session.username, role: session.role });
        } catch (error) {
          message.textContent = error.message;
          pass.value = "";
          pass.focus();
        } finally {
          submit.disabled = false;
        }
      });
    });
  }

  // Usa a sessão guardada se ainda valer; senão pede login.
  async function ensureLogin(roles, title) {
    if (getSession()) {
      try {
        const me = await request("GET", "/api/me", { auth: `Bearer ${getSession()}` });
        if (roles.includes(me.role)) return me;
      } catch {
        // Sessão expirada ou inválida: pede login de novo.
      }
      setSession(null);
    }
    return loginScreen(roles, title);
  }

  async function logout() {
    const token = getSession();
    setSession(null);
    if (token) await request("DELETE", "/api/session", { auth: `Bearer ${token}` }).catch(() => {});
    global.location.reload();
  }

  // ---------- links da ponta ----------

  // Emite os três links (motorista, equipe, destino) de uma solicitação e devolve os endereços completos.
  async function issueFrontLinks(code) {
    const links = [];
    for (const [profile, label] of PROFILE_PAGES) {
      const link = await call("POST", `/api/requests/${encodeURIComponent(code)}/links`, { profile });
      links.push({ profile, label, href: url(`/pages/${profile}.html#link=${link.token}`), expiresAt: link.expiresAt });
    }
    return links;
  }

  // Links já gerados nesta página (só em memória), para não sumirem quando o painel se atualiza.
  const issued = new Map();

  function renderLinks(wrap, links) {
    const hours = new Date(links[0].expiresAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    const list = el("ul", { class: "link-list" });
    for (const link of links) {
      const copy = el("button", { type: "button", class: "ghost-button", text: "Copiar" });
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(link.href);
          copy.textContent = "Copiado";
        } catch {
          copy.textContent = "Copie pelo botão Abrir";
        }
      });
      list.append(el("li", { "data-profile": link.profile },
        el("strong", { text: link.label }),
        el("a", { href: link.href, target: "_blank", rel: "noopener noreferrer", text: "Abrir" }),
        copy));
    }
    wrap.replaceChildren(
      el("small", { text: `Envie cada link só para a pessoa do perfil. Valem até ${hours} e podem ser revogados pela regulação.` }),
      list);
  }

  // Bloco com botão "Gerar links da ponta"; ao gerar, mostra os links com botão de copiar.
  function frontLinksBlock(code) {
    const wrap = el("div", { class: "front-links" });
    const cached = issued.get(code);
    if (cached && Date.parse(cached[0].expiresAt) > Date.now()) {
      renderLinks(wrap, cached);
      return wrap;
    }
    const button = el("button", { type: "button", class: "ghost-button", text: "Gerar links da ponta" });
    const note = el("small", { text: "Links individuais para motorista, equipe e destino desta solicitação." });
    wrap.append(note, button);
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const links = await issueFrontLinks(code);
        issued.set(code, links);
        renderLinks(wrap, links);
      } catch (error) {
        note.textContent = `Não foi possível gerar os links: ${error.message}`;
        button.disabled = false;
      }
    });
    return wrap;
  }

  // Token do link da ponta: lido do fragmento (#link=...), guardado na aba e removido da barra de endereço.
  function takeLinkToken(profile) {
    const match = /(?:^#|&)link=([A-Za-z0-9_-]{20,200})/.exec(global.location.hash);
    if (match) {
      write(LINK_KEY + profile, match[1]);
      memory[LINK_KEY + profile] = match[1];
      global.history.replaceState(null, "", global.location.pathname + global.location.search);
    }
    return memory[LINK_KEY + profile] || read(LINK_KEY + profile);
  }

  const ponta = (method, path, token, body) => request(method, path, { body, auth: `Link ${token}` });

  global.MOOV_API = { ROLE_LABEL, ApiError, detect, call, ensureLogin, logout, frontLinksBlock, takeLinkToken, ponta, el };
})(typeof window !== "undefined" ? window : globalThis);
