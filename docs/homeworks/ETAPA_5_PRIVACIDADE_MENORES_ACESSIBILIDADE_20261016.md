# ETAPA 5 — Controles de privacidade de menores e acessibilidade

Data: 16/10/2026  
Estado: **homologação parcial; liberação para alunos não autorizada**.  
Este documento é um registro técnico de riscos, evidências e decisões pendentes; não constitui parecer jurídico nem política publicada.

## 1. Limites comprovados

- O gate administrativo de Writing exige `homework_writing_age_verifications.verified_adult=true` para chamar a OpenAI. A data de nascimento editável pelo estudante não equivale a aferição etária.
- A ausência da confirmação administrativa mantém a resposta salva como `submitted`, sem enviar o texto ao provedor externo, reservar orçamento ou inventar nota. Reading e Grammar permanecem corrigidos por gabarito.
- O controle geral `homework_release_control.enabled=false` deve continuar desativado. A PR desta subetapa não altera banco de dados, Edge Functions, controles de liberação, URLs públicas ou política de privacidade.
- A interface privada de Writing explica agora que salvar a redação independe de autorização para avaliação externa. Somente depois da verificação de idade e privacidade informa o tratamento pela OpenAI.
- O contador de caracteres continua visível e é associado ao campo por `aria-describedby`; não usa `aria-live` por caractere, para evitar anúncios repetitivos a cada digitação.

## 2. Matriz de decisões jurídicas e de proteção

| Tema | Situação | Evidência ou decisão necessária antes do lançamento |
| --- | --- | --- |
| Menores de 18 anos | Avaliação externa suspensa preventivamente para contas sem maioridade comprovada | Definir política para menores, melhor interesse, base legal e comunicação proporcional aos responsáveis. Evitar exclusão pedagógica permanente. |
| Crianças abaixo de 13 anos ou da idade de consentimento digital aplicável | **Sem autorização para enviar dados pessoais à OpenAI** | Confirmar efetiva habilitação de Zero Data Retention (ZDR) e os demais requisitos legais antes de qualquer hipótese de mudança. `store:false` sozinho não comprova ZDR. |
| Declaração de maioridade | Não usar data de nascimento autodeclarada como autorização | Registrar apenas confirmação administrativa proporcional, sem armazenar imagens de documentos ou biometria nesta tabela. |
| Encaminhamento internacional | Sem aceite jurídico final | Identificar exportador/importador, países envolvidos, base legal e mecanismo válido da LGPD (Resolução CD/ANPD 19/2024), com evidências contratuais verificáveis e informação ao titular. |
| Retenção | Política proposta de doze meses civis após encerramento formal; expurgo automático não habilitado | Revisar jurídico-operacionalmente o prazo, exceções, logs, backups, exclusão e transparência antes de prometer prazo ou publicar política. |
| Política pública `/privacidade/` | Alteração não autorizada | Obter decisão expressa sobre o conteúdo indexável e possíveis reflexos de SEO antes de publicar qualquer modificação. |
| Liberação de alunos | Bloqueada | Exigir aceite jurídico, acessibilidade física documentada e autorização explícita posterior. |

Referências para avaliação: [orientação OpenAI para menores](https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance), [controles de dados OpenAI](https://developers.openai.com/api/docs/guides/your-data), [Enunciado ANPD 1/2023](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-divulga-enunciado-sobre-o-tratamento-de-dados-pessoais-de-criancas-e-adolescentes), [ECA Digital (ANPD)](https://www.gov.br/anpd/pt-br/assuntos/eca-digital/), [Resolução ANPD 19/2024](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024).

## 3. Protocolo reproduzível de acessibilidade física

Usar **somente atividade fictícia**, em ambiente isolado, sem alunos reais, captura de dados pessoais ou acionamento da API de IA. Registrar data, dispositivo, SO, navegador, leitor de tela, evidência não identificadora, resultado e defeito encontrado.

| Dispositivo | Cenário mínimo e resultado esperado | Estado |
| --- | --- | --- |
| Android + TalkBack | Percorrer título, enunciado, rótulo do Writing, aviso condicional de IA e contador; digitar sem anúncio de cada caractere; receber confirmação/erro inteligível; testar retorno e retomada | Pendente — exige dispositivo real |
| Android PWA sem leitor | Teclado virtual, modo retrato, largura mínima, envio fictício, desconexão e recuperação sem duplicar submissão | Pendente — exige dispositivo real |
| Desktop somente teclado | Tab, Shift+Tab, Enter, foco no título após navegação, botão de retorno e ausência de armadilhas | Pendente — exige teste físico |
| Desktop + NVDA/VoiceOver | Verificar nome/descrição do campo, alertas da submissão, nota/feedback, status de privacidade e retorno ao catálogo | Pendente — exige leitor real |
| CI em navegador headless | Larguras 320/390/1280, presença do aviso condicional, botões nomeados, ausência de overflow e testes de integração de contador | Implementado; conferir conclusão do workflow da PR |

A verificação automatizada **não substitui** TalkBack, NVDA, VoiceOver ou teste manual em dispositivos físicos. Não marcar a acessibilidade como homologada apenas porque o CI está verde.

## 4. Critérios de encerramento da ETAPA 5

- [x] Aceite pedagógico A1/A2 do professor, com ressalvas registradas.
- [x] Regra preventiva de idade no servidor e liberação desligada.
- [x] Aviso privado de Writing compatível com o processamento condicional, sujeito à aprovação do CI desta PR.
- [x] Contador de Writing associado ao campo sem anúncios contínuos, sujeito à aprovação do CI desta PR.
- [ ] Validar exigências legais relativas a crianças, adolescentes e responsáveis.
- [ ] Confirmar mecanismo e transparência de transferências internacionais.
- [ ] Validar e aprovar a política pública, com decisão sobre SEO.
- [ ] Concluir testes físicos de acessibilidade.
- [ ] Autorizar expressamente o acesso aos alunos.

**SEO:** a presente subetapa altera apenas JavaScript da interface privada e arquivos internos de teste/documentação, sem editar páginas indexáveis, títulos, metadados, sitemap, canonical ou robots.

**Próxima subetapa:** ETAPA 5 — Aceite Jurídico de Privacidade e Testes Físicos de Acessibilidade. A ETAPA 6 (Operação Assistida, Monitoramento e Evolução Pedagógica) continua condicionada ao fechamento desses gates.
