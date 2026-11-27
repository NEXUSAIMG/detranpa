// Texto do assistente para as telas internas (Central, Tutoria, Atendimento, Balcão).
// 27/11/2026 (teste dos estagiários): essas telas mostravam "**", "###" e [[BREAK]] crus.
// Escapa o HTML primeiro e só depois aplica a formatação, então é seguro com innerHTML.
(function () {
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // Tira a formatação e devolve texto puro (para copiar, imprimir ou pré-visualizar numa linha).
  function textoLimpo(s) {
    return String(s ?? "")
      .replace(/\[\[BREAK\]\]/g, "\n\n")
      .replace(/\[\[[A-Z][A-Z_:-]*[\w:-]*\]\]/g, "")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, "$1$2")
      .replace(/`([^`\n]+)`/g, "$1")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  function textoRico(s) {
    const linhas = String(s ?? "")
      .replace(/\[\[BREAK\]\]/g, "\n\n")
      .replace(/\[\[[A-Z][A-Z_:-]*[\w:-]*\]\]/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .split("\n");
    return linhas.map((l) => {
      let h = esc(l);
      const tit = /^\s{0,3}#{1,6}\s+(.*)$/.exec(h);
      if (tit) h = `<b>${tit[1]}</b>`;
      h = h.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
        .replace(/__(.+?)__/g, "<b>$1</b>")
        .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, "$1<b>$2</b>")
        .replace(/`([^`\n]+)`/g, "<code>$1</code>")
        .replace(/^\s*[-*•]\s+/, "• ")
        .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
      return h;
    }).join("<br>");
  }
  window.textoRico = textoRico;
  window.textoLimpo = textoLimpo;
})();
