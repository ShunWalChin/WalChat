/** Gestão de gatilhos por palavra-chave e origem do evento Instagram. */
import { createFileRoute } from '@tanstack/react-router'
import {
  ArrowRight,
  MessageCircle,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { triggers as seedTriggers } from '../../lib/demo-data'
import { ComplianceBanner, PageIntro, Switch } from '../../components/ui'

export const Route = createFileRoute('/_app/gatilhos')({
  component: TriggersPage,
})

function TriggersPage() {
  const [items, setItems] = useState(seedTriggers)
  return (
    <div className="stack-lg">
      <PageIntro
        title="Da palavra pra conversa."
        description="Escute comentários, DMs e stories. O Wal Chat faz o primeiro contato — uma vez só, na hora certa."
        actions={
          <button className="button button-orange">
            <Plus size={16} /> Criar gatilho
          </button>
        }
      />
      <ComplianceBanner compact />
      <div className="filter-pills">
        <button className="active">
          Todos <em>4</em>
        </button>
        <button>Comentários</button>
        <button>DM</button>
        <button>Story</button>
      </div>
      <section className="trigger-list">
        {items.map((trigger, index) => (
          <article
            className={`card trigger-card ${trigger.active ? '' : 'muted'}`}
            key={trigger.name}
          >
            <span className="trigger-source">
              <MessageCircle size={20} />
            </span>
            <div className="trigger-main">
              <div>
                <h3>{trigger.name}</h3>
                <span className="source-chip">{trigger.source}</span>
              </div>
              <p>
                Quando alguém disser <mark>“{trigger.keyword}”</mark>
              </p>
              <div className="flow-line">
                <Zap size={14} />
                <span>{trigger.action}</span>
                <ArrowRight size={14} />
              </div>
            </div>
            <div className="trigger-metrics">
              <strong>{trigger.fired}</strong>
              <small>disparos</small>
            </div>
            <div className="trigger-controls">
              <Switch
                checked={trigger.active}
                label={`Ativar ${trigger.name}`}
                onChange={() =>
                  setItems((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, active: !item.active }
                        : item,
                    ),
                  )
                }
              />
              <button className="icon-button">
                <MoreHorizontal size={20} />
              </button>
            </div>
            <footer>
              <ShieldCheck size={13} /> Cooldown 24h · 1 private reply por
              comentário · opt-out automático
            </footer>
          </article>
        ))}
      </section>
    </div>
  )
}
