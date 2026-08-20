/** Recupera uma URL inválida com caminhos úteis e status 404 real do Router. */
import { Link } from '@tanstack/react-router'
import {
  ArrowLeft,
  BookOpenCheck,
  LayoutDashboard,
  SearchX,
} from 'lucide-react'
import { useEffect } from 'react'
import { useAuth } from '../contexts/auth-context'

export function NotFoundPage() {
  const { user } = useAuth()
  useEffect(() => {
    document.title = 'Página não encontrada | Wal Chat'
  }, [])
  return (
    <main className="not-found-page">
      <Link to="/" className="brand">
        <span className="brand-mark">W</span>
        <span>WAL CHAT</span>
      </Link>
      <section>
        <span className="not-found-code">404</span>
        <span className="not-found-icon">
          <SearchX size={28} />
        </span>
        <small>ESSA RUA NÃO EXISTE</small>
        <h1>Virou na esquina errada.</h1>
        <p>
          O endereço pode ter mudado ou foi digitado com algum detalhe a mais.
          Escolha um caminho seguro para continuar.
        </p>
        <div className="not-found-actions">
          <Link to={user ? '/dashboard' : '/'} className="button button-orange">
            {user ? <LayoutDashboard size={17} /> : <ArrowLeft size={17} />}
            {user ? 'Voltar ao painel' : 'Ir para o início'}
          </Link>
          {user ? (
            <Link to="/manual" className="button button-outline">
              <BookOpenCheck size={17} /> Consultar o manual
            </Link>
          ) : (
            <Link to="/privacidade" className="button button-outline">
              Privacidade
            </Link>
          )}
        </div>
      </section>
    </main>
  )
}
