// Textshare: PIN-gated plain text documents with a public read-only link.
//
//   /textshare                  create documents (behind the PIN)
//   /textshare/edit/<id>#<key>  edit a document (needs its secret edit key)
//   /textshare/doc/<id>         public read-only page, rendered here
//   /textshare/api/...          JSON API used by js/textshare.js
//
// The PIN gates creating documents. Editing needs the document's own key, so
// students cannot overwrite each other's work. Only the hash of a key is stored.

const MAX_TITLE = 120;
const MAX_CONTENT = 100_000;
const MAX_BODY_BYTES = 600_000; // MAX_CONTENT as multi-byte text, JSON-escaped.
const SESSION_SECONDS = 12 * 60 * 60;
const PIN_WINDOW_SECONDS = 10 * 60;
// A whole class can share one IP, so this allows for some mistyping. It still
// makes guessing a four-digit PIN impractical.
const PIN_MAX_FAILURES = 20;
const SESSION_COOKIE = 'textshare_session';
const ID_PATTERN = /^[a-z0-9-]{1,64}$/;
const KEY_PATTERN = /^[a-f0-9]{32}$/;
const UNTITLED = 'Uden titel';

// Removed from everything stored and shown: angle brackets (the characters that
// open HTML), control characters, zero-width characters and bidirectional
// overrides, which can disguise what a text or link really says.
// Tab and newline stay. So do & " and ', which normal text needs. They are
// escaped on output by escapeHtml instead.
const DANGEROUS_CHARACTERS =
  /[<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\u200E\u200F\u202A-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/g;

export function sanitizeText(value) {
  return String(value)
    .toWellFormed()
    .replace(/\r\n?|\u2028|\u2029/g, '\n')
    .normalize('NFC')
    .replace(DANGEROUS_CHARACTERS, '');
}

export function sanitizeTitle(value) {
  return sanitizeText(value).replace(/\s+/g, ' ').trim();
}

export function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SHARED_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};

// The public page runs no scripts at all, so stored text can never execute.
const PUBLIC_PAGE_CSP = [
  "default-src 'none'",
  "style-src 'self' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const APP_PAGE_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SHARED_SECURITY_HEADERS,
      ...headers,
    },
  });
}

const fail = (message, status) => json({ error: message }, status);

function randomHex(byteCount) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteCount));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function now() {
  return Math.floor(Date.now() / 1000);
}

function readCookie(request, name) {
  const cookies = request.headers.get('Cookie') ?? '';
  for (const part of cookies.split(';')) {
    const separator = part.indexOf('=');
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

async function hasSession(request, env) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || !KEY_PATTERN.test(token)) return false;
  const row = await env.DB.prepare('SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(await sha256(token), now())
    .first();
  return row !== null;
}

// Rejects oversized bodies and anything that is not a JSON object.
async function readJson(request) {
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY_BYTES) return null;
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function slugify(title) {
  const slug = title
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/å/g, 'aa')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return slug || 'tekst';
}

function newDocumentId(title) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => alphabet[byte % alphabet.length]);
  return `${slugify(title)}-${suffix.join('')}`;
}

function validateDocument(body) {
  if (typeof body.title !== 'string' || typeof body.content !== 'string') {
    return { error: 'Ugyldigt dokument.' };
  }
  const title = sanitizeTitle(body.title) || UNTITLED;
  const content = sanitizeText(body.content);
  if (title.length > MAX_TITLE) return { error: `Titlen må højst være ${MAX_TITLE} tegn.` };
  if (content.length > MAX_CONTENT) return { error: `Teksten må højst være ${MAX_CONTENT} tegn.` };
  return { title, content };
}

function documentJson(row) {
  return {
    id: row.id,
    title: sanitizeTitle(row.title),
    content: sanitizeText(row.content),
    version: row.version,
    updatedAt: row.updated_at,
  };
}

async function handleSessionCheck(request, env) {
  return json({ authenticated: await hasSession(request, env) });
}

async function handlePin(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const time = now();
  const windowStart = time - PIN_WINDOW_SECONDS;
  const attempts = await env.DB.prepare('SELECT failures FROM pin_attempts WHERE ip = ? AND window_start > ?')
    .bind(ip, windowStart)
    .first();
  if (attempts && attempts.failures >= PIN_MAX_FAILURES) {
    return fail('For mange forsøg. Prøv igen om lidt.', 429);
  }

  const body = await readJson(request);
  if (!env.TEXTSHARE_PIN || typeof body?.pin !== 'string' || body.pin !== env.TEXTSHARE_PIN) {
    await env.DB.prepare(
      `INSERT INTO pin_attempts (ip, failures, window_start) VALUES (?1, 1, ?2)
       ON CONFLICT (ip) DO UPDATE SET
         failures = CASE WHEN window_start > ?3 THEN failures + 1 ELSE 1 END,
         window_start = CASE WHEN window_start > ?3 THEN window_start ELSE ?2 END`,
    )
      .bind(ip, time, windowStart)
      .run();
    return fail('Forkert pinkode.', 401);
  }

  const token = randomHex(16);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(time),
    env.DB.prepare('DELETE FROM pin_attempts WHERE ip = ? OR window_start <= ?').bind(ip, windowStart),
    env.DB.prepare('INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)').bind(
      await sha256(token),
      time + SESSION_SECONDS,
    ),
  ]);
  return json({ authenticated: true }, 200, {
    'Set-Cookie': `${SESSION_COOKIE}=${token}; Path=/textshare; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`,
  });
}

