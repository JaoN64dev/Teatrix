/* Gravação de áudio ou vídeo com MediaRecorder. */
(function () {
  const TYPES = {
    video: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'],
    audio: ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'],
  };

  function pickMime(kind) {
    return TYPES[kind].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  }

  class Recorder {
    static supported() {
      return Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
    }

    constructor() {
      this.stream = null;
      this.kind = null;
      this.recorder = null;
      this.blob = null;
    }

    /** Pede permissão e abre microfone (e câmera, se kind === 'video'). */
    async open(kind) {
      this.close();
      this.kind = kind;
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: kind === 'video' ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } : false,
      });
      return this.stream;
    }

    get recording() {
      return this.recorder?.state === 'recording';
    }

    
    start(maxMs) {
      this.blob = null;
      const mimeType = pickMime(this.kind);
      // Bitrates baixos para o arquivo não ficar enorme.
      this.recorder = new MediaRecorder(this.stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 64_000,
        videoBitsPerSecond: 700_000,
      });
      const chunks = [];
      this.recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      this.stopped = new Promise((resolve) => {
        this.recorder.onstop = () => {
          const type = (this.recorder.mimeType || mimeType || `${this.kind}/webm`).split(';')[0];
          this.blob = new Blob(chunks, { type });
          clearTimeout(this.limitTimer);
          resolve(this.blob);
        };
      });
      this.recorder.start(1000);
      this.startedAt = performance.now();
      this.limitTimer = setTimeout(() => this.stop(), maxMs);
    }

    /** Não sei oq isso faz mds */
    stop() {
      if (this.recording) this.recorder.stop();
      return this.stopped || Promise.resolve(this.blob);
    }

    elapsedMs() {
      return this.recording ? performance.now() - this.startedAt : 0;
    }

    close() {
      clearTimeout(this.limitTimer);
      if (this.recording) this.recorder.stop();
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }

  window.Recorder = Recorder;
})();
