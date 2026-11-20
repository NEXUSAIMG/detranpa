// Gera a base de conhecimento (Markdown) do BotAyio a partir do catálogo de serviços.
// Uso: node scripts/gerar-base-botayio.mjs   -> docs/base-botayio-<uf>.md
//
// A base vai para o bot REAL, então leva só informação real: passo a passo,
// requisitos e documentos de cada serviço, e taxas APENAS quando têm fonte
// pública (as demais viram "valor informado no boleto"). Empresas, lotes de
// leilão, vans e agendas fictícias da simulação ficam de fora.
import { mkdirSync, writeFileSync } from "node:fs";
import { catalogo } from "../lib/simulacao-servicos.js";
import { orgaosDe } from "../lib/simulacao.js";

const brl = (n) => "R$ " + Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DETRANS = {
  pa: {
    t: { slug: "pa", uf: "PA", sigla: "DETRAN-PA", nome: "Departamento de Trânsito do Estado do Pará", cidadeSede: "Belém/PA" },
    // taxas com fonte pública (base detalhada do projeto, portal e imprensa — 2026)
    taxasComFonte: { "vei-transf-prop": 274.69, "vei-transf-uf": 274.69, "vei-emplacamento": 45.78, "cnh-jurisdicao": 149.72 },
    extras: [
      "## Informações gerais do DETRAN-PA",
      "- Pagamentos pelo **DAE** (Documento de Arrecadação Estadual). Bancos: Banco do Brasil, Banpará, Banco da Amazônia, Bradesco, Itaú, Santander.",
      "- **Licenciamento anual (TRLAV):** R$ 214,51 (2026). Calendário por final de placa, de março a novembro. Sem IPVA pago (SEFA) o CRLV-e não sai.",
      "- **Vistoria veicular:** de R$ 32,05 a R$ 68,67 conforme a categoria. Não há vistoria anual obrigatória para veículo particular.",
      "- **Defesa de autuação e recurso à JARI:** pelo **Portal Venus** (cidadao.detran.pa.gov.br), login gov.br prata/ouro. O Venus só trata autuações do DETRAN-PA; DER-PA, PRF e prefeituras (SEMOB) têm canal próprio. 2ª instância: CETRAN-PA.",
      "- **IPVA é da SEFA-PA** (0800-725-5533): desconto na cota única de 15% (sem multas em 2 anos), 10% (sem multas no último ano) ou 5%; parcelamento em até 3x.",
      "- **Atendimento:** Call Center 154 (dentro do PA), Belém (91) 3289-7500. Presencial seg–sex, 9h às 15h: Sede (Av. Augusto Montenegro, km 3), postos avançados nos shoppings Castanheira, Boulevard e Parque, Estações Cidadania e CIRETRANs.",
      "- **Serviços online:** emissão de DAE, CRLV-e, intenção de venda e cancelamento, comunicação de venda, AET, SISDAT (acidente sem vítimas), parcelamento no cartão, CNH definitiva e 2ª via, leilões virtuais.",
    ],
  },
  go: {
    t: { slug: "go", uf: "GO", sigla: "DETRAN-GO", nome: "Departamento Estadual de Trânsito de Goiás", cidadeSede: "Goiânia/GO" },
    taxasComFonte: { "cnh-renovacao": 194.67, "cnh-primeira": 289.25 },
    extras: [
      "## Informações gerais do DETRAN-GO",
      "- Pagamentos pelo **DUA** (Documento Único de Arrecadação), gerado no portal, no app Detran GO ON, no Portal Expresso ou no Vapt Vupt.",
      "- **IPVA (Economia-GO) e licenciamento:** cota única com 8% de desconto até 15/01; parcelamento em até 9 (finais 1 e 2) ou 10 parcelas; cota única sem desconto até 15/09 (finais 1 e 2) ou 15/10 (finais 3 a 0). O licenciamento pode ser parcelado junto com o IPVA.",
      "- **Renovação da CNH:** DUA de R$ 194,67; exame médico pago à clínica credenciada; psicológico só para quem exerce atividade remunerada; toxicológico para C, D e E. O 1º reteste é gratuito.",
      "- **Recursos de multa:** defesa prévia e JARI pelo Protocolo Digital ou app; 2ª instância: CETRAN-GO. Multas de GOINFRA, PRF, DNIT e prefeituras (SMM Goiânia, SMTA Aparecida, CMTT Anápolis) têm formulário próprio.",
      "- **Atendimento presencial:** unidades Vapt Vupt, postos Expresso e sede do DETRAN-GO, com agendamento.",
    ],
  },
};

