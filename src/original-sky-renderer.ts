import * as THREE from 'three';
import { parseOriginalSky, type OriginalAssetManifest, type OriginalSkyDefinition } from './original-sky.ts';

const FACE_ORDER = ['right', 'left', 'top', 'bottom', 'front', 'back'] as const;

export interface OriginalSkyRenderer {
  definition: OriginalSkyDefinition;
  group: THREE.Group;
  attach(scene: THREE.Scene): void;
  update(delta: number): void;
  dispose(scene: THREE.Scene): void;
}

async function fetchText(url: string, key: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to read original sky asset: ${key}`);
  return response.text();
}

function requiredUrl(manifest: OriginalAssetManifest, key: string): string {
  const url = manifest[key];
  if (!url) throw new Error(`Original asset manifest is missing ${key}`);
  return url;
}

function faceFiles(manifest: OriginalAssetManifest, island: string): string[] {
  const prefix = `data/graphics/textures/skybox/${island}/`;
  return FACE_ORDER.map(face => (
    manifest[`${prefix}${face}.png`] ? `${face}.png` : `${face}.PNG`
  ));
}

export async function createOriginalSkyRenderer(
  manifest: OriginalAssetManifest,
  island = 'isl01',
): Promise<OriginalSkyRenderer> {
  const cloudPath = `data/graphics/textures/skybox/${island}/cloud.ini`;
  const cloudBasePath = 'data/graphics/textures/skybox/cloudbase.ini';
  const [cloudIni, cloudBaseIni, cloudState, skyboxState] = await Promise.all([
    fetchText(requiredUrl(manifest, cloudPath), cloudPath),
    fetchText(requiredUrl(manifest, cloudBasePath), cloudBasePath),
    fetchText(requiredUrl(manifest, 'data/states/dino_clouds.ini'), 'data/states/dino_clouds.ini'),
    fetchText(requiredUrl(manifest, 'data/states/skybox.ini'), 'data/states/skybox.ini'),
  ]);

  const definition = parseOriginalSky({
    island,
    faceFiles: faceFiles(manifest, island),
    cloudIni,
    cloudIniPath: cloudPath,
    readFile: path => {
      if (path === cloudBasePath) return cloudBaseIni;
      throw new Error(`Unsupported original cloud include: ${path}`);
    },
    cloudState,
    skyboxState,
    manifest,
  });

  const faceUrls = FACE_ORDER.map(face => definition.faces[face].publicUrl!);
  const background = await new THREE.CubeTextureLoader().loadAsync(faceUrls);
  background.colorSpace = THREE.SRGBColorSpace;

  const group = new THREE.Group();
  group.name = 'Original skybox cloud layers';
  const layers = definition.clouds.layers.map((layer, index) => {
    const texture = new THREE.TextureLoader().load(layer.publicUrl!);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(layer.scale, layer.scale);

    // Dino_Clouds.ini uses two-sided, lit, z-tested alpha-blended geometry.
    // The engine's cloud mesh is not yet recovered; a centered cube is the
    // conservative camera-surrounding reconstruction until that consumer is
    // decompiled.
    const geometry = new THREE.BoxGeometry(3800 - index * 200, 3800 - index * 200, 3800 - index * 200);
    const material = new THREE.MeshLambertMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: true,
      fog: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `Original cloud layer ${layer.layer}`;
    mesh.renderOrder = -1000 + index;
    group.add(mesh);
    return { layer, texture, geometry, material, mesh };
  });

  return {
    definition,
    group,
    attach(scene: THREE.Scene): void {
      scene.background = background;
      scene.add(group);
    },
    update(delta: number): void {
      for (const { layer, texture } of layers) {
        texture.offset.x += layer.speedX * delta;
        texture.offset.y += layer.speedY * delta;
      }
    },
    dispose(scene: THREE.Scene): void {
      scene.remove(group);
      if (scene.background === background) scene.background = null;
      for (const { geometry, material, texture } of layers) {
        geometry.dispose();
        material.dispose();
        texture.dispose();
      }
      background.dispose();
    },
  };
}
