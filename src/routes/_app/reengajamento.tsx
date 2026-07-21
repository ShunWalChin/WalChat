/** Construtor de campanha com preview de elegibilidade e taxa segura. */
import { createFileRoute } from '@tanstack/react-router'
import {
  CheckCircle2,
  Clock3,
  Filter,
  Info,
  Megaphone,
  ShieldCheck,
  Users,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { ComplianceBanner, PageIntro } from '../../components/ui'

export const Route = createFileRoute('/_app/reengajamento')({
  component: ReengagementPage,
})

function ReengagementPage() {
  const [rate, setRate] = useState(35)
  const [message, setMessage] = useState(
    'Salve! Passando pra avisar que a aula nova já está no ar. Quer o link?\n\nResponda PARAR',
  )
  const [checked, setChecked] = useState(false)
  return (
    <div className="stack-lg">
      <PageIntro
        title="Chama quem ainda tá por perto."
        description="Campanhas filtradas pela elegibilidade da Meta, com ritmo seguro de 30–45 mensagens por minuto."
      />
      <ComplianceBanner compact />
      <div className="campaign-builder">
        <section className="card campaign-form">
          <div className="step-heading">
            <span>1</span>
            <div>
              <h3>Escolha o público</h3>
              <p>Os filtros nunca ignoram a janela de envio.</p>
            </div>
          </div>
          <button className="filter-builder">
            <Filter size={17} />
            <span>
              <strong>Tag é “Lead quente”</strong>
              <small>E última interação nos últimos 7 dias</small>
            </span>
            <em>Editar</em>
          </button>
          <div className="eligibility-summary">
            <div className="eligible">
              <CheckCircle2 size={20} />
              <span>
                <strong>235</strong>
                <small>elegíveis em 24h</small>
              </span>
            </div>
            <div className="human">
              <Clock3 size={20} />
              <span>
                <strong>48</strong>
                <small>HUMAN_AGENT 7d</small>
              </span>
            </div>
            <div className="blocked">
              <XCircle size={20} />
              <span>
                <strong>109</strong>
                <small>bloqueados</small>
              </span>
            </div>
          </div>
          <div className="step-heading">
            <span>2</span>
            <div>
              <h3>Escreva a mensagem</h3>
              <p>O rodapé de opt-out é obrigatório.</p>
            </div>
          </div>
          <label className="message-editor">
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
            <small>{message.length}/1.000</small>
          </label>
          <div className="step-heading">
            <span>3</span>
            <div>
              <h3>Defina o ritmo</h3>
              <p>Evite picos de envio.</p>
            </div>
          </div>
          <label className="rate-control">
            <span>
              <strong>{rate} mensagens/min</strong>
              <small>Previsão: 7 minutos</small>
            </span>
            <input
              type="range"
              min="30"
              max="45"
              value={rate}
              onChange={(event) => setRate(Number(event.target.value))}
            />
          </label>
          <button
            className="button button-dark button-full"
            onClick={() => setChecked(true)}
          >
            <ShieldCheck size={17} /> Checar elegibilidade e revisar
          </button>
          {checked && (
            <div className="success-message">
              <CheckCircle2 size={17} /> Preview gerado: 235 destinatários podem
              receber agora.
            </div>
          )}
        </section>
        <aside className="card campaign-preview">
          <span className="eyebrow">PREVIEW DO ENVIO</span>
          <h3>Workshop SP</h3>
          <div className="phone-preview compact-phone">
            <div className="phone-top">
              <span>wal.chat</span>
            </div>
            <div className="ig-chat-preview">
              <div className="ig-bubble">{message}</div>
            </div>
          </div>
          <div className="preview-meta">
            <p>
              <Users size={15} />
              235 destinatários
            </p>
            <p>
              <Megaphone size={15} />
              Campanha em massa
            </p>
            <p>
              <Info size={15} />
              Só envia após nova checagem
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
