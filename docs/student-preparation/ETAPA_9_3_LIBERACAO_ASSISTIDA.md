# ETAPA 9.3 — Liberação assistida por coorte única

**Data:** 15/10/2026

## Separação entre código e liberação

A implantação permite consultar o banco de autorização em hostnames produtivos, mas a própria publicação não pode liberar nenhum aluno. A liberação real depende do interruptor **global** da tabela `public.student_preparation_pilot_settings` e da linha `enabled=true` do participante autenticado em `public.student_preparation_pilot_members`.

- O controle está em `student_preparation_flow.js`, com `PRODUCTION_PILOT_ARMED=true` após este release.
- A lista de participantes é gerenciada somente no banco com privilégios administrativos; não contém parâmetros de URL controláveis pelo aluno.
- Todas as telas consultam a autorização após `Auth.getSession()`, utilizando `session.user.id`.
- Quem não participa permanece no percurso anterior: `ESTOU PREPARADO` quando aplicável.
- O fluxo privado do roteiro não altera SEO do domínio principal, nem canonical, robots.txt ou sitemap.

## Pré-condições para abrir o interruptor do banco

1. Somente um usuário previamente cadastrado e autorizado. Nenhum outro `enabled=true`.
2. Histórico da migração corresponde ao SHA256 versionado no repositório.
3. Segurança: RLS ativo, leitura só da própria linha e nenhum grant de escrita para `authenticated`.
4. Workflows de Clean Code, browser desktop/mobile, segurança, autenticação, SEO e build estático aprovados.
5. O build do Cloudflare deve corresponder ao commit integrado em `main`; não inferir entrega produtiva somente pelo status de PR.
6. Documentar explicitamente quando a chave do banco foi ligada e confirmar que a consulta individual foi positiva.

## Abertura e reversão

**Abertura controlada (somente após confirmar todos os pré-requisitos):**

```sql
update public.student_preparation_pilot_settings
set enabled = true, updated_at = now()
where id = true and enabled = false;
```

**Reversão imediata (sem publicação de código):**

```sql
update public.student_preparation_pilot_settings
set enabled = false, updated_at = now()
where id = true and enabled = true;
```

A reversão é observada na próxima avaliação de elegibilidade (nova entrada/recarregamento da página); páginas já abertas podem conservar estado em memória. Em incidente, orientar o participante a recarregar ou sair da página.

## Testes e monitoramento

- Revisar no ambiente real a introdução, acesso à lição prevista, botão PRÓXIMA PARTE, segunda parte e retorno.
- Abrir o roteiro: a lição mostra PRÓXIMA LIÇÃO, nunca PRÓXIMA PARTE ou ESTOU PREPARADO.
- Em sessões não autorizadas, verificar que a experiência anterior permanece.
- Testar material não publicado, estado de ausência de lição, sessão expirada e viewport móvel.
- Eventos agregados `preparation_*` dependem de consentimento de analytics. Não inferir taxa de abandono de quem recusou consentimento.
- Não enviar dados pessoais, textos de aluno ou respostas de aula aos eventos adicionais.
- Se ocorrer regressão pedagógica, problema de login, vazamento de dados ou impacto no restante da base, usar a reversão imediatamente.

## Critérios de finalização

Só declarar o piloto efetivamente liberado após confirmação de `PRODUCTION_PILOT_ARMED=true` no código do ambiente publicado e `enabled=true` na chave geral do Supabase. A seleção de um participante na lista não é suficiente.

## Etapa seguinte

**ETAPA 9.4 — Observação do Piloto e Decisão de Ampliação**, com acompanhamento da jornada e eventual reversão, sem adicionar participantes sem nova aprovação.
