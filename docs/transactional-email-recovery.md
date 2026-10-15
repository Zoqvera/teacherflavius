# Auditoria e recuperação de e-mails transacionais

## Escopo

A rotina cobre as filas existentes de matrícula, reposições e cancelamentos
de aulas regulares. **Não modifica matrículas, créditos, mensalidades ou
cadastros.** Nenhuma mensagem é enviada ao implantar o código; os envios
continuam associados aos registros de notificações já criados pelas
operações legítimas dos alunos.

A tarefa `transactional-email-retry-10m` roda a cada 10 minutos pelo
`pg_cron`. Somente registros `pending` ou `failed` são elegíveis quando
cumprem todas as condições:

- Pelo menos 5 minutos desde a criação.
- Até 18 horas após a criação, com no máximo 2 tentativas anteriores.
- Pelo menos 10 minutos desde a última tentativa.
- Até 15 registros por tipo de mensagem em cada execução (45 no total).

O novo disparo utiliza `pg_net`, recupera o segredo do Vault e chama a
mesma Edge Function protegida pelo cabeçalho `x-webhook-secret`. O
destinatário continua sendo resolvido pela função original, jamais pelo SQL
do agendador.

As três Edge Functions passaram a reservar cada tentativa com uma
atualização condicional de estado e contagem anterior (`status`,
`attempts`). Se outro processo já reservou a notificação, o segundo
termina sem disparar a mensagem. As chaves de idempotência existentes
continuam estáveis, inclusive nas tentativas de recuperação.

## Por que limitar a 18 horas?

O Resend conserva chaves de idempotência por **24 horas**. Após esse
período, o mesmo envio poderia ser aceito novamente caso o servidor
não tivesse registrado que a primeira tentativa foi concluída.
Utilizamos 18 horas como margem operacional e não reenviamos
automaticamente registros mais antigos. Os arquivos `.ics` anexados
às confirmações reutilizam `notification.created_at` como `DTSTAMP`,
evitando payloads diferentes entre tentativas.

Fonte técnica: https://resend.com/changelog/idempotency-keys

## Auditoria sem dados pessoais

Execute apenas a consulta de leitura:

`scripts/sql/transactional_email_audit_readonly.sql`

As colunas mostram totais, aceites do provedor, pendências, falhas,
tentativas esgotadas, registros fora da janela e elegíveis ao reenvio.
Não existe exportação de destinatários, nomes ou segredos.

Consulta operacional restrita à administração:
```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'transactional-email-retry-10m';
```

Os logs de execução podem ser inspecionados em `cron.job_run_details`,
e os envios `pg_net` em logs técnicos. Não adicione os segredos às
consultas de auditoria.

## O que fazer diante de falhas persistentes

Se houver `attempts_exhausted > 0` ou
`outside_safe_retry_window > 0`:

1. Verifique a saúde do Resend, a autenticação e os logs das Edge Functions.
2. Reconcilie o ID da mensagem com o Resend **antes de qualquer reenvio**,
   pois `status != sent` não prova que o provedor não a tenha aceitado.
3. Corrija a causa, não altere `attempts` ou `status` diretamente para
   contornar a janela de idempotência.
4. Caso o envio seja comprovadamente inexistente, realize uma
   notificação administrativa controlada, com nova chave e registro de
   auditoria, em procedimento separado.

`sent` significa aceito pelo provedor; não equivale a entregue ou lido.
Uma extensão futura poderá processar os eventos de entrega e rejeição
do provedor, com verificação de assinatura.

## Implantação e segurança

A ordem segura é publicar as **três Edge Functions** atualizadas e
somente depois instalar a migração versionada que agenda o reenvio.
Execute os testes de CI antes de aplicar a migração. A consulta de
auditoria é somente leitura.

A divergência histórica de versões descrita na issue #667 foi reconciliada
na PR #670 por identidade exata de nome e SHA256, sem renomear o SQL
original ou alterar o ledger de produção. Não renomeie nem edite
migrações antigas, não execute reparos diretos no ledger e não
desative as proteções do GitHub para contornar a divergência.

**SEO:** nenhuma alteração de páginas públicas ou indexáveis.
