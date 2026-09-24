const mongoose = require('mongoose');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const FREE_ITEMS = ['azul', 'claro', 'escuro'];
const BCRYPT_ROUNDS = 10;

// Código de recuperação: 12 caracteres sem ambíguos (O/0, I/1), mostrado como XXXX-XXXX-XXXX.
// 32^12 ≈ 2^60 combinações; junto com o limite de tentativas, não dá para adivinhar.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12;

/** Maiúsculas e sem traços/espaços, para "k7qf 2mzp-9xht" valer igual a "K7QF-2MZP-9XHT". */
function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function generateCode() {
  const chars = Array.from({ length: CODE_LENGTH }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]);
  return chars.join('').match(/.{4}/g).join('-');
}

// Comparação falsa quando o usuário não existe, para a resposta demorar o mesmo tanto.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), BCRYPT_ROUNDS);

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    displayName: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    recoveryHash: { type: String, default: null }, // hash do código de recuperação
    coins: { type: Number, default: 50, min: 0 },
    ownedItems: { type: [String], default: () => [...FREE_ITEMS] },
    activeTheme: { type: String, default: 'azul' },
    activeAvatar: { type: String, default: 'mascara' },
    stats: {
      matches: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

userSchema.methods.checkPassword = function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

userSchema.methods.setPassword = async function (password) {
  this.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
};

/** Gera um código novo (o anterior deixa de valer). Retorna o código em texto, que só é mostrado uma vez. */
userSchema.methods.issueRecoveryCode = async function () {
  const code = generateCode();
  this.recoveryHash = await bcrypt.hash(normalizeCode(code), BCRYPT_ROUNDS);
  return code;
};

userSchema.methods.checkRecoveryCode = function (code) {
  return bcrypt.compare(normalizeCode(code), this.recoveryHash || DUMMY_HASH);
};

/** Para quando o usuário não existe: gasta o mesmo tempo de uma verificação real. */
userSchema.statics.fakeCheck = function () {
  return bcrypt.compare('x', DUMMY_HASH);
};

userSchema.statics.register = async function ({ username, password }) {
  const user = new this({ username, displayName: username });
  await user.setPassword(password);
  const recoveryCode = await user.issueRecoveryCode();
  await user.save();
  return { user, recoveryCode };
};

// Itens de preço 0 são de todos
userSchema.methods.owns = function (item) {
  return item.price === 0 || this.ownedItems.includes(item.key);
};

module.exports = mongoose.model('User', userSchema);
module.exports.FREE_ITEMS = FREE_ITEMS;
