import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import {
  animateOriginalModel,
  deformOriginalSkin,
  loadOriginalModel,
  parseOriginalAnimation,
  parseOriginalMesh,
  parseOriginalSkeleton,
  parseOriginalSkin,
} from '../src/original-models.ts';

const graphics = new URL('../references/original/game/Data/Graphics/', import.meta.url);
const publicData = new URL('../public/original/Data/', import.meta.url);

function meshBuffer(path: string) {
  const buffer = readFileSync(new URL(path, graphics));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function publicBuffer(path: string) {
  const buffer = readFileSync(new URL(path, publicData));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

class BinaryWriter {
  private readonly bytes: number[] = [];
  readonly offsets = new Map<string, number>();

  u8(value: number) { this.bytes.push(value & 255); }
  u32(value: number) { this.bytes.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255); }
  u64(value: bigint) {
    this.u32(Number(value & 0xffffffffn));
    this.u32(Number(value >> 32n));
  }
  string(value: string) {
    const encoded = Buffer.from(value + '\0', 'latin1');
    this.u32(encoded.length);
    this.bytes.push(...encoded);
  }
  mark(key: string) { this.offsets.set(key, this.bytes.length); }
  buffer() { return Uint8Array.from(this.bytes).buffer; }
}

function identityAnimation(times: readonly number[], durationTicks: bigint) {
  const writer = new BinaryWriter();
  writer.u8(1);
  writer.u32(3);
  writer.u32(0x1234);
  writer.u32(0xdef01234);
  writer.u64(durationTicks);
  writer.u32(1);
  writer.string('Bip01');
  writer.u32(times.length);
  writer.mark('firstTime');
  times.forEach(time => writer.u64(BigInt(time)));
  writer.u32(times.length);
  for (const time of times) {
    const matrix = new THREE.Matrix4().makeTranslation(time / 4800, -time / 2400, 2);
    for (const value of matrix.toArray()) writer.u32(new Uint32Array(new Float32Array([value]).buffer)[0]!);
  }
  return { buffer: writer.buffer(), firstTimeOffset: writer.offsets.get('firstTime')! };
}

test('original dinosaur mesh keeps its original geometry, skin coordinates, and material', () => {
  const parsed = parseOriginalMesh(meshBuffer('Actors/Dinos/trex/trex_lod1.mesh'));
  assert.equal(parsed.version, 3);
  assert.equal(parsed.meshes.length, 1);
  const mesh = parsed.meshes[0];
  assert.equal(mesh.name, 'dino_lod1');
  assert.equal(mesh.positions.length / 3, 317);
  assert.equal(mesh.indices.length / 3, 382);
  assert.equal(mesh.uv.length / 2, 317);
  assert.equal(mesh.normals.length / 3, 317);
  assert.equal(mesh.colors.length, 317);
  assert.equal(mesh.materials[0].texture, 'trex.tga');
  assert.ok(Math.abs(Math.max(...mesh.positions.filter((_, i) => i % 3 === 2)) - 5.0730157) < 0.00001);
});

test('all supplied original static meshes parse completely, including multiple materials and parts', () => {
  function files(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? files(path) : entry.name.endsWith('.mesh') ? [path] : [];
    });
  }
  const paths = files(graphics.pathname);
  assert.ok(paths.length >= 500);
  for (const path of paths) {
    const buffer = readFileSync(path);
    const parsed = parseOriginalMesh(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    assert.ok(parsed.meshes.length > 0, path);
  }
});

test('rejects malformed and truncated original mesh data', () => {
  const original = meshBuffer('Actors/Dinos/trex/trex_lod1.mesh');
  assert.throws(() => parseOriginalMesh(original.slice(0, 500)), /Truncated/);
  const wrongMagic = original.slice(0);
  new DataView(wrongMagic).setUint32(9, 0, true);
  assert.throws(() => parseOriginalMesh(wrongMagic), /Unsupported/);
  const invalidIndex = original.slice(0);
  new DataView(invalidIndex).setUint32(3843, 317, true);
  assert.throws(() => parseOriginalMesh(invalidIndex), /out-of-range/);
});

