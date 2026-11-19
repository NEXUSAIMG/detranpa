// Prisma (MySQL no Railway). Um cliente por processo: na Vercel cada função
// reaproveita o cliente entre chamadas "quentes".
// Dica para serverless: use ?connection_limit=3 na DATABASE_URL.
import { PrismaClient } from "@prisma/client";

const g = globalThis;
export const prisma = g.__prismaDetran || new PrismaClient();
if (!g.__prismaDetran) g.__prismaDetran = prisma;

export function bancoConfigurado() {
  return Boolean(process.env.DATABASE_URL);
}
