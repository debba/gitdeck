#!/usr/bin/env node

import { readFileSync } from "node:fs";

const [englishPath = "src/i18n/en.ts", italianPath = "src/i18n/it.ts"] = process.argv.slice(2);

function readTranslationKeys(filePath) {
  const source = readFileSync(filePath, "utf8");
  const keys = new Set();
  const propertyPattern = /^\s*"((?:[^"\\]|\\.)+)"\s*:/gm;

  for (const match of source.matchAll(propertyPattern)) {
    keys.add(JSON.parse(`"${match[1]}"`));
  }

  if (keys.size === 0) {
    throw new Error(`No translation keys found in ${filePath}`);
  }

  return keys;
}

function difference(left, right) {
  return [...left].filter((key) => !right.has(key)).sort();
}

try {
  const englishKeys = readTranslationKeys(englishPath);
  const italianKeys = readTranslationKeys(italianPath);
  const missingFromItalian = difference(englishKeys, italianKeys);
  const missingFromEnglish = difference(italianKeys, englishKeys);

  if (missingFromItalian.length > 0) {
    console.error(`ERROR: translation keys missing from ${italianPath}:`);
    console.error(missingFromItalian.join("\n"));
  }

  if (missingFromEnglish.length > 0) {
    console.error(`ERROR: translation keys missing from ${englishPath}:`);
    console.error(missingFromEnglish.join("\n"));
  }

  if (missingFromItalian.length > 0 || missingFromEnglish.length > 0) {
    process.exitCode = 1;
  } else {
    console.log(`Locale keys match (${englishKeys.size} keys).`);
  }
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
