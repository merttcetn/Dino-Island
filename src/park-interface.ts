/**
 * Typed, dependency-free parser for the original overlay interface files:
 *  - ParkInterface.Ini (widget hierarchy: TYPE / PARENT / bounds / priorities)
 *  - ParkGraphicDB.Ini (named texture rectangles)
 *
 * The parser is deliberately low-level: it preserves raw values (including
 * localized text such as `&NavZoomIn`) and does not build any scene objects.
 */


export interface IniValue {
  /** Value exactly as written in the file (trimmed of outer whitespace). */
  readonly raw: string;
  /** Quoted-string value, or the raw value without quotes. */
  readonly text: string;
  /** Numeric value when the raw value is a plain number, otherwise null. */
  readonly number: number | null;
}

export interface IniSection {
  readonly name: string;
  readonly values: Readonly<Record<string, IniValue>>;
  readonly keyOrder: readonly string[];
}

export interface ParsedIni {
  readonly sections: readonly IniSection[];
  readonly byName: Readonly<Record<string, IniSection>>;
}

export interface WidgetNode {
  readonly name: string;
  readonly type: string;
  readonly parent: string;
  readonly values: Readonly<Record<string, IniValue>>;
  readonly priority: number;
  readonly zPriority: number;
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly children: WidgetNode[];
  /** Bounds in root coordinates, after hierarchy resolution. */
  readonly absoluteBounds: { x: number; y: number; width: number; height: number };
  /** Full priority path used to establish draw order (parents first). */
  readonly orderKey: readonly number[];
}

export interface GraphicRect {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Texture file name exactly as stored in the INI. */
  readonly fileName: string;
}

const NUMERIC_KEYS = new Set([
  "X", "Y", "WIDTH", "HEIGHT",
  "PRIORITY", "ZPRIORITY",
  "VISIBLE", "ENABLE",
]);

function makeValue(rawInput: string): IniValue {
  const raw = rawInput.trim();
  const quoted =
    (raw.startsWith(`"`) && raw.endsWith(`"`)) ||
    (raw.startsWith(`'`) && raw.endsWith(`'`));
  const text = quoted && raw.length >= 2 ? raw.slice(1, -1) : raw;
  const number = /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : null;
  return { raw, text, number };
}

/** Parse INI text into ordered sections. `;` and `#` comments are ignored. */
export function parseIni(text: string): ParsedIni {
  const sections: IniSection[] = [];
  const byName: Record<string, IniSection> = {};
  let current: { name: string; values: Record<string, IniValue>; keyOrder: string[] } | null = null;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("#")) continue;
    const section = /^\[([^\]]+)\]\s*$/.exec(trimmed);
    if (section) {
      const name = section[1]!;
      current = { name, values: {}, keyOrder: [] };
      sections.push(current);
      byName[name] = current;
      continue;
    }
    const pair = /^([^=]+?)\s*=\s*(.*)$/.exec(trimmed);
    if (!pair || !current) continue;
    const key = pair[1]!.trim().toUpperCase();
    current.values[key] = makeValue(pair[2]!);
    current.keyOrder.push(key);
  }

  return { sections, byName };
}

function value(section: IniSection | undefined, key: string): IniValue | undefined {
  return section?.values[key.toUpperCase()];
}

/** Decode original Windows-1252 text so localized accents survive. */
export function readIniFile(path: string): string {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => { readFileSync(path: string, encoding?: string): string } } }).process;
  const fs = proc?.getBuiltinModule?.("node:fs");
  if (!fs) throw new Error("File reading requires a Node.js runtime");
  return fs.readFileSync(path, "latin1");
}

function normalizeBounds(section: IniSection): { x: number; y: number; width: number; height: number } {
  const get = (key: string): number => value(section, key)?.number ?? 0;
  return { x: get("X"), y: get("Y"), width: get("WIDTH"), height: get("HEIGHT") };
}

/**
 * Parse a widget INI (ParkInterface.Ini and included files) into a resolved
 * widget hierarchy rooted at a synthetic ROOT node.
 */
