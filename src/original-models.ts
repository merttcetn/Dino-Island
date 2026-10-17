import * as THREE from 'three';

/** Decoded original data. Positions and normals retain the game's Z-up coordinates. */
export interface OriginalMeshPart {
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
  uv: Float32Array;
  normals: Float32Array;
  colors: Uint32Array;
  materials: OriginalMaterial[];
  faceMaterials: Uint16Array;
  bindings?: OriginalSkinBinding[];
}

export interface OriginalSkinBinding {
  name: string;
  indices: Uint32Array;
  weights: Float32Array;
  inverseBind: THREE.Matrix4;
}

export interface OriginalMaterial {
  name: string;
  texture: string;
  ambient: number;
  diffuse: number;
  specular: number;
  emissive: number;
  power: number;
  flag: number;
}

export interface OriginalMeshData {
  version: number;
  checksum: number;
  meshes: OriginalMeshPart[];
}

class MeshReader {
  private view: DataView;
  readonly buffer: ArrayBuffer;
  offset = 0;
  constructor(buffer: ArrayBuffer) { this.buffer = buffer; this.view = new DataView(buffer); }
  require(bytes: number) {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || this.offset + bytes > this.buffer.byteLength) {
      throw new Error(`Truncated original mesh at byte ${this.offset} (needs ${bytes} bytes)`);
    }
  }
  u8() { this.require(1); return this.view.getUint8(this.offset++); }
  u16() { this.require(2); const value = this.view.getUint16(this.offset, true); this.offset += 2; return value; }
  u32() { this.require(4); const value = this.view.getUint32(this.offset, true); this.offset += 4; return value; }
  u64() { const low = this.u32(), high = this.u32(); return low + high * 0x100000000; }
  f32() { this.require(4); const value = this.view.getFloat32(this.offset, true); this.offset += 4; return value; }
  string() {
    const length = this.u32();
    this.require(length);
    const value = new TextDecoder('windows-1252').decode(new Uint8Array(this.buffer, this.offset, length));
    this.offset += length;
    return value.replace(/\0+$/, '');
  }
  floats(count: number) {
    this.require(count * 4);
    const values = new Float32Array(count);
    for (let i = 0; i < count; i++) values[i] = this.f32();
    return values;
  }
  stream(components: number, colors = false) {
    const enabled = this.u8();
    const count = this.u32();
    if (enabled > 1 || (!enabled && count !== 0)) throw new Error(`Invalid original mesh stream at ${this.offset - 5}`);
    this.require(count * components * 4);
    if (colors) {
      const values = new Uint32Array(count);
      for (let i = 0; i < count; i++) values[i] = this.u32();
      return values;
    }
    return this.floats(count * components);
  }
}

