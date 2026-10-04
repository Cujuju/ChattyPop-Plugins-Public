// Translation (#325): other plugins' text of a message's parts and embeds' own text, translated automatically per kind
// or on request, kept in step with its source, as derived text and a note of its part.
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { defineCorePlugin } from '@plugin-sdk/core';
import { definePlugin, MS_PER_DAY } from '@plugin-sdk/shared';
import { testPlugin } from '@plugin-sdk/core/testing';
import type { CompletionRequest, LlmProvider } from '@core/ai/types';
import { partNotes } from '@core/attachmentNotes';
import translationCore from '../core';
import { JOBS_TABLE } from '../core/store';
import { DEFAULT_TRANSLATION_SETTINGS, type TranslationSettings } from '../shared/types';

/** Long enough for a queue pass that would run to have run: the queue starts on setImmediate. */
const SETTLE_MS = 50;
const IMAGE = 'attachment:a1';
const AUDIO = 'attachment:a2';
const EMBED_TEXT = 'embed-text:0';

/** A source plugin as Image text and Transcription are: it settles a derived text naming a part. */
const probe = definePlugin({ manifest: { id: 'probe', name: 'Probe', version: '1', description: '' } });
let say: (messageId: string, part: string, text: string) => void = () => {
  throw new Error('probe not started');
};
const probeCore = defineCorePlugin(probe, (ctx) => {
  say = (messageId, part, text) =>
    ctx.archive.derivedText.settle(messageId, { key: `${messageId}:${part}`, order: 1, text, queuedAt: Date.now(), part, askJev: false });
});

/** A text model: ASCII text is English, kept as it is; anything else becomes EN(<text>). `gate`: awaited before answering. */
function model(gate?: () => Promise<void>) {
  const sent: CompletionRequest[] = [];
  const provider: LlmProvider = {
    id: 'tx',
    maxInputChars: 10_000,
    complete: async (req) => {
      sent.push(req);
      await gate?.();
      const text = req.prompt.slice(req.prompt.indexOf('Text:\n') + 'Text:\n'.length);
      const answer = /^[\x20-\x7e\n]*$/.test(text) ? { language: 'English', translation: text } : { language: 'Japanese', translation: `EN(${text})` };
      return { text: JSON.stringify(answer), json: answer };
    },
    listModels: async () => [{ id: 'm', label: 'm' }],
  };
  return { sent, provider };
}

function start(settings: Partial<TranslationSettings> = {}, opts: { profile?: Record<string, unknown>; gate?: () => Promise<void> } = {}) {
  const m = model(opts.gate);
  const t = testPlugin(translationCore, {
    with: [probeCore],
    archive: { channels: [{ id: 'c1' }] },
    ai: { providers: [{ id: 'tx', local: true, provider: m.provider }] },
    ...(opts.profile ? { profile: { settings: opts.profile } } : { preferences: { settings: { ...DEFAULT_TRANSLATION_SETTINGS, translateProvider: 'tx', translateModel: 'm', ...settings } } }),
  });
  onTestFinished(() => t.dispose());
  return { t, sent: m.sent };
}

type T = ReturnType<typeof start>['t'];

/** A message showing an image, a voice message and a link preview with its own text. */
const arrive = (t: T, ts?: number): string =>
  t.archive.arrive([
    {
      channelId: 'c1',
      content: 'look',
      ts,
      extra: {
        attachments: [
          { id: 'a1', filename: 'chart.png', content_type: 'image/png', size: 1, url: 'https://cdn.discordapp.com/a1/chart.png', proxy_url: 'https://media.discordapp.net/a1/chart.png' },
          { id: 'a2', filename: 'voice.ogg', content_type: 'audio/ogg', size: 1, url: 'https://cdn.discordapp.com/a2/voice.ogg', proxy_url: 'https://media.discordapp.net/a2/voice.ogg' },
        ],
        embeds: [{ type: 'rich', title: 'こんにちは', description: '世界' }],
      },
    },
  ])[0]!;

/** Translation's derived texts of the message, by part. */
const translations = (t: T, id: string) =>
  Object.fromEntries((t.db.prepare(`SELECT part, text FROM derived_texts WHERE message_id = ? AND source LIKE 'translation:%'`).all(id) as { part: string; text: string }[]).map((r) => [r.part, r.text]));

const settle = () => new Promise((r) => setTimeout(r, SETTLE_MS));

