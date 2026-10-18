// Conjunto de dados FICTÍCIO para demonstração. Unidades, veículos, códigos e horários são exemplos;
// nenhum registro corresponde a pacientes, ambulâncias ou atendimentos reais.
const MOOV_DATA = {
  // Relógio da demonstração: "agora" para cálculos de etapas em andamento.
  referenceTime: "2026-05-06T09:30",

  // Parâmetros de gestão (ajustáveis pela contratante; não são regras clínicas).
  config: {
    retentionAlertMin: 30,
    unassignedAlertMin: 15
  },

  units: [
    { id: "PASP", name: "PA São Pedro", type: "origem", coords: [-20.2967, -40.3355] },
    { id: "PASUA", name: "PA Enseada do Suá", type: "origem", coords: [-20.3187, -40.2956] },
    { id: "PAMAR", name: "PA Maruípe", type: "origem", coords: [-20.2898, -40.3127] },
    { id: "HEVV", name: "Hospital Evangélico", type: "destino", coords: [-20.3429, -40.2961] },
    { id: "HUCAM", name: "HUCAM", type: "destino", coords: [-20.2766, -40.3038] },
    { id: "HINF", name: "Hospital Infantil / referência", type: "destino", coords: [-20.3215, -40.3462] },
    { id: "OC192A", name: "Via pública — ocorrência 192", type: "ocorrencia", coords: [-20.2973, -40.2952] },
    { id: "OC192B", name: "Via pública — ocorrência 192", type: "ocorrencia", coords: [-20.3302, -40.3221] }
  ],

  // Frota: apenas os veículos "municipal" compõem a frota contratada sob governança municipal.
  fleet: [
    { id: "PMV-03", flowType: "municipal", type: "Transporte sanitário", operator: "Contratada A (fictícia)" },
    { id: "PMV-05", flowType: "municipal", type: "USB — suporte básico", operator: "Contratada A (fictícia)" },
    { id: "PMV-08", flowType: "municipal", type: "USB — suporte básico", operator: "Contratada A (fictícia)" },
    { id: "PMV-11", flowType: "municipal", type: "Transporte sanitário", operator: "Contratada A (fictícia)" },
    { id: "USB-12", flowType: "samu", type: "SAMU 192 — USB", operator: "SAMU 192 (fora da frota municipal)" },
    { id: "USA-04", flowType: "samu", type: "SAMU 192 — USA", operator: "SAMU 192 (fora da frota municipal)" }
  ],

  // Cada solicitação é identificada por um código; as páginas da ponta são abertas com ?codigo=<code>.
  requests: [
    {
      code: "SOL-260506-P01-001",
      regulationCode: "REG-0506-1187",
      flowType: "municipal",
      vehicleId: "PMV-08",
      originId: "PASP",
      destinationId: "HEVV",
      events: [
        { key: "solicitada", at: "2026-05-06T08:15" },
        { key: "designada", at: "2026-05-06T08:17" },
        { key: "chegada_origem", at: "2026-05-06T08:21" },
        { key: "embarque", at: "2026-05-06T08:24" },
        { key: "saida_origem", at: "2026-05-06T08:27", km: 45021 }
      ]
    },
    {
      code: "SOL-260506-P02-002",
      regulationCode: "REG-0506-1172",
      flowType: "municipal",
      vehicleId: "PMV-03",
      originId: "PASUA",
      destinationId: "HUCAM",
      events: [
        { key: "solicitada", at: "2026-05-06T07:42" },
        { key: "designada", at: "2026-05-06T07:50" },
        { key: "chegada_origem", at: "2026-05-06T07:58" },
        { key: "embarque", at: "2026-05-06T08:02" },
        { key: "saida_origem", at: "2026-05-06T08:05", km: 11802 },
        { key: "chegada_destino", at: "2026-05-06T08:21", km: 11815 }
      ]
    },
    {
      code: "SOL-260506-P01-003",
      regulationCode: "REG-0506-1140",
      flowType: "municipal",
      vehicleId: "PMV-05",
      originId: "PASP",
      destinationId: "HINF",
      events: [
        { key: "solicitada", at: "2026-05-06T06:50" },
        { key: "designada", at: "2026-05-06T06:58" },
        { key: "chegada_origem", at: "2026-05-06T07:10" },
        { key: "embarque", at: "2026-05-06T07:16" },
        { key: "saida_origem", at: "2026-05-06T07:20", km: 30210 },
        { key: "chegada_destino", at: "2026-05-06T07:41", km: 30224 },
        { key: "recebido", at: "2026-05-06T07:55" },
        { key: "liberado", at: "2026-05-06T08:00" }
      ]
    },
    {
      code: "SOL-260506-P03-004",
      regulationCode: "REG-0506-1101",
      flowType: "municipal",
      vehicleId: "PMV-08",
      originId: "PAMAR",
      destinationId: "HUCAM",
      events: [
        { key: "solicitada", at: "2026-05-06T05:40" },
        { key: "designada", at: "2026-05-06T05:44" },
        { key: "chegada_origem", at: "2026-05-06T05:52" },
        { key: "embarque", at: "2026-05-06T05:58" },
        { key: "saida_origem", at: "2026-05-06T06:01", km: 44990 },
        // km final não informado: lacuna documental proposital do exemplo.
        { key: "chegada_destino", at: "2026-05-06T06:12" },
        { key: "recebido", at: "2026-05-06T06:31" },
        { key: "liberado", at: "2026-05-06T06:35" }
      ]
    },
    {
      code: "SOL-260506-P02-005",
      regulationCode: "REG-0506-1203",
      flowType: "municipal",
      vehicleId: "PMV-11",
      originId: "PASUA",
      destinationId: "HEVV",
      events: [
        { key: "solicitada", at: "2026-05-06T09:05" },
        { key: "designada", at: "2026-05-06T09:20" }
      ]
    },
    {
      code: "SOL-260506-P03-006",
      regulationCode: "REG-0506-1209",
      flowType: "municipal",
      vehicleId: null,
      originId: "PAMAR",
      destinationId: "HINF",
      events: [
        { key: "solicitada", at: "2026-05-06T09:12" }
      ]
    },
    {
      code: "SAMU-192-260506-003",
      regulationCode: "192-0506-0311",
      flowType: "samu",
      vehicleId: "USB-12",
      originId: "OC192A",
      destinationId: "HEVV",
      events: [
        { key: "solicitada", at: "2026-05-06T08:31" },
        { key: "designada", at: "2026-05-06T08:33" },
        { key: "chegada_origem", at: "2026-05-06T08:39" },
        { key: "saida_origem", at: "2026-05-06T08:41" },
        { key: "chegada_destino", at: "2026-05-06T08:49" },
        { key: "recebido", at: "2026-05-06T09:02" }
      ]
    },
    {
      code: "SAMU-192-260506-007",
      regulationCode: "192-0506-0344",
      flowType: "samu",
      vehicleId: "USA-04",
      originId: "OC192B",
      destinationId: "HUCAM",
      events: [
        { key: "solicitada", at: "2026-05-06T09:10" },
        { key: "designada", at: "2026-05-06T09:12" },
        { key: "chegada_origem", at: "2026-05-06T09:21" }
      ]
    }
  ]
};
