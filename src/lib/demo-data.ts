/** Fixtures exclusivamente visuais usadas para apresentar todos os módulos do MVP. */
export const overviewStats = [
  {
    label: 'Contas alcançadas',
    value: '84,7 mil',
    change: '+18,4%',
    tone: 'orange',
  },
  { label: 'DMs recebidas', value: '374', change: '+12,1%', tone: 'blue' },
  { label: 'DMs enviadas', value: '344', change: '+9,8%', tone: 'green' },
  { label: 'Novos contatos', value: '235', change: '+23,7%', tone: 'black' },
]

export const chartData = [
  { day: '15 jul', reach: 8.1, dms: 31 },
  { day: '16 jul', reach: 9.4, dms: 39 },
  { day: '17 jul', reach: 12.1, dms: 44 },
  { day: '18 jul', reach: 10.8, dms: 52 },
  { day: '19 jul', reach: 15.4, dms: 68 },
  { day: '20 jul', reach: 13.7, dms: 61 },
  { day: '21 jul', reach: 18.2, dms: 79 },
]

export const activity = [
  {
    title: 'Gatilho “Comentou QUERO”',
    meta: '18 contatos entraram na sequência',
    time: 'há 6 min',
    color: '#f05a28',
  },
  {
    title: 'Reel “3 erros de creator”',
    meta: 'Chegou a 18,2 mil contas',
    time: 'há 24 min',
    color: '#2f66d0',
  },
  {
    title: 'Campanha Workshop SP',
    meta: '35 de 120 mensagens enviadas',
    time: 'há 41 min',
    color: '#1d7a55',
  },
  {
    title: 'Agente Wal Vendas',
    meta: '7 sugestões aceitas hoje',
    time: 'há 1h',
    color: '#111111',
  },
]

export const conversations = [
  {
    id: 'ana',
    name: 'Ana Souza',
    user: '@ana.cria',
    preview: 'Quero o link do guia, mano!',
    time: '10:42',
    unread: 2,
    category: 'principal',
    open: true,
    initials: 'AS',
    color: '#f05a28',
  },
  {
    id: 'caio',
    name: 'Caio Martins',
    user: '@caio.sp',
    preview: 'Esse valor ainda está valendo?',
    time: '09:18',
    unread: 1,
    category: 'pedidos',
    open: false,
    initials: 'CM',
    color: '#2f66d0',
  },
  {
    id: 'bia',
    name: 'Bia Oliveira',
    user: '@biaconteudo',
    preview: 'Valeu demais pela ajuda!',
    time: 'Ontem',
    unread: 0,
    category: 'geral',
    open: true,
    initials: 'BO',
    color: '#1d7a55',
  },
  {
    id: 'leo',
    name: 'Léo Santos',
    user: '@leozera',
    preview: 'Tem mentoria individual?',
    time: 'Ontem',
    unread: 0,
    category: 'ia_off',
    open: false,
    initials: 'LS',
    color: '#8d643c',
  },
]

export const messages = [
  {
    id: 1,
    from: 'contact',
    body: 'Salve! Vi o Reels dos 3 erros e quero o link do guia.',
    time: '10:39',
  },
  {
    id: 2,
    from: 'bot',
    body: 'Aí sim, Ana! Separei o guia completo pra você 👊\n\nResponda PARAR',
    time: '10:40',
  },
  {
    id: 3,
    from: 'contact',
    body: 'Quero o link do guia, mano!',
    time: '10:42',
  },
]

export const contacts = [
  {
    name: 'Ana Souza',
    user: '@ana.cria',
    tags: ['Lead quente', 'Veio do Reels'],
    last: '18 min',
    status: '24h aberta',
    color: '#f05a28',
  },
  {
    name: 'Caio Martins',
    user: '@caio.sp',
    tags: ['Lead quente'],
    last: '27h',
    status: 'HUMAN_AGENT',
    color: '#2f66d0',
  },
  {
    name: 'Bia Oliveira',
    user: '@biaconteudo',
    tags: ['Comprou'],
    last: '2h',
    status: '24h aberta',
    color: '#1d7a55',
  },
  {
    name: 'Léo Santos',
    user: '@leozera',
    tags: ['Mentoria'],
    last: '8d',
    status: 'Bloqueada',
    color: '#8d643c',
  },
  {
    name: 'Ju Paiva',
    user: '@jupaiva',
    tags: ['Veio do Reels'],
    last: '12 min',
    status: '24h aberta',
    color: '#d5395f',
  },
]

export const triggers = [
  {
    name: 'Comentou QUERO',
    source: 'Comentário',
    keyword: 'quero',
    action: 'Sequência: Entrega do guia',
    fired: 148,
    active: true,
  },
  {
    name: 'Pediu PREÇO',
    source: 'DM',
    keyword: 'preço, valor',
    action: 'DM única: Tabela atual',
    fired: 62,
    active: true,
  },
  {
    name: 'Respondeu story',
    source: 'Story',
    keyword: 'eu quero',
    action: 'Sequência: Workshop SP',
    fired: 37,
    active: true,
  },
  {
    name: 'Cupom antigo',
    source: 'Comentário',
    keyword: 'cupom',
    action: 'DM única: Cupom JULHO',
    fired: 19,
    active: false,
  },
]

export const sequences = [
  {
    name: 'Entrega do guia',
    steps: 3,
    contacts: 148,
    conversion: '42%',
    active: true,
  },
  {
    name: 'Workshop SP',
    steps: 5,
    contacts: 83,
    conversion: '31%',
    active: true,
  },
  {
    name: 'Qualificação mentoria',
    steps: 4,
    contacts: 29,
    conversion: '55%',
    active: false,
  },
]

export const agents = [
  {
    name: 'Wal Vendas',
    mode: 'Co-piloto',
    persona:
      'Direto, parceiro e sem pressão. Qualifica o lead antes de oferecer.',
    knowledge: 12,
    active: true,
    color: '#f05a28',
  },
  {
    name: 'Suporte da Quebrada',
    mode: 'Autônomo',
    persona: 'Resolve dúvidas de acesso e pagamento com calma e clareza.',
    knowledge: 8,
    active: true,
    color: '#2f66d0',
  },
  {
    name: 'Roteirista SP',
    mode: 'Co-piloto',
    persona:
      'Cria ganchos curtos com repertório urbano e linguagem brasileira.',
    knowledge: 5,
    active: false,
    color: '#1d7a55',
  },
]

export const calendarItems = [
  {
    day: 20,
    title: 'Carrossel: erros de creator',
    kind: 'Carrossel',
    color: '#2f66d0',
  },
  {
    day: 21,
    title: 'Reel: bastidores no centro',
    kind: 'Reel',
    color: '#f05a28',
  },
  {
    day: 23,
    title: 'Story: caixa de perguntas',
    kind: 'Story',
    color: '#1d7a55',
  },
  {
    day: 25,
    title: 'Feed: manifesto Wal Chat',
    kind: 'Feed',
    color: '#111111',
  },
  { day: 28, title: 'Reel: antes e depois', kind: 'Reel', color: '#f05a28' },
]

export const heatmap = [
  [12, 18, 22, 28, 35, 41, 26],
  [16, 24, 31, 38, 48, 53, 34],
  [22, 35, 46, 58, 67, 72, 49],
  [31, 45, 61, 75, 89, 94, 68],
  [19, 29, 43, 57, 70, 82, 55],
]
