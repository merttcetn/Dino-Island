import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createInitialState,
  buyDinosaur,
  breedDinosaurs,
  tick,
  parseSavedGame,
} from '../src/simulation.ts';
import { ORIGINAL_GENE_NAMES, parseOriginalGenome } from '../src/original-genetics.ts';

const genotypeDirectory = new URL('../references/original/game/Data/Design/Scenario/Genotype/', import.meta.url);
const ids = ['stego', 'trex', 'trice', 'brachio'] as const;
const genomes = Object.fromEntries(ids.map(id => {
  const path = new URL(`${id}.gen`, genotypeDirectory);
  return [id, parseOriginalGenome(readFileSync(path, 'utf8'))];
}));

test('parses the original 18-gene, two-allele rows in authored order', () => {
  assert.deepEqual(genomes.trex.genes.map(gene => gene.alleles), [
    [16, 16], [16, 16], [16, 16], [16, 16],
    [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0],
    [0, 0], [0, 0], [0, 0], [0, 0], [1, 1],
    [6, 7], [7, 5], [4, 8],
  ]);
  assert.deepEqual(genomes.stego.genes.map(gene => gene.name), ORIGINAL_GENE_NAMES);
  assert.deepEqual(genomes.stego.genes[4]?.alleles, [2, 2]);
  assert.deepEqual(genomes.trice.genes[4]?.alleles, [5, 5]);
  assert.deepEqual(genomes.brachio.genes[0]?.alleles, [2, 2]);
});

test('parser rejects malformed counts, rows, and allele values', () => {
  const row = '1 1 // valid';
  assert.throws(() => parseOriginalGenome(`17\n${row.repeat(17)}`), /gene count: 17/);
  assert.throws(() => parseOriginalGenome(`18\n${Array(17).fill(row).join('\n')}`), /has 17 rows/);
  assert.throws(() => parseOriginalGenome('18\none two'), /Malformed original genome row/);
  assert.throws(() => parseOriginalGenome('18\n-1 1'), /Malformed original genome row/);
});

test('simulation persists exact base genomes without inventing offspring inheritance', () => {
  const state = createInitialState({ x: 0, z: 0 }, genomes);
  assert.deepEqual(state.dinosaurs.map(dinosaur => dinosaur.genome), ids.map(id => genomes[id]));

  const habitat = state.habitats[0];
  assert.equal(buyDinosaur(state, 'stego', habitat, genomes.stego).ok, true);
  assert.deepEqual(state.dinosaurs.at(-1)?.genome, genomes.stego);
  const noGenomeState = createInitialState();
  assert.equal(noGenomeState.dinosaurs.every(dinosaur => dinosaur.genome === undefined), true);

  assert.equal(breedDinosaurs(state, 1, 2).ok, true);
  state.eggs[0]!.remaining = 0;
  tick(state, 0.1);
  const baby = state.dinosaurs.at(-1);
  assert.equal(baby?.genome, undefined);

  const restored = parseSavedGame(JSON.stringify(state));
  assert.deepEqual(restored?.dinosaurs.map(dinosaur => dinosaur.genome), state.dinosaurs.map(dinosaur => dinosaur.genome));
  const invalid = JSON.parse(JSON.stringify(state));
  invalid.dinosaurs[0]!.genome.genes.length = 17;
  assert.equal(parseSavedGame(JSON.stringify(invalid)), null);
});
