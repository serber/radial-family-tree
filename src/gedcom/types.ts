export type Sex = 'M' | 'F' | 'U';

export interface Individual {
  id: string;
  name: string;
  sex: Sex;
  birthYear: number | null;
  deathYear: number | null;
  /** Families where this person is a spouse (FAMS). */
  famsIds: string[];
  /** Family where this person is a child (FAMC). */
  famcId: string | null;
}

export interface Family {
  id: string;
  husbandId: string | null;
  wifeId: string | null;
  childIds: string[];
}

export interface GedcomData {
  individuals: Map<string, Individual>;
  families: Map<string, Family>;
}
