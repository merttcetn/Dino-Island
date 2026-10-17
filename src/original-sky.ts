/**
 * Pure parsers for the original island skybox and cloud descriptions.
 * Original isl01/cloud.ini includes ../cloudbase.ini; file access is injected.
 * Manifest keys follow scripts/prepare-assets.py: lowercase forward slashes.
 */

export type OriginalSkyFaceName = 'back' | 'bottom' | 'front' | 'left' | 'right' | 'top';
export type OriginalAssetManifest = Record<string, string>;

export interface OriginalCloudLayer {
  layer: 1 | 2;
  texture: string;
  basename: string;
  scale: number;
  speedX: number;
  speedY: number;
  manifestKey?: string;
  publicUrl?: string;
}

export interface OriginalSkyFace {
  face: OriginalSkyFaceName;
  texture: string;
  basename: string;
  manifestKey: string;
  publicUrl?: string;
}

export interface OriginalStateMetadata {
  includes: string[];
  fillMode?: string;
  cullMode?: string;
  shadeMode?: string;
  clip?: boolean;
  zBuffer?: boolean;
  zBufferWrite?: boolean;
  texture?: boolean;
  textureWrapU?: string;
  textureWrapV?: string;
  textureStageOps: string[];
  alphaBlend?: boolean;
  alphaBlendSrc?: string;
  alphaBlendDest?: string;
  alphaBlendOp?: string;
  alphaTest?: boolean;
  fog?: boolean;
  light?: boolean;
  colorVertex?: boolean;
  values: Record<string, string[]>;
}

export interface OriginalSkyInput {
  island: string;
  faceFiles: readonly string[];
  cloudIni: string;
  cloudIniPath?: string;
  readFile?: (path: string) => string;
  skyboxState?: string;
  cloudState?: string;
  manifest?: OriginalAssetManifest;
}

export interface OriginalSkyDefinition {
  island: string;
  faceOrder: readonly OriginalSkyFaceName[];
  faces: Record<OriginalSkyFaceName, OriginalSkyFace>;
  clouds: {
    configPath: string;
    includes: readonly string[];
    layers: [OriginalCloudLayer, OriginalCloudLayer];
    state?: OriginalStateMetadata;
  };
  skyboxState?: OriginalStateMetadata;
}

const FACES = ['back', 'bottom', 'front', 'left', 'right', 'top'] as const;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

interface IniEntry {
  section: string;
  key: string;
  value: string;
  line: number;
}

function withoutComment(line: string): string {
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index]!;
    if (character === '"') quoted = !quoted;
    if (quoted) continue;
    const atStart = line.slice(0, index).trim().length === 0;
    if (character === ';' || (character === '#' && line.trim()[0] !== '[')) return line.slice(0, index);
    if (character === '/' && line[index + 1] === '/' &&
        (atStart || /\s/.test(line[index - 1] ?? ''))) return line.slice(0, index);
  }
  return line;
}

function unquote(value: string): string {
  return value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))) ? value.slice(1, -1) : value;
}

function parseIni(source: string): IniEntry[] {
  const entries: IniEntry[] = [];
  const seen = new Set<string>();
  let current: string | null = null;
  const lines = source.replace(/^﻿/, '').split(/\r\n|\r|\n/);

  lines.forEach((raw, index) => {
    const line = withoutComment(raw).trim();
    if (!line) return;
    if (line.startsWith('[')) {
      const match = /^\[\s*([^\[\]]+?)\s*\]$/.exec(line);
      if (!match) throw new Error(`Malformed original INI section at line ${index + 1}`);
      current = match[1]!.toLowerCase();
      return;
    }
    if (!current) throw new Error(`Original INI key outside a section at line ${index + 1}`);
    const separator = line.indexOf('=');
    if (separator <= 0) throw new Error(`Malformed original INI key/value at line ${index + 1}`);
    const rawKey = line.slice(0, separator).trim();
    const value = unquote(line.slice(separator + 1).trim());
    if (!rawKey) throw new Error(`Malformed original INI key/value at line ${index + 1}`);
    const key = rawKey.toLowerCase();
    const identity = `${current}\0${key}`;
    if (seen.has(identity)) throw new Error(`Duplicate original INI key ${rawKey} in [${current}]`);
    seen.add(identity);
    entries.push({ section: current, key, value, line: index + 1 });
  });
  return entries;
}

export function normalizeOriginalPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || /^[a-z]:/i.test(normalized) || normalized.includes('\0')) {
    throw new Error(`Invalid original path: ${path}`);
  }
  return normalized;
}

function lowerPath(path: string): string {
  return normalizeOriginalPath(path).toLowerCase();
}

