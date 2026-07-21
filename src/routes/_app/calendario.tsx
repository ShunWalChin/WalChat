/** Calendário editorial com alternância mês/semana e movimentação por drag-and-drop. */
import { createFileRoute } from '@tanstack/react-router'
import {
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  Plus,
  Sparkles,
} from 'lucide-react'
import { useState } from 'react'
import { calendarItems as initialItems } from '../../lib/demo-data'
import { PageIntro } from '../../components/ui'

export const Route = createFileRoute('/_app/calendario')({
  component: CalendarPage,
})

const weekdays = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM']
const calendarDays = Array.from({ length: 35 }, (_, index) => index - 1)

function CalendarPage() {
  const [items, setItems] = useState(initialItems)
  const [ideas, setIdeas] = useState(false)
  /** Move apenas o card identificado, preservando os demais itens do calendário. */
  function moveItem(title: string, day: number) {
    setItems((current) =>
      current.map((item) => (item.title === title ? { ...item, day } : item)),
    )
  }

  return (
    <div className="stack-lg">
      <PageIntro
        title="Conteúdo no ritmo certo."
        description="Planeje a semana, arraste ideias e publique sem perder o timing."
        actions={
          <>
            <button
              className="button button-outline"
              onClick={() => setIdeas(!ideas)}
            >
              <Sparkles size={16} /> Ideias com IA
            </button>
            <button className="button button-orange">
              <Plus size={16} /> Novo conteúdo
            </button>
          </>
        }
      />
      {ideas && (
        <div className="idea-strip">
          <Lightbulb size={20} />
          <div>
            <strong>3 ideias pro seu momento</strong>
            <span>
              “O que ninguém te conta sobre constância” · “Tour de creator pelo
              Centro” · “Meu setup de R$ 300”
            </span>
          </div>
          <button>Usar ideias</button>
        </div>
      )}
      <section className="card calendar-card">
        <header>
          <div className="calendar-nav">
            <button className="icon-button">
              <ChevronLeft size={18} />
            </button>
            <h3>Julho 2026</h3>
            <button className="icon-button">
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="view-switch">
            <button className="active">Mês</button>
            <button>Semana</button>
          </div>
        </header>
        <div className="calendar-grid">
          {weekdays.map((day) => (
            <div className="weekday" key={day}>
              {day}
            </div>
          ))}
          {calendarDays.map((day, index) => (
            <div
              className={`calendar-day ${day < 1 || day > 31 ? 'outside' : ''} ${day === 21 ? 'today' : ''}`}
              key={index}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) =>
                day > 0 &&
                day <= 31 &&
                moveItem(event.dataTransfer.getData('title'), day)
              }
            >
              <span>
                {day > 0 && day <= 31 ? day : day <= 0 ? 30 + day : day - 31}
              </span>
              {items
                .filter((item) => item.day === day)
                .map((item) => (
                  <button
                    draggable
                    onDragStart={(event) =>
                      event.dataTransfer.setData('title', item.title)
                    }
                    className="calendar-event"
                    style={{ borderLeftColor: item.color }}
                    key={item.title}
                  >
                    <em>{item.kind}</em>
                    {item.title}
                  </button>
                ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
