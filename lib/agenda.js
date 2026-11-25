// Agenda interna (substitui os crons do vercel.json): no Railway o processo fica
// sempre ligado, então ele mesmo chama as rotas protegidas por CRON_SECRET.
// Horários em UTC, iguais aos que existiam na Vercel.
// ponytail: serve para UMA instância; com réplicas, mover para o agendador do Railway.
const TAREFAS = [
  { rota: "/api/cron/aquecer", h: 12, m: 31 },
  { rota: "/api/cron/diario", h: 13, m: 7 },
];

const dia = (d) => d.toISOString().slice(0, 10);

// Tarefas cujo horário já passou hoje (UTC) e ainda não rodaram neste dia.
export function devidas(agora, feitas) {
  const min = agora.getUTCHours() * 60 + agora.getUTCMinutes();
  return TAREFAS.filter((t) => min >= t.h * 60 + t.m && feitas.get(t.rota) !== dia(agora));
}

export function iniciarAgenda(porta) {
  const seg = process.env.CRON_SECRET;
  if (!seg) return console.warn("Agenda desligada: CRON_SECRET não definido.");
  // Ao subir depois do horário, marca como feito: um deploy não deve disparar tudo de novo.
  const feitas = new Map();
  for (const t of devidas(new Date(), feitas)) feitas.set(t.rota, dia(new Date()));
  setInterval(async () => {
    const agora = new Date();
    for (const t of devidas(agora, feitas)) {
      feitas.set(t.rota, dia(agora));
      try {
        const r = await fetch(`http://127.0.0.1:${porta}${t.rota}`, { headers: { Authorization: `Bearer ${seg}` }, signal: AbortSignal.timeout(280000) });
        console.log(`[agenda] ${t.rota} -> HTTP ${r.status}`);
      } catch (e) { console.error(`[agenda] ${t.rota} falhou: ${e.message}`); }
    }
  }, 60000).unref();
}
