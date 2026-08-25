/**
 * Jornadas prontas em PT-BR.
 *
 * Começar de uma tela em branco é o que mais trava quem chega no editor pela
 * primeira vez. Cada template aqui é um fluxo completo e publicável: o operador
 * clona, troca os textos e publica.
 *
 * Regra que mantém isso verdadeiro: nenhum template referencia tag, agente de
 * IA, página de agenda ou subfluxo. Todos exigem um ID que só existe no
 * workspace de quem criou, e um template que nasce inválido é pior que nenhum
 * template. Campos personalizados são livres, então esses aparecem.
 */
import type { AutomationGraph } from '../server/automation-graph'

export type AutomationTemplate = {
  id: string
  name: string
  /** Uma linha explicando quando usar, na linguagem de quem opera. */
  summary: string
  /** O que o operador precisa ajustar depois de clonar. */
  nextStep: string
  graph: AutomationGraph
}

export const AUTOMATION_TEMPLATES: Array<AutomationTemplate> = [
  {
    id: 'captura-lead',
    name: 'Captura de lead',
    summary:
      'Recebe quem chegou pelo gatilho, confirma o interesse e coleta o e-mail.',
    nextStep: 'Troque os textos e conecte o gatilho que traz o contato.',
    graph: {
      schemaVersion: 3,
      entryNodeId: 'start',
      nodes: [
        { id: 'start', type: 'start' },
        {
          id: 'boasVindas',
          type: 'message',
          config: {
            text: 'Oi {{contact.display_name}}! Que bom te ver por aqui. Quer que eu te mande o material completo?',
            choices: [
              { key: 'quero', label: 'Quero sim' },
              { key: 'depois', label: 'Agora não' },
            ],
            awaitTimeoutSeconds: 86_400,
          },
        },
        {
          id: 'pedeEmail',
          type: 'user_input',
          config: {
            prompt: 'Perfeito! Qual o melhor e-mail para eu enviar?',
            expects: 'email',
            save: { target: 'custom', fieldKey: 'email_lead' },
            maxAttempts: 2,
            invalidMessage:
              'Esse e-mail não parece completo. Pode conferir e mandar de novo?',
            timeoutSeconds: 86_400,
          },
        },
        {
          id: 'confirma',
          type: 'message',
          config: {
            text: 'Anotado! Já vou preparar tudo e te aviso por aqui.',
          },
        },
        {
          id: 'semEmail',
          type: 'message',
          config: {
            text: 'Sem problema. Quando quiser, é só me chamar por aqui.',
          },
        },
        {
          id: 'sumiu',
          type: 'message',
          config: {
            text: 'Fico à disposição. Se quiser retomar, me chama.',
          },
        },
        { id: 'fim', type: 'end', config: { outcome: 'completed' } },
      ],
      edges: [
        { from: 'start', to: 'boasVindas', branch: 'default' },
        { from: 'boasVindas', to: 'pedeEmail', branch: 'quero' },
        { from: 'boasVindas', to: 'semEmail', branch: 'depois' },
        { from: 'boasVindas', to: 'sumiu', branch: 'timeout' },
        { from: 'pedeEmail', to: 'confirma', branch: 'default' },
        { from: 'pedeEmail', to: 'semEmail', branch: 'invalid' },
        { from: 'pedeEmail', to: 'sumiu', branch: 'timeout' },
        { from: 'confirma', to: 'fim', branch: 'default' },
        { from: 'semEmail', to: 'fim', branch: 'default' },
        { from: 'sumiu', to: 'fim', branch: 'default' },
      ],
    },
  },
  {
    id: 'menu-atendimento',
    name: 'Menu de atendimento',
    summary:
      'Oferece as opções mais pedidas e encaminha para atendimento humano quando precisa.',
    nextStep: 'Ajuste as opções para o que o seu público mais pergunta.',
    graph: {
      schemaVersion: 3,
      entryNodeId: 'start',
      nodes: [
        { id: 'start', type: 'start' },
        {
          id: 'menu',
          type: 'message',
          config: {
            text: 'Oi! Como posso te ajudar hoje?',
            choices: [
              { key: 'precos', label: 'Preços' },
              { key: 'prazo', label: 'Prazo' },
              { key: 'humano', label: 'Falar com alguém' },
            ],
            awaitTimeoutSeconds: 43_200,
          },
        },
        {
          id: 'respostaPrecos',
          type: 'message',
          config: {
            text: 'Nossos planos começam em R$ 000. Quer que eu detalhe algum?',
          },
        },
        {
          id: 'respostaPrazo',
          type: 'message',
          config: {
            text: 'O prazo médio de entrega é de 0 dias úteis após a confirmação.',
          },
        },
        {
          id: 'encaminha',
          type: 'handoff',
          config: {
            category: 'principal',
            priority: 'high',
            note: 'Contato pediu atendimento humano pelo menu.',
          },
        },
        {
          id: 'avisaHumano',
          type: 'message',
          config: {
            text: 'Já chamei alguém do time. Em breve te respondem por aqui.',
          },
        },
        { id: 'fim', type: 'end', config: { outcome: 'completed' } },
      ],
      edges: [
        { from: 'start', to: 'menu', branch: 'default' },
        { from: 'menu', to: 'respostaPrecos', branch: 'precos' },
        { from: 'menu', to: 'respostaPrazo', branch: 'prazo' },
        { from: 'menu', to: 'encaminha', branch: 'humano' },
        { from: 'menu', to: 'fim', branch: 'timeout' },
        { from: 'respostaPrecos', to: 'fim', branch: 'default' },
        { from: 'respostaPrazo', to: 'fim', branch: 'default' },
        { from: 'encaminha', to: 'avisaHumano', branch: 'default' },
        { from: 'avisaHumano', to: 'fim', branch: 'default' },
      ],
    },
  },
  {
    id: 'qualificacao-orcamento',
    name: 'Qualificação por orçamento',
    summary:
      'Pergunta o orçamento, guarda no CRM e separa quem já está pronto para falar com o time.',
    nextStep:
      'Ajuste o valor de corte no bloco de condição e o texto de cada saída.',
    graph: {
      schemaVersion: 3,
      entryNodeId: 'start',
      nodes: [
        { id: 'start', type: 'start' },
        {
          id: 'pergunta',
          type: 'user_input',
          config: {
            prompt:
              'Para eu te indicar o caminho certo: qual valor você tem em mente para investir?',
            expects: 'number',
            save: { target: 'custom', fieldKey: 'orcamento_informado' },
            maxAttempts: 2,
            invalidMessage: 'Pode me mandar só o número? Por exemplo: 2500',
            timeoutSeconds: 172_800,
          },
        },
        {
          id: 'temOrcamento',
          type: 'condition',
          config: {
            source: 'custom',
            field: 'orcamento_informado',
            operator: 'greater_than',
            value: 2_000,
          },
        },
        {
          id: 'marcaQualificado',
          type: 'action',
          config: {
            actions: [
              {
                type: 'set_custom_field',
                fieldKey: 'estagio_funil',
                value: 'qualificado',
              },
            ],
          },
        },
        {
          id: 'chamaTime',
          type: 'handoff',
          config: {
            category: 'pedidos',
            priority: 'urgent',
            note: 'Lead informou orçamento acima do corte.',
          },
        },
        {
          id: 'avisaQualificado',
          type: 'message',
          config: {
            text: 'Show! Já passei seu contato para o time falar com você.',
          },
        },
        {
          id: 'nutricao',
          type: 'message',
          config: {
            text: 'Entendi! Vou te mandar um conteúdo que ajuda a chegar lá.',
          },
        },
        {
          id: 'semResposta',
          type: 'message',
          config: {
            text: 'Quando tiver esse número, me chama que eu te ajudo.',
          },
        },
        { id: 'fim', type: 'end', config: { outcome: 'completed' } },
      ],
      edges: [
        { from: 'start', to: 'pergunta', branch: 'default' },
        { from: 'pergunta', to: 'temOrcamento', branch: 'default' },
        { from: 'pergunta', to: 'nutricao', branch: 'invalid' },
        { from: 'pergunta', to: 'semResposta', branch: 'timeout' },
        { from: 'temOrcamento', to: 'marcaQualificado', branch: 'true' },
        { from: 'temOrcamento', to: 'nutricao', branch: 'false' },
        { from: 'marcaQualificado', to: 'chamaTime', branch: 'default' },
        { from: 'chamaTime', to: 'avisaQualificado', branch: 'default' },
        { from: 'avisaQualificado', to: 'fim', branch: 'default' },
        { from: 'nutricao', to: 'fim', branch: 'default' },
        { from: 'semResposta', to: 'fim', branch: 'default' },
      ],
    },
  },
  {
    id: 'reengajamento',
    name: 'Reengajamento',
    summary:
      'Espera um dia, volta com uma pergunta curta e reabre a conversa de quem sumiu.',
    nextStep: 'Ajuste a espera e o texto para o tom da sua marca.',
    graph: {
      schemaVersion: 3,
      entryNodeId: 'start',
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'espera', type: 'delay', config: { seconds: 86_400 } },
        {
          id: 'volta',
          type: 'message',
          config: {
            text: 'Oi {{contact.display_name}}, consegui te ajudar naquilo?',
            choices: [
              { key: 'sim', label: 'Consegui, valeu' },
              { key: 'ainda', label: 'Ainda preciso' },
            ],
            awaitTimeoutSeconds: 259_200,
          },
        },
        {
          id: 'agradece',
          type: 'message',
          config: { text: 'Que bom! Qualquer coisa é só chamar.' },
        },
        {
          id: 'retoma',
          type: 'handoff',
          config: {
            category: 'principal',
            priority: 'normal',
            note: 'Contato pediu para retomar no reengajamento.',
          },
        },
        { id: 'fim', type: 'end', config: { outcome: 'completed' } },
      ],
      edges: [
        { from: 'start', to: 'espera', branch: 'default' },
        { from: 'espera', to: 'volta', branch: 'default' },
        { from: 'volta', to: 'agradece', branch: 'sim' },
        { from: 'volta', to: 'retoma', branch: 'ainda' },
        { from: 'volta', to: 'fim', branch: 'timeout' },
        { from: 'agradece', to: 'fim', branch: 'default' },
        { from: 'retoma', to: 'fim', branch: 'default' },
      ],
    },
  },
]

export function automationTemplate(id: string) {
  return AUTOMATION_TEMPLATES.find((template) => template.id === id) ?? null
}