// Só diz "gratuito" o que é sabidamente sem taxa (recursos, comunicações, ouvidoria...).
const GRATIS = new Set(["mul-defesa", "mul-jari", "mul-cetran", "cnh-condutor", "vei-venda", "vei-intencao-venda", "vei-intencao-cancelar",
  "atd-sisdat", "atd-ouvidoria", "atd-esic", "atd-fale", "vei-2via-crlv", "vei-endereco", "mul-divida-defesa", "cnh-pai-degua"]);
DETRANS.go.gratis = ["cnh-troca", "atd-estacionamento"]; // GO: CNH definitiva digital gratuita; cartão idoso/PcD
const fora = new Set(["cnh-dados", "vei-consulta", "mul-debitos", "cer-processo", "atd-filas", "atd-agendar", "cer-validar", "atd-leilao", "atd-itinerante", "vei-placas", "vei-escolar", "mul-parcelamento", "atd-achados"]);

mkdirSync(new URL("../docs/", import.meta.url), { recursive: true });
for (const [slug, cfg] of Object.entries(DETRANS)) {
  const o = orgaosDe(cfg.t);
  const lista = catalogo(cfg.t).filter((s) => !fora.has(s.id));
  const linhas = [
    `# Serviços do ${cfg.t.sigla} — guia para o assistente`,
    "",
    `> Base gerada em ${new Date().toLocaleDateString("pt-BR")} a partir do mapeamento dos serviços do ${cfg.t.sigla}. Valores em R$ só aparecem quando têm fonte pública; nos demais casos o valor é o do boleto (${o.guia}). Sempre oriente a confirmar no portal oficial.`,
    "",
    ...cfg.extras,
    "",
  ];
  const cats = [...new Set(lista.map((s) => s.cat))];
  for (const cat of cats) {
    linhas.push(`## ${cat}`, "");
    for (const s of lista.filter((x) => x.cat === cat)) {
      linhas.push(`### ${s.nome}`, "", s.desc);
      if (s.requisitos?.length) linhas.push("", "**Requisitos:**", ...s.requisitos.map((r) => `- ${r}`));
      if (s.anexos?.length) linhas.push("", "**Documentos:**", ...s.anexos.map((r) => `- ${r}`));
      if (s.etapas?.length && s.tipo === "protocolo") linhas.push("", "**Etapas:**", ...s.etapas.map((e, i) => `${i + 1}. ${e}`));
      if (s.tipo === "protocolo") {
        const v = cfg.taxasComFonte[s.id];
        const gratis = GRATIS.has(s.id) || (cfg.gratis || []).includes(s.id);
        linhas.push("", `**Taxa:** ${v ? `${brl(v)} (${o.guia})` : gratis ? "gratuito" : s.taxaVariavel || `quando houver, valor informado no boleto (${o.guia})`}`);
      }
      linhas.push("");
    }
  }
  const arq = new URL(`../docs/base-botayio-${slug}.md`, import.meta.url);
  // Nada de marcas da simulação na base do bot real.
  const texto = linhas.join("\n").replace(/\s*\((simulad[oa]|fictíci[oa]s?)\)/gi, "");
  writeFileSync(arq, texto);
  console.log(`${cfg.t.sigla}: ${lista.length} serviços -> docs/base-botayio-${slug}.md`);
}
