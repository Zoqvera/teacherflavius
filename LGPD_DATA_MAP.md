# Mapa de dados pessoais — Teacher Flávio

Versão: 2026-09-12 · revisão externa 2

Este documento é o inventário operacional de dados pessoais do teacherflavius.com. Ele deve ser atualizado quando houver nova tabela, finalidade, formulário, fornecedor, integração, evento analítico ou mudança relevante de retenção.

## Princípios adotados

- coletar somente dados necessários para finalidades definidas;
- separar dados necessários à prestação do serviço de dados opcionais de Analytics;
- aplicar RLS, menor privilégio e funções de servidor para operações privilegiadas;
- não enviar CPF, WhatsApp, e-mail, chave PIX ou conteúdo de formulário para Analytics;
- não duplicar dados cadastrais em e-mails administrativos quando eles já estiverem disponíveis no portal;
- manter PII operacional fora do código-fonte e do histórico Git sempre que possível;
- eliminar ou anonimizar dados quando a finalidade terminar, ressalvadas hipóteses legais de conservação;
- automatizar apenas expurgos com finalidade operacional clara e prazo definido;
- manter dados financeiros, solicitações LGPD e registros acadêmicos/cadastrais fora de deleções automáticas por idade arbitrária;
- distinguir retenção **local** da retenção **no fornecedor externo**: apagar uma linha no Postgres não significa que um terceiro tenha apagado seus próprios registros.

## Inventário principal

| Categoria | Exemplos | Local/fornecedor | Finalidade | Retenção / controle |
| --- | --- | --- | --- | --- |
| Conta e identidade | nome, e-mail, ID, metadados de autenticação | Supabase Auth / `profiles` | login e identificação | ciclo da conta; Auth/perfil são eliminados no encerramento concluído |
| Matrícula | CPF, WhatsApp, código de matrícula | Supabase | matrícula e contato | ciclo da relação; removidos no encerramento quando não houver fundamento de conservação |
| Reembolso | chave PIX | Supabase | eventual devolução de valores | enquanto houver necessidade operacional/financeira |
| Disponibilidade | dias e horários | Supabase | organização de turmas | removida com o perfil |
| Acadêmicos | turma, frequência, exercícios, progresso, reposições, flashcards | Supabase | prestação e acompanhamento do serviço | ciclo da relação/conta, sem expurgo fixo por idade nesta fase |
| Pronúncia | áudio, texto de referência, notas e resultado | Azure Speech + Supabase | avaliação de pronúncia | Azure processa em tempo real; cópia local segue ciclo acadêmico/conta |
| Financeiros | mensalidades, valores, status e IDs de pagamento | Supabase + Mercado Pago | cobrança e conciliação | retenção seletiva conforme obrigação legal/regulatória/contábil e exercício de direitos |
| Cartão | token e dados necessários ao checkout | Mercado Pago | processar pagamento | PAN completo/CVV não são armazenados no banco acadêmico |
| Acessos | user_id, data/hora, caminho, timezone | `student_access_logs` | operação, segurança e acompanhamento | 90 dias, expurgo diário |
| Erros | mensagem técnica, caminho, fingerprint e metadados reduzidos | `app_error_events` | diagnóstico | 90 dias, expurgo diário |
| CSP | diretiva, recurso bloqueado, origem e referrer | `csp_violation_reports` | segurança | 30 dias, expurgo diário |
| Sincronização | exercício, status, e-mail normalizado e erro | Google Forms + `exercise_sync_events` | importar conclusões e diagnosticar integração | cópia local 90 dias; fonte Google exige revisão própria |
| E-mail transacional | destinatário e conteúdo necessário | Resend | confirmações e notificações | minimizar conteúdo; retenção do fornecedor exige revisão externa |
| Analytics | página, origem, eventos e atributos técnicos | Google Analytics | mensuração/CRO | somente após consentimento; retenção configurada no GA deve ser verificada externamente |
| Consentimento | versão, categorias, datas | `localStorage` | respeitar preferência do dispositivo | 180 dias na versão atual; revogável antes |
| Solicitações LGPD | tipo, detalhes, status, datas e resposta | `data_subject_requests` | atendimento ao titular | registro mínimo pseudonimizado; sem prazo automático nesta fase |
| Snapshots legados | cópias de maio/2026 | tabelas `backup_*_20260501` | recuperação histórica | revisão manual prevista; exclusões novas removem também a UUID dos snapshots |

## Retenção automatizada local

