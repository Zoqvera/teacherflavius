# ETAPA 5 — Roteiro de homologação física de acessibilidade e continuidade

**Data de elaboração:** 16/10/2026.  
**Status:** planejamento executável, testes físicos **NÃO REALIZADOS**.  
**Público:** professor/controlador e pessoa de apoio à homologação.  
**Restrições:** nenhuma liberação a alunos reais, nenhuma chamada OpenAI, nenhuma coleta de dados pessoais em artefatos públicos.

## A. O que cada ambiente realmente valida

| Ambiente | O que é possível comprovar | O que NÃO comprova |
| --- | --- | --- |
| Fixture local `tests/fixtures/homeworks-stage5-visual/index.html` | DOM real, foco, rótulos, contador, status visual, viewport e leitura assistiva da simulação | Login, permissões produtivas, salvamento em banco, erro de rede, idempotência real ou experiência PWA de produção |
| GitHub Actions `Homeworks Stage 5 browser visual acceptance` | Chrome headless em 320, 390 e 1280 px, sem rede de dados de alunos; assertivas semânticas objetivas | Qualidade de voz/foco real em TalkBack, NVDA ou VoiceOver |
| Ambiente descartável de homologação com Auth/DB/Edge isolados | Envio e retomada de submissão fictícia, segurança e controle de privacidade | Ambiente de produção, direitos de alunos reais ou cumprimento jurídico |
| Android/PWA e desktop reais | Experiência de navegação assistiva, teclado, contraste e anúncio de estados | Prova automática de base legal ou contrato com fornecedores |

Não confundir **simulação de tela corrigida** com nota retornada por serviço real. Não clicar em `Enviar` no fixture esperando gravação: o serviço sintético recusa chamadas deliberadamente.

## B. Preparação sem acesso dos alunos

1. Fazer checkout do commit homologado no repositório; não colocar alunos reais ou tokens em fixtures.
2. Em computador de desenvolvimento, servir os arquivos **apenas localmente** com `python3 -m http.server 8000 --bind 127.0.0.1` a partir da raiz do repositório.
3. No desktop, abrir a lista fictícia em `http://127.0.0.1:8000/tests/fixtures/homeworks-stage5-visual/index.html?activity=writing&state=list` e navegar com **Tab → Abrir atividade → Enter → Voltar às atividades → Enter**; conferir se o foco entra no título correto em cada mudança.
4. Para Android conectado por USB com depuração previamente autorizada, usar `adb reverse tcp:8000 tcp:8000` e, no Chrome Android, abrir `http://localhost:8000/tests/fixtures/homeworks-stage5-visual/index.html?activity=writing&state=initial`. O espelhamento de porta local evita publicar a bancada de testes na Internet.
5. Para estados demonstrativos, utilizar `state=initial`, `submitted`, `privacy_review` ou `evaluated`; testar também `activity=reading` e `activity=grammar`. Em Reading/Grammar, o leitor deve anunciar **o texto integral da pergunta**, não apenas 'Questão 1'.
6. Não usar o endereço de produção do módulo como substituto: a liberação de estudantes deve continuar desligada. PWA e falhas de rede com backend exigem estágio protegido separado.

## B.1. Bancada autossuficiente para Android e desktop, sem servidor

Para diminuir a dependência de um computador na primeira rodada de testes físicos, foi criada uma **cópia independente da interface real** em `tests/fixtures/homeworks-stage5-physical/offline.html`. Os módulos versionados de interface e estilo são incorporados ao mesmo arquivo, com dados inventados. O serviço é **simulado**, rejeita submissões e não acessa Supabase, OpenAI, Analytics nem qualquer outra API.

1. Baixar o arquivo **RAW** com extensão `.html` no GitHub (não abrir a visualização de código, que não executa scripts). Caminho no repositório: `tests/fixtures/homeworks-stage5-physical/offline.html`.
2. No Android, usar o aplicativo de arquivos para abrir o HTML com Chrome ou um navegador compatível com arquivos locais. Se a versão do Android bloquear abertura local, registrar **BLOQUEADO** e seguir pelo procedimento USB + `adb reverse` da seção B; não publicar a bancada para contornar a restrição.
3. No próprio arquivo, escolher **Tipo de atividade** e **Situação fictícia**, tocar em **Abrir cenário**, habilitar TalkBack nas configurações de acessibilidade e percorrer os títulos, perguntas e controles. Para testar o retorno à lista, escolher `Lista de atividades`.
4. Preencher os resultados observados (Aprovado/Falhou/Não executado) e tocar em **Gerar relatório de texto**. O relatório é gerado localmente, sem envio automático. Não introduzir nomes, e-mails ou redações reais.
5. Repetir no Windows com NVDA/teclado caso haja dispositivo compatível. O funcionamento do navegador na bancada é **evidência física parcial**, não aprovação da versão autenticada nem da LGPD.

**Garantias técnicas da bancada:** CSP com `connect-src 'none'` e `default-src 'none'`, ausência de recursos externos, `noindex` e exclusão do diretório `tests` do build público. O CI valida que o arquivo corresponde exatamente aos módulos versionados e roda cenários sintéticos em Chrome; **não avalia a voz de TalkBack/NVDA**.

**SEO:** o arquivo está fora da publicação do site, não altera `/privacidade/`, canonical, sitemap, indexação ou links públicos. Qualquer exposição desse arquivo como rota pública exigirá aprovação separada.

## C. Casos de teste e critérios de aceite

Registrar **APROVADO / REPROVADO / BLOQUEADO**, nunca preencher antecipadamente como aprovado.

