import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { outputName } from '../../src/engine/filenames';
import { run, ToolError } from '../process';
import { JobError, type ServerConverter } from './types';

/** LibreOffice export filters by target format. */
const EXPORT: Record<string, string> = {
  pdf: 'pdf',
  docx: 'docx:MS Word 2007 XML',
  doc: 'doc:MS Word 97',
  odt: 'odt:writer8',
  rtf: 'rtf:Rich Text Format',
  txt: 'txt:Text (encoded):UTF8',
  html: 'html:XHTML Writer File:UTF8',
  pptx: 'pptx:Impress MS PowerPoint 2007 XML',
  ppt: 'ppt:MS PowerPoint 97',
  odp: 'odp:impress8',
  xlsx: 'xlsx:Calc MS Excel 2007 XML',
  xls: 'xls:MS Excel 97',
  ods: 'ods:calc8',
};

/** Import filters where LibreOffice's own guess is not what we want. */
const IMPORT: Record<string, string> = {
  pdf: 'writer_pdf_import',
  txt: 'Text (encoded):UTF8',
  html: 'HTML (StarWriter)',
  csv: 'CSV:44,34,76,1',
};

export const libreoffice: ServerConverter = {
  id: 'libreoffice',
  available: (t) => !!t.soffice,
  async run(job) {
    const filter = EXPORT[job.to];
    if (!filter) throw new JobError('This conversion is not available on the server.', 400);
    const outDir = join(job.dir, 'out');
    await mkdir(outDir);
    const args = [
      '--headless', '--invisible', '--nologo', '--norestore', '--nodefault', '--nolockcheck', '--nofirststartwizard',
      // A private profile per job: no shared state between users and safe parallel runs.
      `-env:UserInstallation=${pathToFileURL(join(job.dir, 'profile')).href}`,
      ...(IMPORT[job.from] ? [`--infilter=${IMPORT[job.from]}`] : []),
      '--convert-to', filter,
      '--outdir', outDir,
      job.input,
    ];
    try {
      await run(job.tools.soffice!, args, {
        cwd: job.dir,
        timeoutMs: job.config.timeouts.office,
        isolate: job.tools.isolate,
        signal: job.signal,
      });
    } catch (e) {
      if (e instanceof ToolError && e.timedOut) throw new JobError('This document took too long to convert. It may be very large or complex.', 422);
      throw new JobError('This document could not be converted. It may be damaged or password protected.', 422);
    }
    const files = await readdir(outDir);
    if (files.length !== 1) throw new JobError('This document could not be converted. It may be damaged or password protected.', 422);
    return { path: join(outDir, files[0]), name: outputName(job.name, job.to), format: job.to };
  },
};
