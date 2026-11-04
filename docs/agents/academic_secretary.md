# Agente de Secretaria Acadêmica — fase inicial

## Situação

Entrega inicial: planejador supervisionado **somente leitura**.
O módulo agents/academic_secretary.js não acessa Supabase diretamente,
não recebe credenciais e não executa alterações de turmas, aulas ou pagamentos.
Ele ainda não é um serviço ativo em produção nem uma integração automática
ao ChatGPT.

## Contrato de integração

A aplicação que chamar o planejador deve injetar três funções confiáveis:

- isTeacherAuthorized(): verifica autenticação e autorização administrativa no backend.
- getStudentSnapshot(studentId): retorna id, archived e classNumbers.
- getClassSnapshot(classNumber): retorna number e availableSeats.

A autorização não pode ser inferida de parâmetros enviados pelo usuário ou
por um modelo. As consultas devem usar os mecanismos oficiais de segurança,
com dados atuais e sem expor tabelas privadas diretamente.

A função createAcademicSecretaryAgent devolve o método assíncrono plan.
As ações admitidas são inspect_student, new_link, transfer, archive e unarchive.
O resultado indica ready_for_review, needs_input ou blocked, além de passos,
dados obrigatórios, impedimentos e a propriedade readOnly=true.

**ready_for_review não significa autorização para gravar dados.**
Indica apenas que os dados analisados permitem submeter um plano à revisão.

## Regras de negócio cobertas

1. Novo vínculo: requer declaração da origem e data da primeira aula, salvo quando
   já vierem expressamente fornecidas na solicitação. Fonte other exige detalhe.
2. Transferência: nunca repete a pergunta da origem ou da primeira aula.
   Exige identificação inequívoca do vínculo a substituir e preservação dos demais.
3. Não criar terceiro vínculo, duplicar vínculo, incluir aluno arquivado ou
   aceitar turma sem disponibilidade verificada.
4. Arquivamento: o fluxo oficial deve desvincular de todas as turmas e pausar
   a cobrança futura, preservando histórico.
5. Desarquivamento: a cobrança futura deve voltar, sem criar matrícula de turma
   automaticamente.
6. Em todas as gravações futuras, o backend deve revalidar capacidade e permissões
   dentro de operação confiável para impedir conflitos concorrentes.

## Serviços existentes a aproveitar

Consultas administrativas: get_teacher_students,
get_teacher_classes_with_type, get_teacher_class_students e
get_teacher_student_acquisitions.

Origem declarada: set_teacher_student_acquisition. O registro é armazenado
no esquema privado com histórico de alterações, por meio da lógica existente.

Arquivamento: archive_teacher_student e unarchive_teacher_student.

Vínculos: aproveitar RPCs de matrícula existentes e a coluna
first_lesson_date de public.class_students; não contornar seus controles.

Créditos: respeitar docs/lesson_credit_integrity.md, especialmente a distinção
entre revogação, cancelamento, consumo e exceções históricas.

## Bloqueios antes da ativação de gravações

É necessário identificar ou implementar uma transação segura para alterar
o vínculo de turma e ajustar os créditos da mesma operação. Não executar
remoção e adição separadas sem garantias transacionais ou compensação segura.

Novo vínculo também exige persistência consistente de origem e primeira
aula, sem deixar aluno parcialmente matriculado após erro intermediário.

A próxima etapa é ligar adaptadores de leitura autenticados, validar com
dados sintéticos, assegurar trilha de auditoria e só então habilitar
gravações por operações oficiais.

## Testes e impacto

Teste específico: node --test tests/academic_secretary_agent.test.js.
A suíte npm run test:node descobre o novo teste automaticamente.

Não há alterações de frontend, SEO, indexação, banco, RLS ou cobranças nesta etapa.
Nenhum aluno real foi matriculado, transferido, arquivado ou desarquivado.


## Etapa 3 — Adaptador de consultas autenticadas ao Supabase

O arquivo agents/academic_secretary_supabase.js expõe a fábrica
createAcademicSecretarySupabaseService(client). O cliente Supabase recebido
deve representar o professor autenticado; não há credenciais embutidas,
service_role, consultas administrativas sem autenticação nem gravações.

Consultas implementadas:

