const express = require('express');

const router = express.Router();

const TEAM = ['João Zancanella', 'João Henrique', 'Davi Akio', 'Ricardo', 'Pedro'];

// Página pública: não exige login.
router.get('/about', (req, res) => {
  res.render('about', { title: 'Sobre', team: TEAM });
});

module.exports = router;
