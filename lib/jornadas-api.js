// Rotas do "Despachante Parente" (site) e a ponte com o WhatsApp.
import { comTenant } from "./tenants.js";
import { registrarEvento } from "./registro.js";
import { kvGetStr, kvSetEx, kvDel } from "../store.js";
import { JORNADAS, detectarJornada, donoValido, lerJornada, iniciar, responder, sair, cartao as cartaoBase, textoWhatsApp, comandoWhatsApp, jornadaPorPalavra, palavraDe, textoLevar, etapasPrevistas } from "./jornadas.js";
import { servicosDoTenant } from "./conferencia.js";

// Nº de etapas do caminho mais comum (1ª opção de cada escolha), sem contar ramos alternativos.
function etapasTipicas(j) {
  const d = {}; let n = 0;
  for (const e of j.etapas) {
    if (e.so && !e.so(d)) continue;
    n++;
    if (e.tipo === "escolha" && e.opcoes?.length) d[e.salvarEm] = e.opcoes[0].id;
  }
  return n;
}
const catalogo = () => Object.values(JORNADAS).map((j) => ({ id: j.id, icone: j.icone, titulo: j.titulo, resumo: j.resumo, etapas: etapasPrevistas(j) })); // mesma conta do "Etapa 1 de N"

// "O que levar" (22/11/2026): os itens da conferência de documentos do serviço
// (do jeito que o DETRAN cadastrou) + os itens próprios da jornada.
export function oQueLevar(t, j, dados) {
  const servs = servicosDoTenant(t);
  const itens = [], vistos = new Set();
  for (const id of (j.servicos ? j.servicos(dados || {}) : [])) {
    const s = servs.find((x) => x.id === id); if (!s) continue;
    for (const i of s.itens || []) {
      if (vistos.has(i.id)) continue; vistos.add(i.id);
      itens.push({ nome: i.nome, condicional: i.condicional || null });
    }
  }
  for (const nome of (j.levarExtra ? j.levarExtra(t, dados || {}) : [])) if (!itens.some((i) => i.nome === nome)) itens.push({ nome, condicional: null });
  return itens.length ? { titulo: `O que levar — ${j.titulo}`, itens } : null;
}
function cartao(t, est) {
  const c = cartaoBase(t, est); if (!c) return c;
  try { c.levar = oQueLevar(t, JORNADAS[est.jornada], est.dados); } catch { c.levar = null; }
  return c;
}
export { cartao as cartaoComLevar };

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
    catch (e) { console.error("[jornadas]", req.tenant?.slug, String(e?.message || e).slice(0, 200)); res.status(500).json({ error: "Não foi possível começar agora." }); }
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
  // Resposta à pesquisa de impacto ("isso evitou uma ida ao DETRAN?"), enviada ao concluir uma jornada.
  const pesqK = `impacto-wa:${t.slug}:${phone}`;
  const resp = /^(sim|s|nao|n|ainda nao sei|nao sei|talvez)$/.test(s) ? await kvGetStr(pesqK).catch(() => null) : null;
  if (resp) {
    await kvDel(pesqK).catch(() => {});
    const r = s.startsWith("s") ? "sim" : /sei|talvez/.test(s) ? "talvez" : "nao";
    await registrarEvento({ tenantId: t.id, tipo: "IMPACTO", canal: "WHATSAPP", tema: `${r}:${resp}`.slice(0, 60) });
    return { textos: ["Obrigado pela resposta! 💚 Isso ajuda o DETRAN a melhorar o atendimento."] };
  }
  const est = await lerJornada(t.slug, dono);
  const c = est ? cartao(t, est) : null;

  // Começar: "acompanhar" (depois de uma oferta) ou "acompanhar venda|cnh|multa".
  // "acompanhar <outra coisa>" (ex.: "acompanhar meu processo") não é da jornada: segue adiante.
  const m0 = s.match(/^acompanhar(?:\s+(.{1,30}))?$/);
  const m = m0 && (!m0[1] || jornadaPorPalavra(m0[1])) ? m0 : null;
  if (m) {
    const pedido = m[1] ? jornadaPorPalavra(m[1]) : await kvGetStr(ofertaK).catch(() => null);
    if (!pedido || !JORNADAS[pedido]) {
      return { textos: [`🧭 Eu te acompanho passo a passo, até o fim. Escolha:\n${Object.values(JORNADAS).map((j) => `• *ACOMPANHAR ${palavraDe(j)}* — ${j.titulo}`).join("\n")}`] };
    }
    await kvDel(ofertaK).catch(() => {});
    const novo = await iniciar(t, dono, pedido, { canal: "WHATSAPP", registrar: registrarEvento });
    return { textos: [textoWhatsApp(cartao(t, novo))] };
  }
  if (!c) return null;
  if (/^(jornada|minha jornada|onde parei)$/.test(s)) return { textos: [textoWhatsApp(c)] };
  if (/^(levar|o que levar)$/.test(s)) return { textos: [textoLevar(c)] };
  const cmd = comandoWhatsApp(c, texto);
  if (!cmd) return null;
  if (cmd.acao === "sair") { await sair(t, dono); return { textos: ["Tudo bem, parei o acompanhamento. Quando quiser retomar, escreva *ACOMPANHAR*. 🙂"] }; }
  const r = await responder(t, est, cmd, { registrar: registrarEvento });
  if (r.erro) return { textos: [`⚠️ ${r.erro}`] };
  const textos = [];
  for (const a of r.avisos || []) {
    if (!criarLembreteWA) continue;
    const tipo = a.lembrete;
    const ok = await criarLembreteWA(tipo, a.data, a.final).catch(() => false);
    const o = { DEFESA: "do prazo da defesa", CNH: "do vencimento da CNH", TRANSFERENCIA: "do prazo da transferência", LICENCIAMENTO: "do vencimento do licenciamento" }[tipo] || "do prazo";
    if (ok) textos.push(`🔔 Pronto: vou te lembrar ${o} aqui no WhatsApp.`);
  }
  const cf = cartao(t, r.est);
  textos.push(textoWhatsApp(cf));
  if (cf.concluida) {
    await kvSetEx(pesqK, `jornada:${cf.jornada.id}`, 86400).catch(() => {});
    textos.push("Uma pergunta rápida: isso evitou uma ida (ou uma volta) ao DETRAN? Responda *SIM* ou *NÃO*.");
  }
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