async function handleCreate(request, env) {
  if (!(await hasSession(request, env))) return fail('Pinkode kræves.', 401);
  const body = await readJson(request);
  if (!body) return fail('Ugyldigt dokument.', 400);
  const document = validateDocument(body);
  if (document.error) return fail(document.error, 413);

  const id = newDocumentId(document.title);
  const key = randomHex(16);
  const time = now();
  await env.DB.prepare(
    `INSERT INTO documents (id, title, content, edit_key_hash, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  )
    .bind(id, document.title, document.content, await sha256(key), time, time)
    .run();
  return json({ id, key, title: document.title, content: document.content, version: 1 }, 201);
}

// Wrong keys and missing documents get the same answer, so the API does not
// reveal whether a guessed address exists.
async function readEditableDocument(request, env, id) {
  const key = request.headers.get('X-Edit-Key') ?? '';
  if (!KEY_PATTERN.test(key)) return null;
  const row = await env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first();
  return row && row.edit_key_hash === (await sha256(key)) ? row : null;
}

async function handleRead(request, env, id) {
  const row = await readEditableDocument(request, env, id);
  return row ? json(documentJson(row)) : fail('Dokumentet blev ikke fundet.', 404);
}

async function handleUpdate(request, env, id) {
  const row = await readEditableDocument(request, env, id);
  if (!row) return fail('Dokumentet blev ikke fundet.', 404);
  const body = await readJson(request);
  if (!body || !Number.isInteger(body.version)) return fail('Ugyldigt dokument.', 400);
  const document = validateDocument(body);
  if (document.error) return fail(document.error, 413);

  // The version check stops an old browser tab from overwriting newer text.
  const result = await env.DB.prepare(
    `UPDATE documents SET title = ?, content = ?, version = version + 1, updated_at = ?
     WHERE id = ? AND version = ?`,
  )
    .bind(document.title, document.content, now(), id, body.version)
    .run();
  if (result.meta.changes === 0) {
    return fail('Dokumentet er blevet ændret et andet sted. Genindlæs siden.', 409);
  }
  return json({ title: document.title, content: document.content, version: body.version + 1 });
}

function renderPublicPage(row) {
  const title = escapeHtml(sanitizeTitle(row.title));
  const content = escapeHtml(sanitizeText(row.content));
  const updated = new Date(row.updated_at * 1000).toLocaleString('da-DK', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Copenhagen',
  });
  return `<!DOCTYPE html>
<html lang="da">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | Textshare</title>
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" type="image/svg+xml" href="/images/favicon.svg?v=2">
  <link href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/styles.css?v=13">
  <link rel="stylesheet" href="/css/textshare.css?v=1">
</head>
<body class="textshare-page">
  <main class="container textshare-main textshare-reader">
    <p class="eyebrow eyebrow-accent">Textshare</p>
    <h1 class="t-h2">${title}</h1>
    <p class="textshare-updated">Opdateret ${escapeHtml(updated)}</p>
    <article class="textshare-text">${content || '<em>Dokumentet er tomt.</em>'}</article>
  </main>
  <footer class="container textshare-footer"><p>Teksten er skrevet af en bruger og ikke af BramLabs.</p></footer>
</body>
</html>`;
}

async function handlePublicPage(env, id) {
  const row = await env.DB.prepare('SELECT title, content, updated_at FROM documents WHERE id = ?').bind(id).first();
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Content-Security-Policy': PUBLIC_PAGE_CSP,
    ...SHARED_SECURITY_HEADERS,
  };
  if (!row) {
    const missing = { title: 'Dokumentet findes ikke', content: 'Tjek linket og prøv igen.', updated_at: now() };
    return new Response(renderPublicPage(missing), { status: 404, headers });
  }
  return new Response(renderPublicPage(row), { headers });
}

async function serveAppPage(request, env, url) {
  const assetUrl = new URL('/textshare', url.origin);
  const asset = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
  const response = new Response(asset.body, asset);
  response.headers.set('Content-Security-Policy', APP_PAGE_CSP);
  for (const [name, value] of Object.entries(SHARED_SECURITY_HEADERS)) response.headers.set(name, value);
  return response;
}

async function handleApi(request, env, url, path) {
  const isRead = request.method === 'GET' || request.method === 'HEAD';
  if (!isRead && request.headers.get('Origin') !== url.origin) return fail('Ikke tilladt.', 403);

  if (path === 'session') {
    if (isRead) return handleSessionCheck(request, env);
    if (request.method === 'POST') return handlePin(request, env);
    return fail('Metoden er ikke tilladt.', 405);
  }
  if (path === 'docs') {
    return request.method === 'POST' ? handleCreate(request, env) : fail('Metoden er ikke tilladt.', 405);
  }
  const id = path.match(/^docs\/(.+)$/)?.[1];
  if (!id || !ID_PATTERN.test(id)) return fail('Dokumentet blev ikke fundet.', 404);
  if (isRead) return handleRead(request, env, id);
  if (request.method === 'PUT') return handleUpdate(request, env, id);
  return fail('Metoden er ikke tilladt.', 405);
}

// Returns null for addresses that are not part of Textshare.
export async function handleTextshare(request, env, url) {
  const { pathname } = url;
  if (pathname === '/textshare/') {
    url.pathname = '/textshare';
    return Response.redirect(url.toString(), 301);
  }
  if (pathname.startsWith('/textshare/api/')) {
    return handleApi(request, env, url, pathname.slice('/textshare/api/'.length));
  }

  const isRead = request.method === 'GET' || request.method === 'HEAD';
  if (!isRead) return null;
  if (pathname === '/textshare') return serveAppPage(request, env, url);

  const page = pathname.match(/^\/textshare\/(doc|edit)\/([^/]+)$/);
  if (!page || !ID_PATTERN.test(page[2])) return null;
  return page[1] === 'doc' ? handlePublicPage(env, page[2]) : serveAppPage(request, env, url);
}
