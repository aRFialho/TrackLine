# TrackLine

MVP do TrackLine para controle de producao com:

- app web
- API Node conectada ao PostgreSQL (Neon)
- empacotamento desktop Windows `.exe` (Electron)
- empacotamento Android `.apk` (Capacitor)
- importacao de OP por planilha (`.xlsx/.csv`)
- baixa por setor com funcionario
- tempos uteis por setor (respeita expediente e almoco)
- painel Admin e Relatorios
- notificacoes de confirmacao/desconfirmacao por usuario com horario

## 1) Requisitos

- Node.js 20+
- npm 10+
- Android Studio (para gerar APK)
- Java 11+ para build Android (AGP 8.x)

## 2) Instalar e rodar

```bash
npm install
npm run db:migrate
npm run db:seed:admin
npm run dev
```

`npm run dev` inicia:

- API: `http://localhost:8787`
- Frontend Vite
- App desktop Electron

## 3) Build web

```bash
npm run build
```

Saida em `dist/`.

## 4) Gerar EXE (Windows)

```bash
npm run desktop:build
```

Instalador em `release/`.

## 4.1) Gerar instalador leve (.iss + payload externo)

```bash
npm run installer:build
```

Saida em `release/installer/` com 2 arquivos:

- `TrackLine-Setup-<versao>.exe`
- `TrackLine-payload.zip`

Distribua **os dois juntos na mesma pasta**. O setup descompacta o payload durante a instalacao.

## 5) Gerar APK (Android)

Primeira vez:

```bash
npm run android:init
```

Depois:

```bash
npm run android:sync
npm run android:open
```

No Android Studio, use **Build > Build APK(s)**.

## 6) Fluxo do sistema

1. Em `Ordens de Producao`, criar OP via planilha.
2. Abrir OP e marcar etapas por setor.
3. Selecionar funcionario ao concluir a etapa.
4. Acompanhar medias por setor na lista e nos relatorios.
5. Ajustar horarios/setores/funcionarios em `Admin`.
6. No cadastro de funcionario, selecionar um ou mais setores permitidos.
7. Editar funcionario para ajustar nome/setores e excluir quando necessario.

## 7) Variaveis de ambiente

- `DATABASE_URL`: conexao PostgreSQL
- `API_PORT`: porta da API (padrao `8787`)
- `VITE_API_URL`: URL base usada pelo frontend (padrao `http://localhost:8787`)
- `VITE_ANDROID_API_URL`: URL da API para Android nativo (padrao `http://10.0.2.2:8787` no emulador)
- `JWT_SECRET`: segredo do token de autenticacao
- `ADMIN_EMAIL` e `ADMIN_PASSWORD`: opcionais para seed do admin

Observacao Android:

- Em emulador Android, `localhost` do app aponta para o proprio emulador. Use `10.0.2.2` para acessar a API no host.
- Em celular fisico, configure `VITE_ANDROID_API_URL` com URL HTTPS publica da sua API.

## 8) Login padrao (admin)

- Email: `dmov@trackline.com`
- Senha: `Alfenas@172839`

## 9) Login operacao

- Email: `dmov@op.com`
- Senha: `Dmov@321`
- Perfil com acesso apenas a `Ordens de Producao`

## 10) Observacoes

- Persistencia principal no PostgreSQL (sem ORM).
- Migracoes SQL em `db/migrations`.
- Logo usada de `public/TL.png`.
- Atualizacao entre dispositivos em tempo real via SSE (`/events`).

## 11) Banco PostgreSQL sem Prisma (migracoes por script)

Este projeto usa SQL puro com controle de migracao em `public.schema_migrations`.

Arquivos:

- migracoes SQL: `db/migrations/*.sql`
- scripts: `scripts/db/*.cjs`

Comandos:

```bash
npm run db:check
npm run db:status
npm run db:migrate
npm run db:deploy
npm run db:seed:admin
```

- `db:migrate` e `db:deploy` aplicam migracoes pendentes.
- `db:status` mostra aplicadas e pendentes.
