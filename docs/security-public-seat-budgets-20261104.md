# Limites de tentativas em reservas e listas de espera (04/11/2026)

## Análise inicial

As APIs `public.create_public_class_seat_hold` (2 sobrecargas) e
`public.join_public_class_seat_waitlist` (2 sobrecargas) são
`SECURITY DEFINER` e aceitam requisições anônimas por desenho.
Reservas já possuíam limite de **três reservas efetivadas por telefone
em 24 horas**, mas a lista de espera não possuía limite de requisições
ao banco. Em 04/11 a produção possuía 12 reservas históricas e seis
inscrições em espera.

O banco já disponibiliza
`public.consume_api_rate_limit(text,integer,integer)` com
grants somente para `service_role`; o armazenamento
`public.api_rate_limit_buckets` tem RLS ativo e não concede DML a
`anon` ou `authenticated`.

## Controle implementado

A migração `20261104024500_throttle_public_class_seat_submission_attempts.sql`
estabelece uma função auxiliar em `private`, de invocador, chamada
**somente** de dentro das quatro funções públicas existentes, que
continuam com `SECURITY DEFINER` e validações anteriores.

| Operação | Tentativas/hora | Tentativas/dia |
| --- | ---: | ---: |
| Reserva temporária | 8 | 18 |
| Lista de espera | 12 | 30 |

As duas sobrecargas de cada operação compartilham o orçamento por
telefone. A identificação do navegador **não** determina a
chave de limitação e não permite contornar o orçamento usando outra
janela. Os identificadores no limitador usam SHA-256 do telefone
normalizado, sem número em claro. Isso reduz exposição casual no
armazenamento, mas hash de telefone não é anonimização criptográfica
resistente à força bruta e deve permanecer inacessível ao navegador.

O limitador usa janela fixa e incremento atômico; tentativas
bloqueadas geram mensagem compreensível. Não alteramos as capacidades
das turmas, a geração e expiração dos tokens, a reserva de 15 minutos,
nem o modelo comercial. Os controles atuais de três **reservas
concluídas** por dia continuam ativos. A operação de cancelamento por
token segue livre, para que o titular possa liberar a vaga.

## Limitações e riscos residuais

- Sem comprovação da titularidade do WhatsApp, alguém pode tentar
  bloquear tentativas usando um número de terceiro. Esse risco já
  existia com reservas e não é solucionado por limitação por número.
- Um robô que altere números continuamente contorna orçamento por
  telefone; **não há rate limit por IP confiável nesta migração**.
  Não confiar diretamente em headers repassados pelo cliente para
  fazer controle por IP dentro de RPCs.
- Um atacante pode esgotar capacidade usando muitos telefones
  diferentes; mitigação completa exige borda de confiança
  (Edge Function com validação de IP, bot challenge/Turnstile
  com verificação servidor e bloqueio do acesso direto às mutações).
- Limitações SQL são transacionais: uma tentativa que falha mais
  tarde na mesma transação faz rollback do contador junto com a
  falha. Consequentemente, os limites controlam principalmente
  chamadas válidas e duplicatas atendidas, não cada requisição
  inválida enviada à API. Não apresentar como proteção DDoS.
- Caso ocorram bloqueios indevidos, verificar os buckets e a
  funcionalidade de captação antes de ajustar limites; não
  desativar RLS nem expor funções técnicas ao browser.

## Liberação e validação

- SQL versionado no repositório; conferir `supabase_migrations`
  antes e depois de qualquer implantação.
- Contrato CI em `tests/public_seat_request_budgets.test.js`.
- Verificar a presença dos limites em quatro RPCs, privilégios e
  propriedades do auxiliar, e ausência de alterações nas mensalidades.
- Inspecionar se disponibilidade e reservas reais continuam
  operacionais; manter monitoramento de erros.
- Não inserir CPF ou leads fictícios na base real para testar.

Não há requisito de MFA administrativo. Não há alteração de URLs,
conteúdo público indexável, metadata, sitemap ou SEO.
