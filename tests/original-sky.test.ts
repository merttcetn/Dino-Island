import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseOriginalCloudIni,
  parseOriginalSky,
  resolveOriginalTextureUrl,
  parseOriginalState,
} from '../src/original-sky.ts';

const originalGame = new URL('../references/original/game/', import.meta.url);
const skyboxDirectory = new URL('../references/original/game/Data/Graphics/Textures/skybox/isl01/', import.meta.url);
const manifestPath = new URL('../public/assets/manifest.json', import.meta.url);

function readOriginal(path: string): string {
  return readFileSync(join(originalGame.pathname, path), 'utf8');
}

function originalSky() {
  return parseOriginalSky({
    island: 'isl01',
    faceFiles: readdirSync(skyboxDirectory.pathname),
    cloudIni: readOriginal('Data/Graphics/Textures/skybox/isl01/cloud.ini'),
    cloudIniPath: 'data\\graphics\\textures\\skybox\\isl01\\cloud.ini',
    readFile: readOriginal,
    skyboxState: readOriginal('Data/States/SkyBox.ini'),
    cloudState: readOriginal('Data/States/Dino_Clouds.ini'),
    manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, string>,
  });
}

test('original isl01 sky exposes all six exact face assets', () => {
  const sky = originalSky();
  const expectedOrder = ['back', 'bottom', 'front', 'left', 'right', 'top'];

  assert.deepEqual(sky.faceOrder, expectedOrder);
  assert.deepEqual(Object.keys(sky.faces), expectedOrder);
  for (const [face, texture] of Object.entries(sky.faces)) {
    assert.equal(texture.face, face);
    assert.equal(texture.basename, `${face}.PNG`);
    assert.equal(texture.texture, `data/graphics/textures/skybox/isl01/${face}.PNG`);
    assert.equal(texture.manifestKey, `data/graphics/textures/skybox/isl01/${face}.png`);
    assert.equal(texture.publicUrl, `/assets/Data/Graphics/Textures/skybox/isl01/${face}.png`);
  }
});

test('original cloud include resolves shared textures, scales, speeds, and state', () => {
  const sky = originalSky();

  assert.deepEqual(sky.clouds.includes, ['data/graphics/textures/skybox/cloudbase.ini']);
  assert.deepEqual(sky.clouds.layers, [
    {
      layer: 1,
      texture: 'data\\graphics\\textures\\skybox\\nuage01.tga',
      basename: 'nuage01.tga',
      scale: 4,
      speedX: 0.02,
      speedY: 0.002,
      manifestKey: 'data/graphics/textures/skybox/nuage01.tga',
      publicUrl: '/assets/Data/Graphics/Textures/skybox/nuage01.png',
    },
    {
      layer: 2,
      texture: 'data\\graphics\\textures\\skybox\\nuage02.tga',
      basename: 'nuage02.tga',
      scale: 16,
      speedX: 0.01,
      speedY: 0.001,
      manifestKey: 'data/graphics/textures/skybox/nuage02.tga',
      publicUrl: '/assets/Data/Graphics/Textures/skybox/nuage02.png',
    },
  ]);

  assert.equal(sky.clouds.state?.texture, true);
  assert.equal(sky.clouds.state?.zBuffer, true);
  assert.equal(sky.clouds.state?.zBufferWrite, true);
  assert.equal(sky.clouds.state?.alphaBlend, true);
  assert.equal(sky.clouds.state?.alphaBlendSrc, 'SrcAlpha');
  assert.equal(sky.clouds.state?.alphaBlendDest, 'InvSrcAlpha');
  assert.equal(sky.clouds.state?.alphaBlendOp, 'Add');
  assert.equal(sky.clouds.state?.fog, false);
  assert.equal(sky.clouds.state?.light, true);
  assert.deepEqual(sky.clouds.state?.textureStageOps, []);
  assert.deepEqual(sky.clouds.state?.includes, ['Misc.txt', 'Dino_CloudsTextureParam.txt', 'FogParam.txt']);

  const cloudTextureState = parseOriginalState(readOriginal('Data/States/Dino_CloudsTextureParam.txt'));
  assert.deepEqual(cloudTextureState.textureStageOps, ['SelectArg1', 'Add', 'Disable']);

  assert.equal(sky.skyboxState?.texture, true);
  assert.equal(sky.skyboxState?.zBuffer, false);
  assert.equal(sky.skyboxState?.zBufferWrite, false);
  assert.equal(sky.skyboxState?.alphaBlend, false);
  assert.equal(sky.skyboxState?.fog, false);
  assert.equal(sky.skyboxState?.light, false);
  assert.equal(sky.skyboxState?.cullMode, 'CCW');
  assert.equal(sky.skyboxState?.textureWrapU, 'Clamp');
  assert.equal(sky.skyboxState?.textureWrapV, 'Clamp');
  assert.deepEqual(sky.skyboxState?.textureStageOps, []);
  const skyboxTextureState = parseOriginalState(readOriginal('Data/States/TextureParam.txt'));
  assert.deepEqual(skyboxTextureState.textureStageOps, ['Modulate', 'Disable']);
});

