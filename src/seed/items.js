const Item = require('../models/Item');

const THEMES = [
  { key: 'azul', name: 'Azul & Amarelo', type: 'theme', price: 0, description: 'O tema padrão.', data: { preview: ['#dbeafe', '#ffec99', '#1f4fd6'] } },
  { key: 'claro', name: 'Claro', type: 'theme', price: 0, description: 'Clarinho e aconchegante.', data: { preview: ['#fdf8f0', '#2b2118', '#e4572e'] } },
  { key: 'escuro', name: 'Escuro', type: 'theme', price: 0, description: 'Para jogar de madrugada.', data: { preview: ['#17151c', '#ece8f4', '#ff7a59'] } },
  { key: 'pastel', name: 'Pastel', type: 'theme', price: 80, description: 'Que nem um beiço.', data: { preview: ['#fff0f6', '#4a3a55', '#b983ff'] } },
  { key: 'retro', name: 'Retrô', type: 'theme', price: 100, description: 'PC GAMER.', data: { preview: ['#f4e9d8', '#3a2e39', '#1b998b'] } },
  { key: 'neon', name: 'Neon', type: 'theme', price: 120, description: 'Brilha no escuro.', data: { preview: ['#0b0b1a', '#e0fbff', '#00f0ff'] } },
  { key: 'teatro', name: 'Teatro', type: 'theme', price: 150, description: 'Palco do faustão.', data: { preview: ['#2a0a10', '#f7e7c6', '#d4a017'] } },
];

// Avatares: use `emoji` OU `src` (PNG em public/img/avatars/). `bg` é opcional.
const AVATARS = [
  { key: 'mascara', name: 'Máscara', type: 'avatar', price: 0, description: 'VIVA O TEATRIX .', data: { emoji: '🎭', bg: '#ffe3e3' } },
  { key: 'raposa', name: 'Raposa', type: 'avatar', price: 60, description: 'Que que ela fala.', data: { emoji: '🦊', bg: '#ffd8a8' } },
  { key: 'fantasma', name: 'Fantasma', type: 'avatar', price: 90, description: 'Buuu.', data: { emoji: '👻', bg: '#e5dbff' } },
  { key: 'coroa', name: 'Coroa', type: 'avatar', price: 150, description: 'Rei.', data: { emoji: '👑', bg: '#fff3bf' } },
  { key: 'flamengo', name: 'Flamingo', type: 'avatar', price: 10, description: 'Não é flamengo.', data: { src: '/img/avatars/akko.png' } },
  // { key: 'estrela', name: 'Estrela', type: 'avatar', price: 200, description: 'Brilha no palco.', data: { src: '/img/avatars/estrela.png' } },
];

const ITEMS = [...THEMES, ...AVATARS];

for (const { key, data } of AVATARS) {
  if (Boolean(data.emoji) === Boolean(data.src)) {
    throw new Error(`Avatar "${key}": defina exatamente um entre data.emoji e data.src.`);
  }
}

const avatarsByKey = new Map(AVATARS.map((a) => [a.key, a]));

async function seedItems() {
  await Item.bulkWrite(
    ITEMS.map((item) => ({
      // $set substitui o `data` inteiro, então trocar emoji por src não deixa lixo.
      updateOne: { filter: { key: item.key }, update: { $set: item }, upsert: true },
    }))
  );

  await Item.deleteMany({ key: { $nin: ITEMS.map((i) => i.key) } });
}

// Avatar pelo key, caindo no padrão se o item tiver saído da loja.
seedItems.getAvatar = (key) => avatarsByKey.get(key) || avatarsByKey.get('mascara');

module.exports = seedItems;
