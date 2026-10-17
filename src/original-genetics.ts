/** Parser for the original 18-row, two-allele dinosaur `.gen` files. */

export const ORIGINAL_GENE_NAMES = [
  'headType', 'legType', 'bodyType', 'tailType',
  'headDummyPosition', 'headDummyType',
  'bodyDummyPosition', 'bodyDummyType',
  'tailDummyPosition', 'tailDummyType',
  'skinType', 'skinSubtype',
  'carapaceType', 'carapaceSubtype',
  'diet', 'aggressiveness', 'stamina', 'courage',
] as const;

export type OriginalGeneName = typeof ORIGINAL_GENE_NAMES[number];
export type OriginalAlleles = [number, number];

export interface OriginalGenome {
  geneCount: 18;
  genes: Array<{ name: OriginalGeneName; alleles: OriginalAlleles }>;
}

interface GenomeParts {
  geneCount: number;
  rows: Array<OriginalAlleles>;
}

function genomeParts(source: string): GenomeParts {
  const rows: Array<Array<number>> = [];
  for (const rawLine of source.replace(/^\ufeff/, '').split(/\r\n|\r|\n/)) {
    const line = rawLine.split('//')[0]!.trim();
    if (!line) continue;
    const values = line.split(/\s+/);
    if (rows.length === 0 && values.length === 1 && /^\d+$/.test(values[0]!)) {
      rows.push([Number(values[0])]);
      continue;
    }
    if (values.length !== 2 || values.some(value => !/^\d+$/.test(value))) {
      throw new Error(`Malformed original genome row: ${rawLine.trim()}`);
    }
    rows.push(values.map(Number));
  }
  const [firstRow, ...genes] = rows;
  const geneCount = firstRow?.[0];
  if (!Number.isInteger(geneCount) || geneCount <= 0) throw new Error('Original genome is missing its gene count');
  return { geneCount, rows: genes.map(row => {
    if (row.length !== 2) throw new Error('Original genome row does not contain two alleles');
    return [row[0]!, row[1]!] as OriginalAlleles;
  }) };
}

export function parseOriginalGenome(source: string): OriginalGenome {
  const { geneCount, rows } = genomeParts(source);
  if (geneCount !== ORIGINAL_GENE_NAMES.length) {
    throw new Error(`Unsupported original genome gene count: ${geneCount}`);
  }
  if (rows.length !== geneCount) {
    throw new Error(`Original genome has ${rows.length} rows, expected ${geneCount}`);
  }
  return {
    geneCount: 18,
    genes: rows.map((alleles, index) => ({
      name: ORIGINAL_GENE_NAMES[index]!,
      alleles,
    })),
  };
}

export function isValidOriginalGenome(value: unknown): value is OriginalGenome {
  if (!value || typeof value !== 'object') return false;
  const genome = value as Partial<OriginalGenome>;
  if (genome.geneCount !== 18 || !Array.isArray(genome.genes) || genome.genes.length !== 18) return false;
  return genome.genes.every((gene, index) =>
    gene !== null && typeof gene === 'object' &&
    gene.name === ORIGINAL_GENE_NAMES[index] &&
    Array.isArray(gene.alleles) && gene.alleles.length === 2 &&
    gene.alleles.every(allele => Number.isInteger(allele) && allele >= 0 && allele <= 99),
  );
}

export type OriginalGenomeLibrary = Record<string, OriginalGenome>;

async function genomeText(url: string, path: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to read original genome ${path}: HTTP ${response.status}`);
  return response.text();
}

/** Fetch and parse the base genomes for the species used by the live park. */
export async function loadOriginalBaseGenomes(
  species: readonly string[],
): Promise<OriginalGenomeLibrary> {
  const manifestResponse = await fetch('/assets/manifest.json');
  if (!manifestResponse.ok) throw new Error('Original asset manifest is missing. Run scripts/prepare-assets.py.');
  const manifest = await manifestResponse.json() as Record<string, string>;
  const entries = await Promise.all(species.map(async id => {
    const path = `data/design/scenario/genotype/${id}.gen`;
    const url = manifest[path];
    if (!url) throw new Error(`Original asset manifest is missing ${path}`);
    return [id, parseOriginalGenome(await genomeText(url, path))] as const;
  }));
  return Object.fromEntries(entries);
}
