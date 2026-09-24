const express = require('express');
const mongoose = require('mongoose');
const Match = require('../models/Match');
const { ensureAuth } = require('../middleware/auth');

const router = express.Router();
const PAGE_SIZE = 10;

// Partidas antigas (formato com `chains`) não têm `entries`.
const names = (entries = [], flag, field) => entries.filter((e) => e[flag]).map((e) => e[field]).join(', ');

router.get('/history', ensureAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const filter = { 'players.user': req.user._id };
    const [matches, total] = await Promise.all([
      Match.find(filter, { 'entries.text': 0, 'entries.media': 0 })
        .sort({ endedAt: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean(),
      Match.countDocuments(filter),
    ]);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    res.render('history', {
      title: 'Histórico',
      matches: matches.map((m) => ({
        id: m._id,
        roomCode: m.roomCode,
        endedAt: m.endedAt,
        players: m.players.map((p) => p.username).join(', '),
        scriptWinners: names(m.entries, 'scriptWinner', 'authorName'),
        actingWinners: names(m.entries, 'actingWinner', 'performerName'),
        guessWinners: m.players.filter((p) => p.guessWinner).map((p) => p.username).join(', '),
      })),
      page,
      pages,
      prev: page > 1 ? page - 1 : null,
      next: page < pages ? page + 1 : null,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/history/:id', ensureAuth, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.redirect('/history');
    const match = await Match.findOne({ _id: req.params.id, 'players.user': req.user._id }).lean();
    if (!match) {
      req.flash('error', 'Partida não encontrada.');
      return res.redirect('/history');
    }
    return res.render('match', {
      title: `Partida ${match.roomCode}`,
      match: {
        roomCode: match.roomCode,
        endedAt: match.endedAt,
        players: match.players.map((p) => p.username).join(', '),
        guessers: match.players
          .filter((p) => p.correctGuesses !== undefined)
          .sort((a, b) => b.correctGuesses - a.correctGuesses),
      },
      entries: match.entries || [],
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
