const roomManager = require('./RoomManager');

// Aplica o middleware só no handshake (não em cada requisição de polling).
function onlyForHandshake(middleware) {
  return (req, res, next) => {
    const isHandshake = req._query.sid === undefined;
    if (isHandshake) middleware(req, res, next);
    else next();
  };
}

function attachSocket(io, sessionMiddleware, passport) {
  roomManager.init(io);

  // Reaproveita a sessão do Express: socket.request.user é o usuário logado.
  io.engine.use(onlyForHandshake(sessionMiddleware));
  io.engine.use(onlyForHandshake(passport.session()));
  io.engine.use(
    onlyForHandshake((req, res, next) => {
      if (req.user) return next();
      res.writeHead(401);
      return res.end();
    })
  );

  io.on('connection', (socket) => {
    const user = socket.request.user;
    let room = null;

    const reply = (error) => {
      if (error) socket.emit('error:msg', error);
    };

    socket.on('room:join', (code) => {
      if (room) return;
      const target = roomManager.get(code);
      if (!target) return reply('Sala não encontrada.');
      const error = target.addSocket(user, socket);
      if (error) return reply(error);
      room = target;
      return null;
    });

    socket.on('room:settings', (patch) => room && reply(room.updateSettings(user.id, patch)));
    socket.on('room:start', () => room && reply(room.start(user.id)));
    socket.on('script:submit', (payload) => room && reply(room.submitScript(user.id, payload)));
    socket.on('performance:skip', () => room && reply(room.skipPerformance(user.id)));
    socket.on('showcase:guess', (payload) => room && reply(room.guess(user.id, payload)));
    socket.on('showcase:reveal', () => room && reply(room.showcaseReveal(user.id)));
    socket.on('showcase:skip', (payload) => room && reply(room.showcaseSkip(user.id, payload)));
    socket.on('showcase:next', () => room && reply(room.showcaseNext(user.id)));
    socket.on('vote:submit', (payload) => room && reply(room.vote(user.id, payload)));
    socket.on('room:lobby', () => room && reply(room.backToLobby(user.id)));

    socket.on('room:leave', () => {
      if (!room) return;
      room.removeSocket(user.id, socket.id);
      room.dropPlayer(user.id);
      socket.leave(room.code);
      room = null;
    });

    socket.on('disconnect', () => {
      if (room) room.removeSocket(user.id, socket.id);
    });
  });
}

module.exports = attachSocket;