function parseMeshFile(buffer: ArrayBuffer, skin: boolean): OriginalMeshData {
  const reader = new MeshReader(buffer);
  if (reader.u8() !== 1) throw new Error('Unsupported original mesh presence marker');
  const version = reader.u32();
  const checksum = reader.u32();
  if (version !== 3 || reader.u32() !== (skin ? 0x02468ace : 0x12345678)) throw new Error('Unsupported original mesh format');
  const meshCount = reader.u32();
  if (meshCount > 4096) throw new Error('Invalid original mesh part count');
  const meshes: OriginalMeshPart[] = [];
  for (let meshIndex = 0; meshIndex < meshCount; meshIndex++) {
    const name = reader.string();
    const vertexCount = reader.u32();
    const positions = reader.floats(vertexCount * 3);
    const indexCount = reader.u32();
    if (indexCount % 3) throw new Error(`Original mesh ${name} has incomplete triangles`);
    reader.require(indexCount * 4);
    const indices = new Uint32Array(indexCount);
    for (let i = 0; i < indexCount; i++) {
      indices[i] = reader.u32();
      if (indices[i] >= vertexCount) throw new Error(`Original mesh ${name} has an out-of-range vertex index`);
    }
    const uv = reader.stream(2) as Float32Array;
    const normals = reader.stream(3) as Float32Array;
    const colors = reader.stream(1, true) as Uint32Array;
    if (uv.length && uv.length !== vertexCount * 2) throw new Error(`Original mesh ${name} has invalid UV count`);
    if (normals.length && normals.length !== vertexCount * 3) throw new Error(`Original mesh ${name} has invalid normal count`);
    if (colors.length && colors.length !== vertexCount) throw new Error(`Original mesh ${name} has invalid color count`);
    const materialCount = reader.u32();
    if (materialCount > 4096) throw new Error('Invalid original mesh material count');
    const materials: OriginalMaterial[] = [];
    for (let i = 0; i < materialCount; i++) {
      const ambient = reader.u32(), diffuse = reader.u32(), power = reader.f32();
      const specular = reader.u32(), emissive = reader.u32(), flag = reader.u8();
      const texture = reader.string();
      materials.push({ ambient, diffuse, power, specular, emissive, flag, texture, name: reader.string() });
    }
    const faceCount = reader.u32();
    if (faceCount !== indexCount / 3) throw new Error(`Original mesh ${name} has invalid face material count`);
    reader.require(faceCount * 2 + 16);
    const faceMaterials = new Uint16Array(faceCount);
    for (let i = 0; i < faceCount; i++) {
      faceMaterials[i] = reader.u16();
      if (faceMaterials[i] >= materialCount) throw new Error(`Original mesh ${name} has an invalid material index`);
    }
    const hasSkin = reader.u32();
    reader.u32(); // Parent/helper link, -1 for a skinned render mesh.
    const boneCount = reader.u32();
    const bindingCount = reader.u32();
    const bindings: OriginalSkinBinding[] = [];
    if (skin && hasSkin) {
      if (boneCount !== bindingCount || bindingCount > 4096) throw new Error('Invalid original skin binding count');
      for (let i = 0; i < bindingCount; i++) {
        const boneName = reader.string(), count = reader.u32();
        reader.require(count * 4);
        const vertexIndices = new Uint32Array(count);
        for (let j = 0; j < count; j++) {
          vertexIndices[j] = reader.u32();
          if (vertexIndices[j] >= vertexCount) throw new Error('Original skin has an invalid vertex index');
        }
        if (reader.u32() !== count) throw new Error('Original skin index/weight count mismatch');
        const weights = reader.floats(count);
        const inverseBind = new THREE.Matrix4().fromArray(reader.floats(16));
        bindings.push({ name: boneName, indices: vertexIndices, weights, inverseBind });
      }
    } else if (hasSkin || boneCount || bindingCount) {
      throw new Error('Unexpected original mesh skin metadata');
    }
    meshes.push({ name, positions, indices, uv, normals, colors, materials, faceMaterials,
      ...(bindings.length ? { bindings } : {}) });
  }
  if (reader.offset !== buffer.byteLength) throw new Error(`Unexpected original mesh bytes at ${reader.offset}`);
  return { version, checksum, meshes };
}

/** Read Monte Cristo's version 3 static meshes. Does not execute original game code. */
export function parseOriginalMesh(buffer: ArrayBuffer): OriginalMeshData { return parseMeshFile(buffer, false); }

/** Read original helper meshes, centimeter-space render meshes, and bone weights. */
export function parseOriginalSkin(buffer: ArrayBuffer): OriginalMeshData { return parseMeshFile(buffer, true); }

export interface OriginalAnimationKey {
  time: number;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}
export interface OriginalAnimationTrack {
  name: string;
  keys: OriginalAnimationKey[];
}
export interface OriginalAnimation {
  /** Seconds. Original 3ds Max timing uses 4800 ticks per second. */
  duration: number;
  tracks: OriginalAnimationTrack[];
}

export function parseOriginalAnimation(buffer: ArrayBuffer): OriginalAnimation {
  const reader = new MeshReader(buffer);
  if (reader.u8() !== 1 || reader.u32() !== 3) throw new Error('Unsupported original animation version');
  reader.u32();
  if (reader.u32() !== 0xdef01234) throw new Error('Unsupported original animation format');
  const duration = reader.u64() / 4800, count = reader.u32();
  if (!(duration > 0) || count > 4096) throw new Error('Invalid original animation header');
  const tracks: OriginalAnimationTrack[] = [];
  for (let trackIndex = 0; trackIndex < count; trackIndex++) {
    const name = reader.string(), keyCount = reader.u32();
    reader.require(keyCount * 8);
    const times = Array.from({ length: keyCount }, () => reader.u64() / 4800);
    if (reader.u32() !== keyCount) throw new Error('Original animation key/matrix count mismatch');
    const keys: OriginalAnimationKey[] = [];
    for (let i = 0; i < keyCount; i++) {
      if (i > 0 && times[i] < times[i - 1]) throw new Error('Original animation key times are not sorted');
      const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
      new THREE.Matrix4().fromArray(reader.floats(16)).decompose(position, quaternion, scale);
      if (![...position, ...quaternion, ...scale].every(Number.isFinite)) throw new Error('Original animation has invalid transforms');
      keys.push({ time: times[i], position, quaternion: quaternion.normalize(), scale });
    }
    if (!keys.length) throw new Error('Original animation has an empty track');
    tracks.push({ name, keys });
  }
  if (reader.offset !== buffer.byteLength) throw new Error(`Unexpected original animation bytes at ${reader.offset}`);
  return { duration, tracks };
}

