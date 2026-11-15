import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { NO_SERVER } from '../engine/graph';
import { Icon } from '../icons/Icon';
import { fetchCapabilities } from '../runtime/server';
import { Batch } from './batch';
import { Header, StartScreen, StatusBar, Toasts, type Toast } from './components/Chrome';
import { FileRow } from './components/FileRow';
import { FormatsDialog } from './components/FormatsDialog';
import { Panel } from './components/Panel';

function useBatch(batch: Batch) {
  const [, setTick] = useState(0);
  useEffect(() => batch.subscribe(() => setTick((t) => t + 1)), [batch]);
  return batch.state;
}

/** Files from a drop, including entries the browser exposes only through items. */
function droppedFiles(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  return [...dt.files].filter((f) => f.size > 0 || f.type !== '');
}

export function App() {
  const batch = useMemo(() => new Batch(NO_SERVER), []);
  const state = useBatch(batch);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [formatsOpen, setFormatsOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    document.documentElement.classList.contains('light') ? 'light' : 'dark',
  );

  const toast = useCallback((message: string, kind: 'info' | 'error' = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 3000);
  }, []);
  batch.onNotice = toast;

  useEffect(() => {
    void fetchCapabilities().then((caps) => {
      if (caps) batch.setAvailability({ server: new Set(caps.converters) });
    });
  }, [batch]);

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f4f2' : '#121212');
    try {
      localStorage.setItem('cc-theme', theme);
    } catch {
      /* private mode */
    }
  }, [theme]);

  const add = useCallback(
    (files: File[]) => {
      if (!files.length) return;
      batch.add(files);
      toast(files.length === 1 ? 'Added 1 file' : `Added ${files.length} files`);
    },
    [batch, toast],
  );

  // Drop anywhere on the window; paste files from the clipboard.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      add(droppedFiles(e.dataTransfer));
    };
    const paste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const files = [...(e.clipboardData?.files ?? [])].map((f, i) =>
        f.name && f.name !== 'image.png' ? f : new File([f], `Pasted image${i ? ` ${i + 1}` : ''}.${f.type.split('/')[1] || 'png'}`, { type: f.type }),
      );
      if (files.length) {
        e.preventDefault();
        add(files);
      }
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('paste', paste);
    };
  }, [add]);

  const choose = () => input.current?.click();
  const s = batch.summary();
  const hasFiles = state.items.length > 0;
  const hasServer = state.availability.server.size > 0;

  return (
    <div class="app">
      <Header
        theme={theme}
        onTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        onFormats={() => setFormatsOpen(true)}
        onAdd={choose}
        hasFiles={hasFiles}
      />
      <input
        ref={input}
        type="file"
        multiple
        hidden
        data-testid="file-input"
        onChange={(e) => {
          const el = e.target as HTMLInputElement;
          add([...(el.files ?? [])]);
          el.value = '';
        }}
      />
      <main class={`workspace ${hasFiles ? 'has-files' : ''}`}>
        {hasFiles ? (
          <>
            <section class="desk" aria-label="Files">
              <div class="list-head">
                <h2 class="section-label">Files</h2>
                <button class="link" onClick={() => batch.clear()}>
                  Clear list
                </button>
              </div>
              <ul class="rows">
                {state.items.map((item) => (
                  <FileRow key={item.id} item={item} batch={batch} serverAllowed={state.serverAllowed} />
                ))}
              </ul>
              <button class="add-more" onClick={choose}>
                <Icon name="plus" />
                Add more files
              </button>
            </section>
            <Panel batch={batch} state={state} onToast={toast} />
          </>
        ) : (
          <StartScreen onChoose={choose} onFormats={() => setFormatsOpen(true)} hasServer={hasServer} />
        )}
      </main>
      <StatusBar total={s.total} bytes={s.bytes} done={s.done} busy={s.converting + s.queued > 0} usesServer={s.usesServer} />
      {dragging && (
        <div class="drop-overlay" aria-hidden="true">
          <div class="drop-card">
            <Icon name="open" size={24} />
            Drop to add files
          </div>
        </div>
      )}
      <FormatsDialog open={formatsOpen} onClose={() => setFormatsOpen(false)} availability={state.availability} />
      <Toasts toasts={toasts} />
    </div>
  );
}

