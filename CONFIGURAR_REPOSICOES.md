# Configurar a agenda de reposições

O sistema possui um único fluxo estudantil de reposições.

1. `/area-do-estudante/minhas-aulas/` mostra aulas, créditos elegíveis, vagas de reposição e cancelamentos.
2. `reposicoes_admin.html` e `/reposicoes-admin/` permanecem como interface administrativa do professor.
3. `supabase/functions/notify-makeup-booking/index.ts` envia confirmações de agendamento e cancelamento pelo Resend.
4. `supabase_reposicoes.sql` é um instalador histórico de bootstrap. Não deve ser usado para reativar o fluxo estudantil legado em produção.

A antiga interface estudantil `/reposicoes/` foi aposentada. A rota permanece apenas como redirecionamento sem indexação para **Minhas Aulas**.

## Regra canônica de cancelamento

A mesma regra vale para aula regular e reposição:

- o aluno pode cancelar até o início da aula;
- cancelamento com pelo menos 12 horas de antecedência libera a vaga e gera ou devolve um crédito elegível;
- cancelamento com menos de 12 horas libera a vaga, mas não gera nem devolve crédito;
- após o início da aula, o cancelamento pelo aluno é bloqueado.

Essa política é aplicada no backend pelas funções canônicas de créditos. A interface não deve criar regras paralelas.

## Reservas legadas

Reservas futuras que existiam antes da aposentadoria da página antiga são importadas para o sistema de créditos como créditos já utilizados. Isso preserva o agendamento e permite que o aluno cancele em **Minhas Aulas** usando a mesma regra canônica.

As RPCs estudantis legadas ficam sem permissão de execução para `public`, `anon` e `authenticated`:

- `book_makeup_class(uuid)`;
- `cancel_my_makeup_class_booking(uuid)`;
- `get_available_makeup_slots()`;
- `get_my_makeup_bookings()`.

A função administrativa `cancel_makeup_class_booking(uuid)` não faz parte dessa retirada e continua protegida pela autorização de professor.

## Publicação de horários pelo professor

Ao publicar um horário, o professor escolhe uma turma. O sistema recupera o **Link da videoaula** dessa turma e salva uma cópia junto ao horário.

Se a turma não tiver um link `http://` ou `https://` válido, o botão de publicação fica desabilitado e o banco também rejeita a operação.

## E-mails de agendamento e cancelamento

A Edge Function `notify-makeup-booking` envia as mensagens com o remetente `Teacher Flávio <contato@teacherflavius.com>` e reutiliza os Secrets:

- `RESEND_API_KEY`;
- `ENROLLMENT_WEBHOOK_SECRET`.

O Database Webhook deve observar inserções em `public.makeup_class_email_notifications` e chamar:

`https://SEU_PROJECT_REF.supabase.co/functions/v1/notify-makeup-booking`

com o cabeçalho `x-webhook-secret` correspondente a `ENROLLMENT_WEBHOOK_SECRET`.

Os tipos de notificação são:

- `booking_confirmation`: confirmação do agendamento;
- `cancellation`: confirmação do cancelamento.
- `teacher_booking`: aviso independente ao professor quando o aluno confirma uma reposição, com link **Adicionar ao Google Agenda**.

O aviso ao professor sai de `Teacher Flávio <contato@teacherflavius.com>`.
O destinatário administrativo aprovado é `flaviofreitas@ufu.br`, definido
explicitamente na Edge Function. O texto informa o aluno, a turma,
a data, o horário de início e término e o link da aula.

## Notificações de cancelamento de aulas regulares e reposições

O cancelamento de **aula regular** cria, após a atualização confirmada do crédito, dois
registros independentes em `public.regular_lesson_cancellation_email_notifications`,
um para o aluno e outro para `flaviofreitas@ufu.br`. A Edge Function
`notify-regular-lesson-cancellation` envia cada e-mail pelo remetente
`Teacher Flávio <contato@teacherflavius.com>` e utiliza o e-mail verificado
no Supabase Auth para localizar o aluno. A fila usa RLS, acesso de serviço
e chave de deduplicação por crédito, momento do cancelamento e destinatário.

O aviso informa turma, data, horário e o resultado do crédito. A política de
cancelamento (até o início; concessão de crédito apenas com antecedência mínima
de 12 horas) permanece definida exclusivamente nas funções canônicas do banco.

O **cancelamento de reposição** continua gerando o aviso estudantil `cancellation`.
Um gatilho adicional insere `teacher_cancellation`, enviado separadamente ao professor
pela função existente `notify-makeup-booking`. O e-mail orienta a remover manualmente
o evento do calendário quando tiver sido salvo. Não há exclusão automática de eventos.

As Edge Functions utilizam `RESEND_API_KEY` e `ENROLLMENT_WEBHOOK_SECRET`.
O dispatcher SQL utiliza o segredo já guardado no Vault sob
`teacherflavius_notification_webhook_secret`. Não execute novamente instaladores
históricos ou faça testes de envio com cadastros reais. O status `sent` representa
aceite do provedor, não necessariamente entrega ao destinatário.

O link do Google Agenda prepara um evento com fuso `America/Sao_Paulo`.
O aluno e o professor recebem botões independentes para adicionar a reposição.
Ambos precisam revisar e salvar o compromisso. O e-mail do aluno informa
que cancelamentos podem ocorrer até o início da aula, mas que o crédito
só é devolvido com antecedência mínima de 12 horas. Ao cancelar uma
reposição, o aluno é orientado a remover qualquer evento salvo manualmente.
Não há integração
OAuth com o Google Agenda e alterações/cancelamentos posteriores de
reposições **não atualizam automaticamente** o evento salvo.

O banco enfileira a notificação ao professor apenas ao inserir uma
confirmação de reserva; uma restrição única impede duplicação por
`(booking_id, notification_type)`. Não envia avisos retroativos sobre
reservas anteriores à implementação.

## Teste do fluxo atual

1. Na área do professor, abra **AGENDA DE REPOSIÇÕES** e publique um horário futuro válido.
2. Use um aluno que possua crédito elegível e abra **MINHAS AULAS**.
3. Marque uma reposição e confirme que ela aparece entre as próximas aulas.
4. Cancele uma reposição com pelo menos 12 horas de antecedência e confirme a devolução do crédito.
5. Teste uma reposição dentro da janela de 12 horas e confirme que o cancelamento continua disponível, mas sem devolução de crédito.
6. Confirme que a vaga é liberada e que o e-mail de cancelamento é enfileirado.
7. Confirme que o aviso ao professor contém o nome do aluno, data e horário, e que o link do Google Agenda prepara o evento sem salvá-lo automaticamente.
8. Confirme que `/reposicoes/` redireciona para `/area-do-estudante/minhas-aulas/`.

Para diagnosticar o envio:

```sql
select
  notification.notification_type,
  notification.status,
  notification.attempts,
  notification.last_error,
  notification.created_at,
  booking.student_name,
  booking.student_email,
  booking.class_name,
  booking.status as booking_status
from public.makeup_class_email_notifications notification
join public.makeup_class_bookings booking
  on booking.id = notification.booking_id
order by notification.created_at desc
limit 20;
```
