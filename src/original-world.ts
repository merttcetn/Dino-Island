import * as THREE from 'three';
import { loadOriginalModel } from './original-models.ts';

/** Original terrain/vegetation, with a new starter park laid out on a flat clearing. */
export interface OriginalWorld {
  group: THREE.Group;
  terrainHeight(x: number, z: number): number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  water?: THREE.Mesh;
  spawnPoints: { species: string; x: number; z: number }[];
  defaultCameraTarget: { x: number; z: number };
  minimapUrl: string;
  update(elapsed: number, delta: number): void;
}

const MAP_SIZE = 1024;
const HALF = MAP_SIZE / 2;
const PARK_TARGET = { x: 8, z: 18 };
const LANDSCAPE = 'Data/Design/landscape/isl01/isl01.lnd';
const HEIGHT_SCALE = 0.5;
let manifestPromise: Promise<Record<string, string>> | undefined;
const canonical = (path: string) => path.replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase();

async function assetUrl(path: string): Promise<string> {
  manifestPromise ??= fetch('/assets/manifest.json').then(async response => {
    if (!response.ok) throw new Error('Original asset manifest is missing. Run scripts/prepare-assets.py.');
    return response.json() as Promise<Record<string, string>>;
  });
  const manifest = await manifestPromise;
  const key = canonical(path.replace(/^\/original\//i, ''));
  const url = manifest[key];
  if (!url) throw new Error(`Original asset not prepared: ${path}`);
  return url;
}

async function assetBytes(path: string): Promise<ArrayBuffer> {
  const response = await fetch(await assetUrl(path));
  if (!response.ok) throw new Error(`Unable to read original asset: ${path}`);
  return response.arrayBuffer();
}

class Reader {
  private offset = 0;
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  constructor(buffer: ArrayBuffer) { this.view = new DataView(buffer); this.bytes = new Uint8Array(buffer); }
  get remaining() { return this.bytes.length - this.offset; }
  uint(): number { const value = this.view.getUint32(this.offset, true); this.offset += 4; return value; }
  float(): number { const value = this.view.getFloat32(this.offset, true); this.offset += 4; return value; }
  string(): string {
    const length = this.uint();
    if (length > this.remaining || length > 4096) throw new Error('Invalid original landscape string.');
    const value = new TextDecoder('windows-1252').decode(this.bytes.subarray(this.offset, this.offset + length));
    this.offset += length;
    return value.replace(/\0+$/, '');
  }
}

interface Landscape {
  base: string; detail: string; height: string; water: string; water2: string; seaLevel: number; placements: string[];
}

function readLandscape(bytes: ArrayBuffer): Landscape {
  const reader = new Reader(bytes);
  reader.string(); // Localized island name.
  const base = reader.string();
  const detail = reader.string();
  const height = reader.string();
  reader.string(); // Skybox directory.
  const water = reader.string();
  const water2 = reader.string(); // Second water layer: isl01 references the same water.tga.
  reader.string(); // Occupation grid.
  const seaLevel = reader.float();
  reader.uint(); reader.uint(); // Original start coordinates, not the custom starter park.
  reader.uint();
  reader.string(); // Island music identifier.
  const placements: string[] = [];
  while (reader.remaining >= 4) {
    const path = reader.string();
    if (path.toLowerCase().endsWith('.imp')) placements.push(path);
  }
  return { base, detail, height, water, water2, seaLevel, placements };
}

async function texture(path: string, repeat = 1, color = true): Promise<THREE.Texture> {
  const loaded = await new THREE.TextureLoader().loadAsync(await assetUrl(path));
  loaded.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  loaded.anisotropy = 8;
  if (repeat !== 1) {
    loaded.wrapS = loaded.wrapT = THREE.RepeatWrapping;
    loaded.repeat.set(repeat, repeat);
  }
  return loaded;
}

/** Batch copies of an original static mesh, retaining every submesh and material. */
function instances(model: THREE.Group, transforms: THREE.Matrix4[], name: string): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  model.updateMatrixWorld(true);
  model.traverse(child => {
    if (!(child instanceof THREE.Mesh) || child instanceof THREE.SkinnedMesh) return;
    const mesh = new THREE.InstancedMesh(child.geometry, child.material, transforms.length);
    mesh.name = child.name || name;
    const local = child.matrixWorld;
    transforms.forEach((matrix, index) => mesh.setMatrixAt(index, matrix.clone().multiply(local)));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });
  return group;
}

function transform(x: number, y: number, z: number, angle = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle),
    new THREE.Vector3(sx, sy, sz),
  );
}