test('original skeleton restores dinosaur dummy positions in meters', () => {
  const bones = parseOriginalSkeleton(meshBuffer('Actors/Dinos/stego/stego.skel'));
  assert.equal(bones.length, 80);
  const highBack = bones.find(bone => bone.name === 'Dum_doshaut')!;
  assert.ok(highBack);
  assert.ok(Math.abs(highBack.world.elements[12]) < 0.001);
  assert.ok(Math.abs(highBack.world.elements[13] - -1.14) < 0.01);
  assert.ok(Math.abs(highBack.world.elements[14] - 2.84) < 0.01);
  for (const species of ['trex', 'stego', 'trice', 'brachio']) {
    assert.equal(parseOriginalSkeleton(meshBuffer(`Actors/Dinos/${species}/${species}.skel`)).length, 80);
  }
});

test('original dinosaur skins cover every vertex once and reference skeleton bones', () => {
  for (const species of ['trex', 'stego', 'trice', 'brachio']) {
    const skin = parseOriginalSkin(publicBuffer(`Graphics/Actors/Dinos/${species}/${species}_lod1.skin`));
    const bones = parseOriginalSkeleton(publicBuffer(`Graphics/Actors/Dinos/${species}/${species}.skel`));
    const part = skin.meshes.find(mesh => mesh.bindings?.length);
    assert.ok(part?.bindings, `${species} has no weighted skin`);
    assert.equal(skin.meshes.length, 36);
    assert.equal(part.positions.length / 3, 317);

    const sums = new Float64Array(part.positions.length / 3);
    const boneNames = new Set(bones.map(bone => bone.name));
    for (const binding of part.bindings) {
      assert.ok(boneNames.has(binding.name), `${species} skin refers to unknown bone ${binding.name}`);
      assert.equal(binding.indices.length, binding.weights.length);
      for (let i = 0; i < binding.indices.length; i++) sums[binding.indices[i]!] += binding.weights[i]!;
    }
    assert.equal(sums.length, 317);
    for (let vertex = 0; vertex < sums.length; vertex++) {
      assert.ok(Math.abs(sums[vertex]! - 1) < 1e-6, `${species} vertex ${vertex} weights sum to ${sums[vertex]}`);
    }
  }
});

test('deform restores the bind pose and rejects missing skin bones', () => {
  const part = parseOriginalSkin(publicBuffer('Graphics/Actors/Dinos/trex/trex_lod1.skin'))
    .meshes.find(mesh => mesh.bindings?.length)!;
  const bones = part.bindings!.map(binding => ({
    name: binding.name,
    parent: -1,
    children: [],
    // world * inverseBind is identity in each bone's original bind pose.
    local: binding.inverseBind.clone().invert(),
    world: binding.inverseBind.clone().invert(),
    flag: 0,
  }));
  const deformed = deformOriginalSkin(part, bones);

  assert.equal(deformed.positions.length, part.positions.length);
  assert.deepEqual(Array.from(deformed.positions), Array.from(part.positions));
  // These original skin normal streams are zero; normalization deliberately leaves them zero.
  assert.deepEqual(Array.from(deformed.normals), Array.from(part.normals));
  assert.throws(() => deformOriginalSkin(part, []), /missing skin bone/);
});

test('original animation ticks convert to seconds with monotonic key timing', () => {
  const families = ['HeavyBiped', 'LightQuadruped', 'LowQuadruped', 'HighQuadruped'];
  for (const family of families) {
    for (const action of ['Neutral', 'Walk'] as const) {
      const buffer = publicBuffer(`Graphics/Actors/Dinos/animations/${family}/${family}_${action}.anim`);
      assert.equal(new DataView(buffer).getBigUint64(13, true), 4800n);
      const animation = parseOriginalAnimation(buffer);
      assert.equal(animation.duration, 1);
      assert.equal(animation.tracks.length, 35);
      assert.equal(new Set(animation.tracks.map(track => track.name)).size, 35);
      for (const track of animation.tracks) {
        assert.equal(track.keys.length, 31);
        for (let i = 0; i < track.keys.length; i++) {
          const key = track.keys[i]!;
          assert.ok(Number.isFinite(key.time));
          if (i > 0) assert.ok(key.time >= track.keys[i - 1]!.time);
          assert.ok(key.position.toArray().every(Number.isFinite));
          assert.ok(key.quaternion.toArray().every(Number.isFinite));
          assert.ok(key.scale.toArray().every(Number.isFinite));
        }
        assert.equal(track.keys[0]!.time, 0);
        assert.equal(track.keys.at(-1)!.time, animation.duration);
      }
    }
  }

  const synthetic = identityAnimation([0, 4800, 9600], 9600n);
  const parsed = parseOriginalAnimation(synthetic.buffer);
  assert.equal(parsed.duration, 2);
  assert.deepEqual(parsed.tracks[0]!.keys.map(key => key.time), [0, 1, 2]);
  assert.deepEqual(parsed.tracks[0]!.keys[1]!.position.toArray().slice(0, 3), [1, -2, 2]);

  const decreasing = synthetic.buffer.slice(0);
  new DataView(decreasing).setUint32(synthetic.firstTimeOffset, 9600, true);
  assert.throws(() => parseOriginalAnimation(decreasing), /not sorted/);
  assert.throws(() => parseOriginalAnimation(synthetic.buffer.slice(0, -1)), /Truncated/);
});

