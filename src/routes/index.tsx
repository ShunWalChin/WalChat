/** Landing/login com cadastro Supabase e acesso explícito ao modo demonstração. */
import { Link, Navigate, createFileRoute } from '@tanstack/react-router'
import {
  ArrowRight,
  Check,
  Instagram,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../contexts/auth-context'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const { user, loading, signIn, signUp, enterDemo, configured } = useAuth()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState(configured ? '' : 'demo@walchat.local')
  const [password, setPassword] = useState(configured ? '' : 'wal123')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!loading && user) return <Navigate to="/dashboard" />

  /** Compartilha validação e feedback entre login e cadastro sem armazenar senha. */
  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'signup') await signUp(name, email, password)
      else await signIn(email, password)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Não deu certo. Tente novamente.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-story">
        <Link to="/" className="brand brand-large">
          <span className="brand-mark">W</span>
          <span>WAL CHAT</span>
        </Link>
        <div className="auth-copy">
          <span className="kicker">
            <Instagram size={16} /> INSTAGRAM, SEM CAÔ
          </span>
          <h1>
            Seu corre.
            <br />
            <em>Seu público.</em>
            <br />
            No papo reto.
          </h1>
          <p>
            Automação, inbox e conteúdo para creator BR crescer sem virar robô —
            e sem vacilar com as regras da Meta.
          </p>
          <div className="auth-checks">
            <span>
              <Check size={16} /> Automação Meta-Safe
            </span>
            <span>
              <Check size={16} /> IA que fala sua língua
            </span>
            <span>
              <Check size={16} /> Tudo do Instagram em um lugar
            </span>
          </div>
        </div>
        <div className="street-tag">
          FEITO EM SÃO PAULO
          <br />
          PARA QUEM FAZ ACONTECER.
        </div>
      </section>

      <section className="auth-form-side">
        <div className="auth-form-wrap">
          <span className="mini-badge">
            <ShieldCheck size={14} /> AMBIENTE SEGURO
          </span>
          <h2>{mode === 'login' ? 'Chega mais.' : 'Bora começar.'}</h2>
          <p>
            {mode === 'login'
              ? 'Entre para cuidar do seu Instagram.'
              : 'Crie sua conta e seu workspace.'}
          </p>
          <form onSubmit={submit} className="auth-form">
            {mode === 'signup' && (
              <label>
                Seu nome
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Como a gente te chama?"
                  required
                />
              </label>
            )}
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="voce@exemplo.com"
                required
              />
            </label>
            <label>
              Senha
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={6}
                placeholder="Mínimo 6 caracteres"
                required
              />
            </label>
            {error && <div className="form-error">{error}</div>}
            <button
              className="button button-orange button-full"
              disabled={busy}
            >
              {busy
                ? 'Só um instante…'
                : mode === 'login'
                  ? 'Entrar no Wal Chat'
                  : 'Criar minha conta'}
              <ArrowRight size={17} />
            </button>
          </form>
          <button
            className="text-button"
            onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
          >
            {mode === 'login'
              ? 'Ainda não tem conta? Criar agora'
              : 'Já tem conta? Entrar'}
          </button>
          {!configured && (
            <>
              <div className="or">
                <span>ou</span>
              </div>
              <button
                className="button button-outline button-full"
                onClick={enterDemo}
              >
                <Sparkles size={17} /> Explorar o modo demo
              </button>
            </>
          )}
          <div className="auth-note">
            <LockKeyhole size={14} /> Seus tokens da Meta ficam apenas no
            backend.
          </div>
          <div className="legal-links">
            <Link to="/privacidade">Privacidade</Link>
            <Link to="/termos">Termos</Link>
            <Link to="/exclusao-de-dados">Exclusão de dados</Link>
          </div>
        </div>
      </section>
    </div>
  )
}
