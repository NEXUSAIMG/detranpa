// Observatório de demandas (Central de Gestão): o que o cidadão está perguntando,
// o que o bot não soube responder, golpes conferidos e o que está em alta —
// comparando o período escolhido com o período anterior do mesmo tamanho.
// Só leitura; dado pessoal mascarado; simulação nunca entra (não é gravada).
import { prisma } from "./db.js";
import { comTenant } from "./tenants.js";
import { exigir } from "./auth.js";
import { mascarar } from "./tutoria-gestao.js";
import { indicadoresRede, benchmarkAnonimo } from "./rede.js";

const TZ = "America/Sao_Paulo"; // Belém e Goiânia: UTC-3 o ano todo
const PARTES_DATA = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", hour12: false });
const DIAS_SEMANA = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const STOP = new Set(("a o e é de do da dos das em no na nos nas um uma uns umas que se para pra pro por com como meu minha " +
  "meus minhas eu tu voce você ele ela isso esse essa este esta aqui ai aí la lá ja já nao não sim mais menos muito pouco " +
  "tem ter tenho tinha foi ser estou esta está estão sao são vai vou quero queria preciso precisa posso pode bom boa dia tarde " +
  "noite oi ola olá obrigado obrigada ok certo entao então qual quais quando onde quanto quanta porque pq q tá ta to tô sobre " +
  "também tambem ainda depois antes agora hoje fazer faço faz feito dele dela deles nesse nessa num numa ao aos à às pelo pela " +
  "detran pa go favor gostaria saber alguem alguém ou mas mesmo cada outro outra seu sua seus suas lhe").split(/\s+/));

const normalizar = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function termos(texto) {
  const semLinks = String(texto || "").replace(/https?:\/\/\S+|www\.\S+|\b\S+\.(com|net|org|br|xyz|online|site|ly|me|io|info|top|click)\b\S*/gi, " ");
  const palavras = normalizar(mascarar(semLinks)).replace(/\[[^\]]+\]/g, " ").replace(/[^a-z\s]/g, " ").split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
  const out = new Set(palavras);
  for (let i = 0; i < palavras.length - 1; i++) out.add(`${palavras[i]} ${palavras[i + 1]}`);
  return out;
}

const variacao = (a, b) => (b ? Math.round(((a - b) / b) * 100) : a ? null : 0);

