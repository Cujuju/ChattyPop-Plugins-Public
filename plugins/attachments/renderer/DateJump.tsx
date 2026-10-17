import { Icon, look, openMenuAt, type MenuGroup } from '@plugin-sdk/renderer/kit';
import { monthBounds } from '../shared/months';
import { failure, jumpToMonth, months, sort } from './state';
import styles from './AttachmentFilters.module.css';

export function DateJump() {
  const open = (button: HTMLElement): void => {
    const groups: MenuGroup[] = [];
    for (const row of months()) {
      const year = row.month.split('-')[0]!;
      let group = groups.at(-1);
      if (group?.heading !== year) { group = { heading: year, items: [] }; groups.push(group); }
      const bounds = monthBounds(row.month);
      if (bounds) group!.items.push({ label: new Date(bounds.start).toLocaleDateString(undefined, { month: 'long' }),
        detail: row.count.toLocaleString(), icon: 'calendar', run: () => jumpToMonth(row.month) });
    }
    openMenuAt(button, groups);
  };
  const title = (): string => sort().key !== 'date' ? 'Jump to a date in date order'
    : months.failure ? 'Dates couldn’t be read' : months.loading ? 'Loading dates…'
    : !months().length ? 'No matching dates' : 'Jump to date';
  return <span title={title()}>
    <button type="button" class={`${styles.chip} ${look.iconButton}`} aria-label="Jump to date" aria-haspopup="menu"
      disabled={sort().key !== 'date' || months.loading || !!months.failure || !months().length || !!failure()}
      onClick={(e) => open(e.currentTarget)}><Icon name="calendar" /></button>
  </span>;
}