test('animation tracks expose the skeleton dummy bones used by original attachments', () => {
  const cases = [
    { species: 'trex', family: 'HeavyBiped', attachment: 'Dum_tete' },
    { species: 'stego', family: 'LightQuadruped', attachment: 'Dum_doshaut' },
    { species: 'trice', family: 'LowQuadruped', attachment: 'Dum_doshaut' },
    { species: 'brachio', family: 'HighQuadruped', attachment: 'Dum_doshaut' },
  ] as const;
  for (const { species, family, attachment } of cases) {
    const boneNames = new Set(parseOriginalSkeleton(
      publicBuffer(`Graphics/Actors/Dinos/${species}/${species}.skel`),
    ).map(bone => bone.name));
    assert.ok(boneNames.has(attachment), `${species} lacks attachment dummy ${attachment}`);
    for (const action of ['Neutral', 'Walk'] as const) {
      const animation = parseOriginalAnimation(
        publicBuffer(`Graphics/Actors/Dinos/animations/${family}/${family}_${action}.anim`),
      );
      // Animation files carry the biped rig; dummy attachment bones retain their
      // skeleton rest transforms and are then moved with those animated parents.
      for (const track of animation.tracks) {
        assert.ok(boneNames.has(track.name), `${family} track ${track.name} is absent from ${species}`);
      }
      const animatedAttachmentParent = animation.tracks.find(candidate =>
        attachment === 'Dum_tete' ? candidate.name === 'Bip01_Head' : candidate.name === 'Bip01_Spine3');
      assert.ok(animatedAttachmentParent?.keys.length, `${family} ${action} lacks the attachment parent`);
    }
  }
});

test('animateOriginalModel rejects invalid or unprepared public models', async t => {
  const messages: unknown[][] = [];
  t.mock.method(console, 'warn', (...args: unknown[]) => messages.push(args));
  const plain = new THREE.Group();
  assert.equal(animateOriginalModel(plain, 0), false);
  assert.equal(plain.userData.originalAnimationStatus, undefined);

  plain.userData.originalAnimationKey = 'not-prepared';
  assert.equal(animateOriginalModel(plain, 0), false);
  assert.equal(plain.userData.originalAnimationStatus, undefined);
  plain.userData.originalAnimationKey = undefined;

  const preparedMarker = new THREE.Group();
  preparedMarker.userData.originalAnimationKey = 'also-not-prepared';
  assert.equal(animateOriginalModel(preparedMarker, Number.NaN), false);
  assert.equal(messages.length, 0);
});

