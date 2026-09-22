import { AppError } from '../errors.ts';
import type { Family, GedcomData, Individual, Sex } from './types.ts';

interface GedcomLine {
  level: number;
  xref: string | null;
  tag: string;
  value: string;
}

const LINE_RE = /^\s*(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s(.*))?$/;

function tokenize(raw: string): GedcomLine[] {
  const lines: GedcomLine[] = [];
  for (const rawLine of raw.replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    if (!rawLine.trim()) continue;
    const match = LINE_RE.exec(rawLine);
    if (!match) continue;
    lines.push({
      level: Number(match[1]),
      xref: match[2] ?? null,
      tag: (match[3] ?? '').toUpperCase(),
      value: match[4] ?? ''
    });
  }
  return lines;
}

function normalizeSex(value: string): Sex {
  const v = value.trim().toUpperCase();
  return v === 'M' || v === 'F' ? v : 'U';
}

/** "Иван /Иванов/" → "Иван Иванов" */
function normalizeName(raw: string): string {
  return raw.replace(/\//g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The first 3–4 digit number: day numbers have at most two digits, so this is
 * the year — and for ranges (`BET 1850 AND 1860`, `FROM 1850 TO 1860`) the
 * lower bound rather than the upper one.
 */
function extractYear(dateValue: string): number | null {
  const match = /\b(\d{3,4})\b/.exec(dateValue);
  return match ? Number(match[1]) : null;
}

/** Pedigree links that don't make a person a blood child of the family. */
const NON_BIRTH_PEDIGREE = new Set(['ADOPTED', 'FOSTER', 'SEALING']);

interface ChildLink {
  familyId: string;
  pedigree: string | null;
}

/** The family a person was born into: the first `FAMC` not marked adopted/foster, else the first. */
function birthFamily(links: ChildLink[]): string | null {
  const birth = links.find((l) => !l.pedigree || !NON_BIRTH_PEDIGREE.has(l.pedigree));
  return (birth ?? links[0])?.familyId ?? null;
}

function emptyIndividual(id: string): Individual {
  return { id, name: '', sex: 'U', birthYear: null, deathYear: null, famsIds: [], famcId: null };
}

function ensureIndividual(map: Map<string, Individual>, id: string): Individual {
  let person = map.get(id);
  if (!person) {
    person = emptyIndividual(id);
    map.set(id, person);
  }
  return person;
}

/**
 * Parses the subset of GEDCOM needed for the visualization:
 * INDI (NAME/GIVN/SURN/SEX/FAMS/FAMC.PEDI/BIRT.DATE/DEAT.DATE) and FAM (HUSB/WIFE/CHIL).
 * Unknown tags are ignored; references to missing individuals get stub records.
 */
export function parseGedcom(raw: string): GedcomData {
  if (!raw.trim()) {
    throw new AppError('emptyGedcom');
  }

  const individuals = new Map<string, Individual>();
  /** People with an explicit SEX tag — even `SEX U` — whose sex is never inferred. */
  const sexGiven = new Set<string>();
  const families = new Map<string, Family>();

  type Context =
    | {
        kind: 'indi';
        person: Individual;
        given: string;
        surname: string;
        event: 'BIRT' | 'DEAT' | null;
        /** `NAME` records seen so far; only the first (the primary name) is used. */
        names: number;
        childLinks: ChildLink[];
      }
    | { kind: 'fam'; family: Family }
    | { kind: 'other' };

  let ctx: Context = { kind: 'other' };

  const finishIndividual = (c: Context) => {
    if (c.kind !== 'indi') return;
    if (!c.person.name) {
      c.person.name = `${c.given} ${c.surname}`.trim() || c.person.id;
    }
    c.person.famcId = birthFamily(c.childLinks);
  };

  for (const line of tokenize(raw)) {
    if (line.level === 0) {
      finishIndividual(ctx);
      const recordType = line.value.trim().toUpperCase() || line.tag;
      if (recordType === 'INDI' && line.xref) {
        ctx = {
          kind: 'indi',
          person: ensureIndividual(individuals, line.xref),
          given: '',
          surname: '',
          event: null,
          names: 0,
          childLinks: []
        };
      } else if (recordType === 'FAM' && line.xref) {
        const family: Family = { id: line.xref, husbandId: null, wifeId: null, childIds: [] };
        families.set(family.id, family);
        ctx = { kind: 'fam', family };
      } else {
        ctx = { kind: 'other' };
      }
      continue;
    }

    if (ctx.kind === 'indi') {
      const { person } = ctx;
      if (line.level === 1) ctx.event = null;
      switch (line.tag) {
        case 'NAME':
          // The first NAME is the primary one; later ones are married names,
          // aliases or spellings and must not overwrite it.
          if (line.level !== 1) break;
          ctx.names += 1;
          if (ctx.names === 1) person.name = normalizeName(line.value);
          break;
        case 'GIVN':
          if (ctx.names <= 1) ctx.given = line.value.trim();
          break;
        case 'SURN':
          if (ctx.names <= 1) ctx.surname = line.value.trim();
          break;
        case 'SEX':
          person.sex = normalizeSex(line.value);
          sexGiven.add(person.id);
          break;
        case 'FAMS':
          if (line.value) person.famsIds.push(line.value.trim());
          break;
        case 'FAMC':
          if (line.level === 1 && line.value.trim()) {
            ctx.childLinks.push({ familyId: line.value.trim(), pedigree: null });
          }
          break;
        case 'PEDI': {
          const link = ctx.childLinks.at(-1);
          if (line.level === 2 && link) link.pedigree = line.value.trim().toUpperCase();
          break;
        }
        case 'BIRT':
        case 'DEAT':
          if (line.level === 1) ctx.event = line.tag;
          break;
        case 'DATE':
          if (ctx.event === 'BIRT' && person.birthYear === null) person.birthYear = extractYear(line.value);
          if (ctx.event === 'DEAT' && person.deathYear === null) person.deathYear = extractYear(line.value);
          break;
        default:
          break;
      }
    } else if (ctx.kind === 'fam' && line.level === 1) {
      const { family } = ctx;
      const ref = line.value.trim();
      switch (line.tag) {
        case 'HUSB':
          if (ref) {
            family.husbandId = ref;
            ensureIndividual(individuals, ref);
          }
          break;
        case 'WIFE':
          if (ref) {
            family.wifeId = ref;
            ensureIndividual(individuals, ref);
          }
          break;
        case 'CHIL':
          if (ref) {
            family.childIds.push(ref);
            ensureIndividual(individuals, ref);
          }
          break;
        default:
          break;
      }
    }
  }
  finishIndividual(ctx);

  for (const person of individuals.values()) {
    if (!person.name) person.name = person.id;
  }

  // Transcribed and hand-made files often omit SEX; a family's HUSB and WIFE
  // roles still say who is who. Only fills a gap — an explicit tag always wins.
  const inferSex = (id: string | null, sex: Sex) => {
    const person = id ? individuals.get(id) : undefined;
    if (person && !sexGiven.has(person.id) && person.sex === 'U') person.sex = sex;
  };
  for (const family of families.values()) {
    inferSex(family.husbandId, 'M');
    inferSex(family.wifeId, 'F');
  }

  if (families.size === 0) {
    throw new AppError('noFamilies');
  }

  return { individuals, families };
}
