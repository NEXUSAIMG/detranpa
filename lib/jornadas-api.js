// Rotas do "Despachante Parente" (site) e a ponte com o WhatsApp.
import { comTenant } from "./tenants.js";
import { registrarEvento } from "./registro.js";
import { kvGetStr, kvSetEx, kvDel } from "../store.js";
import { JORNADAS, detectarJornada, donoValido, lerJornada, iniciar, responder, sair, cartao, textoWhatsApp, comandoWhatsApp } from "./jornadas.js";

const catalogo = () => Object.values(JORNADAS).map((j) => ({ id: j.id, icone: j.icone, titulo: j.titulo, resumo: j.resumo, etapas: j.etapas.length }));

export function registrarJornadas(app, { limitar } = {}) {
  const J = "/api/t/:slug/jornadas";
  const dono = (req) => { const d = `web:${String(req.query.sessao || req.body?.sessao || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 48)}`; return donoValido(d) ? d : null; };
  const reg = (ev) => registrarEvento(ev);

  app.get(J, comTenant, (req, res) => res.json({ jornadas: catalogo() }));

  app.get(`${J}/atual`, comTenant, async (req, res) => {
    const d = dono(req); if (!d) return res.status(400).json({ error: "Sessão inválida." });
    const est = await lerJornada(req.tenant.slug, d);
    res.json({ cartao: est ? cartao(req.tenant, est) : null });
  });

  app.post(`${J}/iniciar`, comTenant, async (req, res) => {
    const d = dono(req); if (!d) return res.status(400).json({ error: "Sessão inválida." });
    if (limitar && limitar(`jor:${req.tenant.slug}:${req.ip}`, 30)) return res.status(429).json({ error: "Aguarde um instante." });
    if (!JORNADAS[req.body?.id]) return res.status(400).json({ error: "Jornada desconhecida." });
    try { const est = await iniciar(req.tenant, d, req.body.id, { canal: "WEB", registrar: reg }); res.json({ cartao: cartao(req.tenant, est) }); }
    catch (e) { res.status(500).json({ error: "Não foi possível começar agora." }); }
  });

  app.post(`${J}/responder`, comTenant, async (req, res) => {
    const d = dono(req); if (!d) return res.status(400).json({ error: "Sessão inválida." });
    if (limitar && limitar(`jor:${req.tenant.slug}:${req.ip}`, 60)) return res.status(429).json({ error: "Aguarde um instante." });
    const est = await lerJornada(req.tenant.slug, d);
    if (!est) return res.status(404).json({ error: "Nenhuma jornada em andamento." });
    const { acao, valor } = req.body || {};
    const r = await responder(req.tenant, est, { acao: String(acao || ""), valor: valor == null ? null : String(valor).slice(0, 40) }, { registrar: reg });
    res.status(r.erro ? 400 : 200).json({ ...(r.erro ? { error: r.erro } : {}), cartao: cartao(req.tenant, r.est), avisos: r.avisos || [] });
  });

  app.post(`${J}/sair`, comTenant, async (req, res) => {
    const d = dono(req); if (!d) return res.status(400).json({ error: "Sessão inválida." });
    await sair(req.tenant, d); res.json({ ok: true });
  });
}

// ── WhatsApp ──
// Devolve { textos: [...] } quando a mensagem é da jornada (ou começa uma), senão null.
// `criarLembreteWA(tipo, data)` cria o lembrete direto (o dono do número pediu).
export async function tratarJornadaWhatsApp(t, phone, texto, { criarLembreteWA } = {}) {
  const dono = `wa:${phone}`;
  const s = String(texto || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.!]+$/, "");
  const ofertaK = `jor-oferta:${t.slug}:${phone}`;
  const est = await lerJornada(t.slug, dono);
  const c = est ? cartao(t, est) : null;

  // Começar: "acompanhar" (depois de uma oferta) ou "acompanhar venda|cnh|multa".
  const m = s.match(/^acompanhar(?:\s+(venda|carro|veiculo|cnh|renovacao|carteira|multa|defesa))?$/);
  if (m) {
    const pedido = m[1] ? ({ venda: "venda", carro: "venda", veiculo: "venda", cnh: "renovacao", renovacao: "renovacao", carteira: "renovacao", multa: "defesa", defesa: "defesa" })[m[1]] : await kvGetStr(ofertaK).catch(() => null);
    if (!pedido || !JORNADAS[pedido]) {
      return { textos: [`🧭 Eu te acompanho passo a passo, até o fim. Escolha:\n${Object.values(JORNADAS).map((j) => `• *ACOMPANHAR ${j.id === "venda" ? "VENDA" : j.id === "renovacao" ? "CNH" : "MULTA"}* — ${j.titulo}`).join("\n")}`] };
    }
    await kvDel(ofertaK).catch(() => {});
    const novo = await iniciar(t, dono, pedido, { canal: "WHATSAPP", registrar: registrarEvento });
    return { textos: [textoWhatsApp(cartao(t, novo))] };
  }
  if (!c) return null;
  if (/^(jornada|minha jornada|onde parei)$/.test(s)) return { textos: [textoWhatsApp(c)] };
  const cmd = comandoWhatsApp(c, texto);
  if (!cmd) return null;
  if (cmd.acao === "sair") { await sair(t, dono); return { textos: ["Tudo bem, parei o acompanhamento. Quando quiser retomar, escreva *ACOMPANHAR*. 🙂"] }; }
  const r = await responder(t, est, cmd, { registrar: registrarEvento });
  if (r.erro) return { textos: [`⚠️ ${r.erro}`] };
  const textos = [];
  for (const a of r.avisos || []) {
    if (!criarLembreteWA) continue;
    const tipo = a.lembrete === "DEFESA" ? "DEFESA" : "CNH";
    const ok = await criarLembreteWA(tipo, a.data).catch(() => false);
    if (ok) textos.push(tipo === "DEFESA" ? "🔔 Pronto: vou te lembrar do prazo da defesa aqui no WhatsApp." : "🔔 Pronto: vou te lembrar do vencimento da CNH aqui no WhatsApp.");
  }
  textos.push(textoWhatsApp(cartao(t, r.est)));
  return { textos };
}

// Depois da resposta do bot: se a pergunta é de uma jornada, oferece o acompanhamento.
export async function ofertaJornadaWhatsApp(t, phone, texto) {
  const id = detectarJornada(texto);
  if (!id) return null;
  if (await lerJornada(t.slug, `wa:${phone}`)) return null;
  await kvSetEx(`jor-oferta:${t.slug}:${phone}`, id, 86400).catch(() => {});
  return `🧭 Quer que eu te acompanhe *passo a passo até o fim* (${JORNADAS[id].titulo.toLowerCase()}), com prazos e lembretes? Responda *ACOMPANHAR*.`;
}
