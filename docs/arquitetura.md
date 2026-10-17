# Arquitetura MOOV · estado demonstrativo

> **Estado:** aplicação HTML/CSS/JS estática, sem backend, autenticador, banco, GPS ou integração oficial. O conteúdo abaixo distingue **presente** de **hipótese futura**. Dados, trajetos e microeventos são sintéticos; não usar com dados reais.

## Implementado no protótipo

- `index.html` carrega `js/data.js` (dataset fictício) e `js/app.js` (Leaflet, filtros, indicadores e linha do tempo).
- `pages/motorista.html`, `pages/enfermagem.html` e `pages/destino.html` são formulários de demonstração. A confirmação é local à página; não cria evento persistente nem atualiza painel.
- `js/map.js`, `js/dashboard.js`, `js/ui.js` e `js/forms.js` são componentes de composição anterior. Verificar referências antes de reaproveitar; não são a entrada ativa do dashboard.
- Mapa depende de CDN de Leaflet e tiles externos; falhas de rede podem tornar o mapa indisponível.

## Modelo conceitual — não implementado no servidor

| Entidade | Papel projetado |
| --- | --- |
| Transição assistencial | Identificador, origem, destino e estado |
| Unidade/serviço | Papel de origem ou destino |
| Recurso operacional | Veículo/equipe e sua classificação |
| Microevento | Estado, data/hora e perfil responsável, com integridade verificável |

O MOOV, se futuramente autorizado como produto operacional, deveria **complementar**, não substituir, regulação, prontuário ou sistemas institucionais. Os fluxos PMV e SAMU exigem fronteiras explícitas de competência.

## Segurança e LGPD — requisitos futuros

Minimizar dados pessoais, restringir visibilidade por papel, registrar evidência de cada atualização, autenticar operadores, gerenciar sessões e logs, definir retenção, detectar abuso e validar bases legais para tratamento de dados. O motorista não deve precisar acessar diagnóstico, CID, CPF, CNS ou prontuário. **Nenhuma dessas proteções deve ser presumida operante neste protótipo.**

## Governança de evolução

Decisão de produto [#4](https://github.com/joyceradis/MOOV/issues/4); backlog e critérios em [ROADMAP.md](../ROADMAP.md). Alterações visuais/documentais devem conservar demonstração honesta e verificar smoke tests antes de integrar.