describe('the Translation plugin', () => {
  it('translates image text automatically when that kind is on, as derived text and a note of its part', async () => {
    const { t } = start({ translate: true });
    const id = arrive(t);
    say(id, IMAGE, '株価');
    say(id, AUDIO, 'もしもし');
    await vi.waitFor(() => expect(translations(t, id)).toEqual({ [IMAGE]: 'EN(株価)' }));
    expect(partNotes([{ id, attachmentIds: ['a1', 'a2'] }]).get(id)?.get(IMAGE)).toEqual([
      { pluginId: 'translation', part: IMAGE, kind: 'translation', state: 'done', label: 'translation', text: 'EN(株価)' },
    ]);
  });

  it('each kind is its own setting: transcripts and embed text', async () => {
    const { t } = start({ translateTranscripts: true, translateEmbedText: true });
    const id = arrive(t);
    say(id, IMAGE, '株価');
    say(id, AUDIO, 'もしもし');
    await vi.waitFor(() => expect(translations(t, id)).toEqual({ [AUDIO]: 'EN(もしもし)', [EMBED_TEXT]: 'EN(こんにちは\n世界)' }));
  });

  it('translates nothing by itself while every kind is off', async () => {
    const { t, sent } = start();
    const id = arrive(t);
    say(id, IMAGE, '株価');
    await settle();
    expect(sent).toEqual([]);
    expect(translations(t, id)).toEqual({});
  });

  it('Translate translates every part with text, however old, with the picked model', async () => {
    const { t, sent } = start();
    const id = arrive(t, Date.now() - 2 * MS_PER_DAY);
    say(id, IMAGE, '株価');
    await t.client('renderer').translate(id, { provider: 'tx', model: 'other' });
    await vi.waitFor(() => expect(translations(t, id)).toEqual({ [IMAGE]: 'EN(株価)', [EMBED_TEXT]: 'EN(こんにちは\n世界)' }));
    expect(new Set(sent.map((s) => s.model))).toEqual(new Set(['other']));  });

  it('refuses a pick that is no model, or a message with nothing to translate', async () => {
    const { t } = start();
    const [plain] = t.archive.arrive([{ channelId: 'c1', content: 'hi' }]);
    await expect(t.client('renderer').translate(plain!, { provider: 'tx' } as never)).rejects.toThrow();
    await expect(t.client('renderer').translate(plain!, null)).rejects.toThrow('no image text');
  });

  it('a changed source is translated again; a gone one clears its translation', async () => {
    const { t } = start({ translate: true });
    const id = arrive(t);
    say(id, IMAGE, '株価');
    await vi.waitFor(() => expect(translations(t, id)).toEqual({ [IMAGE]: 'EN(株価)' }));
    say(id, IMAGE, '為替');
    await vi.waitFor(() => expect(translations(t, id)).toEqual({ [IMAGE]: 'EN(為替)' }));
    say(id, IMAGE, '');
    await vi.waitFor(() => expect(translations(t, id)).toEqual({ [IMAGE]: '' }));
    expect(t.db.prepare(`SELECT COUNT(*) FROM ${JOBS_TABLE}`).pluck().get()).toBe(0);
  });

  it('never publishes the translation of a source that changed while it ran', async () => {
    const answers: (() => void)[] = [];
    const { t, sent } = start({ translate: true }, { gate: () => new Promise<void>((r) => answers.push(r)) });
    const id = arrive(t);
    say(id, IMAGE, '株価');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    say(id, IMAGE, '為替');
    answers.shift()!();
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(translations(t, id)).toEqual({});
    answers.shift()!();
    await vi.waitFor(() => expect(translations(t, id)).toEqual({ [IMAGE]: 'EN(為替)' }));
  });

  it('a changed target language translates its sources again', async () => {
    const { t, sent } = start({ translate: true });
    const id = arrive(t);
    say(id, IMAGE, 'hello');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await settle();
    t.preferences.set('settings', { ...t.preferences.get('settings'), translateLanguage: 'Spanish' });
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]!.prompt).toContain('Spanish');
  });

  it('never translates its own translations, and keeps text already in the language as it is', async () => {
    const { t, sent } = start({ translate: true, translateTranscripts: true });
    const id = arrive(t);
    say(id, IMAGE, '株価');
    say(id, AUDIO, 'hello there');
    await vi.waitFor(() => expect(translations(t, id)).toEqual({ [IMAGE]: 'EN(株価)' }));
    await settle();
    expect(sent.map((s) => s.prompt.slice(s.prompt.indexOf('Text:\n') + 'Text:\n'.length)).sort()).toEqual(['hello there', '株価']);
    expect(partNotes([{ id, attachmentIds: ['a1', 'a2'] }]).get(id)?.has(AUDIO)).toBe(false);
  });

  it('takes Image text’s translation settings, its automatic switch becoming image text’s', async () => {
    const imageText = { engine: 'windows', translate: true, translateLanguage: 'German', translateProvider: 'tx', translateModel: 'm', translateMenu: { tx: false } };
    const { t } = start({}, { profile: { 'plugin.imagetext.settings': imageText } });
    expect(t.preferences.get('settings')).toMatchObject({ translate: true, translateTranscripts: false, translateLanguage: 'German', translateProvider: 'tx', translateModel: 'm', translateMenu: { tx: false } });
  });
});
