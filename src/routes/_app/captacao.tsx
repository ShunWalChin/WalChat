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
  Plus,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { PageIntro } from '../../components/ui'
import { apiFetch } from '../../lib/api-client'

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

      <p className="growth-footnote">
        A contagem é de conversas atribuídas, não de toques no link: a Meta só
        avisa quando a conversa abre.
      </p>
    </div>
  )
}
