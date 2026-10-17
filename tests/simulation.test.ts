import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, buyDinosaur, breedDinosaurs, feedDinosaur, placeBuilding, tick, serializeGame, parseSavedGame } from '../src/simulation.ts';

test('purchase deducts original price once and assigns a real habitat', () => {
  const state = createInitialState();
  const h = state.habitats[0];
  assert.equal(buyDinosaur(state, 'stego', h).ok, true);
  assert.equal(state.money, 75000 - 6500);
  assert.equal(state.dinosaurs.length, 5);
  assert.equal(state.dinosaurs.at(-1)!.habitat, h.id);
});

test('invalid or unaffordable placement leaves budget and population intact', () => {
  const state = createInitialState();
  assert.equal(buyDinosaur(state, 'stego', state.center).ok, false);
  state.money = 10;
  assert.equal(buyDinosaur(state, 'trex', state.habitats[1]).ok, false);
  assert.equal(state.money, 10);
  assert.equal(state.dinosaurs.length, 4);
});

test('construction detects occupied positions before charging', () => {
  const state = createInitialState();
  assert.equal(placeBuilding(state, 'farm', state.center).ok, true);
  const balance = state.money;
  assert.equal(placeBuilding(state, 'farm', state.center).ok, false);
  assert.equal(state.money, balance);
  assert.equal(state.buildings.length, 1);
});

test('pause freezes movement, needs, income, and incubation', () => {
  const state = createInitialState();
  breedDinosaurs(state, 1, 2);
  state.paused = true;
  const before = serializeGame(state);
  tick(state, 1);
  assert.equal(serializeGame(state), before);
});

test('incubation charges original 2000 cost and hatches exactly once', () => {
  const state = createInitialState();
  assert.equal(breedDinosaurs(state, 1, 1).ok, false);
  assert.equal(state.money, 75000);
  assert.equal(breedDinosaurs(state, 1, 2).ok, true);
  assert.equal(state.money, 73000);
  for (let i = 0; i < 25; i++) tick(state, 1);
  assert.equal(state.eggs.length, 0);
  assert.equal(state.dinosaurs.length, 5);
  assert.deepEqual(state.dinosaurs.at(-1)!.parents, [1, 2]);
});

test('laboratory reserves the island population limit for pending eggs', () => {
  const state = createInitialState();
  state.money = 10000;
  while (state.dinosaurs.length < 58) {
    const parent = state.dinosaurs[state.dinosaurs.length % 4];
    state.dinosaurs.push({ ...parent, id: state.nextId++ });
  }
  const first = state.dinosaurs.at(-2)!.id;
  const second = state.dinosaurs.at(-1)!.id;
  assert.equal(breedDinosaurs(state, first, second).ok, true);
  assert.equal(state.eggs.length, 1);
  assert.equal(breedDinosaurs(state, first, second).ok, true);
  assert.equal(state.eggs.length, 2);
  assert.equal(state.dinosaurs.length + state.eggs.length, 60);
  assert.equal(breedDinosaurs(state, first, second).ok, false);
  assert.equal(state.eggs.length, 2);
  assert.equal(state.money, 10000 - 2 * 2000);
});

test('feeders restore food reserves and roaming remains inside enclosures', () => {
  const state = createInitialState();
  const dino = state.dinosaurs[0];
  dino.hunger = 30;
  placeBuilding(state, 'feeder', state.habitats[0]);
  for (let i = 0; i < 300; i++) tick(state, 0.2);
  assert.ok(dino.hunger > 30);
  for (const d of state.dinosaurs) {
    const h = state.habitats[d.habitat];
    assert.ok(Math.abs(d.x - h.x) < h.halfWidth);
    assert.ok(Math.abs(d.z - h.z) < h.halfDepth);
  }
  assert.equal(feedDinosaur(state, dino.id).ok, true);
  assert.equal(dino.hunger, 100);
});

test('purchases preserve egg reservations and saves reject an over-capacity island', () => {
  const state = createInitialState();
  while (state.dinosaurs.length < 59) {
    state.dinosaurs.push({ ...state.dinosaurs[0], id: state.nextId++ });
  }
  assert.equal(breedDinosaurs(state, 1, 2).ok, true);
  const balance = state.money;
  assert.equal(buyDinosaur(state, 'stego', state.habitats[0]).ok, false);
  assert.equal(state.money, balance);
  assert.ok(parseSavedGame(serializeGame(state)));

  const overCapacity = structuredClone(state);
  overCapacity.dinosaurs.push({ ...overCapacity.dinosaurs[0], id: overCapacity.nextId++ });
  assert.equal(parseSavedGame(serializeGame(overCapacity)), null);

  for (let i = 0; i < 25; i++) tick(state, 1);
  assert.equal(state.dinosaurs.length, 60);
  assert.equal(state.eggs.length, 0);
  assert.ok(parseSavedGame(serializeGame(state)));
});

test('save round trip preserves park, invalid references and numbers are rejected', () => {
  const state = createInitialState();
  placeBuilding(state, 'watchtower', state.center);
  breedDinosaurs(state, 1, 2);
  assert.deepEqual(parseSavedGame(serializeGame(state)), state);
  assert.equal(parseSavedGame('{"version":1}'), null);
  assert.equal(parseSavedGame('bad json'), null);
  const broken = structuredClone(state);
  broken.dinosaurs[0].habitat = 99;
  assert.equal(parseSavedGame(serializeGame(broken)), null);
  broken.dinosaurs[0].habitat = 0;
  broken.dinosaurs[0].id = broken.dinosaurs[1].id;
  assert.equal(parseSavedGame(serializeGame(broken)), null);
});
