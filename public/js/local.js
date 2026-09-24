/* Modo local: um aparelho só, passado de jogador em jogador. Tudo roda no navegador. */
(function () {
  const $ = (id) => document.getElementById(id);

  const MIN_PLAYERS = 3; // com menos, ninguém sobra para palpitar
  const MAX_PLAYERS = 10;
  const EMOTIONS = { sad: 'Triste', angry: 'Com raiva', happy: 'Feliz' };
  // Emoções extras sorteadas como opções de palpite, para as escritas pelos jogadores
  // não se destacarem. Mesma lista do servidor (Room.js).
  const DECOY_EMOTIONS = [
    'Com medo', 'Surpreso', 'Com nojo', 'Envergonhado', 'Ansioso', 'Apaixonado', 'Entediado', 'Confuso',
    'Orgulhoso', 'Nervoso', 'Com ciúmes', 'Esperançoso', 'Nostálgico', 'Culpado', 'Aliviado', 'Desesperado',
  ];
  const DECOY_COUNT = 3;
  const STORAGE_KEY = 'teatrix:local-players';

  const rec = new Recorder();
  const state = {
    players: loadPlayers(),
    game: null,
    timerFrame: null,
    timerEnd: 0,
    onTimeout: null,
    mode: 'audio',
    performer: null, // índice de quem está gravando
    playbackUrl: null,
    statusTimer: null,
  };

  // ---------- helpers ----------

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach((el) => {
      el.hidden = el.dataset.screen !== name;
    });
    window.scrollTo(0, 0);
  }

  let toastTimer;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 4000);
  }

  function fmt(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /** Mesma regra do servidor: ignora maiúsculas, acentos e espaços. */
  function emotionKey(label) {
    return String(label).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

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

  /** Sorteio do modo "sorteada": qualquer emoção pronta ou da lista extra (igual ao servidor). */
  function randomEmotion() {
    const pool = [...Object.values(EMOTIONS), ...DECOY_EMOTIONS];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function randomPreset() {
    const labels = Object.values(EMOTIONS);
    return labels[Math.floor(Math.random() * labels.length)];
  }

  /** Embaralha até ninguém ficar com o próprio índice. */
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

  function loadPlayers() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(saved) ? saved.filter((n) => typeof n === 'string').slice(0, MAX_PLAYERS) : [];
    } catch {
      return [];
    }
  }

  function savePlayers() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.players));
    } catch {
      /* armazenamento indisponível: só não lembra os nomes */
    }
  }

  const name = (i) => state.game.players[i];

  // ---------- timer ----------

  function startTimer(ms, onTimeout) {
    cancelAnimationFrame(state.timerFrame);
    state.timerEnd = performance.now() + ms;
    state.onTimeout = onTimeout;
    $('timer').hidden = false;
    const tick = () => {
      const left = timeLeftMs();
      $('timer-bar').style.transform = `scaleX(${left / ms})`;
      if (left <= 0) {
        const cb = state.onTimeout;
        stopTimer();
        cb?.();
        return;
      }
      state.timerFrame = requestAnimationFrame(tick);
    };
    tick();
  }

  function timeLeftMs() {
    return Math.max(0, state.timerEnd - performance.now());
  }

  function stopTimer() {
    cancelAnimationFrame(state.timerFrame);
    state.onTimeout = null;
    $('timer').hidden = true;
  }

  // ---------- passar o aparelho ----------

  /** Tela neutra entre jogadores, para ninguém ver o que o anterior fez. */
  function pass(to, hint, button, onReady) {
    stopTimer();
    $('pass-name').textContent = to;
    $('pass-hint').textContent = hint;
    $('pass-ready').textContent = button;
    $('pass-ready').onclick = onReady;
    showScreen('pass');
  }

  // ---------- preparação ----------

  function renderSetup() {
    $('player-list').replaceChildren(
      ...state.players.map((player, i) => {
        const row = document.createElement('div');
        row.className = 'vote-option';
        const label = document.createElement('span');
        label.textContent = `${i + 1}. ${player}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn-ghost btn-sm';
        remove.textContent = 'Remover';
        remove.addEventListener('click', () => {
          state.players.splice(i, 1);
          savePlayers();
          renderSetup();
        });
        row.append(label, remove);
        return row;
      })
    );
    const n = state.players.length;
    $('player-count').textContent = `${n}/${MAX_PLAYERS}`;
    $('setup-start').disabled = n < MIN_PLAYERS;
    $('setup-hint').textContent = n < MIN_PLAYERS ? `Adicione pelo menos ${MIN_PLAYERS} jogadores.` : '';
    $('add-player').disabled = n >= MAX_PLAYERS;
    $('step-label').textContent = '';
    showScreen('setup');
  }

  function addPlayer() {
    const input = $('player-name');
    const value = input.value.trim().slice(0, 20);
    if (!value) return;
    if (state.players.length >= MAX_PLAYERS) return toast(`No máximo ${MAX_PLAYERS} jogadores.`);
    if (state.players.some((p) => p.toLowerCase() === value.toLowerCase())) return toast('Esse nome já está na lista.');
    state.players.push(value);
    savePlayers();
    input.value = '';
    input.focus();
    return renderSetup();
  }

  $('add-player').addEventListener('click', addPlayer);
  $('player-name').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    addPlayer();
  });

  $('setup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.players.length >= MIN_PLAYERS) startGame();
  });

  function startGame() {
    clearGameMedia();
    state.game = {
      players: [...state.players],
      writeMs: Number($('set-write').value) * 1000,
      performMs: Number($('set-perform').value) * 1000,
      randomEmotions: $('set-emotion').value === 'random',
      scripts: [], // por autor: { title, text, emotion }
      entries: [], // por roteiro: { ...script, author, performer, media }
      options: [],
      guesses: [], // por entrada: Map(jogador -> índice da opção)
      votes: [], // por jogador: { script, acting }
    };
    writeTurn(0);
  }

  // Evita perder a partida (e as gravações) sem querer.
  window.addEventListener('beforeunload', (e) => {
    if (state.game && !state.game.finished) e.preventDefault();
  });

  // ---------- escrever ----------

  const titleInput = $('script-title');
  const textInput = $('script-text');
  const otherInput = $('emotion-other');
  const checkedEmotion = () => document.querySelector('input[name="emotion"]:checked')?.value || '';

  textInput.addEventListener('input', () => {
    $('script-count').textContent = `${textInput.value.length}/3000`;
  });
  $('emotion-choices').addEventListener('change', () => {
    otherInput.hidden = checkedEmotion() !== 'other';
    if (!otherInput.hidden) otherInput.focus();
  });

  function writeTurn(i) {
    const { players } = state.game;
    if (i >= players.length) return startPerforming();
    $('step-label').textContent = `Etapa 1 de 4 · Escrever (${i + 1}/${players.length})`;
    return pass(name(i), 'Hora de escrever seu roteiro. Não deixe ninguém espiar!', `Sou ${name(i)}, começar`, () => {
      state.writer = i;
      $('write-name').textContent = name(i);
      titleInput.value = '';
      textInput.value = '';
      otherInput.value = '';
      otherInput.hidden = true;
      document.querySelectorAll('input[name="emotion"]').forEach((r) => (r.checked = false));
      $('script-count').textContent = '0/3000';
      $('emotion-pick').hidden = state.game.randomEmotions;
      $('emotion-random-note').hidden = !state.game.randomEmotions;
      showScreen('write');
      titleInput.focus();
      startTimer(state.game.writeMs, saveScript); // tempo esgotado: salva o que tiver
    });
  }

  function saveScript() {
    const i = state.writer;
    const choice = checkedEmotion();
    const other = otherInput.value.trim().slice(0, 30);
    const emotion = choice === 'other' ? other.charAt(0).toUpperCase() + other.slice(1) : EMOTIONS[choice] || '';
    state.game.scripts[i] = {
      title: titleInput.value.trim().slice(0, 60) || 'Sem título',
      text: textInput.value.trim().slice(0, 3000),
      emotion: emotion || randomPreset(), // sem escolha: sorteia uma pronta
    };
    writeTurn(i + 1);
  }

  $('write-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const emotion = checkedEmotion();
    if (state.game.randomEmotions) return saveScript();
    if (!emotion) return toast('Escolha o tipo de atuação.');
    if (emotion === 'other' && !otherInput.value.trim()) {
      otherInput.focus();
      return toast('Escreva qual é a emoção.');
    }
    return saveScript();
  });

  // ---------- gravar ----------

  const els = {
    preview: $('preview'),
    playVideo: $('playback-video'),
    playAudio: $('playback-audio'),
    status: $('rec-status'),
    open: $('rec-open'),
    start: $('rec-start'),
    stop: $('rec-stop'),
    redo: $('rec-redo'),
    send: $('rec-send'),
    skip: $('rec-skip'),
  };

  function setStatus(text) {
    els.status.textContent = text;
  }

  function showControls(...visible) {
    ['open', 'start', 'stop', 'redo', 'send'].forEach((k) => {
      els[k].hidden = !visible.includes(k);
    });
  }

  function clearPlayback() {
    if (state.playbackUrl) URL.revokeObjectURL(state.playbackUrl);
    state.playbackUrl = null;
    for (const el of [els.playVideo, els.playAudio]) {
      el.pause();
      el.removeAttribute('src');
      el.hidden = true;
    }
  }

  function resetPerform() {
    clearInterval(state.statusTimer);
    rec.close();
    clearPlayback();
    els.preview.srcObject = null;
    els.preview.hidden = true;
    rec.blob = null;
    els.open.textContent = state.mode === 'video' ? 'Ativar câmera' : 'Ativar microfone';
    showControls('open');
    setStatus('');
  }

  function startPerforming() {
    const { players, scripts } = state.game;
    const perm = derangement(players.length); // perm[ator] = roteiro
    state.game.entries = scripts.map((script, s) => ({
      ...script,
      // Modo sorteado: a emoção é de quem atua, sorteada agora.
      emotion: state.game.randomEmotions ? randomEmotion() : script.emotion,
      author: s,
      performer: perm.indexOf(s),
      media: null,
    }));

    state.game.options = buildEmotionOptions(state.game.entries.map((e) => e.emotion));
    state.game.perm = perm;
    performTurn(0);
  }

  function performTurn(i) {
    const { players, entries, perm } = state.game;
    if (i >= players.length) {
      state.performer = null;
      return showEntry(0);
    }
    const entry = entries[perm[i]];
    $('step-label').textContent = `Etapa 2 de 4 · Atuar (${i + 1}/${players.length})`;
    return pass(name(i), 'Você vai receber o roteiro de outra pessoa. Leia, ensaie e grave!', `Sou ${name(i)}, começar`, () => {
      state.performer = i;
      resetPerform();
      $('perform-name').textContent = name(i);
      $('perform-title').textContent = entry.title;
      $('perform-emotion').textContent = entry.emotion;
      $('perform-emotion-label').textContent = state.game.randomEmotions ? '🎲 Sua emoção sorteada:' : 'Atue com a emoção:';
      $('perform-text').textContent = entry.text || '(O autor não escreveu nada… improvise!)';
      showScreen('perform');
      startTimer(state.game.performMs, performTimeout);
    });
  }

  /** Guarda a gravação (ou nada) e passa para o próximo ator. */
  function finishPerform(blob) {
    const i = state.performer;
    if (i === null) return;
    const entry = state.game.entries[state.game.perm[i]];
    entry.media = blob ? { url: URL.createObjectURL(blob), kind: blob.type.startsWith('video') ? 'video' : 'audio' } : null;
    state.performer = null;
    resetPerform();
    performTurn(i + 1);
  }

  function performTimeout() {
    if (rec.recording) rec.stop().then(finishPerform);
    else finishPerform(rec.blob);
  }

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (rec.recording) return;
      state.mode = btn.dataset.mode;
      document.querySelectorAll('.mode-btn').forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-checked', String(b === btn));
      });
      resetPerform();
    });
  });

  els.open.addEventListener('click', async () => {
    if (!Recorder.supported()) {
      setStatus('Seu navegador não permite gravar aqui. A gravação só funciona em HTTPS ou em localhost.');
      return;
    }
    try {
      setStatus('Pedindo permissão…');
      const stream = await rec.open(state.mode);
      if (state.mode === 'video') {
        els.preview.srcObject = stream;
        els.preview.hidden = false;
      }
      setStatus(state.mode === 'video' ? 'Câmera pronta. Ensaie e grave quando quiser!' : 'Microfone pronto. Ensaie e grave quando quiser!');
      showControls('start');
    } catch (err) {
      setStatus(
        err.name === 'NotAllowedError'
          ? 'Permissão negada. Libere o microfone/câmera nas configurações do navegador.'
          : 'Não foi possível acessar o microfone/câmera.'
      );
    }
  });

  els.start.addEventListener('click', () => {
    const max = timeLeftMs();
    if (max < 1000) return;
    clearPlayback();
    rec.start(max);
    const performer = state.performer;
    rec.stopped.then((blob) => {
      // Se o tempo acabou, performTimeout já cuidou da gravação.
      if (state.performer !== performer || !state.onTimeout) return;
      clearInterval(state.statusTimer);
      clearPlayback();
      state.playbackUrl = URL.createObjectURL(blob);
      const player = state.mode === 'video' ? els.playVideo : els.playAudio;
      player.src = state.playbackUrl;
      player.hidden = false;
      els.preview.hidden = true;
      setStatus('Gravação pronta! Confira antes de seguir.');
      showControls('redo', 'send');
    });
    showControls('stop');
    clearInterval(state.statusTimer);
    state.statusTimer = setInterval(() => setStatus(`● Gravando ${fmt(rec.elapsedMs())} (restam ${fmt(timeLeftMs())})`), 250);
  });

  els.stop.addEventListener('click', () => rec.stop());

  els.redo.addEventListener('click', () => {
    clearPlayback();
    rec.blob = null;
    if (state.mode === 'video') els.preview.hidden = false;
    setStatus('Pronto para gravar de novo.');
    showControls('start');
  });

  els.send.addEventListener('click', () => rec.blob && finishPerform(rec.blob));

  els.skip.addEventListener('click', () => {
    if (rec.recording) return;
    if (!confirm('Seguir sem gravação? Você não poderá gravar depois.')) return;
    finishPerform(null);
  });

  // ---------- apresentação e palpites ----------

  function showEntry(k) {
    const { entries } = state.game;
    const entry = entries[k];
    $('step-label').textContent = `Etapa 3 de 4 · Apresentação ${k + 1} de ${entries.length}`;
    const show = () => {
      // Apresentação pulada: vai direto para os palpites desta atuação.
      if (state.game.skipAll) return startGuessing(k);
      $('show-title').textContent = entry.title;
      $('show-performer').textContent = `Interpretado por ${name(entry.performer)}`;
      const stage = $('show-stage');
      if (entry.media) {
        const media = document.createElement(entry.media.kind === 'video' ? 'video' : 'audio');
        media.className = 'performance';
        media.src = entry.media.url;
        media.controls = true;
        media.autoplay = true;
        media.playsInline = true;
        stage.replaceChildren(media);
      } else {
        const p = document.createElement('p');
        p.className = 'empty';
        p.textContent = `${name(entry.performer)} não gravou nada.`;
        stage.replaceChildren(p);
      }
      $('show-skip').onclick = () => skipEntry(k);
      $('show-skip-all').onclick = () => skipShowcase(k);
      $('show-guess').onclick = () => startGuessing(k);
      return showScreen('showcase');
    };
    // Na primeira apresentação, o aparelho volta do último ator para o grupo.
    if (k === 0) pass('todo mundo', 'Todos juntos agora: vamos assistir às atuações!', 'Começar a apresentação', show);
    else show();
  }

  function startGuessing(k) {
    stopShowMedia();
    const entry = state.game.entries[k];
    state.game.guesses[k] = new Map();
    // No modo sorteado o autor também não sabe a emoção, então palpita.
    const knows = (i) => i === entry.performer || (!state.game.randomEmotions && i === entry.author);
    const guessers = state.game.players.map((_, i) => i).filter((i) => !knows(i));
    guessTurn(k, guessers, 0);
  }

  // Pular só tira a mídia: os palpites e a revelação continuam.
  function skipEntry(k) {
    startGuessing(k);
  }

  function skipShowcase(k) {
    if (!confirm('Pular os vídeos/áudios de todas as atuações que faltam? Os palpites continuam.')) return;
    state.game.skipAll = true;
    startGuessing(k);
  }

  function stopShowMedia() {
    $('show-stage').querySelectorAll('video, audio').forEach((m) => m.pause());
  }

  function guessTurn(k, guessers, j) {
    if (j >= guessers.length) {
      return pass('todo mundo', 'Todos deram seus palpites. Mostre a tela para o grupo!', 'Revelar emoção', () => reveal(k));
    }
    const i = guessers[j];
    const entry = state.game.entries[k];
    return pass(name(i), `Palpite secreto (${j + 1}/${guessers.length}). Não deixe ninguém ver!`, `Sou ${name(i)}, palpitar`, () => {
      $('guess-name').textContent = name(i);
      $('guess-title').textContent = entry.title;
      $('guess-text').textContent = entry.text || '(roteiro em branco)';
      $('guess-options').replaceChildren(
        ...state.game.options.map((label, o) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn mode-btn guess-btn';
          btn.textContent = label;
          btn.addEventListener('click', () => {
            state.game.guesses[k].set(i, o);
            guessTurn(k, guessers, j + 1);
          });
          return btn;
        })
      );
      showScreen('guess');
    });
  }

  function isRight(entry, option) {
    return emotionKey(state.game.options[option]) === emotionKey(entry.emotion);
  }

  function reveal(k) {
    const { entries } = state.game;
    const entry = entries[k];
    const correct = [...state.game.guesses[k]].filter(([, o]) => isRight(entry, o)).map(([i]) => name(i));
    $('reveal-title').textContent = entry.title;
    $('reveal-emotion').textContent = `A emoção era: ${entry.emotion}`;
    $('reveal-correct').textContent = correct.length ? `Acertaram: ${correct.join(', ')}` : 'Ninguém acertou.';
    $('reveal-text').textContent = entry.text || '(roteiro em branco)';
    const last = k + 1 >= entries.length;
    $('reveal-next').textContent = last ? 'Ir para a votação' : 'Próxima atuação';
    $('reveal-next').onclick = () => (last ? voteTurn(0) : showEntry(k + 1));
    showScreen('reveal');
  }

  // ---------- votação ----------

  function radio(group, value, label, disabled) {
    const wrap = document.createElement('label');
    wrap.className = 'vote-option' + (disabled ? ' disabled' : '');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = group;
    input.value = value;
    input.disabled = disabled;
    input.required = true;
    const text = document.createElement('span');
    text.textContent = label;
    wrap.append(input, text);
    return wrap;
  }

  function voteTurn(i) {
    const { players, entries } = state.game;
    if (i >= players.length) return showResults();
    $('step-label').textContent = `Etapa 4 de 4 · Votar (${i + 1}/${players.length})`;
    return pass(name(i), 'Voto secreto: melhor roteiro e melhor atuação.', `Sou ${name(i)}, votar`, () => {
      state.voter = i;
      $('vote-name').textContent = name(i);
      $('vote-scripts').replaceChildren(
        ...entries.map((e, s) => radio('script', s, e.author === i ? `${e.title} (seu)` : e.title, e.author === i))
      );
      $('vote-acting').replaceChildren(
        ...entries.map((e, s) =>
          radio('acting', s, `${name(e.performer)} — “${e.title}”${e.performer === i ? ' (você)' : ''}`, e.performer === i)
        )
      );
      showScreen('vote');
    });
  }

  $('vote-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const script = form.querySelector('input[name="script"]:checked');
    const acting = form.querySelector('input[name="acting"]:checked');
    if (!script || !acting) return;
    state.game.votes[state.voter] = { script: Number(script.value), acting: Number(acting.value) };
    voteTurn(state.voter + 1);
  });

  // ---------- resultado ----------

  function cell(text, strong) {
    const td = document.createElement('td');
    if (strong) {
      const b = document.createElement('strong');
      b.textContent = text;
      td.append(b);
    } else {
      td.textContent = text;
    }
    return td;
  }

  function showResults() {
    const { players, entries, votes, guesses } = state.game;
    state.game.finished = true;
    const scriptVotes = entries.map(() => 0);
    const actingVotes = entries.map(() => 0);
    for (const v of votes) {
      scriptVotes[v.script] += 1;
      actingVotes[v.acting] += 1;
    }
    const correct = players.map(() => 0);
    entries.forEach((entry, k) => {
      for (const [i, o] of guesses[k]) if (isRight(entry, o)) correct[i] += 1;
    });

    // Empates: todos ganham. Sem votos/acertos, ninguém ganha.
    const winnersOf = (counts) => {
      const top = Math.max(0, ...counts);
      return counts.map((c) => top > 0 && c === top);
    };
    const scriptWin = winnersOf(scriptVotes);
    const actingWin = winnersOf(actingVotes);
    const guessWin = winnersOf(correct);

    const lines = [
      ['✍️ Melhor roteiro', entries.filter((_, s) => scriptWin[s]).map((e) => name(e.author))],
      ['🎭 Melhor atuação', entries.filter((_, s) => actingWin[s]).map((e) => name(e.performer))],
      ['🔍 Melhor palpiteiro', players.filter((_, i) => guessWin[i])],
    ].map(([label, names]) => {
      const p = document.createElement('p');
      p.className = 'winner';
      p.textContent = `${label}: ${names.length ? names.join(', ') : 'ninguém'}`;
      return p;
    });
    $('winners').replaceChildren(...lines);

    $('results-body').replaceChildren(
      ...entries.map((e, s) => {
        const tr = document.createElement('tr');
        tr.append(
          cell(e.title),
          cell(e.emotion),
          cell(`${scriptWin[s] ? '🏆 ' : ''}${name(e.author)}`, scriptWin[s]),
          cell(String(scriptVotes[s])),
          cell(`${actingWin[s] ? '🏆 ' : ''}${name(e.performer)}`, actingWin[s]),
          cell(String(actingVotes[s]))
        );
        return tr;
      })
    );
    $('guess-body').replaceChildren(
      ...players
        .map((p, i) => ({ p, c: correct[i], w: guessWin[i] }))
        .sort((a, b) => b.c - a.c)
        .map(({ p, c, w }) => {
          const tr = document.createElement('tr');
          tr.append(cell(`${w ? '🏆 ' : ''}${p}`, w), cell(`${c}/${entries.length}`));
          return tr;
        })
    );
    $('step-label').textContent = 'Fim de jogo';
    pass('todo mundo', 'Todos votaram!', 'Ver resultado', () => showScreen('results'));
  }

  function clearGameMedia() {
    state.game?.entries.forEach((e) => e.media && URL.revokeObjectURL(e.media.url));
  }

  $('again-same').addEventListener('click', renderSetup);

  renderSetup();
})();
