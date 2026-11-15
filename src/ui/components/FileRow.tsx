import { memo } from 'preact/compat';
import { useState } from 'preact/hooks';
import { CATEGORY_LABELS, CATEGORY_ORDER, getFormat } from '../../engine/formats';
import { formatBytes } from '../../engine/limits';
import type { Category } from '../../engine/types';
import { Icon, type IconName } from '../../icons/Icon';
import type { Batch, Item, Target } from '../batch';
import { saveBlob, zipOutputs } from '../download';

export const CATEGORY_ICON: Record<Category, IconName> = {
  image: 'image',
  document: 'doc',
  spreadsheet: 'sheet',
  presentation: 'slides',
  ebook: 'book',
  audio: 'audio',
  video: 'video',
  archive: 'archive',
  data: 'data',
};

/** A native select grouped by category: the smallest control, and the phone's own picker on mobile. */
export function TargetSelect({
  targets,
  value,
  onChange,
  label,
  disabled,
  placeholder,
  counts,
}: {
  targets: Target[];
  value: string | null;
  onChange: (format: string) => void;
  label: string;
  disabled?: boolean;
  placeholder?: string;
  counts?: Map<string, number>;
}) {
  const groups = CATEGORY_ORDER.map((c) => ({
    c,
    list: targets.filter((t) => getFormat(t.format).category === c),
  })).filter((g) => g.list.length);
  return (
    <span class="select">
      <select
        aria-label={label}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
      >
        {!value && <option value="">{placeholder ?? 'Choose a format'}</option>}
        {groups.map((g) => (
          <optgroup key={g.c} label={CATEGORY_LABELS[g.c]}>
            {g.list.map((t) => (
              <option key={t.format} value={t.format}>
                {getFormat(t.format).label}
                {t.server ? ' · server' : ''}
                {counts && counts.get(t.format) !== undefined ? ` (${counts.get(t.format)})` : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <Icon name="chev" size={14} class="select-chev" />
    </span>
  );
}

function Progress({ item }: { item: Item }) {
  const p = item.progress;
  const where = p?.where === 'server' ? 'on the server' : 'on this device';
  let text = item.status === 'queued' ? 'Waiting' : `Converting ${where}`;
  if (p?.phase === 'upload') text = 'Uploading';
  else if (p?.phase === 'download') text = 'Receiving the result';
  else if (p?.phase === 'convert') text = 'Converting on the server';
  const pct = p?.fraction != null ? Math.round(p.fraction * 100) : null;
  const steps = p && p.steps > 1 ? ` · step ${p.step} of ${p.steps}` : '';
  return (
    <div class="progress" role="status" aria-live="polite">
      <div class="progress-line">
        <span class="dot warn" aria-hidden="true" />
        <span>
          {text}
          {steps}
        </span>
        {pct !== null && <span class="num">{pct}%</span>}
      </div>
      {pct !== null ? (
        <div class="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={text}>
          <div class="bar-fill" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function Result({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const outs = item.outputs;
  const total = outs.reduce((s, o) => s + o.size, 0);
  if (outs.length === 1) {
    const o = outs[0];
    return (
      <div class="result">
        <span class="result-name" title={o.name}>
          <Icon name="check" size={14} class="ok-icon" />
          <span class="truncate">{o.name}</span>
          <span class="meta">{formatBytes(o.size)}</span>
        </span>
        <button class="btn" onClick={() => saveBlob(o.blob, o.name)}>
          <Icon name="download" />
          Download
        </button>
      </div>
    );
  }
  const zipName = `${item.name.replace(/\.[^.]+$/, '')} (${outs.length} files).zip`;
  return (
    <div class="result result-multi">
      <span class="result-name">
        <Icon name="check" size={14} class="ok-icon" />
        <span>
          {outs.length} files · {formatBytes(total)}
        </span>
        <button class="link" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide files' : 'Show files'}
        </button>
      </span>
      <button
        class="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            saveBlob(await zipOutputs(outs), zipName);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Icon name="download" />
        {busy ? 'Packing…' : 'Download ZIP'}
      </button>
      {open && (
        <ul class="outputs">
          {outs.slice(0, 500).map((o) => (
            <li key={o.name}>
              <span class="truncate" title={o.name}>
                {o.name}
              </span>
              <span class="meta">{formatBytes(o.size)}</span>
              <button class="icon-btn" aria-label={`Download ${o.name}`} title="Download" onClick={() => saveBlob(o.blob, o.name)}>
                <Icon name="download" />
              </button>
            </li>
          ))}
          {outs.length > 500 && <li class="meta">Download the ZIP to get all {outs.length} files.</li>}
        </ul>
      )}
    </div>
  );
}

function RowComponent({ item, batch, serverAllowed }: { item: Item; batch: Batch; serverAllowed: boolean }) {
  const from = item.from ? getFormat(item.from) : null;
  const icon = from ? CATEGORY_ICON[from.category] : 'doc';
  const target = item.targets.find((t) => t.format === item.target);
  const busy = item.status === 'converting' || item.status === 'queued';
  const notes = target && item.status !== 'done' ? target.route.notes : [];
  return (
    <li class={`row status-${item.status}`} data-testid="file-row">
      <span class="row-icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <div class="row-main">
        <div class="row-name truncate" title={item.name}>
          {item.name}
        </div>
        <div class="row-meta">
          {from && <span class="chip">{from.label}</span>}
          <span>{formatBytes(item.size)}</span>
          {item.mismatch && from && (
            <span class="hint" title={`Named .${item.mismatch} but the contents are ${from.label}`}>
              Contents are {from.label}
            </span>
          )}
        </div>
      </div>

      <div class="row-target">
        {item.status === 'detecting' && <span class="meta">Reading…</span>}
        {item.from && item.targets.length > 0 && (
          <>
            <Icon name="swap" size={14} class="mute-icon" />
            <TargetSelect
              label={`Convert ${item.name} to`}
              targets={item.targets}
              value={item.target}
              disabled={busy}
              onChange={(f) => batch.setTarget(item.id, f)}
            />
          </>
        )}
      </div>

      <div class="row-state">
        {busy && <Progress item={item} />}
        {item.status === 'done' && <Result item={item} />}
        {(item.status === 'failed' || item.status === 'unsupported') && (
          <p class="error" role="alert">
            <Icon name="alert" size={14} />
            <span>{item.error}</span>
          </p>
        )}
        {item.status === 'cancelled' && <span class="meta">Cancelled</span>}
        {item.status === 'ready' && target?.server && !serverAllowed && (
          <span class="meta">
            <Icon name="server" size={14} /> Needs the server
          </span>
        )}
        {item.status === 'ready' && notes.length > 0 && <span class="note">{notes.join(' ')}</span>}
      </div>

      <div class="row-actions">
        {busy && (
          <button class="btn" onClick={() => batch.cancel(item.id)}>
            Cancel
          </button>
        )}
        {(item.status === 'failed' || item.status === 'cancelled') && item.target && (
          <button class="btn" onClick={() => batch.retry(item.id)}>
            <Icon name="update" />
            Retry
          </button>
        )}
        {!busy && (
          <button class="icon-btn" aria-label={`Remove ${item.name}`} title="Remove" onClick={() => batch.remove(item.id)}>
            <Icon name="x" />
          </button>
        )}
      </div>
    </li>
  );
}

/** Rows re-render only when their own item changes. */
export const FileRow = memo(RowComponent, (a, b) => a.item === b.item && a.serverAllowed === b.serverAllowed);
