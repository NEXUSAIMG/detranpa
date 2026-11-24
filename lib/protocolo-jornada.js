// Protocolo no fim da jornada (24/11/2026).
//
// Ao concluir uma jornada no site, o cidadão envia o pedido ao DETRAN: os dados
// da jornada, os prazos e as fotos/PDFs dos documentos viram um CHAMADO da
// Central de Gestão daquele DETRAN, com número de protocolo (UF-AAAA-NNNNNN),
// prazo pelo SLA e aviso no WhatsApp a cada mudança de situação.
// Ainda não há ligação com o sistema oficial do DETRAN: quando houver API, o
// chamado passa a ser também enviado para lá.
//
// Anexos: tabela chamado_anexo, criada sozinha (como a kv_estado), sem migração.
import { randomUUID } from "node:crypto";
import { prisma } from "./db.js";
import { comTenant } from "./tenants.js";
import { exigir } from "./auth.js";
import { configDe, STATUS_TEXTO } from "./gestao-config.js";
import { JORNADAS, lerJornada, gravar, cartao, donoValido, formTitulo } from "./jornadas.js";
import { kvGetStr, kvSetEx, kvDel } from "../store.js";
// Igual a protocoloDe (gestao.js); repetido aqui para não criar import circular
// (gestao -> privacidade -> protocolo-jornada).
const protocoloDe = (t, n, ano = new Date().getFullYear()) => `${t.uf}-${ano}-${String(n).padStart(6, "0")}`;

const MAX_ANEXOS = 6;
const MAX_ARQUIVO = 2_500_000; // bytes, depois de decodificar
const MAX_TOTAL = 4_000_000; // a Vercel aceita ~4,5 MB por pedido
const TIPOS = { "image/jpeg": [0xff, 0xd8], "image/png": [0x89, 0x50], "image/webp": [0x52, 0x49], "application/pdf": [0x25, 0x50] };

export const CATEGORIA_JORNADA = {
  venda: "Veículos", compra: "Veículos", endereco: "Veículos", licenciamento: "Licenciamento e IPVA",
  renovacao: "Habilitação (CNH)", primeira: "Habilitação (CNH)", segundavia: "Habilitação (CNH)", defesa: "Multas e recursos",
};

let tabela = null;
export async function garantirTabelaAnexos() {
  if (!tabela) {
    tabela = prisma.$executeRawUnsafe(
      "CREATE TABLE IF NOT EXISTS chamado_anexo (id VARCHAR(40) NOT NULL, tenantId VARCHAR(30) NOT NULL, chamadoId VARCHAR(30) NOT NULL, nome VARCHAR(200) NOT NULL, mime VARCHAR(60) NOT NULL, tamanho INT NOT NULL, dados MEDIUMBLOB NOT NULL, criadoEm DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (id), INDEX chamado_anexo_ch (chamadoId), INDEX chamado_anexo_t (tenantId, criadoEm)) DEFAULT CHARSET=utf8mb4"
    ).catch((e) => { tabela = null; throw e; });
  }
  await tabela;
}

// Telefone brasileiro só com dígitos, com 55 na frente.
export function normalizarFone(v) {
  let d = String(v || "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return /^55\d{10,11}$/.test(d) ? d : null;
}

// Arquivo em base64 (com ou sem "data:...;base64,") -> { nome, mime, dados } ou erro.
export function lerAnexo(a) {
  const nome = String(a?.nome || "documento").replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 120) || "documento";
  const mime = String(a?.mime || "").toLowerCase();
  if (!TIPOS[mime]) return { erro: `"${nome}": envie foto (JPG, PNG, WEBP) ou PDF.` };
  let dados = a?.dados;
  if (!Buffer.isBuffer(dados)) {
    const b64 = String(a?.base64 || "").replace(/^data:[^,]*,/, "");
    try { dados = Buffer.from(b64, "base64"); } catch { return { erro: `"${nome}": arquivo inválido.` }; }
  }
  if (!dados.length) return { erro: `"${nome}": arquivo vazio.` };
  if (dados.length > MAX_ARQUIVO) return { erro: `"${nome}" passa de 2,5 MB. Tire a foto de novo ou envie um PDF menor.` };
  const [m0, m1] = TIPOS[mime];
  if (dados[0] !== m0 || dados[1] !== m1) return { erro: `"${nome}": o conteúdo não confere com o tipo do arquivo.` };
  return { nome, mime, dados };
}

