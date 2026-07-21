/** Shell autenticado com navegação responsiva e estado da conta conectada. */
import { Link, Navigate, Outlet, useRouterState } from '@tanstack/react-router'
import {
  BarChart3,
  Bot,
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
import { apiFetch } from '../lib/api-client'

const groups = [
  {
    label: 'CONVERSAS',
    items: [
      { to: '/dashboard', label: 'Visão geral', icon: LayoutDashboard },
      { to: '/inbox', label: 'Inbox', icon: Inbox, badge: '3' },
      { to: '/contatos', label: 'Contatos & tags', icon: ContactRound },
    ],
  },
  {
    label: 'AUTOMAÇÃO',
    items: [
      { to: '/gatilhos', label: 'Gatilhos', icon: Zap },
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
] as const

const titles: Record<string, { eyebrow: string; title: string }> = {
  '/dashboard': { eyebrow: 'SEGUNDA, 21 DE JULHO', title: 'Visão geral' },
  '/inbox': { eyebrow: 'CONVERSAS EM TEMPO REAL', title: 'Inbox unificada' },
  '/contatos': { eyebrow: 'BASE DE RELACIONAMENTO', title: 'Contatos & tags' },
  '/gatilhos': { eyebrow: 'AUTOMAÇÃO INTELIGENTE', title: 'Gatilhos' },
  '/sequencias': { eyebrow: 'FUNIS DE DM', title: 'Sequências' },
  '/agentes': { eyebrow: 'OPENAI + GEMINI', title: 'Agentes de IA' },
  '/reengajamento': { eyebrow: 'CAMPANHAS META-SAFE', title: 'Reengajamento' },
  '/auto-like': { eyebrow: 'ENGAJAMENTO AUTOMÁTICO', title: 'Auto-like' },
  '/calendario': { eyebrow: 'PLANEJAMENTO EDITORIAL', title: 'Calendário' },
  '/publicar': { eyebrow: 'ESTÚDIO DE CONTEÚDO', title: 'Publicar' },
  '/insights': { eyebrow: 'PERFORMANCE DO INSTAGRAM', title: 'Insights' },
  '/configuracoes': { eyebrow: 'CONTA E INTEGRAÇÕES', title: 'Configurações' },
}

/** Protege as rotas internas e organiza sidebar, topo e conteúdo. */
export function AppShell() {
  const { user, loading, signOut } = useAuth()
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
      accounts: Array<{ username: string; status: string }>
    }>('/api/integrations/meta/status')
      .then((status) =>
        setInstagramUsername(
          status.accounts.find((account) => account.status === 'connected')
            ?.username ?? null,
        ),
      )
      .catch(() => setInstagramUsername(null))
  }, [user])

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

        <button className="account-picker">
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
        </button>

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
                    {'badge' in item && <em>{item.badge}</em>}
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
              <span>Janela Meta</span>
              <strong>96%</strong>
            </div>
            <div className="usage-track">
              <span />
            </div>
            <small>344 de 360 DMs elegíveis</small>
          </div>
          <Link
            to="/configuracoes"
            className="nav-item"
            activeProps={{ className: 'nav-item active' }}
          >
            <Settings size={18} /> Configurações
          </Link>
          <button className="profile-row" onClick={() => void signOut()}>
            <span className="avatar avatar-dark">MD</span>
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
