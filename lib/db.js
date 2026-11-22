// Prisma (MySQL no Railway). Um cliente por processo: na Vercel cada função
// reaproveita o cliente entre chamadas "quentes".
// Teto de conexões por instância (22/11/2026): na Vercel podem subir muitas
// instâncias ao mesmo tempo; cada uma abre no máximo DB_CONEXOES (padrão 3) e
// espera até 10 s por uma livre. Se a DATABASE_URL já trouxer connection_limit,
// vale o dela.
import { PrismaClient } from "@prisma/client";

export function urlComTeto(url, teto = Number(process.env.DB_CONEXOES) || 3) {
  if (!url || /[?&]connection_limit=/.test(url)) return url;
  return url + (url.includes("?") ? "&" : "?") + `connection_limit=${teto}&pool_timeout=10`;
}
const g = globalThis;
export const prisma = g.__prismaDetran || new PrismaClient(process.env.DATABASE_URL ? { datasources: { db: { url: urlComTeto(process.env.DATABASE_URL) } } } : undefined);
if (!g.__prismaDetran) g.__prismaDetran = prisma;

export function bancoConfigurado() {
  return Boolean(process.env.DATABASE_URL);
}
