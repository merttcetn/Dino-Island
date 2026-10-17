/**
 * Mapping from the original game's Data/States render-state INI/TXT profiles
 * (D3D fixed function) to Three.js material settings.
 *
 * Evidence: references/original/game/Data/States/*.ini and the *.txt includes
 * they reference (TextureParam.txt, Dino_TextureParamDual.txt, FogParam.txt).
 */

export interface OriginalTextureStage {
  stage: number;
  op: string;
  arg1: string;
  arg2: string;
  alphaOp: string;
  alphaArg1: string;
  alphaArg2: string;
  wrapU: string;
  wrapV: string;
  minFilter: string;
  magFilter: string;
  mipmap: boolean;
}

export interface OriginalStateProfile {
  /** Relative include files, in order, after normalization. */
  includes: string[];
  cullMode: string;
  zBufferWrite: boolean;
  texture: boolean;
  textureStages: OriginalTextureStage[];
  alphaBlend: boolean;
  alphaBlendSrc: string;
  alphaBlendDest: string;
  alphaTest: boolean;
  alphaTestRef: number;
  alphaTestFunc: string;
  fog: boolean;
  fogStart?: number;
  fogEnd?: number;
  fogColor?: number[];
  light: boolean;
  colorVertex: boolean;
  normalizeNormals: boolean;
  diffuseMatSource: string;
  specularMatSource: string;
  ambientMatSource: string;
  emissiveMatSource: string;
  /** Raw state values, keyed by lowercase state name. */
  values: Record<string, string>;
}

const bool = (value: string | undefined, fallback: boolean) => {
  if (!value) return fallback;
  const first = value.trim().split(/\s+/)[0]?.toLowerCase();
  if (first === 'y' || first === 'true') return true;
  if (first === 'n' || first === 'false') return false;
  return fallback;
};

const trailingWord = (value: string | undefined) =>
  value?.trim().split(/\s+/).at(-1)?.toLowerCase();

function stageValue(values: Record<string, string>, key: string, stage: number) {
  return trailingWord(values[`${key}\t${stage}`] ?? values[`${key} ${stage}`]);
}

function textureStages(values: Record<string, string>): OriginalTextureStage[] {
  const stages: OriginalTextureStage[] = [];
  for (let stage = 0; stage < 8; stage++) {
    const op = stageValue(values, 'textureop', stage);
    if (!op || op === 'disable') continue;
    stages.push({
      stage,
      op,
      arg1: stageValue(values, 'texturearg1', stage) ?? 'texture',
      arg2: stageValue(values, 'texturearg2', stage) ?? 'current',
      alphaOp: stageValue(values, 'texturealphaop', stage) ?? op,
      alphaArg1: stageValue(values, 'texturealphaarg1', stage) ?? 'texture',
      alphaArg2: stageValue(values, 'texturealphaarg2', stage) ?? 'diffuse',
      wrapU: stageValue(values, 'texturewrapu', stage) ?? 'wrap',
      wrapV: stageValue(values, 'texturewrapv', stage) ?? 'wrap',
      minFilter: stageValue(values, 'textureminfilter', stage) ?? 'linear',
      magFilter: stageValue(values, 'texturemagfilter', stage) ?? 'linear',
      mipmap: bool(stageValue(values, 'texturemipmap', stage), false),
    });
  }
  return stages;
}

const alphaRef = (profile: OriginalStateProfile) => {
  if (!profile.alphaTest) return 0;
  // GreaterEqual keeps visible pixels at/above ref; LessEqual keeps visible
  // pixels at/below ref, matching the original comparison direction.
  return profile.alphaTestFunc === 'lessequal'
    ? 1 - profile.alphaTestRef / 255
    : profile.alphaTestRef / 255;
};

const side = (profile: OriginalStateProfile) => {
  const cull = profile.cullMode;
  // Original D3D culling: CCW = cull counter-clockwise (front), Both = no cull.
  if (cull === 'both' || cull === 'none') return 2; // THREE.DoubleSide
  if (cull === 'cw') return 0; // THREE.FrontSide
  return 1; // CCW/culled front => render back faces: THREE.BackSide
};

