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

## Migrar o que existia antes (DETRAN-PA)

A versão antiga guardava no Redis (Upstash) o que o Tutor ensinou, as perguntas sem
resposta, os indicadores e os atendimentos do balcão. Depois do passo 5 acima
(bot do PA já ligado), com o `.env` apontando para o Railway e para o Upstash antigo:

```bash
# simulação: só mostra o que seria migrado
npm run migrar -- --tenant pa

# aplica (BotAyio: usuário editor/admin do painel)
BOTAYIO_EMAIL=... BOTAYIO_SENHA=... npm run migrar -- --tenant pa --aplicar
```

- Indicadores e balcão vão para o MySQL do PA.
- A base oficial (`knowledge/pa/*.md`) e o que o Tutor antigo ensinou vão para a base
  do bot do PA no BotAyio, em trechos de ~900 caracteres (`[Base DETRAN-PA] ...` e
  `[Tutor] ...`).
- As perguntas sem resposta viram o relatório `migracao-pa-lacunas.md` (fora do Git),
  para o tutor completar a base na tutoria do bot.
- O Redis antigo é só lido. Rodar de novo não duplica (cada etapa fica registrada).

## Administração pela tela

| Endereço | Quem | O que faz |
|---|---|---|
| `/admin` | Equipe Ayio (SUPERADMIN) | Lista todos os DETRANs, cria um novo (copiando os formulários de outro), edita qualquer um |
| `/pa/admin` | Administrador do DETRAN | Só o próprio DETRAN: dados e textos, integrações, usuários e formulários |

Em cada DETRAN:
- **Dados e textos:** nome, sigla, telefone, portal, logo, tom de voz, orientações do estado
  e o conteúdo da tela (boas-vindas, sugestões, guias, atalhos) em JSON.
- **Integrações:** URL/segredo do bot no BotAyio, link de tutoria, instância e tokens do
  Zapayio, segredo do webhook (com botão "Gerar"). Segredos entram cifrados e nunca são
  mostrados de volta. Botões para apontar o webhook do Zapayio, ver o status do WhatsApp e
  testar o bot.
- **Usuários:** criar, mudar perfil, desativar/reativar, trocar senha. O admin não consegue
  desativar nem rebaixar a si mesmo, nem criar SUPERADMIN.
- **Formulários:** mostrar/ocultar e ordem.

Desativar um DETRAN (tirar o site do ar) e copiar formulários entre DETRANs são só da equipe Ayio.
Mudanças aparecem no site em até 1 minuto (cache).

O primeiro SUPERADMIN é criado pela linha de comando:
```bash
SENHA='...' npm run tenant -- usuario - ayio SUPERADMIN "Equipe Ayio"
```

## Novo DETRAN

Pela tela: `/admin` → "Novo DETRAN" → depois integrações e usuários na própria ficha.

Pela linha de comando (útil para trazer conteúdo pronto): crie `tenants/<slug>.json`
(modelo: `tenants/pa.json`) e, se quiser, `tenants/<slug>.conteudo.json` e
`knowledge/<slug>/*.md` (base da IA local). Depois `npm run tenant -- seed <slug>`.
