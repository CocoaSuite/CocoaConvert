export type Category =
  | 'image'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'ebook'
  | 'audio'
  | 'video'
  | 'archive'
  | 'data';

export interface FormatDef {
  id: string;
  label: string;
  /** Extension used for output files, without the dot. */
  ext: string;
  /** Every extension that may carry this format. */
  exts: string[];
  mime: string;
  category: Category;
  /** Plain text formats are sniffed by content and extension together. */
  text?: boolean;
  /** Pseudo formats (such as extracted files) never appear as a source. */
  pseudo?: boolean;
}

/** Where a converter runs. Client converters never send data off the device. */
export type Environment = 'client' | 'server';

/** Browser thread for client converters. Worker converters keep the page responsive. */
export type Thread = 'worker' | 'main';

export interface Edge {
  from: string;
  to: string;
  /** Lower is preferred. */
  cost: number;
  /** When false the edge may only be used as a single-step conversion. */
  chain: boolean;
  /** Known quality limits, written for the user. */
  note?: string;
}

export interface OptionChoice {
  value: string;
  label: string;
}

export interface OptionDef {
  key: string;
  label: string;
  /** A select when choices are present, otherwise a number slider. */
  choices?: OptionChoice[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  default: string | number;
  /** Target formats the option applies to. */
  targets: string[];
  /** Only shown when the source category matches. */
  sources?: Category[];
}

export interface ConverterDef {
  id: string;
  label: string;
  env: Environment;
  thread?: Thread;
  edges: Edge[];
  /** Largest input this converter accepts, in bytes. */
  maxBytes: number;
  /** Tools the server needs for this converter. */
  requires?: string[];
  /** Reports real progress while it runs. */
  reportsProgress: boolean;
  /** At most this many jobs run at once (heavy engines share one instance). */
  concurrency?: number;
}

export type ConvertOptions = Record<string, string | number>;

export interface ConvertInput {
  data: Uint8Array;
  /** Original file name, used only to name outputs. */
  name: string;
  from: string;
}

export interface OutputFile {
  name: string;
  data: Uint8Array;
  format: string;
}

export interface ConvertContext {
  to: string;
  options: ConvertOptions;
  /** Fraction 0–1, or null when the step cannot report progress. */
  onProgress?: (fraction: number | null) => void;
  signal?: AbortSignal;
}

export type ConvertFn = (input: ConvertInput, ctx: ConvertContext) => Promise<OutputFile[]>;

export interface RouteStep {
  converter: ConverterDef;
  from: string;
  to: string;
  note?: string;
}

export interface Route {
  steps: RouteStep[];
  cost: number;
  env: Environment | 'mixed';
  notes: string[];
}

export class ConversionError extends Error {
  /** Message written for the user, following the CocoaSuite writing rules. */
  constructor(message: string, readonly code: string = 'failed') {
    super(message);
    this.name = 'ConversionError';
  }
}
