# GEDCOM support

The parser (`src/gedcom/parser.ts`) reads the subset of GEDCOM 5.5 needed to
build a descendant tree. Line format:

```
LEVEL [@XREF@] TAG [VALUE]
```

## What is parsed

### `INDI` records

| Tag | Usage |
| --- | --- |
| `NAME` | Name; slashes around the surname are removed: `Иван /Иванов/` → `Иван Иванов`. Only the **first** `NAME` is used — it is the primary one; later records (married names, aliases, other spellings) never overwrite it |
| `GIVN`, `SURN` | Fallback: when the first `NAME` has no value, the name is assembled from the `GIVN`/`SURN` under it |
| `SEX` | `M` / `F`; anything else → `U` (unknown). Without a `SEX` tag the sex is taken from the family role: `HUSB` → `M`, `WIFE` → `F` (transcribed and hand-made files often omit it). An explicit tag, even `SEX U`, always wins |
| `FAMS` | Families where the person is a spouse. Several are supported: the person keeps one card and their spouses fan out beside it, each union carrying its own children — see [architecture.md](architecture.md) |
| `FAMC` → `PEDI` | Family where the person was born: the first `FAMC` whose `PEDI` is not `adopted`/`foster`/`sealing`, else the first `FAMC`. Only used to tell progenitors from subtree roots in the root family list |
| `BIRT` → `DATE` | The year is extracted — the first 3–4 digit number in the value, so ranges (`BET 1850 AND 1860`, `FROM … TO …`) give the lower bound |
| `DEAT` → `DATE` | Same; years are shown in card tooltips |

### `FAM` records

| Tag | Usage |
| --- | --- |
| `HUSB`, `WIFE` | Spouses |
| `CHIL` | Children (order is preserved and affects sector order) |

## Encodings

A loaded file is read as bytes and decoded by `decodeGedcom`
(`src/gedcom/decode.ts`). The `1 CHAR` header tag is often wrong (UTF-8 files
labelled `ANSEL`, Windows code pages labelled `ANSI`), so the bytes decide
first and the label only settles what they can't:

1. BOM → UTF-8, UTF-16LE or UTF-16BE; a file starting with `0` + NUL (or the
   reverse) is UTF-16 without a BOM.
2. Valid UTF-8 → UTF-8. Legacy 8-bit text with letters above ASCII is almost
   never valid UTF-8, so this is safe regardless of the label.
3. `CHAR ANSEL` → the built-in ANSEL decoder (spacing characters plus
   combining diacritics, which ANSEL puts *before* the letter; the result is
   NFC-normalized).
4. `CHAR` naming a code page (`WINDOWS-1251`, `CP1251`, `WINDOWS-1252`,
   `KOI8-R`, `CP866`, `MACINTOSH`, …) → that code page.
5. Anything else (`ANSI`, no label) → windows-1251 when bytes 0xC0–0xFF mostly
   come in runs (Cyrillic words consist of them entirely), otherwise
   windows-1252 (Western text has the odd accented letter between ASCII ones).

The bundled sample is already a string and skips this step.

## Behavior on imperfect data

- **Unknown tags** (MARR, PLAC, NOTE, SOUR, …) are silently skipped.
- **References to missing people** (`HUSB @I99@` with no `@I99@` record) do
  not break parsing — a stub record with the id as the name is created.
- **A person without a name** gets their id as the name.
- **BOM** and all line-ending styles (`\r\n`, `\r`, `\n`) are handled.
- Empty and unrecognized lines are ignored.
- A file without a single `FAM` record is an error — the parser throws
  `AppError('noFamilies')` and the UI renders it as «В файле не найдено ни
  одной семьи (записи FAM)».

## What the parser does not do

- No `CONC`/`CONT` support (continuation of long values) — practically never
  needed for names.
- No full dates (year only), places, marriage events, notes, sources, media.
- No reference consistency validation (e.g. that a child's `FAMC` matches the
  family's `CHIL`) — the tree is built from `CHIL` and `FAMS`.

## Minimal file example

```
0 @I1@ INDI
1 NAME Семён /Корнев/
1 SEX M
1 FAMS @F1@
0 @I2@ INDI
1 NAME Мария /Степанова/
1 SEX F
1 FAMS @F1@
0 @I3@ INDI
1 NAME Павел /Корнев/
1 SEX M
1 FAMC @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
```

The bundled demo (`examples/example-large.ged`, 489 people) loads on startup
and via the «Пример» button.
