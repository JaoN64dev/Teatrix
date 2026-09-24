const Room = require('./Room');

// Sem letras/números ambíguos (O/0, I/1).
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.io = null;
  }

  init(io) {
    this.io = io;
  }

  generateCode() {
    let code;
    do {
      code = Array.from({ length: CODE_LENGTH }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    } while (this.rooms.has(code));
    return code;
  }

  create(host) {
    const code = this.generateCode();
    const room = new Room({
      code,
      hostId: host.id,
      io: this.io,
      onEmpty: (c) => this.rooms.delete(c),
    });
    this.rooms.set(code, room);
    return room;
  }

  get(code) {
    return this.rooms.get(String(code || '').toUpperCase());
  }

  /** A gravação é de uma partida em andamento da qual o usuário participa? */
  canAccessMedia(userId, file) {
    for (const room of this.rooms.values()) {
      if (room.files.has(file) && room.order.includes(userId)) return true;
    }
    return false;
  }
}

module.exports = new RoomManager();
