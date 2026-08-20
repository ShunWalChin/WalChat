/** Assistente editorial e preview para Feed, Reel, Story e Carrossel. */
import { createFileRoute } from '@tanstack/react-router'
import {
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  LayoutGrid,
  Play,
  Send,
  Sparkles,
  WandSparkles,
} from 'lucide-react'
import { useState } from 'react'
import { PageIntro, PrototypeNotice } from '../../components/ui'

export const Route = createFileRoute('/_app/publicar')({
  component: PublishPage,
})

const types = [
  { name: 'Feed', icon: ImageIcon },
  { name: 'Reels', icon: Play },
  { name: 'Story', icon: Send },
  { name: 'Carrossel', icon: LayoutGrid },
]

function PublishPage() {
  const [type, setType] = useState('Carrossel')
  const [caption, setCaption] = useState(
    'Seu conteúdo não precisa parecer propaganda.\n\nEle precisa parecer você — só que mais claro, consistente e impossível de ignorar.\n\nSalva pra lembrar no próximo post. #CreatorBR #Conteudo',
  )
  const [generating, setGenerating] = useState(false)
  const [slide, setSlide] = useState(1)
  /** Gera copy demonstrativa; publicação real exige token e container da Graph API. */
  function generate() {
    setGenerating(true)
    window.setTimeout(() => {
      setCaption(
        '3 sinais de que seu conteúdo tá falando sozinho:\n\n1. Muito alcance, pouca conversa\n2. CTA genérico demais\n3. Você posta e some\n\nA boa? Dá pra virar esse jogo hoje. Comenta QUERO que eu mando o guia.\n\n#CreatorBR #InstagramParaNegocios',
      )
      setGenerating(false)
    }, 700)
  }
  return (
    <div className="stack-lg">
      <PageIntro
        title="Do rascunho pro feed."
        description="Crie copy, roteiro e slides com IA. Revise no preview real antes de publicar."
      />
      <PrototypeNotice title="Estúdio em modo de prévia">
        A copy demonstrativa fica apenas neste navegador. Upload, containers de
        mídia, agendamento e publicação pela Graph API continuam desabilitados.
      </PrototypeNotice>
      <div className="publish-layout">
        <section className="card publish-form">
          <div className="type-picker">
            {types.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.name}
                  className={type === item.name ? 'active' : ''}
                  onClick={() => setType(item.name)}
                >
                  <Icon size={18} />
                  {item.name}
                </button>
              )
            })}
          </div>
          <label>
            Tema ou briefing
            <textarea
              placeholder="Ex.: 3 erros que creators cometem…"
              defaultValue="Por que creator pequeno precisa de uma comunidade forte"
            />
          </label>
          <div className="ai-tools">
            <button onClick={generate}>
              <Sparkles size={16} />
              Gerar copy
            </button>
            <button disabled>
              <WandSparkles size={16} />
              Criar roteiro
            </button>
            <button disabled>
              <LayoutGrid size={16} />
              Gerar slides
            </button>
          </div>
          {generating && (
            <div className="generating-line">
              <i /> A IA está buscando um gancho melhor…
            </div>
          )}
          <label>
            Legenda
            <textarea
              className="caption-area"
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
            />
            <small>{caption.length}/2.200</small>
          </label>
          {type === 'Carrossel' && (
            <div className="slides-strip">
              {[1, 2, 3, 4, 5].map((number) => (
                <button
                  key={number}
                  onClick={() => setSlide(number)}
                  className={slide === number ? 'active' : ''}
                >
                  <span>
                    {number === 1
                      ? '3 SINAIS'
                      : number === 5
                        ? 'COMENTA QUERO'
                        : `SINAL 0${number - 1}`}
                  </span>
                  <em>{number}</em>
                </button>
              ))}
              <button className="add-slide">+</button>
            </div>
          )}
          <div className="publish-actions">
            <button className="button button-outline" disabled>
              <CalendarClock size={16} /> Agendar
            </button>
            <button className="button button-orange" disabled>
              <Send size={16} /> Publicar agora
            </button>
          </div>
        </section>
        <aside className="preview-column">
          <span className="eyebrow">PREVIEW DO INSTAGRAM</span>
          <div className="instagram-preview">
            <div className="ig-head">
              <span className="avatar avatar-orange">WC</span>
              <strong>wal.chat</strong>
              <em>•••</em>
            </div>
            <div className={`creative-slide slide-${slide}`}>
              <span className="urban-line" />
              <small>WAL CHAT APRESENTA</small>
              <strong>
                {slide === 1
                  ? '3 SINAIS DE QUE SEU CONTEÚDO TÁ FALANDO SOZINHO.'
                  : slide === 5
                    ? 'QUER VIRAR O JOGO? COMENTA “QUERO”.'
                    : `${slide - 1}. SEU CONTEÚDO CHEGA, MAS NÃO PUXA CONVERSA.`}
              </strong>
              <em>0{slide}/05</em>
            </div>
            <div className="ig-controls">
              <span>♡ ⌁ ⌯</span>
              <span>◯ ◉ ◯ ◯ ◯</span>
              <span>▢</span>
            </div>
            <div className="ig-caption">
              <strong>wal.chat</strong> {caption.slice(0, 90)}…{' '}
              <span>mais</span>
            </div>
          </div>
          <div className="preview-pager">
            <button
              className="icon-button"
              onClick={() => setSlide(Math.max(1, slide - 1))}
              aria-label="Slide anterior"
            >
              <ChevronLeft size={18} />
            </button>
            <span>Slide {slide} de 5</span>
            <button
              className="icon-button"
              onClick={() => setSlide(Math.min(5, slide + 1))}
              aria-label="Próximo slide"
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="publish-check">
            <Check size={15} />
            Proporção, legenda e mídia validadas
          </div>
        </aside>
      </div>
    </div>
  )
}
