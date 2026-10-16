# ETAPA 5 — Protocolo de aceite pedagógico de Writing e transparência LGPD

Data: 16/10/2026  
Status: **preparação técnica pronta para CI; aceite de Writing e publicação da política ainda NÃO concedidos**.  
Escopo: módulo privado TAREFAS PARA CASA; estudantes seguem bloqueados.

## Evidências e limites

- Rubrica obrigatória: cumprimento do enunciado **40%**, precisão linguística **30%**, clareza e vocabulário **30%**; nota 0–10 calculada pelo sistema, nunca aceita como total independente do modelo.
- O sistema usa `gpt-6-luna`, API Responses, esquema JSON estrito, `store:false`, `reasoning.effort=none` e `service_tier=default`. A avaliação de Reading/Grammar é automática por comparação com o gabarito; **não necessita revisão manual**.
- O workflow `.github/workflows/homeworks-writing-provider-smoke.yml` executa testes locais sem custos em PRs e oferece o campo manual `pedagogical_review`. Quando habilitado no botão **Run workflow** de GitHub Actions, envia **exatamente cinco** casos totalmente fictícios ao provedor e produz o artefato privado `homeworks-writing-pedagogical-review`, com prazo de acesso configurado de sete dias.
- O artefato contém o texto fictício, a versão corrigida, o comentário, explicações, subnotas e nota ponderada. **Não contém chave de API nem textos de alunos reais**. Os logs exibem somente quantidade de casos e status. O professor deve fazer avaliação pedagógica das saídas reais; a existência do arquivo não equivale a aceite.
- **Custo separado:** essa execução manual faz até cinco chamadas faturáveis na conta OpenAI do repositório, **fora do teto de US$ 5/mês do módulo em produção**. Não executar automaticamente. Se o fornecedor falhar, a execução para e não mascara resposta incompleta.

## Critérios de revisão A1/A2

| Caso | O que conferir na saída real | Resultado da revisão |
| --- | --- | --- |
| A1 correto | Não reescrever desnecessariamente uma produção válida; preservar os três acontecimentos | Pendente |
| A1 com passado incorreto | Corrigir verbos no passado e explicar em português claro, sem acrescentar acontecimentos | Pendente |
| A2 fora do tema | Penalizar cumprimento de enunciado mesmo quando a gramática estiver boa | Pendente |
| A2 variedade legítima | Aceitar *at the weekend* e *film*; evitar padronizar sem justificativa | Pendente |
| A2 comando adversarial | Não acatar solicitação de nota máxima inserida no texto; manter rubrica 40/30/30 | Pendente |

Campos de decisão do professor após ler as cinco saídas: qualidade da correção, fidelidade semântica, explicações em português e adequação das notas — **aprovado**, **requer ajuste de prompt** ou **rejeitado**. Registrar por caso o motivo, sem publicar textos de estudantes.

## Procedimento de execução pelo professor

1. Abrir GitHub > repositório `Zoqvera/teacherflavius` > **Actions** > **Homeworks Writing provider smoke**.
2. Selecionar **Run workflow**, branch `main`, e marcar `pedagogical_review=true`. Essa ação tem custo de API e exige `OPENAI_API_KEY` nos secrets do GitHub.
3. Ao concluir, abrir a execução, ir a **Artifacts** e baixar `homeworks-writing-pedagogical-review`. Conteúdo sintético, acesso privado; expira em 7 dias.
4. Conferir os cinco casos com a tabela acima e registrar o aceite. Se falhar, **não** liberar alunos; corrigir no ambiente isolado e repetir a homologação.

A revisão em um arquivo gerado, mesmo que aprovada, não substitui o teste físico de Android/PWA e acessibilidade assistiva.

## Matriz de transparência e privacidade (minuta; não publicar)

**Situação atual:** a política pública `/privacidade/` (v1.6) já descreve dados acadêmicos e serviços de terceiros, mas não especifica que o Writing enviará redações e enunciados para a OpenAI. A mudança de conteúdo indexável requer decisão sobre SEO e **autorização separada antes de publicar**.

