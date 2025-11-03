// utilitário simples para construir URLs sem gerar '//' duplicados
// usado pelo frontend para compor NEXT_PUBLIC_API_URL com rotas
function joinUrl(base, path) {
  if (!base && !path) return '';
  if (!base) return path || '';
  if (!path) return base.replace(/\/+$|^(\s*)$/g, '');
  const b = String(base).trim().replace(/\/+$/, '');
  const p = String(path).trim().replace(/^\/+|\/+$/g, '');
  return `${b}/${p}`;
}

module.exports = {
  joinUrl,
};

// Export default for ESM consumers
module.exports.default = module.exports.joinUrl;
