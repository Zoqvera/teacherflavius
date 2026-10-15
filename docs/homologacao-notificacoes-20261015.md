# Homologação de notificações e reposições — 15/10/2026


## Atualização após a homologação externa de 15/10/2026

Esta seção atualiza o quadro de pendências registrado na análise inicial,
sem modificar nem reescrever suas evidências históricas.

- Foi criada a branch isolada `homologacao-notificacoes-20261015`, sem
  cópia dos dados dos alunos. O esquema foi reconstituído, as notificações
  foram restringidas aos endereços previamente autorizados, e a branch foi
  **excluída**, com exclusão confirmada no Supabase.
- O usuário confirmou a **revogação** da chave Resend temporária, sem
  comprovação independente da API Resend.
- Os testes com Resend real comprovaram a recepção de **9 mensagens** nas
  caixas autorizadas: 8 originadas da fila da aplicação e 1 teste adicional
  de transporte. Incluíram confirmações e cancelamentos das modalidades
  INDIVIDUAL e QUINTETO; os avisos do professor não continham .ics.
- Na modalidade INDIVIDUAL, o professor recebeu apenas o link de
  **criação manual** do Google Agenda. Na modalidade QUINTETO, não recebeu
  link de calendário. O cancelamento individual instrui a remoção manual
  do evento, caso tenha sido salvo.