async function addVegetation(
  group: THREE.Group, paths: string[], terrainHeight: OriginalWorld['terrainHeight'],
): Promise<void> {
  await Promise.all(paths.map(async path => {
    const reader = new Reader(await assetBytes(path));
    const definition = reader.string();
    const count = reader.uint();
    if (count * 16 > reader.remaining) throw new Error(`Invalid original placement count: ${path}`);
    const placements: THREE.Matrix4[] = [];
    for (let index = 0; index < count; index++) {
      const x = reader.float() - HALF;
      const z = HALF - reader.float();
      const scale = reader.float();
      const angle = reader.float();
      placements.push(transform(x, terrainHeight(x, z), z, angle, scale));
    }
    // BLF begins with flags followed by length-prefixed mesh paths. Use the authored LOD1.
    const text = new TextDecoder('windows-1252').decode(await assetBytes(definition));
    const meshPath = text.match(/DATA[\\/]graphics[\\/][\w\\/. -]+?_lod1\.mesh/i)?.[0];
    if (!meshPath) throw new Error(`No original LOD1 model in ${definition}`);
    const model = await loadOriginalModel(await assetUrl(meshPath));
    group.add(instances(model, placements, `Original vegetation: ${definition.split('\\').at(-1)}`));
  }));
}

function groundPatch(
  group: THREE.Group, material: THREE.Material, x: number, z: number,
  width: number, depth: number, terrainHeight: OriginalWorld['terrainHeight'], heightOffset = 0.18,
): void {
  const geometry = new THREE.PlaneGeometry(width, depth, Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(depth)));
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const uvs = geometry.attributes.uv;
  for (let index = 0; index < positions.count; index++) {
    const px = positions.getX(index) + x;
    const pz = positions.getZ(index) + z;
    positions.setY(index, terrainHeight(px, pz) + heightOffset);
    positions.setX(index, px); positions.setZ(index, pz);
    uvs.setXY(index, px / 6, pz / 6);
  }
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Original textured park ground';
  mesh.receiveShadow = true;
  group.add(mesh);
}

async function addStarterPark(group: THREE.Group, terrainHeight: OriginalWorld['terrainHeight']): Promise<void> {
  const [fence, tower, bowl, entrance, ride, restaurant, pathTexture, penTexture] = await Promise.all([
    loadOriginalModel(await assetUrl('Data/Graphics/paddock/fences/fence_paddock_lod1.mesh')),
    loadOriginalModel(await assetUrl('Data/Graphics/paddock/ptview/ptview.mesh')),
    loadOriginalModel(await assetUrl('Data/Graphics/paddock/bowl/bowl.mesh')),
    loadOriginalModel(await assetUrl('Data/Graphics/buildings/entrance/entrance_lod1.mesh')),
    loadOriginalModel(await assetUrl('Data/Graphics/buildings/blackbox/manege/manege_lod2.mesh')),
    loadOriginalModel(await assetUrl('Data/Graphics/buildings/restaurants/restcirc/restcirc_lod2.mesh')),
    texture('Data/Graphics/Textures/buildings/boue_PAD.tga', 1),
    texture('Data/Graphics/Textures/buildings/boue_ATT.tga', 1),
  ]);
  pathTexture.wrapS = pathTexture.wrapT = THREE.RepeatWrapping;
  penTexture.wrapS = penTexture.wrapT = THREE.RepeatWrapping;
  const pathMaterial = new THREE.MeshLambertMaterial({ map: pathTexture });
  const penMaterial = new THREE.MeshLambertMaterial({ map: penTexture });
  const cx = PARK_TARGET.x;
  const cz = PARK_TARGET.z;
  groundPatch(group, pathMaterial, cx, cz + 28, 7, 156, terrainHeight);
  groundPatch(group, pathMaterial, cx + 7, cz, 129, 7, terrainHeight);
  groundPatch(group, pathMaterial, cx + 64, cz, 7, 55, terrainHeight);

  const fenceBounds = new THREE.Box3().setFromObject(fence);
  const fenceSize = fenceBounds.getSize(new THREE.Vector3());
  const longAxisX = fenceSize.x > fenceSize.z;
  const panelLength = Math.max(fenceSize.x, fenceSize.z);
  const fenceMatrices: THREE.Matrix4[] = [];
  const towerMatrices: THREE.Matrix4[] = [];
  const bowlMatrices: THREE.Matrix4[] = [];
  const edge = (ax: number, az: number, bx: number, bz: number) => {
    const length = Math.hypot(bx - ax, bz - az);
    const count = Math.max(1, Math.round(length / panelLength));
    const angle = Math.atan2(bx - ax, bz - az) - (longAxisX ? Math.PI / 2 : 0);
    for (let index = 0; index < count; index++) {
      const f = (index + 0.5) / count;
      const x = THREE.MathUtils.lerp(ax, bx, f);
      const z = THREE.MathUtils.lerp(az, bz, f);
      const stretch = length / count / panelLength;
      // Stretch is applied before rotation in the imported mesh's horizontal long axis.
      fenceMatrices.push(transform(x, terrainHeight(x, z) - fenceBounds.min.y, z, angle,
        longAxisX ? stretch : 1, 1, longAxisX ? 1 : stretch));
    }
  };
  for (const dx of [-25, 25]) for (const dz of [-24, 24]) {
    const x = cx + dx, z = cz + dz;
    const w = 18, d = 17;
    groundPatch(group, penMaterial, x, z, w * 2 - 1, d * 2 - 1, terrainHeight, 0.035);
    edge(x - w, z - d, x + w, z - d);
    edge(x + w, z - d, x + w, z + d);
    edge(x + w, z + d, x - w, z + d);
    edge(x - w, z + d, x - w, z - d);
    const tx = x + (dx < 0 ? 13 : -13), tz = z + (dz < 0 ? 18 : -18);
    towerMatrices.push(transform(tx, terrainHeight(tx, tz), tz, dz < 0 ? Math.PI : 0));
    bowlMatrices.push(transform(x - 11, terrainHeight(x - 11, z + 9), z + 9));
  }
  group.add(instances(fence, fenceMatrices, 'Original paddock fences'));
  group.add(instances(tower, towerMatrices, 'Original observation towers'));
  group.add(instances(bowl, bowlMatrices, 'Original feeding bowls'));

  const place = (model: THREE.Group, x: number, z: number, angle: number, name: string) => {
    const copy = model.clone(true);
    // Wrap the imported Z-up conversion instead of overwriting its rotation.
    const wrapper = new THREE.Group();
    wrapper.name = name;
    wrapper.position.set(x, terrainHeight(x, z), z);
    wrapper.rotation.y = angle;
    wrapper.add(copy);
    group.add(wrapper);
  };
  // The original entrance is the arriving boat and pier, so keep it on the shore.
  place(entrance, cx, cz + 100, Math.PI / 2, 'Original entrance boat and pier');
  groundPatch(group, pathMaterial, cx + 68, cz - 17, 24, 24, terrainHeight);
  place(ride, cx + 68, cz - 17, 0, 'Original carousel');
  groundPatch(group, pathMaterial, cx + 65, cz + 22, 15, 15, terrainHeight);
  place(restaurant, cx + 65, cz + 22, Math.PI / 2, 'Original circus restaurant');
}

