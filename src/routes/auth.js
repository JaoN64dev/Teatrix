const express = require('express');
const passport = require('passport');
const User = require('../models/User');
const { ensureAuth, ensureGuest } = require('../middleware/auth');
const { loginLimiter, registerLimiter, recoveryLimiter } = require('../middleware/rateLimit');
const schemas = require('../validation/schemas');

const router = express.Router();

/** Para onde ir depois de entrar: a página que pediu login (ex.: link/QR de sala) ou o início. */
function takeReturnTo(req) {
  const url = req.session.returnTo;
  delete req.session.returnTo;
  // Só caminhos internos ("/sala"), nunca "//site.com" ou "/\site.com".
  return typeof url === 'string' && /^\/(?![/\\])/.test(url) ? url : '/';
}

/** Mostra o código de recuperação uma única vez, em GET /account/recovery-code. */
function showRecoveryCode(req, res, code) {
  req.session.recoveryCode = code;
  res.redirect('/account/recovery-code');
}

// ---------- entrar ----------

router.get('/login', ensureGuest, (req, res) => res.render('login', { title: 'Entrar' }));

router.post('/login', ensureGuest, loginLimiter, schemas.validate(schemas.login, '/login'), (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      req.flash('error', info?.message || 'Usuário ou senha incorretos.');
      schemas.keepInput(req, req.body);
      return res.redirect('/login');
    }
    // keepSessionInfo: a sessão é regenerada no login, mas o returnTo precisa sobreviver.
    return req.login(user, { keepSessionInfo: true }, (loginErr) => {
      if (loginErr) return next(loginErr);
      res.locals.authOk = true;
      return res.redirect(takeReturnTo(req));
    });
  })(req, res, next);
});

// ---------- criar conta ----------

router.get('/register', ensureGuest, (req, res) => res.render('register', { title: 'Criar conta' }));

router.post(
  '/register',
  ensureGuest,
  registerLimiter,
  schemas.validate(schemas.register, '/register'),
  async (req, res, next) => {
    try {
      const { username, password } = req.body;
      if (await User.exists({ username: username.toLowerCase() })) {
        req.flash('error', 'Esse nome de usuário já está em uso.');
        schemas.keepInput(req, req.body);
        return res.redirect('/register');
      }
      const { user, recoveryCode } = await User.register({ username, password });
      return req.login(user, { keepSessionInfo: true }, (err) => {
        if (err) return next(err);
        res.locals.authOk = true;
        req.flash('success', `Bem-vindo(a), ${user.displayName}! Você ganhou 50 moedas.`);
        return showRecoveryCode(req, res, recoveryCode);
      });
    } catch (err) {
      return next(err);
    }
  }
);

// ---------- esqueci a senha (com o código de recuperação) ----------

router.get('/forgot', ensureGuest, (req, res) => res.render('forgot', { title: 'Recuperar senha' }));

router.post('/forgot', ensureGuest, recoveryLimiter, schemas.validate(schemas.forgot, '/forgot'), async (req, res, next) => {
  try {
    const { username, code, password } = req.body;
    const user = await User.findOne({ username: username.toLowerCase() });
    const ok = user ? await user.checkRecoveryCode(code) : await User.fakeCheck();
    if (!ok) {
      // Mesma mensagem para usuário inexistente e código errado.
      req.flash('error', 'Usuário ou código de recuperação incorretos.');
      schemas.keepInput(req, req.body);
      return res.redirect('/forgot');
    }

    // O código usado deixa de valer: gera outro na hora.
    await user.setPassword(password);
    const newCode = await user.issueRecoveryCode();
    await user.save();

    return req.login(user, { keepSessionInfo: true }, (err) => {
      if (err) return next(err);
      res.locals.authOk = true;
      req.flash('success', 'Senha alterada! Guarde o seu novo código de recuperação.');
      return showRecoveryCode(req, res, newCode);
    });
  } catch (err) {
    return next(err);
  }
});

// ---------- código de recuperação ----------

router.get('/account/recovery-code', ensureAuth, (req, res) => {
  const code = req.session.recoveryCode;
  if (!code) return res.redirect('/profile'); // só aparece uma vez
  delete req.session.recoveryCode;
  res.set('Cache-Control', 'no-store'); // não fica no cache do navegador
  return res.render('recovery-code', { title: 'Código de recuperação', code, next: takeReturnTo(req) });
});

// Gera um código novo pelo perfil (pede a senha atual: quem só tem a sessão não consegue).
router.post(
  '/account/recovery-code',
  ensureAuth,
  recoveryLimiter,
  schemas.validate(schemas.confirmPassword, '/profile#recuperacao'),
  async (req, res, next) => {
    try {
      if (!(await req.user.checkPassword(req.body.password))) {
        req.flash('error', 'Senha incorreta.');
        return res.redirect('/profile#recuperacao');
      }
      const code = await req.user.issueRecoveryCode();
      await req.user.save();
      res.locals.authOk = true;
      req.session.returnTo = '/profile';
      return showRecoveryCode(req, res, code);
    } catch (err) {
      return next(err);
    }
  }
);

// ---------- sair ----------

router.post('/logout', ensureAuth, (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    return res.redirect('/login');
  });
});

module.exports = router;
