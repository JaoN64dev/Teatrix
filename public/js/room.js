/* Cliente da sala: lobby, escrever, gravar, apresentação, votação e resultado. */
(function () {
  const $ = (id) => document.getElementById(id);
  const roomEl = $('room');
  const code = roomEl.dataset.code;
  const myId = roomEl.dataset.userId;

  const socket = io();
  const rec = new Recorder();

  const state = {
    room: null, // último room:state
    phase: null, // 'write' | 'perform' | 'vote' enquanto houver timer
    submitted: false,
    timerFrame: null,
    mode: 'audio',
    playbackUrl: null,
    autoSend: false,
    uploading: false,
    statusTimer: null,
    show: null, // atuação atual na apresentação (palpites)
  };

  // ---------- helpers ----------

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach((el) => {
      el.hidden = el.dataset.screen !== name;
    });
  }

  let toastTimer;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 4000);
  }

  function isHost() {
    return state.room && state.room.hostId === myId;
  }

  function fmt(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function fmtSeconds(s) {
    return s % 60 === 0 ? `${s / 60} min` : s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
  }

  function waiting(title) {
    $('waiting-title').textContent = title || 'Aguardando os outros…';
    showScreen('waiting');
  }

  // ---------- Timer ----------

  function startTimer(remainingMs, onExpire) {
    cancelAnimationFrame(state.timerFrame);
    const total = remainingMs;
    const end = performance.now() + remainingMs;
    state.timerEnd = end;
    $('timer').hidden = false;

    const tick = () => {
      const left = Math.max(0, end - performance.now());
      $('timer-bar').style.transform = `scaleX(${total ? left / total : 0})`;
      if (left <= 0) {
        onExpire();
        return;
      }
      state.timerFrame = requestAnimationFrame(tick);
    };
    tick();
  }

  function timeLeftMs() {
    return Math.max(0, (state.timerEnd || 0) - performance.now());
  }

  function stopTimer() {
    cancelAnimationFrame(state.timerFrame);
    $('timer').hidden = true;
  }

  // ---------- Lobby ----------

  $('set-write').addEventListener('change', (e) => socket.emit('room:settings', { writeSeconds: Number(e.target.value) }));
  $('set-perform').addEventListener('change', (e) => socket.emit('room:settings', { performSeconds: Number(e.target.value) }));
  $('set-emotion').addEventListener('change', (e) => socket.emit('room:settings', { emotionMode: e.target.value }));

  const randomEmotions = () => state.room?.settings.emotionMode === 'random';

  function renderLobby() {
    const { players, minPlayers, settings } = state.room;
    const online = players.filter((p) => p.connected).length;
    const missing = Math.max(0, minPlayers - online);

    for (const [id, key] of [['set-write', 'writeSeconds'], ['set-perform', 'performSeconds']]) {
      const select = $(id);
      select.disabled = !isHost();
      const value = String(settings[key]);
      if (![...select.options].some((o) => o.value === value)) select.add(new Option(fmtSeconds(settings[key]), value));
      select.value = value;
    }
    $('set-emotion').disabled = !isHost();
    $('set-emotion').value = settings.emotionMode;
    $('settings-hint').textContent = isHost() ? '' : 'O anfitrião escolhe as configurações.';

    $('start').hidden = !isHost();
    $('start').disabled = missing > 0;
    $('lobby-hint').textContent = missing > 0
      ? `Aguardando mais ${missing} jogador(es)… Compartilhe o código ${code}.`
      : isHost()
        ? 'Todos prontos? Comece quando quiser.'
        : 'Aguardando o anfitrião começar.';
    $('step-label').textContent = '';
    $('results-history').hidden = true;
    state.phase = null;
    stopTimer();
    resetPerform();
    showScreen('lobby');
  }

  $('start').addEventListener('click', () => socket.emit('room:start'));

  // ---------- Escrever ----------

  const titleInput = $('script-title');
  const textInput = $('script-text');
  textInput.addEventListener('input', () => {
    $('script-count').textContent = `${textInput.value.length}/3000`;
  });

  const otherInput = $('emotion-other');
  const checkedEmotion = () => document.querySelector('input[name="emotion"]:checked')?.value || '';

  $('emotion-choices').addEventListener('change', () => {
    otherInput.hidden = checkedEmotion() !== 'other';
    if (!otherInput.hidden) otherInput.focus();
  });

  // Tempo esgotado envia mesmo sem emoção: o servidor sorteia uma.
  function submitScript() {
    if (state.phase !== 'write' || state.submitted) return;
    state.submitted = true;
    socket.emit('script:submit', {
      title: titleInput.value,
      text: textInput.value,
      emotion: checkedEmotion(),
      emotionOther: otherInput.value,
    });
    waiting();
  }

  $('write-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const emotion = checkedEmotion();
    if (randomEmotions()) return submitScript();
    if (!emotion) return toast('Escolha o tipo de atuação.');
    if (emotion === 'other' && !otherInput.value.trim()) {
      otherInput.focus();
      return toast('Escreva qual é a emoção.');
    }
    return submitScript();
  });

  function renderWrite({ remainingMs, submitted }) {
    state.phase = 'write';
    state.submitted = submitted;
    $('step-label').textContent = 'Etapa 1 de 3 · Escrever';
    if (submitted) return waiting();
    $('emotion-pick').hidden = randomEmotions();
    $('emotion-random-note').hidden = !randomEmotions();
    showScreen('write');
    titleInput.focus();
    startTimer(remainingMs, submitScript);
    return null;
  }

  // ---------- Gravar ----------

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
    state.autoSend = false;
    state.uploading = false;
    rec.blob = null;
    els.open.textContent = state.mode === 'video' ? 'Ativar câmera' : 'Ativar microfone';
    showControls('open');
    els.skip.hidden = false;
    setStatus('');
  }

  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (rec.recording || state.uploading) return;
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
    rec.stopped.then(onRecorded);
    showControls('stop');
    clearInterval(state.statusTimer);
    state.statusTimer = setInterval(() => setStatus(`● Gravando ${fmt(rec.elapsedMs())} (restam ${fmt(timeLeftMs())})`), 250);
  });

  els.stop.addEventListener('click', () => rec.stop());

  function onRecorded(blob) {
    clearInterval(state.statusTimer);
    if (state.phase !== 'perform' || state.submitted) return;
    if (state.autoSend) {
      upload(blob);
      return;
    }
    clearPlayback();
    state.playbackUrl = URL.createObjectURL(blob);
    const player = state.mode === 'video' ? els.playVideo : els.playAudio;
    player.src = state.playbackUrl;
    player.hidden = false;
    els.preview.hidden = true;
    setStatus('Gravação pronta! Confira antes de enviar.');
    showControls('redo', 'send');
  }

  els.redo.addEventListener('click', () => {
    clearPlayback();
    rec.blob = null;
    if (state.mode === 'video') els.preview.hidden = false;
    setStatus('Pronto para gravar de novo.');
    showControls('start');
  });

  els.send.addEventListener('click', () => rec.blob && upload(rec.blob));

  els.skip.addEventListener('click', () => {
    if (state.submitted || state.uploading) return;
    if (!confirm('Enviar sem gravação? Você não poderá gravar depois.')) return;
    skipPerformance();
  });

  function skipPerformance() {
    state.submitted = true;
    socket.emit('performance:skip');
    resetPerform();
    waiting();
  }

  function upload(blob) {
    if (state.uploading || state.submitted) return;
    state.uploading = true;
    showControls();
    els.skip.hidden = true;
    setStatus('Enviando… 0%');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/room/${code}/performance`);
    xhr.setRequestHeader('Content-Type', blob.type.split(';')[0]);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setStatus(`Enviando… ${Math.round((e.loaded / e.total) * 100)}%`);
    };
    xhr.onload = () => {
      state.uploading = false;
      // Se esta foi a última gravação, a apresentação (via socket) pode chegar antes desta
      // resposta. Nesse caso a fase já mudou e não podemos cobrir a tela com "aguardando".
      if (state.phase !== 'perform') return;
      if (xhr.status === 200) {
        state.submitted = true;
        resetPerform();
        waiting();
        return;
      }
      let message = 'Falha ao enviar a gravação.';
      try {
        message = JSON.parse(xhr.responseText).error || message;
      } catch {
        /* resposta não-JSON */
      }
      setStatus(message);
      showControls('redo', 'send');
      els.skip.hidden = false;
    };
    xhr.onerror = () => {
      state.uploading = false;
      if (state.phase !== 'perform') return;
      setStatus('Sem conexão. Tente enviar de novo.');
      showControls('redo', 'send');
      els.skip.hidden = false;
    };
    xhr.send(blob);
  }

  // Tempo esgotado: envia o que tiver.
  function performTimeout() {
    if (state.submitted || state.uploading) return;
    state.autoSend = true;
    if (rec.recording) rec.stop(); // onRecorded envia
    else if (rec.blob) upload(rec.blob);
    else skipPerformance();
  }

  function renderPerform({ remainingMs, submitted, script }) {
    state.phase = 'perform';
    state.submitted = submitted;
    $('step-label').textContent = 'Etapa 2 de 3 · Atuar';
    if (submitted) return waiting();
    resetPerform();
    $('perform-title').textContent = script.title;
    $('perform-emotion').textContent = script.emotion;
    $('perform-emotion-label').textContent = randomEmotions() ? '🎲 Sua emoção sorteada:' : 'Atue com a emoção:';
    $('perform-text').textContent = script.text || '(O autor não escreveu nada… improvise!)';
    showScreen('perform');
    startTimer(remainingMs, performTimeout);
    return null;
  }

  // ---------- Apresentação ----------

  $('show-next').addEventListener('click', () => socket.emit('showcase:next'));
  $('show-reveal').addEventListener('click', () => socket.emit('showcase:reveal'));
  $('show-skip').addEventListener('click', () => socket.emit('showcase:skip', { all: false }));
  $('show-skip-all').addEventListener('click', () => {
    if (!confirm('Pular os vídeos/áudios de todas as atuações que faltam? Os palpites continuam.')) return;
    socket.emit('showcase:skip', { all: true });
  });
  socket.on('showcase:skipped', ({ all }) => {
    $('show-stage').querySelectorAll('video, audio').forEach((m) => m.pause());
    toast(all ? 'O anfitrião pulou a apresentação. Os palpites continuam!' : 'O anfitrião pulou esta atuação. Os palpites continuam!');
  });

  function renderGuessHint() {
    const { canGuess, myGuess, emotion, progress, reveal } = state.show;
    if (reveal) return;
    let hint;
    if (progress.total === 0) hint = 'Ninguém pode palpitar nesta atuação.';
    else if (!canGuess) hint = `Você já sabe a emoção: ${emotion}. Aguarde os palpites.`;
    else if (myGuess === null) hint = 'Escolha uma emoção. Dá para trocar até a revelação.';
    else hint = 'Palpite registrado! Dá para trocar até a revelação.';
    if (progress.total > 0) hint += ` (${progress.done}/${progress.total} palpitaram)`;
    $('guess-hint').textContent = hint;
  }

  function renderGuess() {
    const { options, canGuess, myGuess, reveal } = state.show;
    $('guess-options').replaceChildren(
      ...options.map((label, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn mode-btn guess-btn';
        btn.textContent = label;
        btn.disabled = !canGuess || Boolean(reveal);
        btn.classList.toggle('active', myGuess === i && !reveal);
        if (reveal) {
          const right = i === reveal.option;
          btn.classList.toggle('right', right);
          btn.classList.toggle('wrong', myGuess === i && !right);
        }
        btn.addEventListener('click', () => {
          state.show.myGuess = i;
          socket.emit('showcase:guess', { index: state.show.index, option: i });
          renderGuess();
        });
        return btn;
      })
    );

    $('guess-reveal').hidden = !reveal;
    $('guess-correct').hidden = !reveal;
    $('guess-hint').hidden = Boolean(reveal);
    if (reveal) {
      $('guess-reveal').textContent = `A emoção era: ${reveal.emotion}`;
      $('guess-correct').textContent = reveal.correct.length
        ? `Acertaram: ${reveal.correct.join(', ')}`
        : 'Ninguém acertou.';
    } else {
      renderGuessHint();
    }
    updateHostButtons();
  }

  function renderShowcase({ index, total, entry, skipped, skipAll, options, canGuess, emotion, myGuess, progress, reveal }) {
    state.show = { index, options, canGuess, emotion, myGuess, progress, reveal, skipped, skipAll };
    state.phase = null;
    stopTimer();
    resetPerform();
    $('step-label').textContent = `Apresentação ${index + 1} de ${total}`;
    $('show-title').textContent = entry.title;
    $('show-performer').textContent = `Interpretado por ${entry.performerName}`;
    $('show-text').textContent = entry.text || '(roteiro em branco)';

    const stage = $('show-stage');
    stage.querySelectorAll('video, audio').forEach((m) => m.pause());
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
      p.textContent = skipped ? '⏭ Apresentação pulada — dê seu palpite pelo roteiro!' : `${entry.performerName} não gravou nada.`;
      stage.replaceChildren(p);
    }

    $('show-next').textContent = index + 1 < total ? 'Próxima' : 'Ir para a votação';
    renderGuess();
    showScreen('showcase');
  }

  socket.on('showcase:progress', ({ index, done, total }) => {
    if (!state.show || state.show.index !== index) return;
    state.show.progress = { done, total };
    renderGuessHint();
  });

  socket.on('showcase:reveal', ({ index, ...reveal }) => {
    if (!state.show || state.show.index !== index) return;
    state.show.reveal = reveal;
    renderGuess();
  });

  // ---------- Votação ----------

  function radio(name, value, label, disabled) {
    const wrap = document.createElement('label');
    wrap.className = 'vote-option' + (disabled ? ' disabled' : '');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = value;
    input.disabled = disabled;
    input.required = true;
    const text = document.createElement('span');
    text.textContent = label;
    wrap.append(input, text);
    return wrap;
  }

  function submitVote() {
    if (state.phase !== 'vote' || state.submitted) return false;
    const form = $('vote-form');
    const script = form.querySelector('input[name="script"]:checked');
    const acting = form.querySelector('input[name="acting"]:checked');
    if (!script || !acting) return false;
    state.submitted = true;
    socket.emit('vote:submit', { script: Number(script.value), acting: acting.value });
    waiting('Voto registrado! Aguardando os outros…');
    return true;
  }

  $('vote-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitVote();
  });

  function renderVote({ remainingMs, submitted, scripts, performers }) {
    state.phase = 'vote';
    state.submitted = submitted;
    $('step-label').textContent = 'Etapa 3 de 3 · Votar';
    if (submitted) return waiting('Voto registrado! Aguardando os outros…');

    $('vote-scripts').replaceChildren(
      ...scripts.map((s) => radio('script', s.index, s.own ? `${s.title} (seu)` : s.title, s.own))
    );
    $('vote-acting').replaceChildren(
      ...performers.map((p) => radio('acting', p.id, `${p.name} — “${p.title}”${p.self ? ' (você)' : ''}`, p.self))
    );
    showScreen('vote');
    startTimer(remainingMs, submitVote);
    return null;
  }

  // ---------- Resultado ----------

  $('to-lobby').addEventListener('click', () => socket.emit('room:lobby'));

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

  function renderResults({ entries, scriptWinners, actingWinners, guessers, guessWinners, guessTotal }) {
    state.show = null;
    state.phase = null;
    stopTimer();
    $('step-label').textContent = 'Fim de jogo';

    const lines = [
      ['✍️ Melhor roteiro', scriptWinners],
      ['🎭 Melhor atuação', actingWinners],
      ['🔍 Melhor palpiteiro', guessWinners],
    ].map(([label, names]) => {
      const p = document.createElement('p');
      p.className = 'winner';
      p.textContent = `${label}: ${names.length ? names.join(', ') : 'ninguém recebeu votos'}`;
      return p;
    });
    $('winners').replaceChildren(...lines);

    $('results-body').replaceChildren(
      ...entries.map((e) => {
        const tr = document.createElement('tr');
        tr.append(
          cell(e.title),
          cell(e.emotion),
          cell(`${e.scriptWinner ? '🏆 ' : ''}${e.authorName}`, e.scriptWinner),
          cell(String(e.scriptVotes)),
          cell(`${e.actingWinner ? '🏆 ' : ''}${e.performerName}`, e.actingWinner),
          cell(String(e.actingVotes))
        );
        return tr;
      })
    );
    $('guess-body').replaceChildren(
      ...guessers.map((g) => {
        const tr = document.createElement('tr');
        tr.append(cell(`${g.winner ? '🏆 ' : ''}${g.name}`, g.winner), cell(`${g.correct}/${guessTotal}`));
        return tr;
      })
    );
    updateHostButtons();
    showScreen('results');
  }

  function updateHostButtons() {
    const host = isHost();
    const revealed = Boolean(state.show?.reveal);
    $('show-reveal').hidden = !host || revealed;
    $('show-next').hidden = !host || !revealed;
    $('show-skips').hidden = !host;
    $('show-skip').hidden = revealed || Boolean(state.show?.skipped); // depois de revelar, "Próxima" já avança
    $('show-skip-all').hidden = Boolean(state.show?.skipAll);
    $('show-wait').hidden = host;
    $('to-lobby').hidden = !host;
  }

  // ---------- Sala ----------

  $('leave').addEventListener('click', () => {
    socket.emit('room:leave');
    window.location.href = '/';
  });

  $('copy-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/room/${code}`);
      toast('Link copiado!');
    } catch {
      toast(`Código da sala: ${code}`);
    }
  });

  $('qr-img').addEventListener('error', () => {
    $('qr-img').hidden = true;
    $('qr-hint').textContent = `Não foi possível gerar o QR code. Use o código ${code} ou o link: ${location.origin}/room/${code}`;
  });
  $('qr-img').addEventListener('load', () => {
    $('qr-img').hidden = false;
    $('qr-hint').textContent = 'Aponte a câmera do celular para o código.';
  });

  $('show-qr').addEventListener('click', () => {
    const img = $('qr-img');
    // Carrega só ao abrir; se falhou antes, tenta de novo.
    if (!img.src || img.hidden) img.src = `/room/${code}/qr.svg?t=${Date.now()}`;
    $('qr-dialog').showModal();
  });
  // Clique fora do conteúdo fecha.
  $('qr-dialog').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });

  function renderPlayers() {
    const { players, maxPlayers } = state.room;
    $('players').replaceChildren(
      ...players.map((p) => {
        const li = document.createElement('li');
        if (!p.connected) li.classList.add('offline');
        if (p.id === myId) li.classList.add('me');
        li.textContent = `${p.isHost ? '👑 ' : ''}${p.name}${p.connected ? '' : ' (saiu)'}`;
        return li;
      })
    );
    $('player-count').textContent = `${players.length}/${maxPlayers}`;
  }

  // ---------- Eventos do servidor ----------

  socket.on('connect', () => socket.emit('room:join', code));

  socket.on('room:state', (room) => {
    state.room = room;
    renderPlayers();
    if (room.phase === 'lobby') renderLobby();
    else updateHostButtons();
  });

  socket.on('phase:write', renderWrite);
  socket.on('phase:perform', renderPerform);
  socket.on('phase:vote', renderVote);
  socket.on('showcase:show', renderShowcase);
  socket.on('results', renderResults);

  socket.on('phase:progress', ({ done, total }) => {
    $('progress').textContent = `${done}/${total}`;
  });

  socket.on('match:saved', ({ matchId, coinsEarned }) => {
    toast(`+${coinsEarned} moedas! A partida foi salva no histórico.`);
    $('results-history').href = `/history/${matchId}`;
    $('results-history').hidden = false;
    const coins = document.querySelector('.coins');
    if (coins) {
      const current = parseInt(coins.textContent.replace(/\D/g, ''), 10) || 0;
      coins.textContent = `🪙 ${current + coinsEarned}`;
    }
  });

  socket.on('error:msg', toast);
  socket.on('connect_error', () => toast('Sem conexão com o servidor. Tentando novamente…'));
})();
