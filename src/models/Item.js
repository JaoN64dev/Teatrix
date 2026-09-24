const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  type: { type: String, enum: ['theme', 'avatar'], required: true },
  price: { type: Number, required: true, min: 0 },
  // theme:  { preview: [cores] }
  // avatar: { emoji: '🦊' } ou { src: '/img/avatars/raposa.png' }, com bg (cor de fundo) opcional
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
});

module.exports = mongoose.model('Item', itemSchema);
