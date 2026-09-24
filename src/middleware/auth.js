function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  // Volta para esta página depois do login (ex.: link ou QR code de uma sala).
  // Imagens/arquivos (ex.: o QR code) não contam: voltar para eles depois do login não faz sentido.
  // (Só navegação de página pede text/html explicitamente; <img> manda */*.)
  const isPage = (req.get('accept') || '').includes('text/html');
  if (req.method === 'GET' && isPage) req.session.returnTo = req.originalUrl;
  req.flash('error', 'Faça login para continuar.');
  return res.redirect('/login');
}

function ensureGuest(req, res, next) {
  if (!req.isAuthenticated()) return next();
  return res.redirect('/');
}

module.exports = { ensureAuth, ensureGuest };
