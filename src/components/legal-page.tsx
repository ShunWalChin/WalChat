/** Estrutura visual comum às páginas obrigatórias para o Live Mode da Meta. */
import { Link } from '@tanstack/react-router'
import { ArrowLeft, ShieldCheck } from 'lucide-react'

export function LegalPage({
  eyebrow,
  title,
  updated = '21 de julho de 2026',
  children,
}: {
  eyebrow: string
  title: string
  updated?: string
  children: React.ReactNode
}) {
  return (
    <div className="legal-page">
      <header>
        <Link to="/" className="brand">
          <span className="brand-mark">W</span>
          <span>WAL CHAT</span>
        </Link>
        <Link to="/" className="button button-outline">
          <ArrowLeft size={15} />
          Voltar
        </Link>
      </header>
      <main>
        <span className="mini-badge">
          <ShieldCheck size={14} />
          {eyebrow}
        </span>
        <h1>{title}</h1>
        <p className="updated">Última atualização: {updated}</p>
        <article>{children}</article>
      </main>
      <footer>Wal Chat · São Paulo, Brasil</footer>
    </div>
  )
}
