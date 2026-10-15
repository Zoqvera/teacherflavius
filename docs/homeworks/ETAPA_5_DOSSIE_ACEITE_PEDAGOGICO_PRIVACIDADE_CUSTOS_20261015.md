# TAREFAS PARA CASA — ETAPA 5: Dossiê de aceite de Writing e privacidade

Estado: **PARA REVISÃO DO PROFESSOR — NÃO CONSTITUI AUTORIZAÇÃO DE LANÇAMENTO**.
Elaborado em 15/10/2026. Exclusivo da documentação do repositório. Nenhum texto real de aluno está incluído.

## 1. Contrato pedagógico a validar

O aluno escreve de 20 a 3.000 caracteres em inglês. O `gpt-6-luna`, chamado pela Responses API, deve devolver em português comentário geral, texto corrigido e explicações, além de três notas numéricas de 0 a 10. A Edge Function calcula a nota oficial com esta fórmula:

`nota = arredondar(0,40 × cumprimento + 0,30 × precisão + 0,30 × clareza/vocabulário, 2)`

A avaliação de Reading e Grammar continua exclusivamente por comparação direta ao gabarito. Não há revisão humana dessas duas modalidades e não há seção "O que estudar agora?".

**Amostras fictícias propostas para revisão pedagógica** (nenhuma deve ser enviada com dados pessoais reais):

| Cenário | Enunciado | Texto fictício | O professor deve examinar |
|---|---|---|---|
| A1 — comunicação correta | Descreva o que fez na escola ontem em três frases. | "Yesterday I went to school. I studied English. I talked to my friends." | Preservação do significado; não exigir reescritas desnecessárias |
| A1 — erro de passado | Mesmo enunciado | "Yesterday I go to school. I study English. I meet my friends." | Correção de "go/study/meet"; justificativas simples, claras e específicas |
| A2 — parcialmente fora da tarefa | Mesmo enunciado | "My school is big and beautiful. I like my English teacher. There are many rooms." | Cumprimento do enunciado deve ser inferior mesmo com gramática compreensível |

**Critérios para o aceite pedagógico:** feedback em português compreensível para A1/A2; texto original intacto; texto corrigido não inventa acontecimentos; explicações fiéis ao texto; três subnotas e pesos identificáveis; média ponderada correta; nenhum feedback inventado quando o provedor falhar; nenhum resultado emitido duas vezes para a mesma avaliação. As notas exatas dos exemplos são de julgamento pedagógico, não foram predefinidas como resultados reais.

## 2. Fluxo de dados e privacidade

- **Coletado:** redação enviada pelo aluno já autenticado; o sistema associa resposta à atribuição/versão, armazena original, correção, nota, explicações e horários no PostgreSQL/Supabase.
- **Enviado ao provedor:** enunciado e texto original para `https://api.openai.com/v1/responses`. O sistema não inclui explicitamente nome, e-mail nem identificador do aluno no corpo da requisição. O próprio aluno ainda pode inserir informações pessoais no texto; o aviso atual recomenda não fazê-lo, mas não bloqueia tecnicamente esses dados.
- **Resposta do provedor:** JSON estruturado, limitado e validado pela Edge Function. O cliente mostra original, corrigido, comentário e critérios.
- **Retenção na OpenAI:** `store: false` impede o armazenamento opcional de estado de aplicação da resposta, mas **não significa retenção zero**. A documentação oficial informa que os logs de monitoramento de abuso podem incluir conteúdo e são normalmente conservados por até 30 dias, com exceções. Conteúdo API não é usado para treinar modelos por padrão, sem adesão explícita.
- **Retenção no Supabase:** não foi aprovada nesta etapa uma política específica de exclusão/expiração das respostas Writing e feedbacks; **não presumir exclusão automática**. Definir política de retenção, exportação e exclusão aplicável, inclusive ao cancelamento da matrícula.
- **Base legal LGPD e menores:** decisão pendente do controlador do site, preferencialmente com revisão jurídica. Aviso informativo não constitui comprovação de consentimento. O tratamento de dados de estudantes menores de idade exige consideração específica.
- **Logs técnicos:** eventos de falha devem informar contexto técnico genérico, sem despejar mensagens brutas de banco/provedor que possam conter a redação.

Fonte oficial para avaliação: <https://developers.openai.com/api/docs/guides/your-data>.

## 3. Orçamento e rate limiting

Tabela pública de preços consultada em 15/10/2026: `gpt-6-luna`, processamento Standard, entrada **US$ 0,10** e saída **US$ 0,50** por 1 milhão de tokens. Varia com tokens efetivos, processamento e condições da conta. Confirme o preço no momento de autorizar o lançamento.

**Simulação, não projeção de gasto observado:** uma avaliação com 1.000 tokens de entrada e 500 tokens de saída custa aproximadamente US$ 0,00035. Mil avaliações nesse mesmo perfil custariam aproximadamente **US$ 0,35**. Esse exemplo não inclui impostos, câmbio, variações de tokenização, modos de processamento nem infraestrutura.

