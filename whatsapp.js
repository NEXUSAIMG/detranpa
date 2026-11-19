// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp por DETRAN: ponte Zapayio <-> BotAyio (mesmo desenho do Seu Cartório).
//
//   Cidadão -> Zapayio (webhook do DETRAN) -> app -> BotAyio (bot do DETRAN)
//           -> app -> Zapayio (envio) -> Cidadão
//
// Cada DETRAN tem a própria instância do Zapayio e o próprio bot no BotAyio,
// cadastrados em TenantIntegracao (segredos cifrados). O webhook de cada um é:
//   POST /api/t/<slug>/zapayio/webhook/<segredo>
//
// Zapayio (OnZap) usa a mesma estrutura de rotas da Z-API; só muda a URL base.
// ─────────────────────────────────────────────────────────────────────────────

import { kvSetNxEx, kvGetStr, kvSetEx } from "./store.js";
import { comTenant, integracoes, statusIntegracoes } from "./lib/tenants.js";
import { exigir } from "./lib/auth.js";
import { mesmoSegredo } from "./lib/cripto.js";
import { perguntarAoBot, textoComBotoes } from "./lib/botayio.js";
import { registrarTroca, registrarEvento } from "./lib/registro.js";

const SESSAO_HORAS = Number(process.env.WHATSAPP_SESSAO_HORAS || 12);
const FALLBACK_ERRO = "Tivemos uma instabilidade momentânea no atendimento automático. Pode reenviar tua mensagem em instantes, por favor?";
const AVISO_SO_TEXTO = "Por enquanto eu só consigo ler mensagens escritas. 🙂 Me conta por texto o que tu precisa resolver que eu te ajudo!";

