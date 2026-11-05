// Browser side of Textshare. All checks and sanitising happen in
// worker/textshare.js. Text only ever reaches the page through .value and
// .textContent, never as HTML.
const API = '/textshare/api';
const STORAGE_KEY = 'textshare.documents';
const SAVE_DELAY_MS = 1200;
const RETRY_DELAY_MS = 5000;

const byId = (id) => document.getElementById(id);
const show = (id) => { byId(id).hidden = false; };

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error ?? 'Noget gik galt. Prøv igen.');
    error.status = response.status;
    throw error;
  }
  return body;
}

// The list of a student's documents is a convenience. Without browser storage
// the secret edit link still gives access.
function loadDocuments() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rememberDocument({ id, key, title }) {
  try {
    const others = loadDocuments().filter((item) => item.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id, key, title }, ...others]));
  } catch {
    // Storage can be blocked. The document itself is already saved.
  }
}

const editPath = (id, key) => `/textshare/edit/${encodeURIComponent(id)}#${key}`;
const publicPath = (id) => `/textshare/doc/${encodeURIComponent(id)}`;

function renderDocumentList() {
  const documents = loadDocuments();
  if (!documents.length) return;
  const list = byId('my-docs-list');
  for (const item of documents) {
    const row = document.createElement('li');
    const edit = document.createElement('a');
    edit.className = 'link';
    edit.href = editPath(item.id, item.key);
    edit.textContent = item.title;
    const open = document.createElement('a');
    open.className = 'link textshare-open';
    open.href = publicPath(item.id);
    open.textContent = 'Læs';
    row.append(edit, open);
    list.append(row);
  }
  show('my-docs');
}

function showHome() {
  show('view-home');
  renderDocumentList();
  byId('create-title').focus();
}

function initHome() {
  byId('pin-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorOutput = byId('pin-error');
    errorOutput.textContent = '';
    try {
      await request('/session', {
        method: 'POST',
        body: JSON.stringify({ pin: byId('pin-input').value }),
      });
      byId('view-pin').hidden = true;
      showHome();
    } catch (error) {
      errorOutput.textContent = error.message;
      byId('pin-input').select();
    }
  });

  byId('create-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorOutput = byId('create-error');
    const button = event.target.querySelector('button');
    errorOutput.textContent = '';
    button.disabled = true;
    try {
      const created = await request('/docs', {
        method: 'POST',
        body: JSON.stringify({ title: byId('create-title').value, content: '' }),
      });
      rememberDocument(created);
      location.assign(editPath(created.id, created.key));
    } catch (error) {
      if (error.status === 401) {
        byId('view-home').hidden = true;
        show('view-pin');
      } else {
        errorOutput.textContent = error.message;
      }
      button.disabled = false;
    }
  });

  request('/session')
    .then(({ authenticated }) => {
      if (authenticated) {
        showHome();
      } else {
        show('view-pin');
        byId('pin-input').focus();
      }
    })
    .catch(() => {
      show('view-pin');
      byId('pin-error').textContent = 'Textshare kan ikke kontaktes lige nu.';
    });
}

function initCopyButtons() {
  document.querySelectorAll('[data-copy]').forEach((button) => {
    const label = button.textContent;
    button.addEventListener('click', async () => {
      const input = byId(button.dataset.copy);
      input.focus();
      input.select();
      try {
        await navigator.clipboard.writeText(input.value);
        button.textContent = 'Kopieret';
        setTimeout(() => { button.textContent = label; }, 2000);
      } catch {
        // The text stays selected, ready for Ctrl+C or ⌘C.
      }
    });
  });
}

async function initEditor(id) {
  const key = location.hash.slice(1) || loadDocuments().find((item) => item.id === id)?.key || '';
  const titleInput = byId('edit-title');
  const contentInput = byId('edit-content');
  const status = byId('save-status');
  let loaded;
  try {
    loaded = await request(`/docs/${encodeURIComponent(id)}`, { headers: { 'X-Edit-Key': key } });
  } catch {
    show('view-missing');
    return;
  }

  let version = loaded.version;
  let dirty = false;
  let saving = false;
  let locked = false;
  let timer;

  titleInput.value = loaded.title;
  contentInput.value = loaded.content;
  byId('public-link').value = new URL(publicPath(id), location.origin).href;
  byId('edit-link').value = new URL(editPath(id, key), location.origin).href;
  rememberDocument({ id, key, title: loaded.title });
  initCopyButtons();
  show('view-editor');

  const schedule = (delay) => {
    clearTimeout(timer);
    timer = setTimeout(save, delay);
  };

  async function save() {
    if (saving || locked) return;
    const title = titleInput.value;
    const content = contentInput.value;
    saving = true;
    dirty = false;
    status.textContent = 'Gemmer …';
    try {
      const saved = await request(`/docs/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'X-Edit-Key': key },
        body: JSON.stringify({ title, content, version }),
      });
      version = saved.version;
      rememberDocument({ id, key, title: saved.title });
      const cleaned = saved.content !== content;
      // Replacing the text moves the cursor, so leave it alone while typing.
      if (!dirty && cleaned) contentInput.value = saved.content;
      status.textContent = cleaned ? 'Gemt. Farlige tegn er fjernet.' : 'Gemt';
    } catch (error) {
      if (error.status === 409 || error.status === 404) {
        locked = true;
        titleInput.disabled = true;
        contentInput.disabled = true;
      } else {
        dirty = true;
        if (error.status !== 413) schedule(RETRY_DELAY_MS);
      }
      status.textContent = error.status ? error.message : 'Kunne ikke gemme. Prøver igen …';
    } finally {
      saving = false;
    }
    if (dirty && !locked) schedule(SAVE_DELAY_MS);
  }

  const onEdit = () => {
    dirty = true;
    status.textContent = 'Ikke gemt endnu';
    schedule(SAVE_DELAY_MS);
  };
  titleInput.addEventListener('input', onEdit);
  contentInput.addEventListener('input', onEdit);
  window.addEventListener('beforeunload', (event) => {
    if (dirty || saving) event.preventDefault();
  });
}

const editMatch = location.pathname.match(/^\/textshare\/edit\/([a-z0-9-]+)$/);
if (editMatch) {
  initEditor(editMatch[1]);
} else {
  initHome();
}
