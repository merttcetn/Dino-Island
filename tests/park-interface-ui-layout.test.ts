import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  overlayTextureUrl,
  parseGraphicDatabase,
  parseIni,
  parseWidgetHierarchy,
  flattenWidgets,
  widgetAlignment,
  widgetAnchor,
} from "../src/park-interface.ts";

const REF = new URL("../references/original/game/Data/Overlay/", import.meta.url).pathname;
const text = (name: string) => readFileSync(`${REF}${name}`, "latin1");

test("resolves exact ParkInterface HUD roots to right/bottom anchors", () => {
  const widgets = flattenWidgets(parseWidgetHierarchy(parseIni(text("ParkInterface.Ini"))));
  const byName = new Map(widgets.map(node => [node.name, node]));
  const gauge = byName.get("GAUGE_PANEL")!;
  assert.deepEqual(widgetAlignment(gauge), { left: false, right: true, up: false, down: true });
  assert.deepEqual(widgetAnchor(gauge), { right: 113, bottom: 0, width: 618, height: 31 });
  const navigation = byName.get("NAVIGATION_PANEL")!;
  assert.deepEqual(widgetAnchor(navigation), { right: 77, bottom: 183, width: 83, height: 128 });
});

test("keeps construction and purchase shells aligned to original widget bounds", () => {
  const construction = flattenWidgets(
    parseWidgetHierarchy(parseIni(text("ConstructionInterface.Ini"))),
  );
  const byName = new Map(construction.map(node => [node.name, node]));
  const shell = byName.get("CONSTRUCTION_PANEL")!;
  assert.deepEqual(shell.absoluteBounds, { x: 592, y: 122, width: 112, height: 48 });
  assert.deepEqual(widgetAnchor(shell), { right: 96, bottom: 430, width: 112, height: 48 });
  const purchase = byName.get("DINO_ACHAT_SAVE_PANEL")!;
  assert.deepEqual(purchase.absoluteBounds, { x: 80, y: 25, width: 455, height: 525 });
  assert.deepEqual(widgetAnchor(purchase), { right: 265, bottom: 50, width: 455, height: 525 });
  const fence = byName.get("OPEN_CONSTRUCTION_FENCE")!;
  assert.deepEqual(fence.bounds, { x: 12, y: 9, width: 28, height: 28 });
  assert.equal(fence.values["TEXTURE"]!.text, "CONSTRUCTION_FENCE");
});

test("maps original atlas rectangles to prepared PNG URLs", () => {
  const graphics = parseGraphicDatabase(parseIni(text("ParkGraphicDB.Ini")));
  const shell = graphics.get("CONSTRUCTION_ATTRACTION_PANEL_IMAGE")!;
  assert.deepEqual(
    { x: shell.x, y: shell.y, width: shell.width, height: shell.height },
    { x: 0, y: 51, width: 112, height: 48 },
  );
  assert.equal(overlayTextureUrl(shell.fileName), "/assets/original-ui/menu_droite_menu_const_Attr&Encl.png");
});
