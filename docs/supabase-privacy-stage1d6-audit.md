# ETAPA 1D.6 — auditoria das funções privilegiadas de privacidade

Data: **17 de outubro de 2026**. Fontes: consulta de metadados do
catálogo PostgreSQL em produção (somente leitura) e execução protegida
[Supabase canonical object inventory #39032446907](https://github.com/Zoqvera/teacherflavius/actions/runs/39032446907)
após a PR #797, com artefato `12101255745`.

O [snapshot da etapa](supabase-privacy-stage1d6-snapshot.json)
registra exclusivamente indicadores agregados. Não contém registros de
alunos, SQL de funções, valores de configurações de banco ou credenciais.

## 1. Diferenças estruturais após a recuperação do catálogo LGPD

| Indicador | Reconstrução / produção ou diferença |
| --- | ---: |
| Objetos catalogados | 1.831 / 2.911 |
| Objetos faltantes no bootstrap | 1.081 |
| Objetos extras no bootstrap | 1 |
| Definições diferentes entre IDs compartilhados | 177 |
| Políticas RLS | 99 / 109 |
| Políticas ainda ausentes | 10 |
| Políticas faltantes em tabelas já restauradas | **0** |
| Relações ausentes responsáveis pelas 10 políticas | **8** |
| Diferenças de papéis/comandos em políticas comuns | **0** |
| Diferenças de predicados | 4 |

As quatro políticas LGPD recuperadas pela PR #797 continuam presentes na
reconstrução. As outras dez dependem de tabelas de aquisição, estados
acadêmicos, preparação dos alunos e conteúdo gerenciável; não dependem
das três tabelas LGPD recuperadas.

## 2. Resultado da auditoria das funções de privacidade

Foram avaliadas **24 funções `SECURITY DEFINER`** em `public` relacionadas
a solicitações LGPD, retenção, encerramento de contas e fiscalização
de tratamento de dados. A consulta verificou exclusivamente metadados
de permissões por papel e presença de configuração explícita de
`search_path`, além de marcadores booleanos do código.

| Controle | Resultado |
| --- | ---: |
| Funções com `EXECUTE` para `anon` | **0** |
| Funções com `EXECUTE` para `authenticated` | 14 |
| Funções restritas ao `service_role` | 10 |
| Funções sem `search_path` configurado | 0 |
| Definições com referência literal a `aal2` | 0 |
| Definições que mencionam `is_teacher_admin_mfa` | 11 |

**Limitação essencial:** as 14 funções acessíveis a `authenticated`
não estão, por isso, liberadas a qualquer aluno. Elas podem implementar
autorização adicional internamente, que deve ser verificada com testes
de identidade e casos negativos. Por outro lado, o `GRANT EXECUTE`
isoladamente também **não comprova** que essa autorização existe. A
consulta não atesta segurança semântica.

O helper produtivo `is_teacher_admin_mfa()`, verificado na etapa 1D.4C,
é atualmente um alias de `is_teacher_admin()` para sessões usuais e
**não exige AAL2 por si só**. Portanto, a presença da expressão
`is_teacher_admin_mfa()` em onze corpos de funções não constitui prova
de segundo fator. A ausência da string `aal2` nesses corpos também
não elimina a possibilidade de verificações transitivas por chamadas a
outras rotinas. A política de autenticação necessária às operações
administrativas de alto risco deve ser decidida e testada antes de
restaurar RPCs executáveis por usuários autenticados.

Operações que merecem homologação específica incluem:
`complete_account_deletion_request`,
`complete_data_subject_request`,
`delete_teacher_student` e `run_data_retention_maintenance_now`.
A rotina destrutiva `close_student_account_for_privacy` e a manutenção
`perform_data_retention_maintenance` não têm execução concedida a
`authenticated` na produção e devem permanecer nesse modelo no
ambiente isolado.

## 3. Controles adicionados nesta etapa

O inventário de catálogo SQL
`scripts/sql/supabase_sensitive_privacy_functions_readonly.sql` coleta
apenas assinaturas e sinais booleanos de grants/configurações. O analisador
`scripts/audit_supabase_sensitive_privacy_functions.py` valida uma lista
revista de 24 funções, exige `SECURITY DEFINER`, `search_path`, ausência
de acesso anônimo, execução do papel de serviço e a divisão explícita
entre 14 wrappers autenticados e 10 rotinas de serviço.

Os testes executam casos sintéticos sem conexão com produção e bloqueiam
inventários malformados, assinaturas inesperadas, funções novas sem
revisão, grants ampliados e alterações no papel de execução. A Action
protegida executará a consulta no catálogo produtivo apenas em `main`,
depois do merge, sem disponibilizar segredos ou corpos de funções nas PRs.
A saída pública ficará limitada a um relatório de contagens e indicadores
de segurança. **A aprovação dos controles não autoriza criar, executar
ou publicar funções privilegiadas.**

A referência de segurança para a revisão de grants e funções com
`SECURITY DEFINER` é a
[documentação oficial do Supabase](https://supabase.com/docs/guides/database/functions).

## 4. Critérios para a próxima etapa — 1D.7

1. Definir explicitamente quais operações de privacidade requerem
   AAL2/segundo fator e quais podem funcionar com a sessão de professor.
2. Reconstruir primeiro os fluxos não destrutivos de pedido e consulta em
   banco descartável, verificando ownership, duplicidade, transições
   permitidas e acesso negado a outros alunos.
3. Manter encerramento de contas, eliminação de dados, purga automática,
   exportação integral e agendamento de cron fora da implantação até
   existir um ambiente isolado que reproduza suas dependências.
4. Comparar assinaturas, grants e predicados com a produção por auditoria
   de metadados. Não copiar credenciais ou registros pessoais para testes.
5. Não iniciar o cutover do ledger produtivo nem liberar as apresentações
   da PR #776 antes de concluir sua homologação isolada.

**SEO:** esta etapa cria documentação e verificações de infraestrutura.
Não modifica páginas, títulos, URLs, metadados, sitemap ou conteúdo
indexável. Uma futura reconstrução de `page_content_overrides` terá
avaliação própria e decisão do proprietário sobre possíveis efeitos.
