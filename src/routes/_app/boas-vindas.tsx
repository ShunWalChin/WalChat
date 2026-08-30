/**
 * Tela das boas-vindas ao primeiro contato.
 *
 * Guiada de propósito: quem quer saudar quem chega não deveria precisar montar
 * um grafo. A tela escreve até quatro mensagens e o backend as publica como um
 * fluxo normal — que continua abrível no Automation Studio para ramificar.
 */
import { createFileRoute } from '@tanstack/react-router'
import {
  Clock3,
  Info,
  LoaderCircle,
  MessageSquareText,
  Plus,
  Save,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { PageIntro } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'

export const Route = createFileRoute('/_app/boas-vindas')({
  component: WelcomeScreen,
})

const MAX_MESSAGES = 4

const CANAIS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'dm', label: 'Direct', hint: 'Primeira mensagem no direct' },
  { key: 'comment', label: 'Comentário', hint: 'Primeiro comentário num post' },
  { key: 'story_reply', label: 'Resposta de story', hint: 'Primeira resposta' },
  { key: 'mention', label: 'Menção', hint: 'Primeira menção ao perfil' },
]

type Mensagem = {
  text: string
  delaySeconds: number
  mediaUrl: string | null
}

type Configuracao = {
  configured: boolean
  isActive: boolean
  channels: Array<string>
  cooldownHours: number
  messages: Array<Mensagem>
  flowId?: string
}