test('animated clones own independent deformation buffers, bones, and attachments', async t => {
  // The loader is browser-oriented, so this fixture provides its local public/
  // assets through an in-memory response. Every original byte is read with fs.
  const manifest = {
    'data/graphics/actors/dinos/trex/trex_lod1.mesh': 'test:trex.mesh',
    'data/graphics/actors/dinos/trex/trex_lod1.skin': 'test:trex.skin',
    'data/graphics/actors/dinos/trex/trex.skel': 'test:trex.skel',
    'data/graphics/actors/dinos/animations/heavybiped/heavybiped_neutral.anim': 'test:neutral',
    'data/graphics/actors/dinos/animations/heavybiped/heavybiped_walk.anim': 'test:walk',
  };
  const resources = new Map<string, ArrayBuffer>(Object.entries({
    'test:trex.mesh': publicBuffer('Graphics/Actors/Dinos/trex/trex_lod1.mesh'),
    'test:trex.skin': publicBuffer('Graphics/Actors/Dinos/trex/trex_lod1.skin'),
    'test:trex.skel': publicBuffer('Graphics/Actors/Dinos/trex/trex.skel'),
    'test:neutral': publicBuffer('Graphics/Actors/Dinos/animations/HeavyBiped/HeavyBiped_Neutral.anim'),
    'test:walk': publicBuffer('Graphics/Actors/Dinos/animations/HeavyBiped/HeavyBiped_Walk.anim'),
  }));
  const previousFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async input => {
    const url = String(input);
    if (url === '/assets/manifest.json') {
      return { ok: true, json: async () => manifest } as Response;
    }
    const bytes = resources.get(url);
    if (!bytes) throw new Error(`Unexpected test fetch: ${url}`);
    return { ok: true, arrayBuffer: async () => bytes } as Response;
  });
  t.after(() => { Object.defineProperty(globalThis, 'fetch', { value: previousFetch, configurable: true, writable: true }); });

  const first = await loadOriginalModel('Data/Graphics/Actors/Dinos/trex/trex_lod1.mesh', {
    adornments: false,
    castShadow: false,
    receiveShadow: false,
  });
  const meshOf = (model: THREE.Object3D) => model.children.find(child => child instanceof THREE.Mesh) as THREE.Mesh;
  const firstMesh = meshOf(first);
  const firstMaterial = Array.isArray(firstMesh.material) ? firstMesh.material[0] : firstMesh.material;
  assert.ok(firstMaterial instanceof THREE.MeshBasicMaterial);
  assert.equal(firstMaterial.vertexColors, true);
  assert.equal(firstMaterial.alphaTest, 0);
  assert.equal(firstMaterial.side, THREE.DoubleSide);
  assert.equal(firstMaterial.userData.originalRenderState, 'Dino_DualTexturing.ini');
  const second = first.clone(true);
  const secondMesh = meshOf(second);
  const wrapper = new THREE.Group();
  wrapper.add(second);
  assert.equal(first.userData.originalAnimationFamily, 'HeavyBiped');

  function attachmentFor(model: THREE.Object3D) {
    const object = new THREE.Object3D();
    object.name = 'Dum_doshaut';
    object.userData.originalAdornment = 'test-attachment';
    object.position.set(999, 888, 777);
    model.add(object);
    return object;
  }
  const firstAttachment = attachmentFor(first);
  const secondAttachment = attachmentFor(second);
  const stateOf = (model: THREE.Object3D, attachment: THREE.Object3D) => {
    const position = (meshOf(model).geometry.getAttribute('position') as THREE.BufferAttribute).array.slice();
    const normal = (meshOf(model).geometry.getAttribute('normal') as THREE.BufferAttribute).array.slice();
    return { position, normal, positionCopy: attachment.position.clone(), quaternionCopy: attachment.quaternion.clone() };
  };

  assert.equal(animateOriginalModel(first, 0.1, 'walk'), true);
  assert.equal(animateOriginalModel(wrapper, 0.6, 'walk'), true);
  const firstEarly = stateOf(first, firstAttachment);
  const secondLate = stateOf(second, secondAttachment);
  assert.notDeepEqual(Array.from(firstEarly.position), Array.from(secondLate.position));
  assert.ok(firstMesh !== secondMesh);
  assert.ok(firstMesh.geometry !== secondMesh.geometry);
  assert.ok(firstMesh.geometry.getAttribute('position') !== secondMesh.geometry.getAttribute('position'));

  assert.equal(animateOriginalModel(first, 0.6, 'walk'), true);
  const firstLate = stateOf(first, firstAttachment);
  assert.deepEqual(Array.from(firstLate.position), Array.from(secondLate.position));
  assert.deepEqual(Array.from(firstLate.normal), Array.from(secondLate.normal));
  assert.ok(firstLate.positionCopy.equals(secondLate.positionCopy));
  assert.ok(firstLate.quaternionCopy.equals(secondLate.quaternionCopy));

  assert.equal(animateOriginalModel(wrapper, 0.1, 'walk'), true);
  const secondEarly = stateOf(second, secondAttachment);
  assert.deepEqual(Array.from(secondEarly.position), Array.from(firstEarly.position));
  assert.ok(secondEarly.positionCopy.equals(firstEarly.positionCopy));
  assert.equal(first.userData.originalAnimationAction, 'walk');
  assert.equal(second.userData.originalAnimationAction, 'walk');
});