export async function createOriginalWorld(): Promise<OriginalWorld> {
  const landscape = readLandscape(await assetBytes(LANDSCAPE));
  const [heightBuffer, baseMap, detailMap, waterMap, waterMap2] = await Promise.all([
    assetBytes(landscape.height), texture(landscape.base), texture(landscape.detail, 1, false), texture(landscape.water, 45),
    texture(landscape.water2, 45),
  ]);
  const raw = new Uint8Array(heightBuffer);
  const resolution = Math.sqrt(raw.length);
  if (!Number.isInteger(resolution)) throw new Error('Original heightmap is not a square byte grid.');
  const terrainHeight = (x: number, z: number): number => {
    const px = THREE.MathUtils.clamp((x + HALF) / MAP_SIZE * (resolution - 1), 0, resolution - 1);
    const py = THREE.MathUtils.clamp((z + HALF) / MAP_SIZE * (resolution - 1), 0, resolution - 1);
    const ix = Math.floor(px), iy = Math.floor(py);
    const jx = Math.min(ix + 1, resolution - 1), jy = Math.min(iy + 1, resolution - 1);
    const a = THREE.MathUtils.lerp(raw[iy * resolution + ix]!, raw[iy * resolution + jx]!, px - ix);
    const b = THREE.MathUtils.lerp(raw[jy * resolution + ix]!, raw[jy * resolution + jx]!, px - ix);
    return (THREE.MathUtils.lerp(a, b, py - iy) - landscape.seaLevel) * HEIGHT_SCALE;
  };
  const group = new THREE.Group();
  group.name = 'Original Dino Island: isl01';
  const geometry = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, resolution - 1, resolution - 1);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  for (let index = 0; index < positions.count; index++) {
    positions.setY(index, (raw[index]! - landscape.seaLevel) * HEIGHT_SCALE);
  }
  geometry.computeVertexNormals();
  const material = new THREE.MeshLambertMaterial({ map: baseMap });
  detailMap.wrapS = detailMap.wrapT = THREE.RepeatWrapping;
  material.onBeforeCompile = shader => {
    shader.uniforms.originalDetailMap = { value: detailMap };
    shader.fragmentShader = `
uniform sampler2D originalDetailMap;
vec3 originalEncodeSRGB(vec3 linearColor) {
  vec3 low = linearColor * 12.92;
  vec3 high = 1.055 * pow(max(linearColor, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(low, high, step(vec3(0.0031308), linearColor));
}
vec3 originalDecodeSRGB(vec3 srgbColor) {
  vec3 low = srgbColor / 12.92;
  vec3 high = pow((srgbColor + 0.055) / 1.055, vec3(2.4));
  return mix(low, high, step(vec3(0.04045), srgbColor));
}
` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
      `#include <map_fragment>
// Data/States/TextureParam_DetailMap.txt: stage 0 SelectArg1(texture),
// stage 1 AddSigned(texture, current). D3D combined 8-bit gamma values.
vec3 originalDetailBase = originalEncodeSRGB(diffuseColor.rgb);
vec3 originalDetailCurrent = texture2D(originalDetailMap, vMapUv * 32.0).rgb;
diffuseColor.rgb = originalDecodeSRGB(clamp(originalDetailBase + originalDetailCurrent - 0.5, vec3(0.0), vec3(1.0)));`);
  };
  material.customProgramCacheKey = () => 'original-dino-island-terrain-addsigned';
  const terrain = new THREE.Mesh(geometry, material);
  terrain.name = 'Original 512 × 512 heightmap and island textures';
  terrain.receiveShadow = true;
  group.add(terrain);

  const waterMaterial = new THREE.MeshLambertMaterial({
    map: waterMap,
    // Data/States/WaterSurface.ini: additive One/One, z-write on, both-sided, specular disabled.
    color: 0xffffff,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendEquation: THREE.AddEquation,
    fog: false,
  });
  const waterLayer2Offset = new THREE.Vector2();
  waterMaterial.onBeforeCompile = shader => {
    shader.uniforms.originalWaterLayer2 = { value: waterMap2 };
    shader.uniforms.originalWaterLayer2Offset = { value: waterLayer2Offset };
    shader.uniforms.originalWaterFogStart = { value: 100 };
    shader.uniforms.originalWaterFogEnd = { value: 700 };
    shader.fragmentShader = `
uniform sampler2D originalWaterLayer2;
uniform vec2 originalWaterLayer2Offset;
uniform float originalWaterFogStart;
uniform float originalWaterFogEnd;
vec3 originalWaterEncodeSRGB(vec3 linearColor) {
  vec3 low = linearColor * 12.92;
  vec3 high = 1.055 * pow(max(linearColor, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(low, high, step(vec3(0.0031308), linearColor));
}
` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
      `#include <map_fragment>
// TextureParam_WaterSurface.txt: SelectArg1(texture), then Modulate2x(texture, current).
vec3 originalWaterStage0 = originalWaterEncodeSRGB(diffuseColor.rgb);
vec3 originalWaterStage1 = originalWaterEncodeSRGB(texture2D(originalWaterLayer2, vMapUv + originalWaterLayer2Offset).rgb);
diffuseColor.rgb = clamp(originalWaterStage0 * originalWaterStage1 * 2.0, vec3(0.0), vec3(1.0));`);
    // FogParam_WaterSurface.txt: linear 100..700 black fog, independent of the scene fog.
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>',
      `float originalWaterFogDistance = length(vViewPosition);
float originalWaterFogFactor = clamp((originalWaterFogDistance - originalWaterFogStart) /
  max(originalWaterFogEnd - originalWaterFogStart, 0.0001), 0.0, 1.0);
gl_FragColor.rgb *= 1.0 - originalWaterFogFactor;`);
  };
  waterMaterial.customProgramCacheKey = () => 'original-dino-island-water-modulate2x';
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), waterMaterial);
  water.name = 'Original scrolling ocean texture';
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.08;
  water.renderOrder = 1;
  group.add(water);
  await Promise.all([addVegetation(group, landscape.placements, terrainHeight), addStarterPark(group, terrainHeight)]);
  return {
    group, terrainHeight, water,
    bounds: { minX: -HALF, maxX: HALF, minZ: -HALF, maxZ: HALF },
    defaultCameraTarget: { ...PARK_TARGET },
    minimapUrl: await assetUrl(landscape.base),
    spawnPoints: [
      { species: 'stego', x: PARK_TARGET.x - 25, z: PARK_TARGET.z - 24 },
      { species: 'trex', x: PARK_TARGET.x + 25, z: PARK_TARGET.z - 24 },
      { species: 'trice', x: PARK_TARGET.x - 25, z: PARK_TARGET.z + 24 },
      { species: 'brachio', x: PARK_TARGET.x + 25, z: PARK_TARGET.z + 24 },
    ],
    update(elapsed: number, _delta: number) {
      // Original transform matrices are not decoded yet; keep the previous inferred directions.
      waterMap.offset.set(elapsed * 0.007, elapsed * 0.004);
      waterMap2.offset.set(elapsed * -0.004, elapsed * 0.009);
      waterLayer2Offset.copy(waterMap2.offset).sub(waterMap.offset);
    },
  };
}
