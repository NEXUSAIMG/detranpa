# Manual de operação — Assistente DETRAN

Versão 22/11/2026. Para quem mantém o sistema no ar (equipe Ayio). Cada problema tem: como perceber, como confirmar e o que fazer, em ordem.

## 1. Como o sistema está montado

| Peça | Onde roda | Para que serve | Se cair |
| --- | --- | --- | --- |
| App detranpa (site, áreas internas, APIs) | Vercel (projeto `detranpa`) | Tudo o que o cidadão e o servidor veem | Site fora do ar |
| Banco MySQL | Railway | Conversas, usuários, chamados, eventos, estado curto (`kv_estado`), 2 etapas, auditoria | Quase tudo para |
| BotAyio (cérebro do assistente) | Railway | Respostas pela base de conhecimento de cada DETRAN | Site responde pela IA local (plano B); WhatsApp também |
| Zapayio (WhatsApp) | zap.ondot.com.br | Envia e recebe mensagens | WhatsApp para; site segue |
| Upstash/Vercel KV | Vercel Storage | Estado curto (opcional) | Nada: cai sozinho para o MySQL |
| Monitor | GitHub Actions (`.github/workflows/monitor.yml`) | Checa `/api/saude` a cada 10 min | Nada (só deixa de avisar) |

## 2. Onde olhar primeiro

1. **E-mail do GitHub** "Monitor de saúde failed": algo caiu. O e-mail mostra o que (`fora: [...]`).
2. **Admin → Saúde do sistema** (`/admin`): banco, armazenamento, BotAyio e WhatsApp de cada DETRAN, tempo de resposta e as últimas 50 falhas.
3. **Central de Gestão** do DETRAN: faixa vermelha no topo quando uma integração dele está fora.
4. **Logs da Vercel**: `vercel logs https://detranpa.vercel.app --json --level error` (no computador do Márcio, pasta do projeto).
5. **Endereço público**: `https://detranpa.vercel.app/api/saude` → 200 = tudo no ar; 503 = algo fora (lista em `fora`).

## 3. Problemas comuns

### 3.1 WhatsApp desconectado
- **Sinal:** Saúde mostra "WhatsApp: desconectado (precisa parear pelo QR)"; cidadãos param de receber resposta.
- **Fazer:** abrir o painel do Zapayio → instância do DETRAN → ler o QR com o celular do número oficial. Conferir no Admin → Saúde (atualizar).
- **Depois:** se cair de novo em menos de 24 h, verificar se o celular do número oficial está ligado, com internet e sem o WhatsApp Web aberto em outro lugar.

### 3.2 BotAyio fora ou lento
- **Sinal:** Saúde "Assistente (BotAyio): fora"; falhas `BotAyio` em rajada.
- **Efeito:** o site e o WhatsApp respondem pela IA local (plano B), sem a base de conhecimento completa.
- **Fazer:** Railway → serviço do BotAyio → Deployments: ver se o último deploy falhou; se sim, "Redeploy" do anterior. Ver `GET https://botayio-production.up.railway.app/health`.

### 3.3 Banco fora
- **Sinal:** `/api/saude` com "Banco de dados" fora; páginas internas com "Serviço indisponível".
- **Fazer:** Railway → MySQL → Metrics (disco/memória) e Logs. Disco cheio: aumentar o volume. Credencial trocada: atualizar `DATABASE_URL` na Vercel e fazer redeploy.

### 3.4 Armazenamento "MySQL (reserva)"
- Não é problema: o KV (Upstash) não responde e o sistema usa o MySQL. Para limpar o aviso, ou cria um banco Upstash novo (Vercel → Storage) e atualiza `KV_REST_API_URL`/`KV_REST_API_TOKEN`, ou apaga essas duas variáveis.

### 3.5 Resposta errada do assistente
1. Reproduzir na Central → Tutoria do bot → "testar".
2. Ensinar a resposta certa na Tutoria (entra no ar na hora; o cache das perguntas frequentes é limpo sozinho).
3. Rodar a avaliação oficial (seção 5) para ver se nada piorou.

