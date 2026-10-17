import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PerspectiveCamera } from 'three';
import {
  parseOriginalCameraIni,
  type OriginalCameraConfig,
  type OriginalCameraConfigId,
  type OriginalCameraConfigs,
} from './original-camera.ts';

export const ORIGINAL_CAMERA_PROFILE: OriginalCameraConfigId = 'Config1';

async function originalText(manifest: Record<string, string>, key: string): Promise<string> {
  const url = manifest[key];
  if (!url) throw new Error(`Original asset manifest is missing ${key}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to read original camera profile: ${key}`);
  return response.text();
}

export async function loadOriginalCameraConfigs(
  manifest: Record<string, string>,
): Promise<OriginalCameraConfigs> {
  return parseOriginalCameraIni(await originalText(manifest, 'data/config/camera.ini'));
}

export function applyOriginalCameraProfile(
  camera: PerspectiveCamera,
  controls: OrbitControls,
  configs: OriginalCameraConfigs,
  configId: OriginalCameraConfigId = ORIGINAL_CAMERA_PROFILE,
): OriginalCameraConfig {
  const config = configs[configId];
  // ParkInterface.Ini specifies ZMIN=.5. The large far plane is retained for
  // the original sky/cloud geometry and 1024-unit island.
  camera.near = 0.5;
  camera.far = 2200;
  camera.updateProjectionMatrix();
  controls.minDistance = config.distance.min;
  controls.maxDistance = config.distance.max;
  return config;
}
