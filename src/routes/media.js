const express = require('express');
const path = require('path');
const Match = require('../models/Match');
const roomManager = require('../game/RoomManager');
const { ensureAuth } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimit');
const { UPLOAD_DIR, MAX_UPLOAD_BYTES, MIME_EXT, FILE_RE, baseMime, saveMedia, deleteMedia } = require('../game/media');

const router = express.Router();

/**
 * Confere tudo ANTES de ler o corpo: sem isso, qualquer conta logada podia mandar
 * vários arquivos de 60 MB para qualquer código de sala e lotar a memória do servidor.
 */
function uploadGate(req, res, next) {
  const room = roomManager.get(req.params.code);
  if (!room) return res.status(404).json({ error: 'Sala não encontrada.' });

  const userId = req.user.id;
  const early = room.canSubmitPerformance(userId);
  if (early) return res.status(409).json({ error: early });

  const mime = baseMime(req.get('content-type'));
  if (!MIME_EXT[mime]) return res.status(415).json({ error: 'Formato de gravação não suportado.' });

  const length = Number(req.get('content-length'));
  if (length > MAX_UPLOAD_BYTES) {
    return res.status(413).json({ error: 'Gravação grande demais. Tente uma gravação mais curta.' });
  }

  // Um envio por vez por jogador.
  if (room.uploading.has(userId)) return res.status(409).json({ error: 'Sua gravação já está sendo enviada.' });
  room.uploading.add(userId);
  res.on('close', () => room.uploading.delete(userId));

  req.room = room;
  req.mediaMime = mime;
  return next();
}

// Recebe a gravação (corpo cru, Content-Type audio/* ou video/*).
router.post(
  '/room/:code/performance',
  ensureAuth,
  uploadLimiter,
  uploadGate,
  express.raw({ type: ['audio/*', 'video/*'], limit: MAX_UPLOAD_BYTES }),
  async (req, res, next) => {
    try {
      const { room, mediaMime: mime } = req;
      const userId = req.user.id;
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'Gravação vazia.' });
      }

      const media = await saveMedia(req.body, mime);
      const error = room.submitPerformance(userId, media);
      if (error) {
        await deleteMedia(media.file);
        return res.status(409).json({ error });
      }
      return res.json({ ok: true });
    } catch (err) {
      return next(err);
    }
  },
  // eslint-disable-next-line no-unused-vars
  (err, req, res, next) => {
    const tooLarge = err.type === 'entity.too.large';
    res.status(tooLarge ? 413 : 500).json({
      error: tooLarge ? 'Gravação grande demais. Tente uma gravação mais curta.' : 'Falha ao enviar a gravação.',
    });
  }
);

// Só quem participou da partida pode ver/ouvir as gravações.
router.get('/media/:file', ensureAuth, async (req, res, next) => {
  try {
    const { file } = req.params;
    if (!FILE_RE.test(file)) return res.sendStatus(404);

    const allowed =
      roomManager.canAccessMedia(req.user.id, file) ||
      (await Match.exists({ 'entries.media.file': file, 'players.user': req.user._id }));
    if (!allowed) return res.sendStatus(404);

    return res.sendFile(
      path.join(UPLOAD_DIR, file),
      { headers: { 'Cache-Control': 'private, max-age=86400' } },
      (err) => {
        if (err && !res.headersSent) res.sendStatus(err.status || 404);
      }
    );
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
