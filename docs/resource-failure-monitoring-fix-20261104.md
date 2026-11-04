# Falhas de recursos — correção seletiva de 04/11/2026

## Diagnóstico

Na janela de 24 horas anterior à análise, foram registrados 50 eventos de falha
de carregamento: 20 do SDK do pixel da OpenAI, 26 de recursos locais do site e
4 de outras origens externas. O alerta `resource_error_burst` da noite de
03/11 tinha 16 eventos em 15 minutos e fingerprint máximo de 8.

Os erros locais aparecem por vezes em rajadas de scripts/CSS diferentes, no
mesmo caminho e em milissegundos próximos. Os eventos não incluem status HTTP;
não há comprovação de arquivos ausentes nem causa-raiz da indisponibilidade
intermitente. Os probes de página inicial, login, área do aluno e health
retornaram 200 no início de 04/11.

## Tratamento

- Preservar integralmente `public.app_error_events`.
- Contabilizar a URL exata `https://bzrcdn.openai.com/sdk/oaiq.min.js`
  na métrica diagnóstica `optional_openai_pixel_errors_15m`.
- Excluí-la **somente** dos dois limiares acionáveis de rajada
  (`resource_errors_15m` e fingerprint genérico), sem ampliar a exclusão
  para outros scripts, endpoints ou falhas críticas.
- Manter o pixel e sua coleta de marketing inalterados.
- Exibir no painel privado os contadores acionáveis de recursos e do pixel.

## Aplicação e verificação

Arquivo SQL: `scripts/sql/monitor_optional_openai_pixel_failures_20261104.sql`.
O script valida trechos exatos da função vigente e falha sem modificar nada
caso haja divergência. **Não executar `supabase db push`, `migration
repair`, `db reset` ou replay da cadeia histórica** no projeto produtivo;
o histórico de migrações do repositório não está plenamente alinhado.

A alteração pontual deve ser validada por leitura do corpo da função e
por nova execução de `run_system_health_check(false)`, sem disparar e-mail,
conferindo o JSON de métricas, os probes e a ausência de alertas
indevidos. Continue acompanhando falhas locais por origem/fingerprint;
somente uma análise de entrega de recursos e rede pode confirmar sua causa.

## SEO

Nenhuma página pública, URL, canonical, título, sitemap, robots ou
metaetiqueta é alterada. O painel administrativo já é `noindex`.
