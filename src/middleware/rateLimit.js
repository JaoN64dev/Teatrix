const { rateLimit } = require('express-rate-limit');

const MINUTE = 60 * 1000;

// As rotas marcam res.locals.authOk = true quando dá certo (login feito, conta criada...).
const succeeded = (req, res) => res.locals.authOk === true;

/** Para formulários: avisa com flash e volta para a mesma página. */
function formLimiter({ windowMs, limit, message, ...options }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => {
      req.flash('error', message);
      res.redirect(req.originalUrl);
    },
    ...options,
  });
}

// Login: só conta tentativas que falharam (senha errada), por IP.
const loginLimiter = formLimiter({
  windowMs: 15 * MINUTE,
  limit: 10,
  message: 'Muitas tentativas de login. Espere 15 minutos e tente de novo.',
  requestWasSuccessful: succeeded,
  skipSuccessfulRequests: true,
});

// Cadastro: só conta contas criadas (errar o formulário não bloqueia ninguém).
const registerLimiter = formLimiter({
  windowMs: 60 * MINUTE,
  limit: 5,
  message: 'Muitas contas criadas daqui. Tente de novo mais tarde.',
  requestWasSuccessful: succeeded,
  skipFailedRequests: true,
});

// Recuperação e troca de código: o código é uma "senha reserva", então o limite é mais apertado.
const recoveryLimiter = formLimiter({
  windowMs: 15 * MINUTE,
  limit: 5,
  message: 'Muitas tentativas. Espere 15 minutos e tente de novo.',
  requestWasSuccessful: succeeded,
  skipSuccessfulRequests: true,
});

// Gravações: por usuário (a rota já exige login).
const uploadLimiter = rateLimit({
  windowMs: MINUTE,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => req.user.id,
  handler: (req, res) => res.status(429).json({ error: 'Muitos envios seguidos. Espere um pouco.' }),
});

module.exports = { loginLimiter, registerLimiter, recoveryLimiter, uploadLimiter };
