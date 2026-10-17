// Prices and starting budget: original Data/Design/Scenario/FreeGame.ini.
// Breed price: original Data/Design/laboratory/Laboratory.ini.
// Movement, needs and income below are the new prototype's simulation rules.
import { isValidOriginalGenome, type OriginalGenome } from './original-genetics.ts';
export const SPECIES = [
  { id: 'stego', name: 'Stegosaurus', cost: 6500, speed: 1.05, scale: 1, diet: 'Otçul' },
  { id: 'trex', name: 'Tyrannosaurus Rex', cost: 18000, speed: 1.3, scale: 1, diet: 'Etçil' },
  { id: 'trice', name: 'Triceratops', cost: 12000, speed: 0.9, scale: 1, diet: 'Otçul' },
  { id: 'brachio', name: 'Brachiosaurus', cost: 42000, speed: 0.65, scale: 1, diet: 'Otçul' },
] as const;
export type SpeciesId = typeof SPECIES[number]['id'];
export const BUILD_ITEMS = [
  { id: 'path', name: 'Yol', cost: 25, radius: 1.5 },
  { id: 'fence', name: 'Çit', cost: 150, radius: 1 },
  { id: 'feeder', name: 'Yemlik', cost: 250, radius: 1.5 },
  { id: 'watchtower', name: 'Gözlem kulesi', cost: 1000, radius: 3 },
  { id: 'restaurant', name: 'Restoran', cost: 2500, radius: 5 },
  { id: 'farm', name: 'Çiftlik', cost: 3000, radius: 5 },
] as const;
export type BuildingId = typeof BUILD_ITEMS[number]['id'];
export interface Point { x: number; z: number }
export interface Habitat extends Point { id: number; halfWidth: number; halfDepth: number }
export interface Dinosaur extends Point {
  id: number; species: SpeciesId; name: string; heading: number;
  targetX: number; targetZ: number; hunger: number; happiness: number;
  habitat: number; age: number; parents?: [number, number];
  /** Exact original two-allele rows; offspring inheritance is not inferred yet. */
  genome?: OriginalGenome;
}
export interface Building extends Point { id: number; kind: BuildingId; rotation: number }
export interface Egg { id: number; first: number; second: number; remaining: number; duration: number }
export interface GameState {
  version: 1; money: number; visitors: number; elapsed: number; day: number;
  speed: number; paused: boolean; nextId: number; incomeClock: number;
  center: Point; habitats: Habitat[]; dinosaurs: Dinosaur[]; buildings: Building[]; eggs: Egg[];
}
export type Result = { ok: true; message: string } | { ok: false; message: string };
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
export const getSpecies = (id: string) => SPECIES.find(s => s.id === id);
export const getBuildItem = (id: string) => BUILD_ITEMS.find(s => s.id === id);
export const BREEDING_COST = 2000;
export const SAVE_KEY = 'dino-island.park.v1';

export function createInitialState(
  center: Point = { x: 8, z: 18 },
  genomes: Record<string, OriginalGenome> = {},
): GameState {
  const habitats = [[-25, -24], [25, -24], [-25, 24], [25, 24]].map(([x, z], i) => ({
    id: i, x: center.x + x, z: center.z + z, halfWidth: 18, halfDepth: 17,
  }));
  const state: GameState = {
    version: 1, money: 75000, visitors: 24, elapsed: 0, day: 1,
    speed: 1, paused: false, nextId: 1, incomeClock: 0,
    center: { ...center }, habitats, dinosaurs: [], buildings: [], eggs: [],
  };
  const names = ['Diken', 'Rex', 'Cera', 'Uzunboyun'];
  SPECIES.forEach((species, index) => {
    const h = habitats[index];
    state.dinosaurs.push(makeDinosaur(state, species.id, h, names[index], genomes[species.id]));
  });
  return state;
}

