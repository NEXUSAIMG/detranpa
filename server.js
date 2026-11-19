// Inicializador LOCAL do Assistente DETRAN (multi-tenant).
// Importa o app (definido em api/index.js) e o coloca para escutar uma porta.
// Na Vercel este arquivo não é usado - lá o app roda como função serverless.

import "dotenv/config";
import app from "./api/index.js";
import { PROVIDER, MODEL, llmConfigurado } from "./lib/llm.js";

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\nAssistente DETRAN rodando em http://localhost:${PORT}  (DETRAN padrão: /${process.env.DEFAULT_TENANT || "pa"})`);
  console.log(`IA local: ${PROVIDER.nome} / ${MODEL} - chave ${llmConfigurado() ? "configurada" : `NÃO configurada (${PROVIDER.keyVar})`}`);
  console.log(`Banco: ${process.env.DATABASE_URL ? "DATABASE_URL definida" : "DATABASE_URL NÃO definida"}\n`);
});