- auth.getUser() verifica a sessão do usuário.
- rpc(is_teacher_admin) confere autorização administrativa no banco.
- profiles consulta somente id e archived, com RLS.
- class_students consulta apenas class_number dos vínculos do aluno, com RLS.
- teacher_classes consulta class_number, class_type e is_active, com RLS.
- rpc(get_public_class_seat_availability) retorna vagas de turmas quinteto
  incluindo convites e reservas temporárias ativas, conforme função do banco.

Esta primeira integração de vagas aceita somente turmas regulares com
class_type quintet e disponibilidade publicada. Individual e experimental
ficam bloqueadas até haver cálculo completo e igualmente confiável.
Consultas ao aluno, arquivamento e desarquivamento podem ser planejados
sem alteração de dados, desde que autorizados.

O adaptador é um módulo CommonJS, não é ainda endpoint publicado,
nem está integrado à interface do site. O código usa os contratos reais
da aplicação; os testes automatizados trabalham com respostas simuladas.
Ainda será preciso homologar a sessão autenticada ponta a ponta.

Os planos retornados têm readOnly=true, mesmo quando status indica
ready_for_review. A disponibilidade é momentânea: toda gravação futura
exigirá nova verificação transacional do banco.

### Testes de segurança

- node --test tests/academic_secretary_supabase.test.js
- npm run test:node inclui automaticamente este conjunto.
- Erros de sessão, autorização, RLS, consulta, capacidade ou inconsistência
  resultam em bloqueio ou erro explícito.
- O módulo não lê nem devolve CPF, WhatsApp ou e-mail de aluno.
- Nenhuma nova credencial, tabela, política RLS ou mudança SEO foi criada.

### Próxima etapa

Integrar em runtime protegido, homologar o acesso com sessão administrativa
real e só depois projetar operações de escrita transacionais auditáveis.


## Etapa 4 — Painel supervisionado na Área do Professor

Rota administrativa: /agente-secretaria/

Acessível pelo novo card AGENTE DE SECRETARIA na Área do Professor.
A página fica oculta até a verificação de sessão pelo Auth.requireAuth
e a conferência de administrador pelo Auth.isTeacherAdmin. As consultas
revalidam a autorização administrativa no Supabase.

Operações apresentadas:

1. Buscar um aluno por parte do nome, com RLS e limite de 20 resultados.
2. Consultar os vínculos e o estado de arquivamento do aluno.
3. Preparar vínculo novo (origem declarada e primeira aula obrigatórias).
4. Preparar transferência sem repetir origem nem primeira aula.
5. Preparar arquivamento ou desarquivamento.
6. Exibir impedimentos, campos faltantes e passos planejados.

Os arquivos do planejador e do adaptador têm compatibilidade com CommonJS
(Node e testes) e com os globais de navegador usados exclusivamente na página.
A interface usa as funções já existentes no Supabase com a sessão autenticada
do professor, sem adicionar credenciais nem endpoints privilegiados.

### Segurança e limites da ativação

- O painel não apresenta botão de execução. Todas as prévias são readOnly.
- Não existe função de gravação no código novo. Turmas e cobranças não são alteradas.
- A busca retorna apenas identificação acadêmica mínima (id, nome, estado).
- Páginas abertas sem autorização não mostram o espaço de consulta.
- Nenhuma sessão do professor foi automatizada externamente nesta etapa.
  Após a publicação, a homologação completa requer acessar a página
  autenticado como professor e tentar os cenários permitidos e negados.
- Turmas individuais e experimentais não passam por planejamento de vagas
  nesta versão: a RPC de vagas cobre grupos regulares quinteto.

### SEO

A rota administrativa nova tem a meta diretiva noindex,nofollow, como outras
páginas privadas da plataforma. Não houve alteração do robots.txt, sitemap
nem do conteúdo de páginas públicas. Essa é uma decisão de indexação
específica para a nova rota administrativa.

### Próxima etapa

Homologar a experiência de acesso em produção, testar as consultas com
sessão administrativa real e então projetar operações de alteração
transacionais, com verificação de autorização e auditoria.


## Etapa 5 — Arquivamento supervisionado, primeira operação real

Após a homologação de consultas e prévias, a ação **archive** foi habilitada
na rota `/agente-secretaria/` exclusivamente por confirmação do professor.

Fluxo:

1. Seleção de aluno e prévia do arquivamento no serviço acadêmico.
2. Exibição do impacto: desvinculação de todas as turmas e suspensão das
   próximas mensalidades configuradas, preservando histórico.
3. Confirmação por checkbox e segunda confirmação nativa explícita.
4. Novo teste de autorização e conferência dos vínculos atuais versus os
   registrados na prévia. Mudanças bloqueiam a execução.
