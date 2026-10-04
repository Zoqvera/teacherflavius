# Google Play — preparação da versão 1.0.0

## Estado técnico

- applicationId: `com.teacherflavius.app`
- versionName: `1.0.0`
- versionCode: `1`
- AAB assinado automaticamente no GitHub Actions
- fingerprint SHA-256 da upload key validado no CI
- login Google com retorno ao app via deep link
- rotas locais do Capacitor validadas
- tela Mensalidades em modo de consulta no Android
- checkout Mercado Pago removido do bundle Android
- checkout do site permanece inalterado

## Ficha principal

Fonte: `mobile/google_play_listing_pt_BR.json`.

Campos já preparados:
- nome do app;
- descrição breve;
- descrição completa;
- categoria Educação;
- site;
- URL da política de privacidade;
- URL externa para solicitação de exclusão de conta.

Pendências manuais:
- e-mail público de suporte;
- conta de demonstração/instruções para a equipe de análise;
- imagens da ficha: ícone 512x512, feature graphic 1024x500 e capturas reais do app.

## Segurança dos dados

Rascunho: `mobile/google_play_data_safety.json`.

A declaração final deve ser conferida na Play Console contra o comportamento do AAB enviado. O app usa autenticação e infraestrutura Supabase; atividades acadêmicas podem registrar progresso e interações; atividades de pronúncia podem tratar áudio por Microsoft Azure Speech; Analytics é opcional e condicionado ao consentimento.

O Android distribuído pela Google Play não inicia Pix, cartão ou assinatura Mercado Pago. Mensalidades é uma área de consulta de situação e vencimento.

## Privacidade e exclusão de conta

Política pública existente:
`https://teacherflavius.com/privacidade/`

A política:
- identifica Teacher Flávio e o controlador;
- descreve categorias de dados, finalidades, terceiros, retenção e segurança;
- oferece exclusão dentro do Perfil;
- possui uma seção específica de exclusão;
- oferece um caminho externo de solicitação por WhatsApp para quem não consegue acessar o app.

No cadastro da Play Console, usar a mesma URL no campo de política de privacidade e, inicialmente, no recurso Web de exclusão de conta.

## Acesso para análise

O app exige autenticação. Antes do primeiro envio para revisão, criar uma conta de demonstração estável para a equipe da Google Play, com acesso suficiente às telas principais e sem dados pessoais de aluno real.

Não utilizar credenciais pessoais do professor ou de aluno real.

## Público-alvo

Pendente de decisão do controlador. A Play Console exige declarar as faixas etárias alvo. Não selecionar uma faixa até confirmar se o produto é destinado formalmente apenas a maiores de 18 anos ou também a adolescentes.

## Testes

Se a conta de desenvolvedor for pessoal e tiver sido criada depois de 13/11/2023, a produção exige teste fechado com pelo menos 12 testadores inscritos por 14 dias consecutivos antes da solicitação de acesso à produção.

O teste interno pode ser usado antes disso para validar o AAB e a instalação pela própria Play Store.

## Ordem recomendada na Play Console

1. Criar o app com idioma padrão Português (Brasil).
2. Definir o app como aplicativo e informar a distribuição gratuita do download.
3. Preencher a ficha principal.
4. Informar política de privacidade e exclusão de conta.
5. Preencher App access com conta de demonstração.
6. Preencher Segurança dos dados.
7. Responder anúncios, público-alvo e classificação de conteúdo.
8. Configurar países/regiões.
9. Criar uma versão em Teste interno e enviar o AAB assinado.
10. Instalar a versão da Play Store em aparelho físico e repetir o roteiro de regressão.
11. Se aplicável, iniciar o teste fechado obrigatório.