function includePath(source: string, relative: string): string {
  const sourceParts = normalizeOriginalPath(source).split('/').slice(0, -1);
  for (const part of normalizeOriginalPath(relative).split('/')) {
    if (part === '.') continue;
    if (part === '..') {
      if (!sourceParts.length) throw new Error(`Cloud INI include escapes its root: ${relative}`);
      sourceParts.pop();
    } else sourceParts.push(part);
  }
  return sourceParts.join('/');
}

function requireValue(entries: IniEntry[], section: string, key: string): string {
  const value = entries.find(entry => entry.section === section && entry.key === key)?.value;
  if (!value?.trim()) throw new Error(`Original cloud INI is missing ${key}`);
  return value;
}

function number(entries: IniEntry[], key: string, positive = false): number {
  const raw = requireValue(entries, 'graph', key);
  const parsed = NUMBER.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(`Original cloud INI ${key} is not finite: ${raw}`);
  if (positive && parsed <= 0) throw new Error(`Original cloud INI ${key} is not positive: ${raw}`);
  return parsed;
}

function texture(entries: IniEntry[], key: string): string {
  const value = requireValue(entries, 'graph', key);
  if (!normalizeOriginalPath(value)) throw new Error(`Original cloud INI ${key} is empty`);
  return value;
}

interface ParsedCloud {
  entries: IniEntry[];
  includes: string[];
}

function parseCloudSource(text: string, sourcePath: string, readFile: (path: string) => string, stack: string[] = []): ParsedCloud {
  const normalized = lowerPath(sourcePath);
  if (stack.includes(normalized)) throw new Error(`Circular cloud INI include: ${sourcePath}`);
  if (stack.length >= 16) throw new Error('Cloud INI include depth exceeds 16');
  const entries = parseIni(text);
  const includeEntries = entries
    .filter(entry => entry.section === '#include' && /^file\d+$/.test(entry.key))
    .sort((left, right) => Number(left.key.slice(4)) - Number(right.key.slice(4)));

  const includes: string[] = [];
  const collected: IniEntry[] = [];
  for (const entry of includeEntries) {
    const path = includePath(sourcePath, entry.value);
    const included = parseCloudSource(readFile(path), path, readFile, [...stack, normalized]);
    collected.push(...included.entries);
    includes.push(path, ...included.includes);
  }
  collected.push(...entries);
  return { entries: collected, includes };
}

/** Parse direct or included original cloud INI content. Includes are overridden by referring keys. */
export function parseOriginalCloudIni(
  text: string,
  context: { sourcePath: string; readFile: (path: string) => string },
): { graph: Map<string, string>; layers: [{ texture: string; scale: number; speedX: number; speedY: number }, { texture: string; scale: number; speedX: number; speedY: number }]; includes: string[] } {
  const parsed = parseCloudSource(text, context.sourcePath, context.readFile);
  const layers = [1, 2].map(index => ({
    texture: texture(parsed.entries, `layer${index}`),
    scale: number(parsed.entries, `scale${index}`, true),
    speedX: number(parsed.entries, `speed${index}x`),
    speedY: number(parsed.entries, `speed${index}y`),
  }));
  const graph = new Map(parsed.entries
    .filter(entry => entry.section === 'graph')
    .map(entry => [entry.key, entry.value] as const).reverse());
  return { graph, layers: [layers[0]!, layers[1]!], includes: parsed.includes };
}

/**
 * Resolve a manifest URL without fetching. Exact lowercase original paths are
 * preferred. Optional basename fallback is scoped and rejects ambiguity.
 */
export function resolveOriginalTextureUrl(
  manifest: OriginalAssetManifest,
  originalPath: string,
  options: { basenameFallback?: boolean; scope?: string } = {},
): string | undefined {
  const normalized = lowerPath(originalPath);
  const url = manifest[normalized];
  if (url !== undefined) {
    if (typeof url !== 'string' || !url) throw new Error(`Invalid manifest URL for ${normalized}`);
    return url;
  }
  if (!options.basenameFallback) return undefined;

  const basename = normalized.split('/').at(-1)!;
  const scope = options.scope === undefined ? '' : lowerPath(options.scope);
  const candidates = Object.keys(manifest)
    .filter(key => key.startsWith(scope) && key.split('/').at(-1) === basename)
    .sort();
  if (candidates.length > 1) throw new Error(`Ambiguous texture basename ${basename}: ${candidates.join(', ')}`);
  const resolved = candidates[0] ? manifest[candidates[0]!] : undefined;
  if (resolved !== undefined && (typeof resolved !== 'string' || !resolved)) {
    throw new Error(`Invalid manifest URL for ${candidates[0]}`);
  }
  return resolved;
}

function manifestReference(manifest: OriginalAssetManifest | undefined, path: string, fallback: boolean) {
  const manifestKey = lowerPath(path);
  if (!manifest) return { manifestKey };
  const publicUrl = resolveOriginalTextureUrl(manifest, path, {
    basenameFallback: fallback,
    scope: 'data/graphics/textures/skybox/',
  });
  if (!publicUrl) throw new Error(`Original asset manifest is missing ${manifestKey}`);
  return { manifestKey, publicUrl };
}

