/** Catálogo único das ferramentas exibidas na navegação e na central de comando. */
import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  BookOpenCheck,
  Bot,
  BriefcaseBusiness,
  Cable,
  CalendarDays,
  ClipboardList,
  ContactRound,
  Gauge,
  GitBranch,
  HandHeart,
  Heart,
  Inbox,
  LayoutDashboard,
  Link2,
  Megaphone,
  MessageCircleReply,
  Radar,
  Send,
  Settings,
  UsersRound,
  Webhook,
  Workflow,
  Zap,
} from 'lucide-react'

export type AppNavigationTool = {
  to: string
  label: string
  description: string
  keywords: string
  icon: LucideIcon
}

export const navigationGroups = [
  {
    id: 'conversas',
    label: 'CONVERSAS',
    title: 'Atendimento e operação',
    description: 'Acompanhe canais, saúde da operação e conversas em curso.',
    tone: 'orange',
    items: [
      {
        to: '/dashboard',
        label: 'Visão geral',
        description: 'Resumo executivo da operação multicanal.',
        keywords: 'dashboard início indicadores resumo',
        icon: LayoutDashboard,
      },
      {
        to: '/operacoes',
        label: 'Operação & Go-Live',
        description: 'Monitore prontidão, integrações e gates de produção.',
        keywords: 'saúde go live status produção telemetria',
        icon: Gauge,
      },
      {
        to: '/inbox',
        label: 'Inbox',
        description: 'Atenda Instagram e WhatsApp em uma única fila.',
        keywords: 'mensagens atendimento conversa direct dm whatsapp instagram',
        icon: Inbox,
      },
    ],
  },
  {
    id: 'crm',
    label: 'CRM',
    title: 'Relacionamento e vendas',
    description: 'Organize contatos, oportunidades e o trabalho da equipe.',
    tone: 'blue',
    items: [
      {
        to: '/crm',
        label: 'Pipeline',
        description: 'Crie, mova e acompanhe oportunidades no funil.',
        keywords: 'crm lead negócio oportunidade kanban venda funil',
        icon: BriefcaseBusiness,
      },
      {
        to: '/radar',
        label: 'Radar de risco',
        description: 'Priorize leads atrasados, parados ou sem responsável.',
        keywords: 'risco prioridade atraso próximo passo comercial',
        icon: Radar,
      },
      {
        to: '/contatos',
        label: 'Contatos & tags',
        description: 'Consulte a base, tags, origem e elegibilidade por canal.',
        keywords: 'pessoas base clientes tags consentimento origem',
        icon: ContactRound,
      },
      {
        to: '/respostas',
        label: 'Respostas rápidas',
        description: 'Padronize mensagens reutilizáveis para o atendimento.',
        keywords: 'mensagem pronta modelo atendimento texto template',
        icon: MessageCircleReply,
      },
      {
        to: '/equipe',
        label: 'Equipe',
        description: 'Gerencie membros, funções e distribuição do trabalho.',
        keywords: 'usuários agentes responsáveis capacidade permissões',
        icon: UsersRound,
      },
    ],
  },
  {
    id: 'automacao',
    label: 'AUTOMAÇÃO',
    title: 'Automação e inteligência',
    description: 'Configure jornadas, agentes de IA e rotinas de crescimento.',
    tone: 'violet',
    items: [
      {
        to: '/gatilhos',
        label: 'Gatilhos',
        description: 'Automatize ações a partir de eventos e condições.',
        keywords: 'evento regra ação automação instagram whatsapp',
        icon: Zap,
      },
      {
        to: '/boas-vindas',
        label: 'Boas-vindas',
        description: 'Configure a recepção automática do primeiro contato.',
        keywords: 'recepção primeira mensagem onboarding saudação',
        icon: HandHeart,
      },
      {
        to: '/captacao',
        label: 'Captação',
        description: 'Crie entradas rastreáveis para novos contatos e leads.',
        keywords: 'link lead formulário origem campanha entrada',
        icon: Link2,
      },
      {
        to: '/comment-to-dm',
        label: 'Comment-to-DM',
        description: 'Converta comentários elegíveis em conversas no direct.',
        keywords: 'comentário direct dm instagram automação',
        icon: MessageCircleReply,
      },
      {
        to: '/sequencias',
        label: 'Sequências',
        description: 'Monte cadências de mensagens e acompanhamentos.',
        keywords: 'follow up cadência jornada mensagens funil',
        icon: Workflow,
      },
      {
        to: '/agentes',
        label: 'Agentes de IA',
        description: 'Crie e teste agentes com contexto do seu negócio.',
        keywords: 'llm inteligência artificial openai gemini prompt treino',
        icon: Bot,
      },
      {
        to: '/governanca',
        label: 'Governança de IA',
        description: 'Controle versões, limites, escaladas e observabilidade.',
        keywords: 'ia controle custo orçamento versão auditoria escalada',
        icon: GitBranch,
      },
      {
        to: '/reengajamento',
        label: 'Reengajamento',
        description: 'Reative contatos com campanhas seguras e segmentadas.',
        keywords: 'campanha público retorno marketing mensagens',
        icon: Megaphone,
      },
      {
        to: '/auto-like',
        label: 'Auto-like',
        description: 'Consulte e controle a automação de engajamento.',
        keywords: 'curtida engajamento instagram status',
        icon: Heart,
      },
    ],
  },
  {
    id: 'conteudo',
    label: 'CONTEÚDO',
    title: 'Conteúdo e agenda',
    description: 'Planeje, publique e acompanhe o desempenho dos conteúdos.',
    tone: 'green',
    items: [
      {
        to: '/calendario',
        label: 'Calendário',
        description: 'Organize eventos, tarefas e compromissos do Google.',
        keywords: 'agenda google evento tarefa reunião compromisso',
        icon: CalendarDays,
      },
      {
        to: '/publicar',
        label: 'Publicar',
        description: 'Prepare e envie publicações para os canais conectados.',
        keywords: 'post conteúdo carrossel copy instagram criar',
        icon: Send,
      },
      {
        to: '/insights',
        label: 'Insights',
        description: 'Analise alcance, interação e performance do Instagram.',
        keywords: 'métricas relatório desempenho alcance instagram',
        icon: BarChart3,
      },
    ],
  },
  {
    id: 'sistema',
    label: 'SISTEMA',
    title: 'Integrações e controle',
    description:
      'Conecte serviços e acompanhe a rastreabilidade da plataforma.',
    tone: 'dark',
    items: [
      {
        to: '/integracoes',
        label: 'Integrações',
        description: 'Conecte Meta, Google, provedores de IA e automações.',
        keywords: 'api meta google n8n omniroute conexão provedor chave',
        icon: Cable,
      },
      {
        to: '/webhooks',
        label: 'Webhooks de leads',
        description: 'Receba leads externos com endpoints monitorados.',
        keywords: 'api webhook entrada formulário integração evento',
        icon: Webhook,
      },
      {
        to: '/auditoria',
        label: 'Auditoria',
        description: 'Investigue ações, eventos e mudanças no sistema.',
        keywords: 'log histórico segurança rastreabilidade eventos',
        icon: ClipboardList,
      },
    ],
  },
] as const

export const utilityNavigationItems = [
  {
    to: '/configuracoes',
    label: 'Configurações',
    description: 'Ajuste conta, workspace, canais e provedores de IA.',
    keywords: 'preferências conta workspace api chave provedor perfil',
    icon: Settings,
  },
  {
    to: '/manual',
    label: 'Manual do sistema',
    description: 'Consulte acessos, preparação e instruções de operação.',
    keywords: 'ajuda documentação guia suporte tutorial acesso',
    icon: BookOpenCheck,
  },
] as const

export const commandCenterGroups = [
  ...navigationGroups,
  {
    id: 'suporte',
    label: 'SUPORTE',
    title: 'Configuração e ajuda',
    description: 'Administre o ambiente e encontre instruções de operação.',
    tone: 'slate',
    items: utilityNavigationItems,
  },
] as const
