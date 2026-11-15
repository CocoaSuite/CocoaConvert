import { marked } from 'marked';
import { baseName, outputName } from '../../engine/filenames';
import { ConversionError, type ConvertFn } from '../../engine/types';
import { escapeHtml, htmlDocument } from '../data/tabular';

const enc = new TextEncoder();
const text = (d: Uint8Array) => new TextDecoder('utf-8').decode(d).replace(/^﻿/, '');

/** Markdown or plain text to a standalone HTML page. Runs in the worker (no DOM needed). */
export const convertToHtml: ConvertFn = async (input) => {
  const src = text(input.data);
  const title = baseName(input.name);
  let body: string;
  if (input.from === 'md') {
    body = await marked.parse(src, { gfm: true, async: true });
  } else if (input.from === 'txt') {
    body = src
      .split(/\r?\n\s*\r?\n/)
      .map((p) => `<p>${escapeHtml(p).replace(/\r?\n/g, '<br>\n')}</p>`)
      .join('\n');
  } else {
    throw new ConversionError(`Cannot convert ${input.from} to HTML here.`, 'unsupported');
  }
  return [{ name: outputName(input.name, 'html'), data: enc.encode(htmlDocument(title, body)), format: 'html' }];
};

/** Plain text from parsed HTML, keeping paragraph and line breaks. */
export function htmlToPlainText(doc: Document): string {
  doc.querySelectorAll('script,style,noscript,template,head').forEach((n) => n.remove());
  const blocks = /^(P|DIV|SECTION|ARTICLE|HEADER|FOOTER|LI|TR|H[1-6]|BLOCKQUOTE|PRE|TABLE|UL|OL|DL|DT|DD|FIGURE|HR)$/;
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent ?? '').replace(/\s+/g, ' ');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (el.tagName === 'BR') {
      out += '\n';
      return;
    }
    if (el.tagName === 'PRE') {
      out += '\n' + (el.textContent ?? '') + '\n';
      return;
    }
    const block = blocks.test(el.tagName);
    if (block) out += '\n';
    if (el.tagName === 'LI') out += '• ';
    el.childNodes.forEach(walk);
    if (el.tagName === 'TD' || el.tagName === 'TH') out += '\t';
    if (block) out += '\n';
  };
  walk(doc.body ?? doc.documentElement);
  return (
    out
      .split('\n')
      .map((l) => l.replace(/[ \t]+$/g, '').replace(/^ +/, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}

/** HTML (or Markdown) to Markdown or text. Needs DOMParser, so it runs on the page. */
export const convertFromHtml: ConvertFn = async (input, { to }) => {
  let src = text(input.data);
  if (input.from === 'md') src = await marked.parse(src, { gfm: true, async: true });
  // DOMParser builds an inert document: no scripts run and nothing is fetched.
  const doc = new DOMParser().parseFromString(src, 'text/html');
  let out: string;
  if (to === 'md') {
    const { default: TurndownService } = await import('turndown');
    doc.querySelectorAll('script,style,noscript,template,form,iframe,object,embed').forEach((n) => n.remove());
    const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
    td.keep(['table', 'thead', 'tbody', 'tr', 'th', 'td'] as never);
    out = td.turndown(doc.body ?? doc.documentElement) + '\n';
  } else if (to === 'txt') {
    out = htmlToPlainText(doc);
  } else {
    throw new ConversionError(`Cannot convert ${input.from} to ${to} here.`, 'unsupported');
  }
  return [{ name: outputName(input.name, to), data: enc.encode(out), format: to }];
};