export function parseWidgetHierarchy(ini: ParsedIni): WidgetNode {
  type Builder = {
    name: string; type: string; parent: string;
    values: Readonly<Record<string, IniValue>>;
    priority: number; zPriority: number;
    bounds: { x: number; y: number; width: number; height: number };
    children: Builder[];
    absoluteBounds: { x: number; y: number; width: number; height: number };
    orderKey: number[];
    orderIndex: number;
  };
  const nodes: Builder[] = ini.sections
    .filter((section) => section.name !== "#INCLUDE" && value(section, "TYPE"))
    .map((section) => {
      const type = value(section, "TYPE")!.text.toUpperCase();
      const bounds = normalizeBounds(section);
      return {
        name: section.name,
        type,
        parent: value(section, "PARENT")?.text.toUpperCase() ?? "ROOT",
        values: section.values,
        priority: value(section, "PRIORITY")?.number ?? 0,
        zPriority: value(section, "ZPRIORITY")?.number ?? 0,
        bounds,
        children: [] as Builder[],
        absoluteBounds: { ...bounds },
        orderKey: [] as number[],
        orderIndex: 0,
      };
    });

  const byName = new Map(nodes.map((node) => [node.name, node]));
  const roots: Builder[] = [];
  for (const node of nodes) {
    const parentNode = byName.get(node.parent);
    if (parentNode && parentNode !== node) parentNode.children.push(node);
    else roots.push(node);
  }

  const sortRec = (list: Builder[], prefix: number[], origin: { x: number; y: number }): void => {
    list.sort((a, b) =>
      a.priority - b.priority ||
      a.zPriority - b.zPriority ||
      a.orderIndex! - b.orderIndex!,
    );
    for (const [index, node] of list.entries()) {
      node.orderKey = [...prefix, node.priority, node.zPriority, index];
      node.absoluteBounds = {
        x: origin.x + node.bounds.x,
        y: origin.y + node.bounds.y,
        width: node.bounds.width,
        height: node.bounds.height,
      };
      sortRec(node.children, node.orderKey, {
        x: node.absoluteBounds.x,
        y: node.absoluteBounds.y,
      });
    }
  };

  // Keep declaration order as final tie-breaker.
  nodes.forEach((node, index) => (node.orderIndex = index));
  sortRec(roots, [], { x: 0, y: 0 });

  const root: Builder = {
    name: "ROOT",
    type: "ROOT",
    parent: "",
    values: {},
    priority: 0,
    zPriority: 0,
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    children: roots,
    absoluteBounds: { x: 0, y: 0, width: 0, height: 0 },
    orderKey: [],
    orderIndex: -1,
  };
  return root as unknown as WidgetNode;
}

/** Flatten hierarchy in deterministic draw order (parents before children). */
export function flattenWidgets(root: WidgetNode): WidgetNode[] {
  const out: WidgetNode[] = [];
  const walk = (node: WidgetNode): void => {
    if (node.name !== "ROOT") out.push(node);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return out;
}

/** Parse ParkGraphicDB.Ini into named texture rectangles. */
export function parseGraphicDatabase(ini: ParsedIni): Map<string, GraphicRect> {
  const out = new Map<string, GraphicRect>();
  for (const section of ini.sections) {
    if (section.name === "#INCLUDE") continue;
    if (!value(section, "FILENAME")) continue;
    const b = normalizeBounds(section);
    out.set(section.name, {
      name: section.name,
      ...b,
      fileName: value(section, "FILENAME")!.text,
    });
  }
  return out;
}

/** Read + parse both original files from local references. */
export function loadOriginalOverlayFiles(
  interfacePath: string,
  graphicDbPath: string,
): { widgets: WidgetNode; widgetsFlat: WidgetNode[]; graphics: Map<string, GraphicRect> } {
  const widgets = parseWidgetHierarchy(parseIni(readIniFile(interfacePath)));
  const graphics = parseGraphicDatabase(parseIni(readIniFile(graphicDbPath)));
  return { widgets, widgetsFlat: flattenWidgets(widgets), graphics };
}

/** Read + decode a remote INI using the original Windows-1252 encoding. */
export async function fetchIniFile(url: string): Promise<ParsedIni> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return parseIni(new TextDecoder("windows-1252").decode(await response.arrayBuffer()));
}

/** Load the public overlay files without Node-specific APIs. */
export async function loadRemoteOverlayFiles(
  interfaceUrl: string,
  graphicDbUrl: string,
): Promise<{ widgets: WidgetNode; widgetsFlat: WidgetNode[]; graphics: Map<string, GraphicRect> }> {
  const [interfaceIni, graphicIni] = await Promise.all([
    fetchIniFile(interfaceUrl),
    fetchIniFile(graphicDbUrl),
  ]);
  const widgets = parseWidgetHierarchy(interfaceIni);
  return { widgets, widgetsFlat: flattenWidgets(widgets), graphics: parseGraphicDatabase(graphicIni) };
}

export interface WidgetAlignment {
  readonly left: boolean;
  readonly right: boolean;
  readonly up: boolean;
  readonly down: boolean;
}

/** Original alignment flags, ignoring commented-out keys. */
export function widgetAlignment(node: WidgetNode): WidgetAlignment {
  const flag = (key: string): boolean => node.values[key]?.number === 1;
  return {
    left: flag("ALIGN_LEFT"),
    right: flag("ALIGN_RIGHT"),
    up: flag("ALIGN_UP"),
    down: flag("ALIGN_DOWN"),
  };
}

/** Convert absolute 800×600 bounds into the UI's right/bottom anchor. */
export function widgetAnchor(
  node: WidgetNode,
  reference = { width: 800, height: 600 },
): { right?: number; bottom?: number; left?: number; top?: number; width: number; height: number } {
  const bounds = node.absoluteBounds;
  const alignment = widgetAlignment(node);
  return {
    ...(alignment.right ? { right: reference.width - bounds.x - bounds.width } : { left: bounds.x }),
    ...(alignment.down ? { bottom: reference.height - bounds.y - bounds.height } : { top: bounds.y }),
    width: bounds.width,
    height: bounds.height,
  };
}

/** Map an original TGA atlas reference to the prepared PNG atlas URL. */
export function overlayTextureUrl(fileName: string): string {
  const png = fileName.replace(/\.tga$/i, ".png").split(/[\\/]/).pop() ?? fileName;
  return `/assets/original-ui/${png}`;
}

export type { IniValue as ParkInterfaceValue, WidgetNode as ParkWidgetNode, GraphicRect as ParkGraphicRect };
