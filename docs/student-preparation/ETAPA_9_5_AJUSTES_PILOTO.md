# ETAPA 9.5 — Ajustes após o primeiro piloto de preparação

**Data:** 15/10/2026

## Etapa 1 — Confirmação por pergunta

Na página `/o-que-fazer/segunda-parte/`, cada clique bem-sucedido em **ESTUDEI A PERGUNTA** abre um `<dialog>` modal de confirmação.

- Título: **Great job!**
- **ESTUDAR MAIS UMA PERGUNTA** fecha o modal e move o foco para a próxima pergunta ainda disponível, se existir, ou para o título da seção caso todas tenham sido estudadas.
- **TERMINAR MEUS ESTUDOS** abre `/area-do-estudante/`.
- O modal só aparece **depois** da confirmação de `markQuestionStudied` pelo backend. Se o registro falhar, não abre e o botão permite repetir a operação.
- Fluxo anterior de O QUE FAZER permanece sem pop-up; a interface exige sessão e o piloto habilitado.

## Etapa 2 — Preparação antes da Conversation

- **PRÓXIMA PARTE** só é disponibilizado para a lição prevista no fluxo de preparação, nunca no roteiro de estudos.
- O clique chama o RPC existente `mark_my_lesson_prepared` através de `AcademicWorkflowService.markLessonPrepared(lessonNumber)`.
- A gravação é idempotente no banco: não cria outra preparação se o aluno já havia registrado essa lição.
- A navegação para `/o-que-fazer/segunda-parte/` acontece **após** confirmação do registro. Falha no RPC mantém o aluno na lição com mensagem de erro e possibilidade de tentar novamente.
- O Roteiro da aula lê o `lesson_status` existente e exibe **ALUNO PREPARADO**. Sem alterações de status de frequência, presença, lição apresentada, competência ou mensalidade.
- Enquanto o Roteiro da aula estiver visível, ele atualiza os dados a cada 30 segundos. O professor ainda pode usar **ATUALIZAR** para conferir imediatamente.

## Etapa 3 — Testes e publicação

Executar testes unitários, aceitação Chromium desktop/móvel, Clean Code e auditorias de segurança/SEO. Conferir a publicação Cloudflare do commit integrado e validar com sessão real autorizada.

## SEO e alcance

Nenhuma nova rota, URL de indexação, canonical, `robots.txt` ou sitemap alterado. `/o-que-fazer/segunda-parte/` mantém `noindex,nofollow`; não há novo conteúdo público indexável.

A alteração permanece restrita a quem já participa da nova experiência. O modal não é exibido no fluxo anterior; a preparação automática ocorre apenas ao usar PRÓXIMA PARTE.

## Próxima etapa

**ETAPA 9.6 — Validação do Primeiro Uso e Observação do Piloto.** Acompanhar o funcionamento da nova confirmação e o aparecimento do status no Roteiro da aula antes de ampliar participantes.
