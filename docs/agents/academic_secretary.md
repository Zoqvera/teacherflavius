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