A tabela `data_retention_policies` é a fonte operacional dos prazos locais. O job `daily-data-retention-maintenance` roda via `pg_cron` todos os dias às **05:35 UTC (02:35 no horário de Brasília)**.

| Conjunto | Prazo | Corte |
| --- | ---: | --- |
| `student_access_logs` | 90 dias | `accessed_at` |
| `app_error_events` | 90 dias | `created_at` |
| `csp_violation_reports` | 30 dias | `created_at` |
| `exercise_sync_events` | 90 dias | `received_at` |

Cada execução registra origem, início, conclusão, status e quantidade removida em `data_retention_runs`. O histórico técnico da própria manutenção é limitado a 365 dias e uma advisory lock impede execuções concorrentes.

Ficam deliberadamente fora do expurgo automático: solicitações LGPD, finanças, dados acadêmicos/cadastrais e snapshots legados.

## Governança de fornecedores externos

As tabelas `external_data_processors` e `external_data_processor_reviews` mantêm o registro operacional dos fornecedores que podem tratar dados fora do Postgres. O painel **Área do Professor → Retenção de dados** mostra o estado e permite registrar evidência de revisão.

Os estados significam:

- **verified**: documentação/configuração foi efetivamente conferida;
- **pending**: ainda depende de conferência em painel, conta ou documentação do fornecedor;
- **action_required**: foi encontrada uma correção concreta ainda não encerrada.

Esse status é um controle operacional; não equivale a uma certificação jurídica de conformidade.

### Estado em 12/09/2026

| Fornecedor | Dados/escopo | Retenção do fornecedor | Controle atual | Estado |
| --- | --- | --- | --- | --- |
| Google Analytics | navegação, eventos e atributos técnicos | GA4 possui controles de retenção; para propriedade padrão há opções como 2 ou 14 meses | só carrega após consentimento; publicidade negada; alvo operacional é conferir 2 meses e reset por nova atividade desligado | pendente |
| Supabase | Auth, DB, Storage, Edge Functions e logs | logs de plataforma dependem do plano; DB/Storage dependem do ciclo definido pelo controlador | expurgos próprios no Postgres; reduzir PII em logs das Edge Functions | pendente |
| Resend | endereço e conteúdo de e-mail | política pública não fornece um prazo único para todo conteúdo enviado | matrícula administrativa não duplica mais dados cadastrais; respostas de erro do provedor não são gravadas no console | pendente |
| Mercado Pago | dados necessários ao pagamento | conforme necessidade operacional e obrigações aplicáveis | tokenização; sem PAN/CVV local; resposta persistida reduzida a IDs/status/valor/método/datas | verificado tecnicamente |
| Google Forms / Sheets | e-mail, exercício e data de conclusão | respostas permanecem na conta Google até limpeza/configuração do proprietário | cópia diagnóstica local expira em 90 dias; aliases são consultados no banco, não no código | pendente |
| Azure Speech | áudio de pronúncia e texto de referência | documentação oficial informa ausência de retenção do conteúdo enviado no Pronunciation Assessment em tempo real | qualquer cópia que permanece depois da resposta é mantida pelo próprio portal no Supabase | verificado tecnicamente |
| GitHub Pages | requisições e logs técnicos de entrega | depende dos controles e políticas do GitHub | frontend público hospedado aqui; não publicar PII, segredos ou artefatos operacionais no conteúdo estático | pendente |
| GitHub | código e histórico de commits | versões antigas permanecem no histórico Git até tratamento específico | PII foi removido do código corrente; revisar histórico antigo antes de qualquer reescrita destrutiva | ação necessária |

## Minimizações aplicadas nesta revisão

### Resend

A notificação administrativa de nova matrícula deixou de incluir nome, e-mail e WhatsApp do aluno. Ela informa apenas que uma matrícula foi concluída e orienta o professor a consultar os dados na área autenticada.

O remetente genérico `resend-email` não registra mais o corpo de erro devolvido pelo provedor; apenas o código HTTP é registrado. O frontend recebe somente `ok` e, quando disponível, o identificador técnico do envio.

E-mails destinados ao próprio aluno, como confirmação de reposição, continuam necessariamente usando seu endereço e podem conter o mínimo de dados necessários à mensagem transacional.

### Mercado Pago → Resend

O alerta administrativo usado quando o Mercado Pago bloqueia a criação de um pagamento não inclui mais e-mail do aluno, UUID da mensalidade ou UUID da tentativa. O alerta contém somente HTTP/código técnico e orienta o professor a consultar o Controle de Mensalidades no portal.

