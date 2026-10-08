# Classificações de turma nos scripts SQL

Os tipos persistidos permitidos são **INDIVIDUAL** e **QUINTETO** em profiles.class_type,
com os valores internos **individual** e **quintet** em teacher_classes.class_type.
A capacidade operacional atual é de 1 aluno para individual e 8 alunos para quinteto.

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