export interface OriginalBone {
  name: string;
  parent: number;
  children: number[];
  local: THREE.Matrix4;
  world: THREE.Matrix4;
  flag: number;
}

/** Original skeleton matrices include a 0.01 root scale converting centimeters to meters. */
export function parseOriginalSkeleton(buffer: ArrayBuffer): OriginalBone[] {
  const reader = new MeshReader(buffer);
  if (reader.u8() !== 1 || reader.u32() !== 3) throw new Error('Unsupported original skeleton version');
  reader.u32();
  if (reader.u32() !== 0x56789abc) throw new Error('Unsupported original skeleton format');
  const count = reader.u32();
  if (count > 4096) throw new Error('Invalid original skeleton bone count');
  const bones: OriginalBone[] = [];
  for (let i = 0; i < count; i++) {
    bones.push({ name: '', parent: -1, children: [], local: new THREE.Matrix4().fromArray(reader.floats(16)),
      world: new THREE.Matrix4(), flag: 0 });
  }
  const checkCount = () => {
    if (reader.u32() !== count) throw new Error('Original skeleton stream count mismatch');
  };
  checkCount();
  for (const bone of bones) {
    const childCount = reader.u32();
    reader.require(childCount * 4);
    for (let i = 0; i < childCount; i++) {
      const child = reader.u32();
      if (child >= count) throw new Error('Original skeleton has invalid child index');
      bone.children.push(child);
    }
  }
  checkCount();
  for (let i = 0; i < count; i++) {
    const parent = reader.u32();
    bones[i].parent = parent === 0xffffffff ? -1 : parent;
    if (bones[i].parent >= i) throw new Error('Original skeleton parents must precede their children');
    bones[i].world.copy(bones[i].local);
    if (bones[i].parent >= 0) bones[i].world.premultiply(bones[bones[i].parent].world);
  }
  checkCount();
  for (const bone of bones) bone.name = reader.string();
  checkCount();
  for (const bone of bones) bone.flag = reader.u32();
  if (reader.offset !== buffer.byteLength) throw new Error('Unexpected original skeleton bytes');
  return bones;
}

type AssetManifest = Record<string, string>;
let manifestPromise: Promise<AssetManifest> | undefined;
const modelCache = new Map<string, Promise<THREE.Group>>();
const textureCache = new Map<string, Promise<THREE.Texture>>();
const textureLoader = new THREE.TextureLoader();

function normalizePath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\/?original\//i, '').replace(/^\/+/, '').toLowerCase();
}

async function assetManifest() {
  manifestPromise ??= fetch('/assets/manifest.json').then(response => {
    if (!response.ok) throw new Error(`Original asset manifest: HTTP ${response.status}`);
    return response.json() as Promise<AssetManifest>;
  });
  return manifestPromise;
}

