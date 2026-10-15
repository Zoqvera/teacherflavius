# Configurar o e-mail de nova matrícula

O código desta funcionalidade possui três partes:

1. `supabase_notificacoes_matricula.sql` registra cada nova matrícula em uma fila sem duplicar alunos.
2. `supabase/functions/notify-new-enrollment/index.ts` envia o e-mail pelo Resend.
3. Um Database Webhook do Supabase chama a função quando uma notificação entra na fila.

O aviso administrativo inclui nome, WhatsApp, quantidade de aulas, valor mensal e data da matrícula. O aluno recebe separadamente uma confirmação no endereço verificado por Supabase Auth, com quantidade de aulas, mensalidade e data da matrícula. CPF, código de matrícula e chave Pix não são enviados nesses e-mails.

## 1. Preparar o Resend

1. Crie uma conta em <https://resend.com>.
2. Em **Domains**, adicione e verifique o domínio usado pelo site.
3. Crie uma API Key.
4. O remetente de matrícula é `Matrículas <matriculas@teacherflavius.com>` e fica definido na Edge Function.

Não coloque a API Key no `auth.js`, no `supabase_config.js` nem em outro arquivo público do site.

## 2. Estado de instalação

O fluxo de notificações e os Database Webhooks já estão instalados no projeto de produção. **Não execute novamente o instalador SQL apenas para concluir a PR #642.** Os passos seguintes são referência para recuperação controlada ou instalação em outro projeto, não uma instrução de reaplicação em produção.

## 3. Executar o SQL (somente em instalação nova ou recuperação aprovada)

Depois que esta alteração estiver na branch principal:

1. Abra o painel do Supabase.
2. Entre em **SQL Editor**.
3. Copie todo o conteúdo de `supabase_notificacoes_matricula.sql`.
4. Clique em **Run**.

Esse arquivo deve ser executado depois de `supabase_mensalidades.sql`, pois usa `profiles`, `teacher_admins` e `is_teacher_admin()`.

O script não envia mensagens para alunos antigos. Somente matrículas concluídas depois da instalação geram notificações.

## 4. Configurar os Secrets

No terminal, dentro do repositório, vincule o projeto e salve os segredos:

```bash
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase secrets set RESEND_API_KEY=re_sua_chave
npx supabase secrets set ENROLLMENT_WEBHOOK_SECRET=UM_SEGREDO_LONGO_E_ALEATORIO
```

A notificação administrativa de matrícula é encaminhada para `flaviofreitas@ufu.br`, endereço aprovado e definido diretamente na Edge Function. O Secret legado `ENROLLMENT_NOTIFICATION_EMAIL` pode continuar existindo para outras funções, mas não determina mais o destinatário da matrícula.

Use o mesmo valor de `ENROLLMENT_WEBHOOK_SECRET` no cabeçalho do webhook criado no passo 6.

## 5. Publicar a Edge Function

```bash
npx supabase functions deploy notify-new-enrollment --no-verify-jwt
```

A função desativa a validação JWT porque é chamada pelo banco, mas exige o cabeçalho privado `x-webhook-secret` e compara esse valor com o Secret salvo no Supabase.

## 6. Criar o Database Webhook

No painel do Supabase:

1. Abra **Database > Webhooks** e escolha **Create a new hook**.
2. Nome: `notify-new-enrollment`.
3. Tabela: `public.enrollment_email_notifications`.
4. Evento: marque somente **Insert**.
5. Método HTTP: `POST`.
6. URL: `https://SEU_PROJECT_REF.supabase.co/functions/v1/notify-new-enrollment`.
7. Adicione o cabeçalho `x-webhook-secret` com o mesmo valor salvo em `ENROLLMENT_WEBHOOK_SECRET`.
8. Adicione o cabeçalho `Content-Type` com o valor `application/json`.
9. Salve o webhook.

## 7. Testar

1. Faça uma nova matrícula de teste no site.
2. Confira a caixa de entrada do aluno e também a caixa de entrada administrativa `flaviofreitas@ufu.br`.
3. Em **Edge Functions > notify-new-enrollment > Logs**, confirme que a chamada terminou com sucesso.
4. No **Table Editor**, consulte `enrollment_email_notifications`; o registro deve aparecer com `status = sent`.

Se o provedor rejeitar algum envio, o status será `failed` e `last_error` registrará um código técnico. Cada destinatário usa chave de idempotência própria: o e-mail administrativo preserva a chave histórica `enrollment-{id}` e a confirmação ao aluno utiliza `enrollment-student-{id}`. A fila é marcada como `sent` somente quando os dois envios são aceitos pelo provedor. Essa confirmação não garante entrega na caixa de entrada.
