// Summary run controls shared by the desktop popover and phone sheet.
import { Show, createSignal, createUniqueId, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  HeaderButton,
  Icon,
  ProviderSelect,
  Select,
  inCompanion,
  listen,
  look,
  pullToClose,
} from '@plugin-sdk/renderer/kit';
import { SUMMARY_RANGES, type SummaryRange } from '../shared/settings';
import { patchSummarySettings, summarySettings } from './settings';
import { runSummary, setSummaryRange, setSummaryScope, summaryRange, summaryRunning, summaryScope } from './state';
import { ScopeSelect } from './scope';
import styles from './Summary.module.css';

/** Opening focuses the surface; picking a provider, channel or time frame requires its own interaction. */
export function SummaryControls() {
  const id = createUniqueId();
  const [open, setOpen] = createSignal(false);
  let trigger!: HTMLButtonElement;
  let panel!: HTMLDivElement;
  let frame = 0;

  const close = (): void => {
    if (inCompanion) setOpen(false);
    else panel.hidePopover();
    trigger.focus({ preventScroll: true });
  };
  // Docking and floating-window drags can move the header without a window resize or scroll event.
  const place = (): void => {
    if (!panel.matches(':popover-open')) return;
    const css = getComputedStyle(panel);
    const inset = parseFloat(css.getPropertyValue('--cp-space-3'));
    const gap = parseFloat(css.getPropertyValue('--cp-popover-gap'));
    const anchor = trigger.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    const below = anchor.bottom + gap;
    const top = below + bounds.height > innerHeight - inset ? anchor.top - gap - bounds.height : below;
    const left = `${Math.max(inset, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - inset))}px`;
    const y = `${Math.max(inset, Math.min(top, innerHeight - bounds.height - inset))}px`;
    if (panel.style.left !== left) panel.style.left = left;
    if (panel.style.top !== y) panel.style.top = y;
    frame = requestAnimationFrame(place);
  };
  onCleanup(() => cancelAnimationFrame(frame));
  if (!inCompanion) {
    listen(window, 'keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !panel.matches(':popover-open')) return;
      e.preventDefault();
      close();
    });
  }

  return (
    <>
      <HeaderButton
        ref={trigger}
        variant="primaryIcon"
        aria-label="Summary options"
        title="Summary options"
        aria-haspopup="dialog"
        aria-expanded={open()}
        aria-controls={id}
        popovertarget={inCompanion ? undefined : id}
        onClick={() => { if (inCompanion) setOpen(true); }}
      >
        <Icon name="summary" />
      </HeaderButton>
      <Portal>
        <Show when={inCompanion} fallback={
          <div
            ref={panel}
            id={id}
            popover="auto"
            role="dialog"
            tabIndex={-1}
            aria-labelledby={`${id}-title`}
            class={`cp-popover ${styles.runPanel} ${look.silentFocus}`}
            onToggle={(e) => {
              const shown = (e as ToggleEvent).newState === 'open';
              setOpen(shown);
              cancelAnimationFrame(frame);
              if (shown) {
                place();
                panel.focus({ preventScroll: true });
              }
            }}
          >
            <Show when={open()}>
              <div class={styles.runBody}>
                <SummaryHeading id={id} onClose={close} />
                <SummaryFields id={id} onClose={close} />
              </div>
            </Show>
          </div>
        }>
          <Show when={open()}><SummarySheet id={id} onClose={close} /></Show>
        </Show>
      </Portal>
    </>
  );
}

/** A native modal sheet owns focus, backdrop dismissal and the lifetime of its nested channel picker. */
function SummarySheet(props: { id: string; onClose: () => void }) {
  let dialog!: HTMLDialogElement;
  let body!: HTMLDivElement;
  onMount(() => {
    dialog.showModal();
    // A nested picker scrolls independently; its touches must not start a sheet pull.
    listen(body, 'touchstart', (e) => {
      if (e.target instanceof Element && e.target.closest('[popover]')) e.stopPropagation();
    }, { passive: true });
    pullToClose(dialog, props.onClose, body);
  });
  return (
    <dialog
      ref={dialog}
      id={props.id}
      class={`${styles.runSheet} ${look.page}`}
      aria-labelledby={`${props.id}-title`}
      onClose={props.onClose}
      onClick={(e) => { if (e.target === dialog) props.onClose(); }}
    >
      <div class={`${styles.runSheetFrame} ${look.silentFocus}`} tabIndex={-1} autofocus>
        <div class={styles.runSheetHead}>
          <div class={`${styles.runGrabber} ${look.sheetGrabber}`} aria-hidden="true" />
          <SummaryHeading id={props.id} onClose={props.onClose} />
        </div>
        <div ref={body} class={styles.runBody}>
          <SummaryFields id={props.id} onClose={props.onClose} />
        </div>
      </div>
    </dialog>
  );
}

function SummaryHeading(props: { id: string; onClose: () => void }) {
  return (
    <div class={styles.runHead}>
      <h3 id={`${props.id}-title`} class={look.text} data-size={inCompanion ? 'xl' : 'md'} data-weight="semibold">Summary options</h3>
      <HeaderButton variant="icon" aria-label="Close summary options" onClick={props.onClose}><Icon name="close" /></HeaderButton>
    </div>
  );
}

/** The provider preference and run scope remain owned by the existing stores on both surfaces. */
function SummaryFields(props: { id: string; onClose: () => void }) {
  return (
    <>
      <div class={styles.runField}>
        <label for={`${props.id}-provider`} class={look.text} data-size="sm">Provider</label>
        <ProviderSelect
          id={`${props.id}-provider`}
          class={styles.runSelect}
          value={summarySettings().defaultProvider}
          onChange={(defaultProvider) => patchSummarySettings({ defaultProvider })}
        />
      </div>
      <div class={styles.runField}>
        <label for={`${props.id}-channels`} class={look.text} data-size="sm">Channels</label>
        <ScopeSelect id={`${props.id}-channels`} class={styles.runSelect} value={summaryScope()} onChange={setSummaryScope} />
      </div>
      <div class={styles.runField}>
        <label for={`${props.id}-range`} class={look.text} data-size="sm">Time frame</label>
        <Select
          id={`${props.id}-range`}
          class={styles.runSelect}
          value={summaryRange()}
          options={Object.entries(SUMMARY_RANGES).map(([value, r]) => ({ value, label: r.label }))}
          onChange={(v) => setSummaryRange(v as SummaryRange)}
        />
      </div>
      <button
        type="button"
        class={`${styles.runButton} ${look.button} ${look.text}`}
        data-variant="primary"
        data-size="md"
        data-weight="semibold"
        data-font="sans"
        disabled={summaryRunning()}
        onClick={() => {
          props.onClose();
          void runSummary();
        }}
      >
        {summaryRunning() ? 'Working…' : 'Run summary'}
      </button>
    </>
  );
}
