// Inicializador LOCAL do Assistente DETRAN-PA.
// Importa o app (definido em api/index.js) e o coloca para escutar uma porta.
// No Vercel este arquivo não é usado — lá o app roda como função serverless.

import "dotenv/config";
import app, { MODEL, FORMS, PROVIDER } from "./api/index.js";

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\nAssistente DETRAN-PA rodando em http://localhost:${PORT}`);
  console.log(`Provedor de IA: ${PROVIDER.nome}`);
  console.log(`Modelo: ${MODEL}`);
  console.log(`Documentos preenchíveis: ${FORMS.length}`);
  console.log(`Chave configurada: ${process.env[PROVIDER.keyVar] ? "sim" : `NÃO — defina ${PROVIDER.keyVar} no .env`}\n`);
});