5. Leitura das configurações de cobrança. Erros de consulta bloqueiam.
6. **Uma única RPC existente**, `archive_teacher_student`, é executada.
   A função e o gatilho `private.apply_archived_student_invariants` realizam
   arquivamento, remoção de vínculos e desativação de cobrança mensal dentro
   da transação PostgreSQL. Não há sequência de escritas pelo navegador.
7. Nova consulta do estado, dos vínculos e da cobrança; a interface só
   confirma sucesso após verificação das três pós-condições.
8. Se houver erro de rede ou de pós-condição, a interface não informa sucesso
   e pede inspeção antes de tentar novamente.

Código de execução: `agents/academic_secretary_archive_executor.js`.
O executor suporta **somente** a ação `archive`. Não permite transferir,
matricular ou desarquivar. A interface não tem outros botões de escrita.
Todos os controles dependem de sessão autenticada e da verificação
`public.is_teacher_admin()` no banco; nenhuma credencial administrativa foi
incluída no código.

**Desarquivamento bloqueado nesta fase:** a função existente
`unarchive_teacher_student` retira `archived`, mas não contém garantia
transacional de reativar as configurações de cobrança mensal. O gatilho
de arquivamento desativa `student_billing_settings.active`.
Portanto, permitir o desarquivamento pelo agente antes de corrigir esse
fluxo violaria a regra de retomada da cobrança.

**Limitação de concorrência:** a conferência da prévia ocorre antes da
RPC e não é um mecanismo de travamento entre essas duas etapas. A RPC
existente e seu gatilho fornecem atomicidade ao arquivamento em si,
mas alterações concorrentes nos vínculos devem ser acompanhadas por
auditoria e pela verificação posterior. Uma futura RPC de orquestração
poderá fazer conferência e mutação na mesma transação.

Validação automatizada:
`node --test tests/academic_secretary_archive_executor.test.js`;
além dos contratos preexistentes e da suíte geral do repositório.

Impacto de SEO: a página administrativa continua com a diretiva
`noindex,nofollow`. Não foram alterados robots.txt, sitemap ou o
conteúdo público. Nenhum dado real de aluno foi alterado na implantação.

### Próxima etapa

Corrigir e homologar a reativação segura de mensalidades no desarquivamento,
preservando isenções permanentes, históricos e estados de cobrança
individuais; depois desenvolver transferências e novos vínculos com
transações e remapeamento dos créditos.


## Etapa 7 — comandos administrativos supervisionados

Foi criado um interpretador **determinístico** de comandos em português,
sem credenciais, chamadas a modelos de linguagem ou autonomia irrestrita.
Ele aceita um conjunto documentado de intenções:

- Consultar turmas de um aluno pelo nome.
- Verificar vagas de uma turma numerada e listar turmas de grupo com vagas.
- Preparar novo vínculo com número de turma, origem e primeira aula.
- Preparar transferência por número de turma. Se houver exatamente um vínculo
  anterior, a origem pode ser inferida; com múltiplos vínculos é solicitada.
- Preparar prévias de arquivamento e desarquivamento.

Os módulos são
`agents/academic_secretary_commands.js` (interpretação sem efeitos colaterais)
e `agents/academic_secretary_command_service.js` (consultas autenticadas).
A busca no Supabase utiliza a sessão do professor, autorização por
`is_teacher_admin`, políticas RLS, limite de resultados e proibição de
selecionar automaticamente identidades ambíguas. Para nomes iguais, o professor
seleciona explicitamente o cadastro; o serviço verifica novamente a escolha.
Turmas são identificadas por número, sem inferir uma turma arbitrária
a partir de horários potencialmente coincidentes.

A página `/agente-secretaria/` ganhou entrada de comando e resultado textual.
Comandos sobre alunos preenchem o formulário de prévia existente. Origem e
primeira aula permanecem obrigatórias para novo vínculo e valores não são
herdados silenciosamente de comandos anteriores. Transferências não pedem esses
dados. A funcionalidade de arquivamento continua exigindo o fluxo de
confirmação explícita e sua RPC oficial; o interpretador sozinho jamais chama
uma RPC de escrita. Desarquivamento, novas matrículas e transferências
continuam sem execução automática pelo agente.

