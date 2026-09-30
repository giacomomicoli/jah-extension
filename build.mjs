// Bundles the extension into dist/ (load that folder as an unpacked extension).
//   node build.mjs                    production build (minified)
//   node build.mjs --dev              development build (readable, inline source maps)
//   node build.mjs --watch            development build, rebuilt on change
//   node build.mjs --browser=firefox  Firefox build, into dist-firefox/ (combines with the above)
// JAH_OUTDIR=/mnt/c/… writes the build elsewhere, e.g. to a Windows folder when working in WSL.
import * as esbuild from 'esbuild';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { watch as watchFs } from 'node:fs';
import path from 'node:path';
import { manifestFor } from './scripts/manifest.ts';

const watch = process.argv.includes('--watch');
const dev = watch || process.argv.includes('--dev');
const browser = process.argv.find((arg) => arg.startsWith('--browser='))?.slice('--browser='.length) ?? 'chrome';
if (browser !== 'chrome' && browser !== 'firefox') {
  console.error(`Unknown browser: ${browser}`);
  process.exit(1);
}
const outdir = process.env.JAH_OUTDIR || (browser === 'chrome' ? 'dist' : `dist-${browser}`);

/** The output folder is wiped before building: refuse unless it is empty or a previous build. */
async function assertSafeOutdir() {
  const entries = await readdir(outdir).catch(() => []);
  if (!entries.length) return;
  const manifest = await readFile(path.join(outdir, 'manifest.json'), 'utf8').catch(() => '');
  if (!manifest.includes('"Just Another Highlighter"')) {
    console.error(`Refusing to wipe ${outdir}: it is not empty and does not contain a previous build.`);
    process.exit(1);
  }
}

const common = {
  bundle: true,
  target: ['chrome123', 'firefox140'],
  define: { __BROWSER__: JSON.stringify(browser) },
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
  outdir,
};

const configs = [
  // Service worker (an event page in Firefox): declared as an ES module in the manifest.
  { ...common, format: 'esm', entryPoints: { background: 'src/background/index.ts' } },
  // Content scripts are classic scripts, so each one is a self-contained IIFE.
  // content-boot runs on every page and must stay tiny; content-main is injected lazily.
  { ...common, format: 'iife', entryPoints: { 'content-boot': 'src/content/boot.ts' } },
  { ...common, format: 'iife', entryPoints: { 'content-main': 'src/content/main.ts' } },
  { ...common, format: 'esm', entryPoints: { sidepanel: 'src/sidepanel/index.ts' } },
];

async function copyStatic() {
  await cp('static', outdir, { recursive: true });
  if (browser === 'chrome') return; // static/manifest.json is the Chrome manifest
  const manifest = JSON.parse(await readFile('static/manifest.json', 'utf8'));
  await writeFile(path.join(outdir, 'manifest.json'), `${JSON.stringify(manifestFor(browser, manifest), null, 2)}\n`);
}

await assertSafeOutdir();
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await copyStatic();

if (watch) {
  for (const config of configs) {
    const ctx = await esbuild.context(config);
    await ctx.watch();
  }
  watchFs('static', { recursive: true }, () => {
    copyStatic().then(
      () => console.log('[static] copied'),
      (error) => console.error('[static] copy failed', error),
    );
  });
  console.log('Watching for changes…');
} else {
  await Promise.all(configs.map((config) => esbuild.build(config)));
}
