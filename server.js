// Inicializador LOCAL do Assistente DETRAN (multi-tenant).
// Importa o app (definido em api/index.js) e o coloca para escutar uma porta.
// Roda no Railway (npm start). Os crons diários são disparados por lib/agenda.js.

import "dotenv/config";
import app from "./api/index.js";
import { PROVIDER, MODEL, llmConfigurado } from "./lib/llm.js";
import { iniciarAgenda } from "./lib/agenda.js";

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  iniciarAgenda(PORT);
  console.log(`\nAssistente DETRAN rodando em http://localhost:${PORT}  (DETRAN padrão: /${process.env.DEFAULT_TENANT || "pa"})`);
  console.log(`IA local: ${PROVIDER.nome} / ${MODEL} - chave ${llmConfigurado() ? "configurada" : `NÃO configurada (${PROVIDER.keyVar})`}`);
  console.log(`Banco: ${process.env.DATABASE_URL ? "DATABASE_URL definida" : "DATABASE_URL NÃO definida"}\n`);
});
