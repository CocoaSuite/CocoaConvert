import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CATEGORY_LABELS, CATEGORY_ORDER, FORMATS, getFormat } from '../../engine/formats';
import { allRoutes, routeUsesServer, type Availability } from '../../engine/graph';
import type { Category } from '../../engine/types';
import { Icon } from '../../icons/Icon';

interface Row {
  from: string;
  device: string[];
  server: string[];
}

/** Every conversion the app can actually perform, derived from the registry. */
export function supportedConversions(avail: Availability): Row[] {
  return FORMATS.filter((f) => !f.pseudo)
    .map((f) => {
      const routes = [...allRoutes(f.id, 0, avail)];
      const label = (id: string) => getFormat(id).label;
      return {
        from: f.id,
        device: routes.filter(([, r]) => !routeUsesServer(r)).map(([to]) => label(to)),
        server: routes.filter(([, r]) => routeUsesServer(r)).map(([to]) => label(to)),
      };
    })
    .filter((r) => r.device.length || r.server.length);
}

export function FormatsDialog({ open, onClose, availability }: { open: boolean; onClose: () => void; availability: Availability }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const rows = useMemo(() => supportedConversions(availability), [availability]);
  const hasServer = availability.server.size > 0;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const q = query.trim().toLowerCase().replace(/^\./, '');
  const visible = rows.filter((r) => {
    if (!q) return true;
    const f = getFormat(r.from);
    return f.label.toLowerCase().includes(q) || f.exts.some((e) => e.includes(q));
  });
  const byCat = CATEGORY_ORDER.map((c: Category) => ({ c, rows: visible.filter((r) => getFormat(r.from).category === c) })).filter(
    (g) => g.rows.length,
  );

  return (
    <dialog ref={ref} class="dialog formats" aria-labelledby="formats-title" onClose={onClose} onCancel={onClose}>
      <header class="dialog-head">
        <h2 id="formats-title" class="dialog-title">
          Supported formats
        </h2>
        <button class="icon-btn" aria-label="Close" title="Close" onClick={onClose}>
          <Icon name="x" />
        </button>
      </header>
      <p class="hint">
        {hasServer
          ? 'Formats marked “server” are converted on the CocoaConvert server, only after you allow it. Everything else stays on this device.'
          : 'Every conversion listed here runs in your browser. Nothing is uploaded.'}
      </p>
      <input
        class="input"
        type="search"
        placeholder="Find a format, like heic or docx"
        aria-label="Find a format"
        value={query}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
      />
      <div class="formats-list">
        {byCat.map((g) => (
          <section key={g.c}>
            <h3 class="section-label">{CATEGORY_LABELS[g.c]}</h3>
            <dl>
              {g.rows.map((r) => (
                <div class="formats-row" key={r.from}>
                  <dt>
                    <span class="chip">{getFormat(r.from).label}</span>
                  </dt>
                  <dd>
                    {r.device.join(', ')}
                    {r.server.length > 0 && (
                      <span class="server-list">
                        {r.device.length ? ' · ' : ''}
                        <Icon name="server" size={13} /> {r.server.join(', ')}
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        {!byCat.length && <p class="hint">No format matches “{query}”.</p>}
      </div>
    </dialog>
  );
}
