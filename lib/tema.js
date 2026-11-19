// ─────────────────────────────────────────────────────────────────────────────
// Identidade visual por DETRAN: transforma as duas cores do cadastro (marca e
// destaque) em um tema completo, garantindo contraste para texto branco, e
// gera a marca provisória (sigla) enquanto o logo oficial não é enviado.
// Sem cores cadastradas, vale a paleta da Ayio.
// ─────────────────────────────────────────────────────────────────────────────

export const PADRAO = { primaria: "#192662", destaque: "#14AD92" }; // Ayio

const hexOk = (h) => /^#?[0-9a-f]{6}$/i.test(String(h || "").trim());
function rgb(h) {
  const s = String(h).trim().replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}
const hex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();
const misturar = (a, b, t) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
const escurecer = (h, t) => misturar(h, "#000000", t);
function luminancia(h) {
  const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrasteComBranco = (h) => 1.05 / (luminancia(h) + 0.05);
// Escurece até o branco ficar legível em cima (WCAG AA: 4,5:1).
function legivelComBranco(h, alvo = 4.5) {
  let c = hex(rgb(h));
  for (let i = 0; i < 20 && contrasteComBranco(c) < alvo; i++) c = escurecer(c, 0.08);
  return c;
}

export function coresDoTenant(t) {
  const p = hexOk(t?.corPrimaria) ? "#" + t.corPrimaria.replace("#", "") : PADRAO.primaria;
  const d = hexOk(t?.corDestaque) ? "#" + t.corDestaque.replace("#", "") : PADRAO.destaque;
  const marca = legivelComBranco(p);          // topo, balões do cidadão, títulos
  const destaqueTexto = legivelComBranco(d);  // botões com texto branco, rótulos
  return {
    primaria: marca,
    destaque: hex(rgb(d)),                    // enviar, barras, realces
    destaqueTexto,
    fundoTopo: escurecer(marca, 0.45),
    fim: legivelComBranco(misturar(marca, d, 0.55), 3.2),
    claro: misturar(d, "#FFFFFF", 0.88),       // fundos suaves de destaque
  };
}

// Bloco <style> com as variáveis usadas por todas as telas do DETRAN.
export function cssDoTema(t) {
  const c = coresDoTenant(t);
  const grad = `linear-gradient(120deg, ${c.fundoTopo} 0%, ${c.primaria} 55%, ${c.fim} 100%)`;
  return `<style id="tema-detran">:root{` +
    `--ayio-navy:${c.primaria};--ayio-teal:${c.destaque};--ayio-teal-deep:${c.destaqueTexto};` +
    `--ayio-navy-deep:${c.fundoTopo};--ayio-grad:${grad};` +
    `--moss:${c.destaqueTexto};--moss-deep:${c.primaria};--moss-pale:${c.destaque};--t-claro:${c.claro};}</style>`;
}

// Marca provisória: sigla em um selo com as cores do DETRAN (original, sem
// imitar nenhum logo oficial). Usada até o logo oficial ser enviado.
export function marcaProvisoriaSvg(t, { grande = false } = {}) {
  const c = coresDoTenant(t);
  const uf = String(t?.uf || "").toUpperCase().slice(0, 2) || "BR";
  if (!grande) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${uf}">` +
      `<rect width="64" height="64" rx="14" fill="${c.primaria}"/>` +
      `<rect x="8" y="44" width="48" height="6" rx="3" fill="${c.destaque}"/>` +
      `<text x="32" y="36" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="26" font-weight="800" fill="#fff">${uf}</text></svg>`;
  }
  const sigla = String(t?.sigla || `DETRAN-${uf}`).replace(/[<&>"]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120" role="img" aria-label="${sigla}">` +
    `<rect x="84" y="4" width="72" height="72" rx="18" fill="${c.primaria}"/>` +
    `<rect x="94" y="56" width="52" height="7" rx="3.5" fill="${c.destaque}"/>` +
    `<text x="120" y="47" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="30" font-weight="800" fill="#fff">${uf}</text>` +
    `<text x="120" y="108" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="22" font-weight="800" fill="${c.primaria}" letter-spacing="1">${sigla}</text></svg>`;
}
