# Restrição de colunas de perfis — 10/11/2026

## Situação

A migração `20261110033859` foi aplicada ao projeto de produção Supabase após a inclusão da RPC administrativa `set_teacher_student_profile_class_type` pela migração `20261110033349`.

- Antes: o papel `authenticated` podia atualizar as 71 colunas da tabela `public.profiles`.
- Depois: são permitidas atualizações de 57 colunas e proibidas diretamente as atualizações de 14 campos administrativos.
- A RLS existente e os gatilhos de proteção permanecem ativos.
- `service_role` preserva suas permissões para rotinas confiáveis.

## Compatibilidade

`enrolled`, `enrollment_code` e `class_type` permanecem temporariamente na lista de atualização para não interromper navegadores com JavaScript em cache. Os respectivos controles por trigger continuam protegendo alterações feitas por alunos. Novos clientes não devem enviar `enrolled` ou `enrollment_code` nos payloads de `profiles`; alterações do professor em `class_type` agora usam RPC autorizada.

## Verificação pós-migração

Consulta somente leitura:

```sql
select
  count(*) filter (where has_column_privilege('authenticated', 'public.profiles', attname, 'UPDATE')) as editable,
  count(*) filter (where not has_column_privilege('authenticated', 'public.profiles', attname, 'UPDATE')) as protected
from pg_attribute
where attrelid = 'public.profiles'::regclass
  and attnum > 0
  and not attisdropped;
```

Resultado esperado: `editable = 57`, `protected = 14`.

## Homologação funcional

Validar o cadastro e a edição de perfil de um aluno, edição de data de nascimento, matrícula, classificação de turma pelo professor, arquivamento/desarquivamento e atualização de cobrança. Não alterar registros de alunos reais para executar os testes; preferir contas descartáveis.

## Reversão

Somente em caso de falha operacional confirmada, executar `docs/security/profile_column_update_rollback.sql`. A reversão restaura permissões anteriores sem desativar a RLS. Registrar o motivo antes de executar.

## Próxima etapa

Após atualizar e invalidar adequadamente as versões de JavaScript distribuídas, remover as três permissões de compatibilidade, migrando quaisquer dependências residuais para RPCs autorizadas.