O backend limita tentativas de correção de Writing a **5 por hora e 15 por dia por aluno**, mas **ainda não existe teto global de gasto ou de requisições de todos os alunos**. O código exige uma única avaliação formal por atribuição e recupera o feedback já salvo, mas falhas recuperáveis podem ocasionar novas chamadas e consumo adicional.

**Decisão registrada em 15/10/2026:** o professor aprovou **US$ 5 por mês** para a correção Writing pelo GPT-6 Luna, alerta aos **US$ 4 (80%)** e suspensão de novas correções antes de ultrapassar o saldo. A implementação do módulo usa uma reserva conservadora e atomicamente serializada no PostgreSQL antes de cada chamada à IA. O limite é específico das correções de Writing feitas por esta Edge Function; **não** limita a cobrança total da conta OpenAI por outras aplicações, chaves, projetos ou serviços. A política de retenção e os demais aceites permanecem pendentes.

Fonte oficial: <https://developers.openai.com/api/docs/models/gpt-6-luna>.

## 4. Segurança e teste em dispositivos

O conjunto automatizado da ETAPA 5 já exercitou autenticação, isolamento de aluno A/B, gabaritos não expostos, PostgreSQL/Edge HTTP, chamada real à IA com texto fictício, persistência idempotente, notas ponderadas, bloqueio global e 18 renderizações no Chrome em larguras 320/390/1280 px.

**Pendente — validação humana:** Android físico/PWA e desktop com teclado, rolagem, leitura do enunciado, envio, espera, feedback e retorno após recarregar a página; acessibilidade assistiva; avaliação visual dos erros e mensagens. Os cenários locais não precisam abrir o recurso a estudantes para executar CI.

## 5. Aprovações distintas e não presumidas

1. **Aceite pedagógico:** professor confirma que a correção por IA corresponde ao nível e aos objetivos de aprendizagem.
2. **Aceite de privacidade e custos:** controlador aprova textos de transparência, finalidade, base legal, política de retenção, tratamento de menores e orçamento operacional.
3. **Aceite de experiência:** professor confirma testes manuais Android/desktop quando existir acesso privado de homologação autorizado.
4. **Autorização de lançamento:** decisão separada, expressa e posterior, que seria necessária para habilitar `homework_release_control.enabled`.

**Não alterar a chave de liberação** e **não substituir o portal legado** com base apenas neste dossiê. Etapa atual: **ETAPA 5 — Homologação Integrada e Liberação Controlada**; próxima, se todas as condições forem cumpridas: **ETAPA 6 — Operação Assistida, Monitoramento e Evolução Pedagógica**.

Este dossiê não muda as configurações de SEO nem acrescenta páginas públicas.


### Orçamento operacional implementado para Writing — USD 5,00/mês

- **Período:** mês civil no fuso `America/Sao_Paulo`; o primeiro dia do mês abre um novo saldo automaticamente.
- **Teto:** 5.000.000 micros de dólar (USD 5,00). Alerta ao contabilizar ao menos 4.000.000 micros (USD 4,00).
- **Concorrência:** o banco serializa reservas com `SELECT FOR UPDATE` na linha do mês; chamadas de alunos diferentes não conseguem ultrapassar o saldo apenas por serem simultâneas.
- **Antes da chamada:** reserva de até USD 0,0047 para cada avaliação, calculada de forma conservadora para 40.000 tokens de entrada e 1.400 de saída no nível `service_tier: 'default'` (Standard). Como os formulários limitam tamanho de entrada, o teto reservado supera confortavelmente o envelope de textos permitido. Se o saldo for menor que a reserva, a IA não será chamada e o texto original permanecerá salvo.
- **Após resposta válida:** conciliação pelo campo `usage` da OpenAI (input/output, sem descontar cache, a favor da segurança). Se o provedor falhar ou não houver uso mensurável, a reserva continua comprometida ou é liquidada pelo máximo, respectivamente. Isso pode subestimar o orçamento disponível, mas não cria despesa desprotegida.
- **Aviso aos 80% e no bloqueio:** os eventos são deduplicados por mês e integrados à fila preexistente de alertas de saúde do sistema. O sucesso de entrega depende das configurações/saúde dessa fila e deve ser monitorado; não se afirma confirmação de recebimento por e-mail antes de verificá-la.
- **Acesso:** tabelas e funções de orçamento são restritas ao backend `service_role`; nunca vão ao cliente estudante. Os testes em PostgreSQL descartável verificam reserva, reconciliação, duplicidade, 80%, bloqueio e impossibilidade de consulta por `anon`/`authenticated`.
- **Limitação financeira:** a reserva cobre somente o custo da operação de geração com o modelo e tarifa Standard verificada em outubro de 2026. Preços futuros, operações externas à Edge, tributos, diferenças de faturamento e despesas de infraestrutura não são controlados por esta funcionalidade. É recomendável definir também um limite e alertas no projeto da OpenAI como camada independente.

**Importante:** a implementação do orçamento não constitui aceite de privacidade, não altera a trava de acesso e não autoriza lançamento.