function makeDinosaur(
  state: GameState,
  species: SpeciesId,
  position: Point,
  name?: string,
  genome?: OriginalGenome,
): Dinosaur {
  const id = state.nextId++;
  const habitat = state.habitats.reduce((best, item) => distance(item, position) < distance(best, position) ? item : best, state.habitats[0]);
  const dinosaur: Dinosaur = {
    id, species, name: name ?? `${getSpecies(species)!.name} ${id}`, x: position.x, z: position.z,
    targetX: position.x + 4, targetZ: position.z + 2, heading: 0,
    hunger: 85, happiness: 90, habitat: habitat.id, age: 0,
  };
  if (genome) dinosaur.genome = genome;
  return dinosaur;
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

export function habitatAt(state: GameState, point: Point): Habitat | undefined {
  return state.habitats.find(h => Math.abs(h.x - point.x) <= h.halfWidth - 2 && Math.abs(h.z - point.z) <= h.halfDepth - 2);
}

export function buyDinosaur(
  state: GameState,
  species: string,
  point: Point,
  genome?: OriginalGenome,
): Result {
  const definition = getSpecies(species);
  if (!definition) return { ok: false, message: 'Bu dinozor türü bulunamadı.' };
  if (state.dinosaurs.length + state.eggs.length >= 60) return { ok: false, message: 'Adada en fazla 60 dinozor barındırabilirsin.' };
  const habitat = habitatAt(state, point);
  if (!habitat) return { ok: false, message: 'Dinozoru çitle çevrili alanlardan birinin içine yerleştir.' };
  if (state.money < definition.cost) return { ok: false, message: 'Bu dinozor için yeterli bütçen yok.' };
  state.money -= definition.cost;
  const dinosaur = makeDinosaur(state, definition.id, point, undefined, genome);
  dinosaur.habitat = habitat.id;
  state.dinosaurs.push(dinosaur);
  return { ok: true, message: `${definition.name} adaya geldi!` };
}

export function canBuild(state: GameState, kind: string, point: Point): Result {
  const definition = getBuildItem(kind);
  if (!definition || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return { ok: false, message: 'Geçersiz yapı.' };
  if (state.buildings.length >= 500) return { ok: false, message: 'Bu adanın yapı sınırına ulaştın.' };
  if (state.money < definition.cost) return { ok: false, message: 'Bu yapı için yeterli bütçen yok.' };
  const occupied = state.buildings.some(b => distance(b, point) < Math.max(1.9, (getBuildItem(b.kind)!.radius + definition.radius) * 0.7));
  if (occupied) return { ok: false, message: 'Burada başka bir yapı var.' };
  return { ok: true, message: '' };
}

export function placeBuilding(state: GameState, kind: string, point: Point, rotation = 0): Result {
  const valid = canBuild(state, kind, point);
  if (!valid.ok) return valid;
  const definition = getBuildItem(kind)!;
  state.money -= definition.cost;
  state.buildings.push({ id: state.nextId++, kind: definition.id, x: point.x, z: point.z, rotation });
  return { ok: true, message: `${definition.name} yerleştirildi.` };
}

export function feedDinosaur(state: GameState, id: number): Result {
  const dinosaur = state.dinosaurs.find(d => d.id === id);
  if (!dinosaur) return { ok: false, message: 'Dinozor bulunamadı.' };
  if (state.money < 100) return { ok: false, message: 'Yem için 100 gerekli.' };
  state.money -= 100;
  dinosaur.hunger = 100;
  dinosaur.happiness = clamp(dinosaur.happiness + 8, 0, 100);
  return { ok: true, message: `${dinosaur.name} beslendi.` };
}

export function breedDinosaurs(state: GameState, firstId: number, secondId: number): Result {
  const first = state.dinosaurs.find(d => d.id === firstId);
  const second = state.dinosaurs.find(d => d.id === secondId);
  if (!first || !second || first.id === second.id) return { ok: false, message: 'Laboratuvar için iki farklı dinozor seç.' };
  if (state.dinosaurs.length + state.eggs.length >= 60) return { ok: false, message: 'Adada en fazla 60 dinozor barındırabilirsin.' };
  if (state.eggs.length >= 4) return { ok: false, message: 'Dört kuluçka bölmesinin tamamı dolu.' };
  if (state.money < BREEDING_COST) return { ok: false, message: 'Üretim için 2000 gerekli.' };
  state.money -= BREEDING_COST;
  state.eggs.push({ id: state.nextId++, first: first.id, second: second.id, duration: 20, remaining: 20 });
  return { ok: true, message: 'Yumurta kuluçkaya alındı. 20 oyun saniyesi sonra çıkacak.' };
}

export function tick(state: GameState, realDelta: number): string[] {
  if (state.paused || !Number.isFinite(realDelta) || realDelta <= 0) return [];
  const dt = Math.min(realDelta, 1) * state.speed;
  state.elapsed += dt;
  state.day = Math.floor(state.elapsed / 240) + 1;
  const messages: string[] = [];
  for (const dinosaur of state.dinosaurs) {
    const habitat = state.habitats.find(h => h.id === dinosaur.habitat)!;
    dinosaur.age += dt;
    const feeder = state.buildings.some(b => b.kind === 'feeder' && distance(b, dinosaur) < 14);
    dinosaur.hunger = clamp(dinosaur.hunger + dt * (feeder ? 0.7 : -0.03), 0, 100);
    dinosaur.happiness = clamp(dinosaur.happiness + dt * (dinosaur.hunger > 30 ? 0.02 : -0.15), 0, 100);
    const dx = dinosaur.targetX - dinosaur.x;
    const dz = dinosaur.targetZ - dinosaur.z;
    const remaining = Math.hypot(dx, dz);
    if (remaining < 0.7) {
      const phase = dinosaur.age * 0.29 + dinosaur.id * 2.399;
      dinosaur.targetX = habitat.x + Math.sin(phase) * (habitat.halfWidth - 6);
      dinosaur.targetZ = habitat.z + Math.sin(phase * 1.71 + dinosaur.id) * (habitat.halfDepth - 6);
    } else {
      const step = Math.min(remaining, getSpecies(dinosaur.species)!.speed * dt * 0.65);
      dinosaur.x += dx / remaining * step;
      dinosaur.z += dz / remaining * step;
      const targetHeading = Math.atan2(dx, dz);
      let difference = targetHeading - dinosaur.heading;
      while (difference > Math.PI) difference -= Math.PI * 2;
      while (difference < -Math.PI) difference += Math.PI * 2;
      dinosaur.heading += difference * Math.min(1, dt * 2);
    }
  }
  for (const egg of state.eggs) egg.remaining -= dt;
  const hatched = state.eggs.filter(egg => egg.remaining <= 0);
  for (const egg of hatched) {
    const first = state.dinosaurs.find(d => d.id === egg.first);
    const second = state.dinosaurs.find(d => d.id === egg.second);
    if (first && second) {
      const habitat = state.habitats.find(h => h.id === first.habitat)!;
      const baby = makeDinosaur(state, first.species, habitat, `${first.name} · ${second.name}`);
      baby.parents = [first.id, second.id];
      state.dinosaurs.push(baby);
      messages.push(`${baby.name} yumurtadan çıktı!`);
    }
  }
  state.eggs = state.eggs.filter(egg => egg.remaining > 0);
  state.incomeClock += dt;
  if (state.incomeClock >= 12) {
    const cycles = Math.floor(state.incomeClock / 12);
    const average = state.dinosaurs.reduce((sum, d) => sum + d.happiness, 0) / Math.max(1, state.dinosaurs.length);
    const restaurants = state.buildings.filter(b => b.kind === 'restaurant').length;
    state.visitors = Math.min(200, Math.round(12 + state.dinosaurs.length * 4 + restaurants * 6 + average * 0.1));
    state.money += cycles * Math.max(0, state.visitors * 4 + restaurants * 20 - state.dinosaurs.length * 6);
    state.incomeClock %= 12;
  }
  return messages;
}

export const serializeGame = (state: GameState) => JSON.stringify(state);

// Treat local storage as untrusted; validate before handing it to the renderer.
export function parseSavedGame(text: string): GameState | null {
  if (text.length > 2_000_000) return null;
  try {
    const s = JSON.parse(text) as GameState;
    const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
    const point = (p: Point) => p && finite(p.x) && finite(p.z) && Math.abs(p.x) <= 600 && Math.abs(p.z) <= 600;
    if (!s || s.version !== 1 || !finite(s.money) || s.money < 0 || s.money > 1e12 || !finite(s.elapsed) || s.elapsed < 0 || !finite(s.day) || !finite(s.visitors) || !finite(s.incomeClock) || !point(s.center) || typeof s.paused !== 'boolean' || ![1, 2, 4].includes(s.speed) || !Number.isSafeInteger(s.nextId) || s.nextId < 1) return null;
    if (!Array.isArray(s.habitats) || s.habitats.length !== 4 || !Array.isArray(s.dinosaurs) || s.dinosaurs.length > 60 || !Array.isArray(s.buildings) || s.buildings.length > 500 || !Array.isArray(s.eggs) || s.eggs.length > 4 || s.dinosaurs.length + s.eggs.length > 60) return null;
    if (s.habitats.some(h => !point(h) || !Number.isInteger(h.id) || !finite(h.halfWidth) || h.halfWidth < 6 || h.halfWidth > 100 || !finite(h.halfDepth) || h.halfDepth < 6 || h.halfDepth > 100)) return null;
    if (new Set(s.habitats.map(h => h.id)).size !== 4) return null;
    const ids = new Set<number>();
    for (const d of s.dinosaurs) {
      if (!point(d) || !getSpecies(d.species) || !Number.isSafeInteger(d.id) || ids.has(d.id) || d.id <= 0 || d.id >= s.nextId || typeof d.name !== 'string' || d.name.length > 100 || !finite(d.heading) || !finite(d.age) || !point({ x: d.targetX, z: d.targetZ }) || !finite(d.hunger) || d.hunger < 0 || d.hunger > 100 || !finite(d.happiness) || d.happiness < 0 || d.happiness > 100 || !s.habitats.some(h => h.id === d.habitat)) return null;
      if (d.genome !== undefined && !isValidOriginalGenome(d.genome)) return null;
      if (d.parents && (!Array.isArray(d.parents) || d.parents.length !== 2 || d.parents.some(id => !Number.isSafeInteger(id)))) return null;
      ids.add(d.id);
    }
    for (const b of s.buildings) {
      if (!point(b) || !getBuildItem(b.kind) || !Number.isSafeInteger(b.id) || b.id <= 0 || b.id >= s.nextId || ids.has(b.id) || !finite(b.rotation)) return null;
      ids.add(b.id);
    }
    for (const e of s.eggs) {
      if (!Number.isSafeInteger(e.id) || ids.has(e.id) || e.id <= 0 || e.id >= s.nextId || !finite(e.remaining) || e.remaining <= 0 || !finite(e.duration) || e.duration <= 0 || e.remaining > e.duration || !s.dinosaurs.some(d => d.id === e.first) || !s.dinosaurs.some(d => d.id === e.second) || e.first === e.second) return null;
      ids.add(e.id);
    }
    return s;
  } catch { return null; }
}
