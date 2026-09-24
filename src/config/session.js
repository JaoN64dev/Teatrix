const session = require('express-session');
const { MongoStore } = require('connect-mongo');

function createSession({ mongoUri, secret }) {
  return session({
    secret,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: mongoUri, collectionName: 'sessions' }),
    // secure: 'auto' marca o cookie como Secure quando a conexão é HTTPS (inclusive via túnel).
    cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 1000 * 60 * 60 * 24 * 7 },
  });
}

module.exports = createSession;
