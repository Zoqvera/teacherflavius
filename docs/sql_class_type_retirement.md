# Classificações de turma nos scripts SQL

Os tipos de plano do aluno continuam **INDIVIDUAL** e **QUINTETO** em profiles.class_type.
Os tipos de turma teacher_classes.class_type agora são **individual**, **quintet** e **experimental**.
As pessoas agendadas em turmas EXPERIMENTAL continuam registradas exclusivamente em private.trial_lesson_appointments e não recebem matrícula regular.
A capacidade operacional é de 1 aluno para individual e 8 para quinteto. Em EXPERIMENTAL, é configurável: padrão 8, com AE5 configurada em 10 para preservar reservas existentes.

## Scripts manuais desativados

Os quatro scripts SQL manuais antigos da raiz foram substituídos por comandos de
falha explícita. Nenhum deve ser executado no SQL Editor. Seus conteúdos anteriores
permanecem disponíveis no histórico de commits do Git.

Não reaplique scripts manuais para alterar regras de matrículas, capacidade ou
classificação. Faça a alteração por uma nova migração Supabase revisada, alinhada à
taxonomia atual e às funções em uso. A migração de consolidação é
supabase/migrations/20261007012501_enforce_quintet_only_group_classification.sql.

## Validação automatizada

O workflow SQL class taxonomy guard verifica todos os arquivos .sql versionados e
novos não ignorados. Qualquer ocorrência dos quatro identificadores antigos, mesmo
em comentários, causa falha. Migrações e overlays históricos que já usavam esses
identificadores são exceções com SHA Git fixo no arquivo
.github/legacy-sql-class-type-lock.json. Seu conteúdo não pode mudar sem falhar no CI.

Execute localmente:

    node scripts/check_sql_class_taxonomy.js
    node --test tests/sql_class_taxonomy.test.js

Não reescreva migrações históricas: registre qualquer alteração futura em nova migração.
