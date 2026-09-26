// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface ChromeMock {
  runtime: {
    id: string | undefined;
    sendMessage: ReturnType<typeof vi.fn>;
    onMessage: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> };
  };
}

let chromeMock: ChromeMock;
let prerendering = false;
const sentTypes = () => chromeMock.runtime.sendMessage.mock.calls.map(([message]) => (message as { type: string }).type);

async function loadBoot(): Promise<void> {
  vi.resetModules();
  await import('../../src/content/boot');
}

beforeEach(() => {
  document.body.innerHTML = '<p>Some article text.</p>';
  prerendering = false;
  Object.defineProperty(document, 'prerendering', { configurable: true, get: () => prerendering });
  chromeMock = {
    runtime: {
      id: 'extension-id',
      sendMessage: vi.fn(async () => ({ ok: true, data: { page: null, highlights: [] } })),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };
  (globalThis as unknown as { chrome: ChromeMock }).chrome = chromeMock;
  delete (globalThis as unknown as { __jah?: unknown }).__jah;
});

afterEach(() => {
  // Orphan every instance created by the test so none of them outlives it.
  chromeMock.runtime.id = undefined;
  document.dispatchEvent(new CustomEvent('jah:takeover'));
});

describe('boot script', () => {
  it('asks the service worker about the page exactly once', async () => {
    await loadBoot();
    await vi.waitFor(() => expect(sentTypes()).toEqual(['page:lookup']));
  });

  it('waits until a prerendered page is activated before looking it up', async () => {
    prerendering = true;
    await loadBoot();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sentTypes()).toEqual([]);

    prerendering = false;
    document.dispatchEvent(new Event('prerenderingchange'));
    await vi.waitFor(() => expect(sentTypes()).toEqual(['page:lookup']));
  });

  it('shuts down the previous instance as soon as a new one is injected', async () => {
    await loadBoot();
    const { removeListener } = chromeMock.runtime.onMessage;
    expect(removeListener).not.toHaveBeenCalled();
    await loadBoot(); // e.g. re-injected into an open tab after an extension update
    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});