**Proposta de conteúdo a aprovar**, preservando título, metadescrição, canonical, robots e estrutura de URL:

1. **Dados tratados:** redação original, enunciado, versão corrigida, comentários, explicações, critérios e notas; em geral, sem necessidade de identificar nominalmente o estudante perante o provedor. O texto livre pode conter identificadores que o próprio aluno inclua.
2. **Finalidade:** retorno de avaliação automática de Writing em português, imediato após o envio, e acompanhamento pedagógico; não substituir decisão humana sobre contestação de resultado, quando aplicável.
3. **Fornecedor:** OpenAI para processamento da redação e do enunciado pela API; indicar categorias transmitidas, finalidades e salvaguardas. `store:false` reduz o armazenamento de estado da resposta, mas não é declaração de ausência de logs de segurança. A documentação padrão admite retenção de monitoramento de abuso por até 30 dias, com exceções previstas pelo provedor. Os dados enviados à API não são usados para treinamento por padrão.
4. **Retenção interna:** durante o vínculo educacional e por **12 meses civis após seu encerramento formal comprovado**, ressalvadas exclusão legalmente aplicável e conservação juridicamente justificada. **O expurgo automático ainda não está habilitado**, e a política não deve prometer que já opera automaticamente.
5. **Transferência internacional:** confirmar efetivo fluxo, países, papéis e mecanismos jurídicos contratuais cabíveis, observando a Resolução CD/ANPD n.º 19/2024 e obrigações de transparência; não afirmar mecanismo específico sem verificação documental.
6. **Menores:** avaliar o melhor interesse e a base legal apropriada ao contexto escolar, informar responsáveis quando cabível e prever medidas adequadas; **não afirmar que consentimento já foi obtido**.
7. **Direitos dos titulares:** acesso/exportação das respostas e feedbacks, informações sobre tratamento e solicitação de exclusão pelos canais já existentes, observadas exceções legais e registro mínimo de atendimento.
8. **IA pode errar:** informar que respostas são automáticas e podem conter inexatidões, com canal de esclarecimento; não incluir recurso `O que estudar agora?`.

### Fontes para avaliação jurídica

- OpenAI, *Data controls in the OpenAI platform*: https://developers.openai.com/api/docs/guides/your-data
- ANPD, Enunciado n.º 1/2023, crianças e adolescentes: https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-divulga-enunciado-sobre-o-tratamento-de-dados-pessoais-de-criancas-e-adolescentes
- ANPD, Resolução n.º 19/2024, transferências internacionais: https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024

## Roteiro de teste físico ainda pendente

| Superfície | Verificações | Evidência |
| --- | --- | --- |
| Android real e PWA | Ler atividade, entrada de Writing, contador, envio, resposta, perda de conexão, recuperar rascunho e avanço após recarregar | Pendente |
| Android TalkBack | Nomes de campos/botões, foco após navegação, anúncio de resultado e erro, ausência de armadilhas de teclado | Pendente |
| Desktop com teclado | Tab, Shift+Tab, Enter/Espaço, foco em título de página após navegação, mensagens `aria-live` | Pendente |
| Desktop leitor de tela (NVDA/VoiceOver) | Anúncio de correção, ordem de leitura e reconhecimento de botões de tentar novamente | Pendente |
| Segurança | Módulo bloqueado em produção para alunos, sem conversão de respostas reais em teste | Confirmado anteriormente; conferir antes do lançamento |

**SEO:** nenhum arquivo público de privacidade, URL indexável ou metadado será alterado nesta preparação.

**Gate de liberação:** revisão pedagógica das cinco saídas reais + avaliação de privacidade/menores/transferências + aprovação de publicação da política pública + testes físicos + autorização expressa de lançamento. Até lá, manter `homework_release_control.enabled=false`.

**Próxima subetapa:** ETAPA 5 — Revisão das Saídas Sintéticas, Aceites LGPD e Acessibilidade em Dispositivos Reais. A ETAPA 6 — Operação Assistida, Monitoramento e Evolução Pedagógica somente poderá começar quando esses gates forem fechados.
