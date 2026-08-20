/** Confirma conversões sem indexar uma página de estado transitório. */
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowRight, CheckCircle2, MailCheck, ShieldCheck } from 'lucide-react'
import { useAuth } from '../contexts/auth-context'
import { seoHead } from '../lib/seo'
import { siteConfig } from '../lib/site-config'

export const Route = createFileRoute('/obrigado')({
  head: () =>
    seoHead({
      title: 'Obrigado',
      description: 'Confirmação de ação no Wal Chat e próximos passos.',
      path: '/obrigado',
      noindex: true,
    }),
  component: ThankYouPage,
})

function ThankYouPage() {
  const { user } = useAuth()
  return (
    <main className="thank-you-page">
      <Link to="/" className="brand">
        <span className="brand-mark">W</span>
        <span>WAL CHAT</span>
      </Link>
      <section className="thank-you-card">
        <span className="thank-you-icon">
          <CheckCircle2 size={34} />
        </span>
        <small>AÇÃO CONFIRMADA</small>
        <h1>Fechou. Próximo passo.</h1>
        <p>
          Seu registro foi recebido. Se houver confirmação por email, confira
          também a caixa de spam antes de tentar novamente.
        </p>
        <div className="thank-you-steps">
          <span>
            <MailCheck size={19} /> Confira seu email
          </span>
          <span>
            <ShieldCheck size={19} /> Não compartilhe códigos ou senhas
          </span>
        </div>
        <Link to={user ? '/dashboard' : '/'} className="button button-orange">
          {user ? 'Abrir meu painel' : 'Voltar ao início'}{' '}
          <ArrowRight size={17} />
        </Link>
        <small className="response-promise">{siteConfig.responseSla}</small>
      </section>
    </main>
  )
}
