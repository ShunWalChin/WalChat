/** Componentes pequenos e consistentes compartilhados entre os módulos do painel. */
import { ShieldCheck } from 'lucide-react'

/** Cabeçalho padrão das páginas internas. */
export function PageIntro({
  title,
  description,
  actions,
}: {
  title: string
  description: string
  actions?: React.ReactNode
}) {
  return (
    <div className="page-intro">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

/** Switch controlado e acessível para flags do MVP. */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange?: () => void
  label?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className={`switch ${checked ? 'on' : ''}`}
      onClick={onChange}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
    >
      <span />
    </button>
  )
}

/** Lembra na UI que o backend reaplica elegibilidade antes de enviar. */
export function ComplianceBanner({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`compliance-banner ${compact ? 'compact' : ''}`}>
      <span className="compliance-icon">
        <ShieldCheck size={20} />
      </span>
      <div>
        <strong>Proteção Meta ativa</strong>
        <p>
          Janela de 24h, template WhatsApp, opt-out, cooldown e elegibilidade
          são validados antes de cada envio.
        </p>
      </div>
      <span className="safe-label">META-SAFE</span>
    </div>
  )
}

export function StatusDot({
  tone = 'green',
  children,
}: {
  tone?: 'green' | 'orange' | 'gray' | 'red' | 'blue'
  children: React.ReactNode
}) {
  return (
    <span className={`status-dot ${tone}`}>
      <i />
      {children}
    </span>
  )
}

export function Avatar({
  name,
  color = '#111111',
}: {
  name: string
  color?: string
}) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
  return (
    <span className="avatar" style={{ background: color }}>
      {initials}
    </span>
  )
}

/**
 * Estado vazio com a ação dentro dele.
 *
 * Existia um componente assim, sem consumidores, e ele foi removido na
 * limpeza — o que estava errado era não usá-lo. Cada tela escrevia o próprio
 * vazio: um texto centralizado numa caixa grande, com o botão de criar no
 * canto superior oposto. A pessoa lê "Nenhuma resposta" e o próximo passo está
 * a uma diagonal inteira de distância, fora do campo de visão.
 *
 * A distinção entre `vazio` e `semResultado` importa: "não encontrei" sugere
 * que existe algo escondido por um filtro, e dizer isso quando nada foi criado
 * ainda faz a pessoa procurar em vez de começar.
 */
export function EstadoVazio({
  titulo,
  texto,
  acao,
  semResultado = false,
}: {
  titulo: string
  texto?: string
  acao?: React.ReactNode
  semResultado?: boolean
}) {
  return (
    <div className="estado-vazio" role="status">
      <strong>{titulo}</strong>
      {texto && <p>{texto}</p>}
      {!semResultado && acao && <div className="estado-vazio-acao">{acao}</div>}
    </div>
  )
}
