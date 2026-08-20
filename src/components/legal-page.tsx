/** Estrutura visual comum às páginas obrigatórias para o Live Mode da Meta. */
import { Link } from '@tanstack/react-router'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { siteConfig } from '../lib/site-config'

export function LegalPage({
  eyebrow,
  title,
  updated = '20 de agosto de 2026',
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
      <footer>
        <span>Wal Chat · São Paulo, Brasil</span>
        <nav aria-label="Links legais">
          <Link to="/privacidade">Privacidade</Link>
          <Link to="/termos">Termos</Link>
          <Link to="/exclusao-de-dados">Exclusão</Link>
          <a href="/sitemap.xml">Mapa do site</a>
        </nav>
        <span>{siteConfig.supportEmail}</span>
      </footer>
    </div>
  )
}
