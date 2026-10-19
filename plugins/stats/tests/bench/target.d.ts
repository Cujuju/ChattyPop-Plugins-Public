declare module 'stats-bench-target' {
  export const plugin: typeof import('../../shared').plugin;
  const core: typeof import('../../core').default;
  export default core;
}
