const Joi = require('joi');

const username = Joi.string().trim().alphanum().min(3).max(20).required().messages({
  'string.alphanum': 'O usuário só pode ter letras e números.',
  'string.min': 'O usuário precisa ter pelo menos 3 caracteres.',
  'string.max': 'O usuário pode ter no máximo 20 caracteres.',
  'string.empty': 'Informe o usuário.',
  'any.required': 'Informe o usuário.',
});

// Senha nova (cadastro e recuperação). Contas antigas com 6-7 caracteres continuam entrando.
const newPassword = Joi.string()
  .min(8)
  .max(72)
  .required()
  .invalid(Joi.ref('username'))
  .messages({
    'string.min': 'A senha precisa ter pelo menos 8 caracteres.',
    'string.max': 'A senha pode ter no máximo 72 caracteres.',
    'string.empty': 'Informe a senha.',
    'any.required': 'Informe a senha.',
    'any.invalid': 'A senha não pode ser igual ao usuário.',
  });

const confirm = Joi.any().valid(Joi.ref('password')).required().messages({
  'any.only': 'As senhas não conferem.',
  'any.required': 'Confirme a senha.',
});

const register = Joi.object({ username, password: newPassword, confirm });

// No login só checamos o formato básico: a mensagem de erro é sempre a mesma.
const login = Joi.object({
  username: Joi.string().trim().max(20).required().messages({
    'string.empty': 'Informe o usuário.',
    'any.required': 'Informe o usuário.',
    'string.max': 'Usuário ou senha incorretos.',
  }),
  password: Joi.string().max(72).required().messages({
    'string.empty': 'Informe a senha.',
    'any.required': 'Informe a senha.',
    'string.max': 'Usuário ou senha incorretos.',
  }),
});

const recoveryCode = Joi.string().trim().max(30).required().messages({
  'string.empty': 'Informe o código de recuperação.',
  'any.required': 'Informe o código de recuperação.',
  'string.max': 'Código de recuperação inválido.',
});

const forgot = Joi.object({ username, code: recoveryCode, password: newPassword, confirm });

const confirmPassword = Joi.object({
  password: Joi.string().max(72).required().messages({
    'string.empty': 'Informe sua senha atual.',
    'any.required': 'Informe sua senha atual.',
    'string.max': 'Senha incorreta.',
  }),
});

const joinRoom = Joi.object({
  code: Joi.string().trim().uppercase().length(5).alphanum().required().messages({
    'string.length': 'O código da sala tem 5 caracteres.',
    'string.alphanum': 'O código da sala só tem letras e números.',
    'string.empty': 'Informe o código da sala.',
    'any.required': 'Informe o código da sala.',
  }),
});

// Campos que nunca voltam para o formulário depois de um erro.
const SECRET_FIELDS = ['password', 'confirm', 'code'];

/** Guarda o que foi digitado (menos senhas e códigos) para preencher o formulário de novo. */
function keepInput(req, values) {
  const kept = Object.fromEntries(
    Object.entries(values ?? {}).filter(([key, v]) => !SECRET_FIELDS.includes(key) && typeof v === 'string')
  );
  req.flash('old', JSON.stringify(kept));
}

// Valida req.body; em caso de erro, mostra a mensagem e volta para a página.
function validate(schema, redirectTo) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body ?? {}, { stripUnknown: true });
    if (error) {
      req.flash('error', error.details[0].message);
      keepInput(req, req.body);
      return res.redirect(redirectTo);
    }
    req.body = value;
    return next();
  };
}

module.exports = { register, login, forgot, confirmPassword, joinRoom, validate, keepInput };