function WelcomeScreen() {
  const [config, setConfig] = useState<Configuracao | null>(null)
  const [busy, setBusy] = useState<string | null>('load')
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'error'
    text: string
  } | null>(null)

  const carregar = useCallback(async () => {
    setBusy('load')
    try {
      setConfig(await apiFetch<Configuracao>('/api/welcome'))
      setFeedback(null)
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao carregar.',
      })
    } finally {
      setBusy(null)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function salvar() {
    if (!config) return
    setBusy('save')
    try {
      const resultado = await apiFetch<{ saved: boolean }>('/api/welcome', {
        method: 'PUT',
        body: JSON.stringify({
          isActive: config.isActive,
          channels: config.channels,
          cooldownHours: config.cooldownHours,
          messages: config.messages.map((m) => ({
            text: m.text,
            delaySeconds: m.delaySeconds,
            ...(m.mediaUrl ? { mediaUrl: m.mediaUrl } : {}),
          })),
        }),
      })
      if (resultado.saved) {
        setFeedback({
          tone: 'success',
          text: config.isActive
            ? 'Boas-vindas salvas e ativas. Quem chegar agora será recebido.'
            : 'Boas-vindas salvas como rascunho. Ative quando quiser começar.',
        })
        await carregar()
      }
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Falha ao salvar.',
      })
    } finally {
      setBusy(null)
    }
  }

  function atualizarMensagem(index: number, mudanca: Partial<Mensagem>) {
    if (!config) return
    setConfig({
      ...config,
      messages: config.messages.map((m, i) =>
        i === index ? { ...m, ...mudanca } : m,
      ),
    })
  }

  if (busy === 'load' && !config)
    return (
      <div className="welcome-loading">
        <LoaderCircle className="spin" size={20} /> Carregando…
      </div>
    )

  if (!config)
    return (
      <div className="welcome-loading">
        {feedback?.text ?? 'Não foi possível carregar.'}
      </div>
    )

  const totalEspera = config.messages.reduce(
    (soma, m, i) => soma + (i > 0 ? m.delaySeconds : 0),
    0,
  )

  return (
    <div className="welcome-page">
      <PageIntro
        title="Boas-vindas a quem chega"
        description="Até quatro mensagens enviadas automaticamente na primeira vez que alguém fala com você."
      />

      <section className="welcome-note">
        <Info size={16} />
        <div>
          <strong>Por que "primeiro contato" e não "novo seguidor"</strong>
          <p>
            A API do Instagram não avisa quando alguém segue o perfil, e a
            política de mensageria só permite enviar DM depois que a pessoa
            escreve. Saudar quem fala com você pela primeira vez é o que a
            plataforma permite — e alcança quem realmente demonstrou interesse.
          </p>
        </div>
      </section>

      <section className="welcome-switch">
        <label>
          <input
            type="checkbox"
            checked={config.isActive}
            onChange={(event) =>
              setConfig({ ...config, isActive: event.target.checked })
            }
          />
          <span>
            <strong>{config.isActive ? 'Ativas' : 'Desativadas'}</strong>
            <small>
              {config.isActive
                ? 'Novos contatos recebem a saudação automaticamente.'
                : 'Nada é enviado enquanto estiver desativado.'}
            </small>
          </span>
        </label>
      </section>

      <section className="welcome-block">
        <h2>Quando saudar</h2>
        <div className="welcome-channels">
          {CANAIS.map((canal) => {
            const ativo = config.channels.includes(canal.key)
            return (
              <button
                key={canal.key}
                type="button"
                className={`welcome-channel ${ativo ? 'is-on' : ''}`}
                onClick={() =>
                  setConfig({
                    ...config,
                    channels: ativo
                      ? config.channels.filter((c) => c !== canal.key)
                      : [...config.channels, canal.key],
                  })
                }
              >
                <strong>{canal.label}</strong>
                <small>{canal.hint}</small>
              </button>
            )
          })}
        </div>
        {config.channels.length === 0 && (
          <p className="welcome-warning">
            Escolha ao menos um canal, senão a saudação nunca dispara.
          </p>
        )}
      </section>

      <section className="welcome-block">
        <div className="welcome-block-head">
          <h2>A conversa</h2>
          <span>
            {config.messages.length} de {MAX_MESSAGES} ·{' '}
            {totalEspera > 0
              ? `${Math.round(totalEspera / 60)} min até a última`
              : 'todas seguidas'}
          </span>
        </div>

        <div className="welcome-chat">
          {config.messages.map((mensagem, index) => (
            <article className="welcome-message" key={index}>
              <header>
                <span className="welcome-message-index">
                  <MessageSquareText size={14} /> Mensagem {index + 1}
                </span>
                {config.messages.length > 1 && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remover mensagem ${index + 1}`}
                    onClick={() =>
                      setConfig({
                        ...config,
                        messages: config.messages.filter((_, i) => i !== index),
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </header>

              {index > 0 && (
                <label className="welcome-delay">
                  <Clock3 size={13} />
                  <span>Esperar</span>
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={Math.round(mensagem.delaySeconds / 60)}
                    onChange={(event) =>
                      atualizarMensagem(index, {
                        delaySeconds:
                          Math.max(
                            0,
                            Math.min(1440, Number(event.target.value)),
                          ) * 60,
                      })
                    }
                  />
                  <span>minutos antes desta</span>
                </label>
              )}

              <textarea
                value={mensagem.text}
                maxLength={1000}
                rows={3}
                placeholder="Escreva como você falaria de verdade."
                onChange={(event) =>
                  atualizarMensagem(index, { text: event.target.value })
                }
              />
              <div className="welcome-message-foot">
                <span>{mensagem.text.length}/1000</span>
                <span className="welcome-optout">
                  O rodapé “Responda PARAR” é acrescentado no envio.
                </span>
              </div>
            </article>
          ))}
        </div>

        {config.messages.length < MAX_MESSAGES && (
          <button
            type="button"
            className="button button-outline"
            onClick={() =>
              setConfig({
                ...config,
                messages: [
                  ...config.messages,
                  { text: '', delaySeconds: 60, mediaUrl: null },
                ],
              })
            }
          >
            <Plus size={14} /> Adicionar mensagem
          </button>
        )}
      </section>

      <section className="welcome-block">
        <h2>Não repetir para a mesma pessoa por</h2>
        <label className="welcome-cooldown">
          <input
            type="number"
            min={1}
            max={168}
            value={config.cooldownHours}
            onChange={(event) =>
              setConfig({
                ...config,
                cooldownHours: Math.max(
                  1,
                  Math.min(168, Number(event.target.value)),
                ),
              })
            }
          />
          <span>horas</span>
        </label>
      </section>

      {feedback && (
        <p className={`welcome-feedback is-${feedback.tone}`}>
          {feedback.text}
        </p>
      )}

      <div className="welcome-actions">
        <button
          className="button button-orange"
          onClick={() => void salvar()}
          disabled={
            Boolean(busy) ||
            config.channels.length === 0 ||
            config.messages.some((m) => !m.text.trim())
          }
        >
          {busy === 'save' ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <Save size={15} />
          )}{' '}
          Salvar e publicar
        </button>
        {config.flowId && (
          <a className="button button-outline" href="/sequencias">
            Abrir no Automation Studio
          </a>
        )}
      </div>
    </div>
  )
}
