# Apresentacoes das licoes — ETAPA 1: banco de dados e seguranca

## Escopo e estado

Esta etapa adiciona apenas a migracao SQL e testes de contrato. Nenhum componente
visual, rota, texto publico ou configuracao de SEO e alterado. A funcionalidade
ainda nao deve ser disponibilizada aos alunos.

A migracao `20261017015000_lesson_presentations_stage1.sql` e incremental:
nao altera tabelas de frequencia, mensalidades ou exercicios.

## Identidade da licao

- Licao tradicional: `lesson_number`, chave `lesson:<numero>`.
- Pagina dinamica vinculada ao roteiro: usar o numero vinculado, com o
  `lesson_page_id` vazio. Assim os diferentes caminhos de navegacao
  identificam a mesma apresentacao.
- Pagina sem numero vinculado: usar `lesson_page_id`, chave `page:<uuid>`.
  Essas paginas so aparecerao no roteiro do professor se forem incluidas
  explicitamente no fluxo de lições da etapa 3.
- A mesma pessoa so possui uma apresentacao atual por chave canonica.
  Cada edicao cria uma versao historica automaticamente.

## Acesso e invariantes

- O aluno autenticado pode inserir, ler e modificar apenas seu texto.
- O professor autorizado por `public.is_teacher_admin()` pode consultar
  os textos e o historico, mas nao editar o trabalho dos alunos.
- O navegador nao pode excluir apresentacoes, alterar identificadores ou
  inventar revisoes, datas e autoria.
- A tabela historica permite somente SELECT para clientes autenticados;
  um trigger interno registra as versoes.
- Exclusao de perfil apaga apresentacoes relacionadas conforme a FK;
  a exclusao de uma pagina ainda referenciada e bloqueada.
- A apresentacao possui limite de 15.000 caracteres nao vazios.

## Contrato de interface aprovado para etapas futuras

- Primeiro envio: **ENVIAR APRESENTAÇÃO**.
- Retorno de sucesso somente apos persistencia: **Apresentação enviada ao professor.**
- Edicao posterior: **EDITAR APRESENTAÇÃO** (nao usar "ATUALIZAR APRESENTAÇÃO").
- Edicoes ilimitadas; versao atual exibida no card do aluno em
  **ROTEIRO DA AULA**, acima de **PERGUNTAS ESTUDADAS**.
- Exibir data e hora no horario de Sao Paulo e um indicador de recebimento.
- Nenhuma correcao de IA nesta funcionalidade inicial.

## Verificacoes para liberar esta etapa

1. Executar `python3 -m unittest tests/test_lesson_presentations_stage1_contract.py`.
2. Conferir o ledger de migrations e o resultado do isolamento antes de
   aplicar SQL em qualquer banco remoto.
3. Em ambiente de teste descartavel, comprovar INSERT/SELECT/UPDATE do
   proprietario, negacao para outro aluno/anonimo, SELECT do professor e
   negacao de edicao para o professor.
4. Verificar duas edicoes consecutivas e tres revisoes historicas com texto
   e timestamps corretos. Testar tambem dois envios concorrentes para a
   mesma licao e rejeicao de metadata forjada.
5. Verificar avisos de seguranca e eventuais diferencas do schema.
6. Nao executar `migration repair`, `db push` ou promover a producao sem
   reconciliacao e comprovacao do ambiente isolado.

**Proxima etapa apos homologacao desta fundacao: ETAPA 2 — Interface do Aluno.**


## Homologacao sintética de 16/10/2026

Uma branch remota temporaria foi criada no Supabase mediante autorizacao do
custo de US$ 0,01344 por hora. O replay historico automatico falhou com
`MIGRATIONS_FAILED`: `public.profiles` e `public.study_lesson_pages`
nao existiam na branch inicialmente. O problema e consistente com as
divergencias do ledger de migrations ja registradas em
`docs/preparacao-supabase-branching.md`.

Para nao manipular o ledger ou os dados produtivos, foi criada **apenas
nessa branch** uma estrutura minima ficticia com `profiles`,
`study_lesson_pages`, `teacher_admins` e `is_teacher_admin()` de teste.
A migracao de apresentacoes foi aplicada com sucesso nessa estrutura.

O teste transacional utilizou tres identidades Auth ficticias e validou:
criacao, normalizacao de texto, versoes 1/2/3, ultima versao, rejeicao de
duplicatas, autoria imutavel, data de criacao controlada pelo servidor,
impedimento de escrita direta no historico, isolamento entre estudantes,
consulta pelo professor e impossibilidade de o professor editar os textos.
Resultado: **PASSED**; a transacao foi revertida, deixando zero usuarios,
apresentacoes e versoes de teste no banco. O aviso de indice ausente na
FK de paginas foi corrigido e revalidado no ambiente de teste.

**Limites:** essa prova utilizou um helper de autorizacao simulado, nao
todas as politicas e funcoes reais do projeto. Ela nao substitui uma
branch remota reconstruida integralmente, nem autoriza cutover do historico
ou execucao da nova migracao em producao. A PR permanece em rascunho,
sem merge, ate a reconstrução integrada passar e a implantacao ser segura.
