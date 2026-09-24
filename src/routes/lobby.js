const express = require('express');
const QRCode = require('qrcode');
const roomManager = require('../game/RoomManager');
const { ensureAuth } = require('../middleware/auth');
const schemas = require('../validation/schemas');

const router = express.Router();

router.get('/', ensureAuth, (req, res) => res.render('home', { title: 'Início' }));

// Modo local: um aparelho passado entre os jogadores; roda todo no navegador.
router.get('/local', ensureAuth, (req, res) => res.render('local', { title: 'Modo local' }));

router.post('/rooms', ensureAuth, (req, res) => {
  const room = roomManager.create(req.user);
  res.redirect(`/room/${room.code}`);
});

router.post('/rooms/join', ensureAuth, schemas.validate(schemas.joinRoom, '/'), (req, res) => {
  const { code } = req.body;
  if (!roomManager.get(code)) {
    req.flash('error', 'Sala não encontrada.');
    return res.redirect('/');
  }
  return res.redirect(`/room/${code}`);
});

router.get('/room/:code', ensureAuth, (req, res) => {
  const code = req.params.code.toUpperCase();
  if (!roomManager.get(code)) {
    req.flash('error', 'Essa sala não existe mais.');
    return res.redirect('/');
  }
  return res.render('room', { title: `Sala ${code}`, code });
});

// QR code com o link da sala, para entrar apontando a câmera do celular.
router.get('/room/:code/qr.svg', ensureAuth, async (req, res, next) => {
  try {
    const code = req.params.code.toUpperCase();
    if (!roomManager.get(code)) return res.sendStatus(404);
    const url = `${req.protocol}://${req.get('host')}/room/${code}`;
    const svg = await QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
    return res.type('image/svg+xml').set('Cache-Control', 'private, max-age=3600').send(svg);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
