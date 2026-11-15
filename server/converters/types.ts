import type { ConvertOptions } from '../../src/engine/types';
import type { ServerConfig } from '../config';
import type { Tools } from '../process';

export interface Job {
  /** Private folder for this job only. */
  dir: string;
  /** Absolute path of the uploaded file inside dir. */
  input: string;
  from: string;
  to: string;
  options: ConvertOptions;
  /** Original file name, used only to name the result. */
  name: string;
  tools: Tools;
  config: ServerConfig;
  signal: AbortSignal;
}

export interface JobResult {
  path: string;
  name: string;
  format: string;
}

export interface ServerConverter {
  id: string;
  /** True when the tools it needs are installed. */
  available: (tools: Tools) => boolean;
  run: (job: Job) => Promise<JobResult>;
}

/** An error whose message is safe and useful to show the user. */
export class JobError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}
