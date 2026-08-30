/**
 * Links de captação.
 *
 * Cada link leva a pessoa direto para o seu direct e diz de onde ela veio. É o
 * caminho que a Meta abre no API público para trazer gente de fora — e o mais
 * próximo do que o Follow to DM faz por parceria, com a vantagem de rastrear a
 * origem.
 */
import { createFileRoute } from '@tanstack/react-router'
import {
  Check,
  Copy,
  Info,
  Link2,
  LoaderCircle,
  MessageCircleQuestion,
  Plus,
  QrCode,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { PageIntro } from '../../components/ui'
import { apiFetch, apiFetchText } from '../../lib/api-client'
import { refFromName } from '../../server/growth-links'

export const Route = createFileRoute('/_app/captacao')({
  component: GrowthLinksScreen,
})

type Link = {
  id: string
  name: string
  ref: string
  is_active: boolean
  clicks: number
  last_click_at: string | null
  url: string | null
}

function GrowthLinksScreen() {
  const [links, setLinks] = useState<Array<Link>>([])
  const [username, setUsername] = useState<string | null>(null)
  const [nome, setNome] = useState('')
  const [busy, setBusy] = useState<string | null>('load')
  const [copiado, setCopiado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    try {
      const dados = await apiFetch<{
        username: string | null
        links: Array<Link>
      }>('/api/growth-links')
      setLinks(dados.links)
      setUsername(dados.username)
      setErro(null)
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'Falha ao carregar.')
    } finally {
      setBusy(null)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function criar() {
    if (!nome.trim()) return
    setBusy('create')
    try {
      await apiFetch('/api/growth-links', {
        method: 'POST',
        body: JSON.stringify({ name: nome.trim(), isActive: true }),
      })
      setNome('')
      await carregar()
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'Falha ao criar.')
    } finally {
      setBusy(null)
    }
  }

  async function desativar(id: string) {
    setBusy(id)
    try {
      await apiFetch('/api/growth-links', {
        method: 'DELETE',
        body: JSON.stringify({ id }),
      })
      await carregar()
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'Falha ao desativar.')
    } finally {
      setBusy(null)
    }
  }

  /**
   * Abre o QR numa aba própria.
   *
   * Não dá para usar um link direto: o endpoint exige o token no cabeçalho, e
   * um `href` não o carrega. Buscar e abrir como blob resolve sem expor o token
   * na URL.
   */
  async function abrirQrCode(ref: string) {
    try {
      const svg = await apiFetchText(
        `/api/growth-links/qrcode?ref=${encodeURIComponent(ref)}`,
      )
      const blob = new Blob([svg], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      // A revogação espera a aba ler o blob; imediata deixaria a janela vazia.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (causa) {
      setErro(
        causa instanceof Error ? causa.message : 'Falha ao gerar o QR code.',
      )
    }
  }

  async function copiar(url: string, id: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopiado(id)
      setTimeout(() => setCopiado(null), 1800)
    } catch {
      // Clipboard bloqueado: o link continua visível para seleção manual.
      setErro('Não consegui copiar. Selecione o link e copie manualmente.')
    }
  }

  return (
    <div className="growth-page">
      <PageIntro
        title="Links de captação"
        description="Cada link abre seu direct e registra de onde a pessoa veio."
      />

      <section className="growth-note">
        <Info size={16} />
        <div>
          <strong>Como funciona</strong>
          <p>
            Quem toca no link cai direto na conversa com você, e a janela de 24
            horas abre no mesmo ato — então a saudação pode sair legalmente. O
            código de origem volta no webhook, então você sabe qual campanha
            trouxe cada pessoa.
          </p>
          <p className="growth-warning">
            Links <code>ig.me</code> funcionam apenas no aplicativo do
            Instagram. No navegador eles não abrem.
          </p>
        </div>
      </section>

      {!username && !busy && (
        <p className="growth-empty">
          Conecte uma conta do Instagram em Integrações para gerar os links.
        </p>
      )}

      <section className="growth-create">
        <input
          value={nome}
          maxLength={80}
          placeholder="Nome da origem. Ex: Link da bio"
          onChange={(event) => setNome(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void criar()
          }}
        />
        <button
          className="button button-orange"
          onClick={() => void criar()}
          disabled={Boolean(busy) || nome.trim().length < 2}
        >
          {busy === 'create' ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <Plus size={15} />
          )}{' '}
          Criar link
        </button>
      </section>

      {erro && <p className="growth-error">{erro}</p>}

      {busy === 'load' ? (
        <p className="growth-empty">
          <LoaderCircle className="spin" size={16} /> Carregando…
        </p>
      ) : links.length === 0 ? (
        <p className="growth-empty">
          Nenhum link ainda. Crie o primeiro para a sua bio.
        </p>
      ) : (
        <ul className="growth-list">
          {links.map((link) => (
            <li
              key={link.id}
              className={`growth-item ${link.is_active ? '' : 'is-off'}`}
            >
              <div className="growth-item-head">
                <Link2 size={15} />
                <strong>{link.name}</strong>
                {!link.is_active && <span className="growth-tag">inativo</span>}
              </div>

              {link.url && (
                <div className="growth-url">
                  <code>{link.url}</code>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Copiar link ${link.name}`}
                    onClick={() => void copiar(link.url!, link.id)}
                  >
                    {copiado === link.id ? (
                      <Check size={14} />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Ver QR code de ${link.name}`}
                    onClick={() => void abrirQrCode(link.ref)}
                  >
                    <QrCode size={14} />
                  </button>
                </div>
              )}

              <div className="growth-item-foot">
                <span>
                  <strong>{link.clicks}</strong> conversa
                  {link.clicks === 1 ? '' : 's'} atribuída
                  {link.clicks === 1 ? '' : 's'}
                </span>
                {link.is_active && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Desativar ${link.name}`}
                    disabled={busy === link.id}
                    onClick={() => void desativar(link.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <IcebreakersSection />

      <p className="growth-footnote">
        A contagem é de conversas atribuídas, não de toques no link: a Meta só
        avisa quando a conversa abre.
      </p>
    </div>
  )
}

/** Máximo que a Meta aceita no perfil de mensagens. */
const MAX_ICEBREAKERS = 4

type Icebreaker = { question: string; ref: string }

/**
 * Perguntas prontas do direct.
 *
 * Ficam nesta tela porque são a outra metade da captação: o link traz alguém
 * até a porta, a pergunta dá a ela uma frase para começar em vez de uma caixa
 * em branco. E cada uma carrega a mesma origem de um link, então a atribuição é
 * a mesma.
 */
function IcebreakersSection() {
  const [perguntas, setPerguntas] = useState<Array<Icebreaker>>([])
  const [busy, setBusy] = useState<string | null>('load')
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    try {
      const dados = await apiFetch<{ icebreakers: Array<Icebreaker> }>(
        '/api/icebreakers',
      )
      setPerguntas(dados.icebreakers)
      setErro(null)
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'Falha ao carregar.')
    } finally {
      setBusy(null)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function publicar() {
    setBusy('save')
    try {
      await apiFetch('/api/icebreakers', {
        method: 'PUT',
        body: JSON.stringify(perguntas.filter((p) => p.question.trim())),
      })
      setAviso(
        perguntas.length
          ? 'Perguntas publicadas no seu direct.'
          : 'Perguntas removidas do seu direct.',
      )
      setErro(null)
      await carregar()
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'Falha ao publicar.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="growth-block">
      <div className="growth-block-head">
        <h2>Perguntas prontas</h2>
        <span>
          {perguntas.length} de {MAX_ICEBREAKERS}
        </span>
      </div>
      <p className="growth-hint">
        Aparecem no seu direct antes de a pessoa digitar. Cada uma tem sua
        própria origem, então você sabe qual assunto trouxe cada conversa. Não
        aparecem no Instagram para computador.
      </p>

      {busy === 'load' ? (
        <p className="growth-empty">
          <LoaderCircle className="spin" size={16} /> Carregando…
        </p>
      ) : (
        <>
          <div className="growth-questions">
            {perguntas.map((pergunta, index) => (
              <div className="growth-question" key={index}>
                <input
                  value={pergunta.question}
                  maxLength={80}
                  placeholder="Ex: Como funciona?"
                  aria-label={`Pergunta ${index + 1}`}
                  onChange={(event) =>
                    setPerguntas(
                      perguntas.map((item, i) =>
                        i === index
                          ? {
                              question: event.target.value,
                              // A origem sai do texto: pedir as duas coisas
                              // obrigaria a entender o mecanismo.
                              ref: refFromName(
                                event.target.value,
                                perguntas
                                  .filter((_, j) => j !== index)
                                  .map((item2) => item2.ref),
                              ),
                            }
                          : item,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remover pergunta ${index + 1}`}
                  onClick={() =>
                    setPerguntas(perguntas.filter((_, i) => i !== index))
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="growth-actions">
            {perguntas.length < MAX_ICEBREAKERS && (
              <button
                type="button"
                className="button button-outline"
                onClick={() =>
                  setPerguntas([...perguntas, { question: '', ref: 'nova' }])
                }
              >
                <Plus size={14} /> Adicionar pergunta
              </button>
            )}
            <button
              type="button"
              className="button button-orange"
              disabled={
                Boolean(busy) ||
                perguntas.some((p) => p.question.trim().length < 2)
              }
              onClick={() => void publicar()}
            >
              {busy === 'save' ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <MessageCircleQuestion size={15} />
              )}{' '}
              Publicar no direct
            </button>
          </div>
        </>
      )}

      {aviso && <p className="growth-ok">{aviso}</p>}
      {erro && <p className="growth-error">{erro}</p>}
    </section>
  )
}