function textureUrl(manifest: AssetManifest, modelPath: string, filename: string): string | undefined {
  const normalized = normalizePath(filename);
  if (!normalized) return undefined;
  if (manifest[normalized]) return manifest[normalized];
  const basename = normalized.split('/').at(-1)!;
  const textureRoot = 'data/graphics/textures/';
  const relativeModel = normalizePath(modelPath).replace(/^data\/graphics\//, '');
  const category = relativeModel.split('/')[0];
  const candidates = Object.keys(manifest).filter(key => key.startsWith(textureRoot) && key.split('/').at(-1) === basename);
  candidates.sort((a, b) => {
    // Buildings/paddock have a few duplicated basenames; prefer the model's category.
    const score = (candidate: string) => candidate.startsWith(textureRoot + category + '/') ? 1 : 0;
    return score(b) - score(a) || a.localeCompare(b);
  });
  return candidates[0] ? manifest[candidates[0]] : undefined;
}

async function originalTexture(url: string) {
  let pending = textureCache.get(url);
  if (!pending) {
    pending = textureLoader.loadAsync(url).then(texture => {
      texture.name = url;
      texture.colorSpace = THREE.SRGBColorSpace;
      // Original D3D UVs use top-left origin and often contain negative repeating V.
      texture.flipY = false;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.anisotropy = 4;
      return texture;
    });
    textureCache.set(url, pending);
  }
  return pending;
}

function originalColor(argb: number) {
  return new THREE.Color().setRGB(((argb >>> 16) & 255) / 255, ((argb >>> 8) & 255) / 255,
    (argb & 255) / 255, THREE.SRGBColorSpace);
}

export interface OriginalModelOptions {
  /** Native models use meters. Optional uniform scale is applied after Z-up conversion. */
  scale?: number;
  /** Original baked vertex colors include the dinosaur's original coloration. */
  vertexColors?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Restore original horns, frills and dorsal plates from genotype/skeleton data. */
  adornments?: boolean;
  /** Prepare original .skin/.anim data for animateOriginalModel. Defaults to true. */
  animation?: boolean;
}

async function buildOriginalModel(path: string, vertexColors: boolean, adornments: boolean, animation: boolean): Promise<THREE.Group> {
  const manifest = await assetManifest();
  const normalized = normalizePath(path);
  const url = manifest[normalized] ?? (path.startsWith('/') ? path : '/original/' + path);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Original model ${path}: HTTP ${response.status}`);
  const data = parseOriginalMesh(await response.arrayBuffer());
  const group = new THREE.Group();
  group.name = path.split('/').at(-1) ?? path;
  group.userData.originalPath = path;
  group.userData.originalMesh = true;
  group.rotation.x = -Math.PI / 2;
  // Actor bodies use Dino_DualTexturing.ini: unlit vertex-color/texture
  // modulation, no alpha test, and fog. The second genotype-dependent texture
  // still needs the original loader semantics before we can claim full parity.
  const isDinosaurBody = /\/actors\/dinos\/([^/]+)\/\1_lod[123]\.mesh$/i.test(normalized);
  for (const part of data.meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
    if (part.uv.length) geometry.setAttribute('uv', new THREE.BufferAttribute(part.uv, 2));
    if (part.normals.length) geometry.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3));
    else geometry.computeVertexNormals();
    if (vertexColors && part.colors.length) {
      const colors = new Float32Array(part.colors.length * 3);
      for (let i = 0; i < part.colors.length; i++) originalColor(part.colors[i]).toArray(colors, i * 3);
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    const materials = await Promise.all(part.materials.map(async source => {
      const url = textureUrl(manifest, path, source.texture);
      const material = isDinosaurBody ? new THREE.MeshBasicMaterial({
        name: source.name,
        color: 0xffffff,
        map: url ? await originalTexture(url) : null,
        vertexColors: !!geometry.getAttribute('color'),
        side: THREE.DoubleSide,
      }) : new THREE.MeshLambertMaterial({
        name: source.name,
        color: originalColor(source.diffuse),
        map: url ? await originalTexture(url) : null,
        vertexColors: !!geometry.getAttribute('color'),
        side: THREE.DoubleSide,
        alphaTest: 0.45,
      });
      material.userData.originalRenderState = isDinosaurBody ? 'Dino_DualTexturing.ini' : undefined;
      material.userData.originalTexture = source.texture;
      return material;
    }));
    let start = 0;
    for (let face = 1; face <= part.faceMaterials.length; face++) {
      if (face === part.faceMaterials.length || part.faceMaterials[face] !== part.faceMaterials[start]) {
        geometry.addGroup(start * 3, (face - start) * 3, part.faceMaterials[start]);
        start = face;
      }
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.name = part.name;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.originalPath = path;
    group.add(mesh);
  }
  if (adornments && /\/actors\/dinos\/([^/]+)\/\1_lod[123]\.mesh$/i.test(normalized)) {
    await attachOriginalAdornments(group, path, manifest);
  }
  if (animation && /\/actors\/dinos\/([^/]+)\/\1_lod[123]\.mesh$/i.test(normalized)) {
    try {
      const source = await prepareOriginalAnimation(path, manifest);
      if (source) {
        group.userData.originalAnimationKey = normalized;
        group.userData.originalAnimationStatus = 'ready';
        group.userData.originalAnimationFamily = source.family;
      } else {
        group.userData.originalAnimationStatus = 'fixed pose: animation family is not yet verified';
      }
    } catch (error) {
      // A missing/unsupported animation must never hide a successfully decoded original model.
      group.userData.originalAnimationStatus = `fixed pose: ${error instanceof Error ? error.message : error}`;
      console.warn(`Original animation unavailable for ${path}:`, error);
    }
  }
  return group;
}

interface AdornmentTables {
  paths: string[];
  disposition: number[][][];
  types: number[][][];
  widths: Record<string, number[]>;
  referenceWidths: number[];
}
let adornmentTablesPromise: Promise<AdornmentTables> | undefined;

async function originalText(path: string, manifest: AssetManifest) {
  const url = manifest[normalizePath(path)];
  if (!url) throw new Error(`Missing original data ${path}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Original data ${path}: HTTP ${response.status}`);
  return new TextDecoder('windows-1252').decode(await response.arrayBuffer());
}

function dataTokens(text: string) { return text.replace(/\/\/[^\r\n]*/g, '').trim().split(/\s+/); }

async function adornmentTables(manifest: AssetManifest): Promise<AdornmentTables> {
  adornmentTablesPromise ??= Promise.all([
    originalText('Data/Design/Genotype/AdornmentData.ini', manifest),
    originalText('Data/Design/Genotype/simu_trans.dic', manifest),
    originalText('Data/Design/Genotype/graphic_trans.dic', manifest),
  ]).then(([adornments, simulation, graphics]) => {
    const tokens = dataTokens(adornments);
    const pairs = Number(tokens[0]);
    const paths = Array.from({ length: pairs }, (_, i) => tokens[1 + i * 2].replace(/\\/g, '/'));
    function readTables(part: number, nextPart: number) {
      const section = simulation.split(`Part ${part} :`)[1]?.split(`Part ${nextPart} :`)[0];
      if (!section) throw new Error('Original dummy translation section missing');
      const numbers = dataTokens(section.slice(section.indexOf('\n'))).map(Number);
      // The first line above is the rest of the section's comment heading.
      const tables: number[][][] = [];
      let offset = 0;
      for (let member = 0; member < 3; member++) {
        const rows = numbers[offset++];
        const columns = part === 4 ? 6 : 5;
        tables.push(Array.from({ length: rows }, () => {
          const row = numbers.slice(offset, offset + columns); offset += columns; return row;
        }));
      }
      return tables;
    }
    const widths: Record<string, number[]> = {};
    for (const member of ['Head', 'Body', 'Tail']) {
      const section = simulation.split(`// ${member} : Width`)[1]?.split('//')[0];
      if (!section) throw new Error(`Missing original ${member} width table`);
      const values = dataTokens(section).map(Number);
      widths[member.toLowerCase()] = values.slice(1, values[0] + 1);
    }
    return { paths, disposition: readTables(4, 5), types: readTables(5, 6), widths,
      referenceWidths: dataTokens(graphics).map(Number) };
  });
  return adornmentTablesPromise;
}

