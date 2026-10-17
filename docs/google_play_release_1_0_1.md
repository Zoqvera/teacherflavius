# Android 1.0.1 — Pesquisa de origem dos alunos

## Escopo
- Application ID: `com.teacherflavius.app` (inalterado).
- Version Name: `1.0.1`.
- Version Code: `2` (maior do que o valor anterior `1`).
- Mesma chave de upload e fingerprint configurados em `mobile/android_release.json`.
- Inclui o pop-up de origem declarado pelo aluno, GetNinjas e a supressão para quem já informou.
- O fluxo utiliza as funções `get_my_student_acquisition` e `submit_my_student_acquisition` do Supabase, sem novo armazenamento local de dados pessoais.

## Verificações automáticas
O workflow Android verifica a presença de `student_acquisition_prompt.js`, `student_acquisition_prompt.css`, da integração no HTML de estudante e da opção GetNinjas dentro dos ativos empacotados. Valida também `versionCode` e `versionName` contra o arquivo de configuração, compila um APK debug e um AAB release, testa a assinatura e confere o fingerprint quando os Secrets estão presentes.

## Homologação em aparelho físico
Executar em uma conta de teste, sem utilizar dados pessoais de aluno real:

1. Instalar a nova compilação sobre a versão anterior e verificar que os dados de login são preservados.
2. Entrar com aluno matriculado de teste sem fonte de aquisição e confirmar que o pop-up aparece na Área do Estudante.
3. Selecionar **Outras fontes**, preencher o detalhe e enviar. Confirmar no banco a gravação única vinculada ao perfil de teste.
4. Fechar e abrir o aplicativo; confirmar que o pop-up não reaparece.
5. Abrir a mesma conta no navegador; confirmar que o pop-up também não reaparece.
6. Usar outra conta de teste sem resposta; clicar em **AGORA NÃO** e verificar que a solicitação retorna na próxima visita.
7. Confirmar que um aluno de teste com origem previamente informada nunca vê o pop-up.
8. Confirmar que a Área do Professor não apresenta essa solicitação.
9. Conferir que o convite de avaliação existente não abre simultaneamente com o pop-up.
10. Repetir o teste de navegação principal e autenticação Google no Android.

## Entrega
A compilação no GitHub Actions gera os artefatos `teacher-flavio-android-debug` e `teacher-flavio-android-release-signed` quando a assinatura está configurada. **Não há publicação automática no Google Play.** O envio a teste interno é uma ação separada na Play Console.

Ainda são necessários antes de uma primeira publicação no Google Play: e-mail de suporte, conta demonstrativa para revisão, elementos visuais da ficha e configuração do público-alvo, conforme `docs/google_play_release_1_0_0.md`.

## SEO
A atualização é restrita aos arquivos Android, à validação de empacotamento e a testes. Não altera páginas indexáveis, links canônicos ou metadados SEO.
