# ETAPA 10 — Liberação geral da preparação em duas partes

## Autorização

O proprietário da plataforma autorizou a liberação da nova experiência para **todos os alunos** em 16/10/2026, após homologação operacional com Oivalf. O novo acesso é automático para estudantes ativos e novas matrículas; não existe mais necessidade de inserir cada estudante na antiga tabela de participantes do piloto.

## Elegibilidade e segurança

O controlador compartilhado `student_preparation_flow.js` permite a nova experiência somente quando:

1. O hostname é exatamente `teacherflavius.com` ou `www.teacherflavius.com` (a prévia isolada mantém seu comportamento);
2. O indicador de código `PRODUCTION_PILOT_ARMED` permanece `true`;
3. Existe uma sessão autenticada e um `userId` derivado dessa sessão;
4. O interruptor administrativo `public.student_preparation_pilot_settings.enabled` está `true`;
5. O perfil do próprio aluno possui `enrolled=true` e `archived=false`. A consulta a `public.profiles` fica sob RLS, com filtro `id = userId`.

Se a consulta do interruptor ou do perfil falhar, faltar um registro ou houver valor diferente do esperado, o acesso à nova experiência **falha fechado**, mantendo o modo anterior.

O sistema acadêmico continua exigindo aluno ativo em seus RPCs e usando `auth.uid()` para persistir preparação e perguntas, sem confiar nos parâmetros do cliente.

A tabela de participantes do piloto foi **preservada apenas como histórico da homologação inicial**; não precisa ser expandida, não é consultada pelo controlador novo, e suas políticas RLS continuam válidas.

## Publicação

O interruptor do Supabase já estava habilitado para o piloto individual. A alteração do código é o que passa a liberar os perfis ativos; por isso, a publicação deve ocorrer somente **depois** que os testes críticos concluírem com sucesso. O CSS, o modal `Great job!`, a numeração original das perguntas, o botão `TODAS AS LIÇÕES`, o roteiro do professor e a gravação acadêmica não devem ser modificados neste release.

O `student_preparation_flow.js` tem versão de cache própria em quatro páginas: O QUE FAZER, SEGUNDA PARTE, LIÇÃO e ROTEIRO DE ESTUDOS.

## Reversão operacional imediata

Se ocorrer regressão de login, inconsistência no estudo de perguntas ou erro relevante para os demais alunos, o administrador pode desligar a experiência geral **sem publicar código**:

```sql
update public.student_preparation_pilot_settings
set enabled = false, updated_at = now()
where id = true and enabled = true;
```

Ao recarregar ou iniciar nova navegação, os alunos retornam ao modo anterior; uma página já aberta pode preservar o estado em memória até novo carregamento.

Para retomar após correção, ligar `enabled=true` somente depois de conferir o código publicado e as regras de acesso.

## Testes

- Interruptor desligado, consulta administrativa falha, usuário não autenticado e host não autorizado negam acesso.
- Aluno ativo matriculado (inclusive matrícula criada depois) recebe o novo fluxo.
- Aluno arquivado, não matriculado ou com perfil ausente recebe o modo anterior.
- Troca de conta invalida o cache local; uma resposta atrasada de usuário anterior não autoriza o próximo usuário.
- Autorização dos perfis permanece sob RLS; estudantes não podem alterar o interruptor.
- Aceitação Chromium confirma o percurso anterior e o novo, com layout desktop/mobile.
- Nenhuma informação pessoal ou resposta de alunos é adicionada a eventos de analytics.

## SEO

As páginas de lição e preparação mantêm suas regras de privacidade/indexação; **nenhuma mudança** em `robots.txt`, sitemap, canonical ou URLs públicas. Alunos matriculados passam a receber um percurso diferente mediante autenticação; isso não altera conteúdo indexável.

## Próxima etapa

**ETAPA 11 — Monitoramento Pós-Liberação e Garantia de Estabilidade**: confirmar build Cloudflare e acompanhar segurança e eventuais erros da nova experiência, antes de encerrar a transição do piloto.