// ── Zapayio (envio) ─────────────────────────────────────────────────────────
async function zapayio(z, method, rota, body) {
  if (!z.instanceId || !z.token) throw new Error("Zapayio não configurado para este DETRAN");
  const headers = { "Content-Type": "application/json" };
  if (z.clientToken) headers["client-token"] = z.clientToken; // vazio é rejeitado
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(`${z.baseUrl}/instances/${z.instanceId}/token/${z.token}${rota}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal,
    });
    const txt = await r.text();
    let data = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
    if (!r.ok) throw new Error(`Zapayio HTTP ${r.status}: ${String(txt).slice(0, 200)}`);
    return data;
  } finally { clearTimeout(timer); }
}
const enviarTexto = (z, phone, message) => zapayio(z, "POST", "/send-messages", { phone, message });
function enviarDocumento(z, phone, url, nome, caption = "") {
  const ext = (String(nome || url).split("?")[0].match(/\.([a-z0-9]{2,5})$/i) || [, "pdf"])[1].toLowerCase();
  return zapayio(z, "POST", `/send-document/${ext}`, { phone, document: url, fileName: nome || `documento.${ext}`, caption });
}
const digitando = (z, phone, on) => zapayio(z, "PUT", on ? "/start-typing" : "/stop-typing", { phone }).catch(() => {});

// ── Leitura do webhook ──────────────────────────────────────────────────────
const soDigitos = (s) => String(s || "").replace(/\D/g, "");
// Telefones reais têm 10 a 13 dígitos. LID (identificador interno do WhatsApp,
// 15+ dígitos) não é telefone: aceitar criaria conversa "fantasma".
const telefonePlausivel = (d) => d.length >= 10 && d.length <= 13;

export function lerMensagem(p) {
  if (!p || typeof p !== "object") return { ignorar: "sem payload" };
  const bruto = String(p.phone || "");
  if (p.type && p.type !== "ReceivedCallback") return { ignorar: `type=${p.type}` };
  if (p.fromMe === true) return { ignorar: "fromMe" };
  if (p.isGroup === true || bruto.endsWith("@g.us") || bruto.includes("@broadcast") || p.isNewsletter === true)
    return { ignorar: "grupo/broadcast" };
  if (p.isStatusReply === true) return { ignorar: "resposta a status" };
  const phone = soDigitos(bruto);
  if (!telefonePlausivel(phone)) return { ignorar: `telefone implausível (${phone.length} dígitos)` };
  const texto = String(
    p.text?.message || p.image?.caption || p.video?.caption || p.document?.caption ||
    p.buttonsResponseMessage?.message || p.listResponseMessage?.title || ""
  ).trim();
  const temMidia = Boolean(p.audio || p.image || p.video || p.document || p.sticker);
  return { phone, texto, temMidia, messageId: String(p.messageId || ""), nome: p.senderName || p.chatName || "" };
}

// Marcadores do bot que no WhatsApp viram texto comum (ou somem).
export function adaptarParaWhatsApp(texto, { slug }) {
  let t = String(texto || "");
  const base = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");
  t = t.replace(/\[\[FORM:([a-z0-9-]+)\]\]/gi, (_, id) => base ? `📄 Preencha o documento aqui: ${base}/${slug}?doc=${id.toLowerCase()}` : "");
  t = t.replace(/\[\[(DEFESA|SEMBASE)\]\]/gi, "");
  return t.split(/\[\[BREAK\]\]/g).map((s) => s.replace(/\n{3,}/g, "\n\n").trim()).filter(Boolean);
}

async function processarMensagem(tenant, m) {
  const { zapayio: z, botayio: b } = integracoes(tenant);
  const { phone, texto } = m;
  if (!texto) {
    if (m.temMidia) await enviarTexto(z, phone, AVISO_SO_TEXTO).catch((e) => console.warn("[Zapayio]", e.message));
    return { status: "sem texto" };
  }
  const sessionId = `detran-${tenant.slug}-${phone}`;
  const lastKey = `detran:${tenant.slug}:wa:last:${phone}`;
  const anterior = await kvGetStr(lastKey).catch(() => null);
  const restart = !anterior;
  await kvSetEx(lastKey, String(Date.now()), Math.round(SESSAO_HORAS * 3600)).catch(() => {});

  digitando(z, phone, true);
  let resp;
  try {
    resp = await perguntarAoBot(b, sessionId, texto, restart);
  } catch (err) {
    console.error(`[BotAyio:${tenant.slug}]`, err.message);
    digitando(z, phone, false);
    await enviarTexto(z, phone, FALLBACK_ERRO).catch(() => {});
    registrarEvento({ tenantId: tenant.id, tipo: "PERGUNTA", canal: "WHATSAPP", tema: "erro", resolvido: false });
    return { status: "erro botayio", erro: err.message };
  }
  digitando(z, phone, false);

  const enviadosTxt = [];
  let enviados = 0;
  for (const item of resp.contents || []) {
    try {
      for (const parte of adaptarParaWhatsApp(textoComBotoes(item), tenant)) {
        await enviarTexto(z, phone, parte); enviados++; enviadosTxt.push(parte);
      }
      if (item.arquivo?.url) { await enviarDocumento(z, phone, item.arquivo.url, item.arquivo.nome); enviados++; enviadosTxt.push(`[arquivo] ${item.arquivo.nome || item.arquivo.url}`); }
    } catch (err) {
      console.error("[Zapayio] falha no envio:", err.message);
    }
  }
  const transbordo = Boolean(resp.handed_off);
  await Promise.all([
    registrarTroca({ tenantId: tenant.id, canal: "WHATSAPP", contato: phone, nome: m.nome, pergunta: texto, respostas: enviadosTxt, categoria: resp.categoria, transbordo }),
    registrarEvento({ tenantId: tenant.id, tipo: "PERGUNTA", canal: "WHATSAPP", tema: resp.categoria || "outros", resolvido: true, transbordo }),
  ]);
  return { status: "ok", restart, enviados, handedOff: transbordo, categoria: resp.categoria || null };
}

// ── Rotas ───────────────────────────────────────────────────────────────────
export function registrarWhatsApp(app) {
  // Webhook que o Zapayio do DETRAN chama a cada mensagem recebida.
  app.post("/api/t/:slug/zapayio/webhook/:segredo", comTenant, async (req, res) => {
    const { zapayio: z } = integracoes(req.tenant);
    if (!mesmoSegredo(req.params.segredo, z.webhookSecret)) return res.status(403).json({ error: "segredo inválido" });
    const m = lerMensagem(req.body);
    if (m.ignorar) return res.json({ ok: true, ignorado: m.ignorar });
    // O Zapayio reenvia quando demora: a mesma mensagem só é processada uma vez.
    if (m.messageId) {
      const nova = await kvSetNxEx(`detran:${req.tenant.slug}:wa:msg:${m.messageId}`, "1", 86400).catch(() => true);
      if (!nova) return res.json({ ok: true, ignorado: "duplicada" });
    }
    try {
      res.json({ ok: true, ...(await processarMensagem(req.tenant, m)) });
    } catch (err) {
      console.error("[WhatsApp]", err);
      res.json({ ok: false, erro: "falha interna" }); // 200: evita reenvio em loop
    }
  });

  // Situação da instância do Zapayio deste DETRAN.
  app.get("/api/t/:slug/zapayio/status", comTenant, exigir("admin"), async (req, res) => {
    const { zapayio: z } = integracoes(req.tenant);
    try { res.json({ ...statusIntegracoes(req.tenant), instancia: await zapayio(z, "GET", "/status") }); }
    catch (err) { res.status(502).json({ ...statusIntegracoes(req.tenant), error: err.message }); }
  });

  // Aponta o webhook da instância do Zapayio para este DETRAN.
  app.post("/api/t/:slug/zapayio/configurar-webhook", comTenant, exigir("admin"), async (req, res) => {
    const { zapayio: z } = integracoes(req.tenant);
    if (!z.webhookSecret) return res.status(400).json({ error: "Cadastre o segredo do webhook deste DETRAN antes." });
    const base = (process.env.PUBLIC_URL || `https://${req.headers["x-forwarded-host"] || req.headers.host}`).replace(/\/+$/, "");
    const url = `${base}/api/t/${req.tenant.slug}/zapayio/webhook/${z.webhookSecret}`;
    try {
      await zapayio(z, "PUT", "/update-every-webhooks", { value: url, notifySentByMe: false });
      res.json({ ok: true, webhook: url.replace(z.webhookSecret, "***") });
    } catch (err) { res.status(502).json({ error: err.message }); }
  });
}
