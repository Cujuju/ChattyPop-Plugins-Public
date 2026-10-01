// OpenRouter keys: Jev and the OpenRouter plugin each paying with theirs. The host's key routing is tested in the app.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AI_SETTINGS } from '@shared/settings';
import { JEV_OPENROUTER_MODEL, type OpenRouterKeyEntry } from '@shared/openrouter';
import { startProviders } from '@chattypop/host-testing/providerHost';
import openRouterCore from '../core';

const key = (id: string, models: string[], anyModel = false): OpenRouterKeyEntry => ({ id, label: id, key: `sk-${id}`, hint: '…', models, anyModel });
const jevKey = key('jev', [JEV_OPENROUTER_MODEL]);
const sonnet = key('sonnet', ['anthropic/claude-sonnet-5']);
const any = key('any', [], true);

describe('requests are billed to the routed key, and a capped key stops without fallback', () => {
  afterEach(() => vi.unstubAllGlobals());
  const settings = {
    ...DEFAULT_AI_SETTINGS,
    jev: { ...DEFAULT_AI_SETTINGS.jev, 'summaries.citationCheck': true },
    providers: { ...DEFAULT_AI_SETTINGS.providers, openrouter: { enabled: true, model: 'anthropic/claude-sonnet-5', effort: null, displayName: null } },
  };

  function stubFetch(status: number, json: unknown) {
    const auths: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { headers: Record<string, string> }) => {
      auths.push(init.headers['authorization']!);
      return { ok: status < 400, status, headers: new Headers(), json: async () => json };
    });
    return auths;
  }

  /** The registry with the OpenRouter plugin on and the three keys stored. */
  const withKeys = () => {
    const { registry } = startProviders([openRouterCore]);
    registry.setOpenRouterKeys([jevKey, sonnet, any]);
    return registry;
  };

  it('Jev and a chat model each use their own key; key infos carry no secrets', async () => {
    const reg = withKeys();
    expect(reg.jevStatus(settings).keyLabel).toBe('jev');
    expect(reg.keyInfos().every((i) => !('key' in i))).toBe(true);
    const auths = stubFetch(200, { answers: {}, choices: [{ message: { content: '{}' } }] });
    await reg.decider(settings, 'summaries.citationCheck')!.decide({ state: 'x', questions: { a: { type: 'noul', instructions: 'q' } } });
    await reg.get('openrouter', settings).complete({ system: 's', prompt: 'p' });
    expect(auths).toEqual(['Bearer sk-jev', 'Bearer sk-sonnet']);
  });

  it("sends a request's own model, paid by the key that lists it (a command's pick), and refuses one no key pays for", async () => {
    const sent: { auth: string; model: string }[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { headers: Record<string, string>; body: string }) => {
      sent.push({ auth: new Headers(init.headers).get('authorization')!, model: (JSON.parse(init.body) as { model: string }).model });
      return Response.json({ choices: [{ message: { content: 'ok' } }] });
    });
    const reg = withKeys();
    await reg.get('openrouter', settings).complete({ system: 's', prompt: 'p', model: 'openai/gpt-5' });
    await reg.get('openrouter', settings).complete({ system: 's', prompt: 'p' });
    expect(sent).toEqual([{ auth: 'Bearer sk-any', model: 'openai/gpt-5' }, { auth: 'Bearer sk-sonnet', model: 'anthropic/claude-sonnet-5' }]);
    reg.setOpenRouterKeys([jevKey, sonnet]);
    await expect(reg.get('openrouter', settings).complete({ system: 's', prompt: 'p', model: 'openai/gpt-5' })).rejects.toThrow('No OpenRouter key pays for openai/gpt-5');
  });

  it('names the key that hit its cap and tries no other', async () => {
    const reg = withKeys();
    const auths = stubFetch(402, { error: { message: 'limit', metadata: { limit_source: 'openrouter_key_limit' } } });
    await expect(reg.get('openrouter', settings).complete({ system: 's', prompt: 'p' })).rejects.toThrow(/Key "sonnet" reached its OpenRouter spending limit/);
    expect(auths).toEqual(['Bearer sk-sonnet']);
  });

  it('reports in Settings → AI which key pays for the chosen model, and an unreachable model list as a state', async () => {
    const { registry, host } = startProviders([openRouterCore]);
    vi.stubGlobal('fetch', async () => Response.json({ data: [{ id: 'anthropic/claude-sonnet-5', name: 'Sonnet', supported_parameters: ['structured_outputs'] }] }));
    expect((await registry.status(settings))[0]).toMatchObject({ available: false, detail: 'Add an OpenRouter key to use OpenRouter' });
    registry.setOpenRouterKeys([jevKey, sonnet]);
    const [status] = await registry.status(settings);
    expect(status).toMatchObject({ id: 'openrouter', available: true, detail: 'Paid by key sonnet' });
    expect(status?.models?.map((m) => m.id)).toEqual(['openrouter/auto', 'anthropic/claude-sonnet-5']);
    vi.stubGlobal('fetch', async () => new Response(null, { status: 503 }));
    expect((await registry.status(settings, true))[0]).toEqual({ id: 'openrouter', available: false, detail: 'OpenRouter models: HTTP 503', models: null });
    expect(host.list().find((p) => p.id === 'openrouter')?.status).not.toBe('error');
  });
});
