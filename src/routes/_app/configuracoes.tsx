/** Estado das integrações, callback Meta e proteções obrigatórias da conta. */
import { createFileRoute } from '@tanstack/react-router'
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Instagram,
  KeyRound,
  PlugZap,
  Save,
  ShieldCheck,
  Webhook,
} from 'lucide-react'
import { useState } from 'react'
import {
  ComplianceBanner,
  PageIntro,
  StatusDot,
  Switch,
} from '../../components/ui'

export const Route = createFileRoute('/_app/configuracoes')({
  component: SettingsPage,
})

function SettingsPage() {
  const [copied, setCopied] = useState(false)
  const webhookUrl = 'https://seu-dominio.com/api/public/webhooks/instagram'
  /** Copia somente a URL pública; o verify token nunca aparece na interface. */
  function copyWebhook() {
    void navigator.clipboard.writeText(webhookUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }
  return (
    <div className="stack-lg">
      <PageIntro
        title="Seu Wal Chat, bem amarrado."
        description="Conecte o Instagram, confira o webhook e ajuste as proteções da conta."
        actions={
          <button className="button button-dark">
            <Save size={16} /> Salvar alterações
          </button>
        }
      />
      <div className="settings-layout">
        <section className="stack-md">
          <article className="card settings-card">
            <div className="settings-head">
              <span className="settings-icon instagram">
                <Instagram size={22} />
              </span>
              <div>
                <h3>Instagram Business</h3>
                <StatusDot tone="green">Conectado como @wal.chat</StatusDot>
              </div>
              <button className="button button-outline">
                Reconectar <ExternalLink size={14} />
              </button>
            </div>
            <div className="permissions-grid">
              <span>
                <CheckCircle2 size={14} />
                Mensagens
              </span>
              <span>
                <CheckCircle2 size={14} />
                Comentários
              </span>
              <span>
                <CheckCircle2 size={14} />
                Publicação
              </span>
              <span>
                <CheckCircle2 size={14} />
                Insights
              </span>
            </div>
          </article>
          <article className="card settings-card">
            <div className="settings-head">
              <span className="settings-icon">
                <Webhook size={22} />
              </span>
              <div>
                <h3>Webhook da Meta</h3>
                <p>
                  Assine messages, messaging_postbacks, comments, mentions e
                  message_reactions.
                </p>
              </div>
            </div>
            <label>
              Callback URL
              <div className="copy-field">
                <input value={webhookUrl} readOnly />
                <button onClick={copyWebhook}>
                  {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
                  {copied ? 'Copiado' : 'Copiar'}
                </button>
              </div>
            </label>
            <label>
              Verify token
              <div className="secret-field">
                <input value="••••••••••••••••" readOnly />
                <KeyRound size={16} />
              </div>
            </label>
          </article>
          <article className="card settings-card">
            <div className="settings-head">
              <span className="settings-icon blue">
                <PlugZap size={22} />
              </span>
              <div>
                <h3>Lovable AI · Gemini</h3>
                <p>Usado nas sugestões, agentes e ideias de conteúdo.</p>
              </div>
              <StatusDot tone="green">Configurado</StatusDot>
            </div>
            <div className="model-row">
              <span>
                <strong>Modelo de texto</strong>
                <small>Rápido, econômico e em PT-BR</small>
              </span>
              <code>gemini-2.5-flash</code>
            </div>
          </article>
        </section>
        <aside className="stack-md">
          <ComplianceBanner />
          <article className="card safety-settings">
            <span className="eyebrow">PROTEÇÕES OBRIGATÓRIAS</span>
            <h3>Compliance por padrão</h3>
            {[
              ['Janela padrão de 24h', 'Bloqueia automação fora da janela'],
              [
                'HUMAN_AGENT até 7 dias',
                'Exige intenção de atendimento humano',
              ],
              ['Cooldown por gatilho', '24h por contato e gatilho'],
              ['Rodapé de opt-out', 'Adiciona “Responda PARAR”'],
              ['Blocklist de spam', 'Filtra conteúdo sensível'],
            ].map((item) => (
              <div className="safety-row" key={item[0]}>
                <span>
                  <strong>{item[0]}</strong>
                  <small>{item[1]}</small>
                </span>
                <Switch checked label={item[0]} />
              </div>
            ))}
          </article>
          <article className="card local-note">
            <ShieldCheck size={20} />
            <div>
              <strong>Secrets só no backend</strong>
              <p>
                META_APP_ID, META_APP_SECRET, META_ACCESS_TOKEN e
                META_PUBLISH_TOKEN nunca recebem prefixo VITE_.
              </p>
            </div>
          </article>
        </aside>
      </div>
    </div>
  )
}
