# Encerramento da restrição de campos administrativos — 10/11/2026

## Alterações aplicadas
- A migração `20261110035225_finalize_profile_column_update_least_privilege.sql` revoga `UPDATE` para `enrolled`, `enrollment_code` e `class_type` do papel `authenticated`.
- A RLS de `public.profiles` continua ativa; nenhuma linha de aluno ou mensalidade é modificada pela migração.
- O frontend atualmente publicado não envia os dois primeiros campos em alterações de perfis e altera o tipo de turma pelo RPC de professor `set_teacher_student_profile_class_type`.
- As URLs versionadas dos scripts de perfil foram atualizadas na PR #987 e o deploy GitHub Pages foi concluído antes da revogação.

## Verificações em produção

Valores esperados para `public.profiles`: 54 colunas com `UPDATE` para `authenticated`, 17 colunas bloqueadas, permissão geral de tabela revogada. `service_role` mantém permissão administrativa.

```sql
select
  count(*) filter (
    where has_column_privilege('authenticated', 'public.profiles', attname, 'UPDATE')
  ) as editable,
  count(*) filter (
    where not has_column_privilege('authenticated', 'public.profiles', attname, 'UPDATE')
  ) as protected
from pg_attribute
where attrelid = 'public.profiles'::regclass
  and attnum > 0
  and not attisdropped;
```

## Homologação funcional

Os contratos automatizados e o build do site são necessários, mas não substituem testes com sessões de aluno e professor. Verificar: cadastro, atualização de dados pessoais, data de nascimento, matrícula, atribuição de turma, arquivamento/desarquivamento e cobrança. Não editar alunos reais em testes.

**Compatibilidade:** sessões antigas com scripts em cache podem apresentar erro até recarregarem o site. Caso haja impacto real comprovado, executar apenas `docs/security/profile_legacy_update_rollback.sql` como reversão temporária e registrar o motivo.

## SEO

Foram modificadas somente referências versionadas de scripts e a lógica de autorização; nenhuma URL canônica, título, descrição, robots, sitemap ou conteúdo indexável foi alterado.
