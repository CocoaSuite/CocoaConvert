import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';
import { dump, load } from 'js-yaml';
import { baseName, outputName } from '../../engine/filenames';
import { ConversionError, type ConvertFn } from '../../engine/types';
import {
  recordsFromTable,
  serializeDelimited,
  tableFromDelimited,
  tableFromJson,
  tableToHtml,
  tableToMarkdown,
  tableToSql,
  type Table,
} from './tabular';

const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

export const readText = (data: Uint8Array) => decoder.decode(data).replace(/^﻿/, '');

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    const where = e instanceof Error ? e.message.replace(/^.*?(at position \d+|line \d+ column \d+).*$/s, '$1') : '';
    throw new ConversionError(`This file is not valid JSON${where && where !== (e as Error).message ? ` (${where})` : ''}.`, 'corrupt');
  }
}

function parseXml(text: string): unknown {
  const valid = XMLValidator.validate(text);
  if (valid !== true) {
    throw new ConversionError(`This file is not valid XML (line ${valid.err.line}): ${valid.err.msg}`, 'corrupt');
  }
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    textNodeName: '#text',
    parseTagValue: true,
    trimValues: true,
    // Entity expansion is off: no billion-laughs style blow-ups.
    processEntities: false,
  }).parse(text);
}

function parseYaml(text: string): unknown {
  try {
    // JSON-compatible schema only: no custom tags, no code execution paths.
    return load(text, { json: true });
  } catch (e) {
    throw new ConversionError(`This file is not valid YAML: ${(e as Error).message.split('\n')[0]}`, 'corrupt');
  }
}

/** XML needs a single root element and safe tag names. */
function toXml(data: unknown): string {
  const fixKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(fixKeys);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v).map(([k, val]) => {
          let key = k.startsWith('@') || k === '#text' ? k : k.replace(/[^A-Za-z0-9_.-]/g, '_');
          if (!/^[A-Za-z_@#]/.test(key)) key = '_' + key;
          return [key, fixKeys(val)];
        }),
      );
    }
    return v;
  };
  let root: unknown = fixKeys(data);
  if (Array.isArray(root)) root = { root: { item: root } };
  else if (!root || typeof root !== 'object' || Object.keys(root).filter((k) => !k.startsWith('?')).length !== 1) {
    root = { root };
  }
  const xml = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    textNodeName: '#text',
    format: true,
    indentBy: '  ',
    suppressEmptyNode: true,
  }).build(root);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}

function sourceTable(from: string, text: string): Table {
  if (from === 'csv') return tableFromDelimited(text, ',');
  if (from === 'tsv') return tableFromDelimited(text, '\t');
  return tableFromJson(parseJson(text));
}

export const convertData: ConvertFn = async (input, { to }) => {
  const text = readText(input.data);
  const title = baseName(input.name);
  let out: string;

  if (input.from === 'json' || input.from === 'csv' || input.from === 'tsv') {
    if (input.from === 'json' && (to === 'xml' || to === 'yaml')) {
      const data = parseJson(text);
      out = to === 'xml' ? toXml(data) : dump(data, { lineWidth: -1, noRefs: true });
    } else {
      const table = sourceTable(input.from, text);
      switch (to) {
        case 'csv':
          out = serializeDelimited(table, ',');
          break;
        case 'tsv':
          out = serializeDelimited(table, '\t');
          break;
        case 'json':
          out = JSON.stringify(recordsFromTable(table), null, 2) + '\n';
          break;
        case 'sql':
          out = tableToSql(table, title.replace(/[^A-Za-z0-9_]/g, '_') || 'data');
          break;
        case 'md':
          out = tableToMarkdown(table);
          break;
        case 'html':
          out = tableToHtml(table, title);
          break;
        default:
          throw new ConversionError(`Cannot convert ${input.from} to ${to} here.`, 'unsupported');
      }
    }
  } else if (input.from === 'xml' && to === 'json') {
    out = JSON.stringify(parseXml(text), null, 2) + '\n';
  } else if (input.from === 'yaml' && to === 'json') {
    out = JSON.stringify(parseYaml(text), null, 2) + '\n';
  } else {
    throw new ConversionError(`Cannot convert ${input.from} to ${to} here.`, 'unsupported');
  }

  return [{ name: outputName(input.name, to), data: encoder.encode(out), format: to }];
};