// Each original disposition slot may attach to one dummy or to its mirrored pair.
const dummySlots = [
  [['Dum_tete'], ['Dum_front'], ['Dum_museau'], ['Dum_couhaut'], ['Dum_coubas'], ['Dum_joueD', 'Dum_joueG']],
  [['Dum_doshaut'], ['Dum_doscentre'], ['Dum_dosreins'], ['Dum_dosbassin'], ['Dum_epauleD', 'Dum_epauleG'], ['Dum_cuisseD', 'Dum_cuisseG']],
  [['Dum_queue1'], ['Dum_queue2'], ['Dum_queue3'], ['Dum_queue4'], ['Dum_queueD1', 'Dum_queueG1'], ['Dum_queueD2', 'Dum_queueG2']],
];

async function attachOriginalAdornments(group: THREE.Group, path: string, manifest: AssetManifest) {
  const species = normalizePath(path).split('/').at(-2)!;
  const [tables, genotype, skeletonResponse] = await Promise.all([
    adornmentTables(manifest),
    originalText(`Data/Design/Scenario/Genotype/${species}.gen`, manifest),
    fetch(manifest[`data/graphics/actors/dinos/${species}/${species}.skel`]),
  ]);
  if (!skeletonResponse.ok) throw new Error(`Missing original ${species} skeleton`);
  const bones = parseOriginalSkeleton(await skeletonResponse.arrayBuffer());
  const genes = dataTokens(genotype).map(Number).slice(1);
  const memberGene = [0, 2, 3];
  const referenceWidth = [0, 3, 4];
  const members = ['head', 'body', 'tail'];
  const pending: Promise<void>[] = [];
  for (let member = 0; member < 3; member++) {
    const disposition = tables.disposition[member][genes[(4 + member * 2) * 2]];
    const types = tables.types[member][genes[(5 + member * 2) * 2]];
    const speciesId = genes[memberGene[member] * 2];
    const width = tables.widths[members[member]][speciesId] / tables.referenceWidths[referenceWidth[member]];
    for (let slot = 0; slot < 6; slot++) {
      const size = disposition[slot];
      if (!size) continue;
      const modelId = types[size - 1];
      if (!modelId) continue;
      const modelPath = `Data/Graphics/Actors/elements_sup/${tables.paths[modelId - 1]}`;
      for (const name of dummySlots[member][slot]) {
        const bone = bones.find(bone => bone.name === name);
        if (!bone) throw new Error(`Original ${species} missing dummy ${name}`);
        pending.push(loadOriginalModel(modelPath, { adornments: false }).then(model => {
          const attachment = new THREE.Group();
          attachment.name = name;
          // Remove only the skeleton's centimeter scale; retain the original dummy pose.
          const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
          bone.world.decompose(position, quaternion, scale);
          attachment.position.copy(position);
          attachment.quaternion.copy(quaternion);
          attachment.scale.setScalar(width);
          attachment.userData.originalAdornment = modelPath;
          // Dummy Y is outward/up; the mesh loader's Z-up conversion also maps onto it.
          attachment.add(model);
          group.add(attachment);
        }));
      }
    }
  }
  await Promise.all(pending);
  group.userData.originalAdornments = pending.length;
}