const brData = (s) => String(s).slice(0, 10).split("-").reverse().join("/");

// Texto do chamado: o que a pessoa respondeu em cada etapa, prazos e documentos.
export function descricaoPedido(t, est, { nome, cpf, telefone, observacao, anexos, canal = "site" }) {
  const j = JORNADAS[est.jornada];
  const c = cartao(t, est);
  const linhas = [`Pedido enviado pelo cidadão ao fim da jornada "${j.titulo}", ${canal === "whatsapp" ? "pelo WhatsApp" : "no site"}.`];
  if (t.demonstracao) linhas.push("AMBIENTE DE DEMONSTRAÇÃO: não é um pedido oficial.");
  linhas.push("", `Cidadão: ${nome}`);
  if (cpf) linhas.push(`CPF: ${cpf}`);
  if (telefone) linhas.push(`WhatsApp para avisos: ${telefone}`);
  const respostas = [];
  for (const e of j.etapas) {
    if (e.so && !e.so(est.dados)) continue;
    const v = e.salvarEm ? est.dados[e.salvarEm] : null;
    if (v == null || v === "") continue;
    const rot = e.opcoes ? e.opcoes.find((o) => o.id === String(v))?.rotulo || v : e.tipo === "data" ? brData(v) : v;
    respostas.push(`- ${e.titulo}: ${rot}`);
  }
  if (respostas.length) linhas.push("", "Respostas na jornada:", ...respostas);
  if (c.prazos.length) linhas.push("", "Prazos:", ...c.prazos.map((p) => `- ${p.rotulo}: ${p.dataBR}`));
  const docs = (j.formularios ? j.formularios(est.dados) : []).map(formTitulo);
  if (docs.length) linhas.push("", `Documentos preenchíveis desta jornada: ${docs.join(", ")}.`);
  if (anexos.length) linhas.push("", `Anexos (${anexos.length}): ${anexos.map((a) => a.nome).join(", ")}.`);
  else linhas.push("", "Sem anexos.");
  if (observacao) linhas.push("", "Observação do cidadão:", observacao);
  return linhas.join("\n").slice(0, 8000);
}

// Cria o chamado (com protocolo e anexos) e guarda o número na jornada. Site e WhatsApp.
export async function criarPedido(t, est, { nome, cpf, telefone, observacao, anexos, canal = "site" }) {
  if (anexos.length) await garantirTabelaAnexos();
  const cfg = configDe(t);
  const j = JORNADAS[est.jornada];
  const onde = canal === "whatsapp" ? "pelo WhatsApp" : "pelo site";
  const autor = canal === "whatsapp" ? "Cidadão (WhatsApp)" : "Cidadão (site)";
  const seq = await prisma.tenant.update({ where: { id: t.id }, data: { protocoloSeq: { increment: 1 } }, select: { protocoloSeq: true, uf: true } });
  const protocolo = protocoloDe(seq, seq.protocoloSeq);
  const prazo = new Date(Date.now() + (cfg.slaHoras.NORMAL || 72) * 3600_000);
  const categoria = cfg.categorias.includes(CATEGORIA_JORNADA[j.id]) ? CATEGORIA_JORNADA[j.id] : null;
  const ch = await prisma.chamado.create({
    data: {
      tenantId: t.id, numero: seq.protocoloSeq, protocolo, canal: "WHATSAPP", contato: telefone, nome,
      assunto: `${j.titulo} (pedido ${onde})`.slice(0, 160),
      descricao: descricaoPedido(t, est, { nome, cpf, telefone, observacao, anexos, canal }),
      categoria, prioridade: "NORMAL", prazoEm: prazo, avisarCidadao: true, criadoPorNome: autor,
      eventos: { create: [{ tipo: "ABERTURA", autorNome: autor, texto: `Pedido recebido ${onde}${anexos.length ? `, com ${anexos.length} anexo(s)` : ""}.`, publico: true }] },
    },
  });
  for (const a of anexos) {
    await prisma.$executeRawUnsafe(
      "INSERT INTO chamado_anexo (id, tenantId, chamadoId, nome, mime, tamanho, dados) VALUES (?, ?, ?, ?, ?, ?, ?)",
      randomUUID(), t.id, ch.id, a.nome, a.mime, a.dados.length, a.dados,
    );
  }
  est.dados.protocolo = protocolo;
  est.dados.protocoloEm = new Date().toISOString();
  await gravar(t.slug, est);
  return { protocolo, prazo, chamadoId: ch.id };
}

