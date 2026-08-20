/** Editor visual de passos de automação; a execução real pertence ao scheduler. */
import { createFileRoute } from '@tanstack/react-router'
import {
  Clock3,
  GripVertical,
  Image,
  MessageSquareText,
  MoreHorizontal,
  MousePointer2,
  Plus,
  Timer,
  Type,
} from 'lucide-react'
import { useState } from 'react'
import { sequences } from '../../lib/demo-data'
import { PageIntro, PrototypeNotice, Switch } from '../../components/ui'

export const Route = createFileRoute('/_app/sequencias')({
  component: SequencesPage,
})

const initialSteps = [
  {
    id: 1,
    kind: 'typing',
    label: 'Digitando…',
    content: '2 segundos',
    icon: Timer,
  },
  {
    id: 2,
    kind: 'text',
    label: 'Mensagem de boas-vindas',
    content: 'Aí sim! Aqui está o guia que prometi 👊\nResponda PARAR',
    icon: Type,
  },
  { id: 3, kind: 'delay', label: 'Esperar', content: '1 hora', icon: Clock3 },
  {
    id: 4,
    kind: 'text',
    label: 'Acompanhamento',
    content: 'Conseguiu abrir? Se quiser, te ajudo por aqui.\nResponda PARAR',
    icon: MessageSquareText,
  },
]

function SequencesPage() {
  const [selected, setSelected] = useState(0)
  const [steps, setSteps] = useState(initialSteps)
  return (
    <div className="stack-lg">
      <PageIntro
        title="Conversa que continua."
        description="Monte jornadas de DM com texto, mídia e tempo de espera — sempre respeitando a janela Meta."
        actions={
          <button className="button button-dark" disabled>
            <Plus size={16} /> Nova sequência
          </button>
        }
      />
      <PrototypeNotice title="Editor completo ainda não persiste este desenho">
        O scheduler possui políticas para passos existentes, mas criar, editar,
        versionar, testar e publicar uma sequência por esta tela ainda é parte
        da próxima etapa de backend.
      </PrototypeNotice>
      <div className="sequence-layout">
        <aside className="card sequence-sidebar">
          <div className="section-title">
            <span>SUAS SEQUÊNCIAS</span>
            <button
              className="icon-button"
              disabled
              aria-label="Nova sequência"
            >
              <Plus size={16} />
            </button>
          </div>
          {sequences.map((sequence, index) => (
            <button
              className={`sequence-list-item ${selected === index ? 'active' : ''}`}
              key={sequence.name}
              onClick={() => setSelected(index)}
            >
              <span>
                <strong>{sequence.name}</strong>
                <small>
                  {sequence.steps} passos · {sequence.contacts} contatos
                </small>
              </span>
              <Switch
                checked={sequence.active}
                label={sequence.name}
                disabled
              />
            </button>
          ))}
        </aside>

        <section className="card sequence-editor">
          <header>
            <div>
              <span className="eyebrow">EDITOR VISUAL</span>
              <h3>{sequences[selected].name}</h3>
            </div>
            <div>
              <span className="saved-state">Salvo agora</span>
              <button className="button button-outline" disabled>
                Testar fluxo
              </button>
            </div>
          </header>
          <div className="canvas">
            <div className="start-node">
              <MousePointer2 size={18} />
              <span>
                <strong>ENTRADA</strong>
                <small>Gatilho “Comentou QUERO”</small>
              </span>
            </div>
            {steps.map((step, index) => {
              const Icon = step.icon
              return (
                <div key={step.id} className="step-wrap">
                  <span className="connector" />
                  <article className={`flow-node kind-${step.kind}`}>
                    <GripVertical size={17} />
                    <span className="node-icon">
                      <Icon size={18} />
                    </span>
                    <div>
                      <strong>{step.label}</strong>
                      <p>{step.content}</p>
                    </div>
                    <button className="icon-button">
                      <MoreHorizontal size={18} />
                    </button>
                  </article>
                  {index === steps.length - 1 && <span className="connector" />}
                </div>
              )
            })}
            <button
              className="add-step"
              onClick={() =>
                setSteps((current) => [
                  ...current,
                  {
                    id: Date.now(),
                    kind: 'text',
                    label: 'Nova mensagem',
                    content: 'Edite esta mensagem · Responda PARAR',
                    icon: MessageSquareText,
                  },
                ])
              }
            >
              <Plus size={17} /> Adicionar bloco
            </button>
            <div className="block-options">
              <button>
                <Type size={15} />
                Texto
              </button>
              <button>
                <Image size={15} />
                Mídia
              </button>
              <button>
                <Timer size={15} />
                Delay
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
