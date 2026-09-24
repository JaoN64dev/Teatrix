const { getAvatar } = require('../seed/items');

function locals(req, res, next) {
  const user = req.user;
  res.locals.user = user
    ? { id: user.id, name: user.displayName, coins: user.coins, avatar: getAvatar(user.activeAvatar) }
    : null;
  res.locals.theme = user?.activeTheme || 'azul';
  // O que foi digitado antes de um erro de formulário (sem senhas), ver validation/schemas.js.
  try {
    res.locals.old = JSON.parse(req.flash('old')[0] || '{}');
  } catch {
    res.locals.old = {};
  }
  res.locals.messages = {
    error: req.flash('error'),
    success: req.flash('success'),
  };
  next();
}

module.exports = locals;
