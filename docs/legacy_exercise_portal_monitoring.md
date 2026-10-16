# Monitoramento da suspensão do Portal de Exercícios

## Objetivo e escopo

Detectar regressões na suspensão do antigo Portal de Exercícios e na descontinuação de Minha Semana na Área do Estudante, sem reativar o serviço ou modificar dados. Tarefas para Casa continua independente.

A apresentação pública do curso deve continuar mencionando o Portal de Exercícios como recurso disponível, conforme decisão explícita do responsável em 15/10/2026.

## Execução automática

- Workflow: .github/workflows/suspended-exercise-portal-monitor.yml.
- Frequência: todos os dias às 08h37, horário de Brasília (11h37 UTC). O GitHub Actions pode atrasar o agendamento.
- Também executa em mudanças relevantes na main, em PRs que alterem arquivos monitorados e manualmente.
- Nos PRs: contratos locais sem consultas à produção.
- Na main, agendamentos e execução manual: contratos locais, páginas públicas via HTTP e controle de acesso anônimo ao catálogo antigo no Supabase.
- O job Verify suspended legacy portal apresenta sucesso/falha no GitHub Actions. Notificações ao responsável dependem de suas configurações no GitHub; nenhum e-mail independente foi implementado.

## Contratos

1. As três páginas antigas exibem o aviso de suspensão e não expõem formulários externos ou chamadas de catálogo.
2. A Área do Estudante e o PWA mantêm a atualização de cache, não exibem link ao portal e preservam a proteção de remoção defensiva.
3. A antiga rota Minha Semana exibe apenas um aviso de descontinuação e retorno à Área do Estudante, sem executar consultas.
4. O service worker só intercepta os recursos de instalação explicitamente permitidos.
5. A apresentação do curso preserva as duas menções autorizadas ao Portal de Exercícios.
6. A chave pública e o papel anônimo não conseguem visualizar os registros da tabela teacher_exercises nem resultados da função get_public_teacher_exercises.

## Limites de cobertura

- O teste anônimo não equivale a autenticar-se como aluno. Auditorias de RLS com sessão autenticada e homologação eventual em dispositivo continuam pertinentes.
- O monitor não acessa o cache de um PWA já instalado em dispositivo real.
- Falhas transitórias de rede ou bloqueios a tráfego automatizado podem produzir alertas sem regressão. Confirme a causa antes de alterar o código.
- Links externos de Google Forms previamente compartilhados não são controlados.
- O monitor não altera SEO, conteúdo comercial, permissões ou disponibilidade dos serviços; atua somente em leitura.

## Em caso de falha

1. Consultar o job no GitHub Actions e identificar qual contrato foi violado.
2. Verificar se houve problema de rede ou regressão funcional.
3. Se houver exposição real, restaurar as proteções e abrir uma PR de correção com testes.
4. Confirmar que o card não reaparece na Área do Estudante ou no PWA, e que a rota Minha Semana apresenta apenas o aviso.
5. Antes de qualquer alteração que afete SEO, solicitar decisão do responsável.
