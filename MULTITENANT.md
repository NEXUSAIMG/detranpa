# Assistente DETRAN — multi-tenant

Um tenant por DETRAN. Cada um tem o próprio endereço, usuários, formulários,
indicadores, histórico de conversas e integrações.

| Endereço | O que é |
|---|---|
| `/pa`, `/am`, ... | Chat do cidadão do DETRAN |
| `/pa/tutor` | Sala do Tutor: link da tutoria do bot (BotAyio) + indicadores |
| `/pa/balcao` | Copiloto do balcão |
| `/pa/painel` | Painel executivo |
| `/api/t/pa/...` | API do DETRAN (dados sempre isolados por tenant) |
| `/api/t/pa/zapayio/webhook/<segredo>` | Webhook do WhatsApp (Zapayio) do DETRAN |

Os endereços antigos (`/`, `/tutor`, `/balcao`, `/painel-custos.html`) redirecionam
para o DETRAN padrão (`DEFAULT_TENANT`, padrão `pa`).

## Cérebro: BotAyio

Cada DETRAN tem um bot no BotAyio (prompt, base e tutoria ficam lá). O chat do site
e o WhatsApp perguntam ao mesmo bot, pelo webhook síncrono
(`/webhooks/seucartorio/<bot_id>`), então respondem igual.

A IA local (DeepSeek/Anthropic) cobre o que o BotAyio não faz: leitura de fotos de
documentos, extração para formulários, rascunho de defesa, termo de exigência e
copiloto do balcão. Ela usa a base em `knowledge/<slug>/`. Também é o plano B do chat
enquanto o DETRAN ainda não tem bot ligado.

## Perfis

`SUPERADMIN` (equipe Ayio, todos os DETRANs) · `ADMIN` · `GESTOR` · `TUTOR` · `BALCAO`.

| Área | Perfis |
|---|---|
| Tutor | TUTOR, GESTOR, ADMIN |
| Balcão | BALCAO, GESTOR, ADMIN |
| Painel | GESTOR, ADMIN |
| Integrações do WhatsApp | ADMIN |

## Implantação (primeira vez)

1. Crie o banco MySQL no Railway e copie a URL para `DATABASE_URL`
   (com `?connection_limit=3`).
2. Na Vercel, defina `DATABASE_URL`, `APP_ENCRYPTION_KEY`, `AUTH_SECRET`,
   `PUBLIC_URL`, `DEFAULT_TENANT` e as chaves de IA/KV (veja `.env.example`).
3. Na sua máquina, com o `.env` apontando para o banco do Railway:
   ```bash
   npm install
   npm run db:migrate                 # cria as tabelas
   npm run tenant -- seed pa          # cadastra o DETRAN-PA (dados, guias, 11 formulários)
   ```
4. Crie os usuários (a senha vai pela variável SENHA, não pelo comando):
   ```bash
   SENHA='...' npm run tenant -- usuario pa admin.pa ADMIN "Nome do admin"
   SENHA='...' npm run tenant -- usuario pa tutor.pa TUTOR "Nome do tutor"
   SENHA='...' npm run tenant -- usuario pa balcao01 BALCAO "Nome do atendente"
   ```
   No PowerShell: `$env:SENHA='...'; npm run tenant -- usuario ...`
5. Ligue o bot e o WhatsApp do DETRAN (segredos são cifrados no banco):
   ```bash
   BOTAYIO_URL=https://.../webhooks/seucartorio/<bot_id> \
   BOTAYIO_SECRET=... BOTAYIO_TUTOR_URL='https://.../tutor/app?bot=...&token=...' \
   ZAPAYIO_INSTANCE_ID=... ZAPAYIO_TOKEN=... ZAPAYIO_CLIENT_TOKEN=... \
   ZAPAYIO_WEBHOOK_SECRET=<texto aleatório longo> \
   npm run tenant -- integracao pa
   ```
6. Com um usuário ADMIN logado, chame `POST /api/t/pa/zapayio/configurar-webhook`
   para apontar a instância do Zapayio para o app.

## Novo DETRAN

Crie `tenants/<slug>.json` (modelo: `tenants/pa.json`) e, se quiser, `tenants/<slug>.conteudo.json`
(sugestões, guias, atalhos, boas-vindas) e `knowledge/<slug>/*.md` (base da IA local).
Depois: `npm run tenant -- seed <slug>`, usuários e integrações como acima.
O cadastro pela tela (`/admin`) vem numa fase seguinte.
