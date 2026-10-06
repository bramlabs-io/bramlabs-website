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