interface AnimationBoneRest {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  rotationOffset: THREE.Quaternion;
  translationScale: number;
}
interface OriginalAnimationSource {
  family: string;
  skin: OriginalMeshPart;
  bones: OriginalBone[];
  neutral: OriginalAnimation;
  walk: OriginalAnimation;
  rest: AnimationBoneRest[];
  neutralTracks: (OriginalAnimationTrack | undefined)[];
  walkTracks: (OriginalAnimationTrack | undefined)[];
}
interface OriginalAnimationController {
  source: OriginalAnimationSource;
  mesh: THREE.Mesh;
  bones: OriginalBone[];
  position: THREE.BufferAttribute;
  normal: THREE.BufferAttribute;
  attachments: { object: THREE.Object3D; bone: number }[];
}
const animationSources = new Map<string, Promise<OriginalAnimationSource | undefined>>();
const readyAnimationSources = new Map<string, OriginalAnimationSource>();
const animationControllers = new WeakMap<THREE.Object3D, OriginalAnimationController>();

// Verified by comparing each original family neutral clip with the species skeleton.
// Other species retain their original fixed pose until their family is verified.
const originalAnimationFamilies: Record<string, string> = {
  trex: 'HeavyBiped', stego: 'LightQuadruped', trice: 'LowQuadruped', brachio: 'HighQuadruped',
};

async function originalBuffer(path: string, manifest: AssetManifest) {
  const url = manifest[normalizePath(path)];
  if (!url) throw new Error(`Missing original asset ${path}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Original asset ${path}: HTTP ${response.status}`);
  return response.arrayBuffer();
}

async function prepareOriginalAnimation(path: string, manifest: AssetManifest) {
  const key = normalizePath(path);
  let pending = animationSources.get(key);
  if (!pending) {
    pending = (async () => {
      const species = key.split('/').at(-2)!, family = originalAnimationFamilies[species];
      if (!family) return undefined;
      const base = `Data/Graphics/Actors/Dinos/animations/${family}/${family}`;
      const [skinBuffer, skeletonBuffer, neutralBuffer, walkBuffer] = await Promise.all([
        originalBuffer(path.replace(/\.mesh$/i, '.skin'), manifest),
        originalBuffer(`Data/Graphics/Actors/Dinos/${species}/${species}.skel`, manifest),
        originalBuffer(base + '_Neutral.anim', manifest),
        originalBuffer(base + '_Walk.anim', manifest),
      ]);
      const skin = parseOriginalSkin(skinBuffer).meshes.find(part => part.bindings?.length);
      if (!skin) throw new Error('Original skin contains no weighted render mesh');
      const bones = parseOriginalSkeleton(skeletonBuffer);
      const neutral = parseOriginalAnimation(neutralBuffer), walk = parseOriginalAnimation(walkBuffer);
      const neutralTracks = bones.map(bone => neutral.tracks.find(track => track.name === bone.name));
      const walkTracks = bones.map(bone => walk.tracks.find(track => track.name === bone.name));
      const rest = bones.map((bone, i) => {
        const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
        bone.local.decompose(position, quaternion, scale);
        const base = neutralTracks[i]?.keys[0];
        const rotationOffset = quaternion.clone();
        if (base) rotationOffset.multiply(base.quaternion.clone().invert());
        const translationScale = base && base.position.length() > 0.01 ? position.length() / base.position.length() : 1;
        return { position, quaternion, scale, rotationOffset, translationScale };
      });
      const sums = new Float32Array(skin.positions.length / 3);
      for (const binding of skin.bindings!) {
        if (!bones.some(bone => bone.name === binding.name)) throw new Error(`Missing original skin bone ${binding.name}`);
        for (let i = 0; i < binding.indices.length; i++) sums[binding.indices[i]] += binding.weights[i];
      }
      if (sums.some(sum => Math.abs(sum - 1) > 0.001)) throw new Error('Original skin weights do not sum to one');
      const source = { family, skin, bones, neutral, walk, rest, neutralTracks, walkTracks };
      readyAnimationSources.set(key, source);
      return source;
    })();
    animationSources.set(key, pending);
  }
  return pending;
}

