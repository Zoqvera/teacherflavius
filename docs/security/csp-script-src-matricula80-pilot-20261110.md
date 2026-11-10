# Piloto de CSP restritiva na matrícula R$ 80

Data: 10/11/2026.

## Escopo

A rota /matricula80/ passa a impor a diretiva script-src sem unsafe-inline ou unsafe-eval. As demais rotas e o cabeçalho HTTP report-only permanecem inalterados. Permanecem object-src none, base-uri self e script-src-attr none.

Dois scripts inline imutáveis injetados pela materialização do Google Consent Mode e Google Tag Manager são permitidos apenas por hashes SHA-256 dos seus conteúdos exatos. Mudanças nos snippets precisam atualizar os hashes e os testes.

## Inventário e métricas

- O HTML fonte da matrícula não tem scripts inline, mas o materializador injeta dois blocos JavaScript.
- A ordem de injeção foi corrigida para executar Consent Mode e GTM depois da meta CSP.
- O Supabase registrou milhares de violações report-only para o script de telemetria Cloudflare e algumas para connect.facebook.net; essas origens foram incluídas na política para reduzir riscos de perda de medição.
- A lista de scripts mantém os domínios HTTPS já autorizados para Supabase CDN, Google, Mercado Pago e OpenAI Pixel. Uma allowlist de hosts não equivale a uma CSP estrita com nonce aleatório.

## Testes

- tests/csp_enforced_meta_contract.test.js: valida política, ausência de unsafe-inline e unsafe-eval, origens e hashes.
- tests/test_google_tag_manager_html.py: confirma SHA-256 dos dois snippets injetados e sua posição depois da CSP.
- scripts/csp_script_pilot_browser_check.py: usa Chromium real em servidor local sintético, sem dados reais, para testar scripts confiáveis e os bloqueios a script inline não autorizado, eval, new Function, atributos onclick e URL data.

Os testes de navegador sintético não substituem uma homologação com contas de teste e integrações GTM/Google/Mercado Pago efetivamente carregadas.

## Verificação após publicação

Conferir em https://teacherflavius.com/matricula80/ o Console e a rede do navegador, com e sem consentimento analítico. Verificar login, comportamento do formulário e navegação para pagamento sem registrar matrícula ou cobrar alunos reais.

O relatório HTTP CSP Report-Only permanece separado desta política. Violações da meta CSP não são encaminhadas automaticamente ao endpoint de relatórios HTTP. Ausência de relatos não significa ausência de bloqueios.

## Reversão

Se scripts legítimos falharem, remover somente a nova diretiva script-src da meta CSP da matrícula mediante PR. Preservar as demais diretivas, o relatório HTTP e os dados financeiros.

## SEO e conversão

A rota permanece noindex,nofollow. Nenhum título, meta description, canonical, sitemap, robots nem conteúdo indexável foi alterado. Contudo, o bloqueio de scripts pode afetar telemetria, conversões e a jornada de matrícula; validar o funil antes de expandir a política.

## Próxima etapa

Migrar scripts inline de login, perfil e painel para arquivos próprios ou hashes versionados; inventariar tags personalizadas do GTM e validar integração real antes de impor script-src nas outras rotas.