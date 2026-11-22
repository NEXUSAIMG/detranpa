// Carregado antes dos testes (node --import): ambiente isolado, sem banco,
// sem KV e sem chaves de IA, em qualquer máquina. Variáveis definidas como ""
// não são sobrescritas pelo .env do projeto (dotenv/Prisma).
for (const k of ["DATABASE_URL", "KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN",
  "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY", "CRON_SECRET"]) process.env[k] = "";
process.env.NODE_ENV = "test";
process.env.AUTH_SECRET = process.env.AUTH_SECRET_TESTE || "segredo-so-para-testes-unitarios-0123456789";