function parseStateBoolean(values: Record<string, string[]>, key: string): boolean | undefined {
  const value = values[key]?.[0]?.toLowerCase();
  if (value === undefined) return undefined;
  if (value === 'y' || value === 'true') return true;
  if (value === 'n' || value === 'false') return false;
  throw new Error(`Original state ${key} is not boolean: ${value}`);
}

function lastToken(value: string | undefined): string | undefined {
  return value?.trim().split(/\s+/).at(-1);
}

export function parseOriginalState(source: string): OriginalStateMetadata {
  const values: Record<string, string[]> = {};
  for (const raw of source.replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith(';') || line.startsWith('#')) continue;
    const match = /^mgState([A-Za-z0-9_]+)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    (values[key] ??= []).push(unquote(match[2]!));
  }

  return {
    includes: values['include'] ?? [],
    fillMode: values['fillmode']?.[0],
    cullMode: values['cullmode']?.[0],
    shadeMode: values['shademode']?.[0],
    clip: parseStateBoolean(values, 'clip'),
    zBuffer: parseStateBoolean(values, 'zbuffer'),
    zBufferWrite: parseStateBoolean(values, 'zbufferwrite'),
    texture: parseStateBoolean(values, 'texture'),
    textureWrapU: lastToken(values['texturewrapu']?.[0]),
    textureWrapV: lastToken(values['texturewrapv']?.[0]),
    textureStageOps: (values['textureop'] ?? []).map(lastToken).filter((value): value is string => value !== undefined),
    alphaBlend: parseStateBoolean(values, 'alphablend'),
    alphaBlendSrc: values['alphablendsrc']?.[0],
    alphaBlendDest: values['alphablenddest']?.[0],
    alphaBlendOp: values['alphablendop']?.[0],
    alphaTest: parseStateBoolean(values, 'alphatest'),
    fog: parseStateBoolean(values, 'fog'),
    light: parseStateBoolean(values, 'light'),
    colorVertex: parseStateBoolean(values, 'colorvertex'),
    values,
  };
}

function parseFaces(island: string, files: readonly string[], manifest?: OriginalAssetManifest) {
  const normalizedIsland = island.trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(normalizedIsland)) throw new Error(`Invalid skybox island: ${island}`);
  const found = new Map<OriginalSkyFaceName, OriginalSkyFace>();

  for (const file of files) {
    const basename = normalizeOriginalPath(file).split('/').at(-1)!;
    const match = /^(back|bottom|front|left|right|top)\.(png|tga|jpe?g)$/i.exec(basename);
    if (!match) continue;
    const face = match[1]!.toLowerCase() as OriginalSkyFaceName;
    if (found.has(face)) throw new Error(`Duplicate skybox face ${face}`);
    const originalPath = `data/graphics/textures/skybox/${normalizedIsland}/${basename}`;
    found.set(face, {
      face,
      texture: originalPath,
      basename,
      ...manifestReference(manifest, originalPath, false),
    });
  }

  const missing = FACES.filter(face => !found.has(face));
  if (missing.length) throw new Error(`Original skybox ${normalizedIsland} is missing faces: ${missing.join(', ')}`);
  return {
    faceOrder: FACES,
    faces: Object.fromEntries(FACES.map(face => [face, found.get(face)!])) as Record<OriginalSkyFaceName, OriginalSkyFace>,
  };
}

export function parseOriginalSky(input: OriginalSkyInput): OriginalSkyDefinition {
  const cloudIniPath = input.cloudIniPath ?? 'data/graphics/textures/skybox/cloud.ini';
  const cloud = parseOriginalCloudIni(input.cloudIni, {
    sourcePath: cloudIniPath,
    readFile: input.readFile ?? (() => {
      throw new Error('readFile is required to resolve original cloud INI includes');
    }),
  });
  const layers = cloud.layers.map((layer, index) => ({
    layer: (index + 1) as 1 | 2,
    texture: layer.texture,
    basename: layer.texture.split(/[\\/]/).at(-1)!.toLowerCase(),
    scale: layer.scale,
    speedX: layer.speedX,
    speedY: layer.speedY,
    ...manifestReference(input.manifest, layer.texture, true),
  }));

  return {
    island: input.island.trim().toLowerCase(),
    ...parseFaces(input.island, input.faceFiles, input.manifest),
    clouds: {
      configPath: lowerPath(cloudIniPath),
      includes: cloud.includes,
      layers: [layers[0]!, layers[1]!],
      state: input.cloudState === undefined ? undefined : parseOriginalState(input.cloudState),
    },
    skyboxState: input.skyboxState === undefined ? undefined : parseOriginalState(input.skyboxState),
  };
}
