# Comandos da Secretaria Acadêmica

A primeira versão do interpretador de comandos entende um conjunto explícito de solicitações em português: consultar vínculos, consultar vagas, listar turmas com vagas, preparar vínculo, transferência, arquivamento e desarquivamento.

A interpretação não equivale à execução. Toda consulta requer autenticação administrativa; vínculos e transferências são apenas prévias. Arquivamentos continuam exigindo confirmação explícita pelo fluxo já existente.

Para um vínculo novo, a origem do aluno e a data da primeira aula são campos obrigatórios. Nas transferências, esses campos não devem ser solicitados novamente. Identidades duplicadas não podem ser escolhidas automaticamente.

O interpretador é determinístico, sem credenciais e sem chamada a serviços de linguagem. Comandos ambíguos ou desconhecidos devem ser recusados, sem alterações no banco. A interface é restrita ao professor e não deve alterar a indexação de páginas públicas.
