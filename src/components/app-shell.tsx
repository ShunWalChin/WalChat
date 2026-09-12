/** Shell autenticado com navegação responsiva e estado da conta conectada. */
import { Link, Navigate, Outlet, useRouterState } from '@tanstack/react-router'
import { ChevronDown, LogOut, Menu, Plus, Radio, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/auth-context'
import { useWorkspace } from '../contexts/workspace-context'
import { apiFetch } from '../lib/api-client'
import { navigationGroups, utilityNavigationItems } from '../lib/app-navigation'

const titles: Record<string, { eyebrow: string; title: string }> = {
  '/dashboard': { eyebrow: 'RESUMO DA OPERAÇÃO', title: 'Visão geral' },
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
  const mainPanelRef = useRef<HTMLElement>(null)
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null)
  const sidebarCloseButtonRef = useRef<HTMLButtonElement>(null)
  const [instagramUsername, setInstagramUsername] = useState<string | null>(
    null,
  )
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const previousPathRef = useRef(pathname)
  const heading = titles[pathname] ?? titles['/dashboard']

  /**
   * Grupos abertos na barra lateral.
   *
   * São 25 destinos: com todos abertos, o menu mede 1706px e doze itens ficam
   * abaixo da dobra numa tela de 900px — incluindo Calendário, Integrações e o
   * próprio Manual. A barra rola, mas ninguém percebe que rola, então metade do
   * produto some.
   *
   * O grupo da tela atual abre sempre; os outros ficam como a pessoa deixou.
   */
  const grupoDaRota =
    navigationGroups.find((g) => g.items.some((i) => i.to === pathname))
      ?.label ??
    (utilityNavigationItems.some((item) => item.to === pathname)
      ? 'SISTEMA'
      : navigationGroups[0].label)
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
  }, [user, workspace.activeId])

  useEffect(() => {
    document.title = `${heading.title} | Wal Chat`
    setMobileOpen(false)
    if (previousPathRef.current !== pathname) {
      previousPathRef.current = pathname
      window.requestAnimationFrame(() => mainPanelRef.current?.focus())
    }
  }, [heading.title, pathname])

  useEffect(() => {
    if (!mobileOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(
      () => sidebarCloseButtonRef.current?.focus({ preventScroll: true }),
      30,
    )

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setMobileOpen(false)
      window.requestAnimationFrame(() => mobileMenuButtonRef.current?.focus())
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.clearTimeout(focusTimer)
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [mobileOpen])

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
      <a className="skip-link" href="#conteudo-principal">
        Pular para o conteúdo
      </a>
      <aside
        id="menu-principal"
        className={`sidebar ${mobileOpen ? 'is-open' : ''}`}
      >
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
            ref={sidebarCloseButtonRef}
            type="button"
            className="icon-button sidebar-close"
            onClick={() => {
              setMobileOpen(false)
              window.requestAnimationFrame(() =>
                mobileMenuButtonRef.current?.focus(),
              )
            }}
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
          {navigationGroups.map((group) => {
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
          {utilityNavigationItems.map((item) => {
            const Icon = item.icon
            return (
              <Link
                key={item.to}
                to={item.to}
                className="nav-item"
                activeProps={{ className: 'nav-item active' }}
              >
                <Icon size={18} /> {item.label}
              </Link>
            )
          })}
          <button
            type="button"
            className="profile-row"
            onClick={() => void signOut()}
            aria-label={`Sair da conta de ${user.name}`}
            title="Sair da conta"
          >
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
          type="button"
          className="sidebar-backdrop"
          onClick={() => {
            setMobileOpen(false)
            window.requestAnimationFrame(() =>
              mobileMenuButtonRef.current?.focus(),
            )
          }}
          aria-label="Fechar menu"
        />
      )}

      <main
        ref={mainPanelRef}
        id="conteudo-principal"
        className="main-panel"
        tabIndex={-1}
        aria-label={heading.title}
      >
        <header className="topbar">
          <button
            ref={mobileMenuButtonRef}
            type="button"
            className="icon-button mobile-menu"
            onClick={() => {
              setMobileOpen(true)
              window.requestAnimationFrame(() =>
                sidebarCloseButtonRef.current?.focus({ preventScroll: true }),
              )
            }}
            aria-label="Abrir menu"
            aria-controls="menu-principal"
            aria-expanded={mobileOpen}
          >
            <Menu size={20} />
          </button>
          <div className="page-title">
            <span>{heading.eyebrow}</span>
            {pathname === '/inbox' ? (
              <strong className="topbar-heading">{heading.title}</strong>
            ) : (
              <h1>{heading.title}</h1>
            )}
          </div>
          <div className="topbar-actions">
            <span className="connection-pill">
              <i /> {instagramUsername ? 'Meta conectada' : 'Meta pendente'}
            </span>
            <Link
              to="/publicar"
              className="button button-dark topbar-create"
              aria-label="Criar conteúdo"
              title="Criar conteúdo"
            >
              <Plus size={17} />
              <span className="topbar-create-label">Criar conteúdo</span>
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
