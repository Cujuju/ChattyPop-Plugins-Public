// The Alerts panel's rule picker.
import { FilterMenu, HeaderButton, Icon, rules } from '@plugin-sdk/renderer/kit';
import { alertRuleIds, setAlertRuleIds, ruleUnread } from './state';

/** Names shown on the button before it reads "N of M rules". */
const MAX_NAMED_RULES = 2;

/** The Alerts header's rule picker: a funnel (an icon, so the bar fits a phone) opening the kit's checklist of rules. */
export function RuleFilter() {
  const byName = () => [...rules()].sort((a, b) => a.name.localeCompare(b.name));
  const label = (): string => {
    const names = byName().filter((r) => alertRuleIds().includes(r.id)).map((r) => r.name);
    if (!names.length) return 'All alerts';
    return names.length <= MAX_NAMED_RULES ? names.join(', ') : `${names.length} of ${byName().length} rules`;
  };
  const items = () =>
    byName().map((r) => ({ id: r.id, label: r.name, aside: ruleUnread(r.id) ? `${ruleUnread(r.id)} new` : undefined, asideTone: 'section' as const }));

  return (
    <FilterMenu
      label="Alerts to show"
      heading="Rules"
      items={items()}
      all={byName().map((r) => r.id)}
      picked={alertRuleIds()}
      onPick={(ids) => void setAlertRuleIds(ids)}
      trigger={(menu) => (
        // A funnel, raised while some rules are hidden; the shown rules are its name.
        <HeaderButton
          variant="icon"
          aria-haspopup="true"
          aria-expanded={menu.open}
          aria-pressed={alertRuleIds().length > 0}
          aria-label={`Rules shown: ${label()}`}
          title={`Showing ${label()}; choose which rules' alerts to show`}
          onClick={() => menu.toggle()}
        >
          <Icon name="filter" />
        </HeaderButton>
      )}
    />
  );
}
