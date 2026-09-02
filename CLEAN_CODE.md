# Clean Code — TeacherFlavius.com

Este documento define o padrão de manutenção do código do projeto.

## Princípios obrigatórios

1. **Responsabilidade única**: cada função e arquivo deve ter uma função principal clara.
2. **Nomes explícitos**: variáveis, funções e constantes devem explicar intenção, não implementação acidental.
3. **Sem duplicação desnecessária**: regras de negócio repetidas devem ser centralizadas.
4. **Funções pequenas**: preferir funções curtas, coesas e testáveis.
5. **Guard clauses**: retornar cedo quando uma condição invalida o fluxo principal.
6. **Constantes para regras e limites**: evitar números e strings de controle espalhados pelo código.
7. **Separação entre domínio e interface**: regras de negócio não devem depender do DOM quando isso puder ser evitado.
8. **Erros explícitos**: falhas relevantes devem ser tratadas ou propagadas; não devem ser silenciosamente ignoradas.
9. **Estado global mínimo**: novos recursos não devem aumentar dependências em `window` sem necessidade.
10. **Mudanças comportamentais separadas de refatorações**: refatorar primeiro; alterar regra de negócio em PR distinto quando possível.

## JavaScript

- Indentação: 2 espaços.
- `const` por padrão; `let` somente quando houver reatribuição.
- Evitar `var` em código novo.
- Evitar funções extensas com múltiplas responsabilidades.
- Evitar `innerHTML` quando conteúdo puder ser criado de forma segura com DOM APIs.
- Nunca usar `eval`, `new Function` ou `debugger` em produção.
- Valores de retry, timeout, URLs internas recorrentes e nomes de RPC devem ser constantes quando fizerem parte da regra do módulo.

## Organização desejada

A evolução do projeto deve caminhar para módulos por responsabilidade, por exemplo:

```text
js/
  core/
  auth/
  students/
  activities/
  payments/
  analytics/
  ui/
```

A migração será incremental para não quebrar páginas estáticas existentes.

## Critério de conclusão de uma refatoração

Uma refatoração só é considerada concluída quando:

- o comportamento externo permanece igual;
- o JavaScript passa em `npm run quality`;
- nomes e responsabilidades ficam mais claros;
- não é introduzida nova duplicação relevante;
- URLs e contratos públicos usados pelas páginas existentes permanecem compatíveis.

## Prioridades atuais

1. Reduzir responsabilidades de `auth.js`.
2. Centralizar regras de disponibilidade, autenticação e constantes compartilhadas.
3. Separar manipulação de DOM de acesso ao Supabase.
4. Expandir ESLint gradualmente para todos os arquivos JavaScript.
5. Adicionar testes para regras puras de negócio à medida que forem extraídas.
