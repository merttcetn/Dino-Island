import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOriginalCameraIni } from '../src/original-camera.ts';

const cameraIni = new URL('../references/original/game/Data/Config/camera.ini', import.meta.url);

function profile() {
  return {
    moveSpeed: { min: 1, max: 20 },
    progressSpeed: { min: 0.05, max: 0.2 },
    rotationSpeed: { min: 1.570796, max: 1.570796 },
    elevation: { min: 3, max: 500 },
    distance: { min: 10, max: 300 },
    targetHardness: { start: 6, end: 2 },
    positionHardness: { start: 6, end: 2 },
    extraFields: {},
  };
}

test('original camera INI exposes all five typed profiles', () => {
  const configs = parseOriginalCameraIni(readFileSync(cameraIni, 'utf8'));
  const expected = profile();

  assert.deepEqual(configs, {
    Config1: expected,
    Config2: profile(),
    Config3: profile(),
    Config4: profile(),
    Config5: profile(),
  });
  assert.deepEqual(Object.keys(configs), ['Config1', 'Config2', 'Config3', 'Config4', 'Config5']);

  for (const [id, config] of Object.entries(configs)) {
    assert.equal(id, `Config${Object.keys(configs).indexOf(id) + 1}`);
    assert.ok(config.moveSpeed.min <= config.moveSpeed.max);
    assert.ok(config.progressSpeed.min <= config.progressSpeed.max);
    assert.ok(config.rotationSpeed.min <= config.rotationSpeed.max);
    assert.ok(config.elevation.min <= config.elevation.max);
    assert.ok(config.distance.min <= config.distance.max);
    assert.ok(Number.isFinite(config.targetHardness.start));
    assert.ok(Number.isFinite(config.targetHardness.end));
    assert.equal(config.targetHardness.start, 6);
    assert.equal(config.targetHardness.end, 2);
    assert.deepEqual(config.positionHardness, config.targetHardness);
  }
});

test('original camera parser tolerates case, whitespace, comments, and line endings', () => {
  const config = [
    'movespeedmin=1',
    'movespeedmax=20',
    'progressspeedmin=.05',
    'progressspeedmax=2e-1',
    'rotationspeedmin=1.570796',
    'rotationspeedmax=1.570796',
    'elevationmin=3',
    'elevationmax=500',
    'distancemin=10',
    'distancemax=300',
    'targethardnessmin=6',
    'targethardnessmax=2',
    'positionhardnessmin=6',
    'positionhardnessmax=2',
  ];
  const flexible = [
    '﻿; Original-compatible formatting',
    '  [ config3 ]  # camera profile',
    ...config.slice(0, 6).map((line, index) => index === 0 ? ` MOVEspeedMIN =1` : line),
    'rotation_speed_unused=x',
  ].join('\r\n');

  assert.throws(() => parseOriginalCameraIni(flexible), /not a finite number/);

  const valid = [
    `# first profile\r\n[CONFIG4]\r\n${config.join('\r\n')}`,
    '[config2]',
    ...config,
    '[Config3]',
    ...config,
    '[CONFIG5]',
    '  moveSpeedMin=1.0',
    'MoveSpeedMax=20.0',
    'progressspeedmin=.05',
    'progressspeedmax=2e-1',
    'RotationSpeedMin = 1.570796',
    'rotationspeedmax=1.570796 ; radians',
    'elevationmin=3',
    'ElevationMax=500',
    'distanceMin=10',
    'DISTANCEMAX=300',
    'targethardnessmin=6',
    'targethardnessmax=2',
    'positionhardnessmin=6',
    'PositionHardnessMax=2',
    'CustomZoom=0.25',
    '[config1]',
    ...config,
  ].join('\r\n');

  const configs = parseOriginalCameraIni(valid);
  assert.equal(configs.Config5.extraFields['customzoom'], 0.25);
  assert.deepEqual(configs.Config5.moveSpeed, { min: 1, max: 20 });
  assert.deepEqual(configs.Config5.progressSpeed, { min: 0.05, max: 0.2 });
  assert.throws(
    () => parseOriginalCameraIni(valid.replace('[CONFIG5]', '[Config2]')),
    /Duplicate original camera INI section \[Config2\]/,
  );
});

test('original camera parser validates sections, finite values, and ordered ranges', () => {
  const incomplete = '[Config2]\nMoveSpeedMin=1';
  assert.throws(() => parseOriginalCameraIni(incomplete), /missing section\(s\): Config1, Config3, Config4, Config5/);

  const outside = 'MoveSpeedMin=1';
  assert.throws(() => parseOriginalCameraIni(outside), /key outside a Config section/);

  const badSection = '[Config6]';
  assert.throws(() => parseOriginalCameraIni(badSection), /Unexpected original camera INI section \[Config6\]/);

  const duplicate = '[Config1]\nElevationMin=1\nElevationMin=2';
  assert.throws(() => parseOriginalCameraIni(duplicate), /Duplicate original camera INI key ElevationMin/);

  const reversed = '[Config1]\nMoveSpeedMin=20\nMoveSpeedMax=1\n[Config2]\n[Config3]\n[Config4]\n[Config5]';
  assert.throws(() => parseOriginalCameraIni(reversed), /Invalid original camera MoveSpeed range/);
});
