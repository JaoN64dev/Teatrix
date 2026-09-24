const Match = require('../models/Match');
const User = require('../models/User');
const { deleteMedia } = require('./media');

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;
const MAX_TITLE = 60;
const MAX_SCRIPT = 3000;
const MAX_EMOTION = 30;
const VOTE_SECONDS = 60;
const SUBMIT_GRACE_MS = 3_000; // tempo extra para o envio automático chegar
const UPLOAD_GRACE_MS = 30_000; // gravações podem demorar para subir
const LOBBY_LEAVE_MS = 5_000; // cobre um F5 na sala de espera
const GAME_LEAVE_MS = 30_000; // tempo para voltar durante a partida
const HOST_ARRIVAL_MS = 15_000; // tempo para o criador da sala entrar
const REWARD = { play: 10, hostBonus: 5, win: 25 };

// Emoções prontas do roteiro; o autor também pode escrever outra.
const EMOTIONS = { sad: 'Triste', angry: 'Com raiva', happy: 'Feliz' };
// Emoções extras sorteadas como opções de palpite, para as escritas pelos jogadores não se destacarem.
const DECOY_EMOTIONS = [
  'Com medo', 'Surpreso', 'Com nojo', 'Envergonhado', 'Ansioso', 'Apaixonado', 'Entediado', 'Confuso',
  'Orgulhoso', 'Nervoso', 'Com ciúmes', 'Esperançoso', 'Nostálgico', 'Culpado', 'Aliviado', 'Desesperado',
];
const DECOY_COUNT = 3;

