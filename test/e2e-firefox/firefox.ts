import { firefox, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { GECKO_ID } from '../../scripts/manifest';

/** Pinned so tests know the extension's origin (Firefox picks a random one per profile). */
export const FIREFOX_EXTENSION_UUID = '3f0e6f7c-2b9a-4c1d-9e4f-6a8b0c2d4e61';

/**
 * Launches Firefox with dist-firefox/ installed as a temporary add-on. Playwright can only load
 * extensions into Chromium, so the add-on goes in through Firefox's remote debugging protocol,
 * the way `web-ext run` does it. `hosts` resolve to 127.0.0.1.
 */
export async function launchFirefox(hosts: string[]): Promise<{ context: BrowserContext; extension: FirefoxExtension }> {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'jah-firefox-'));
  // Host permissions are optional in Firefox MV3: grant them up front, as the install prompt would.
  await writeFile(
    path.join(profile, 'extension-preferences.json'),
    JSON.stringify({ [GECKO_ID]: { permissions: [], origins: ['http://*/*', 'https://*/*'] } }),
  );
  const port = await freePort();
  const context = await firefox.launchPersistentContext(profile, {
    viewport: { width: 1100, height: 800 },
    args: ['--start-debugger-server', String(port)],
    firefoxUserPrefs: {
      'devtools.debugger.remote-enabled': true,
      'devtools.debugger.prompt-connection': false,
      'network.dns.localDomains': hosts.join(','),
      'extensions.webextensions.uuids': JSON.stringify({ [GECKO_ID]: FIREFOX_EXTENSION_UUID }),
      // The debugger's connection to the background page must not be cut by idle unloading.
      'extensions.background.idle.enabled': false,
    },
  });
  context.on('close', () => void rm(profile, { recursive: true, force: true }));
  const client = await RdpClient.connect(port);
  context.on('close', () => client.close());
  const { addonsActor } = await client.request({ to: 'root', type: 'getRoot' });
  await client.request({ to: addonsActor as string, type: 'installTemporaryAddon', addonPath: path.resolve('dist-firefox') });
  const { addons } = await client.request({ to: 'root', type: 'listAddons' });
  const addon = (addons as Array<{ id: string; actor: string }>).find((candidate) => candidate.id === GECKO_ID)!;
  // The watcher announces every document of the add-on (background page, extension tabs) as it appears.
  const { actor: watcher } = await client.request({ to: addon.actor, type: 'getWatcher' });
  await client.request({ to: watcher as string, type: 'watchTargets', targetType: 'frame' });
  return { context, extension: new FirefoxExtension(client, addon.actor) };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Minimal client for Firefox's remote debugging protocol (packets are `<byte length>:<json>`),
 * enough to install the add-on and evaluate code in its background page.
 */
class RdpClient {
  private buffer = Buffer.alloc(0);
  private readonly pending = new Map<string, Array<(packet: Packet) => void>>();
  private readonly evaluations = new Map<string, (packet: Packet) => void>();
  private greeting?: () => void;
  /** Forms of the targets announced by a watcher. */
  readonly targets: Packet[] = [];

  private constructor(private readonly socket: net.Socket) {
    socket.on('data', (data) => this.receive(data));
  }

  static async connect(port: number): Promise<RdpClient> {
    const client = new RdpClient(await connectWithRetries(port));
    await new Promise<void>((resolve) => (client.greeting = resolve));
    return client;
  }

  request(packet: { to: string; type: string; [key: string]: unknown }): Promise<Packet> {
    return new Promise((resolve, reject) => {
      const queue = this.pending.get(packet.to) ?? [];
      queue.push((reply) => (reply.error ? reject(new Error(`${reply.error}: ${reply.message}`)) : resolve(reply)));
      this.pending.set(packet.to, queue);
      const json = Buffer.from(JSON.stringify(packet));
      this.socket.write(Buffer.concat([Buffer.from(`${json.length}:`), json]));
    });
  }

  /** Evaluates `text` in the console actor's global; a returned promise is awaited. */
  async evaluate(consoleActor: string, text: string): Promise<Packet> {
    const { resultID } = await this.request({ to: consoleActor, type: 'evaluateJSAsync', text, mapped: { await: true } });
    return new Promise((resolve) => this.evaluations.set(resultID as string, resolve));
  }

