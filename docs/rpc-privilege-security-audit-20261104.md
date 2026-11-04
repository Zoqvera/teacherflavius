# Auditoria de RPCs privilegiadas — 04/11/2026

## Abrangência e resultado

Leitura do catálogo da produção em `wnigzpvgsbpjdxvjzugt` após a
proteção do esquema `private`.

| Verificação | Resultado |
| --- | ---: |
| RPCs `public.SECURITY DEFINER` acessíveis a `anon` | 10 |
| RPCs `public.SECURITY DEFINER` acessíveis a `authenticated` | 198 |
| Dessas 198, funções sem `search_path` explícito | 0 |
| Dessas 198, funções que referenciam autenticação/admin em seu corpo | 187 |
| RPCs `authenticated` sem referência direta ou acesso anônimo | 1 |
| RPCs privadas acessíveis a `anon` ou `authenticated` | 0 |

O único caso sem referência direta é
`mark_teacher_lesson_presented_v2(text,uuid,date,integer)`; ele chama
`private.assert_teacher_v2_session_open()` (que valida `auth.uid()` e
`is_teacher_admin()`) e delega a
`public.mark_teacher_lesson_presented()`, que também exige professor.

As 10 RPCs anônimas se concentram nas consultas de vagas, ofertas, avaliações
publicáveis e nas operações intencionais de reserva/lista de espera. Duas
possuem overloads legados de 3 argumentos, preservados para abas antigas.
O frontend atual em `escolher-turma/app.js` usa as variantes de quatro
argumentos. Remoção dos overloads só deve ocorrer após validação de cache/PWA.

## Achado prioritário: política deliberada de AAL1

Em 02/10/2026, a migração
`20261002183024_remove_admin_mfa_requirement.sql` tornou
`public.is_teacher_admin_mfa()` um alias de `is_teacher_admin()`,
sem conferir `aal2`. Isso foi deliberado e documentado, não um
defeito novo de sintaxe. O nome do helper, porém, induz a pensar
incorretamente que operações financeiras e de privacidade exigem MFA.

A reintrodução abrupta de `aal2` na produção bloquearia o professor
caso ainda não tivesse segundo fator verificado, e poderia comprometer
mensalidades, estornos e exclusões de contas. Logo, adotar rollout:

1. Disponibilizar configuração/validação TOTP somente para administradores,
   usando `supabase.auth.mfa`, sem persistir o segredo no navegador.
2. Confirmar um fator verificado e uma sessão `aal2` no uso real.
3. Implementar step-up seletivo no banco para alterações de mensalidade,
   estorno, isenção, exclusão e acesso a dados especialmente sensíveis.
   Manter `is_teacher_admin()` em rotinas acadêmicas cotidianas.
4. Testar sessões `aal1`, `aal2`, serviço e aluno com dados fictícios;
   somente depois ativar a exigência em produção.

**Esta PR implementa só a primeira etapa:** UI de configuração e verificação
no perfil do professor. Nenhuma autorização de mensalidade ou operação
financeira foi alterada.

## Outros riscos para auditoria subsequente

- Endpoints anônimos de lista de espera não comprovam titularidade
  do telefone e exigem revisão de prevenção a spam, por Edge Function/
  rate limiting verificável ou controle equivalente. A tabela não está
  diretamente acessível ao navegador.
- Reservas possuem limite diário por WhatsApp e token aleatório
  armazenado apenas como hash no banco.
- A versão legada de 3 argumentos das RPCs públicas deve ser reavaliada
  após validar janelas antigas e PWA.
- A análise por nome e por referência textual é triagem, não prova
  completa de segurança de todas as 198 funções. Revisar operações
  administrativas de alto impacto com testes de autorização de cenário.

## Integração e SEO

`teacher_mfa_setup.js` é carregado somente na rota `/perfil/` e
apresentado apenas após uma checagem administrativa real.
Não altera URL, título, `meta`, canonical, sitemap nem estrutura
pública indexável. O segundo fator é opt-in nesta etapa; exibir o
formulário não muda a autorização do banco.
