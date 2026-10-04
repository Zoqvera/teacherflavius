# Android com Capacitor

A camada Android do Teacher Flávio usa Capacitor 8 e reutiliza o frontend estático existente.

## Decisões

- App ID: `com.teacherflavius.app`
- Nome: `Teacher Flávio`
- Web assets do site: `_site/`
- Web assets empacotados no Android: `_android_site/`
- Conteúdo empacotado localmente no APK/AAB
- O aplicativo não usa `server.url`
- O service worker da PWA é desativado dentro do runtime nativo
- O site e a PWA continuam publicados pelo GitHub Pages sem depender do build Android

## Preparação do frontend

O comando:

```bash
npm run mobile:web
```

executa o mesmo pipeline usado para validar a versão de produção:

1. build do site estático;
2. materialização das dependências;
3. pós-processamento de produção.

O pipeline gera `_site/` e depois cria `_android_site/`, uma cópia específica para o runtime nativo. Nessa cópia, rotas limpas locais como `/login/` são convertidas para arquivos explícitos como `/login/index.html`, evitando o fallback do servidor local do Capacitor para o `index.html` raiz. O `webDir` do Capacitor aponta para `_android_site/`.

## Projeto Android

Para criar o projeto Android pela primeira vez:

```bash
npm install --ignore-scripts --no-audit --no-fund
npm run mobile:web
npm run mobile:android:add
```

Depois de mudanças no frontend:

```bash
npm run mobile:android:sync
```

Para abrir o projeto nativo:

```bash
npm run mobile:android:open
```

O Capacitor 8 exige Node.js 22 ou superior. Para desenvolvimento Android, use Android Studio compatível com Capacitor 8 e SDK Android 36.

## CI

O workflow `.github/workflows/android-capacitor-build.yml` gera o bundle nativo com rotas explícitas, valida a navegação principal, cria o projeto Android em ambiente descartável, sincroniza o frontend, compila `app-debug.apk` e publica o APK como artefato do GitHub Actions.

Esse APK é apenas para validação técnica e instalação de teste. A publicação na Google Play exige uma versão release assinada e geração de AAB.

## Próximos passos

Após a validação do APK debug:

1. versionar o projeto Android nativo quando começarem customizações específicas;
2. definir ícone e splash nativos definitivos;
3. testar autenticação, pagamentos, links externos e navegação em aparelho físico;
4. configurar assinatura de release sem versionar credenciais;
5. gerar AAB;
6. preparar a ficha da Google Play e o primeiro envio.
