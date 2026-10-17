import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyOriginalCameraProfile } from '../src/original-camera-runtime.ts';
import { parseOriginalCameraIni, type OriginalCameraConfigs } from '../src/original-camera.ts';

const configs: OriginalCameraConfigs = parseOriginalCameraIni(readFileSync(
  new URL('../references/original/game/Data/Config/camera.ini', import.meta.url),
  'utf8',
));

function camera() {
  return {
    near: 1,
    far: 100,
    updateProjectionMatrix: () => {},
    position: { x: 0, y: 0, z: 0, clone: () => ({ x: 0, y: 0, z: 0 }) } as never,
  };
}

function controls() {
  return { target: { x: 0, y: 0, z: 0 } } as never;
}

test('camera runtime applies original Config1 distance and render-view depth', () => {
  const runtimeCamera = camera();
  const runtimeControls = controls();
  const config = applyOriginalCameraProfile(runtimeCamera, runtimeControls, configs);

  assert.deepEqual([runtimeCamera.near, runtimeCamera.far], [0.5, 2200]);
  assert.deepEqual([runtimeControls.minDistance, runtimeControls.maxDistance], [10, 300]);
  assert.deepEqual(config.distance, { min: 10, max: 300 });
});
