// Tests address migration, ctx.net.fetch routing, and preservation of provider settings while Ollama is absent.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeAiSettings } from '@shared/settings';
import { getSetting, setSetting } from '@core/db';
import { parkOllamaSettings } from '@core/laterMigrations';
import { adoptBundledData } from '@core/plugins/adoption';
import { tempDb } from '@chattypop/host-testing';
import { startProviders } from '@chattypop/host-testing/providerHost';
import ollamaCore from '../core';
import { plugin as ollama } from '../shared';

const LAN_ADDRESS = 'http://10.0.0.5:11434';
/** Settings → AI as saved before Ollama was a plugin. */
const PRE_EXTRACTION = { defaultProvider: 'ollama', ollamaUrl: LAN_ADDRESS, providers: { ollama: { enabled: true, model: 'llama3', effort: 'on', displayName: null } } };

afterEach(() => vi.unstubAllGlobals());

describe('Ollama address on upgrade', () => {
  it('parks the address out of the AI settings, survives an absent-plugin save, and is adopted once', () => {
    const db = tempDb();
    setSetting(db, 'ai', PRE_EXTRACTION);
    parkOllamaSettings(db);
    // A build without Ollama saves Settings → AI: the address is not part of it any more.
    setSetting(db, 'ai', normalizeAiSettings(getSetting(db, 'ai')));
    parkOllamaSettings(db);
    expect(getSetting(db, 'legacy.ollamaSettings')).toEqual({ ollamaUrl: LAN_ADDRESS });
    expect(getSetting(db, 'ai')).not.toHaveProperty('ollamaUrl');
    adoptBundledData(db, [ollama]);
    adoptBundledData(db, [ollama]);
    expect(getSetting(db, 'plugin.ollama.settings')).toEqual({ ollamaUrl: LAN_ADDRESS });
    expect(normalizeAiSettings(getSetting(db, 'ai')).providers['ollama']).toEqual(PRE_EXTRACTION.providers.ollama);
  });

  it('lists models from the adopted address through the plugin, and reports an unreachable server as a state', async () => {
    const db = tempDb();
    setSetting(db, 'ai', PRE_EXTRACTION);
    parkOllamaSettings(db);
    adoptBundledData(db, [ollama]);
    const sent = vi.fn(async (u: URL) =>
      u.href === `${LAN_ADDRESS}/api/tags` ? Response.json({ models: [{ name: 'llama3' }] }) : new Response(null, { status: 404 }),
    );
    vi.stubGlobal('fetch', sent);
    const { host, registry, ai } = startProviders([ollamaCore], [ollama], db);
    const [status] = await registry.status(ai());
    expect(status).toMatchObject({ id: 'ollama', available: true, detail: '1 model(s) installed' });
    expect(status?.models?.map((m) => m.id)).toEqual(['llama3']);
    expect(registry.isLocal('ollama')).toBe(true);

    setSetting(db, 'plugin.ollama.settings', { ollamaUrl: 'http://127.0.0.1:1' });
    const [down] = await registry.status(ai());
    expect(down).toMatchObject({ id: 'ollama', available: false, models: null });
    expect(down?.detail).toMatch(/^Ollama not reachable at http:\/\/127\.0\.0\.1:1/);
    expect(host.list().find((p) => p.id === 'ollama')?.status).not.toBe('error');
  });
});
