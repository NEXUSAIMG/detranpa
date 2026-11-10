# Publicar no Vercel

O backend roda como função serverless (`api/index.js`) e a interface (`public/`)
é servida pela CDN. O `vercel.json` cuida do roteamento.

## Variáveis de ambiente (Project → Settings → Environment Variables)

| Nome | Obrigatória | Para quê |
|---|---|---|
| `DEEPSEEK_API_KEY` | Sim | Chave da DeepSeek. Gere em https://platform.deepseek.com/api_keys |
| `LLM_PROVIDER` | Não | `deepseek` (padrão) ou `anthropic`. Vazio = usa o provedor cuja chave existir (DeepSeek primeiro). |
| `DEEPSEEK_MODEL` | Não | Modelo (padrão `deepseek-flash`). `deepseek-v4-pro` não lê imagens — a análise de fotos deixa de funcionar. |
| `DEEPSEEK_THINKING` | Não | `1` liga o raciocínio do modelo (mais lento e mais caro). Padrão: desligado. |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Só com `LLM_PROVIDER=anthropic` | Alternativa: chave e modelo da Anthropic (padrão `claude-sonnet-4-6`). |
| `MAX_TOKENS` | Não | Tamanho máx. da resposta (padrão `2048`). |
| `TUTOR_PASSWORD` | Para a Sala do Tutor | Senha que a pessoa tutora usa para entrar em `/tutor`. Use uma senha forte. |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Para salvar o que o tutor ensina | Criadas automaticamente ao conectar o armazenamento (passo abaixo). |

(Não defina `PORT` no Vercel — só vale localmente.)

## Publicar (site do Vercel)

1. Suba o projeto no GitHub (já está em github.com/marciogoes/detranpa).
2. Em https://vercel.com → **Add New → Project** → importe o repositório.
3. **Framework Preset:** deixe **Other**.
4. Em **Environment Variables**, adicione pelo menos `DEEPSEEK_API_KEY` e, se for usar
   a Sala do Tutor, `TUTOR_PASSWORD`.
5. **Deploy**. No fim, o Vercel dá a URL pública (ex.: `https://detranpa.vercel.app`).

A cada `git push`, o Vercel republica sozinho.

## Sala do Tutor

- Endereço: **`SUA-URL/tutor`** (ex.: `https://detranpa.vercel.app/tutor`).
- A pessoa entra com a `TUTOR_PASSWORD`. Tudo que ela escreve (título + conteúdo)
  vira conhecimento que o assistente passa a usar **na hora**, sem republicar.
- Há um "Testar o assistente" dentro da própria sala para conferir.

### Memória permanente (para o que o tutor ensina não se perder)

No Vercel, os arquivos são somente leitura, então o conhecimento do tutor precisa
de um banco. É grátis e rápido de ligar:

1. No painel do projeto no Vercel, vá em **Storage → Create Database**.
2. Escolha a opção **Upstash (Redis/KV)** e crie. Conecte ao projeto.
3. O Vercel adiciona sozinho as variáveis `KV_REST_API_URL` e `KV_REST_API_TOKEN`.
4. Faça um **Redeploy** (Deployments → ⋯ → Redeploy) para o app enxergar as variáveis.

Pronto: a Sala do Tutor mostra "Memória permanente (KV) ativada" e tudo fica salvo.
> Sem esse passo, a tutora consegue testar, mas o "salvar" fica bloqueado no Vercel
> (o app avisa na tela).

## Rodar localmente

```bash
npm install
# no .env, defina DEEPSEEK_API_KEY e (opcional) TUTOR_PASSWORD
npm start            # http://localhost:3000  e  http://localhost:3000/tutor
```

Localmente, o que o tutor ensina é salvo no arquivo `data/tutor-knowledge.json`
(esse arquivo está no `.gitignore` e não vai para o GitHub).

## Observações

- **Atualizar a base fixa:** edite `knowledge/*.md` ou `forms-data.js` e dê `git push`.
- **Conhecimento do tutor:** é dinâmico, fica no banco; não precisa de deploy.
- **Custo:** cada pergunta no chat (inclusive o "testar" da sala) usa a API paga da
  DeepSeek. Consulta e preenchimento de documentos NÃO usam a API. Acompanhe o
  saldo e o consumo no painel da DeepSeek (platform.deepseek.com).
- **Trocar de provedor:** mude `LLM_PROVIDER` (e a chave correspondente) no Vercel e
  faça um Redeploy. `/api/health` mostra o provedor e o modelo em uso.
- **Segurança:** a senha do tutor protege a área administrativa; use uma senha forte
  e troque-a se vazar (basta mudar `TUTOR_PASSWORD` no Vercel e redeployar).
