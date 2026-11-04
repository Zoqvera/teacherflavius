# Etapa 5 — Auditoria das RPCs públicas somente leitura

Data: 04/11/2026. Projeto: `wnigzpvgsbpjdxvjzugt`.

## Resultado

A análise de produção confirmou **três** funções `SECURITY DEFINER`
executáveis por `anon`, todas deliberadamente somente leitura:

- `get_public_class_seat_availability()`: horários e vagas; usado pela
  secretaria acadêmica e dependências de disponibilidade.
- `get_public_course_vacancies()`: vagas e turmas para as páginas
  públicas; inclui somente classes ativas e não experimentais.
- `get_public_student_reviews(text)`: estatísticas e até cinco
  avaliações recentes por modalidade; exige `status='approved'` e
  `publication_consent_at is not null`.

As três funções têm `STABLE`, `SECURITY DEFINER`, `search_path`
vazio, retorno limitado a colunas públicas e grants específicos para
`anon`, `authenticated` e `service_role`, não para `PUBLIC`.
A tabela privada de avaliações possui RLS e não concede acesso direto
aos papéis de navegador.

A verificação encontrou 11 avaliações aprovadas e com consentimento
(10 de grupo e uma individual). A resposta pública contém somente
nome exibível, nota, comentário consentido, data e indicação de aluno
verificado; não inclui IDs, CPF, e-mail ou telefone. O renderer utiliza
`textContent`, impedindo interpretação do texto como HTML.

## Avaliação de consultas

Verificação pontual com `EXPLAIN (ANALYZE, BUFFERS)`:

| RPC | Duração observada |
| --- | ---: |
| Disponibilidade por modalidade | 7,1 ms |
| Disponibilidade de turmas | 8,8 ms |
| Avaliações públicas de grupo | 3,2 ms |

Esses números não constituem benchmark de carga. O catálogo dispõe de
índices de classe/matrícula e de um índice de busca das avaliações
públicas; não foram identificadas consultas anormalmente lentas nessa
verificação. Não são justificadas novas escritas, índices ou caches
neste momento.

## Proteção permanente e limites

`scripts/sql/public_readonly_rpc_security_attestation.sql` é
**somente leitura** e confirma no banco:

- conjunto exato de três RPCs `SECURITY DEFINER` anônimas;
- retorno tipado, `STABLE`, proprietário, `search_path` e grants;
- ausência de privilégio herdado de `PUBLIC`;
- respostas JSON de avaliações com apenas campos publicáveis;
- máximo de cinco avaliações por modalidade e os filtros de
  consentimento/aprovação;
- ausência de acesso direto ao esquema privado pelos papéis do navegador.

O script passa a integrar o fluxo existente de verificação do
histórico do Supabase em PRs internos, pushes à `main` e execuções
programadas. Os testes estáticos independentes cobrem código,
consulta do banco, permissões e renderização.

A proteção de volumetria e ataques distribuídos continua exigindo
controles confiáveis de gateway/borda do Supabase. Não atribuir
proteção contra DDoS a uma consulta SQL nem usar cabeçalhos de IP não
verificados; controles de limitação por navegador seriam facilmente
contornáveis. Não revogar permissões legítimas apenas para remover
um alerta de lint.

## Escopo

Nenhuma função do Supabase ou tabela foi modificada. Não houve
alterações de cobrança, cadastros, SEO, URLs, metadados, indexação
ou exigência de MFA administrativo.
