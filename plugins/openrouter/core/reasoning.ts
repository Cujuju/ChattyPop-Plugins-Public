export interface ReasoningDetail {
  type: string;
  index?: number;
  [field: string]: unknown;
}

const DELTA_FIELDS = new Set(['text', 'summary', 'data', 'signature']);

/** Joins native deltas without reordering blocks or dropping signed metadata. */
export function mergeReasoning(details: ReasoningDetail[], fragment: ReasoningDetail): void {
  const detail = details.find((item) => item.type === fragment.type && (
    fragment.index !== undefined ? item.index === fragment.index : typeof fragment.id === 'string' && item.id === fragment.id
  ));
  if (!detail) {
    details.push({ ...fragment });
    return;
  }
  for (const [field, value] of Object.entries(fragment)) {
    if (DELTA_FIELDS.has(field) && typeof value === 'string') {
      detail[field] = (typeof detail[field] === 'string' ? detail[field] : '') + value;
    } else if (value !== null || detail[field] === undefined) {
      detail[field] = value;
    }
  }
}
