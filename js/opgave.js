// Copy only the target text. If clipboard access is unavailable, expose a
// selectable plain-text field beside the button so the task remains usable.
document.querySelectorAll('[data-copy-target]').forEach((button) => {
  const control = button.closest('.copy-control');
  const status = control.querySelector('.copy-status');
  const originalLabel = button.textContent;
  let resetTimer;

  button.addEventListener('click', async () => {
    const target = document.getElementById(button.dataset.copyTarget);
    if (!target) return;
    const text = (target instanceof HTMLTextAreaElement ? target.value : target.textContent).trim();
    clearTimeout(resetTimer);
    button.disabled = true;
    status.textContent = '';
    control.querySelector('.manual-copy')?.remove();

    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      button.textContent = 'Kopieret';
      status.textContent = 'Teksten er kopieret. Indsæt den i Copilot.';
      resetTimer = setTimeout(() => { button.textContent = originalLabel; }, 2200);
    } catch {
      button.textContent = originalLabel;
      const manual = document.createElement('div');
      manual.className = 'manual-copy';
      const label = document.createElement('label');
      const area = document.createElement('textarea');
      area.id = `manual-${button.dataset.copyTarget}`;
      area.value = text;
      area.readOnly = true;
      label.htmlFor = area.id;
      label.textContent = 'Kopiér den markerede tekst med Ctrl+C eller ⌘C.';
      manual.append(label, area);
      control.append(manual);
      status.textContent = 'Automatisk kopiering er ikke tilgængelig. Teksten er markeret nedenfor.';
      area.focus();
      area.select();
    } finally {
      button.disabled = false;
    }
  });
});