- A PR [#689](https://github.com/Zoqvera/teacherflavius/pull/689)
  adicionou testes de integração SQL em PostgreSQL descartável e testes
  simulados da função de cancelamento regular, com **19/19 verificações
  aprovadas** antes do merge. As RPCs reais retornaram crédito
  `available` com antecedência suficiente e `forfeited` em cancelamento
  tardio; também foi validada a geração de duas notificações por
  cancelamento elegível.
- A recuperação simulada de falha HTTP 502 usa a mesma chave de
  idempotência e não duplica envios. Isso **não comprova** a recuperação
  durante uma indisponibilidade real do serviço Resend.
- Consulta read-only à conta Google Agenda conectada
  `handinhandengl@gmail.com`, restrita a 22 e 23/10/2026, não
  encontrou eventos com os identificadores dos testes. Essa conta não
  é a agenda do professor, portanto a verificação não é evidência
  conclusiva do comportamento visual da conta dele.
- Os testes automatizados adicionais conferem o link
  `calendar.google.com/calendar/r/eventedit?action=TEMPLATE`,
  os instantes UTC, o fuso `America/Sao_Paulo`, o destino e a ausência
  de convite do professor. O fluxo não faz requisições de escrita ao
  Google Calendar.

**Pendências de validação externa:** observar na conta Google do
professor a prévia do evento sem salvá-lo; e reproduzir uma falha real
do provedor seguida do reenvio por cron em ambiente isolado
estritamente controlado. Não introduzir falhas ou mensagens fictícias
no ambiente de produção apenas para satisfazer esses cenários.

A [issue #680](https://github.com/Zoqvera/teacherflavius/issues/680)
permanece como trilha de auditoria atualizada.

**SEO:** a homologação e estes testes não alteram páginas públicas,
metadados, indexação, sitemap nem `robots.txt`.



## Escopo, isolamento e método

- Auditoria SQL **somente leitura** em produção, com resultados agregados.
- Inspeção dos arquivos da branch `main` e das Edge Functions implantadas.
- Execução simulada da **função real** `notify-makeup-booking` em Node.js,
  com a dependência Supabase interceptada em memória e o Resend substituído
  por um transporte que nunca estabelece conexão externa.
- Sem gravar dados de produção, consumir créditos, efetuar matrículas,
  disparar e-mails reais ou acessar a agenda Google do professor.
- Os testes simulados estão em
  `tests/notification_delivery_e2e_mock.test.js` e são incluídos em
  `npm run test:node` pela validação Clean Code.

## Evidências de produção em 15/10/2026, 04h51 UTC

| Indicador | Matrículas | Reposições | Cancelamentos regulares |
| --- | ---: | ---: | ---: |
| Registros com `status=sent` | 120 | 86 | 0 |
| Pendentes ou falhas | 0 | 0 | 0 |
| Aceitos sem `sent_at` | 0 | 0 | 0 |
| Aceitos sem tentativa registrada | 0 | 0 | 0 |
| Acima de três tentativas | 0 | 0 | 0 |
| Falhas fora da janela de 18h | 0 | 0 | 0 |

O cron `transactional-email-retry-10m` estava ativo e registrou
**4 execuções concluídas com sucesso, 0 falhas**, às 04h20, 04h30,
04h40 e 04h50 UTC. Isso demonstra a execução do agendador, mas **não**
comprova reenvio efetivo porque as filas estavam vazias de pendências.

Também foram observadas 73 reservas com confirmação estudantil e
13 avisos de cancelamento de reposição; não havia avisos históricos
`teacher_booking` ou `teacher_cancellation` nas filas. Havia 73
reservas de reposição na tabela, sendo **3 de perfis INDIVIDUAL e 70
de QUINTETO**. Nenhuma notificação tinha reserva órfã.

A permissão de execução da função interna
`private.retry_transactional_email_notifications` foi negada aos
papéis `anon` e `authenticated`.

## Cenários simulados

Os testes de integração sem efeitos colaterais validam:

1. **INDIVIDUAL**, confirmação: e-mail do professor contendo um
   link de Google Agenda que exige salvamento manual e sem anexo .ics.
2. **QUINTETO**, confirmação: e-mail ao professor com nome, turma e
   horário, mas sem botão de calendário ou .ics.
3. Classificação vazia, desconhecida, ou com variação de letras/espaços.
4. Cancelamento do individual: aviso de remoção manual quando aplicável.
5. Cancelamento do quinteto: aviso sem presumir evento de calendário.
6. Confirmação do aluno: link estudantil e anexo .ics UTF-8.
7. Cancelamento do aluno: sem anexo de convite.
8. Requisições não autorizadas e payloads inadequados.
9. Perfil ausente: falha segura, sem disparo externo.
10. Webhooks simultâneos/repetidos: apenas um envio simulado.
11. Rejeição do Resend seguida de recuperação: mesma chave e mensagem.
12. Reenvio após 18 horas: bloqueado para reconciliação administrativa.

## O que ainda não está homologado por observação real

A etapa não deve ser considerada **homologação de entrega externa
concluída** enquanto faltarem:

- Mensagens reais originadas de uma conta de teste isolada e recebidas
  em caixa de teste autorizada, para os dois perfis de turma.
- Evidência de entrega/rejeição recebida diretamente do Resend.
  O campo `sent` representa aceite do provedor, não entrega ao destinatário.
- Teste de um cancelamento regular com e sem crédito em ambiente
  descartável, validando gatilhos, RLS e a mensagem ao destinatário.
- Evidência de uma falha de provedor seguida de reenvio pelo cron
  usando fila fictícia em banco de testes (não em produção).
- Verificação visual do botão no e-mail recebido pelo professor
  e confirmação de que o Google Agenda permanece inalterado antes
  do salvamento manual.

**Não criar matrículas de teste no banco produtivo nem disparar
notificações artificiais para alunos reais.** O Supabase Branching
ainda precisa de ambiente descartável com histórico de migrações
reconstruído e validado antes de ser usado para esse ensaio.

## Interpretação dos resultados

O resultado dos testes simulados confirma o comportamento da função
de e-mail sob entradas representativas. Os controles não substituem
uma homologação completa com Supabase Auth, gatilhos SQL, entrega do
Resend e clientes de e-mail reais. Não declarar o projeto totalmente
homologado enquanto esses pontos estiverem abertos.

## Critérios de aceite

- Todos os testes simulados passam nos checks obrigatórios do GitHub.
- Nenhuma mudança em matrícula, mensalidade, crédito ou agenda real.
- Nenhum e-mail administrativo contém arquivo .ics.
- Somente alunos classificados como INDIVIDUAL oferecem ação manual
  de calendário ao professor.
- Nenhum fluxo realiza escrita na API Google Calendar.
- Falhas de transporte não produzem envio duplicado nos testes.
- Casos sem classificação ou fora da janela de idempotência falham
  de maneira controlada.
- Auditoria de produção preserva a privacidade dos alunos.
- Bloqueios de homologação externa permanecem documentados.

**SEO:** este documento e os testes não modificam páginas indexáveis,
metadados, `robots.txt`, sitemap ou rotas públicas.
