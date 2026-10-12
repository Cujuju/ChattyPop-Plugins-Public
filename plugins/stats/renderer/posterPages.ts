import { batch, createSignal } from 'solid-js';
import { POSTERS_PAGE_SIZE, type ActivityQuery, type PostersQuery, type StatsPoster } from '../shared/types';

/** Offset pages append rank order; resets invalidate reads already in flight. */
export function createPosterPages(readPage: (q: PostersQuery) => Promise<StatsPoster[]>) {
  const [expanded, setExpanded] = createSignal(false);
  const [items, setItems] = createSignal<StatsPoster[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [reachedEnd, setReachedEnd] = createSignal(false);
  let generation = 0;

  function reset(): void {
    generation++;
    batch(() => {
      setExpanded(false);
      setItems([]);
      setLoading(false);
      setFailure(null);
      setReachedEnd(false);
    });
  }

  async function loadMore(q: ActivityQuery): Promise<void> {
    if (!expanded() || loading() || reachedEnd()) return;
    const mine = generation;
    const offset = items().length;
    batch(() => { setLoading(true); setFailure(null); });
    try {
      const page = await readPage({ ...q, offset, limit: POSTERS_PAGE_SIZE });
      if (mine !== generation) return;
      batch(() => {
        setItems((old) => [...old, ...page]);
        setReachedEnd(page.length < POSTERS_PAGE_SIZE);
      });
    } catch (error) {
      if (mine === generation) setFailure(error instanceof Error ? error.message : "Couldn't load posters.");
    } finally {
      if (mine === generation) setLoading(false);
    }
  }

  async function showAll(q: ActivityQuery): Promise<void> {
    reset();
    setExpanded(true);
    await loadMore(q);
  }

  return { expanded, items, loading, failure, reachedEnd, reset, showAll, loadMore };
}
