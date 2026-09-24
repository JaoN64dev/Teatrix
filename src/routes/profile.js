const express = require('express');
const Item = require('../models/Item');
const { ensureAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/profile', ensureAuth, async (req, res, next) => {
  try {
    const items = await Item.find({
      type: { $in: ['theme', 'avatar'] },
      $or: [{ price: 0 }, { key: { $in: req.user.ownedItems } }],
    }).sort({ price: 1 }).lean();
    const themes = items.filter((i) => i.type === 'theme');
    const avatars = items.filter((i) => i.type === 'avatar');
    res.render('profile', {
      title: 'Perfil',
      profile: {
        name: req.user.displayName,
        coins: req.user.coins,
        matches: req.user.stats.matches,
        since: req.user.createdAt,
        items: items.length,
        hasRecoveryCode: Boolean(req.user.recoveryHash),
      },
      themes: themes.map((t) => ({ ...t, equipped: t.key === req.user.activeTheme })),
      avatars: avatars.map((a) => ({ ...a, equipped: a.key === req.user.activeAvatar })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
