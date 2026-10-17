# ETAPA 5 — Matriz de decisão LGPD, menores e transferência internacional

**Revisão documental:** 16/10/2026 (hora de Brasília).  
**Escopo:** TAREFAS PARA CASA — Reading, Grammar e Writing.  
**Situação:** levantamento técnico e minuta **não publicada**; não é parecer jurídico ou aceite de lançamento.

## I. Fatos técnicos já identificados

1. A política pública `privacidade/index.html` ainda indica **versão 1.6, de 08/10/2026**, com `title`, `description` e `canonical` indexáveis. Ela menciona atividades acadêmicas e provedores, porém **não descreve especificamente o uso da API OpenAI para corrigir Writing**.
2. Na integração atual, Writing transmite **enunciado e texto livre** para a API Responses, mas não acrescenta explicitamente nome, e-mail ou identificador do estudante ao corpo enviado. O texto livre pode conter dados pessoais inseridos pelo autor.
3. O request utiliza `store:false`. Segundo a documentação da OpenAI, isso **não demonstra Zero Data Retention (ZDR)**; registros de monitoramento de abuso podem existir por até 30 dias na configuração-padrão, com exceções.
4. A habilitação técnica de correção externa requer confirmação administrativa de maioridade gravada em `homework_writing_age_verifications`, não baseada apenas na data de nascimento editável pelo estudante; sem confirmação, a redação pode permanecer salva **sem envio ao provedor**.
5. Reading e Grammar são avaliados por gabarito no servidor, sem necessidade de enviar o conteúdo à OpenAI.
6. O prazo educacional de **12 meses civis após o encerramento formal** do vínculo foi aprovado pelo controlador no registro interno. A automação de expurgo **não está habilitada**; não apresentar o prazo como rotina já operacional.
7. Nenhuma publicação de texto novo sobre Writing em `/privacidade/` ou ativação para os alunos foi autorizada.

## II. Análise preliminar — o que NÃO está demonstrado

| Dimensão | Evidência atual | Pendência decisória |
| --- | --- | --- |
| Base legal do Writing/IA para adultos | Prestação educacional identificada, finalidade pedagógica proposta | Assessoria jurídica deve selecionar e documentar hipótese legal por finalidade; não presumir consentimento ou interesse legítimo |
| Menores (13–17 anos, sem prejuízo de limiares legais aplicáveis) | Gate padrão recusa processamento externo sem maioridade confirmada | Documentar melhor interesse, alternativas pedagógicas, informação acessível e eventual participação dos responsáveis |
| Crianças abaixo de 13 anos ou da idade de consentimento digital aplicável | API OpenAI exige ZDR antes de tratar **dados pessoais** deste grupo | Evidência de ZDR efetivamente habilitado no projeto da API e revisão legal específica; até lá não transmitir |
| Idade desconhecida | Data de nascimento autodeclarada não é prova suficiente | Continuar no estado de não autorização para provedor; escolher procedimento proporcional de aferição |
| Contrato/transferência Brasil → exterior | DPA geral da OpenAI foi localizado; inclui mecanismos referentes a EEE/Reino Unido | Atestar instrumento efetivamente aplicável à transferência de dados brasileiros, países, partes, subprocessadores e mecanismo do art. 33 LGPD; não assumir que SCC europeia satisfaz automaticamente a Resolução ANPD 19/2024 |
| Segurança e retenção do provedor | `store:false` identificado; ZDR e controles contratuais da conta não comprovados | Documentar retenção real da organização/projeto, logging, responsabilidades, subprocessadores e canal de suporte |
| Retenção local / backups | Prazo educacional aprovado; sem expurgo automático de Homeworks | Comprovar identificação do encerramento formal, exceções, backups e execução confiável antes de declarar expurgo ativo |
| Direitos dos titulares | Exportação de Homework implementada; fluxo prévio de privacidade existente | Validar o procedimento com titulares menores/responsáveis e prazos, sem expor gabaritos |
| Política e SEO | Política pública atual é indexável | Aprovação EXPRESSA do controlador quanto à nova redação; revisão SEO antes da publicação |
| Acessibilidade | Testes automatizados sem dados reais | Executar roteiro físico em `ETAPA_5_ROTEIRO_TESTES_FISICOS_20261016.md` |

**Decisão técnica temporária:** nenhuma liberação a alunos; preservar todos os controles existentes. Aferição etária NÃO substitui aceite jurídico ou manifestação sobre transferência internacional.