**Limite do reconhecimento:** a linguagem natural aceita segue um vocabulário
restrito de comandos e a identificação da turma por número. Frases fora
do catálogo são recusadas com mensagem explícita; esta entrega não configura
um agente generativo ou uma integração de ferramentas diretamente ao ChatGPT.
Próximas iterações podem incluir reconhecimento supervisionado de horários,
sinônimos e uma interface conversacional mais flexível.

**Testes:** `tests/academic_secretary_commands.test.js`; a suíte geral Node,
os verificadores de sintaxe e o ESLint também incluem os novos arquivos.

**SEO:** apenas a área administrativa já marcada `noindex,nofollow`
foi alterada. Não houve mudanças em páginas públicas, sitemap,
robots.txt ou conteúdo de aquisição.

### Próxima etapa

Homologar o reconhecimento e a seleção de alunos em produção com sessão
administrativa real. Depois implementar as operações transacionais de
transferência e vínculo com a origem registrada, primeira aula e créditos
corretamente remapeados, sob aprovação.


## Etapa 8 — horários e contrato de operações transacionais

### Comandos por dia e horário

O interpretador agora reconhece:

- `Vagas na turma de quinta-feira às 18h?`
- `Vincule Ana à turma de quinta às 18h`
- `Transfira Ana para a turma de terça-feira às 20h`

Os dias da semana são normalizados para a escala ISO (segunda=1, domingo=7),
a mesma utilizada por `public.teacher_classes.class_weekday`. Horários
são convertidos para `HH:MM:SS`, permitindo a busca por
`class_start_time`. A consulta filtra apenas turmas de grupo
`class_type='quintet'` ativas e requer autenticação administrativa.

Se nenhum registro corresponder, o comando é rejeitado. Se houver várias
turmas ativas com o mesmo horário, a interface exige escolha explícita
do número da turma, revalidada na consulta seguinte. Não escolhe
arbitrariamente com base na ordem do banco nem transforma turmas
individuais ou experimentais em turma de grupo.

### Preparação de vínculo e transferência

`agents/academic_secretary_transaction_plan.js` prepara os argumentos
imutáveis da futura RPC `execute_teacher_academic_change`, exigindo
prévia sem pendências, origem e primeira aula nos vínculos novos,
identificação do vínculo de origem nas transferências e um retrato
exato dos vínculos atuais. **Esse módulo não executa RPCs**.

O contrato SQL está em
`docs/agents/academic_class_change_transaction_PROPOSAL.sql`.
**É somente uma proposta, não uma migração ativa.**
Prevê uma única transação PostgreSQL por comando confirmado,
autorização administrativa no servidor, trava de aluno e de vaga,
checagem de reservas, validação de `first_lesson_date`, registro da
origem e preservação de seu histórico, transferência sem reabrir
informações de aquisição e auditoria de autoria.

A transferência proposta remove o vínculo anterior e inclui o novo
dentro de uma única transação. Os gatilhos atuais de
`class_students` tratam a sincronização dos créditos futuros
contratuais elegíveis, preservando créditos já utilizados,
cancelados, reservados ou revogados. O contrato exige que não
restem créditos futuros elegíveis sem classe vinculada; um erro
causa rollback integral.

### Restrições antes de execução real

1. Homologar SQL no banco isolado e rodar testes de concorrência
   com turmas lotadas e vagas reservadas.
2. Validar os gatilhos e a remarcação de créditos com dados
   sintéticos: zero, um e dois vínculos, aulas consumidas,
   reposições, cancelamentos, estornos e isenções.
3. Aplicar a migração validada de maneira rastreável e verificar
   seu efeito sobre RLS, permissões e relatórios de vagas.
4. Somente então disponibilizar o botão de confirmação de
   matrícula/transferência, com revalidação no banco e
   auditoria de pós-condições.
5. Não criar terceiro vínculo, não substituir uma turma sem a
   decisão do professor e nunca solicitar origem ou data da
   primeira aula ao transferir.

**Nenhum dado real foi modificado por esta etapa.** O painel mantém
o arquivamento supervisionado já existente e as prévias das
demais operações. O reconhecedor é determinístico e não representa
integração direta ao ChatGPT.

### SEO

Alterações limitadas à página privada `/agente-secretaria/`,
que permanece `noindex,nofollow`; não foram modificados
conteúdo público, sitemap ou robots.txt.

### Próxima etapa — Etapa 9

Homologar o contrato em banco isolado e ativar execução
transacional supervisionada após testes de concorrência, créditos
e auditoria financeira.
