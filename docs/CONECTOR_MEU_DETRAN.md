# Conector "Meu DETRAN" — contrato da API do DETRAN

Este documento é para a equipe de TI do DETRAN. Ele descreve a **única** chamada que o
Assistente DETRAN faz aos sistemas do órgão para responder ao cidadão sobre a situação
**dele** (débitos, CNH, pontos, veículos, processos e agendamentos).

## Como funciona (resumo)

1. O cidadão toca em **"Entrar com gov.br"** no site do assistente.
2. O login é feito no **gov.br** (OpenID Connect, fluxo *authorization code* com PKCE).
   O assistente recebe do gov.br o CPF verificado (`sub`) — **o CPF nunca é digitado no chat**.
3. Com a sessão gov.br ativa (30 minutos), o assistente chama a API abaixo com esse CPF,
   usando um token de serviço exclusivo do assistente.
4. Os dados são usados só para responder àquela pessoa, naquela conversa. Ficam em cache
   por no máximo 5 minutos e não são gravados no histórico.

Sem login gov.br, nenhuma consulta é feita. Se a integração estiver desligada no /admin,
o assistente funciona como hoje (orientação geral).

## Credenciamento no gov.br

- Solicitar ao gov.br o credenciamento do serviço (ambiente de homologação primeiro).
- Escopos: `openid email profile govbr_confiabilidades`.
- URL de retorno a cadastrar: `https://<domínio do assistente>/api/t/<uf>/govbr/retorno`
  (o /admin → Integrações mostra a URL exata).
- `client_id` e `client_secret` são cadastrados no /admin → Integrações → *Meu DETRAN* (o
  segredo é guardado cifrado e nunca é exibido de volta).

## A chamada

```
GET {URL_DA_API}/cidadaos/{cpf}/resumo
Authorization: Bearer {TOKEN_DO_ASSISTENTE}
Accept: application/json
```

- `{cpf}`: 11 dígitos, sem pontuação, vindo do gov.br.
- Tempo máximo de resposta: 12 segundos.
- `200` com o JSON abaixo · `404` se o CPF não tiver cadastro · `401/403` token inválido ·
  `5xx` indisponível (o assistente avisa a pessoa e não inventa nada).
- A API deve aceitar **somente** HTTPS e **somente** o token do assistente (restrinja por IP se possível).

### Resposta (200)

```json
{
  "cidadao": { "nome": "Maria da Silva" },
  "cnh": {
    "categoria": "AB",
    "situacao": "Regular",
    "validade": "2029-09-02",
    "pontos": 14,
    "observacoes": "EAR — exerce atividade remunerada"
  },
  "veiculos": [
    {
      "placa": "ABC1D23",
      "modelo": "FIAT/STRADA FREEDOM 1.3",
      "situacao": "Em circulação",
      "licenciadoAte": "2025",
      "restricoes": ["Licenciamento do exercício em atraso"]
    }
  ],
  "infracoes": [
    { "data": "2026-10-03", "desc": "Avançar o sinal vermelho", "natureza": "Gravíssima", "pontos": 7,
      "orgao": "DETRAN-PA", "fase": "Penalidade — cabe recurso à JARI" }
  ],
  "debitos": [
    { "tipo": "LICENCIAMENTO", "desc": "Taxa de licenciamento 2026", "valor": 151.60,
      "vencimento": "2026-11-15", "situacao": "VENCIDO" }
  ],
  "processos": [
    { "numero": "2026/000123", "tipo": "Renovação de CNH", "situacao": "Aguardando exame médico" }
  ],
  "agendamentos": [
    { "servico": "Vistoria", "local": "Sede — Av. Augusto Montenegro", "data": "2026-12-01", "hora": "09:20" }
  ],
  "atualizadoEm": "2026-11-20T21:30:00-03:00"
}
```

Regras:
- `cidadao.nome` é obrigatório; as demais seções podem vir vazias (`[]` ou `null`).
- Datas em `AAAA-MM-DD`. Valores em reais (número, ponto decimal).
- `debitos[].situacao`: `A VENCER`, `VENCIDO` ou `PAGO` (pagos podem ser omitidos).
- Não envie dados que o assistente não usa (endereço completo, filiação, documentos de terceiros).

## LGPD

- Base legal: execução de política pública / atendimento ao titular, com autenticação do próprio titular.
- O assistente não grava o resumo; registra apenas a conversa (como já faz hoje) e respeita a
  retenção configurada pelo DETRAN.
- O cidadão pode sair a qualquer momento ("Sair" no site), o que apaga a sessão e o cache.

## Como testar

1. No /admin → Integrações → *Meu DETRAN*: informe a URL e o token da API de **homologação**,
   o ambiente gov.br "Homologação" e as credenciais de homologação; mude para "Ligado".
2. Abra o site do assistente: o botão "Entrar com gov.br" aparece.
3. Entre com uma conta de teste do gov.br e pergunte "quais débitos eu tenho?".
