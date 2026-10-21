# ETAPA 8 — Homologação com identidades sintéticas

**Estado:** homologação técnica do piloto, sem abertura a estudantes.

## Ambiente e limites

- Banco PostgreSQL 17 criado pelo serviço temporário da GitHub Actions. É destruído depois do teste.
- Nenhum dado real, endpoint de produção, credencial de Supabase, réplica de produção ou custo de branch Supabase.
- Testa-se a migração versionada em `supabase/migrations/20261015213000_student_preparation_pilot_eligibility.sql`, não uma cópia simplificada dela.
- A migração **não foi aplicada** ao banco real e `PRODUCTION_PILOT_ARMED` permanece `false`.

## Matriz de homologação

1. Criação da chave geral desligada, com tabela de participantes inicialmente vazia.
2. Verificação de RLS ativo e permissões `authenticated` somente leitura.
3. Identidade sintética A tem `enabled=true` e só lê sua própria linha.
4. Identidade sintética B tem `enabled=false` e não enxerga o registro A.
5. Ausência de contexto de autenticação não revela registros de participantes.
6. Reversão da chave global não apaga a lista de membros.
7. Mudança de conta no navegador invalida a decisão de acesso anterior.
8. Uma resposta atrasada do banco não pode habilitar uma conta diferente.
9. Gate no cliente mantém `PRODUCTION_PILOT_ARMED=false`; erros de consulta negam o piloto.
10. Instrumentação somente registra eventos enumerados e depende do consentimento.
11. Testes de tela móveis e desktop, contexto do roteiro, conteúdo não publicado e controle de autenticação seguem no CI.

## Conferências antes de liberar o piloto real

- Definir a coorte de participantes com consentimento e verificar se cada um tem um `auth.users.id` válido.
- Validar permissões de banco em uma instância Supabase isolada antes de aplicar DDL no ambiente principal.
- Executar o plano de restauração, verificar advisors de segurança e auditar eventuais regras de divulgação.
- Autorizar separadamente a aplicação da migração, o cadastro da coorte e a ativação da chave em produção.
- Manter `PRODUCTION_PILOT_ARMED=false` até essa autorização. O login de estudantes comuns continua no fluxo anterior.
- Medir conversão de passos, erros e suporte no grupo-piloto; usar a chave geral no banco para reversão sem publicação de código.

## SEO

Os testes de aceitação e a correção do cache de autorização não alteram URLs públicas, indexação, canonical nem sitemap. A proteção `noindex,nofollow` do endereço de pré-lançamento permanece.

## Próxima etapa

**ETAPA 9 — Seleção da Coorte, Homologação Supabase e Ativação Assistida.** Requer decisão explícita sobre alunos participantes e liberação produtiva; não faz parte desta PR.
