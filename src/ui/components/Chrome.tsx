import { CATEGORY_LABELS } from '../../engine/formats';
import { formatBytes } from '../../engine/limits';
import type { Category } from '../../engine/types';
import { Icon, Mark } from '../../icons/Icon';
import { CATEGORY_ICON } from './FileRow';

export function Header({
  theme,
  onTheme,
  onFormats,
  onAdd,
  hasFiles,
}: {
  theme: 'dark' | 'light';
  onTheme: () => void;
  onFormats: () => void;
  onAdd: () => void;
  hasFiles: boolean;
}) {
  return (
    <header class="header">
      <a class="brand" href="/" aria-label="CocoaConvert home">
        <span class="brand-mark">
          <Mark />
        </span>
        <span class="brand-name">CocoaConvert</span>
      </a>
      <nav class="header-nav" aria-label="Main">
        <button class="menu-btn" onClick={onFormats}>
          Formats
        </button>
      </nav>
      <div class="header-end">
        {hasFiles && (
          <button class="btn" onClick={onAdd}>
            <Icon name="plus" />
            <span class="hide-narrow">Add files</span>
          </button>
        )}
        <button
          class="icon-btn"
          aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          onClick={onTheme}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
      </div>
    </header>
  );
}

const SHOWN: Category[] = ['image', 'document', 'audio', 'video', 'archive', 'data'];

export function StartScreen({ onChoose, onFormats, hasServer }: { onChoose: () => void; onFormats: () => void; hasServer: boolean }) {
  return (
    <div class="start">
      <div class="start-inner">
        <h1 class="display">Convert almost any file.</h1>
        <p class="lead">
          Drop files here, pick a format, and download the result. Images, documents, audio, video, archives and data
          convert in your browser.
        </p>
        <div class="drop-target" data-testid="drop-zone">
          <Icon name="open" size={24} class="mute-icon" />
          <p>Drop files anywhere on this page</p>
          <button class="btn primary" onClick={onChoose}>
            Choose files
          </button>
          <p class="hint">
            Or paste with <kbd>Ctrl</kbd> <kbd>V</kbd>. Up to {formatBytes(4 * 1024 ** 3)} per file.
          </p>
        </div>
        <div class="cats">
          {SHOWN.map((c) => (
            <button key={c} class="cat" onClick={onFormats}>
              <Icon name={CATEGORY_ICON[c]} />
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
        <p class="privacy">
          <Icon name="lock" size={14} />
          {hasServer
            ? 'Most conversions run on this device. Office documents and some archives can use the CocoaConvert server, only if you allow it. No account needed.'
            : 'Everything runs on this device. No account and no uploads.'}
        </p>
      </div>
    </div>
  );
}

export function StatusBar({
  total,
  bytes,
  done,
  busy,
  usesServer,
}: {
  total: number;
  bytes: number;
  done: number;
  busy: boolean;
  usesServer: boolean;
}) {
  return (
    <footer class="statusbar">
      <span class="num">
        {total ? `${total} ${total === 1 ? 'file' : 'files'} · ${formatBytes(bytes)}${done ? ` · ${done} done` : ''}` : 'No files yet'}
      </span>
      <span class="status-privacy">
        <span class={`dot ${busy ? 'warn' : 'ok'}`} aria-hidden="true" />
        {busy ? (usesServer ? 'Converting, some files on the server' : 'Converting on this device') : 'Processing on this device'}
      </span>
    </footer>
  );
}

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} class={`toast ${t.kind === 'error' ? 'toast-bad' : ''}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
