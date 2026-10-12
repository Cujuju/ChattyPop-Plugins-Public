import { For, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import cloud from 'd3-cloud';
import { look } from '@plugin-sdk/renderer/kit';
import type { WordCount } from '../shared/text';
import { CLOUD_HEIGHT, CLOUD_PADDING, CLOUD_WIDTH, cloudInputs, type CloudWord } from './cloudInputs';
import { countLabel, share } from './section';
import styles from './Stats.module.css';

/** Ten-millisecond layout slices keep renderer input responsive while packing the cloud. */
const CLOUD_LAYOUT_SLICE_MS = 10;

export function WordCloud(props: { words: WordCount[] }) {
  let svg!: SVGSVGElement;
  const [font, setFont] = createSignal<string>();
  const [placed, setPlaced] = createSignal<CloudWord[]>([]);
  onMount(() => { setFont(getComputedStyle(svg).fontFamily); });
  createEffect(() => {
    const family = font();
    const words = cloudInputs(props.words);
    setPlaced([]);
    if (!family || !words.length) return;
    const layout = cloud<CloudWord>().size([CLOUD_WIDTH, CLOUD_HEIGHT]).words(words).font(family).timeInterval(CLOUD_LAYOUT_SLICE_MS)
      .rotate(0).fontSize((word) => word.size).padding(CLOUD_PADDING).on('end', setPlaced);
    onCleanup(() => layout.stop());
    layout.start();
  });
  return <svg ref={svg} class={styles.cloud} viewBox={`0 0 ${CLOUD_WIDTH} ${CLOUD_HEIGHT}`} role="img" aria-label="Word cloud of the most frequent words; ranked counts follow">
    <g transform={`translate(${CLOUD_WIDTH / 2}, ${CLOUD_HEIGHT / 2})`}>
      <For each={placed()}>{(word) => <text class={look.chartWord} x={word.x} y={word.y} font-size={String(word.size)} text-anchor="middle" style={share(word.share, 1)}>
        {word.text}<title>{word.text}: {countLabel(word.count, 'occurrence')}</title>
      </text>}</For>
    </g>
  </svg>;
}
