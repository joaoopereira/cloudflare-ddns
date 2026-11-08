// Service worker for the installable dashboard. It caches the app shell only
// (the page and its hashed /assets/ files) so the app opens quickly and
// Android offers "Install app". It never touches API, download, installer,
// health or Cloudflare Access (/cdn-cgi/) requests, so client status, IPs and
// timestamps always come live from the Worker.
const CACHE = "ddns-shell-v1";
const SHELL = "/";
const PASSTHROUGH = /^\/(api|download|cdn-cgi)\/|^\/(install\.sh|install\.ps1|health)$/;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || PASSTHROUGH.test(url.pathname)) return;

  if (req.mode === "navigate") {
    // Network first, so a new release shows up right away and an expired
    // Access session redirects to the login page. The cached shell is only
    // used when the network is unreachable.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && res.type === "basic") event.waitUntil(saveShell(res.clone()));
          return res;
        })
        .catch(async () => (await caches.match(SHELL)) ?? Response.error()),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    // Hashed file names never change content: cache first.
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok && res.type === "basic") {
              const copy = res.clone();
              event.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
            }
            return res;
          }),
      ),
    );
  }
});

/** Store the page and drop cached assets the new page no longer uses. */
async function saveShell(res) {
  const cache = await caches.open(CACHE);
  const html = await res.clone().text();
  await cache.put(SHELL, res);
  const used = new Set(html.match(/\/assets\/[^"'\s)]+/g) ?? []);
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (path.startsWith("/assets/") && !used.has(path)) await cache.delete(req);
  }
}
