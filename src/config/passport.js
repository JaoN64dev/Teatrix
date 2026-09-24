const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const User = require('../models/User');

passport.use(
  new LocalStrategy(async (username, password, done) => {
    try {
      const user = await User.findOne({ username: username.toLowerCase() });
      // Usuário inexistente também gasta o tempo de um bcrypt, para não revelar quem tem conta.
      const ok = user ? await user.checkPassword(password) : await User.fakeCheck();
      if (!ok) {
        return done(null, false, { message: 'Usuário ou senha incorretos.' });
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  })
);

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
  try {
    done(null, await User.findById(id));
  } catch (err) {
    done(err);
  }
});

module.exports = passport;
