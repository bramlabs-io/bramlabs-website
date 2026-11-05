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
    // Keep earlier workshop links working at the IDI address.
    if (['/opgave', '/opgave/', '/opgave.html', '/idi/opgave/', '/idi/opgave.html'].includes(url.pathname)) {
      url.pathname = '/idi/opgave';
      return Response.redirect(url.toString(), 301);
    }
    // Serve the existing HTML asset without changing the public address.
    if (['/spil', '/spil/', '/spil.html', '/idi/spil/', '/idi/spil.html'].includes(url.pathname)) {
      url.pathname = '/idi/spil';
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === '/idi/spil') {
      url.pathname = '/spil';
      return env.ASSETS.fetch(new Request(url.toString(), request));
    }
    if (url.pathname === '/idi/opgave') {
      url.pathname = '/opgave';
      return env.ASSETS.fetch(new Request(url.toString(), request));
    }
    return env.ASSETS.fetch(request);
  },
};
