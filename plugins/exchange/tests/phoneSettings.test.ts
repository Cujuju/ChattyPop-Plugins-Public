import { afterEach, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ importDce: vi.fn(), exportChannels: vi.fn() }));
vi.mock('../renderer/state', () => calls);
vi.mock('@plugin-sdk/renderer/kit', () => ({
  inCompanion: true,
  Note: (props: { children: unknown }) => props.children,
}));

interface Element {
  type: string | ((props: Record<string, unknown>) => unknown);
  props: Record<string, unknown>;
}

function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  const element = node as Element;
  return text(typeof element.type === 'function' ? element.type(element.props) : element.props.children);
}

afterEach(() => vi.unstubAllGlobals());

it('shows a PC note on the phone without constructing desktop import/export controls', async () => {
  vi.stubGlobal('React', { createElement: (type: Element['type'], props: Element['props'] | null, ...children: unknown[]) => ({ type, props: { ...props, children } }) });
  const path = '../renderer/ExchangeControls.tsx';
  const { ExchangeControls } = await import(path);
  expect(text(ExchangeControls())).toBe('Import and export archives on the PC.');
  expect(calls.importDce).not.toHaveBeenCalled();
  expect(calls.exportChannels).not.toHaveBeenCalled();
});