### 3.6 Cidadão diz que recebeu golpe "do DETRAN"
- O sistema não envia cobrança nem link de pagamento. Orientar o cidadão a usar o Antigolpe e o portal oficial. Se o golpe usa o nome do assistente, registrar no Observatório (Golpes) e avisar a comunicação do DETRAN.

### 3.7 Senha ou token vazou
- **Senha de um usuário:** Admin → DETRAN → Usuários → trocar a senha ou desativar.
- **AUTH_SECRET vazou:** gerar um novo (64 caracteres aleatórios), trocar na Vercel e redeploy. Efeito: todos saem e precisam entrar de novo; o link privado das demonstrações muda (copiar o novo no Admin).
- **APP_ENCRYPTION_KEY:** NÃO trocar sem migração: ela decifra os segredos das integrações e das 2 etapas. Falar com o desenvolvedor.

### 3.8 Pessoa perdeu o celular das 2 etapas
- Confirmar a identidade por outro canal. No banco: `DELETE FROM kv_estado WHERE k = '2fa:<id do usuário>';` (o id está em Admin → Usuários). A pessoa entra só com a senha e ativa de novo (ou é obrigada a ativar, se o perfil estiver em `EXIGIR_2FA`).

## 4. Publicação e volta atrás

- **Publicar:** todo envio para a `main` no GitHub publica na Vercel. Os testes rodam no GitHub (`Testes`); com a regra de branch ligada, só entra o que passou.
- **Voltar atrás em 1 minuto:** Vercel → Deployments → versão anterior → "Promote to Production" (ou `vercel rollback`). Depois, corrigir com calma e publicar de novo.
- **Banco:** mudanças de estrutura usam `npm run db:migrate` com a `DATABASE_URL` de produção (o sistema cria sozinho só a tabela `kv_estado`).

## 5. Rotinas

| Quando | O quê | Como |
| --- | --- | --- |
| Diário (automático) | Lembretes, limpeza LGPD, normas do CONTRAN, cutucada das jornadas | Cron da Vercel 10h07 (Brasília) |
| A cada 10 min (automático) | Monitor de saúde | GitHub Actions |
| Semanal | Ver Admin → Saúde (falhas e tempo) e o Observatório ("O bot não soube responder") | Manual |
| Mensal | Avaliação oficial de respostas (meta 95%) | `node scripts/avaliar-respostas.mjs --slug pa` com `AVALIACAO_LOGIN`/`AVALIACAO_SENHA` de um usuário Tutor |
| Mensal | Cópia de segurança do banco + teste de restauração | Seção 6 |
| Trimestral | Revisar usuários ativos e trilha de auditoria; trocar senhas de serviço | Admin → Usuários e Auditoria |

## 6. Cópia de segurança e restauração

O Railway faz cópias automáticas do volume do MySQL (Railway → MySQL → Backups). Além disso, uma cópia própria por mês:

```powershell
# Cópia (no computador do Márcio, com o MySQL 8.4 instalado). A senha é pedida na hora.
$env:DB_URL = "<cole a DATABASE_URL do Railway>"
powershell -File scripts/backup-banco.ps1 -Saida C:\Backups\detran
# Teste de restauração em um banco local descartável (não toca a produção):
powershell -File scripts/backup-banco.ps1 -Restaurar C:\Backups\detran\detran-AAAA-MM-DD.sql.gz -Porta 3399
```

Guardar o arquivo em local cifrado (ele tem dados pessoais) por no máximo 180 dias, como as conversas.

## 7. Contatos

| Papel | Quem | Como |
| --- | --- | --- |
| Responsável técnico | Márcio Góes (MG Inteligência Artificial) | e-mail e telefone do contrato |
| Hospedagem | Vercel, Railway | painéis das contas |
| WhatsApp | Zapayio (Ondot) | suporte do fornecedor |
| DETRAN cliente | encarregado de dados e gestor do contrato | conforme contrato |