test('cloud parser handles include order, case, whitespace, and comments', () => {
  const cloudIni = [
    '\ufeff  ; island override file',
    '[ #INCLUDE ]  // dependency declaration',
    ' FILE0 = ..\\cloudbase.ini ; shared graph',
  ].join('\r\n');
  const cloudbaseIni = [
    '# graph values use original spelling',
    '  [ GRAPH ]  ; one profile',
    'SCALE1="4" // foreground tiles',
    'scale2 = 16 # background tiles',
    'speed1x=.02; moving right',
    'SPEED1Y=2e-3',
    'speed2X=1e-2',
    'speed2y = .001',
    ' LAYER1 = "data\\graphics\\textures\\skybox\\nuage01.tga" ',
    'LAYER2="data\\graphics\\textures\\skybox\\nuage02.tga"',
  ].join('\r\n');

  const cloud = parseOriginalCloudIni(cloudIni, {
    sourcePath: 'data/graphics/textures/skybox/isl01/cloud.ini',
    readFile: path => {
      assert.equal(path, 'data/graphics/textures/skybox/cloudbase.ini');
      return cloudbaseIni;
    },
  });

  assert.deepEqual(cloud.layers.map(layer => layer.scale), [4, 16]);
  assert.deepEqual(cloud.layers.map(layer => [layer.speedX, layer.speedY]), [[0.02, 0.002], [0.01, 0.001]]);
  assert.deepEqual(cloud.layers.map(layer => layer.texture), [
    'data\\graphics\\textures\\skybox\\nuage01.tga',
    'data\\graphics\\textures\\skybox\\nuage02.tga',
  ]);
});

test('sky parser validates required faces and finite positive cloud values', () => {
  const faces = readdirSync(skyboxDirectory.pathname).filter(name => name !== 'top.PNG');
  assert.throws(() => parseOriginalSky({
    island: 'isl01',
    faceFiles: faces,
    cloudIni: readOriginal('Data/Graphics/Textures/skybox/isl01/cloud.ini'),
    cloudIniPath: 'Data/Graphics/Textures/skybox/isl01/cloud.ini',
    readFile: readOriginal,
  }), /missing faces: top/);

  const values = [
    '[GRAPH]', 'Scale1=0', 'Scale2=16', 'Speed1X=0.02', 'Speed1Y=0.002',
    'Speed2X=0.01', 'Speed2Y=0.001',
    'Layer1="data\\graphics\\textures\\skybox\\nuage01.tga"',
    'Layer2="data\\graphics\\textures\\skybox\\nuage02.tga"',
  ].join('\n');
  assert.throws(() => parseOriginalCloudIni(values, {
    sourcePath: 'data/graphics/textures/skybox/cloud.ini',
    readFile: () => '',
  }), /scale1 is not positive/);
});

test('manifest helper uses normalized keys and scoped basename fallback', () => {
  const manifest = {
    'data/graphics/textures/skybox/isl01/back.png': '/assets/back.png',
    'data/graphics/textures/skybox/shared/cloud.tga': '/assets/cloud.png',
  };

  assert.equal(resolveOriginalTextureUrl(
    manifest,
    'DATA\\Graphics\\Textures\\skybox\\isl01\\BACK.PNG',
    { basenameFallback: true, scope: 'data/graphics/textures/skybox/' },
  ), '/assets/back.png');
  assert.equal(resolveOriginalTextureUrl(
    manifest,
    'data/graphics/textures/skybox/other/cloud.tga',
    { basenameFallback: true, scope: 'data/graphics/textures/skybox/' },
  ), '/assets/cloud.png');
  assert.equal(resolveOriginalTextureUrl(manifest, 'missing/texture.tga'), undefined);
  assert.throws(() => resolveOriginalTextureUrl({
    'a/same.tga': '/a.png',
    'b/same.tga': '/b.png',
  }, 'c/same.tga', { basenameFallback: true }), /Ambiguous texture basename/);
});
