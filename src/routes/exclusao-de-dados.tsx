/** Página pública de instruções e protocolo de exclusão de dados. */
import { createFileRoute } from '@tanstack/react-router'
import { CheckCircle2, LoaderCircle, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { LegalPage } from '../components/legal-page'
import { seoHead } from '../lib/seo'

export const Route = createFileRoute('/exclusao-de-dados')({
  head: () =>
    seoHead({
      title: 'Exclusão de Dados',
      description:
        'Solicite exclusão de dados do Wal Chat e acompanhe o protocolo exigido pela LGPD e pela Meta.',
      path: '/exclusao-de-dados',
    }),
  component: DeletionPage,
})

function DeletionPage() {
  const [email, setEmail] = useState('')
  const [instagramUsername, setInstagramUsername] = useState('')
  const [reason, setReason] = useState('')
  const [website, setWebsite] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/privacy/deletion-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          instagramUsername: instagramUsername || null,
          reason: reason || null,
          website,
        }),
      })
      const payload = (await response.json().catch(() => null)) as {
        error?: string
        confirmationCode?: string
      } | null
      if (!response.ok || !payload?.confirmationCode)
        throw new Error(
          payload?.error ?? 'Não foi possível registrar o pedido.',
        )
      setConfirmation(payload.confirmationCode)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível registrar o pedido.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <LegalPage eyebrow="CONTROLE DOS SEUS DADOS" title="Exclusão de Dados">
      <p>
        Você pode desconectar o Instagram e excluir permanentemente os dados
        associados ao seu workspace. A solicitação inclui contatos, mensagens,
        métricas, automações, conteúdos e credenciais armazenadas.
      </p>
      <h2>Como solicitar</h2>
      <ol>
        <li>Informe abaixo o email usado no Wal Chat.</li>
        <li>Confirme a solicitação pelo email recebido.</li>
        <li>
          Concluiremos a exclusão em até 30 dias e enviaremos um comprovante.
        </li>
      </ol>
      {confirmation ? (
        <div className="deletion-success">
          <CheckCircle2 size={22} />
          <div>
            <strong>Solicitação registrada</strong>
            <p>
              Protocolo: <code>{confirmation}</code>. A equipe fará contato em
              até 2 dias úteis para verificar sua identidade antes da exclusão.
            </p>
          </div>
        </div>
      ) : (
        <form className="deletion-form" onSubmit={submit}>
          <label>
            Email da conta
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
            Usuário do Instagram (opcional)
            <input
              value={instagramUsername}
              onChange={(event) => setInstagramUsername(event.target.value)}
              placeholder="@seuperfil"
              maxLength={80}
            />
          </label>
          <label>
            Observação (opcional)
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={1000}
              placeholder="Explique o que precisa ser localizado ou excluído."
            />
          </label>
          <label className="form-honeypot" aria-hidden="true">
            Website
            <input
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
              tabIndex={-1}
              autoComplete="off"
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="button button-orange"
            type="submit"
            disabled={busy}
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Trash2 size={16} />
            )}
            {busy ? 'Registrando…' : 'Solicitar exclusão'}
          </button>
        </form>
      )}
      <h2>Callback da Meta</h2>
      <p>
        Solicitações recebidas pelo mecanismo de exclusão da Meta geram um
        código de confirmação e seguem o mesmo fluxo seguro. Dados que precisem
        ser mantidos por obrigação legal serão isolados e eliminados ao fim do
        prazo aplicável.
      </p>
    </LegalPage>
  )
}
