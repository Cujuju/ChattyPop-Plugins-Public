// Codex's cost note (measured, #46): every call carries Codex's own instructions, which app-server can't turn off.

/** Appended to Codex's availability line once it lists models; `requests` names ChattyPop's AI calls. */
export const overheadNote = (requests: string): string =>
  `. Each call also carries about 12k tokens of Codex’s own instructions, so short ${requests} cost more here than with Claude`;
