/* Formulários de conta: mostrar senha, aviso de Caps Lock, requisitos ao vivo e código de recuperação. */
(function () {
  // ---------- mostrar/esconder senha ----------

  document.querySelectorAll('.pw-toggle').forEach((btn) => {
    const input = document.getElementById(btn.getAttribute('aria-controls'));
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Esconder' : 'Mostrar';
      btn.setAttribute('aria-pressed', String(show));
      input.focus();
    });
  });

  // Ao enviar, volta tudo para "password" (o navegador não salva a senha como texto no histórico do campo).
  document.querySelectorAll('form').forEach((form) => {
    form.addEventListener('submit', () => {
      form.querySelectorAll('.password-field input').forEach((input) => {
        input.type = 'password';
      });
    });
  });

  // ---------- Caps Lock ----------

  document.querySelectorAll('.field').forEach((field) => {
    const warning = field.querySelector('.caps-warning');
    const input = field.querySelector('input[type="password"]');
    if (!warning || !input) return;
    const check = (e) => {
      if (e.getModifierState) warning.hidden = !e.getModifierState('CapsLock');
    };
    input.addEventListener('keydown', check);
    input.addEventListener('keyup', check);
    input.addEventListener('blur', () => (warning.hidden = true));
  });

  // ---------- requisitos ao vivo (cadastro e recuperação) ----------

  document.querySelectorAll('form[data-register]').forEach((form) => {
    const username = form.elements.username;
    const password = form.elements.password;
    const confirm = form.elements.confirm;
    const items = [...form.querySelectorAll('.checklist [data-rule]')];

    const rules = {
      username: () => /^[A-Za-z0-9]{3,20}$/.test(username.value.trim()),
      length: () => password.value.length >= 8,
      different: () => password.value.length > 0 && password.value !== username.value.trim(),
      match: () => confirm.value.length > 0 && confirm.value === password.value,
    };

    function update() {
      let ok = true;
      for (const li of items) {
        const pass = rules[li.dataset.rule]();
        li.classList.toggle('ok', pass);
        ok = ok && pass;
      }
      return ok;
    }

    form.addEventListener('input', () => {
      form.classList.remove('tried');
      update();
    });
    form.addEventListener('submit', (e) => {
      // O código também é conferido no servidor; aqui só evita ida e volta à toa.
      const code = form.elements.code;
      if (code && !code.value.trim()) {
        e.preventDefault();
        code.focus();
        return;
      }
      if (!update()) {
        e.preventDefault();
        form.classList.add('tried'); // destaca o que falta
        const firstBad = items.find((li) => !li.classList.contains('ok'));
        const target = { username, length: password, different: password, match: confirm }[firstBad.dataset.rule];
        target.focus();
      }
    });
    update();
  });

  // Código de recuperação digitado: maiúsculas e traços a cada 4 caracteres.
  document.querySelectorAll('[data-recovery-code]').forEach((input) => {
    input.addEventListener('input', () => {
      const raw = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
      input.value = raw.match(/.{1,4}/g)?.join('-') ?? '';
    });
  });

  // ---------- página do código de recuperação ----------

  const codeEl = document.getElementById('recovery-code');
  if (codeEl) {
    const code = codeEl.textContent.trim();
    const saved = document.getElementById('saved-code');
    const cont = document.getElementById('continue');

    document.getElementById('copy-code').addEventListener('click', async (e) => {
      try {
        await navigator.clipboard.writeText(code);
        e.target.textContent = 'Copiado!';
      } catch {
        // Sem permissão de área de transferência: seleciona o texto para copiar à mão.
        const range = document.createRange();
        range.selectNodeContents(codeEl);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      }
    });

    document.getElementById('download-code').addEventListener('click', () => {
      const text = `Teatrix — código de recuperação\n\n${code}\n\nUse em ${location.origin}/forgot se esquecer a senha.\n`;
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: 'teatrix-codigo-de-recuperacao.txt' });
      a.click();
      URL.revokeObjectURL(url);
      saved.checked = true;
      saved.dispatchEvent(new Event('change'));
    });

    // "Continuar" só depois de confirmar que guardou.
    const sync = () => cont.setAttribute('aria-disabled', String(!saved.checked));
    saved.addEventListener('change', sync);
    cont.addEventListener('click', (e) => {
      if (saved.checked) return;
      e.preventDefault();
      saved.focus();
      saved.closest('label').classList.add('attention');
    });
    sync();
  }
})();
