// Pedidos claramente fora do assunto (27/11/2026, teste dos estagiários C3: o bot contou
// uma piada). Filtro barato, antes da IA: só pega pedidos explícitos de entretenimento e
// sem nenhuma palavra de trânsito, para não barrar pergunta legítima.
const FORA = /\b(piada|piadinha|anedota|charada|trocadilho|me (?:conte|conta) uma hist[oó]ria|poema|poesia|letra de m[uú]sica|receita de|hor[oó]scopo|signo|quem vai ganhar|resultado do jogo|me fa[cç]a rir)\b/i;
const TRANSITO = /\b(detran|cnh|carteira|habilita|ve[ií]culo|carro|moto|placa|renavam|multa|licenci|transfer|vistoria|tr[aâ]nsito|condutor|motorista|crlv|crv|ipva|recurso|jari|autua)/i;

export function foraDoEscopo(pergunta) {
  const p = String(pergunta || "");
  return FORA.test(p) && !TRANSITO.test(p);
}

export function respostaForaDoEscopo(t) {
  return `Eu só consigo ajudar com os serviços do ${t.sigla} 🙂[[BREAK]]Posso, por exemplo:\n- explicar como renovar ou tirar a 2ª via da CNH\n- dizer o que levar para transferir um veículo\n- conferir se uma cobrança é golpe\n\nÉ só me dizer o que você precisa.`;
}
