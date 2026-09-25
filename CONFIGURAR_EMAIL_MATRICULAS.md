# Configurar o e-mail de nova matrícula

O código desta funcionalidade possui três partes:

1. `supabase_notificacoes_matricula.sql` registra cada nova matrícula em uma fila sem duplicar alunos.
2. `supabase/functions/notify-new-enrollment/index.ts` envia o e-mail pelo Resend.
3. Um Database Webhook do Supabase chama a função quando uma notificação entra na fila.

O e-mail inclui nome, WhatsApp e data da matrícula. CPF, e-mail, código de matrícula e chave Pix não são enviados.

## 1. Preparar o Resend

1. Crie uma conta em <https://resend.com>.
2. Em **Domains**, adicione e verifique o domínio usado pelo site.
3. Crie uma API Key.
4. Escolha o remetente. Exemplo: `Matrículas <matriculas@teacherflavius.com>`.

Não coloque a API Key no `auth.js`, no `supabase_config.js` nem em outro arquivo público do site.

## 2. Executar o SQL

Depois que esta alteração estiver na branch principal:

1. Abra o painel do Supabase.
2. Entre em **SQL Editor**.
3. Copie todo o conteúdo de `supabase_notificacoes_matricula.sql`.
4. Clique em **Run**.

Esse arquivo deve ser executado depois de `supabase_mensalidades.sql`, pois usa `profiles`, `teacher_admins` e `is_teacher_admin()`.

O script não envia mensagens para alunos antigos. Somente matrículas concluídas depois da instalação geram notificações.

## 3. Configurar os Secrets

No terminal, dentro do repositório, vincule o projeto e salve os segredos:

```bash
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase secrets set RESEND_API_KEY=re_sua_chave
npx supabase secrets set ENROLLMENT_NOTIFICATION_EMAIL=seu-email@exemplo.com
npx supabase secrets set 'ENROLLMENT_FROM_EMAIL=Matrículas <matriculas@teacherflavius.com>'
npx supabase secrets set ENROLLMENT_WEBHOOK_SECRET=UM_SEGREDO_LONGO_E_ALEATORIO
```

Use o mesmo valor de `ENROLLMENT_WEBHOOK_SECRET` no cabeçalho do webhook criado no passo 5.

## 4. Publicar a Edge Function

```bash
npx supabase functions deploy notify-new-enrollment --no-verify-jwt
```

A função desativa a validação JWT porque é chamada pelo banco, mas exige o cabeçalho privado `x-webhook-secret` e compara esse valor com o Secret salvo no Supabase.

## 5. Criar o Database Webhook

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

## 6. Testar

1. Faça uma nova matrícula de teste no site.
2. Confira a caixa de entrada do e-mail configurado em `ENROLLMENT_NOTIFICATION_EMAIL`.
3. Em **Edge Functions > notify-new-enrollment > Logs**, confirme que a chamada terminou com sucesso.
4. No **Table Editor**, consulte `enrollment_email_notifications`; o registro deve aparecer com `status = sent`.

Se o provedor rejeitar o envio, o status será `failed` e `last_error` mostrará a causa. O envio usa uma chave de idempotência para reduzir o risco de e-mails duplicados.
