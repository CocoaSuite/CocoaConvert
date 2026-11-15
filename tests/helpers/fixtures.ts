import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { detect } from '../../src/engine/detect';

export const FIXTURES = join(__dirname, '..', 'fixtures');

export const fixture = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));

export const fixtureNames = () => readdirSync(FIXTURES).filter((n) => !n.startsWith('.'));

/** Detects bytes the same way the app does. */
export const sniff = (data: Uint8Array, name: string) => detect({ name, head: data.subarray(0, 65536), tail: data.subarray(Math.max(0, data.length - 65536)) });
