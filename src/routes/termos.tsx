/** Termos de Uso públicos com responsabilidades sobre Meta e automação. */
import { createFileRoute } from '@tanstack/react-router'
import { LegalPage } from '../components/legal-page'
import { seoHead } from '../lib/seo'

export const Route = createFileRoute('/termos')({
  head: () =>
    seoHead({
      title: 'Termos de Uso',
      description:
        'Regras de uso responsável do Wal Chat, integrações Meta, IA, automações e encerramento de conta.',
      path: '/termos',
    }),
  component: TermsPage,
})

function TermsPage() {
  return (
    <LegalPage eyebrow="USO RESPONSÁVEL" title="Termos de Uso">
      <h2>1. Aceite</h2>
      <p>
        Ao usar o Wal Chat, você concorda com estes Termos e declara ter
        autorização para administrar as contas do Instagram conectadas.
      </p>
      <h2>2. Uso permitido</h2>
      <p>
        A plataforma deve ser usada de forma legítima, respeitando a LGPD, os
        termos da Meta e as preferências dos contatos. É proibido enviar spam,
        conteúdo ilícito, enganoso ou discriminatório.
      </p>
      <h2>3. Automação e janela de mensagens</h2>
      <p>
        O Wal Chat aplica a janela padrão de 24 horas, cooldowns, opt-out e
        limites de resposta privada. O usuário é responsável pelo conteúdo
        criado e pelas tags oficiais utilizadas.
      </p>
      <h2>4. Inteligência artificial</h2>
      <p>
        Respostas e conteúdos gerados por IA são sugestões e podem conter erros.
        Mantenha revisão humana, sobretudo em temas sensíveis, promessas
        comerciais e atendimento autônomo.
      </p>
      <h2>5. Disponibilidade</h2>
      <p>
        Podemos atualizar integrações para acompanhar mudanças da Meta. Recursos
        dependentes de terceiros podem ficar temporariamente indisponíveis.
      </p>
      <h2>6. Encerramento</h2>
      <p>
        Você pode encerrar sua conta e solicitar a exclusão dos dados a qualquer
        momento. Violações destes Termos podem resultar em suspensão para
        proteger usuários e a plataforma.
      </p>
    </LegalPage>
  )
}
