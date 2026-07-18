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

function extractYear(dateValue: string): number | null {
  const match = /\b(\d{3,4})\b(?!.*\b\d{3,4}\b)/.exec(dateValue);
  return match ? Number(match[1]) : null;
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
 * INDI (NAME/GIVN/SURN/SEX/FAMS/FAMC/BIRT.DATE/DEAT.DATE) and FAM (HUSB/WIFE/CHIL).
 * Unknown tags are ignored; references to missing individuals get stub records.
 */
export function parseGedcom(raw: string): GedcomData {
  if (!raw.trim()) {
    throw new AppError('emptyGedcom');
  }

  const individuals = new Map<string, Individual>();
  const families = new Map<string, Family>();

  type Context =
    | { kind: 'indi'; person: Individual; given: string; surname: string; event: 'BIRT' | 'DEAT' | null }
    | { kind: 'fam'; family: Family }
    | { kind: 'other' };

  let ctx: Context = { kind: 'other' };

  const finishIndividual = (c: Context) => {
    if (c.kind !== 'indi') return;
    if (!c.person.name) {
      c.person.name = `${c.given} ${c.surname}`.trim() || c.person.id;
    }
  };

  for (const line of tokenize(raw)) {
    if (line.level === 0) {
      finishIndividual(ctx);
      const recordType = line.value.trim().toUpperCase() || line.tag;
      if (recordType === 'INDI' && line.xref) {
        ctx = { kind: 'indi', person: ensureIndividual(individuals, line.xref), given: '', surname: '', event: null };
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
          person.name = normalizeName(line.value);
          break;
        case 'GIVN':
          ctx.given = line.value.trim();
          break;
        case 'SURN':
          ctx.surname = line.value.trim();
          break;
        case 'SEX':
          person.sex = normalizeSex(line.value);
          break;
        case 'FAMS':
          if (line.value) person.famsIds.push(line.value.trim());
          break;
        case 'FAMC':
          if (line.value) person.famcId = line.value.trim();
          break;
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

  if (families.size === 0) {
    throw new AppError('noFamilies');
  }

  return { individuals, families };
}