export function montarObservatorio({ eventos, mensagens, balcao, dias, agora = Date.now() }) {
  const corte = agora - dias * 86400_000;
  const atual = (d) => new Date(d).getTime() >= corte;

  const temas = {};
  const canais = { WEB: 0, WHATSAPP: 0 };
  const calor = Array.from({ length: 7 }, () => Array(24).fill(0));
  const golpes = { golpe: 0, atencao: 0, sem_sinais: 0 };
  const lacunas = new Map();
  let perg = 0, pergAnt = 0, semBase = 0, transb = 0, up = 0, down = 0, golpesAnt = 0;

  for (const e of eventos) {
    const now = atual(e.criadoEm);
    if (e.tipo === "PERGUNTA") {
      const tema = e.tema || "outros";
      const t = (temas[tema] ||= { tema, atual: 0, anterior: 0, semBase: 0, transbordo: 0 });
      if (!now) { t.anterior++; pergAnt++; continue; }
      t.atual++; perg++;
      if (e.resolvido === false) { t.semBase++; semBase++; }
      if (e.transbordo) { t.transbordo++; transb++; }
      canais[e.canal] = (canais[e.canal] || 0) + 1;
      const p = Object.fromEntries(PARTES_DATA.formatToParts(new Date(e.criadoEm)).map((x) => [x.type, x.value]));
      const h = Number(p.hour) % 24, d = DIAS_SEMANA[p.weekday] ?? 0;
      calor[d][h]++;
    } else if (e.tipo === "GOLPE") {
      if (!now) { if (e.tema === "golpe") golpesAnt++; continue; }
      if (e.tema in golpes) golpes[e.tema]++;
    } else if (e.tipo === "SEMBASE" && now && e.tema) {
      const chave = normalizar(e.tema).replace(/\s+/g, " ").trim();
      const l = lacunas.get(chave) || { pergunta: e.tema, vezes: 0, ultima: 0 };
      l.vezes++; l.ultima = Math.max(l.ultima, new Date(e.criadoEm).getTime());
      lacunas.set(chave, l);
    } else if (e.tipo === "FEEDBACK" && now) {
      if (e.positivo) up++; else down++;
    }
  }

  // Termos em alta: em quantas mensagens o termo aparece (agora x antes).
  const cntA = new Map(), cntB = new Map(), freq = new Map();
  for (const m of mensagens) {
    const alvo = atual(m.criadoEm) ? cntA : cntB;
    for (const w of termos(m.texto)) alvo.set(w, (alvo.get(w) || 0) + 1);
    if (atual(m.criadoEm)) {
      const n = normalizar(mascarar(m.texto)).replace(/[^\w\s[\]]/g, " ").replace(/\s+/g, " ").trim();
      if (n.length >= 10 && n.length <= 140) {
        const f = freq.get(n) || { pergunta: mascarar(m.texto).replace(/\s+/g, " ").trim().slice(0, 140), vezes: 0 };
        f.vezes++; freq.set(n, f);
      }
    }
  }
  const emAlta = [...cntA.entries()].filter(([, a]) => a >= 3)
    .map(([termo, a]) => ({ termo, atual: a, anterior: cntB.get(termo) || 0, forca: (a + 1) / ((cntB.get(termo) || 0) + 1) }))
    .filter((x) => x.atual > x.anterior)
    .sort((x, y) => y.forca - x.forca || y.atual - x.atual)
    // bigrama já cobre a palavra solta: tira palavra que está dentro de um bigrama listado
    .filter((x, i, arr) => x.termo.includes(" ") || !arr.slice(0, i).some((y) => y.termo.includes(" ") && y.termo.split(" ").includes(x.termo)))
    .slice(0, 12)
    .map(({ termo, atual: a, anterior: b }) => ({ termo, atual: a, anterior: b, variacao: variacao(a, b) }));
  const maisFalados = [...cntA.entries()].filter(([w]) => !w.includes(" ")).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([termo, n]) => ({ termo, n }));

  const servicos = {};
  for (const b of balcao) if (atual(b.criadoEm)) { const s = (b.servico || "Não informado").trim(); servicos[s] = (servicos[s] || 0) + 1; }

  return {
    dias,
    resumo: {
      perguntas: perg, perguntasAntes: pergAnt, variacao: variacao(perg, pergAnt),
      semBase, taxaSemBase: perg ? Math.round((semBase / perg) * 100) : 0,
      transbordos: transb, taxaTransbordo: perg ? Math.round((transb / perg) * 100) : 0,
      golpesConferidos: golpes.golpe + golpes.atencao + golpes.sem_sinais, golpesProvaveis: golpes.golpe,
      golpesVariacao: variacao(golpes.golpe, golpesAnt),
      satisfacao: up + down ? Math.round((up / (up + down)) * 100) : null, avaliacoes: up + down,
    },
    temas: Object.values(temas).filter((t) => t.atual || t.anterior)
      .map((t) => ({ ...t, variacao: variacao(t.atual, t.anterior) })).sort((a, b) => b.atual - a.atual),
    canais, calor, golpes,
    lacunas: [...lacunas.values()].sort((a, b) => b.vezes - a.vezes || b.ultima - a.ultima).slice(0, 15),
    perguntasFrequentes: [...freq.values()].filter((f) => f.vezes >= 2).sort((a, b) => b.vezes - a.vezes).slice(0, 10),
    emAlta, maisFalados,
    balcao: Object.entries(servicos).map(([servico, n]) => ({ servico, n })).sort((a, b) => b.n - a.n).slice(0, 10),
  };
}

export function registrarObservatorio(app) {
  // Gestores e administradores (o balcão não vê o observatório).
  app.get("/api/t/:slug/gestao/observatorio", comTenant, exigir("painel"), async (req, res) => {
    const dias = [7, 30, 90].includes(Number(req.query.dias)) ? Number(req.query.dias) : 30;
    const tenantId = req.tenant.id;
    const desde = new Date(Date.now() - 2 * dias * 86400_000);
    try {
      const [eventos, mensagens, balcao] = await Promise.all([
        prisma.evento.findMany({ where: { tenantId, criadoEm: { gte: desde } },
          select: { tipo: true, canal: true, tema: true, resolvido: true, positivo: true, transbordo: true, criadoEm: true } }),
        prisma.mensagem.findMany({ where: { autor: "CIDADAO", criadoEm: { gte: desde }, conversa: { tenantId } },
          select: { texto: true, criadoEm: true }, orderBy: { criadoEm: "desc" }, take: 8000 }),
        prisma.atendimentoBalcao.findMany({ where: { tenantId, criadoEm: { gte: desde } }, select: { servico: true, criadoEm: true }, take: 5000 }),
      ]);
      const ob = montarObservatorio({ eventos, mensagens, balcao, dias });
      // Comparação anônima com a rede (média dos outros DETRANs, sem nomes).
      try {
        const lista = await indicadoresRede(dias);
        ob.rede = { voce: lista.find((x) => x.slug === req.tenant.slug) || null, media: benchmarkAnonimo(lista, req.tenant.slug) };
      } catch (e) { ob.rede = { media: { disponivel: false, motivo: "Comparação indisponível agora." } }; }
      res.json(ob);
    } catch (err) {
      console.error("[observatorio]", err.message);
      res.status(500).json({ error: "Não foi possível montar o observatório agora." });
    }
  });
}
