# CSP: primeira etapa de bloqueio no navegador — 10/11/2026

## Contexto verificado

O domínio `teacherflavius.com` opera por trás da Cloudflare e utiliza GitHub Pages para publicar os arquivos HTML. A execução de `Security baseline` de 10/11/2026 (GitHub Actions, commit `cb07cc913c5dcc7e769eb44f192148cc6b6b1e43`) confirmou que o HTTP da página inicial entrega `Content-Security-Policy-Report-Only`, não `Content-Security-Policy`.

O arquivo `hosting/_headers` registra a política de monitoramento; ele não é, isoladamente, garantia de que GitHub Pages aplique cabeçalhos personalizados. Não pressupor que editar esse arquivo ative uma política no domínio.

## Etapa 1 aplicada: proteções compatíveis

Inserido no início de `<head>`, antes de qualquer `<script>`, o seguinte elemento em onze telas sem eventos inline no HTML:

```html
<meta http-equiv="Content-Security-Policy" content="object-src 'none'; base-uri 'self'; script-src-attr 'none'">
```

Em quatro páginas com histórico de eventos inline e carregadores de conteúdo, aplica-se apenas:

```html
<meta http-equiv="Content-Security-Policy" content="object-src 'none'; base-uri 'self'">
```

O navegador recebe uma política real de **bloqueio** para essas diretivas, independente da CSP exclusivamente de monitoramento enviada por HTTP. A diretiva `object-src 'none'` bloqueia conteúdo de plugins `object` e `embed`; `base-uri 'self'` limita o elemento `base`; `script-src-attr 'none'` bloqueia atributos de eventos executáveis em HTML nas telas auditadas.

## Limites e política de terceiros

Esta etapa **não** implementa ainda `script-src` restritivo: scripts inline `<script>` e a execução dinâmica por `eval` ainda não são proibidos por estas meta-policies. Não anunciar proteção completa contra XSS. Isso requer inventário e migração de scripts, hashes estáticos ou infraestrutura para nonces por resposta; atenção ao Google Tag Manager, bibliotecas de autenticação, Analytics, integrações de pagamento e eventuais rastreadores de campanhas.

`frame-ancestors` e relatórios de violação não funcionam em meta CSP: essas regras dependem do cabeçalho HTTP. O cabeçalho em produção já dispõe de `X-Frame-Options: SAMEORIGIN` e permanece separado da implantação da CSP de bloqueio.

## Compatibilidade

Foi verificado que as onze páginas com `script-src-attr 'none'` não contêm atributos HTML explícitos de evento como `onclick`, `onload` ou `onsubmit`. As quatro páginas legadas mantêm eventos existentes. O teste automático `tests/csp_enforced_meta_contract.test.js` verifica a política, o posicionamento antes dos scripts, os atributos HTML e a preservação da política de monitoramento.

O registro de eventos em JavaScript por `addEventListener` e pela atribuição de propriedades em objetos não é afetado por `script-src-attr`.

## Homologação e reversão

Verificar autenticação Google, completar cadastro, matrícula promoção R$ 80, painel do professor, perfil, mensalidades e redirecionamento de pagamento com contas de teste. Validar no navegador a presença de `<meta http-equiv="Content-Security-Policy">` no HTML publicado e ausência de erros de CSP bloqueando ações legítimas.

Reversão: remover as meta tags introduzidas nesta etapa mediante PR, sem alterar o monitoramento CSP atual nem o banco.

## SEO

Mudança de segurança no `<head>` de páginas públicas e administrativas. Não foram modificados títulos, descrições, canonicals, `robots`, sitemap nem conteúdo indexável. `object-src` e `base-uri` podem afetar recursos de incorporação ou bases de URLs em páginas não auditadas; por isso o rollout foi limitado. A auditoria técnica de SEO e o build são bloqueios de CI antes do merge.

## Próxima etapa

Implementar `script-src` restritivo por rota após catalogar todos os scripts inline, integrações e necessidades reais de `eval`. Na hospedagem estática, preferir mover scripts inline para arquivos separados ou hashes SHA-256 estáticos; adotar CSP de cabeçalho HTTP na borda apenas quando o mecanismo de publicação e testes estiverem disponíveis, e manter `Report-Only` para a política futura em paralelo.
