# Roadmap · MOOV

**Estado em 17/10/2026:** protótipo front-end com base sintética; **não operacional**. O roadmap descreve intenção, não comprovação de entrega. Issue central de priorização: [#2](https://github.com/joyceradis/MOOV/issues/2).

## Etapa A — Demonstração íntegra e transparente (P0)

- [ ] Aviso persistente de dados fictícios no painel e nos microformulários.
- [ ] Diferenciar indicadores calculados do dataset sintético daqueles sem cálculo implementado.
- [ ] Garantir que registro simulado nunca afirme que o evento foi transmitido ou persistido.
- [ ] Verificar filtros, escolha de transferência, linhas do tempo, erro de CDN e comportamento mobile.
- [ ] Não permitir entrada de informações reais em fluxos demonstrativos.

**Aceite:** visitante entende que nenhuma movimentação operacional está sendo monitorada. Relacionada à [#2](https://github.com/joyceradis/MOOV/issues/2).

## Etapa B — Manutenibilidade e segurança demonstrativa (P1)

- [ ] README, arquitetura e política de segurança coerentes com o código.
- [ ] Testes estáticos de sintaxe e smoke test de dados/links.
- [ ] Revisar módulos JS históricos antes de remoção.
- [ ] Avaliar integridade da carga CDN, rotas de fallback e acessibilidade.
- [ ] Avaliar revisão obrigatória antes de mudanças na branch de publicação.

**Aceite:** testes reproduzíveis detectam regressões essenciais; nenhuma promessa de segurança ou capacidade não implementada. Relacionada à [#3](https://github.com/joyceradis/MOOV/issues/3).

## Gate de decisão de produto

Escolher formalmente entre (a) demonstração de portfólio e (b) produto operacional. **Sem decisão, não implementar API, GPS, autenticação, dados clínicos ou integração institucional.** Ver [#4](https://github.com/joyceradis/MOOV/issues/4).

## Hipótese futura, apenas se for escolhido produto operacional

1. Descoberta de requisitos com responsáveis por regulação, origem, transporte e destino.
2. Contrato de microeventos e estados, segregando fluxo municipal e SAMU.
3. Avaliação jurídica/LGPD, base legal, minimização de dados e responsabilidades.
4. Arquitetura autorizada (auth/RBAC, banco, auditoria, observabilidade, retenção).
5. Homologação em ambiente isolado, testes de confiabilidade e segurança.
6. Piloto institucional **somente após aprovação e contratação próprias**.

**Fora do escopo atual:** rastreamento em tempo real, despacho, decisões clínicas ou automação de regulação.
