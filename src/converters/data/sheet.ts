import * as XLSX from 'xlsx';
import { baseName, outputName, safeName } from '../../engine/filenames';
import { ConversionError, type ConvertFn, type OutputFile } from '../../engine/types';
import { htmlDocument } from './tabular';

const BOOK_TYPES: Record<string, XLSX.BookType> = { xlsx: 'xlsx', xls: 'biff8', ods: 'ods' };

function readBook(data: Uint8Array, from: string): XLSX.WorkBook {
  try {
    if (from === 'csv' || from === 'tsv') {
      const text = new TextDecoder('utf-8').decode(data).replace(/^﻿/, '');
      return XLSX.read(text, { type: 'string', FS: from === 'tsv' ? '\t' : ',', raw: false, dense: true });
    }
    return XLSX.read(data, { type: 'array', cellFormula: true, cellDates: true, dense: true });
  } catch {
    throw new ConversionError('This spreadsheet could not be read. It may be damaged or password protected.', 'corrupt');
  }
}

export const convertSheet: ConvertFn = async (input, { to }) => {
  const book = readBook(input.data, input.from);
  if (!book.SheetNames.length) throw new ConversionError('This spreadsheet has no sheets.', 'corrupt');

  if (to in BOOK_TYPES) {
    const out = XLSX.write(book, { bookType: BOOK_TYPES[to], type: 'array', compression: true }) as ArrayBuffer;
    return [{ name: outputName(input.name, to), data: new Uint8Array(out), format: to }];
  }

  const enc = new TextEncoder();
  const sheets = book.SheetNames.map((name) => ({ name, ws: book.Sheets[name] }));

  if (to === 'csv' || to === 'tsv') {
    const nonEmpty = sheets.filter((s) => s.ws['!ref']);
    const list = nonEmpty.length ? nonEmpty : sheets.slice(0, 1);
    return list.map((s): OutputFile => {
      const text = XLSX.utils.sheet_to_csv(s.ws, { FS: to === 'tsv' ? '\t' : ',', blankrows: false });
      const suffix = list.length > 1 ? ` - ${safeName(s.name, 'sheet')}` : '';
      return { name: outputName(input.name, to, suffix), data: enc.encode(text + '\n'), format: to };
    });
  }

  if (to === 'json') {
    const rows = (ws: XLSX.WorkSheet) => XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
    const data = sheets.length === 1 ? rows(sheets[0].ws) : Object.fromEntries(sheets.map((s) => [s.name, rows(s.ws)]));
    return [{ name: outputName(input.name, 'json'), data: enc.encode(JSON.stringify(data, null, 2) + '\n'), format: 'json' }];
  }

  if (to === 'html') {
    const body = sheets
      .map((s) => {
        const table = XLSX.utils.sheet_to_html(s.ws, { header: '', footer: '' });
        return `<h2>${s.name.replace(/[<>&]/g, '')}</h2>\n${table}`;
      })
      .join('\n');
    return [{ name: outputName(input.name, 'html'), data: enc.encode(htmlDocument(baseName(input.name), body)), format: 'html' }];
  }

  throw new ConversionError(`Cannot convert ${input.from} to ${to} here.`, 'unsupported');
};
