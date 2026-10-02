import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCALES } from '@/i18n/locales';
import { completeLocales, messageKeys } from './auth-locales-core';

type Tree = { [key: string]: string | Tree };

const FILE = 'auth-registration-security.json';
let cached: string[] | null = null;

function keysFor(root: string, locale: string): string[] | null {
  const file = join(root, locale, FILE);
  if (!existsSync(file)) return null;
  try {
    return messageKeys(JSON.parse(readFileSync(file, 'utf8')) as Tree);
  } catch {
    return null;
  }
}

/** Locales whose guest messages are complete (read once per server process; translations ship with a deploy). */
export function authLocales(root = join(process.cwd(), 'messages')): readonly string[] {
  if (cached) return cached;
  const english = keysFor(root, 'en') ?? [];
  cached = completeLocales(LOCALES, english, (locale) => keysFor(root, locale));
  return cached;
}
