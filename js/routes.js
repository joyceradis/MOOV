// Trajetos pelas ruas entre unidades (origem → destino), para o mapa não traçar linha reta sobre o mar.
// Calculados pelo OSRM (roteador sobre dados do OpenStreetMap) a partir só das coordenadas das unidades:
// nenhum código, veículo ou dado de paciente sai do navegador. Cada par é pedido uma vez e guardado
// no localStorage; sem rede ou sem resposta válida, o mapa simplesmente não desenha a rota.
(function (global) {
  const ENDPOINT = "https://router.project-osrm.org/route/v1/driving/";
  const CACHE_KEY = "moov-routes-v1";
  const MAX_POINTS = 5000;
  const memory = new Map();
  const pending = new Map();

  const key = (from, to) => [...from, ...to].map(n => Number(n).toFixed(5)).join(",");

  const isPoint = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) &&
    Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;

  function loadCache() {
    try {
      const raw = JSON.parse(global.localStorage.getItem(CACHE_KEY) || "{}");
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [k, coords] of Object.entries(raw)) {
          if (Array.isArray(coords) && coords.length >= 2 && coords.length <= MAX_POINTS && coords.every(isPoint)) {
            memory.set(k, coords);
          }
        }
      }
    } catch {
      // Cache ilegível ou sem localStorage: as rotas são pedidas de novo.
    }
  }

  function saveCache() {
    try {
      global.localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(memory)));
    } catch {
      // Sem armazenamento: vale só nesta página.
    }
  }

  // Resposta do OSRM → lista [lat, lng]; qualquer formato inesperado vira null.
  function parse(body) {
    const coords = body && body.code === "Ok" && body.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2 || coords.length > MAX_POINTS) return null;
    const points = coords.map(c => (Array.isArray(c) ? [c[1], c[0]] : null));
    return points.every(isPoint) ? points : null;
  }

  async function fetchRoute(from, to) {
    const url = `${ENDPOINT}${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;
    try {
      const res = await fetch(url, { credentials: "omit", referrerPolicy: "strict-origin-when-cross-origin", cache: "force-cache" });
      return res.ok ? parse(await res.json()) : null;
    } catch {
      return null;
    }
  }

  function get(from, to) {
    return from && to ? memory.get(key(from, to)) || null : null;
  }

  // Busca os pares que faltam, um de cada vez (uso moderado do servidor público).
  // Devolve true se alguma rota nova chegou.
  async function ensure(pairs) {
    let added = false;
    for (const [from, to] of pairs) {
      if (!isPoint(from) || !isPoint(to)) continue;
      const k = key(from, to);
      if (memory.has(k)) continue;
      if (!pending.has(k)) pending.set(k, fetchRoute(from, to));
      const route = await pending.get(k);
      pending.delete(k);
      if (route) {
        memory.set(k, route);
        added = true;
      }
    }
    if (added) saveCache();
    return added;
  }

  // Ponto a uma fração do comprimento do trajeto, e o índice onde ele cai (para separar percorrido/restante).
  function along(route, fraction) {
    const dist = (a, b) => Math.hypot(a[0] - b[0], (a[1] - b[1]) * Math.cos(a[0] * Math.PI / 180));
    const total = route.slice(1).reduce((sum, p, i) => sum + dist(route[i], p), 0);
    let walked = 0;
    for (let i = 1; i < route.length; i += 1) {
      const step = dist(route[i - 1], route[i]);
      if (walked + step >= total * fraction && step > 0) {
        const t = (total * fraction - walked) / step;
        const a = route[i - 1];
        const b = route[i];
        return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], index: i };
      }
      walked += step;
    }
    return { point: route[route.length - 1], index: route.length - 1 };
  }

  loadCache();
  global.MOOV_ROUTES = { ENDPOINT, CACHE_KEY, get, ensure, along };
})(typeof window !== "undefined" ? window : globalThis);
