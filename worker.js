// Serves the static files in dist/ and sends www and plain http to
// https://bramlabs.io.
export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === 'www.bramlabs.io' || url.protocol === 'http:') {
      url.hostname = 'bramlabs.io';
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