/** Apply original bone weights and inverse-bind matrices. Inputs retain original Z-up axes. */
export function deformOriginalSkin(part: OriginalMeshPart, bones: OriginalBone[],
  outputPositions: Float32Array = new Float32Array(part.positions.length),
  outputNormals: Float32Array = new Float32Array(part.normals.length)) {
  if (!part.bindings?.length) throw new Error('Original skin has no bone weights');
  outputPositions.fill(0);
  outputNormals.fill(0);
  const transform = new THREE.Matrix4();
  for (const binding of part.bindings) {
    const bone = bones.find(bone => bone.name === binding.name);
    if (!bone) throw new Error(`Original skeleton missing skin bone ${binding.name}`);
    transform.multiplyMatrices(bone.world, binding.inverseBind);
    const m = transform.elements;
    for (let j = 0; j < binding.indices.length; j++) {
      const index = binding.indices[j] * 3, weight = binding.weights[j];
      const x = part.positions[index], y = part.positions[index + 1], z = part.positions[index + 2];
      outputPositions[index] += (m[0] * x + m[4] * y + m[8] * z + m[12]) * weight;
      outputPositions[index + 1] += (m[1] * x + m[5] * y + m[9] * z + m[13]) * weight;
      outputPositions[index + 2] += (m[2] * x + m[6] * y + m[10] * z + m[14]) * weight;
      if (part.normals.length) {
        const nx = part.normals[index], ny = part.normals[index + 1], nz = part.normals[index + 2];
        outputNormals[index] += (m[0] * nx + m[4] * ny + m[8] * nz) * weight;
        outputNormals[index + 1] += (m[1] * nx + m[5] * ny + m[9] * nz) * weight;
        outputNormals[index + 2] += (m[2] * nx + m[6] * ny + m[10] * nz) * weight;
      }
    }
  }
  for (let i = 0; i < outputNormals.length; i += 3) {
    const length = Math.hypot(outputNormals[i], outputNormals[i + 1], outputNormals[i + 2]) || 1;
    outputNormals[i] /= length; outputNormals[i + 1] /= length; outputNormals[i + 2] /= length;
  }
  return { positions: outputPositions, normals: outputNormals };
}

function animationController(model: THREE.Object3D, source: OriginalAnimationSource): OriginalAnimationController {
  const mesh = model.children.find(child => child instanceof THREE.Mesh && child.name === source.skin.name) as THREE.Mesh | undefined;
  if (!mesh || mesh.geometry.getAttribute('position').count !== source.skin.positions.length / 3) {
    throw new Error('Original animated skin does not match its visible mesh');
  }
  // Object3D.clone shares geometry: each animated instance must own its deformation buffers.
  mesh.geometry = mesh.geometry.clone();
  const position = new THREE.BufferAttribute(new Float32Array(source.skin.positions.length), 3).setUsage(THREE.DynamicDrawUsage);
  const normal = new THREE.BufferAttribute(new Float32Array(source.skin.normals.length), 3).setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('position', position);
  mesh.geometry.setAttribute('normal', normal);
  mesh.geometry.setIndex(new THREE.BufferAttribute(source.skin.indices, 1));
  mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(source.skin.uv, 2));
  const bones = source.bones.map(bone => ({ ...bone, local: bone.local.clone(), world: bone.world.clone() }));
  const attachments: OriginalAnimationController['attachments'] = [];
  model.traverse(object => {
    if (!object.userData.originalAdornment) return;
    const bone = bones.findIndex(bone => bone.name === object.name);
    if (bone >= 0) attachments.push({ object, bone });
  });
  return { source, mesh, bones, position, normal, attachments };
}

const sampledPosition = new THREE.Vector3(), sampledQuaternion = new THREE.Quaternion(), sampledScale = new THREE.Vector3();
const targetPosition = new THREE.Vector3(), targetQuaternion = new THREE.Quaternion(), targetScale = new THREE.Vector3();
const attachmentScale = new THREE.Vector3();

