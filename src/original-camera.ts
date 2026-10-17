/**
 * Parser for the original Data/Config/camera.ini.
 * Hardness values are start/end spring progressions and, unlike the camera
 * bounds above, intentionally allow the original's descending 6 -> 2 profile.
 */

export interface OriginalCameraRange {
  min: number;
  max: number;
}

export interface OriginalCameraProgression {
  start: number;
  end: number;
}

export interface OriginalCameraConfig {
  moveSpeed: OriginalCameraRange;
  progressSpeed: OriginalCameraRange;
  rotationSpeed: OriginalCameraRange;
  elevation: OriginalCameraRange;
  distance: OriginalCameraRange;
  targetHardness: OriginalCameraProgression;
  positionHardness: OriginalCameraProgression;
  extraFields: Record<string, number>;
}

export type OriginalCameraConfigId = 'Config1' | 'Config2' | 'Config3' | 'Config4' | 'Config5';

export type OriginalCameraConfigs = Record<OriginalCameraConfigId, OriginalCameraConfig>;

const CONFIG_IDS = ['Config1', 'Config2', 'Config3', 'Config4', 'Config5'] as const;

class CameraIniParser {
  private readonly sections = new Map<OriginalCameraConfigId, Map<string, string>>();
  private currentConfig: OriginalCameraConfigId | null = null;
  private readonly currentKeys = new Set<string>();

  constructor(private readonly source: string) {}

  parse(): OriginalCameraConfigs {
    this.currentConfig = null;
    this.currentKeys.clear();
    const lines = this.source.replace(/^﻿/, '').split(/\r\n|\r|\n/);

    lines.forEach((rawLine, index) => {
      const line = this.withoutComment(rawLine).trim();
      if (!line) return;
      if (line.startsWith('[')) this.readSection(line, index + 1);
      else if (this.currentConfig) this.readValue(line, index + 1);
      else throw new Error(`Original camera INI key outside a Config section at line ${index + 1}`);
    });

    const missing = CONFIG_IDS.filter(id => !this.sections.has(id));
    if (missing.length > 0) throw new Error(`Original camera INI is missing section(s): ${missing.join(', ')}`);
    return {
      Config1: this.cameraConfig('Config1'),
      Config2: this.cameraConfig('Config2'),
      Config3: this.cameraConfig('Config3'),
      Config4: this.cameraConfig('Config4'),
      Config5: this.cameraConfig('Config5'),
    };
  }

  private withoutComment(line: string) {
    const comment = line.search(/[;#]/);
    return comment < 0 ? line : line.slice(0, comment);
  }

  private readSection(line: string, lineNumber: number) {
    const match = /^\[\s*([^\[\]]+?)\s*\]$/.exec(line);
    if (!match) throw new Error(`Malformed original camera INI section at line ${lineNumber}`);

    const name = match[1]!;
    const configId = CONFIG_IDS.find(id => id.toLowerCase() === name.toLowerCase());
    if (!configId) throw new Error(`Unexpected original camera INI section [${name}]`);
    if (this.sections.has(configId)) throw new Error(`Duplicate original camera INI section [${name}]`);

    this.currentConfig = configId;
    this.currentKeys.clear();
    this.sections.set(configId, new Map());
  }

  private readValue(line: string, lineNumber: number) {
    const separator = line.indexOf('=');
    if (separator <= 0) throw new Error(`Malformed original camera INI key/value at line ${lineNumber}`);

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!key) throw new Error(`Malformed original camera INI key/value at line ${lineNumber}`);

    const normalizedKey = key.toLowerCase();
    if (this.currentKeys.has(normalizedKey)) {
      throw new Error(`Duplicate original camera INI key ${key} in [${this.currentConfig}]`);
    }

    const parsed = Number(value);
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(parsed)) {
      throw new Error(`Original camera INI value for ${key} in [${this.currentConfig}] is not a finite number`);
    }

    this.currentKeys.add(normalizedKey);
    this.sections.get(this.currentConfig!)!.set(normalizedKey, value);
  }

  private number(configId: OriginalCameraConfigId, values: Map<string, string>, key: string) {
    const value = values.get(key.toLowerCase());
    if (value === undefined) throw new Error(`Original camera INI [${configId}] is missing ${key}`);
    return Number(value);
  }

  private range(configId: OriginalCameraConfigId, values: Map<string, string>, prefix: string): OriginalCameraRange {
    const min = this.number(configId, values, `${prefix}Min`);
    const max = this.number(configId, values, `${prefix}Max`);
    if (min > max) throw new Error(`Invalid original camera ${prefix} range in [${configId}]: ${min} > ${max}`);
    return { min, max };
  }

  private progression(configId: OriginalCameraConfigId, values: Map<string, string>, prefix: string): OriginalCameraProgression {
    return {
      start: this.number(configId, values, `${prefix}Min`),
      end: this.number(configId, values, `${prefix}Max`),
    };
  }

  private cameraConfig(configId: OriginalCameraConfigId): OriginalCameraConfig {
    const values = this.sections.get(configId)!;
    const knownKeys = new Set([
      'movespeedmin', 'movespeedmax',
      'progressspeedmin', 'progressspeedmax',
      'rotationspeedmin', 'rotationspeedmax',
      'elevationmin', 'elevationmax',
      'distancemin', 'distancemax',
      'targethardnessmin', 'targethardnessmax',
      'positionhardnessmin', 'positionhardnessmax',
    ]);
    const extraFields: Record<string, number> = {};
    for (const [key, value] of values) {
      if (!knownKeys.has(key)) extraFields[key] = Number(value);
    }

    return {
      moveSpeed: this.range(configId, values, 'MoveSpeed'),
      progressSpeed: this.range(configId, values, 'ProgressSpeed'),
      rotationSpeed: this.range(configId, values, 'RotationSpeed'),
      elevation: this.range(configId, values, 'Elevation'),
      distance: this.range(configId, values, 'Distance'),
      targetHardness: this.progression(configId, values, 'TargetHardness'),
      positionHardness: this.progression(configId, values, 'PositionHardness'),
      extraFields,
    };
  }
}

export function parseOriginalCameraIni(source: string): OriginalCameraConfigs {
  return new CameraIniParser(source).parse();
}
