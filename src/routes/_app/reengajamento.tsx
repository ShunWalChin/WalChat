/** Campanhas persistentes com preview e rechecagem de compliance no worker. */
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  CheckCircle2,
  Clock3,
  Info,
  LoaderCircle,
  Megaphone,
  Save,
  Send,
  ShieldCheck,
  Users,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ComplianceBanner, PageIntro } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'

export const Route = createFileRoute('/_app/reengajamento')({
  component: ReengagementPage,
})

type Campaign = {
  id: string
  name: string
  message: string
  status: string
  ratePerMinute: number
  tagId: string | null
  scheduledAt: string | null
  total: number
  sent: number
  blocked: number
}
type CampaignData = {
  campaigns: Campaign[]
  tags: Array<{ id: string; name: string; color: string }>
  runtime: { demoMode: boolean; canManage: boolean }
}
type Preview = {
  summary: {
    eligible: number
    humanAgentOnly: number
    blocked: number
    total: number
  }
  contacts: Array<{
    contactId: string
    name: string
    username: string | null
    platform: string
    eligibility: string
    reason: string | null
  }>
  body: string
}

const defaultMessage =
  'Salve! Passando pra avisar que a aula nova já está no ar. Quer o link?\n\nResponda PARAR'

function ReengagementPage() {
  const [data, setData] = useState<CampaignData | null>(null)
  const [campaignId, setCampaignId] = useState<string | null>(null)
  const [name, setName] = useState('Campanha de reengajamento')
  const [tagId, setTagId] = useState('')
  const [rate, setRate] = useState(35)
  const [scheduledAt, setScheduledAt] = useState('')
  const [message, setMessage] = useState(defaultMessage)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState<string | null>('load')
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'error'
    text: string
  } | null>(null)

  const load = useCallback(async () => {
    setBusy('load')
    try {
      setData(await apiFetch<CampaignData>('/api/campaigns'))
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao carregar.',
      })
    } finally {
      setBusy(null)
    }
  }, [])

  useEffect(() => void load(), [load])

  function selectCampaign(campaign: Campaign) {
    setCampaignId(campaign.id)
    setName(campaign.name)
    setMessage(campaign.message)
    setRate(campaign.ratePerMinute)
    setTagId(campaign.tagId ?? '')
    setScheduledAt(
      campaign.scheduledAt
        ? new Date(campaign.scheduledAt).toISOString().slice(0, 16)
        : '',
    )
    setPreview(null)
    setFeedback(null)
  }

  async function runPreview() {
    setBusy('preview')
    try {
      const result = await apiFetch<Preview>('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          action: 'preview',
          name,
          message,
          ratePerMinute: rate,
          tagId: tagId || null,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        }),
      })
      setPreview(result)
      setFeedback({
        tone: 'success',
        text: `Elegibilidade calculada agora: ${result.summary.eligible} contatos podem receber automação. O worker revalidará todos no instante do envio.`,
      })
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha no preview.',
      })
    } finally {
      setBusy(null)
    }
  }

  async function saveDraft() {
    setBusy('save')
    try {
      const result = await apiFetch<{ id: string }>('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          action: 'save',
          ...(campaignId ? { id: campaignId } : {}),
          name,
          message,
          ratePerMinute: rate,
          tagId: tagId || null,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        }),
      })
      setCampaignId(result.id)
      await load()
      setFeedback({ tone: 'success', text: 'Rascunho salvo no backend.' })
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao salvar.',
      })
    } finally {
      setBusy(null)
    }
  }

  async function startCampaign() {
    if (!campaignId) {
      setFeedback({
        tone: 'error',
        text: 'Salve o rascunho antes de iniciar.',
      })
      return
    }
    if (!window.confirm('Confirmar nova checagem e enfileirar os elegíveis?'))
      return
    setBusy('start')
    try {
      const result = await apiFetch<{ queued: number }>('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({ action: 'start', id: campaignId }),
      })
      await load()
      setFeedback({
        tone: 'success',
        text: `${result.queued} mensagens foram enfileiradas com rechecagem individual.`,
      })
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao iniciar.',
      })
    } finally {
      setBusy(null)
    }
  }

  const summary = preview?.summary ?? {
    eligible: 0,
    humanAgentOnly: 0,
    blocked: 0,
    total: 0,
  }
  return (
    <div className="stack-lg">
      <PageIntro
        title="Chama quem ainda tá por perto."
        description="Crie campanhas reais com público persistido, ritmo controlado e elegibilidade revalidada em cada envio."
        actions={
          <button
            className="button button-outline"
            onClick={() => {
              setCampaignId(null)
              setName('Campanha de reengajamento')
              setMessage(defaultMessage)
              setTagId('')
              setScheduledAt('')
              setPreview(null)
            }}
          >
            Nova campanha
          </button>
        }
      />
      <ComplianceBanner compact />
      {data?.runtime.demoMode && (
        <div className="prototype-notice" role="status">
          <ShieldCheck size={20} />
          <div>
            <strong>Envio externo continua protegido</strong>
            <p>
              Preview e rascunho já são reais. Iniciar só será aceito depois de
              remover o DEMO_MODE e liberar a{' '}
              <Link to="/operacoes">Central de Go-Live</Link>.
            </p>
          </div>
        </div>
      )}
      {feedback && (
        <div
          className={feedback.tone === 'error' ? 'form-error' : 'form-success'}
          role={feedback.tone === 'error' ? 'alert' : 'status'}
        >
          {feedback.text}
        </div>
      )}
      <div className="campaign-builder">
        <section className="card campaign-form">
          {data && data.campaigns.length > 0 && (
            <label>
              Campanhas salvas
              <select
                value={campaignId ?? ''}
                onChange={(event) => {
                  const selected = data.campaigns.find(
                    (item) => item.id === event.target.value,
                  )
                  if (selected) selectCampaign(selected)
                }}
              >
                <option value="">Novo rascunho</option>
                {data.campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name} · {campaign.status} · {campaign.sent}/
                    {campaign.total}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="step-heading">
            <span>1</span>
            <div>
              <h3>Escolha o público</h3>
              <p>Tag opcional; nenhum filtro ignora a janela de envio.</p>
            </div>
          </div>
          <div className="two-fields">
            <label>
              Nome da campanha
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Filtrar por tag
              <select
                value={tagId}
                onChange={(event) => {
                  setTagId(event.target.value)
                  setPreview(null)
                }}
              >
                <option value="">Todos os contatos</option>
                {data?.tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="eligibility-summary">
            <div className="eligible">
              <CheckCircle2 size={20} />
              <span>
                <strong>{summary.eligible}</strong>
                <small>elegíveis em 24h</small>
              </span>
            </div>
            <div className="human">
              <Clock3 size={20} />
              <span>
                <strong>{summary.humanAgentOnly}</strong>
                <small>só atendimento humano</small>
              </span>
            </div>
            <div className="blocked">
              <XCircle size={20} />
              <span>
                <strong>{summary.blocked}</strong>
                <small>bloqueados</small>
              </span>
            </div>
          </div>
          <div className="step-heading">
            <span>2</span>
            <div>
              <h3>Escreva a mensagem</h3>
              <p>O rodapé de opt-out é aplicado pelo backend.</p>
            </div>
          </div>
          <label className="message-editor">
            <textarea
              value={message}
              maxLength={950}
              onChange={(event) => {
                setMessage(event.target.value)
                setPreview(null)
              }}
            />
            <small>{message.length}/950</small>
          </label>
          <div className="step-heading">
            <span>3</span>
            <div>
              <h3>Defina ritmo e horário</h3>
              <p>A fila distribui os jobs sem picos.</p>
            </div>
          </div>
          <label className="rate-control">
            <span>
              <strong>{rate} mensagens/min</strong>
              <small>
                Previsão:{' '}
                {summary.eligible
                  ? Math.max(1, Math.ceil(summary.eligible / rate))
                  : 0}{' '}
                minutos
              </small>
            </span>
            <input
              type="range"
              min="30"
              max="45"
              value={rate}
              onChange={(event) => setRate(Number(event.target.value))}
            />
          </label>
          <label>
            Agendar (opcional)
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
            />
          </label>
          <div className="campaign-actions-grid">
            <button
              className="button button-outline"
              onClick={() => void saveDraft()}
              disabled={
                Boolean(busy) ||
                !name.trim() ||
                !message.trim() ||
                !data?.runtime.canManage
              }
            >
              {busy === 'save' ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <Save size={17} />
              )}{' '}
              Salvar rascunho
            </button>
            <button
              className="button button-dark"
              onClick={() => void runPreview()}
              disabled={Boolean(busy) || !name.trim() || !message.trim()}
            >
              {busy === 'preview' ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <ShieldCheck size={17} />
              )}{' '}
              Checar elegibilidade
            </button>
            <button
              className="button button-orange"
              onClick={() => void startCampaign()}
              disabled={
                Boolean(busy) || !campaignId || !preview?.summary.eligible
              }
            >
              {busy === 'start' ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <Send size={17} />
              )}{' '}
              Iniciar campanha
            </button>
          </div>
        </section>
        <aside className="card campaign-preview">
          <span className="eyebrow">PREVIEW DO ENVIO</span>
          <h3>{name}</h3>
          <div className="phone-preview compact-phone">
            <div className="phone-top">
              <span>Wal Chat</span>
            </div>
            <div className="ig-chat-preview">
              <div className="ig-bubble">{preview?.body ?? message}</div>
            </div>
          </div>
          <div className="preview-meta">
            <p>
              <Users size={15} /> {summary.eligible} destinatários automáticos
            </p>
            <p>
              <Megaphone size={15} /> {rate} mensagens/min
            </p>
            <p>
              <Info size={15} /> HUMAN_AGENT nunca é usado em massa
            </p>
          </div>
          {preview && preview.contacts.length > 0 && (
            <div className="campaign-contact-preview">
              <strong>Amostra auditável</strong>
              {preview.contacts.slice(0, 8).map((contact) => (
                <span key={contact.contactId}>
                  {contact.name} · {contact.platform} ·{' '}
                  {contact.eligibility === 'standard_24h'
                    ? 'elegível'
                    : contact.eligibility === 'human_agent_7d'
                      ? 'somente humano'
                      : 'bloqueado'}
                </span>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