### Google Forms / GitHub

Aliases de e-mail usadas pela sincronização de exercícios deixaram de ser constantes no código. A Edge Function consulta `student_google_email_aliases`, protegida no banco. Isso impede novas versões do código de continuarem copiando esses endereços para o GitHub.

A remoção do código atual **não elimina automaticamente versões antigas do histórico Git**. Por isso, GitHub permanece como `action_required` até decisão controlada sobre histórico, branches, forks/clones e eventual procedimento de remoção de dado sensível.

### Azure Speech

A Edge Function `pronunciation-assess` envia áudio e texto de referência ao Azure Speech para avaliação em tempo real. Segundo a documentação oficial da Microsoft para esse fluxo, o serviço não mantém o conteúdo enviado após a requisição. O portal, porém, salva áudio e resultado no Supabase; essa retenção local é uma decisão do Teacher Flávio e continua sujeita ao ciclo de vida acadêmico/da conta.

### Hospedagem estática

O frontend público é entregue por GitHub Pages. O build não publica arquivos operacionais, migrations, scripts, documentação interna ou segredos. As permissões CORS das Edge Functions não aceitam mais origens do provedor de hospedagem anterior.

## Central de direitos do titular

Em **Perfil → Privacidade e meus dados**, o titular pode:

1. baixar uma cópia automática dos principais dados vinculados à sessão autenticada;
2. corrigir diretamente nome, CPF, WhatsApp, chave PIX e disponibilidade;
3. solicitar acesso adicional;
4. solicitar correção formal de dados não editáveis;
5. solicitar anonimização/bloqueio;
6. pedir informações sobre compartilhamentos;
7. solicitar encerramento da conta.

A exportação usa exclusivamente `auth.uid()` e não recebe um `user_id` informado pelo navegador. Não inclui segredos operacionais, `idempotency_key`, identificadores administrativos desnecessários nem o payload bruto do Azure.

## Ciclo de encerramento da conta

1. O aluno solicita encerramento no perfil.
2. Enquanto `open`, pode cancelar.
3. O professor analisa na fila administrativa.
4. A rotina identifica também contas Google/legadas vinculadas.
5. Dados operacionais, acadêmicos, privados, aliases e logs vinculados são eliminados quando não houver necessidade de conservação.
6. `auth.users` e `profiles` são removidos.
7. Registros financeiros necessários ficam desligados do perfil (`student_id = NULL`) e conservam apenas `subject_ref` pseudônimo.
8. Notas livres de pagamento são removidas.
9. Nome/e-mail temporários são apagados do registro da solicitação concluída.
10. A UUID também é removida dos snapshots legados de maio/2026.
11. Objetos ainda pertencentes ao usuário no Storage bloqueiam a conclusão até remoção/transferência.

## Terceiros, transferências e revisão

Fornecedores/runtime atualmente mapeados: Supabase, Mercado Pago, Resend, Google Analytics, Google Forms/Sheets, Microsoft Azure Speech e GitHub Pages. GitHub também é tratado como repositório de código e deve permanecer livre de PII operacional. WhatsApp/Meta participa quando o próprio usuário decide iniciar contato pelo canal disponibilizado.

Antes de adicionar novo terceiro, revisar:

1. finalidade e categorias de dados;
2. necessidade e minimização;
3. termos/DPA e localização do tratamento;
4. retenção e mecanismos de exclusão/exportação;
5. segurança e resposta a incidentes;
6. como exercer direitos do titular em dados que já saíram do banco local.

## Revisões periódicas prioritárias

- confirmar no Google Analytics o prazo efetivo de retenção e a opção de reset por nova atividade;
- confirmar o plano Supabase e os prazos reais de API/DB/Auth/Edge logs;
- revisar no Resend histórico, exportação e mecanismos disponíveis de exclusão/limpeza;
- definir rotina de limpeza de respostas/planilhas do Google Forms depois que não forem mais necessárias;
- revisar controles de privacidade e logs do GitHub Pages;
- decidir, em procedimento separado, como tratar PII presente no histórico antigo do GitHub sem reescrever o repositório de forma precipitada;
- revisar snapshots legados em 28/10/2026;
- revisar semestralmente `data_retention_policies`, fornecedores externos e estado do cron;
- manter migrations como fonte de verdade das rotinas de privacidade e retenção.
