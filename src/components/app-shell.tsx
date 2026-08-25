/** Shell autenticado com navegação responsiva e estado da conta conectada. */
import { Link, Navigate, Outlet, useRouterState } from '@tanstack/react-router'
import {
  BarChart3,
  BookOpenCheck,
  Bot,
  Cable,
  CalendarDays,
  ChevronDown,
  ContactRound,
  Heart,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Megaphone,
  MessageSquareText,
  MessageCircleReply,
  Gauge,
  Plus,
  Radio,
  Send,
  Settings,
  Sparkles,
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
      { to: '/contatos', label: 'Contatos & tags', icon: ContactRound },
    ],
  },
  {
    label: 'AUTOMAÇÃO',
    items: [
      { to: '/gatilhos', label: 'Gatilhos', icon: Zap },
      {
        to: '/comment-to-dm',
        label: 'Comment-to-DM',
        icon: MessageCircleReply,
      },
      { to: '/sequencias', label: 'Sequências', icon: Workflow },
      { to: '/agentes', label: 'Agentes de IA', icon: Bot },
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
    items: [{ to: '/integracoes', label: 'Integrações', icon: Cable }],
  },
] as const

const titles: Record<string, { eyebrow: string; title: string }> = {
  '/dashboard': { eyebrow: 'SEGUNDA, 21 DE JULHO', title: 'Visão geral' },
  '/operacoes': { eyebrow: 'PRONTIDÃO E TELEMETRIA', title: 'Operação' },
  '/inbox': { eyebrow: 'CONVERSAS EM TEMPO REAL', title: 'Inbox unificada' },
  '/contatos': { eyebrow: 'BASE DE RELACIONAMENTO', title: 'Contatos & tags' },
  '/gatilhos': { eyebrow: 'AUTOMAÇÃO INTELIGENTE', title: 'Gatilhos' },
  '/comment-to-dm': {
    eyebrow: 'CRESCIMENTO COM COMPLIANCE',
    title: 'Comment-to-DM',
  },
  '/sequencias': { eyebrow: 'FUNIS DE DM', title: 'Sequências' },
  '/agentes': { eyebrow: 'OPENAI + GEMINI', title: 'Agentes de IA' },
  '/reengajamento': { eyebrow: 'CAMPANHAS META-SAFE', title: 'Reengajamento' },
  '/auto-like': { eyebrow: 'ENGAJAMENTO AUTOMÁTICO', title: 'Auto-like' },
  '/calendario': { eyebrow: 'PLANEJAMENTO EDITORIAL', title: 'Calendário' },
  '/publicar': { eyebrow: 'ESTÚDIO DE CONTEÚDO', title: 'Publicar' },
  '/insights': { eyebrow: 'PERFORMANCE DO INSTAGRAM', title: 'Insights' },
  '/integracoes': {
    eyebrow: 'ECOSSISTEMA E AUTOMAÇÕES',
    title: 'Integrações',
  },
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
          {groups.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-label">{group.label}</span>
              {group.items.map((item) => {
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
          ))}
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

/** Estado vazio reutilizável para módulos sem dados. */
export function EmptyState({
  icon = 'spark',
  title,
  text,
  action,
}: {
  icon?: 'spark' | 'message'
  title: string
  text: string
  action: string
}) {
  const Icon = icon === 'message' ? MessageSquareText : Sparkles
  return (
    <div className="empty-state">
      <span>
        <Icon size={25} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      <button className="button button-dark">
        <Plus size={16} />
        {action}
      </button>
    </div>
  )
}
