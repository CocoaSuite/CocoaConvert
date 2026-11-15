import { useState } from 'preact/hooks';
import { getFormat } from '../../engine/formats';
import type { OptionDef } from '../../engine/types';
import { Icon } from '../../icons/Icon';
import type { Batch, BatchState } from '../batch';
import { saveBlob, zipOutputs } from '../download';
import { TargetSelect } from './FileRow';

function OptionControl({ def, value, onChange }: { def: OptionDef; value: string | number; onChange: (v: string | number) => void }) {
  const id = `opt-${def.key}`;
  if (def.choices) {
    // Two to four choices: a segmented control. More: a select.
    if (def.choices.length <= 4) {
      return (
        <div class="field">
          <span class="field-label" id={id}>
            {def.label}
          </span>
          <div class="segmented" role="radiogroup" aria-labelledby={id}>
            {def.choices.map((c) => (
              <button
                key={c.value}
                role="radio"
                aria-checked={String(value) === c.value}
                class={String(value) === c.value ? 'on' : ''}
                onClick={() => onChange(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      );
    }
    return (
      <label class="field">
        <span class="field-label">{def.label}</span>
        <span class="select">
          <select value={String(value)} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
            {def.choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <Icon name="chev" size={14} class="select-chev" />
        </span>
      </label>
    );
  }
  const n = Number(value);
  return (
    <div class="field slider-row">
      <button class="field-label link-label" title="Reset" onClick={() => onChange(def.default)}>
        {def.label}
      </button>
      <input
        type="range"
        aria-label={def.label}
        min={def.min}
        max={def.max}
        step={def.step}
        value={n}
        onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
      />
      <span class="number">
        <input
          type="number"
          aria-label={`${def.label} value`}
          min={def.min}
          max={def.max}
          value={n}
          onChange={(e) => {
            const v = Math.min(def.max ?? 100, Math.max(def.min ?? 0, Number((e.target as HTMLInputElement).value) || 0));
            onChange(v);
          }}
        />
        {def.unit}
      </span>
    </div>
  );
}

export function Panel({ batch, state, onToast }: { batch: Batch; state: BatchState; onToast: (m: string) => void }) {
  const [zipping, setZipping] = useState(false);
  const s = batch.summary();
  const bulk = batch.bulkTargets();
  const pending = batch.pending();
  const blocked = batch.blockedByConsent();
  const options = batch.visibleOptions();
  const waiting = state.items.filter((i) => i.from && i.status !== 'unsupported').length;
  const commonTarget = (() => {
    const t = new Set(state.items.filter((i) => i.target && i.status !== 'unsupported').map((i) => i.target));
    return t.size === 1 ? [...t][0] : null;
  })();
  const finished = s.done + s.failed;
  const active = s.converting + s.queued;
  const runTotal = active + finished;

  return (
    <aside class="panel" aria-label="Conversion settings">
      <section class="panel-section">
        <h2 class="section-label">Convert</h2>
        {bulk.length > 0 && (
          <label class="field">
            <span class="field-label">{waiting > 1 ? 'All files to' : 'Convert to'}</span>
            <TargetSelect
              label="Convert all files to"
              targets={bulk.map((b) => b.target)}
              value={commonTarget}
              placeholder="Mixed formats"
              counts={waiting > 1 ? new Map(bulk.map((b) => [b.target.format, b.count])) : undefined}
              onChange={(f) => {
                const n = batch.setAllTargets(f);
                if (waiting > 1 && n < waiting) onToast(`${getFormat(f).label} applies to ${n} of ${waiting} files`);
              }}
            />
          </label>
        )}
        {options.map(({ def, value }) => (
          <OptionControl key={def.key} def={def} value={value} onChange={(v) => batch.setOption(def.key, v)} />
        ))}

        {(blocked.length > 0 || (state.serverAllowed && state.items.some((i) => batch.needsServer(i)))) && (
          <div class="consent">
            <label class="toggle">
              <input
                type="checkbox"
                role="switch"
                checked={state.serverAllowed}
                onChange={(e) => batch.allowServer((e.target as HTMLInputElement).checked)}
              />
              <span class="toggle-track" aria-hidden="true" />
              <span>Allow server conversion</span>
            </label>
            <p class="hint">
              {blocked.length > 0
                ? `${blocked.length === 1 ? '1 file needs' : `${blocked.length} files need`} the CocoaConvert server. `
                : ''}
              Those files are uploaded, converted, sent back and deleted straight away. Nothing is stored.
            </p>
          </div>
        )}

        <button class="btn primary wide" disabled={!pending.length} onClick={() => batch.convertAll()}>
          {pending.length > 1 ? `Convert ${pending.length} files` : 'Convert'}
        </button>
      </section>

      {runTotal > 0 && (
        <section class="panel-section">
          <h2 class="section-label">Progress</h2>
          <div class="progress-line">
            <span class={`dot ${active ? 'warn' : s.failed ? 'bad' : 'ok'}`} aria-hidden="true" />
            <span role="status" aria-live="polite">
              {finished} of {runTotal} finished
              {s.failed ? ` · ${s.failed} failed` : ''}
            </span>
          </div>
          <div class="bar" role="progressbar" aria-label="Batch progress" aria-valuemin={0} aria-valuemax={runTotal} aria-valuenow={finished}>
            <div class="bar-fill" style={{ width: `${(finished / runTotal) * 100}%` }} />
          </div>
          {active > 0 && (
            <button class="btn wide" onClick={() => batch.cancelAll()}>
              Cancel all
            </button>
          )}
        </section>
      )}

      {s.outputs.length > 0 && (
        <section class="panel-section">
          <button
            class="btn wide"
            disabled={zipping}
            onClick={async () => {
              if (s.outputs.length === 1) return saveBlob(s.outputs[0].blob, s.outputs[0].name);
              setZipping(true);
              try {
                saveBlob(await zipOutputs(s.outputs), 'CocoaConvert files.zip');
              } catch {
                onToast('Could not make the ZIP: there is not enough memory');
              } finally {
                setZipping(false);
              }
            }}
          >
            <Icon name="download" />
            {zipping ? 'Packing…' : s.outputs.length === 1 ? 'Download' : `Download all as ZIP (${s.outputs.length})`}
          </button>
        </section>
      )}
    </aside>
  );
}
