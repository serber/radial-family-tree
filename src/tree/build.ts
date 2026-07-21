import { AppError } from '../errors.ts';
import type { GedcomData, Individual, Sex } from '../gedcom/types.ts';

export interface PersonRef {
  id: string;
  name: string;
  sex: Sex;
  birthYear: number | null;
  deathYear: number | null;
}

/** One union of the node's blood-line person, in display order. */
export interface Marriage {
  familyId: string;
  /** The person married into the line; null when the family records no second spouse. */
  spouseId: string | null;
}

export interface TreeNode {
  /** Id of the first union, or `single:<indiId>` for a descendant with no union of their own. */
  id: string;
  kind: 'family' | 'single';
  generation: number;
  /**
   * Cards to display: the blood-line person first, then one spouse per union in
   * `marriages` order. A person married several times keeps a single card here —
   * their spouses fan out beside them rather than duplicating them across nodes.
   */
  spouses: PersonRef[];
  /** Id of the blood-line spouse — the child through which this node connects upward. */
  entrySpouseId: string | null;
  /** Unions of the blood-line person; aligned with `spouses.slice(1)`. */
  marriages: Marriage[];
  /** Union of the parent node this one descends from — picks the stub to hang off. */
  parentFamilyId: string | null;
  /** Children of every union, flattened in `marriages` order. */
  children: TreeNode[];
}

export interface DescendantTree {
  root: TreeNode;
  /** Drawn nodes — a person plus their unions counts once, `single:` leaves included. */
  nodeCount: number;
  /** Unions actually drawn. Not the same as `nodeCount`: leaves have none, remarriages several. */
  familyCount: number;
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
 * A descendant becomes one node carrying every union they founded (FAMS), so a
 * person married several times appears once, with their spouses fanned out beside
 * them; a descendant with no union of their own becomes a `single` leaf.
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

  /** Unions of `person` not yet drawn elsewhere, claimed in GEDCOM order. */
  const claimFamilies = (person: Individual): string[] => {
    const claimed: string[] = [];
    for (const famId of person.famsIds) {
      if (!data.families.has(famId) || visitedFamilies.has(famId)) continue;
      visitedFamilies.add(famId);
      claimed.push(famId);
    }
    return claimed;
  };

  /** The spouse of `personId` in `familyId`, if the family records one. */
  const partnerOf = (familyId: string, personId: string): Individual | null => {
    const family = data.families.get(familyId);
    if (!family) return null;
    const otherId = family.husbandId === personId ? family.wifeId : family.husbandId;
    if (!otherId || otherId === personId) return null;
    return data.individuals.get(otherId) ?? null;
  };

  const childrenOf = (familyId: string, generation: number): TreeNode[] => {
    const family = data.families.get(familyId);
    if (!family) return [];
    const nodes: TreeNode[] = [];
    for (const childId of family.childIds) {
      const child = data.individuals.get(childId);
      if (!child) continue;
      people.add(childId);
      const claimed = claimFamilies(child);
      if (claimed.length === 0) {
        // No union of their own — or every union already drawn on another branch.
        nodeCount += 1;
        maxGeneration = Math.max(maxGeneration, generation);
        nodes.push({
          id: `single:${childId}`,
          kind: 'single',
          generation,
          spouses: [toRef(child)],
          entrySpouseId: childId,
          marriages: [],
          parentFamilyId: familyId,
          children: []
        });
        continue;
      }
      nodes.push(makePersonNode(child, claimed, generation, familyId));
    }
    return nodes;
  };

  /** A descendant plus every union they founded, as one node. */
  function makePersonNode(
    person: Individual,
    familyIds: string[],
    generation: number,
    parentFamilyId: string | null
  ): TreeNode {
    nodeCount += 1;
    maxGeneration = Math.max(maxGeneration, generation);
    people.add(person.id);

    const spouses: PersonRef[] = [toRef(person)];
    const marriages: Marriage[] = [];
    const children: TreeNode[] = [];
    for (const familyId of familyIds) {
      const spouse = partnerOf(familyId, person.id);
      if (spouse) {
        spouses.push(toRef(spouse));
        people.add(spouse.id);
      }
      marriages.push({ familyId, spouseId: spouse?.id ?? null });
      children.push(...childrenOf(familyId, generation + 1));
    }

    return {
      id: familyIds[0] ?? `single:${person.id}`,
      kind: 'family',
      generation,
      spouses,
      entrySpouseId: person.id,
      marriages,
      parentFamilyId,
      children
    };
  }

  const root = makeRootNode();
  // `visitedFamilies` also holds unions claimed by branches that were pruned, so
  // count the unions the tree really carries.
  let familyCount = 0;
  const countUnions = (node: TreeNode): void => {
    familyCount += node.marriages.length;
    node.children.forEach(countUnions);
  };
  countUnions(root);

  return { root, nodeCount, familyCount, peopleCount: people.size, maxGeneration };

  /**
   * The root couple has no blood line to pivot on, so both spouses get a card and
   * either one's further unions extend the disc — otherwise those branches, and
   * every descendant on them, would be dropped from the chart entirely.
   */
  function makeRootNode(): TreeNode {
    nodeCount += 1;
    const spouses: PersonRef[] = [];
    for (const spouseId of [rootFamily!.husbandId, rootFamily!.wifeId]) {
      if (!spouseId) continue;
      const person = data.individuals.get(spouseId);
      if (!person) continue;
      spouses.push(toRef(person));
      people.add(person.id);
    }
    // Keeps the `spouses.slice(1)` ↔ `marriages` alignment: card 2 is the root spouse.
    const marriages: Marriage[] = [{ familyId: rootFamilyId, spouseId: spouses[1]?.id ?? null }];
    const children = childrenOf(rootFamilyId, 1);

    for (const spouseId of [rootFamily!.husbandId, rootFamily!.wifeId]) {
      if (!spouseId) continue;
      const person = data.individuals.get(spouseId);
      if (!person) continue;
      for (const familyId of claimFamilies(person)) {
        const other = partnerOf(familyId, person.id);
        if (other) {
          spouses.push(toRef(other));
          people.add(other.id);
        }
        marriages.push({ familyId, spouseId: other?.id ?? null });
        children.push(...childrenOf(familyId, 1));
      }
    }

    return {
      id: rootFamilyId,
      kind: 'family',
      generation: 0,
      spouses,
      entrySpouseId: null,
      marriages,
      parentFamilyId: null,
      children
    };
  }
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
