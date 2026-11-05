# bramlabs-website

Static site for BramLabs (bramlabs.io). Plain HTML and CSS, no build step.

- `index.html`, `model.html`, `philosophy.html`, `about.html`, `brand.html`, `contact.html`
- `css/styles.css` holds the design tokens. Warm off-white page, white boxes, black type and a warm yellow accent (palette modelled on akonlabs.com).
- `js/site.js` handles the mobile menu and the email link.

## Develop

```
npm install
npm run dev
```

Starts a Vite dev server with live reload and opens the site in the browser. There is no build step; the HTML, CSS and JS in this folder are what gets deployed.

## Textshare

`/textshare` lets students publish plain text at `/textshare/doc/<id>`. The Worker code is in `worker/textshare.js`, the page in `textshare.html` and `js/textshare.js`. Documents are stored in the D1 database `bramlabs-textshare`, and the PIN is the Worker secret `TEXTSHARE_PIN` (change it with `npx wrangler secret put TEXTSHARE_PIN`). The repo is public, so keep the PIN out of it.

Vite does not run the Worker. To test Textshare locally, put `TEXTSHARE_PIN=<pin>` in `.dev.vars` (gitignored) and run:

```
npx wrangler d1 migrations apply bramlabs-textshare --local
npx wrangler dev --local-protocol https
```

Remove a document in production:

```
npx wrangler d1 execute bramlabs-textshare --remote --command "DELETE FROM documents WHERE id = '<id>'"
```
