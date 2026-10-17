import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  loadOriginalOverlayFiles,
  parseGraphicDatabase,
  parseIni,
  parseWidgetHierarchy,
  flattenWidgets,
} from "../src/park-interface.ts";

const REF = new URL("../references/original/game/Data/Overlay/", import.meta.url).pathname;

const INTERFACE_PATH = `${REF}ParkInterface.Ini`;
const GRAPHIC_DB_PATH = `${REF}ParkGraphicDB.Ini`;

test("parses sections while preserving raw localized strings", () => {
  const ini = parseIni([
    "[W]",
    'TYPE = "BUTTON"',
    'HINT = "&NavZoomIn"',
    "X = 31",
  ].join("\n"));
  const w = ini.byName["W"]!;
  assert.equal(w.values["TYPE"]!.text, "BUTTON");
  assert.equal(w.values["HINT"]!.raw, `"&NavZoomIn"`);
  assert.equal(w.values["HINT"]!.text, "&NavZoomIn");
  assert.equal(w.values["X"]!.number, 31);
});

test("builds ParkInterface hierarchy with typed parents", () => {
  const { widgets, widgetsFlat } = loadOriginalOverlayFiles(INTERFACE_PATH, GRAPHIC_DB_PATH);
  assert.equal(widgets.name, "ROOT");
  const names = widgetsFlat.map((w) => w.name);
  assert.ok(names.includes("RENDERVIEW"));
  assert.ok(names.includes("NAVIGATION_PANEL"));

  const panel = widgetsFlat.find((w) => w.name === "NAVIGATION_PANEL")!;
  assert.equal(panel.type, "WIDGET");
  assert.equal(panel.parent, "ROOT");
  assert.deepEqual(panel.bounds, { x: 640, y: 289, width: 83, height: 128 });
  assert.ok(panel.children.some((c) => c.name === "NAVIGATION_ZOOM"));
  const zoom = panel.children.find((c) => c.name === "NAVIGATION_ZOOM")!;
  assert.equal(zoom.type, "BUTTON");
  assert.equal(zoom.parent, "NAVIGATION_PANEL");
  assert.equal(zoom.values["HINT"]!.text, "&NavZoomIn");
});

test("computes nested absolute bounds", () => {
  const { widgetsFlat } = loadOriginalOverlayFiles(INTERFACE_PATH, GRAPHIC_DB_PATH);
  const panel = widgetsFlat.find((w) => w.name === "NAVIGATION_PANEL")!;
  const zoom = widgetsFlat.find((w) => w.name === "NAVIGATION_ZOOM")!;
  assert.deepEqual(zoom.absoluteBounds, {
    x: panel.absoluteBounds.x + zoom.bounds.x,
    y: panel.absoluteBounds.y + zoom.bounds.y,
    width: zoom.bounds.width,
    height: zoom.bounds.height,
  });
});

test("respects widget priority ordering", () => {
  const { widgetsFlat } = loadOriginalOverlayFiles(INTERFACE_PATH, GRAPHIC_DB_PATH);
  const mapPanel = widgetsFlat.findIndex((w) => w.name === "MAP_PANEL");
  const timePanel = widgetsFlat.findIndex((w) => w.name === "TIME_PANEL");
  assert.ok(mapPanel !== -1 && timePanel !== -1);
  // TIME_PANEL (priority 0) must precede MAP_PANEL (priority 10) in draw order.
  assert.ok(timePanel < mapPanel);
});

test("parses ParkGraphicDB texture rectangles", () => {
  const graphics = parseGraphicDatabase(parseIni(readFileSync(GRAPHIC_DB_PATH, "latin1")));
  const zoom = graphics.get("ZOOM_BUTTON");
  assert.ok(zoom);
  assert.ok(zoom!.width > 0 && zoom!.height > 0);
  assert.match(zoom!.fileName, /^\.\/DATA\/OVERLAY\/TEXTURES\//);
});
