# MOOV · Governança da frota de ambulâncias

Ferramenta de apoio à **gestão** (pública ou privada) de frotas de ambulâncias contratadas — por exemplo, a frota municipal que atende UBS, pronto-atendimentos e hospitais —, com foco em **rastreabilidade jurídica e de uso de recursos**: cada solicitação/regulação tem um código, cada etapa tem um registro com horário e responsável, e a gestão enxerga tempos, retenções, km e lacunas documentais.

**Não é rastreamento de localização.** O mapa é esquemático: a posição exibida decorre da última etapa registrada (origem, trajeto, destino), não de GPS.

> **Estado atual: protótipo estático com dados 100% fictícios.** Não há servidor, autenticação nem integração com regulação, SAMU 192 ou prontuário. Registros feitos nas páginas da ponta ficam **apenas no `localStorage` do navegador**. Não inserir dados reais de pacientes ou profissionais.

## O que funciona hoje

**Painel da gestão (`index.html`)**
- Indicadores da **frota municipal** calculados dos registros (SAMU 192 contado à parte): tempo médio de resposta (solicitação → chegada à origem), tempo até o recebimento, retenção do veículo no destino, km por hodômetro, lastro documental — sempre com `n`.
- Tabela por código com etapa atual, alertas, retenção e lacunas; filtros por fluxo, etapa, veículo e destino.
- Cronologia da solicitação (horário, perfil, origem do registro, intervalo entre etapas) e lacunas explícitas.
- Gargalos: transições mais lentas e retenção de veículos por destino. Uso da frota por veículo.
- Exportação CSV da trilha de auditoria e do resumo por solicitação (protegida contra injeção de fórmulas).
- Relatório para impressão/PDF com aviso de dados fictícios, recorte aplicado, relógio, indicadores, tabela, gargalos e frota.
- Separação de fluxos: frota municipal contratada × SAMU 192 (identificado, fora da frota e das páginas de registro).

**Páginas da ponta (`pages/*.html?codigo=<código>`)**
- Motorista (chegada à origem, saída com km, chegada com km, liberação), equipe (embarque) e destino (recebimento).
- Abrem pelo código já estabelecido; exibem só dados logísticos; aceitam **apenas a próxima etapa** do fluxo e do perfil; validam km.
- O painel aberto em outra aba atualiza ao registrar.

Parâmetros de alerta (retenção, tempo sem veículo) ficam em `MOOV_DATA.config` e são **parâmetros de gestão**, não regras clínicas.

## Executar

```bash
python3 -m http.server 8080   # http://localhost:8080
```

Sem build. Leaflet 1.9.4 é versionado em `vendor/`; apenas os tiles do mapa (CARTO/OSM) vêm da internet. Sem rede, o painel funciona sem o fundo do mapa.

## Testes

```bash
npm ci
npx playwright install chromium   # uma vez
npm run check && npm test
```

- `tests/metrics.test.mjs` — cálculos, com valores conferidos à mão sobre o conjunto fictício.
- `tests/store.test.mjs` — validações do registro local (perfil, sequência, SAMU, km, falha de gravação, relógio).
- `tests/smoke.test.mjs` — avisos, CSP, ausência de script inline/CDN, integridade do Leaflet versionado, links.
- `tests/browser.test.mjs` — Chromium real: painel, filtros, fluxo ponta → painel, XSS, exportação, modo sem mapa, teclado, layout móvel. Toda requisição externa é bloqueada e verificada.

A CI (`.github/workflows/static-audit.yml`) roda os três em cada PR. CI verde não substitui homologação com usuários reais.

## Estrutura

```text
index.html               painel da gestão
pages/                   páginas da ponta (motorista, enfermagem, destino)
js/data.js               conjunto fictício (unidades, frota, solicitações, parâmetros)
js/metrics.js            cálculos puros (tempos, retenção, lastro, frota, CSV)
js/store.js              registro local da demonstração + relógio da demonstração
js/app.js                painel
js/registro.js           páginas da ponta
css/styles.css           estilos
vendor/leaflet-1.9.4/    Leaflet (BSD-2-Clause)
docs/arquitetura.md      arquitetura e limites
ROADMAP.md / SECURITY.md
```

## Licença

Código sob [GPL-3.0](LICENSE). Nomes de instituições no conjunto fictício não indicam vínculo, homologação ou autorização.
