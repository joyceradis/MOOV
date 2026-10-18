# Roadmap · MOOV

**Estado em 18/10/2026:** protótipo estático, dados fictícios, **não operacional**. Itens marcados indicam código integrado e testado, não homologação.

## Etapa A — Demonstração íntegra (P0)
- [x] Aviso persistente de dados fictícios no painel e nas páginas da ponta.
- [x] Indicadores calculados a partir dos registros, com `n`; nenhum valor fixo.
- [x] Registro simulado declara armazenamento apenas local.
- [x] Testes em navegador: filtros, seleção, falha do mapa, mobile, teclado.

## Etapa B — MVP de gestão (P1)
- [x] Código por solicitação/regulação; páginas da ponta abertas pelo código.
- [x] Cronologia com perfil, horário, intervalos e lacunas.
- [x] Tempo de resposta, tempo até recebimento, retenção no destino, km, lastro documental.
- [x] Gargalos por transição e por destino; uso da frota por veículo.
- [x] Exportação CSV (trilha de auditoria e resumo).
- [x] Mapa esquemático (não-GPS); Leaflet local; CSP.
- [ ] Período/data como filtro (requer conjunto com vários dias).
- [x] Página da regulação: abrir solicitação (código `SOL-aammdd-Lnnn`) e designar veículo municipal disponível.
- [x] Relatório imprimível (PDF pelo navegador) para prestação de contas.

## Gate de decisão de produto — [#4](https://github.com/joyceradis/MOOV/issues/4)
Sem decisão explícita e responsáveis institucionais, **não** implementar servidor com dados reais, autenticação em produção ou integrações.

## Etapa C — Operacional (somente após o gate)
1. Requisitos com gestores do contrato, regulação, equipes e destinos; regras de faturamento do contrato.
2. API + banco com trilha de eventos append-only; autenticação e RBAC; links da ponta com token efêmero.
3. PWA com fila offline e resolução de conflitos.
4. LGPD: base legal, minimização, DPIA, retenção; segurança e observabilidade.
5. Homologação em ambiente isolado; piloto somente após contratação própria.

**Fora do escopo:** rastreamento em tempo real, despacho, decisão clínica, automação de regulação.
