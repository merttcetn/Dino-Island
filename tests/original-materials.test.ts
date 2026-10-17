import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  mapOriginalStateToMaterial,
  mergeOriginalStateProfiles,
  parseOriginalStateIni,
} from '../src/original-materials.ts';

const statePath = (name: string) =>
  fileURLToPath(new URL(`../references/original/game/Data/States/${name}`, import.meta.url));

const readState = (name: string) => parseOriginalStateIni(readFileSync(statePath(name), 'utf8'));

const skinMaterial = {
  ambient: 0x112233,
  diffuse: 0x445566,
  specular: 0x778899,
  emissive: 0xaabbcc,
};

describe('original material/light state profiles', () => {
  it('parses the dino dual-texturing state without lighting and vertex-color diffuse', () => {
    const profile = readState('Dino_DualTexturing.ini');
    assert.deepEqual(profile.includes, ['misc.txt', 'dino_textureparamdual.txt', 'fogparam.txt']);
    assert.equal(profile.light, false);
    assert.equal(profile.colorVertex, true);
    assert.equal(profile.diffuseMatSource, 'color1');
    assert.equal(profile.specularMatSource, 'color2');
    assert.equal(profile.cullMode, 'both');
    assert.equal(profile.alphaTest, false);
    assert.equal(profile.fog, true);
  });

  it('maps dino dual texturing to double-sided, unlit, white diffuse material state', () => {
    const dino = readState('Dino_DualTexturing.ini');
    const merged = mergeOriginalStateProfiles(dino, readState('Dino_TextureParamDual.txt'));
    const mapping = mapOriginalStateToMaterial(merged, skinMaterial);
    assert.deepEqual(mapping, {
      side: 2, // THREE.DoubleSide
      opacity: 1,
      transparent: false,
      alphaTest: 0,
      depthWrite: true,
      diffuseColor: 0xffffffff,
      lit: false,
      dualTexture: true,
    });
  });

  it('parses the lit texture state and maps material diffuse with alpha cutout', () => {
    const profile = mergeOriginalStateProfiles(
      readState('Texture.ini'),
      readState('TextureParam.txt'),
    );
    assert.equal(profile.light, true);
    assert.equal(profile.normalizeNormals, true);
    assert.equal(profile.diffuseMatSource, 'material');
    assert.deepEqual(profile.textureStages[0] && {
      op: profile.textureStages[0].op,
      arg1: profile.textureStages[0].arg1,
      arg2: profile.textureStages[0].arg2,
    }, { op: 'modulate', arg1: 'texture', arg2: 'diffuse' });
    assert.equal(profile.textureStages.length, 1);
    const mapping = mapOriginalStateToMaterial(profile, skinMaterial);
    assert.equal(mapping.diffuseColor, 0x445566);
    assert.equal(mapping.lit, true);
    assert.equal(mapping.dualTexture, false);
  });

  it('converts LessEqual alpha tests to Three.js GreaterEqual cutouts', () => {
    const profile = readState('TextureLighted.ini');
    assert.equal(profile.alphaTest, true);
    assert.equal(profile.alphaTestRef, 1);
    assert.equal(profile.alphaTestFunc, 'greaterequal');
    const mapping = mapOriginalStateToMaterial(profile, skinMaterial);
    assert.ok(Math.abs(mapping.alphaTest - 1 / 255) < 1e-9);

    const reversed = { ...profile, alphaTestFunc: 'lessequal' } as typeof profile;
    assert.ok(
      Math.abs(mapOriginalStateToMaterial(reversed, skinMaterial).alphaTest - (1 - 1 / 255)) < 1e-9,
    );
  });

  it('extracts the shared fog parameters from FogParam.txt', () => {
    const fog = readState('FogParam.txt');
    assert.equal(fog.fog, true);
    assert.equal(fog.fogStart, 1500);
    assert.equal(fog.fogEnd, 2000);
    assert.deepEqual(fog.fogColor, [255, 220, 165]);
  });

  it('merges includes in parent-then-include order and keeps track of include chains', () => {
    const dino = readState('Dino_DualTexturing.ini');
    const misc = readState('Misc.txt');
    const texture = readState('Dino_TextureParamDual.txt');
    const fog = readState('FogParam.txt');
    const merged = mergeOriginalStateProfiles(dino, misc, texture, fog);
    assert.deepEqual(merged.textureStages.map(stage => stage.stage), [0, 1]);
    assert.equal(merged.textureStages[0]?.op, 'modulate');
    assert.deepEqual(merged.textureStages[1] && {
      op: 'blendtexturealpha',
      alphaOp: 'selectarg2',
    op: merged.textureStages[1]?.op,
    alphaOp: merged.textureStages[1]?.alphaOp,
    }, { op: 'blendtexturealpha', alphaOp: 'selectarg2' });
    assert.equal(merged.fogStart, 1500);
    for (const include of ['misc.txt', 'dino_textureparamdual.txt', 'fogparam.txt']) {
      assert.ok(merged.includes.includes(include), include);
    }
    assert.equal(mapOriginalStateToMaterial(merged, skinMaterial).dualTexture, true);
  });
});
