import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** Hostnames the browser maps to 127.0.0.1 (see fixtures.ts). */
export const HOSTS = { hw: 'www.hwupgrade.it', mp: 'multiplayer.it', plain: 'plain.example' } as const;

export type ArticleVariant = 'original' | 'shifted' | 'removed' | 'hidden' | 'late';

export interface FixtureSite {
  port: number;
  url(host: string, path: string): string;
  variant: ArticleVariant;
  close(): Promise<void>;
}

export const HW_PATH = '/news/cpu/nuove-cpu-desktop_123.html';
export const HW_HOME_PATH = '/';
export const MP_PATH = '/notizie/gioco-di-ruolo-open-world.html';
export const PLAIN_PATH = '/index.html';

export const HW_PARAGRAPHS = [
  'La nuova generazione di processori desktop arriva sul mercato con promesse ambiziose: più core, frequenze più alte e consumi sotto controllo.',
  'Nei test sintetici il risultato viene memorizzato nella cache dopo la prima esecuzione, quindi le esecuzioni successive terminano quasi istantaneamente.',
  'Abbiamo misurato i consumi con un wattmetro alla presa: sotto carico il sistema completo resta sotto i 250 watt, un valore migliore della generazione precedente.',
  'Nei giochi la differenza è meno evidente, perché la scheda video rimane il vero collo di bottiglia alle risoluzioni più alte.',
  'Il prezzo di listino parte da 329 euro per il modello a otto core, mentre la versione di punta costa quasi il doppio.',
  'In conclusione, il risultato viene memorizzato nella cache in modo aggressivo su tutte le piattaforme che abbiamo provato.',
];

export const MP_PARAGRAPHS = [
  'Il nuovo gioco di ruolo open world è stato finalmente datato: arriverà a novembre su PC e console di ultima generazione.',
  'La mappa promette di essere tre volte più grande di quella del capitolo precedente, con città dinamiche e un ciclo giorno notte completo.',
  'Gli sviluppatori hanno confermato che il combattimento in tempo reale sarà affiancato da una modalità tattica con pausa attiva.',
];

function layout(title: string, canonical: string | null, body: string): string {
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  ${canonical ? `<link rel="canonical" href="${canonical}">` : ''}
  <style>
    body { font: 17px/1.6 Georgia, serif; margin: 0; color: #222; background: #fff; }
    header, footer { background: #0b3d91; color: #fff; padding: 12px 24px; font-family: system-ui, sans-serif; }
    header a { color: #fff; margin-right: 16px; text-decoration: none; }
    .layout { display: grid; grid-template-columns: minmax(0, 680px) 240px; gap: 32px; padding: 24px; }
    aside { font: 14px/1.5 system-ui, sans-serif; color: #555; }
    .ad { background: #f3f3f3; padding: 12px; font: 13px system-ui; color: #777; }
  </style>
</head>
<body>
  <header><a href="/">Home</a><a href="/news/">Notizie</a><a href="/recensioni/">Recensioni</a></header>
  ${body}
  <footer>Contenuti di esempio per i test end-to-end.</footer>
</body>
</html>`;
}

function hwArticle(site: FixtureSite): string {
  const canonical = site.url(HOSTS.hw, HW_PATH);
  let paragraphs = [...HW_PARAGRAPHS];
  if (site.variant === 'removed') paragraphs = paragraphs.filter((_, index) => index !== 2);
  const body = paragraphs.map((text, index) =>
    // The "hidden" variant keeps the rest of the article collapsed until a script reveals it.
    site.variant === 'hidden' && index === 2 ? `<section id="more" hidden><p>${text}</p></section>` : `<p>${text}</p>`,
  );
  let article = `<article><h1>Nuove CPU desktop: prestazioni, consumi e prezzi a confronto</h1>${body.join('')}</article>`;
  if (site.variant === 'late') {
    // A ticking clock keeps mutating the page; the rest of the article arrives after 11 seconds.
    const rest = JSON.stringify(paragraphs.slice(2));
    article =
      `<div id="clock">0</div><article><h1>Nuove CPU desktop</h1>${body.slice(0, 2).join('')}<div id="rest"></div></article>` +
      `<script>let n = 0; setInterval(() => { document.getElementById('clock').textContent = String(++n); }, 200);` +
      `setTimeout(() => { for (const text of ${rest}) { const p = document.createElement('p'); p.textContent = text; ` +
      `document.getElementById('rest').append(p); } }, 11000);</script>`;
  }
  if (site.variant === 'hidden') {
    article += `<script>setTimeout(() => document.getElementById('more').removeAttribute('hidden'), 800);</script>`;
  }
  if (site.variant === 'shifted') {
    // More text before the highlights and a different DOM structure around them.
    article =
      '<div class="ad">Pubblicità: le migliori offerte della settimana su SSD e memorie.</div>' +
      '<p><strong>Aggiornamento:</strong> abbiamo ripetuto tutti i test con il nuovo BIOS e un dissipatore diverso.</p>' +
      `<div class="wrapper"><div class="inner">${article}</div></div>`;
  }
  const aside = '<aside><h3>Articoli correlati</h3><ul><li>Le migliori schede video</li><li>Guida agli SSD</li></ul></aside>';
  return layout('Nuove CPU desktop | Hardware Upgrade', canonical, `<div class="layout"><main>${article}</main>${aside}</div>`);
}

/** Homepage that prerenders the article (speculation rules) and links to it. */
function hwHome(site: FixtureSite): string {
  const article = site.url(HOSTS.hw, HW_PATH);
  const rules = JSON.stringify({ prerender: [{ source: 'list', urls: [article] }] });
  return layout(
    'Hardware Upgrade',
    null,
    `<div class="layout"><main><p><a id="to-article" href="${article}">Nuove CPU desktop</a></p></main></div>` +
      `<script type="speculationrules">${rules}</script>`,
  );
}

function mpArticle(site: FixtureSite): string {
  const canonical = site.url(HOSTS.mp, MP_PATH);
  const article = `<article><h1>Un nuovo gioco di ruolo open world arriva a novembre</h1>${MP_PARAGRAPHS.map(
    (text) => `<p>${text}</p>`,
  ).join('')}</article>`;
  return layout('Gioco di ruolo open world a novembre - Multiplayer.it', canonical, `<div class="layout"><main>${article}</main></div>`);
}

function plainPage(): string {
  return layout(
    'Pagina senza evidenziazioni',
    null,
    '<div class="layout"><main><p>Questa pagina non ha evidenziazioni salvate: l’estensione non deve fare nulla qui.</p></main></div>',
  );
}

export async function startSite(): Promise<FixtureSite> {
  const site: FixtureSite = {
    port: 0,
    variant: 'original',
    url: (host, path) => `http://${host}:${site.port}${path}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
  const server = http.createServer((request, response) => {
    const host = (request.headers.host ?? '').split(':')[0];
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    let html: string | null = null;
    if (host === HOSTS.hw && path === HW_PATH) html = hwArticle(site);
    else if (host === HOSTS.hw && path === HW_HOME_PATH) html = hwHome(site);
    else if (host === HOSTS.mp && path === MP_PATH) html = mpArticle(site);
    else if (host === HOSTS.plain) html = plainPage();
    if (!html) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  site.port = (server.address() as AddressInfo).port;
  return site;
}
