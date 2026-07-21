/** Política de Privacidade pública, necessária para App Review e LGPD. */
import { createFileRoute } from '@tanstack/react-router'
import { LegalPage } from '../components/legal-page'

export const Route = createFileRoute('/privacidade')({ component: PrivacyPage })

function PrivacyPage() {
  return (
    <LegalPage eyebrow="META LIVE MODE" title="Política de Privacidade">
      <h2>1. Quem somos</h2>
      <p>
        O Wal Chat é uma plataforma brasileira de gestão, automação e
        atendimento no Instagram para criadores e negócios. Esta política
        explica como tratamos dados pessoais em conformidade com a LGPD e com os
        termos da Plataforma Meta.
      </p>
      <h2>2. Dados que tratamos</h2>
      <p>
        Tratamos dados de cadastro da conta, identificadores do Instagram,
        mensagens, comentários, menções, métricas de conteúdo, configurações de
        automação e registros técnicos de segurança. Não vendemos dados
        pessoais.
      </p>
      <h2>3. Finalidades</h2>
      <p>
        Usamos os dados para autenticar usuários, entregar a inbox, executar
        automações solicitadas, produzir insights, sugerir respostas com IA,
        prevenir spam e cumprir obrigações legais e da Meta.
      </p>
      <h2>4. Compartilhamento</h2>
      <p>
        Dados podem ser processados por Supabase, Meta e Google Gemini somente
        na medida necessária à prestação do serviço. Tokens da Meta permanecem
        restritos ao backend.
      </p>
      <h2>5. Retenção e segurança</h2>
      <p>
        Aplicamos isolamento por workspace, Row Level Security, assinatura HMAC
        em webhooks, trilhas de auditoria e mínimo privilégio. Retemos os dados
        enquanto a conta estiver ativa ou pelo prazo necessário ao cumprimento
        de obrigações.
      </p>
      <h2>6. Seus direitos</h2>
      <p>
        Você pode solicitar acesso, correção, portabilidade ou exclusão. Use a
        página de Exclusão de Dados ou escreva para privacidade@walchat.com.br.
      </p>
    </LegalPage>
  )
}