| ID | Ambiente | Passos | Critério objetivo | Estado inicial |
| --- | --- | --- | --- | --- |
| A11Y-01 | Android TalkBack | Abrir Writing fictício; explorar por títulos e controles | Ordem lógica, título anunciado, textarea como "Sua produção escrita em inglês", sem rótulo vazio | PENDENTE |
| A11Y-02 | Android TalkBack | Focar textarea e ouvir sua descrição; digitar 25 caracteres | Contador associado e consultável; não anunciar contagem a cada tecla, não perder foco | PENDENTE |
| A11Y-03 | Android TalkBack | Abrir Writing em `state=submitted` | Informação de correção pendente compreensível, sem nota inventada | PENDENTE |
| A11Y-04 | Android TalkBack | Abrir Writing em `state=evaluated` | Nota, comentário e retorno à lista identificáveis; navegação sem armadilha | PENDENTE |
| A11Y-05 | Android Chrome | Simular largura reduzida, teclado aberto, rolagem, rotacionar aparelho | Nenhum campo cortado, controle acionável, rolagem previsível, sem sobreposição | PENDENTE |
| A11Y-06 | Windows NVDA + Firefox/Chrome | Tab/Shift+Tab, Enter/Espaço, navegação por títulos em Reading/Grammar | Foco visível, nome de botões; cada controle anuncia **o enunciado integral** via `aria-labelledby` da `legend` correspondente | PENDENTE |
| A11Y-07 | macOS VoiceOver + Safari (se disponível) | Repetir Writing inicial/submetido/corrigido | Nome, papel e estado do foco, status/nota e conteúdo acessíveis | PENDENTE |
| A11Y-08 | Desktop somente teclado | Abrir `state=list`; pressionar Tab, Enter em 'Abrir atividade', Tab até 'Voltar às atividades' e Enter | Foco no título a cada navegação; nenhum controle depende de mouse, Enter/Espaço funcionais | PENDENTE |
| A11Y-09 | Desktop navegador | Examinar zoom 200% e largura equivalente a 320px | Sem rolagem horizontal obrigatória, informação e ações preservadas | PENDENTE |
| INT-01 | Stage protegido com Auth/DB/Edge descartáveis | Salvar Writing fictício com verificação etária ausente | Texto persiste, `privacy_review`, nota nula, zero requisições OpenAI | PENDENTE — fixture visual NÃO basta |
| INT-02 | Stage protegido com Auth/DB/Edge descartáveis | Simular queda de rede após envio e repetir mesma chave | Uma única tentativa persistida; recuperar resultado sem duplicidade | PENDENTE — fixture visual NÃO basta |
| INT-03 | Stage protegido | Enviar Reading/Grammar fictícios | Corrigir por gabarito sem provedor externo, inclusive com menor fictício | PENDENTE — fixture visual NÃO basta |
| INT-04 | Stage protegido | Verificar tela, foco e status do sistema após falha de rede | Erro compreensível, contexto/teclado preservados e recuperação possível | PENDENTE — fixture visual NÃO basta |
| SEC-01 | Produção (somente leitura) | Ler controle global e volumes agregados, sem dados pessoais | Flag permanece `false`; nenhuma permissão nova ao estudante | PENDENTE para conferência final |

**Observação:** o trabalho em banco e os testes HTTP isolados anteriores cobrem cenários técnicos de segurança, mas **não substituem** a evidência física exigida nesta matriz.


### Estado da evidência após reforço automático (17/10/2026)

A bancada agora permite a navegação a partir da lista fictícia (`state=list`), além dos estados `initial`, `submitted`, `privacy_review` e `evaluated`. Os testes de código conferem vínculo `aria-labelledby` aos enunciados, `role=status` e retorno do foco ao título. Isso **não é comprovação de anúncio de voz real**. A coluna de testes físicos permanece `PENDENTE`, independentemente do resultado do GitHub Actions. O `state=list` é simulado e não consulta o banco de produção.

**Quando encerrar os testes físicos:** registrar dispositivo, leitor, resultado e evidência não identificadora na matriz acima; se houver defeito, abrir PR de reparo e repetir o caso. A confirmação de acessibilidade física e a análise jurídica exigem decisões independentes do controlador.

## D. Modelo de registro de evidência (sem PII)

Para cada caso: `ID: ____ | Data: ____ | Dispositivo/SO: ____ | Browser: ____ | Leitor/versão: ____ | Resultado: APROVADO / REPROVADO / BLOQUEADO | Observado: ____ | Defeito/PR: ____ | Revisado por: ____`

- Guardar capturas **somente da atividade sintética**, sem conta, rosto, e-mail, token ou texto real.
- Em defeitos, registrar passo de reprodução, resultado esperado e observado.
- Reexecutar os casos afetados depois de correções e de novo merge.
- Não afirmar WCAG 2.2 AA plenamente certificada só porque checks DOM passaram.

## E. Resultado exigido para fechar o gate físico

- [ ] Android físico com TalkBack: A11Y-01 a A11Y-05.
- [ ] Desktop com teclado e NVDA: A11Y-06, A11Y-08 e A11Y-09.
- [ ] VoiceOver caso dispositivo compatível disponível, ou registrar formalmente a limitação de cobertura.
- [ ] Ambiente protegido com backend descartável: INT-01 a INT-04.
- [ ] Nenhum defeito crítico de privacidade, foco, perda de conteúdo ou duplicidade em aberto.
- [ ] Resultado da revisão jurídica separado da revisão funcional.
- [ ] Assinatura explícita do professor no relatório de aceite físico.
- [ ] Solicitação **posterior** e separada de autorização para liberar o módulo.

**SEO:** exclusivamente documentação interna e automação de qualidade; nenhuma URL pública, conteúdo indexável, metadado ou `robots` alterado.
