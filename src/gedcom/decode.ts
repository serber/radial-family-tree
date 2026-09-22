/**
 * Turns the raw bytes of a GEDCOM file into text.
 *
 * Real files come in whatever their program wrote: UTF-8 (with or without a
 * BOM), UTF-16 from some Windows exporters, ANSEL (the GEDCOM 5.5 default) and,
 * very often in Russian files, a Windows code page labelled "ANSI". The `1 CHAR`
 * header tag names the encoding but is frequently wrong, so the bytes decide
 * first and the label only settles what they can't:
 *
 *   1. a BOM, or the NUL pattern of UTF-16 text starting with "0 HEAD";
 *   2. valid UTF-8 — legacy 8-bit text with letters above ASCII almost never is;
 *   3. the `CHAR` label: ANSEL, an explicit code page, or KOI8-R;
 *   4. otherwise a guess between windows-1251 and windows-1252.
 *
 * DOM-free: TextDecoder exists in Node as well.
 */
export function decodeGedcom(bytes: Uint8Array): string {
  const bom = bomEncoding(bytes);
  if (bom) return new TextDecoder(bom).decode(bytes); // strips the BOM itself

  // "0" followed by NUL (or the reverse): UTF-16 without a BOM.
  if (bytes[0] === 0x30 && bytes[1] === 0) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0 && bytes[1] === 0x30) return new TextDecoder('utf-16be').decode(bytes);

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Not UTF-8 — some 8-bit encoding; see what the header claims.
  }

  const label = charLabel(bytes);
  if (label === 'ANSEL') return decodeAnsel(bytes);
  const codePage = label ? LABEL_ENCODINGS[label] : undefined;
  return new TextDecoder(codePage ?? guessCodePage(bytes)).decode(bytes);
}

function bomEncoding(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return null;
}

/** Explicit `CHAR` values that name a single-byte code page. */
const LABEL_ENCODINGS: Record<string, string> = {
  'WINDOWS-1251': 'windows-1251',
  CP1251: 'windows-1251',
  '1251': 'windows-1251',
  'WINDOWS-1252': 'windows-1252',
  CP1252: 'windows-1252',
  '1252': 'windows-1252',
  'ISO-8859-1': 'windows-1252',
  LATIN1: 'windows-1252',
  'KOI8-R': 'koi8-r',
  KOI8R: 'koi8-r',
  CP866: 'ibm866',
  IBM866: 'ibm866',
  MACINTOSH: 'macintosh'
};

/** Value of the header's `1 CHAR` tag, upper-cased; the header is ASCII in every encoding here. */
function charLabel(bytes: Uint8Array): string | null {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 8192));
  const match = /^\s*1\s+CHAR\s+(\S+)/im.exec(head);
  return match ? match[1]!.toUpperCase() : null;
}

/**
 * windows-1251 or windows-1252, for files labelled "ANSI" or not at all. Both put
 * letters at 0xC0–0xFF, but Cyrillic words consist of them entirely, while
 * Western text uses them for the odd accented letter between ASCII ones. So
 * runs of two or more such bytes point to Cyrillic.
 */
function guessCodePage(bytes: Uint8Array): string {
  let inRuns = 0;
  let isolated = 0;
  let run = 0;
  const close = () => {
    if (run >= 2) inRuns += run;
    else if (run === 1) isolated += 1;
    run = 0;
  };
  for (const byte of bytes) {
    if (byte >= 0xc0) run += 1;
    else close();
  }
  close();
  return inRuns > isolated ? 'windows-1251' : 'windows-1252';
}

/** ANSEL spacing characters above ASCII (ANSI Z39.47 plus the GEDCOM additions). */
const ANSEL_SPACING: Record<number, string> = {
  0xa1: 'Ł', 0xa2: 'Ø', 0xa3: 'Đ', 0xa4: 'Þ', 0xa5: 'Æ', 0xa6: 'Œ', 0xa7: 'ʹ',
  0xa8: '·', 0xa9: '♭', 0xaa: '®', 0xab: '±', 0xac: 'Ơ', 0xad: 'Ư', 0xae: 'ʼ',
  0xb0: 'ʻ', 0xb1: 'ł', 0xb2: 'ø', 0xb3: 'đ', 0xb4: 'þ', 0xb5: 'æ', 0xb6: 'œ',
  0xb7: 'ʺ', 0xb8: 'ı', 0xb9: '£', 0xba: 'ð', 0xbc: 'ơ', 0xbd: 'ư', 0xbe: '□',
  0xbf: '■', 0xc0: '°', 0xc1: 'ℓ', 0xc2: '℗', 0xc3: '©', 0xc4: '♯', 0xc5: '¿',
  0xc6: '¡', 0xc7: 'ß', 0xc8: '€', 0xcf: 'ß'
};

/** ANSEL combining diacritics — they *precede* the letter they modify. */
const ANSEL_COMBINING: Record<number, string> = {
  0xe0: '\u0309', // hook above
  0xe1: '\u0300', // grave
  0xe2: '\u0301', // acute
  0xe3: '\u0302', // circumflex
  0xe4: '\u0303', // tilde
  0xe5: '\u0304', // macron
  0xe6: '\u0306', // breve
  0xe7: '\u0307', // dot above
  0xe8: '\u0308', // diaeresis
  0xe9: '\u030c', // caron
  0xea: '\u030a', // ring above
  0xeb: '\ufe20', // ligature, left half
  0xec: '\ufe21', // ligature, right half
  0xed: '\u0315', // comma above right
  0xee: '\u030b', // double acute
  0xef: '\u0310', // candrabindu
  0xf0: '\u0327', // cedilla
  0xf1: '\u0328', // ogonek
  0xf2: '\u0323', // dot below
  0xf3: '\u0324', // diaeresis below
  0xf4: '\u0325', // ring below
  0xf5: '\u0333', // double underline
  0xf6: '\u0332', // underline
  0xf7: '\u0326', // comma below
  0xf8: '\u031c', // left half ring below
  0xf9: '\u032e', // breve below
  0xfa: '\ufe22', // double tilde, left half
  0xfb: '\ufe23', // double tilde, right half
  0xfe: '\u0313' // comma above
};

function decodeAnsel(bytes: Uint8Array): string {
  let out = '';
  let pending = ''; // diacritics waiting for their base letter
  for (const byte of bytes) {
    const mark = ANSEL_COMBINING[byte];
    if (mark) {
      pending += mark;
      continue;
    }
    const char = byte < 0x80 ? String.fromCharCode(byte) : (ANSEL_SPACING[byte] ?? '\ufffd');
    out += char + pending;
    pending = '';
  }
  // Unicode puts combining marks after the base letter; NFC then folds the
  // common pairs ("e" + acute) into single precomposed characters.
  return (out + pending).normalize('NFC');
}
