const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;

// Tipos aceitos -> extensão salva em disco.
const MIME_EXT = {
  'video/webm': 'webm',
  'video/mp4': 'mp4',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
};

const FILE_RE = /^[a-f0-9]{32}\.(webm|mp4|m4a|ogg)$/;

function baseMime(contentType) {
  return String(contentType || '').split(';')[0].trim().toLowerCase();
}

async function saveMedia(buffer, mime) {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const file = `${crypto.randomBytes(16).toString('hex')}.${MIME_EXT[mime]}`;
  await fs.writeFile(path.join(UPLOAD_DIR, file), buffer);
  return { file, mime, kind: mime.startsWith('video/') ? 'video' : 'audio' };
}

function deleteMedia(file) {
  if (!FILE_RE.test(file)) return Promise.resolve();
  return fs.unlink(path.join(UPLOAD_DIR, file)).catch(() => {});
}

module.exports = { UPLOAD_DIR, MAX_UPLOAD_BYTES, MIME_EXT, FILE_RE, baseMime, saveMedia, deleteMedia };