function sampleTrack(track: OriginalAnimationTrack, time: number) {
  const keys = track.keys;
  let first = 0;
  while (first + 1 < keys.length && keys[first + 1].time <= time) first++;
  const a = keys[first], b = keys[Math.min(first + 1, keys.length - 1)];
  const mix = b.time > a.time ? THREE.MathUtils.clamp((time - a.time) / (b.time - a.time), 0, 1) : 0;
  sampledPosition.copy(a.position).lerp(b.position, mix);
  sampledQuaternion.copy(a.quaternion).slerp(b.quaternion, mix);
  sampledScale.copy(a.scale).lerp(b.scale, mix);
}

/**
 * Play original Walk/Neutral keyframes. Safe for cloned models and wrapper groups.
 * Returns false for unsupported/missing clips, keeping the decoded original fixed pose.
 */
export function animateOriginalModel(root: THREE.Object3D, elapsed: number, action: 'walk' | 'idle' = 'walk'): boolean {
  let model: THREE.Object3D | undefined = root.userData.originalAnimationKey ? root : undefined;
  if (!model) root.traverse(child => { if (!model && child.userData.originalAnimationKey) model = child; });
  if (!model || !Number.isFinite(elapsed)) return false;
  const source = readyAnimationSources.get(model.userData.originalAnimationKey);
  if (!source) return false;
  try {
    let controller = animationControllers.get(model);
    if (!controller) {
      controller = animationController(model, source);
      animationControllers.set(model, controller);
    }
    const clip = action === 'idle' ? source.neutral : source.walk;
    const tracks = action === 'idle' ? source.neutralTracks : source.walkTracks;
    const time = ((elapsed % clip.duration) + clip.duration) % clip.duration;
    for (let i = 0; i < controller.bones.length; i++) {
      const bone = controller.bones[i], rest = source.rest[i];
      const track = tracks[i], neutral = source.neutralTracks[i]?.keys[0];
      if (track && neutral) {
        sampleTrack(track, time);
        // Keep locomotion in the game's actor simulation while retaining the clip's body sway.
        if (bone.name === 'Bip01') {
          const first = track.keys[0], last = track.keys.at(-1)!;
          const progression = clip.duration > 0 ? time / clip.duration : 0;
          sampledPosition.x -= (last.position.x - first.position.x) * progression;
          sampledPosition.y -= (last.position.y - first.position.y) * progression;
        }
        targetPosition.copy(sampledPosition).sub(neutral.position).multiplyScalar(rest.translationScale).add(rest.position);
        targetQuaternion.copy(rest.rotationOffset).multiply(sampledQuaternion).normalize();
        targetScale.copy(sampledScale).divide(neutral.scale).multiply(rest.scale);
        bone.local.compose(targetPosition, targetQuaternion, targetScale);
      } else bone.local.copy(source.bones[i].local);
      bone.world.copy(bone.local);
      if (bone.parent >= 0) bone.world.premultiply(controller.bones[bone.parent].world);
    }
    deformOriginalSkin(source.skin, controller.bones,
      controller.position.array as Float32Array, controller.normal.array as Float32Array);
    controller.position.needsUpdate = controller.normal.needsUpdate = true;
    controller.mesh.geometry.computeBoundingBox();
    controller.mesh.geometry.computeBoundingSphere();
    for (const attachment of controller.attachments) {
      controller.bones[attachment.bone].world.decompose(attachment.object.position, attachment.object.quaternion, attachmentScale);
    }
    model.userData.originalAnimationAction = action;
    model.userData.originalAnimationStatus = 'playing';
    return true;
  } catch (error) {
    model.userData.originalAnimationStatus = `fixed pose: ${error instanceof Error ? error.message : error}`;
    console.warn('Original animation could not be applied:', error);
    return false;
  }
}

/** Loads original meshes and their converted original textures; clones share GPU assets. */
export async function loadOriginalModel(path: string, options: OriginalModelOptions = {}): Promise<THREE.Group> {
  const key = normalizePath(path) + ':' + (options.vertexColors !== false) + ':' + (options.adornments !== false) + ':' + (options.animation !== false);
  let pending = modelCache.get(key);
  if (!pending) {
    pending = buildOriginalModel(path, options.vertexColors !== false, options.adornments !== false, options.animation !== false);
    modelCache.set(key, pending);
    pending.catch(() => modelCache.delete(key));
  }
  const group = (await pending).clone(true);
  group.scale.setScalar(options.scale ?? 1);
  group.traverse(child => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = options.castShadow ?? true;
      child.receiveShadow = options.receiveShadow ?? true;
    }
  });
  return group;
}
