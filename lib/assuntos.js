// Serviços por assunto (24/11/2026): a mesma lista no site ("Do que você precisa?")
// e no WhatsApp (MENU). Serviço com `j` abre a jornada; os demais viram a pergunta `q`.
// Um DETRAN pode trocar a lista em conteudo.assuntos (Admin -> Conteúdo da tela).
import { iniciar, cartao, textoWhatsApp, JORNADAS } from "./jornadas.js";
import { kvGetStr, kvSetEx, kvDel } from "../store.js";
import { ASSUNTOS_PADRAO } from "./assuntos-dados.js";

export { ASSUNTOS_PADRAO };

export const assuntosDo = (t) => (Array.isArray(t?.conteudo?.assuntos) && t.conteudo.assuntos.length ? t.conteudo.assuntos : ASSUNTOS_PADRAO);

const norm = (s) => String(s || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.!?]+$/, "");
const chave = (t, phone) => `menu-wa:${t.slug}:${phone}`;
export const ehComandoMenu = (texto) => /^(menu|servicos|servico|opcoes|assuntos|inicio)$/.test(norm(texto));

function textoAssuntos(lista) {
  return `📋 *Do que você precisa?* Responda com o número:\n${lista.map((a, i) => `*${i + 1}* — ${a.icone || ""} ${a.titulo}`.replace("  ", " ")).join("\n")}\n\n_Ou escreva a sua pergunta com as suas palavras._`;
}
function textoItens(a) {
  return `${a.icone || ""} *${a.titulo}* — responda com o número:\n${a.itens.map((it, i) => `*${i + 1}* — ${it.t}${it.j ? " 🧭" : ""}`).join("\n")}\n\n🧭 = te acompanho passo a passo · *0* = voltar aos assuntos`;
}

// Devolve { textos } (o menu respondeu), { pergunta } (segue para o assistente com essa
// pergunta) ou null (não é do menu). Estado curto: 15 min.
export async function tratarMenuWhatsApp(t, phone, texto) {
  const lista = assuntosDo(t);
  const s = norm(texto);
  if (ehComandoMenu(texto)) {
    await kvSetEx(chave(t, phone), JSON.stringify({ nivel: "assuntos" }), 900).catch(() => {});
    return { textos: [textoAssuntos(lista)] };
  }
  let st = null;
  try { st = JSON.parse((await kvGetStr(chave(t, phone))) || "null"); } catch { st = null; }
  if (!st || !/^\d{1,2}$/.test(s)) {
    if (st && !/^\d{1,2}$/.test(s)) await kvDel(chave(t, phone)).catch(() => {}); // escreveu outra coisa: sai do menu
    return null;
  }
  const n = Number(s);
  if (st.nivel === "assuntos") {
    const a = lista[n - 1];
    if (!a) return { textos: [`Não encontrei a opção ${n}. ${textoAssuntos(lista)}`] };
    await kvSetEx(chave(t, phone), JSON.stringify({ nivel: "itens", assunto: a.id }), 900).catch(() => {});
    return { textos: [textoItens(a)] };
  }
  const a = lista.find((x) => x.id === st.assunto);
  if (!a) { await kvDel(chave(t, phone)).catch(() => {}); return null; }
  if (n === 0) {
    await kvSetEx(chave(t, phone), JSON.stringify({ nivel: "assuntos" }), 900).catch(() => {});
    return { textos: [textoAssuntos(lista)] };
  }
  const it = a.itens[n - 1];
  if (!it) return { textos: [`Não encontrei a opção ${n}. ${textoItens(a)}`] };
  await kvDel(chave(t, phone)).catch(() => {});
  if (it.j && JORNADAS[it.j]) {
    const est = await iniciar(t, `wa:${phone}`, it.j, { canal: "WHATSAPP" });
    return { textos: [textoWhatsApp(cartao(t, est))] };
  }
  return { pergunta: it.q || it.t };
}
