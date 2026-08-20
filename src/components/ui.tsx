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