## III. Minuta de tópicos para `/privacidade/` — USO INTERNO, NÃO PUBLICAR

A redação final depende de revisão técnica e jurídica. Estes são **pontos de conteúdo**, não uma promessa de comportamento inexistente nem texto aprovado para publicação:

- **Finalidade:** recebimento de redações em inglês, armazenamento do original e do resultado, avaliação automática opcional de Writing e acompanhamento acadêmico; comparação automática com gabaritos para Reading e Grammar.
- **Dados compartilhados com a OpenAI, quando autorizado:** enunciado e redação de texto livre, potencialmente contendo dados pessoais que o próprio estudante escreveu. Não incluir nome/e-mail/ID explicitamente no request; não prometer anonimização integral.
- **Natureza automatizada:** nota e sugestões podem conter erros, com canal pedagógico para revisão/contestação; não declarar substituição irrestrita da supervisão docente.
- **Condições de processamento:** correção externa somente quando controles técnicos e critérios jurídicos estiverem satisfeitos; alternativa de aprendizado disponível sem processamento externo conforme desenho pedagógico aprovado.
- **Menores e responsáveis:** explicar medidas proporcionais de idade, melhor interesse, papel dos responsáveis quando aplicável e canais, após validação da base legal. Não afirmar consentimento obtido sem registro.
- **Transferência internacional:** identificar `[CONFIRMAR DESTINO]`, `[CONFIRMAR IMPORTADOR]`, `[CONFIRMAR MECANISMO E DOCUMENTO CONTRATUAL]`, categorias, finalidade e segurança. Não publicar campos não preenchidos.
- **Armazenamento:** prazo de conservação aprovado e sua data de referência; distinguir regra aprovada da execução técnica de expurgo, inclusive backups e exceções legais.
- **Direitos e contato:** acesso, informação, exportação, contestação e eliminação quando cabível, com os canais já operantes.

A Resolução CD/ANPD nº 19/2024, art. 17, prevê informações públicas simples e claras sobre transferências abrangidas; a forma de cumpri-las deve ser escolhida após identificação de um mecanismo jurídico válido.

## IV. Decisões que precisam de comprovação antes de solicitar lançamento

- [ ] Revisão jurídica: hipótese legal e avaliação do melhor interesse de menores, incluindo ECA Digital e sua regulamentação vigente.
- [ ] Revisão técnico-jurídica: confirmar se a conta OpenAI dispõe de ZDR; sem ZDR, não liberar tratamento de dados pessoais de crianças abaixo do limiar aplicável.
- [ ] Contratos: verificar DPA efetivamente incidente, países e subprocessadores; selecionar e comprovar mecanismo de transferência válido sob LGPD/ANPD.
- [ ] Retenção: confirmar o marco de encerramento, backups e automatização antes de afirmar eliminação automática.
- [ ] Comunicação: fechar texto acessível à faixa etária, aos responsáveis quando cabível e aos demais titulares.
- [ ] SEO: submeter a alteração de **conteúdo indexável** de `/privacidade/` à aprovação específica do controlador; conservar metadados/canonical somente após decisão.
- [ ] Acessibilidade física: concluir e registrar testes fora do CI.
- [ ] Liberação: obter autorização **nova e expressa**, não deduzida do aceite pedagógico.

## V. Fontes oficiais consultadas em 16/10/2026

- ANPD, [Enunciado 1/2023 — crianças e adolescentes](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-divulga-enunciado-sobre-o-tratamento-de-dados-pessoais-de-criancas-e-adolescentes).
- ANPD, [Resolução CD/ANPD 19/2024, em especial arts. 9, 16 e 17](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024).
- ANPD, [ECA Digital, regulamentação e orientação de aferição etária](https://www.gov.br/anpd/pt-br/assuntos/eca-digital/).
- OpenAI, [orientações da API para menores](https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance).
- OpenAI, [controles de dados e retenção da API](https://developers.openai.com/api/docs/guides/your-data).
- OpenAI, [Data Processing Addendum vigente](https://openai.com/pt-BR/policies/data-processing-addendum/).
- W3C, [WCAG 2.2, critérios de acessibilidade](https://www.w3.org/WAI/WCAG22/Understanding/).

**Mudanças SEO nesta revisão:** zero. Documento interno de governança, não publicado nas páginas do portal.
