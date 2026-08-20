/** Política de Privacidade pública, necessária para App Review e LGPD. */
import { createFileRoute } from '@tanstack/react-router'
import { LegalPage } from '../components/legal-page'
import { seoHead } from '../lib/seo'
import { siteConfig } from '../lib/site-config'

export const Route = createFileRoute('/privacidade')({
  head: () =>
    seoHead({
      title: 'Política de Privacidade',
      description:
        'Como o Wal Chat trata dados pessoais, integrações, IA, cookies e direitos previstos na LGPD.',
      path: '/privacidade',
    }),
  component: PrivacyPage,
})

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
        Dados podem ser processados por Supabase, Meta, Google e OpenAI somente
        na medida necessária à prestação do serviço e conforme a configuração
        escolhida pelo controlador. Tokens de integração permanecem restritos ao
        backend e são armazenados com criptografia quando persistidos.
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
        página de Exclusão de Dados ou escreva para {siteConfig.supportEmail}.
      </p>
      <h2>7. Cookies e Google Analytics</h2>
      <p>
        Cookies estritamente necessários mantêm autenticação e segurança. O
        Google Analytics só é carregado após consentimento explícito; se você
        recusar, nenhuma tag de medição é carregada. Não habilitamos publicidade
        personalizada nesse fluxo.
      </p>
      <h2>8. Decisões automatizadas e IA</h2>
      <p>
        Agentes podem sugerir ou, quando expressamente habilitados, preparar
        respostas automáticas. O Wal Chat aplica regras de elegibilidade e
        permite desligar a IA por contato. Solicitações sobre revisão humana
        podem ser enviadas ao canal de privacidade.
      </p>
      <h2>9. Contato do encarregado</h2>
      <p>
        Dúvidas, incidentes e pedidos LGPD: {siteConfig.supportEmail}. A equipe
        confirma o recebimento e orienta a verificação de identidade antes de
        divulgar, portar ou excluir dados.
      </p>
    </LegalPage>
  )
}
