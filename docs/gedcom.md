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
| `NAME` | Name; slashes around the surname are removed: `Иван /Иванов/` → `Иван Иванов` |
| `GIVN`, `SURN` | Fallback: when `NAME` is missing, the name is assembled from these |
| `SEX` | `M` / `F`; anything else → `U` (unknown) |
| `FAMS` | Families where the person is a spouse (can be several) |
| `FAMC` | Family where the person is a child |
| `BIRT` → `DATE` | The year is extracted (the last 3–4 digit number in the value) |
| `DEAT` → `DATE` | Same; years are shown in card tooltips |

### `FAM` records

| Tag | Usage |
| --- | --- |
| `HUSB`, `WIFE` | Spouses |
| `CHIL` | Children (order is preserved and affects sector order) |

## Behavior on imperfect data

- **Unknown tags** (MARR, PLAC, NOTE, SOUR, …) are silently skipped.
- **References to missing people** (`HUSB @I99@` with no `@I99@` record) do
  not break parsing — a stub record with the id as the name is created.
- **A person without a name** gets their id as the name.
- **BOM** and all line-ending styles (`\r\n`, `\r`, `\n`) are handled.
- Empty and unrecognized lines are ignored.
- A file without a single `FAM` record is an error
  («В файле не найдено ни одной семьи»).

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

The bundled demo (`examples/example-large.ged`, 483 people) loads on startup
and via the «Пример» button.
