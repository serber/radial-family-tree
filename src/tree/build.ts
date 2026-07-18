import { AppError } from '../errors.ts';
import type { GedcomData, Individual, Sex } from '../gedcom/types.ts';

export interface PersonRef {
  id: string;
  name: string;
  sex: Sex;
  birthYear: number | null;
  deathYear: number | null;
}

export interface TreeNode {
  /** Family id, or `single:<indiId>` for a childless unmarried descendant. */
  id: string;
  kind: 'family' | 'single';
  generation: number;
  /** Spouses to display; the blood-line spouse (if known) comes first. */
  spouses: PersonRef[];
  /** Id of the blood-line spouse — the child through which this family connects upward. */
  entrySpouseId: string | null;
  children: TreeNode[];
}

export interface DescendantTree {
  root: TreeNode;
  nodeCount: number;
  peopleCount: number;
  maxGeneration: number;
}

export interface RootCandidate {
  familyId: string;
  label: string;
  descendants: number;
  /** True when neither spouse is recorded as somebody's child. */
  isProgenitor: boolean;
}

function toRef(person: Individual): PersonRef {
  const { id, name, sex, birthYear, deathYear } = person;
  return { id, name, sex, birthYear, deathYear };
}

function personName(data: GedcomData, id: string | null): string | null {
  return id ? (data.individuals.get(id)?.name ?? id) : null;
}

/**
 * Builds the descendant tree of `rootFamilyId`.
 * A child who founded families becomes one child node per family (FAMS);
 * a child without families becomes a `single` leaf.
 * Each family appears once — on re-entry (cousin marriages) the first placement wins.
 */
export function buildTree(data: GedcomData, rootFamilyId: string): DescendantTree {
  const rootFamily = data.families.get(rootFamilyId);
  if (!rootFamily) {
    throw new AppError('familyNotFound', { id: rootFamilyId });
  }

  const visitedFamilies = new Set<string>([rootFamilyId]);
  const people = new Set<string>();
  let nodeCount = 0;
  let maxGeneration = 0;

  const makeFamilyNode = (familyId: string, generation: number, entryChildId: string | null): TreeNode => {
    const family = data.families.get(familyId);
    if (!family) throw new AppError('familyNotFound', { id: familyId });
    nodeCount += 1;
    maxGeneration = Math.max(maxGeneration, generation);

    const spouses: PersonRef[] = [];
    for (const spouseId of [family.husbandId, family.wifeId]) {
      if (!spouseId) continue;
      const person = data.individuals.get(spouseId);
      if (person) {
        spouses.push(toRef(person));
        people.add(person.id);
      }
    }
    // Blood-line spouse first, so it sits closest to the parent link.
    if (entryChildId) {
      const idx = spouses.findIndex((s) => s.id === entryChildId);
      if (idx > 0) spouses.unshift(...spouses.splice(idx, 1));
    }

    const children: TreeNode[] = [];
    for (const childId of family.childIds) {
      const child = data.individuals.get(childId);
      if (!child) continue;
      people.add(childId);
      const ownFamilies = child.famsIds.filter((famId) => data.families.has(famId));
      if (ownFamilies.length === 0) {
        nodeCount += 1;
        maxGeneration = Math.max(maxGeneration, generation + 1);
        children.push({
          id: `single:${childId}`,
          kind: 'single',
          generation: generation + 1,
          spouses: [toRef(child)],
          entrySpouseId: childId,
          children: []
        });
        continue;
      }
      for (const famId of ownFamilies) {
        if (visitedFamilies.has(famId)) continue;
        visitedFamilies.add(famId);
        children.push(makeFamilyNode(famId, generation + 1, childId));
      }
    }

    return {
      id: familyId,
      kind: 'family',
      generation,
      spouses,
      entrySpouseId: entryChildId,
      children
    };
  };

  const root = makeFamilyNode(rootFamilyId, 0, null);
  return { root, nodeCount, peopleCount: people.size, maxGeneration };
}

function countDescendants(data: GedcomData, familyId: string, visited: Set<string>): number {
  if (visited.has(familyId)) return 0;
  visited.add(familyId);
  const family = data.families.get(familyId);
  if (!family) return 0;
  let count = family.childIds.length;
  for (const childId of family.childIds) {
    const child = data.individuals.get(childId);
    if (!child) continue;
    for (const famId of child.famsIds) {
      count += countDescendants(data, famId, visited);
    }
  }
  return count;
}

/**
 * Families usable as tree roots, largest descendant count first.
 * Families whose spouses are themselves someone's children are listed too
 * (the user may want a subtree), but sort below the true progenitors.
 */
export function listRootCandidates(data: GedcomData): RootCandidate[] {
  const candidates: RootCandidate[] = [];
  for (const family of data.families.values()) {
    const husband = family.husbandId ? data.individuals.get(family.husbandId) : null;
    const wife = family.wifeId ? data.individuals.get(family.wifeId) : null;
    const names = [personName(data, family.husbandId), personName(data, family.wifeId)].filter(Boolean);
    candidates.push({
      familyId: family.id,
      label: names.length ? names.join(' + ') : family.id,
      descendants: countDescendants(data, family.id, new Set()),
      isProgenitor: !husband?.famcId && !wife?.famcId
    });
  }
  candidates.sort((a, b) => Number(b.isProgenitor) - Number(a.isProgenitor) || b.descendants - a.descendants);
  return candidates;
}
