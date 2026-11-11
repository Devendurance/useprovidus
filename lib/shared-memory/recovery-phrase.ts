import { validateMnemonic } from "@scure/bip39";
import { wordlist as czech } from "@scure/bip39/wordlists/czech";
import { wordlist as english } from "@scure/bip39/wordlists/english";
import { wordlist as french } from "@scure/bip39/wordlists/french";
import { wordlist as italian } from "@scure/bip39/wordlists/italian";
import { wordlist as japanese } from "@scure/bip39/wordlists/japanese";
import { wordlist as korean } from "@scure/bip39/wordlists/korean";
import { wordlist as portuguese } from "@scure/bip39/wordlists/portuguese";
import { wordlist as simplifiedChinese } from "@scure/bip39/wordlists/simplified-chinese";
import { wordlist as spanish } from "@scure/bip39/wordlists/spanish";
import { wordlist as traditionalChinese } from "@scure/bip39/wordlists/traditional-chinese";

const WORDLISTS = [
  czech,
  english,
  french,
  italian,
  japanese,
  korean,
  portuguese,
  simplifiedChinese,
  spanish,
  traditionalChinese,
].map((wordlist) => ({
  words: wordlist.map((word) => word.normalize("NFKD").toLowerCase()),
  membership: new Set(wordlist.map((word) => word.normalize("NFKD").toLowerCase())),
}));

const VALID_WORD_COUNTS = [12, 15, 18, 21, 24] as const;

function normalizedWords(fields: readonly string[]): string[] {
  return fields
    .join(" ")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

/** Checks text only. It never derives or stores wallet key material. */
export function containsBip39RecoveryPhrase(fields: readonly string[]): boolean {
  const words = normalizedWords(fields);

  for (const wordCount of VALID_WORD_COUNTS) {
    if (words.length < wordCount) continue;

    for (let start = 0; start <= words.length - wordCount; start += 1) {
      const candidateWords = words.slice(start, start + wordCount);

      for (const wordlist of WORDLISTS) {
        if (!candidateWords.every((word) => wordlist.membership.has(word))) continue;
        if (validateMnemonic(candidateWords.join(" "), wordlist.words)) return true;
      }
    }
  }

  return false;
}