  forgetTargets(predicate: (form: Packet) => boolean): void {
    for (let index = this.targets.length - 1; index >= 0; index--) {
      if (predicate(this.targets[index])) this.targets.splice(index, 1);
    }
  }

  close(): void {
    this.socket.end();
  }

  private receive(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
    for (;;) {
      const colon = this.buffer.indexOf(':');
      if (colon < 1) return;
      const length = Number(this.buffer.subarray(0, colon).toString());
      if (this.buffer.length < colon + 1 + length) return;
      const packet = JSON.parse(this.buffer.subarray(colon + 1, colon + 1 + length).toString()) as Packet;
      this.buffer = this.buffer.subarray(colon + 1 + length);
      this.dispatch(packet);
    }
  }

  private dispatch(packet: Packet): void {
    if (this.greeting) {
      this.greeting();
      this.greeting = undefined;
    } else if (packet.type === 'target-available-form') {
      this.targets.push(packet.target as Packet);
    } else if (packet.type === 'target-destroyed-form') {
      const { actor } = packet.target as Packet;
      this.forgetTargets((form) => form.actor === actor);
    } else if (packet.type === 'evaluationResult') {
      this.evaluations.get(packet.resultID as string)?.(packet);
      this.evaluations.delete(packet.resultID as string);
    } else if (packet.type === undefined) {
      // Replies carry no type; other typed packets are events nobody here listens to.
      this.pending.get(packet.from as string)?.shift()?.(packet);
    }
  }
}

type Packet = Record<string, unknown> & { from?: string; type?: string; error?: string; message?: string };

async function connectWithRetries(port: number): Promise<net.Socket> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await new Promise<net.Socket>((resolve, reject) => {
        const socket = net.createConnection({ port, host: '127.0.0.1' }, () => resolve(socket));
        socket.once('error', reject);
      });
    } catch (error) {
      if (attempt >= 100) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

/** Code evaluation in the add-on's documents, where `chrome` stands for Firefox's `browser`. */
export class FirefoxExtension {
  /** The background page (restarted on demand after `terminateBackground`). */
  readonly background: ExtensionDocument;

  constructor(
    private readonly client: RdpClient,
    private readonly descriptor: string,
  ) {
    this.background = this.document('/_generated_background_page.html');
  }

  /** The most recent document of the add-on whose URL contains `urlPart`, e.g. an extension tab. */
  document(urlPart: string): ExtensionDocument {
    return {
      evaluate: async <R, A>(fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R> => {
        const target = await this.waitForTarget(urlPart);
        return this.evaluateIn(target.consoleActor as string, fn, arg);
      },
    };
  }

  /** Unloads the event page, as Firefox does after a while without events. */
  async terminateBackground(): Promise<void> {
    await this.client.request({ to: this.descriptor, type: 'terminateBackgroundScript' });
    // Evaluations from now on wait for the page Firefox starts on the next event.
    this.client.forgetTargets((form) => String(form.url).includes('/_generated_background_page.html'));
  }

  private async waitForTarget(urlPart: string): Promise<Packet> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const target = this.client.targets.findLast((form) => String(form.url).includes(urlPart));
      if (target) return target;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`No extension document at ${urlPart}`);
  }

  private async evaluateIn<R, A>(consoleActor: string, fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R> {
    const text = `(async () => {
      const chrome = browser;
      const result = await (${fn.toString()})(${JSON.stringify(arg) ?? 'undefined'});
      return JSON.stringify(result === undefined ? null : result);
    })()`;
    const reply = await this.client.evaluate(consoleActor, text);
    if (reply.exception !== undefined && reply.exception !== null) {
      throw new Error(String(reply.exceptionMessage ?? 'Evaluation failed'));
    }
    let result = reply.result as string | { type: string; actor: string; length: number };
    if (typeof result === 'object' && result?.type === 'longString') {
      const { substring } = await this.client.request({ to: result.actor, type: 'substring', start: 0, end: result.length });
      result = substring as string;
    }
    return JSON.parse(result as string) as R;
  }
}

/** Same shape as Playwright's `Worker.evaluate`, so the Chromium helpers accept it. */
export interface ExtensionDocument {
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R>;
}
