/* global self, URL, fetch, Response */
// Network-only: never persist accounts, conversations, media, or API responses.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if (
    event.request.mode !== 'navigate' ||
    url.origin !== scope.origin ||
    ![scope.pathname, `${scope.pathname}index.html`].includes(url.pathname)
  )
    return;
  event.respondWith(
    fetch(event.request, { cache: 'no-store' }).catch(
      () =>
        new Response(
          `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
          <meta name="theme-color" content="#ffffff"><title>AgentDeck · 网络不可用</title>
          <style>:root{font:16px/1.7 system-ui;color:#171717;background:#fff}
          body{margin:0;min-height:100dvh;display:grid;place-items:center}
          main{padding:32px;max-width:28em}h1{font-size:24px}p{color:#676767}
          a{display:inline-block;padding:10px 18px;color:#fff;background:#171717;border-radius:10px;text-decoration:none}
          @media(prefers-color-scheme:dark){:root{color:#ececec;background:#212121}p{color:#b4b4b4}}</style>
          </head><body><main><strong>AgentDeck</strong><h1>网络暂时不可用</h1>
          <p>连接网络后重新打开。会话保存在电脑上，离线时无法读取或发送消息。</p>
          <a href="./">重新连接</a></main></body></html>`,
          {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
          },
        ),
    ),
  );
});
