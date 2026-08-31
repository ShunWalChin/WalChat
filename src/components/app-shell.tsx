/** Shell autenticado com navegação responsiva e estado da conta conectada. */
import { Link, Navigate, Outlet, useRouterState } from '@tanstack/react-router'
import {
  BarChart3,
  HandHeart,
  BookOpenCheck,
  Bot,
  BriefcaseBusiness,
  Cable,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  ContactRound,
  GitBranch,
  Heart,
  Inbox,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  Megaphone,
  MessageCircleReply,
  Gauge,
  Plus,
  Radio,
  Radar,
  Send,
  Settings,
  UsersRound,
  Webhook,
  Workflow,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/auth-context'
import { useWorkspace } from '../contexts/workspace-context'
import { apiFetch } from '../lib/api-client'

const groups = [
  {
    label: 'CONVERSAS',
    items: [
      { to: '/dashboard', label: 'Visão geral', icon: LayoutDashboard },
      { to: '/operacoes', label: 'Operação & Go-Live', icon: Gauge },
      { to: '/inbox', label: 'Inbox', icon: Inbox },
    ],
  },
  {
    label: 'CRM',
    items: [
      { to: '/crm', label: 'Pipeline', icon: BriefcaseBusiness },
      { to: '/radar', label: 'Radar de risco', icon: Radar },
      { to: '/contatos', label: 'Contatos & tags', icon: ContactRound },
      {
        to: '/respostas',
        label: 'Respostas rápidas',
        icon: MessageCircleReply,
      },
      { to: '/equipe', label: 'Equipe', icon: UsersRound },
    ],
  },
  {
    label: 'AUTOMAÇÃO',
    items: [
      { to: '/gatilhos', label: 'Gatilhos', icon: Zap },
      { to: '/boas-vindas', label: 'Boas-vindas', icon: HandHeart },
      { to: '/captacao', label: 'Captação', icon: Link2 },
      {
        to: '/comment-to-dm',
        label: 'Comment-to-DM',
        icon: MessageCircleReply,
      },
      { to: '/sequencias', label: 'Sequências', icon: Workflow },
      { to: '/agentes', label: 'Agentes de IA', icon: Bot },
      { to: '/governanca', label: 'Governança de IA', icon: GitBranch },
      { to: '/reengajamento', label: 'Reengajamento', icon: Megaphone },
      { to: '/auto-like', label: 'Auto-like', icon: Heart },
    ],
  },
  {
    label: 'CONTEÚDO',
    items: [
      { to: '/calendario', label: 'Calendário', icon: CalendarDays },
      { to: '/publicar', label: 'Publicar', icon: Send },
      { to: '/insights', label: 'Insights', icon: BarChart3 },
    ],
  },
  {
    label: 'SISTEMA',
    items: [
      { to: '/integracoes', label: 'Integrações', icon: Cable },
      { to: '/webhooks', label: 'Webhooks de leads', icon: Webhook },
      { to: '/auditoria', label: 'Auditoria', icon: ClipboardList },
    ],
  },
] as const

const titles: Record<string, { eyebrow: string; title: string }> = {
  '/dashboard': { eyebrow: 'SEGUNDA, 21 DE JULHO', title: 'Visão geral' },
  '/operacoes': { eyebrow: 'PRONTIDÃO E TELEMETRIA', title: 'Operação' },
  '/inbox': { eyebrow: 'CONVERSAS EM TEMPO REAL', title: 'Inbox unificada' },
  '/contatos': { eyebrow: 'BASE DE RELACIONAMENTO', title: 'Contatos & tags' },
  '/crm': { eyebrow: 'FUNIL COMERCIAL', title: 'Pipeline CRM' },
  '/radar': { eyebrow: 'OPORTUNIDADES EM RISCO', title: 'Radar comercial' },
  '/respostas': {
    eyebrow: 'ATENDIMENTO CONSISTENTE',
    title: 'Respostas rápidas',
  },
  '/equipe': { eyebrow: 'CAPACIDADE E DISTRIBUIÇÃO', title: 'Equipe' },
  '/gatilhos': { eyebrow: 'AUTOMAÇÃO INTELIGENTE', title: 'Gatilhos' },
  '/boas-vindas': {
    eyebrow: 'RECEPÇÃO',
    title: 'Boas-vindas',
  },
  '/captacao': { eyebrow: 'CRESCIMENTO', title: 'Captação' },
  '/comment-to-dm': {
    eyebrow: 'CRESCIMENTO COM COMPLIANCE',
    title: 'Comment-to-DM',
  },
  '/sequencias': { eyebrow: 'FUNIS DE DM', title: 'Sequências' },
  '/agentes': { eyebrow: 'OPENAI + GEMINI', title: 'Agentes de IA' },
  '/governanca': {
    eyebrow: 'CONTROLE E OBSERVABILIDADE',
    title: 'Governança de IA',
  },
  '/reengajamento': { eyebrow: 'CAMPANHAS META-SAFE', title: 'Reengajamento' },
  '/auto-like': { eyebrow: 'ENGAJAMENTO AUTOMÁTICO', title: 'Auto-like' },
  '/calendario': { eyebrow: 'PLANEJAMENTO EDITORIAL', title: 'Calendário' },
  '/publicar': { eyebrow: 'ESTÚDIO DE CONTEÚDO', title: 'Publicar' },
  '/insights': { eyebrow: 'PERFORMANCE DO INSTAGRAM', title: 'Insights' },
  '/integracoes': {
    eyebrow: 'ECOSSISTEMA E AUTOMAÇÕES',
    title: 'Integrações',
  },
  '/webhooks': { eyebrow: 'CAPTAÇÃO EXTERNA', title: 'Webhooks de leads' },
  '/auditoria': { eyebrow: 'RASTREABILIDADE', title: 'Auditoria' },
  '/configuracoes': { eyebrow: 'CONTA E INTEGRAÇÕES', title: 'Configurações' },
  '/manual': { eyebrow: 'ACESSOS, OPERAÇÃO E CONFIGURAÇÃO', title: 'Manual' },
}

/** Protege as rotas internas e organiza sidebar, topo e conteúdo. */
export function AppShell() {
  const { user, loading, signOut } = useAuth()
  const workspace = useWorkspace()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [instagramUsername, setInstagramUsername] = useState<string | null>(
    null,
  )
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const heading = titles[pathname] ?? titles['/dashboard']

  /**
   * Grupos abertos na barra lateral.
   *
   * São 27 destinos: com todos abertos, o menu mede 1706px e doze itens ficam
   * abaixo da dobra numa tela de 900px — incluindo Calendário, Integrações e o
   * próprio Manual. A barra rola, mas ninguém percebe que rola, então metade do
   * produto some.
   *
   * O grupo da tela atual abre sempre; os outros ficam como a pessoa deixou.
   */
  const grupoDaRota =
    groups.find((g) => g.items.some((i) => i.to === pathname))?.label ??
    groups[0].label
  const [openGroups, setOpenGroups] = useState<Array<string>>([grupoDaRota])

  useEffect(() => {
    try {
      const salvos = window.localStorage.getItem('wal-chat-nav-groups')
      if (salvos) setOpenGroups(JSON.parse(salvos) as Array<string>)
    } catch {
      // Sem armazenamento local a navegação segue com o padrão.
    }
  }, [])

  // O grupo da rota atual não pode ficar fechado: a pessoa não veria onde está.
  useEffect(() => {
    setOpenGroups((atuais) =>
      atuais.includes(grupoDaRota) ? atuais : [...atuais, grupoDaRota],
    )
  }, [grupoDaRota])

  function toggleGroup(label: string) {
    setOpenGroups((atuais) => {
      const proximos = atuais.includes(label)
        ? atuais.filter((item) => item !== label)
        : [...atuais, label]
      try {
        window.localStorage.setItem(
          'wal-chat-nav-groups',
          JSON.stringify(proximos),
        )
      } catch {
        // Preferência não persistida não impede navegar.
      }
      return proximos
    })
  }

  useEffect(() => {
    if (!user) return
    void apiFetch<{
      accounts: Array<{
        username: string
        status: string
        tokenStored: boolean
      }>
    }>('/api/integrations/meta/status')
      .then((status) =>
        setInstagramUsername(
          status.accounts.find(
            (account) => account.status === 'connected' && account.tokenStored,
          )?.username ?? null,
        ),
      )
      .catch(() => setInstagramUsername(null))
  }, [user])

  useEffect(() => {
    document.title = `${heading.title} | Wal Chat`
  }, [heading.title])

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-mark">W</div>
        <span>Preparando seu corre…</span>
      </div>
    )
  }
  if (!user) return <Navigate to="/" />

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? 'is-open' : ''}`}>
        <div className="brand-row">
          <Link
            to="/dashboard"
            className="brand"
            onClick={() => setMobileOpen(false)}
          >
            <span className="brand-mark">W</span>
            <span>WAL CHAT</span>
          </Link>
          <button
            className="icon-button sidebar-close"
            onClick={() => setMobileOpen(false)}
            aria-label="Fechar menu"
          >
            <X size={20} />
          </button>
        </div>

        {workspace.workspaces.length > 1 && (
          <div className="workspace-picker">
            <label htmlFor="workspace-select">Workspace</label>
            <select
              id="workspace-select"
              value={workspace.activeId ?? ''}
              onChange={(event) => workspace.switchTo(event.target.value)}
            >
              {workspace.workspaces.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {workspace.error && (
          <p className="workspace-error" role="status">
            {workspace.error}
          </p>
        )}

        <Link to="/configuracoes" className="account-picker">
          <span className="avatar avatar-orange">WC</span>
          <span>
            <strong>
              {instagramUsername ? `@${instagramUsername}` : 'Instagram'}
            </strong>
            <small>
              {instagramUsername ? 'Instagram conectado' : 'Conexão pendente'}
            </small>
          </span>
          <ChevronDown size={16} />
        </Link>

        <nav className="nav-groups" aria-label="Navegação principal">
          {groups.map((group) => {
            const aberto = openGroups.includes(group.label)
            return (
              <div
                className={`nav-group ${aberto ? 'aberto' : ''}`}
                key={group.label}
              >
                <button
                  type="button"
                  className="nav-label"
                  aria-expanded={aberto}
                  onClick={() => toggleGroup(group.label)}
                >
                  <span>{group.label}</span>
                  <ChevronDown size={13} />
                </button>
                {aberto &&
                  group.items.map((item) => {
                    const Icon = item.icon
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        onClick={() => setMobileOpen(false)}
                        className="nav-item"
                        activeProps={{ className: 'nav-item active' }}
                      >
                        <Icon size={18} strokeWidth={2.2} />
                        <span>{item.label}</span>
                      </Link>
                    )
                  })}
              </div>
            )
          })}
        </nav>

        <div className="sidebar-foot">
          <div className="usage-card">
            <div>
              <Radio size={15} />
              <span>Conexão Meta</span>
              <strong>{instagramUsername ? 'ATIVA' : 'PENDENTE'}</strong>
            </div>
            <div className="usage-track">
              <span style={{ width: instagramUsername ? '100%' : '12%' }} />
            </div>
            <small>
              {instagramUsername
                ? `@${instagramUsername} conectada`
                : 'Conecte uma conta em Configurações'}
            </small>
          </div>
          <Link
            to="/manual"
            className="nav-item"
            activeProps={{ className: 'nav-item active' }}
          >
            <BookOpenCheck size={18} /> Manual do sistema
          </Link>
          <Link
            to="/configuracoes"
            className="nav-item"
            activeProps={{ className: 'nav-item active' }}
          >
            <Settings size={18} /> Configurações
          </Link>
          <button className="profile-row" onClick={() => void signOut()}>
            <span className="avatar avatar-dark">
              {user.name
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part[0])
                .join('')
                .toUpperCase() || 'WC'}
            </span>
            <span>
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          onClick={() => setMobileOpen(false)}
          aria-label="Fechar menu"
        />
      )}

      <main className="main-panel">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu size={20} />
          </button>
          <div className="page-title">
            <span>{heading.eyebrow}</span>
            <h1>{heading.title}</h1>
          </div>
          <div className="topbar-actions">
            <span className="connection-pill">
              <i /> {instagramUsername ? 'Meta conectada' : 'Meta pendente'}
            </span>
            <Link to="/publicar" className="button button-dark">
              <Plus size={17} /> Criar
            </Link>
          </div>
        </header>
        <div className="page-content">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