// ── WhatsApp ──
// PROTOCOLAR (com a jornada concluída) -> nome -> CPF (ou PULAR) -> fotos/PDFs
// (um por mensagem, PRONTO no fim) -> SIM -> protocolo. CANCELAR a qualquer hora.
// Estado curto no KV (1 h): só os links dos arquivos, baixados no SIM.
const chaveWA = (t, phone) => `proto-wa:${t.slug}:${phone}`;
const normWA = (s) => String(s || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.!]+$/, "");
const fmtCpf = (d) => `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
const MIME_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

// Só baixa de endereço https público (o link vem do WhatsApp; nada de rede interna).
export function urlBaixavel(u) {
  try {
    const x = new URL(String(u));
    if (x.protocol !== "https:") return false;
    const h = x.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":")) return false; // IP literal
    return true;
  } catch { return false; }
}

async function baixarAnexo(a, baixar) {
  if (!urlBaixavel(a.url)) throw new Error("endereço não permitido");
  const r = await baixar(a.url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const dados = Buffer.from(await r.arrayBuffer());
  return lerAnexo({ nome: a.nome, mime: a.mime, dados });
}

// m = lerMensagem(...) (texto, anexo?). Devolve { textos } quando é do protocolo; senão null.
export async function tratarProtocoloWhatsApp(t, phone, m, { baixar = (u) => fetch(u, { signal: AbortSignal.timeout(20000) }) } = {}) {
  const s = normWA(m.texto);
  const k = chaveWA(t, phone);
  let st = null;
  try { st = JSON.parse((await kvGetStr(k)) || "null"); } catch { st = null; }
  const sigla = t.sigla || "DETRAN";

  if (!st) {
    if (s !== "protocolar") return null;
    const est = await lerJornada(t.slug, `wa:${phone}`);
    if (!est || !JORNADAS[est.jornada] || !cartao(t, est).concluida) {
      return { textos: [`Para protocolar no ${sigla}, primeiro conclua um acompanhamento passo a passo. Escreva *MENU* para escolher o serviço ou *ACOMPANHAR*.`] };
    }
    if (est.dados.protocolo) return { textos: [`Este pedido já foi protocolado: *${est.dados.protocolo}*. Para ver a situação, mande: *protocolo ${est.dados.protocolo}*`] };
    await kvSetEx(k, JSON.stringify({ etapa: "nome", anexos: [] }), 3600);
    const aviso = t.demonstracao ? "\n\n⚠️ _Ambiente de demonstração: o pedido vai para a Central de demonstração e não é um pedido oficial._" : "";
    return { textos: [`📨 Vamos protocolar o seu pedido de *${JORNADAS[est.jornada].titulo}* no ${sigla}.${aviso}\n\nQual é o seu *nome completo*?\n_(CANCELAR para desistir)_`] };
  }

  const salvar = (novo) => kvSetEx(k, JSON.stringify(novo), 3600);
  if (s === "cancelar") { await kvDel(k); return { textos: ["Tudo bem, cancelei o protocolo. Quando quiser, é só escrever *PROTOCOLAR*."] }; }

  if (st.etapa === "nome") {
    const nome = String(m.texto || "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (nome.length < 5 || !/\s/.test(nome) || /\d/.test(nome)) return { textos: ["Preciso do seu *nome completo* (nome e sobrenome)."] };
    await salvar({ ...st, etapa: "cpf", nome });
    return { textos: ["Qual é o seu *CPF*? Se preferir não informar, responda *PULAR*."] };
  }
  if (st.etapa === "cpf") {
    const dig = String(m.texto || "").replace(/\D/g, "");
    if (s !== "pular" && dig.length !== 11) return { textos: ["O CPF tem 11 números. Mande de novo ou responda *PULAR*."] };
    await salvar({ ...st, etapa: "anexos", cpf: s === "pular" ? "" : fmtCpf(dig) });
    return { textos: [`Agora mande as *fotos ou PDFs dos documentos* (até ${MAX_ANEXOS}), um por mensagem.\nQuando terminar, escreva *PRONTO*. Sem documentos para mandar? Escreva *PRONTO* também.`] };
  }
  if (st.etapa === "anexos") {
    if (m.anexo) {
      if (!MIME_EXT[m.anexo.mime]) return { textos: ["Esse tipo de arquivo eu não consigo juntar. Mande foto (JPG ou PNG) ou PDF."] };
      if (st.anexos.length >= MAX_ANEXOS) return { textos: [`Já são ${MAX_ANEXOS} arquivos, o máximo. Escreva *PRONTO* para seguir.`] };
      const n = st.anexos.length + 1;
      const nome = (m.anexo.nome || `documento-${n}`).replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 100);
      st.anexos.push({ url: m.anexo.url, mime: m.anexo.mime, nome: /\.[a-z0-9]{2,4}$/i.test(nome) ? nome : `${nome}.${MIME_EXT[m.anexo.mime]}` });
      await salvar(st);
      return { textos: [`📎 Recebi (${n} de até ${MAX_ANEXOS}). Mande o próximo ou escreva *PRONTO*.`] };
    }
    if (s !== "pronto") return { textos: ["Mande a foto ou o PDF do documento, ou escreva *PRONTO* para seguir."] };
    await salvar({ ...st, etapa: "confirmar" });
    return { textos: [`Confira:\n• Nome: ${st.nome}\n${st.cpf ? `• CPF: ${st.cpf}\n` : ""}• Arquivos: ${st.anexos.length}\n\nResponda *SIM* para autorizar o envio dos seus dados e documentos ao ${sigla} para a análise deste pedido. Os arquivos são apagados 60 dias depois de encerrado o pedido.\n_(CANCELAR para desistir)_`] };
  }
  if (st.etapa === "confirmar") {
    if (!/^(sim|s|autorizo)$/.test(s)) return { textos: ["Responda *SIM* para enviar o pedido, ou *CANCELAR*."] };
    const est = await lerJornada(t.slug, `wa:${phone}`);
    if (!est || !JORNADAS[est.jornada]) { await kvDel(k); return { textos: ["Não encontrei o acompanhamento deste pedido. Escreva *MENU* para começar de novo."] }; }
    if (est.dados.protocolo) { await kvDel(k); return { textos: [`Este pedido já foi protocolado: *${est.dados.protocolo}*.`] }; }
    const anexos = [], falhas = [];
    for (const a of st.anexos) {
      const r = await baixarAnexo(a, baixar).catch((e) => ({ erro: `"${a.nome}": não consegui baixar (${e.message}).` }));
      if (r.erro) falhas.push(r.erro); else anexos.push(r);
    }
    if (anexos.reduce((x, a) => x + a.dados.length, 0) > 12_000_000) return { textos: ["Os arquivos juntos ficaram grandes demais. Escreva *CANCELAR* e mande menos arquivos."] };
    const telefone = normalizarFone(phone) || phone;
    const { protocolo, prazo } = await criarPedido(t, est, { nome: st.nome, cpf: st.cpf, telefone, observacao: "", anexos, canal: "whatsapp" });
    await kvDel(k);
    const textos = [`✅ Pedido protocolado no ${sigla}: *${protocolo}*\nPrevisão de resposta: ${prazo.toLocaleDateString("pt-BR")}.\nVocê recebe aqui os avisos de cada mudança. Para consultar: *protocolo ${protocolo}*`];
    if (falhas.length) textos.push(`⚠️ Alguns arquivos não foram juntados:\n${falhas.join("\n")}\nSe precisar, o ${sigla} pede de novo por aqui.`);
    return { textos };
  }
  await kvDel(k);
  return null;
}

export function registrarProtocoloJornada(app, { limitar, avisarWhatsApp } = {}) {
  const J = "/api/t/:slug/jornadas";
  const dono = (req) => { const d = `web:${String(req.query.sessao || req.body?.sessao || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 48)}`; return donoValido(d) ? d : null; };

  app.post(`${J}/protocolar`, comTenant, async (req, res) => {
    const d = dono(req); if (!d) return res.status(400).json({ error: "Sessão inválida." });
    if (limitar && limitar(`proto:${req.tenant.slug}:${req.ip}`, 5)) return res.status(429).json({ error: "Muitos pedidos seguidos. Aguarde alguns minutos." });
    const t = req.tenant;
    const est = await lerJornada(t.slug, d);
    if (!est || !JORNADAS[est.jornada]) return res.status(404).json({ error: "Nenhuma jornada em andamento." });
    if (!cartao(t, est).concluida) return res.status(400).json({ error: "Conclua as etapas antes de enviar o pedido." });
    if (est.dados.protocolo) return res.json({ ok: true, protocolo: est.dados.protocolo, repetido: true });

    const b = req.body || {};
    const nome = String(b.nome || "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (nome.length < 5 || !/\s/.test(nome)) return res.status(400).json({ error: "Informe o nome completo." });
    const telefone = normalizarFone(b.telefone);
    if (!telefone) return res.status(400).json({ error: "Informe um WhatsApp com DDD, para receber o número do protocolo e os avisos." });
    const cpfDig = String(b.cpf || "").replace(/\D/g, "");
    if (cpfDig && cpfDig.length !== 11) return res.status(400).json({ error: "CPF com 11 números, ou deixe em branco." });
    const cpf = cpfDig ? `${cpfDig.slice(0, 3)}.${cpfDig.slice(3, 6)}.${cpfDig.slice(6, 9)}-${cpfDig.slice(9)}` : "";
    if (b.consentimento !== true) return res.status(400).json({ error: "Marque a autorização para enviar seus dados e documentos ao DETRAN." });
    const observacao = String(b.observacao || "").trim().slice(0, 1500);
    const brutos = Array.isArray(b.anexos) ? b.anexos : [];
    if (brutos.length > MAX_ANEXOS) return res.status(400).json({ error: `Envie no máximo ${MAX_ANEXOS} arquivos.` });
    const anexos = [];
    for (const a of brutos) { const r = lerAnexo(a); if (r.erro) return res.status(400).json({ error: r.erro }); anexos.push(r); }
    if (anexos.reduce((s, a) => s + a.dados.length, 0) > MAX_TOTAL) return res.status(400).json({ error: "Os arquivos juntos passam de 4 MB. Envie menos fotos ou fotos menores." });

    try {
      const j = JORNADAS[est.jornada];
      const { protocolo, prazo } = await criarPedido(t, est, { nome, cpf, telefone, observacao, anexos, canal: "site" });
      let avisou = false;
      if (avisarWhatsApp) {
        try {
          avisou = await avisarWhatsApp(t, telefone,
            `📋 Recebemos o seu pedido: *${protocolo}* (${j.titulo}).\nPrevisão de resposta: ${prazo.toLocaleDateString("pt-BR")}.\n\nPara acompanhar, mande aqui: *protocolo ${protocolo}*`);
        } catch { avisou = false; }
      }
      res.status(201).json({ ok: true, protocolo, prazoEm: prazo, avisou, demonstracao: Boolean(t.demonstracao) });
    } catch (e) {
      console.error("[protocolo]", t.slug, String(e?.message || e).slice(0, 200));
      res.status(500).json({ error: "Não foi possível enviar o pedido agora. Tente de novo em alguns minutos." });
    }
  });

  // Situação do pedido desta sessão (só o protocolo que ela mesma abriu).
  app.get(`${J}/protocolo`, comTenant, async (req, res) => {
    const d = dono(req); if (!d) return res.status(400).json({ error: "Sessão inválida." });
    const est = await lerJornada(req.tenant.slug, d);
    const p = est?.dados?.protocolo;
    if (!p) return res.json({ protocolo: null });
    const ch = await prisma.chamado.findFirst({ where: { tenantId: req.tenant.id, protocolo: p } });
    if (!ch) return res.json({ protocolo: p, status: null });
    const ev = await prisma.chamadoEvento.findMany({ where: { chamadoId: ch.id, publico: true }, orderBy: { criadoEm: "asc" } });
    res.json({ protocolo: p, status: ch.status, statusTexto: STATUS_TEXTO[ch.status] || ch.status, prazoEm: ch.prazoEm, eventos: ev.map((e) => ({ texto: e.texto, em: e.criadoEm })) });
  });

  // Central de Gestão: anexos do chamado.
  const G = "/api/t/:slug/gestao/chamados/:id/anexos";
  const doTenant = (req) => prisma.chamado.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id }, select: { id: true } });
  app.get(G, comTenant, exigir("gestao"), async (req, res) => {
    try {
      if (!(await doTenant(req))) return res.status(404).json({ error: "Chamado não encontrado neste DETRAN." });
      await garantirTabelaAnexos();
      const r = await prisma.$queryRawUnsafe("SELECT id, nome, mime, tamanho, criadoEm FROM chamado_anexo WHERE chamadoId = ? AND tenantId = ? ORDER BY criadoEm", req.params.id, req.tenant.id);
      res.json({ anexos: r.map((a) => ({ ...a, tamanho: Number(a.tamanho) })) });
    } catch (e) { console.error("[anexos]", e?.message); res.status(500).json({ error: "Erro ao listar os anexos." }); }
  });
  app.get(`${G}/:aid`, comTenant, exigir("gestao"), async (req, res) => {
    try {
      if (!(await doTenant(req))) return res.status(404).json({ error: "Chamado não encontrado neste DETRAN." });
      await garantirTabelaAnexos();
      const r = await prisma.$queryRawUnsafe("SELECT nome, mime, dados FROM chamado_anexo WHERE id = ? AND chamadoId = ? AND tenantId = ?", req.params.aid, req.params.id, req.tenant.id);
      if (!r[0]) return res.status(404).json({ error: "Anexo não encontrado." });
      res.set({ "Content-Type": r[0].mime, "Content-Disposition": `inline; filename="${encodeURIComponent(r[0].nome)}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
      res.send(Buffer.from(r[0].dados));
    } catch (e) { console.error("[anexos]", e?.message); res.status(500).json({ error: "Erro ao abrir o anexo." }); }
  });
}

// LGPD: anexos de chamados encerrados há mais de `dias`, ou de um cidadão (contato).
export async function apagarAnexos(tenantId, { encerradosAntesDe, contato } = {}) {
  try {
    await garantirTabelaAnexos();
    if (contato) {
      return Number(await prisma.$executeRawUnsafe(
        "DELETE a FROM chamado_anexo a JOIN Chamado c ON c.id = a.chamadoId WHERE a.tenantId = ? AND c.contato = ?", tenantId, contato));
    }
    if (encerradosAntesDe) {
      return Number(await prisma.$executeRawUnsafe(
        "DELETE a FROM chamado_anexo a JOIN Chamado c ON c.id = a.chamadoId WHERE a.tenantId = ? AND c.status IN ('RESOLVIDO','CANCELADO') AND c.resolvidoEm < ?", tenantId, encerradosAntesDe));
    }
  } catch (e) { console.warn("[anexos] limpeza:", e?.message); }
  return 0;
}
