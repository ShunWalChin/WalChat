/** Landing pública e autenticação: aquisição, confiança e acesso em uma só rota. */
import {
  Link,
  Navigate,
  createFileRoute,
  useNavigate,
} from '@tanstack/react-router'
import {
  ArrowRight,
  Bot,
  CalendarCheck2,
  Check,
  ChevronDown,
  Clock3,
  ContactRound,
  ExternalLink,
  Gauge,
  Instagram,
  LockKeyhole,
  MapPin,
  MessageCircleReply,
  ShieldCheck,
  Sparkles,
  Star,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../contexts/auth-context'
import { openAnalyticsPreferences } from '../components/analytics-consent'
import { seoHead } from '../lib/seo'
import { siteConfig } from '../lib/site-config'

type PublicReview = {
  id: string
  author_name: string
  author_role: string | null
  company: string | null
  quote: string
  rating: number
  source_url: string | null
}

const productPillars = [
  {
    icon: MessageCircleReply,
    title: 'Conversa que não se perde',
    text: 'Instagram e WhatsApp numa inbox com histórico, responsável e janela de envio visível.',
  },
  {
    icon: ContactRound,
    title: 'CRM de verdade',
    text: 'Contatos, tags, consentimento, notas, etapas e elegibilidade separados por workspace.',
  },
  {
    icon: CalendarCheck2,
    title: 'Lead vira agenda',
    text: 'Agentes e fluxos compartilham horários reais e evitam conflito com o Google Calendar.',
  },
  {
    icon: Bot,
    title: 'IA com freio e contexto',
    text: 'Copiloto com base de conhecimento e nova checagem de compliance antes do envio.',
  },
] as const

const validatedCases = [
  {
    label: 'COMMENT-TO-DM',
    title: 'Comentário vira conversa sem resposta duplicada.',
    text: 'A mesma interação não gera duas Private Replies e ainda respeita cooldown, opt-out e janela Meta.',
  },
  {
    label: 'AGENDAMENTO',
    title: 'O horário público já nasce protegido contra conflito.',
    text: 'Reserva, contato e evento são ligados de forma atômica; buffers e idempotência foram testados no banco.',
  },
  {
    label: 'OPERAÇÃO',
    title: 'Disparo real passa por um único portão de segurança.',
    text: 'A equipe enxerga saúde, webhooks, gates de Go-Live e o motivo exato de cada envio bloqueado.',
  },
] as const

const faq = [
  {
    question: 'O Wal Chat envia mensagem fora da janela da Meta?',
    answer:
      'Não por automação comum. O backend valida a janela de 24 horas, opt-out, cooldown e políticas permitidas antes de cada envio.',
  },
  {
    question: 'Posso conectar Instagram e WhatsApp da minha empresa?',
    answer:
      'Sim, usando contas profissionais e um aplicativo Meta configurado com as permissões aprovadas. A Central de Go-Live mostra o que ainda falta.',
  },
  {
    question: 'A IA responde sozinha?',
    answer:
      'Você escolhe. Comece no modo copiloto, aprove respostas e só habilite autonomia quando base, limites e avaliações estiverem validados.',
  },
  {
    question: 'Meus contatos ficam misturados com os de outros clientes?',
    answer:
      'Não. O produto é multi-tenant, usa workspace, autorização por papel e RLS no banco para isolar cada operação.',
  },
  {
    question: 'Consigo parar e excluir meus dados?',
    answer:
      'Sim. Há desconexão das integrações, opt-out operacional e um fluxo público de solicitação LGPD com protocolo verificável.',
  },
] as const

export const Route = createFileRoute('/')({
  head: () =>
    seoHead({
      title: 'Wal Chat — automação e atendimento para creators',
      description:
        'Centralize Instagram, WhatsApp, CRM, calendário e IA com compliance Meta e operação em português do Brasil.',
      path: '/',
    }),
  component: Home,
})

function Home() {
  const { user, loading, signIn, signUp, enterDemo, configured } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState(configured ? '' : 'demo@walchat.local')
  const [password, setPassword] = useState(configured ? '' : 'wal123')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reviews, setReviews] = useState<PublicReview[]>([])

  useEffect(() => {
    void fetch('/api/public/reviews')
      .then(async (response) => {
        if (!response.ok) return { reviews: [] }
        return (await response.json()) as { reviews: PublicReview[] }
      })
      .then((payload) => setReviews(payload.reviews))
      .catch(() => setReviews([]))
  }, [])

  if (!loading && user) return <Navigate to="/dashboard" />

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (mode === 'signup' && password.length < 12) {
      setError('Crie uma senha com pelo menos 12 caracteres.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'signup') {
        await signUp(name, email, password)
        await navigate({ to: '/obrigado' })
      } else {
        await signIn(email, password)
      }
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

  function startSignup() {
    setMode('signup')
    document.getElementById('acesso')?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    })
  }

  return (
    <div className="public-home">
      <section className="auth-page" aria-labelledby="landing-title">
        <div className="auth-story">
          <header className="landing-nav">
            <Link
              to="/"
              className="brand brand-large"
              aria-label="Wal Chat, início"
            >
              <span className="brand-mark">W</span>
              <span>WAL CHAT</span>
            </Link>
            <nav aria-label="Conteúdo da página">
              <a href="#recursos">Recursos</a>
              <a href="#casos">Casos</a>
              <a href="#faq">Dúvidas</a>
            </nav>
          </header>
          <div className="auth-copy">
            <span className="kicker">
              <Instagram size={16} /> INSTAGRAM + WHATSAPP, SEM CAÔ
            </span>
            <h1 id="landing-title">
              Seu corre.
              <br />
              <em>Seu público.</em>
              <br />
              No papo reto.
            </h1>
            <p>
              Automação, inbox, CRM, agenda e IA para creator BR crescer sem
              virar robô — e sem vacilar com as regras da Meta.
            </p>
            <div className="landing-hero-actions">
              <button className="button button-orange" onClick={startSignup}>
                Criar minha conta <ArrowRight size={17} />
              </button>
              <a className="button button-story-outline" href="#recursos">
                Ver como funciona
              </a>
            </div>
            <div className="auth-checks">
              <span>
                <Check size={16} /> Automação Meta-Safe
              </span>
              <span>
                <Check size={16} /> IA que fala sua língua
              </span>
              <span>
                <Clock3 size={16} /> {siteConfig.responseSla}
              </span>
            </div>
          </div>
          <div className="street-tag">
            FEITO EM SÃO PAULO
            <br />
            PARA QUEM FAZ ACONTECER.
          </div>
        </div>

        <div className="auth-form-side" id="acesso">
          <div className="auth-form-wrap">
            <span className="mini-badge">
              <ShieldCheck size={14} /> AMBIENTE SEGURO
            </span>
            <h2>{mode === 'login' ? 'Chega mais.' : 'Bora começar.'}</h2>
            <p>
              {mode === 'login'
                ? 'Entre para cuidar das suas conversas.'
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
                    autoComplete="name"
                    maxLength={120}
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
                  autoComplete="email"
                  inputMode="email"
                  maxLength={254}
                  required
                />
              </label>
              <label>
                Senha
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={mode === 'signup' ? 12 : 6}
                  placeholder={
                    mode === 'signup' ? 'Mínimo 12 caracteres' : 'Sua senha'
                  }
                  autoComplete={
                    mode === 'signup' ? 'new-password' : 'current-password'
                  }
                  required
                />
              </label>
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
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
              onClick={() => {
                setError('')
                setMode(mode === 'login' ? 'signup' : 'login')
              }}
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
              <LockKeyhole size={14} /> Tokens de integração ficam apenas no
              backend.
            </div>
            <div className="legal-links">
              <Link to="/privacidade">Privacidade</Link>
              <Link to="/termos">Termos</Link>
              <Link to="/exclusao-de-dados">Exclusão de dados</Link>
            </div>
          </div>
        </div>
      </section>

      <main className="landing-content">
        <section className="landing-section" id="recursos">
          <div className="landing-section-heading">
            <span className="eyebrow">UMA OPERAÇÃO, NÃO MAIS CINCO ABAS</span>
            <h2>Do primeiro “oi” até a reunião marcada.</h2>
            <p>
              Os módulos compartilham contato, contexto, consentimento e
              calendário.
            </p>
          </div>
          <div className="landing-feature-grid">
            {productPillars.map(({ icon: Icon, title, text }) => (
              <article key={title}>
                <span>
                  <Icon size={22} />
                </span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
          <a href="#acesso" className="inline-link">
            Começar agora <ArrowRight size={15} />
          </a>
        </section>

        <section className="landing-section landing-cases" id="casos">
          <div className="landing-section-heading">
            <span className="eyebrow">CASOS DE USO VALIDADOS</span>
            <h2>Prova técnica antes de promessa.</h2>
            <p>
              Estes fluxos foram exercitados em homologação. Métricas de
              clientes só serão publicadas com fonte e autorização.
            </p>
          </div>
          <div className="case-grid">
            {validatedCases.map((item, index) => (
              <article key={item.label}>
                <span>
                  0{index + 1} · {item.label}
                </span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section
          className="landing-section reviews-section"
          aria-labelledby="reviews-title"
        >
          <div className="landing-section-heading">
            <span className="eyebrow">AVALIAÇÕES REAIS</span>
            <h2 id="reviews-title">Sem depoimento inventado.</h2>
            <p>
              Apenas avaliações verificadas e autorizadas entram nesta área.
            </p>
          </div>
          {reviews.length ? (
            <div className="review-grid">
              {reviews.map((review) => (
                <article key={review.id}>
                  <div
                    className="review-stars"
                    aria-label={`${review.rating} de 5 estrelas`}
                  >
                    {Array.from({ length: review.rating }, (_, index) => (
                      <Star key={index} size={15} fill="currentColor" />
                    ))}
                  </div>
                  <blockquote>“{review.quote}”</blockquote>
                  <strong>{review.author_name}</strong>
                  <span>
                    {[review.author_role, review.company]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {review.source_url && (
                    <a
                      href={review.source_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Ver fonte <ExternalLink size={13} />
                    </a>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="review-empty">
              <Gauge size={22} />
              <div>
                <strong>Piloto em validação</strong>
                <p>
                  A primeira avaliação pública aparecerá somente após uso real e
                  consentimento.
                </p>
              </div>
            </div>
          )}
        </section>

        <section className="landing-section faq-section" id="faq">
          <div className="landing-section-heading">
            <span className="eyebrow">PERGUNTAS FREQUENTES</span>
            <h2>Antes de bater a dúvida.</h2>
          </div>
          <div className="faq-list">
            {faq.map((item) => (
              <details key={item.question}>
                <summary>
                  {item.question}
                  <ChevronDown size={18} />
                </summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="landing-section location-section" id="localizacao">
          <div>
            <span className="eyebrow">ATENDIMENTO E LOCALIZAÇÃO</span>
            <h2>Base em São Paulo. Operação online.</h2>
            <p>
              {siteConfig.businessAddress ??
                'O Wal Chat atende online. Um endereço de visita só será divulgado após cadastro comercial confirmado.'}
            </p>
            <span className="response-line">
              <Clock3 size={17} /> {siteConfig.responseSla}
            </span>
            {siteConfig.mapsUrl && (
              <a
                className="button button-outline"
                href={siteConfig.mapsUrl}
                target="_blank"
                rel="noreferrer"
              >
                <MapPin size={17} /> Como chegar <ExternalLink size={14} />
              </a>
            )}
          </div>
          {siteConfig.mapsEmbedUrl ? (
            <iframe
              title="Mapa para chegar ao Wal Chat"
              src={siteConfig.mapsEmbedUrl}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          ) : (
            <div
              className="location-placeholder"
              aria-label="Atendimento online em São Paulo"
            >
              <MapPin size={34} />
              <strong>São Paulo · Brasil</strong>
              <span>Atendimento remoto</span>
            </div>
          )}
        </section>

        <section className="landing-final-cta">
          <span className="eyebrow">PRÓXIMO PASSO</span>
          <h2>Organize a conversa antes de acelerar o volume.</h2>
          <p>Crie sua conta, valide os gates e conecte uma conta piloto.</p>
          <button className="button button-orange" onClick={startSignup}>
            Criar minha conta <ArrowRight size={17} />
          </button>
        </section>
      </main>

      <footer className="landing-footer">
        <Link to="/" className="brand">
          <span className="brand-mark">W</span> WAL CHAT
        </Link>
        <nav aria-label="Links institucionais">
          <Link to="/privacidade">Privacidade</Link>
          <Link to="/termos">Termos</Link>
          <Link to="/exclusao-de-dados">Exclusão de dados</Link>
          <a href="/sitemap.xml">Mapa do site</a>
          {siteConfig.analyticsId && (
            <button type="button" onClick={openAnalyticsPreferences}>
              Preferências de medição
            </button>
          )}
        </nav>
        <span>São Paulo, Brasil · {siteConfig.supportEmail}</span>
      </footer>

      <button className="mobile-fixed-cta" onClick={startSignup}>
        Criar minha conta <ArrowRight size={17} />
      </button>
    </div>
  )
}
