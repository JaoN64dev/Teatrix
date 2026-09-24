const express = require('express');
const Item = require('../models/Item');
const User = require('../models/User');
const { ensureAuth } = require('../middleware/auth');

const router = express.Router();

// Campo do usuário que guarda o item equipado de cada tipo.
const ACTIVE_FIELD = { theme: 'activeTheme', avatar: 'activeAvatar' };
const TYPE_LABEL = { theme: 'Tema', avatar: 'Avatar' };

router.get('/shop', ensureAuth, async (req, res, next) => {
  try {
    const items = await Item.find({ type: { $in: Object.keys(ACTIVE_FIELD) } }).sort({ price: 1 }).lean();
    const view = items.map((item) => ({
      ...item,
      owned: req.user.owns(item),
      equipped: req.user[ACTIVE_FIELD[item.type]] === item.key,
      affordable: req.user.coins >= item.price,
    }));
    res.render('shop', {
      title: 'Loja',
      themes: view.filter((i) => i.type === 'theme'),
      avatars: view.filter((i) => i.type === 'avatar'),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/shop/buy/:key', ensureAuth, async (req, res, next) => {
  try {
    const item = await Item.findOne({ key: req.params.key }).lean();
    if (!item) {
      req.flash('error', 'Item não encontrado.');
      return res.redirect('/shop');
    }
    if (req.user.owns(item)) {
      req.flash('error', 'Você já possui esse item.');
      return res.redirect('/shop');
    }
    // Compra atômica: só debita se tiver saldo e ainda não possuir o item.
    const result = await User.updateOne(
      { _id: req.user._id, coins: { $gte: item.price }, ownedItems: { $ne: item.key } },
      { $inc: { coins: -item.price }, $push: { ownedItems: item.key } }
    );
    if (result.modifiedCount === 0) {
      req.flash('error', 'Moedas insuficientes.');
    } else {
      req.flash('success', `Você comprou ${item.name}!`);
    }
    return res.redirect('/shop');
  } catch (err) {
    return next(err);
  }
});

router.post('/shop/equip/:key', ensureAuth, async (req, res, next) => {
  try {
    const back = req.body?.back === 'profile' ? '/profile' : '/shop';
    const item = await Item.findOne({ key: req.params.key, type: { $in: Object.keys(ACTIVE_FIELD) } }).lean();
    if (!item || !req.user.owns(item)) {
      req.flash('error', 'Você não possui esse item.');
      return res.redirect(back);
    }
    await User.updateOne({ _id: req.user._id }, { [ACTIVE_FIELD[item.type]]: item.key });
    req.flash('success', `${TYPE_LABEL[item.type]} ${item.name} ativado.`);
    return res.redirect(back);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