/** Parse one state INI/TXT file. Values from includes are not merged here. */
export function parseOriginalStateIni(text: string): OriginalStateProfile {
  const values: Record<string, string> = {};
  const includes: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split(';')[0].trim();
    const match = /^mgState(\w+)(?:\s+(\d+))?\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    // Indexed texture-stage states are 0..7; any other trailing number is the
    // scalar value itself (mgStateAlphaTestRef 1).
    const indexedKey = STAGE_INDEXED_KEYS.has(key);
    const index = match[2] !== undefined && indexedKey ? match[2] : undefined;
    const value = (index ? match[3] : `${match[2] ?? ''} ${match[3]}`).trim();
    if (key === 'include') {
      if (value) includes.push(value.toLowerCase());
      continue;
    }
    values[index ? `${key}\t${index}` : key] = value;
  }
  const profile: OriginalStateProfile = {
    includes,
    cullMode: trailingWord(values['cullmode']) ?? 'ccw',
    zBufferWrite: bool(values['zbufferwrite'], true),
    texture: bool(values['texture'], false),
    textureStages: textureStages(values),
    alphaBlend: bool(values['alphablend'], false),
    alphaBlendSrc: trailingWord(values['alphablendsrc']) ?? 'srcalpha',
    alphaBlendDest: trailingWord(values['alphablenddest']) ?? 'invsrcalpha',
    alphaTest: bool(values['alphatest'], false),
    alphaTestRef: Number(values['alphatestref'] ?? 0) || 0,
    alphaTestFunc: trailingWord(values['alphatestfunc']) ?? 'greater',
    fog: bool(values['fog'], false),
    light: bool(values['light'], false),
    colorVertex: bool(values['colorvertex'], false),
    normalizeNormals: bool(values['normalizenormals'], false),
    diffuseMatSource: trailingWord(values['diffusematsource']) ?? 'material',
    specularMatSource: trailingWord(values['specularmatsource']) ?? 'material',
    ambientMatSource: trailingWord(values['ambientmatsource']) ?? 'material',
    emissiveMatSource: trailingWord(values['emissivematsource']) ?? 'material',
    values,
  };
  if (profile.fog) {
    profile.fogStart = Number(values['fogdiststart']);
    profile.fogEnd = Number(values['fogdistend']);
    profile.fogColor = (values['fogdistcolor'] ?? '')
      .split(',').map(part => Number(part.trim()));
    if (!Number.isFinite(profile.fogStart)) delete profile.fogStart;
    if (!Number.isFinite(profile.fogEnd)) delete profile.fogEnd;
    if (profile.fogColor?.length !== 3 || profile.fogColor.some(Number.isNaN)) delete profile.fogColor;
  }
  // FogParam.txt carries only distances/color; their presence still means fog.
  if (!profile.fog && (values['fogdiststart'] !== undefined || values['fogdistend'] !== undefined)) {
    profile.fog = true;
    profile.fogStart = Number(values['fogdiststart']);
    profile.fogEnd = Number(values['fogdistend']);
    profile.fogColor = (values['fogdistcolor'] ?? '')
      .split(',').map(part => Number(part.trim()));
    if (!Number.isFinite(profile.fogStart)) delete profile.fogStart;
    if (!Number.isFinite(profile.fogEnd)) delete profile.fogEnd;
    if (profile.fogColor?.length !== 3 || profile.fogColor.some(Number.isNaN)) delete profile.fogColor;
  }
  return profile;
}

const STAGE_INDEXED_KEYS = new Set([
  'textureop', 'texturearg1', 'texturearg2', 'texturearg3',
  'texturealphaop', 'texturealphaarg1', 'texturealphaarg2', 'texturealphaarg3',
  'textureresultarg', 'texturecoordindex', 'texturewrapu', 'texturewrapv',
  'texturewrapw', 'texturebordercolor', 'textureminfilter', 'texturemagfilter',
  'texturemipmap', 'texturemipfilter', 'texturemipmaplodbias',
  'texturemaxmiplevel', 'texturemaxanisotropy', 'texturetransform',
  'texturebumpenvmat00', 'texturebumpenvmat01', 'texturebumpenvmat10',
  'texturebumpenvmat11', 'texturebumpenvlscale', 'texturebumpenvloffset',
]);

/** Merge include values (already parsed, same keys) into a parent profile. */
export function mergeOriginalStateProfiles(
  parent: OriginalStateProfile,
  ...includes: OriginalStateProfile[]
): OriginalStateProfile {
  const values = { ...parent.values };
  const extraIncludes = new Set(parent.includes);
  for (const include of includes) {
    Object.assign(values, include.values);
    for (const name of include.includes) extraIncludes.add(name);
  }
  return { ...parseOriginalStateIniFromValues(values), includes: [...extraIncludes] };
}

function parseOriginalStateIniFromValues(values: Record<string, string>): OriginalStateProfile {
  return parseOriginalStateIni(
    Object.entries(values).map(([key, value]) =>
      `mgState${key.replace(/\t/g, ' ')} ${value}`).join('\n'),
  );
}

export interface OriginalSkinMaterial {
  ambient: number;
  diffuse: number;
  specular: number;
  emissive: number;
}

/**
 * In the dino states (e.g. Dino_DualTexturing.ini) lighting is disabled and
 * the diffuse material source is Color1 (baked vertex color), while
 * TextureLighted.ini uses the material diffuse with lighting enabled.
 */
export function originalDiffuseColor(
  profile: OriginalStateProfile,
  material: OriginalSkinMaterial,
): number {
  const source = profile.diffuseMatSource;
  if (source === 'color1') return 0xffffffff;
  if (source === 'color2') return 0xffffffff;
  if (source === 'emissive') return material.emissive;
  if (source === 'specular') return material.specular;
  return material.diffuse;
}

export interface OriginalMaterialMapping {
  side: number; // THREE.Side numeric values
  transparent: boolean;
  opacity: number;
  alphaTest: number;
  depthWrite: boolean;
  diffuseColor: number;
  lit: boolean;
  dualTexture: boolean;
}

export function mapOriginalStateToMaterial(
  profile: OriginalStateProfile,
  material: OriginalSkinMaterial,
): OriginalMaterialMapping {
  const firstStage = profile.textureStages[0];
  return {
    side: side(profile),
    transparent: profile.alphaBlend,
    opacity: 1,
    alphaTest: alphaRef(profile),
    depthWrite: profile.zBufferWrite,
    diffuseColor: originalDiffuseColor(profile, material),
    lit: profile.light,
    dualTexture: !!firstStage &&
      firstStage.op === 'modulate' &&
      profile.textureStages[1]?.op === 'blendtexturealpha',
  };
}
