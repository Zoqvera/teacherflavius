# Diagnóstico das falhas intermitentes de arquivos internos — 04/11/2026

## Evidências

O Supabase registrou 26 eventos de carregamento de scripts/CSS do mesmo domínio nas 24 horas anteriores a 00h47 (America/Sao_Paulo). Nenhum ocorreu na última hora. Em múltiplos incidentes, entre cinco e oito arquivos diferentes falharam na mesma página, com timestamps separados por menos de um segundo.

Os quatro probes sintéticos já existentes (home, health, login e acesso do aluno) não tiveram falhas em três dias de verificações. Eles **não verificam individualmente os arquivos estáticos**, portanto não descartam indisponibilidade localizada. Os eventos de recurso existentes têm `http_status = null`; não se pode confirmar 404, 500, falha DNS, interrupção do cliente ou bloqueio do navegador.

O service worker atual só intercepta recursos de instalação (ícones) e não armazena scripts/CSS. Não houve indicação suficiente para mexer no seu cache.

## Melhoria não invasiva

Em erros de `<script>` e `<link>`, o monitor de navegador passa a tentar ler o código HTTP da entrada de **Resource Timing** já capturada pelo navegador. A consulta não dispara novas requisições; só consulta `performance.getEntriesByName` para arquivos da mesma origem, usando a última entrada da URL exata.

Quando disponível, grava `http_status` e `metadata.phase = "resource_http_status"`. Quando não há entrada, API ou status utilizável, preserva a falha como `resource_load_error` e mantém o status `null`.

- Não inclui query string nem fragmento nos dados enviados.
- Não infere HTTP status de recursos externos, mesmo quando houver uma entrada de performance.
- Não ignora erros existentes nem modifica os limiares de alerta.
- Mantém o limite de envio e a deduplicação já implementados.
- Mantém a compatibilidade com browsers sem `PerformanceResourceTiming.responseStatus`.
- A versão do script foi incrementada em rotas geradas e na página de instalação para evitar uso da cópia anterior em cache.

## Próxima avaliação

Após novos eventos, comparar `http_status`, `metadata.phase`, URL de recurso e janela temporal. Status 404 indica investigar build/manifest, 5xx indica investigar entrega no provedor e status 200 com `error` indica investigar MIME/política de segurança. Status nulo requer dados adicionais de rede/usuário antes de concluir causa.

## SEO

Somente o parâmetro de versão do script de monitoramento no HTML foi atualizado. **Não foram modificados URLs canônicos, títulos, descrições, `robots.txt`, sitemap ou conteúdo público**. A página de instalação mantém `noindex`.
