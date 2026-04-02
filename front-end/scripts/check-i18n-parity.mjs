import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const translationsPath = path.join(process.cwd(), 'i18n', 'translations.ts');

function extractTranslationsObject(source) {
  const match = source.match(/export const translations\s*=\s*([\s\S]*?)\s+as const;/);
  if (!match) {
    throw new Error('Could not find `export const translations = ... as const` in i18n/translations.ts');
  }

  const objectLiteral = match[1];
  return vm.runInNewContext(`(${objectLiteral})`);
}

function flattenKeys(obj, prefix = '', out = new Set()) {
  if (typeof obj !== 'object' || obj === null) {
    return out;
  }

  for (const [key, value] of Object.entries(obj)) {
    const nextPath = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out.add(nextPath);
    } else {
      flattenKeys(value, nextPath, out);
    }
  }

  return out;
}

function setDiff(a, b) {
  return [...a].filter((k) => !b.has(k)).sort();
}

function main() {
  const source = fs.readFileSync(translationsPath, 'utf8');
  const translations = extractTranslationsObject(source);

  if (!translations.en || !translations.tl) {
    throw new Error('Expected translations.en and translations.tl to exist.');
  }

  const enKeys = flattenKeys(translations.en);
  const tlKeys = flattenKeys(translations.tl);

  const missingInTl = setDiff(enKeys, tlKeys);
  const missingInEn = setDiff(tlKeys, enKeys);

  if (missingInTl.length === 0 && missingInEn.length === 0) {
    console.log('i18n parity check passed: en and tl key sets match.');
    process.exit(0);
  }

  if (missingInTl.length > 0) {
    console.error('\nMissing in tl:');
    for (const key of missingInTl) {
      console.error(`  - ${key}`);
    }
  }

  if (missingInEn.length > 0) {
    console.error('\nMissing in en:');
    for (const key of missingInEn) {
      console.error(`  - ${key}`);
    }
  }

  process.exit(1);
}

main();