/** Chave para comparar emoções ignorando maiúsculas, acentos e espaços. */
function emotionKey(label) {
  return String(label).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Limites (em segundos) que o anfitrião pode escolher.
const LIMITS = {
  writeSeconds: { min: 60, max: 600, default: 240 },
  performSeconds: { min: 30, max: 300, default: 120 },
};

/**
 * Opções de palpite: as prontas primeiro; depois as escritas na partida e DECOY_COUNT
 * emoções extras sorteadas, tudo em ordem alfabética para não dar para saber qual é qual.
 */
function buildEmotionOptions(written) {
  const seen = new Map();
  for (const label of [...Object.values(EMOTIONS), ...written]) {
    if (!seen.has(emotionKey(label))) seen.set(emotionKey(label), label);
  }
  const decoys = DECOY_EMOTIONS.filter((label) => !seen.has(emotionKey(label)));
  for (let i = 0; i < DECOY_COUNT && decoys.length; i++) {
    const [label] = decoys.splice(Math.floor(Math.random() * decoys.length), 1);
    seen.set(emotionKey(label), label);
  }
  const presets = Object.values(EMOTIONS).length;
  const labels = [...seen.values()];
  return [...labels.slice(0, presets), ...labels.slice(presets).sort((a, b) => a.localeCompare(b, 'pt'))];
}

// De onde vem a emoção: escolhida pelo autor ou sorteada para quem vai atuar.
const EMOTION_MODES = ['author', 'random'];

/** Sorteio do modo "sorteada": qualquer emoção pronta ou da lista extra. */
function randomEmotion() {
  const pool = [...Object.values(EMOTIONS), ...DECOY_EMOTIONS];
  return pool[Math.floor(Math.random() * pool.length)];
}

function randomPreset() {
  const labels = Object.values(EMOTIONS);
  return labels[Math.floor(Math.random() * labels.length)];
}

/** Embaralha até ninguém ficar com o próprio índice (desarranjo). */
function derangement(n) {
  const idx = [...Array(n).keys()];
  do {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
  } while (idx.some((v, i) => v === i));
  return idx;
}

/**
 * Uma sala de jogo. Máquina de estados:
 *   lobby -> writing -> performing -> showcase -> voting -> results -> lobby
 *
 * writing:    cada jogador escreve um roteiro.
 * performing: cada jogador recebe o roteiro de outra pessoa (sorteado) e grava áudio ou vídeo.
 * showcase:   as atuações são apresentadas uma a uma; quem não é autor nem ator tenta
 *             adivinhar a emoção. O anfitrião revela a emoção e depois avança.
 * voting:     todos votam em melhor roteiro e melhor atuação (não vale votar em si).
 * results:    placar, moedas e partida salva no histórico.
 */
class Room {
  constructor({ code, hostId, io, onEmpty }) {
    this.code = code;
    this.hostId = hostId;
    this.io = io;
    this.onEmpty = onEmpty;
    this.players = new Map(); // id -> { id, name, sockets:Set, connected, pending, gone, leaveTimer }
    this.uploading = new Set(); // jogadores com um envio de gravação em andamento
    this.settings = {
      writeSeconds: LIMITS.writeSeconds.default,
      performSeconds: LIMITS.performSeconds.default,
      emotionMode: 'author',
    };
    this.phase = 'lobby';
    this.resetGame();
    // Sala criada e nunca acessada é descartada.
    this.emptyTimer = setTimeout(() => this.destroyIfEmpty(), 60_000);
    // Se o criador não aparecer em 15s, o anfitrião passa para outro jogador.
    this.hostArrived = false;
    this.hostDeadline = Date.now() + HOST_ARRIVAL_MS;
    this.hostTimer = setTimeout(() => {
      if (this.hostArrived) return;
      this.ensureHost();
      this.broadcastState();
    }, HOST_ARRIVAL_MS + 100);
  }

  resetGame() {
    clearTimeout(this.phaseTimer);
    this.order = [];
    this.scripts = []; // [{ authorId, authorName, title, text, emotion }]
    this.emotionOptions = []; // opções de palpite: emoções prontas + as escritas nesta partida
    this.guesses = []; // por atuação: Map(playerId -> índice em emotionOptions)
    this.revealed = false; // emoção da atuação atual já revelada?
    this.skipAll = false; // anfitrião pulou a apresentação: sem mídia daqui em diante
    this.assignment = new Map(); // performerId -> índice do roteiro
    this.entries = []; // roteiro + atuação, montado após as gravações
    this.submissions = new Map(); // respostas da fase atual
    this.onPhaseEnd = null;
    this.deadline = null;
    this.showIndex = 0;
    this.results = null;
    this.files = new Set(); // gravações desta partida
    this.saved = false;
    this.guessers = [];
    this.startedAt = null;
  }

  // ---------- helpers ----------

  userRoom(id) {
    return `${this.code}:${id}`;
  }

  isHost(id) {
    return id === this.hostId;
  }

  playerName(id) {
    return this.players.get(id)?.name ?? '?';
  }

  connectedPlayers() {
    return [...this.players.values()].filter((p) => p.connected);
  }

  remainingMs() {
    return this.deadline ? Math.max(0, this.deadline - Date.now()) : 0;
  }

  publicState() {
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      settings: this.settings,
      limits: LIMITS,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
        isHost: p.id === this.hostId,
      })),
    };
  }

  broadcastState() {
    this.io.to(this.code).emit('room:state', this.publicState());
  }

  broadcastProgress() {
    this.io.to(this.code).emit('phase:progress', {
      done: this.submissions.size,
      total: this.order.length,
    });
  }

  ensureHost() {
    const host = this.players.get(this.hostId);
    if (host && host.connected) return;
    // O criador da sala ainda está carregando a página: não passa o anfitrião para quem conectou antes.
    if (!host && !this.hostArrived && Date.now() < this.hostDeadline) return;
    const next = this.connectedPlayers()[0];
    if (next) this.hostId = next.id;
  }

  // ---------- conexão ----------

  /** Retorna uma mensagem de erro, ou null se entrou. */
  addSocket(user, socket) {
    const id = user.id;
    const existing = this.players.get(id);

    if (this.phase !== 'lobby' && !this.order.includes(id)) {
      return 'A partida já começou. Espere ela acabar.';
    }
    if (!existing && this.players.size >= MAX_PLAYERS) {
      return 'A sala está cheia.';
    }

    const player = existing || { id, name: user.displayName, sockets: new Set() };
    clearTimeout(player.leaveTimer);
    player.sockets.add(socket.id);
    player.connected = true;
    player.pending = false;
    player.gone = false;
    this.players.set(id, player);
    clearTimeout(this.emptyTimer);
    if (id === this.hostId) this.hostArrived = true;

    socket.join(this.code);
    socket.join(this.userRoom(id));
    this.ensureHost();
    this.broadcastState();
    this.sendPhaseTo(id);
    return null;
  }

  removeSocket(id, socketId) {
    const player = this.players.get(id);
    if (!player) return;
    player.sockets.delete(socketId);
    if (player.sockets.size > 0) return;

    player.connected = false;
    player.pending = true; // aguardando reconexão
    const wait = this.phase === 'lobby' ? LOBBY_LEAVE_MS : GAME_LEAVE_MS;
    player.leaveTimer = setTimeout(() => this.dropPlayer(id), wait);
    this.ensureHost();
    this.broadcastState();
  }

  /** Saída definitiva (botão "Sair" ou fim do tempo de reconexão). */
  dropPlayer(id) {
    const player = this.players.get(id);
    if (!player) return;
    clearTimeout(player.leaveTimer);
    player.connected = false;
    player.pending = false;

    if (this.phase === 'lobby') {
      this.players.delete(id);
    } else {
      // Durante a partida o jogador continua na ordem; suas respostas ficam vazias.
      player.gone = true;
      this.autoSubmitGone();
    }

    this.ensureHost();
    if (this.destroyIfEmpty()) return;
    this.broadcastState();
  }

  destroyIfEmpty() {
    // Alguém conectado ou ainda dentro do tempo de reconexão mantém a sala viva.
    if ([...this.players.values()].some((p) => p.connected || p.pending)) return false;
    clearTimeout(this.phaseTimer);
    clearTimeout(this.emptyTimer);
    clearTimeout(this.hostTimer);
    for (const p of this.players.values()) clearTimeout(p.leaveTimer);
    if (!this.saved) this.files.forEach(deleteMedia); // partida abandonada
    this.onEmpty(this.code);
    return true;
  }

  // ---------- fases com tempo ----------

  beginTimedPhase(phase, seconds, graceMs, onEnd) {
    this.phase = phase;
    this.submissions = new Map();
    this.onPhaseEnd = onEnd;
    this.deadline = Date.now() + seconds * 1000;
    clearTimeout(this.phaseTimer);
    this.phaseTimer = setTimeout(() => this.endPhase(), seconds * 1000 + graceMs);

    this.broadcastState();
    for (const id of this.order) this.sendPhaseTo(id);
    this.autoSubmitGone();
    this.broadcastProgress();
  }

  endPhase() {
    const onEnd = this.onPhaseEnd;
    if (!onEnd) return;
    this.onPhaseEnd = null;
    clearTimeout(this.phaseTimer);
    this.deadline = null;
    onEnd.call(this);
  }

  record(id, value) {
    this.submissions.set(id, value);
    this.broadcastProgress();
    if (this.submissions.size === this.order.length) this.endPhase();
  }

  autoSubmitGone() {
    if (!this.onPhaseEnd) return;
    for (const id of this.order) {
      if (this.players.get(id)?.gone && !this.submissions.has(id)) this.submissions.set(id, null);
    }
    if (this.submissions.size === this.order.length) this.endPhase();
  }

  /** Envia para um jogador o que ele precisa ver na fase atual (também usado ao reconectar). */
  sendPhaseTo(id) {
    const to = this.io.to(this.userRoom(id));
    const base = { remainingMs: this.remainingMs(), submitted: this.submissions.has(id) };

    switch (this.phase) {
      case 'writing':
        to.emit('phase:write', base);
        break;
      case 'performing': {
        const script = this.scripts[this.assignment.get(id)];
        to.emit('phase:perform', {
          ...base,
          script: { title: script.title, text: script.text, emotion: script.emotion },
        });
        break;
      }
      case 'showcase':
        to.emit('showcase:show', this.showcasePayload(id));
        break;
      case 'voting':
        to.emit('phase:vote', { ...base, ...this.votePayload(id) });
        break;
      case 'results':
        to.emit('results', this.results);
        break;
      default:
        break;
    }
    if (this.onPhaseEnd) this.broadcastProgress();
  }

  // ---------- lobby ----------

  updateSettings(id, patch) {
    if (!this.isHost(id)) return 'Só o anfitrião pode mudar as configurações.';
    if (this.phase !== 'lobby') return 'Não dá para mudar as configurações durante a partida.';
    if (EMOTION_MODES.includes(patch?.emotionMode)) this.settings.emotionMode = patch.emotionMode;
    for (const [key, limit] of Object.entries(LIMITS)) {
      const value = Math.round(Number(patch?.[key]));
      if (Number.isFinite(value)) {
        this.settings[key] = Math.min(limit.max, Math.max(limit.min, value));
      }
    }
    this.broadcastState();
    return null;
  }

  start(id) {
    if (!this.isHost(id)) return 'Só o anfitrião pode começar.';
    if (this.phase !== 'lobby') return 'A partida já começou.';
    const ready = this.connectedPlayers();
    if (ready.length < MIN_PLAYERS) return `São necessários pelo menos ${MIN_PLAYERS} jogadores.`;

    // Quem estava só "reconectando" no lobby fica de fora.
    for (const p of [...this.players.values()]) {
      if (!p.connected) this.players.delete(p.id);
    }

    this.resetGame();
    this.order = ready.map((p) => p.id);
    this.startedAt = new Date();
    this.beginTimedPhase('writing', this.settings.writeSeconds, SUBMIT_GRACE_MS, this.finishWriting);
    return null;
  }

  // ---------- escrever ----------

  submitScript(id, payload) {
    if (this.phase !== 'writing') return 'Não é hora de escrever.';
    if (!this.order.includes(id)) return 'Você não está nesta partida.';
    if (this.submissions.has(id)) return null; // envio duplicado é ignorado

    const title = typeof payload?.title === 'string' ? payload.title.trim().slice(0, MAX_TITLE) : '';
    const text = typeof payload?.text === 'string' ? payload.text.trim().slice(0, MAX_SCRIPT) : '';
    const other = typeof payload?.emotionOther === 'string' ? payload.emotionOther.trim().slice(0, MAX_EMOTION) : '';
    const emotion = payload?.emotion === 'other' ? other.charAt(0).toUpperCase() + other.slice(1) : EMOTIONS[payload?.emotion] || '';
    this.record(id, { title, text, emotion });
    return null;
  }

  finishWriting() {
    this.scripts = this.order.map((id) => {
      const sub = this.submissions.get(id);
      return {
        authorId: id,
        authorName: this.playerName(id),
        title: sub?.title || 'Sem título',
        text: sub?.text || '',
        // Modo sorteado: a emoção é de quem atua, sorteada agora.
        // Modo do autor sem escolha (tempo esgotado ou "outra" vazia): sorteia uma pronta.
        emotion: this.randomEmotions() ? randomEmotion() : sub?.emotion || randomPreset(),
      };
    });

    this.emotionOptions = buildEmotionOptions(this.scripts.map((s) => s.emotion));

    // Cada jogador recebe o roteiro de outra pessoa.
    const perm = derangement(this.order.length);
    this.order.forEach((id, seat) => this.assignment.set(id, perm[seat]));

    this.beginTimedPhase('performing', this.settings.performSeconds, UPLOAD_GRACE_MS, this.finishPerforming);
  }

  // ---------- gravar ----------

  canSubmitPerformance(id) {
    if (this.phase !== 'performing' || !this.onPhaseEnd) return 'O tempo de gravação acabou.';
    if (!this.order.includes(id)) return 'Você não está nesta partida.';
    if (this.submissions.has(id)) return 'Você já enviou sua gravação.';
    return null;
  }

  /** media = { file, mime, kind } já salvo em disco. */
  submitPerformance(id, media) {
    const error = this.canSubmitPerformance(id);
    if (error) return error;
    this.files.add(media.file);
    this.record(id, media);
    return null;
  }

  /** Enviar sem gravação (desistiu ou não conseguiu gravar). */
  skipPerformance(id) {
    if (this.canSubmitPerformance(id)) return null;
    this.record(id, null);
    return null;
  }

  finishPerforming() {
    const performerOf = new Map([...this.assignment].map(([performer, script]) => [script, performer]));
    this.entries = this.scripts.map((script, i) => {
      const performerId = performerOf.get(i);
      return {
        ...script,
        performerId,
        performerName: this.playerName(performerId),
        media: this.submissions.get(performerId) || null,
      };
    });
    this.guesses = this.entries.map(() => new Map());
    this.phase = 'showcase';
    this.showIndex = 0;
    this.revealed = false;
    this.broadcastState();
    this.sendShowcase();
  }

  // ---------- apresentação e palpites ----------

  randomEmotions() {
    return this.settings.emotionMode === 'random';
  }

  /** Quem já sabe a emoção não palpita: o ator e, se foi ele quem escolheu, o autor. */
  canGuess(id, entry = this.entries[this.showIndex]) {
    if (entry.performerId === id) return false;
    return this.randomEmotions() || entry.authorId !== id;
  }

  guessProgress() {
    const guessers = this.order.filter((id) => this.canGuess(id) && !this.players.get(id)?.gone);
    return { done: this.guesses[this.showIndex].size, total: guessers.length };
  }

  revealPayload() {
    const e = this.entries[this.showIndex];
    const answer = emotionKey(e.emotion);
    const guesses = [...this.guesses[this.showIndex]];
    return {
      emotion: e.emotion,
      option: this.emotionOptions.findIndex((label) => emotionKey(label) === answer),
      correct: guesses.filter(([, i]) => emotionKey(this.emotionOptions[i]) === answer).map(([id]) => this.playerName(id)),
    };
  }

  showcasePayload(id) {
    const e = this.entries[this.showIndex];
    const myGuess = this.guesses[this.showIndex].get(id);
    return {
      index: this.showIndex,
      total: this.entries.length,
      entry: {
        title: e.title,
        text: e.text,
        performerName: e.performerName,
        media: e.media && !this.isSkipped(e) ? { url: `/media/${e.media.file}`, kind: e.media.kind } : null,
      },
      skipped: this.isSkipped(e),
      skipAll: this.skipAll,
      options: this.emotionOptions,
      canGuess: this.canGuess(id),
      // Autor e ator veem a emoção desde o início.
      emotion: this.canGuess(id) ? null : e.emotion,
      myGuess: myGuess ?? null,
      progress: this.guessProgress(),
      reveal: this.revealed ? this.revealPayload() : null,
    };
  }

  sendShowcase() {
    for (const id of this.order) this.sendPhaseTo(id);
  }

  guess(id, payload) {
    if (this.phase !== 'showcase') return 'Não é hora de palpitar.';
    if (!this.order.includes(id)) return 'Você não está nesta partida.';
    if (Number(payload?.index) !== this.showIndex) return null; // palpite atrasado de outra atuação
    if (this.revealed) return 'A emoção já foi revelada.';
    if (!this.canGuess(id)) return 'Você já sabe a emoção desta atuação.';
    const option = Number(payload?.option);
    if (!Number.isInteger(option) || !this.emotionOptions[option]) return 'Escolha uma emoção.';

    this.guesses[this.showIndex].set(id, option); // pode trocar até a revelação
    this.io.to(this.code).emit('showcase:progress', { index: this.showIndex, ...this.guessProgress() });
    return null;
  }

  showcaseReveal(id) {
    if (this.phase !== 'showcase' || this.revealed) return null;
    if (!this.isHost(id)) return 'Só o anfitrião pode revelar a emoção.';
    this.revealed = true;
    this.io.to(this.code).emit('showcase:reveal', { index: this.showIndex, ...this.revealPayload() });
    return null;
  }

  showcaseNext(id) {
    if (this.phase !== 'showcase') return null;
    if (!this.isHost(id)) return 'Só o anfitrião pode avançar.';
    if (!this.revealed) return 'Revele a emoção antes de avançar.';
    this.advanceShowcase(this.showIndex + 1);
    return null;
  }

  isSkipped(entry = this.entries[this.showIndex]) {
    return this.skipAll || Boolean(entry.skipped);
  }

  /**
   * Pula a mídia da atuação atual (all = false) ou de todas as que faltam (all = true).
   * Os palpites e a revelação continuam normalmente.
   */
  showcaseSkip(id, payload) {
    if (this.phase !== 'showcase') return null;
    if (!this.isHost(id)) return 'Só o anfitrião pode pular a apresentação.';
    const all = Boolean(payload?.all);
    if (all) this.skipAll = true;
    else this.entries[this.showIndex].skipped = true;
    this.io.to(this.code).emit('showcase:skipped', { all });
    this.sendShowcase(); // reenvia sem a mídia
    return null;
  }

  advanceShowcase(index) {
    this.showIndex = index;
    this.revealed = false;
    if (this.showIndex < this.entries.length) {
      this.sendShowcase();
    } else {
      this.beginTimedPhase('voting', VOTE_SECONDS, SUBMIT_GRACE_MS, this.finishVoting);
    }
  }

  // ---------- votação ----------

  votePayload(id) {
    return {
      scripts: this.entries.map((e, i) => ({ index: i, title: e.title, own: e.authorId === id })),
      performers: this.entries.map((e) => ({
        id: e.performerId,
        name: e.performerName,
        title: e.title,
        self: e.performerId === id,
      })),
    };
  }

  vote(id, payload) {
    if (this.phase !== 'voting') return 'Não é hora de votar.';
    if (!this.order.includes(id)) return 'Você não está nesta partida.';
    if (this.submissions.has(id)) return null;

    const script = Number(payload?.script);
    const acting = String(payload?.acting ?? '');
    const scriptEntry = this.entries[script];
    if (!Number.isInteger(script) || !scriptEntry) return 'Escolha o melhor roteiro.';
    if (scriptEntry.authorId === id) return 'Você não pode votar no seu próprio roteiro.';
    if (!this.entries.some((e) => e.performerId === acting)) return 'Escolha a melhor atuação.';
    if (acting === id) return 'Você não pode votar na sua própria atuação.';

    this.record(id, { script, acting });
    return null;
  }

  /** Acertos de emoção por jogador. */
  guessScores() {
    const scores = new Map(this.order.map((id) => [id, 0]));
    this.entries.forEach((e, i) => {
      for (const [id, option] of this.guesses[i] || []) {
        if (emotionKey(this.emotionOptions[option]) === emotionKey(e.emotion)) scores.set(id, scores.get(id) + 1);
      }
    });
    return scores;
  }

  finishVoting() {
    const scriptVotes = this.entries.map(() => 0);
    const actingVotes = new Map(this.entries.map((e) => [e.performerId, 0]));
    for (const vote of this.submissions.values()) {
      if (!vote) continue;
      scriptVotes[vote.script] += 1;
      actingVotes.set(vote.acting, actingVotes.get(vote.acting) + 1);
    }

    // Empates: todos os empatados ganham. Sem votos, ninguém ganha.
    const topScript = Math.max(...scriptVotes);
    const topActing = Math.max(...actingVotes.values());
    this.entries.forEach((e, i) => {
      e.scriptVotes = scriptVotes[i];
      e.actingVotes = actingVotes.get(e.performerId);
      e.scriptWinner = topScript > 0 && e.scriptVotes === topScript;
      e.actingWinner = topActing > 0 && e.actingVotes === topActing;
    });

    const scores = this.guessScores();
    const topGuess = Math.max(0, ...scores.values());
    this.guessers = this.order.map((id) => ({
      id,
      name: this.playerName(id),
      correct: scores.get(id),
      winner: topGuess > 0 && scores.get(id) === topGuess,
    }));

    this.results = {
      entries: this.entries.map((e) => ({
        title: e.title,
        emotion: e.emotion,
        authorName: e.authorName,
        performerName: e.performerName,
        scriptVotes: e.scriptVotes,
        actingVotes: e.actingVotes,
        scriptWinner: e.scriptWinner,
        actingWinner: e.actingWinner,
      })),
      scriptWinners: this.entries.filter((e) => e.scriptWinner).map((e) => e.authorName),
      actingWinners: this.entries.filter((e) => e.actingWinner).map((e) => e.performerName),
      guessers: this.guessers
        .map(({ name, correct, winner }) => ({ name, correct, winner }))
        .sort((a, b) => b.correct - a.correct),
      guessWinners: this.guessers.filter((g) => g.winner).map((g) => g.name),
      guessTotal: this.entries.length,
    };

    this.phase = 'results';
    this.broadcastState();
    this.io.to(this.code).emit('results', this.results);
    this.saveMatch().catch((err) => console.error('Erro ao salvar partida:', err));
  }

  backToLobby(id) {
    if (this.phase !== 'results') return null;
    if (!this.isHost(id)) return 'Só o anfitrião pode voltar para a sala.';
    this.phase = 'lobby';
    for (const p of [...this.players.values()]) {
      if (!p.connected) {
        clearTimeout(p.leaveTimer);
        this.players.delete(p.id);
      }
    }
    this.resetGame();
    this.ensureHost();
    this.broadcastState();
    return null;
  }

  // ---------- histórico e moedas ----------

  rewardFor(id, hostId) {
    let coins = REWARD.play;
    if (id === hostId) coins += REWARD.hostBonus;
    if (this.entries.some((e) => e.scriptWinner && e.authorId === id)) coins += REWARD.win;
    if (this.entries.some((e) => e.actingWinner && e.performerId === id)) coins += REWARD.win;
    if (this.guessers.some((g) => g.winner && g.id === id)) coins += REWARD.win;
    return coins;
  }

  async saveMatch() {
    // Copia tudo antes do primeiro await: o anfitrião pode voltar ao lobby (resetGame) enquanto salva.
    const hostId = this.hostId;
    const order = [...this.order];
    const rewards = new Map(order.map((id) => [id, this.rewardFor(id, hostId)]));
    this.saved = true; // as gravações passam a pertencer ao histórico

    const match = await Match.create({
      roomCode: this.code,
      host: hostId,
      settings: { ...this.settings },
      players: order.map((id) => {
        const g = this.guessers.find((x) => x.id === id);
        return { user: id, username: this.playerName(id), correctGuesses: g.correct, guessWinner: g.winner };
      }),
      entries: this.entries.map((e) => ({
        title: e.title,
        text: e.text,
        emotion: e.emotion,
        author: e.authorId,
        authorName: e.authorName,
        performer: e.performerId,
        performerName: e.performerName,
        media: e.media,
        scriptVotes: e.scriptVotes,
        actingVotes: e.actingVotes,
        scriptWinner: e.scriptWinner,
        actingWinner: e.actingWinner,
      })),
      startedAt: this.startedAt,
      endedAt: new Date(),
    });

    await User.bulkWrite(
      order.map((id) => ({
        updateOne: {
          filter: { _id: id },
          update: { $inc: { coins: rewards.get(id), 'stats.matches': 1 } },
        },
      }))
    );

    for (const id of order) {
      this.io.to(this.userRoom(id)).emit('match:saved', {
        matchId: match.id,
        coinsEarned: rewards.get(id),
      });
    }
  }
}

module.exports = Room;
module.exports.LIMITS = LIMITS;
