// Atlas coordinates come from the original ParkGraphicDB.Ini, not a screenshot.
import {
  loadRemoteOverlayFiles,
  overlayTextureUrl,
  widgetAnchor,
  type ParkWidgetNode,
} from './park-interface.ts';

export type UIAction =
  | { type: 'panel'; panel: 'dinosaurs' | 'build' | 'genetics' | 'park' | 'settings' }
  | { type: 'save' } | { type: 'load' } | { type: 'home' }
  | { type: 'rotate'; direction: number } | { type: 'zoom'; direction: number }
  | { type: 'pause' } | { type: 'speed'; speed: number }
  | { type: 'tool'; tool: string } | { type: 'spawn'; species: string }
  | { type: 'breed'; first: string; second: string } | { type: 'feed'; id: number }
  | { type: 'close' } | { type: 'audio' };

export interface UIData {
  money: number; visitors: number; dinosaurCount: number; happiness: number;
  day: number; time: number; paused: boolean; speed: number;
  selectedDinosaur?: { id: number; name: string; species: string; hunger: number; happiness: number };
  species: Array<{ id: string; name: string; cost: number; thumbnail?: string }>;
  buildItems: Array<{ id: string; name: string; cost: number }>;
  dinosaurs: Array<{ id: number; name: string; species: string }>;
  objectives?: Array<{ title: string; complete: boolean; progress?: string }>;
}

interface SpriteDefinition { file: string; x: number; y: number; w: number; h: number; frames: number }
const SPRITES: Record<string, SpriteDefinition> = {
  "RIGHT_PANEL_IMAGE_TOP": {
    "file": "menu_droite_pans.png",
    "x": 0,
    "y": 0,
    "w": 93,
    "h": 223,
    "frames": 1
  },
  "RIGHT_PANEL_IMAGE_BOTTOM": {
    "file": "menu_droite_pans.png",
    "x": 94,
    "y": 0,
    "w": 77,
    "h": 194,
    "frames": 1
  },
  "RIGHT_PANEL_IMAGE_LEFT": {
    "file": "menu_droite_pans.png",
    "x": 173,
    "y": 0,
    "w": 83,
    "h": 128,
    "frames": 1
  },
  "MAP_PANEL_IMAGE": {
    "file": "mini_map.png",
    "x": 0,
    "y": 0,
    "w": 183,
    "h": 183,
    "frames": 1
  },
  "ZOOM_BUTTON": {
    "file": "menu_droite_pans.png",
    "x": 173,
    "y": 129,
    "w": 16,
    "h": 16,
    "frames": 5
  },
  "DEZOOM_BUTTON": {
    "file": "menu_droite_pans.png",
    "x": 173,
    "y": 145,
    "w": 16,
    "h": 16,
    "frames": 5
  },
  "GORIGHT_BUTTON": {
    "file": "menu_droite_pans.png",
    "x": 173,
    "y": 174,
    "w": 13,
    "h": 13,
    "frames": 5
  },
  "GOLEFT_BUTTON": {
    "file": "menu_droite_pans.png",
    "x": 173,
    "y": 200,
    "w": 13,
    "h": 13,
    "frames": 5
  },
  "GOTOP_BUTTON": {
    "file": "menu_droite_pans.png",
    "x": 173,
    "y": 161,
    "w": 13,
    "h": 13,
    "frames": 5
  },
  "GOBOTTOM_BUTTON": {
    "file": "menu_droite_pans.png",
    "x": 173,
    "y": 187,
    "w": 13,
    "h": 13,
    "frames": 5
  },
  "TURNRIGHT_BUTTON": {
    "file": "menu_droite_pans.png",
    "x": 173,
    "y": 233,
    "w": 10,
    "h": 20,
    "frames": 5
  },
  "TURNLEFT_BUTTON": {
    "file": "menu_droite_pans.png",
    "x": 173,
    "y": 213,
    "w": 10,
    "h": 20,
    "frames": 5
  },
  "LABO_ICON": {
    "file": "menu_droite_bouts.png",
    "x": 0,
    "y": 0,
    "w": 46,
    "h": 47,
    "frames": 5
  },
  "CONSTRUCTION_ICON": {
    "file": "menu_droite_bouts.png",
    "x": 0,
    "y": 47,
    "w": 35,
    "h": 36,
    "frames": 5
  },
  "BUILDING_ICON": {
    "file": "menu_droite_bouts.png",
    "x": 0,
    "y": 83,
    "w": 35,
    "h": 36,
    "frames": 5
  },
  "TRANSPORT_ICON": {
    "file": "menu_droite_bouts.png",
    "x": 0,
    "y": 119,
    "w": 35,
    "h": 36,
    "frames": 5
  },
  "PURCHASE_ICON": {
    "file": "menu_droite_bouts.png",
    "x": 0,
    "y": 155,
    "w": 35,
    "h": 36,
    "frames": 5
  },
  "OPTIONS_ICON": {
    "file": "menu_droite_bouts.png",
    "x": 0,
    "y": 191,
    "w": 35,
    "h": 36,
    "frames": 5
  },
  "GAUGE_PANEL_PART_LEFT": {
    "file": "menu_bas.png",
    "x": 0,
    "y": 0,
    "w": 13,
    "h": 31,
    "frames": 1
  },
  "BUDGET_PANEL_BUTTON": {
    "file": "menu_bas.png",
    "x": 0,
    "y": 62,
    "w": 31,
    "h": 31,
    "frames": 5
  },
  "BUDGET_AMOUNT_BACKGROUND": {
    "file": "menu_bas.png",
    "x": 14,
    "y": 0,
    "w": 79,
    "h": 31,
    "frames": 1
  },
  "VISITOR_PANEL_BUTTON": {
    "file": "menu_bas.png",
    "x": 0,
    "y": 93,
    "w": 31,
    "h": 31,
    "frames": 5
  },
  "VISITOR_AMOUNT_BACKGROUND": {
    "file": "menu_bas.png",
    "x": 94,
    "y": 0,
    "w": 64,
    "h": 31,
    "frames": 1
  },
  "DINO_LIST_PANEL_BUTTON": {
    "file": "menu_bas.png",
    "x": 0,
    "y": 124,
    "w": 31,
    "h": 31,
    "frames": 5
  },
  "SHOW_LIST_PANEL_BUTTON": {
    "file": "menu_bas.png",
    "x": 0,
    "y": 155,
    "w": 31,
    "h": 31,
    "frames": 5
  },
  "PADDOCK_LIST_PANEL_BUTTON": {
    "file": "menu_bas.png",
    "x": 0,
    "y": 186,
    "w": 31,
    "h": 31,
    "frames": 5
  },
  "WARNING_INFO_PANEL_IMAGE": {
    "file": "menu_bas.png",
    "x": 0,
    "y": 31,
    "w": 46,
    "h": 31,
    "frames": 1
  },
  "WARNING_REPAIR_BUTTON": {
    "file": "menu_bas.png",
    "x": 125,
    "y": 217,
    "w": 25,
    "h": 25,
    "frames": 5
  },
  "MINI_MAP_ZOOMIN_BUTTON": {
    "file": "menu_bas.png",
    "x": 176,
    "y": 139,
    "w": 16,
    "h": 16,
    "frames": 5
  },
  "MINI_MAP_ZOOMOUT_BUTTON": {
    "file": "menu_bas.png",
    "x": 176,
    "y": 123,
    "w": 16,
    "h": 16,
    "frames": 5
  },
  "LIST_WOOD_PANEL_LEFTCORNER": {
    "file": "menu_droite_pan_attrpredef&boitnoir.png",
    "x": 0,
    "y": 0,
    "w": 98,
    "h": 22,
    "frames": 1
  },
  "LIST_WOOD_PANEL_TOPMID": {
    "file": "menu_droite_pan_attrpredef&boitnoir.png",
    "x": 12,
    "y": 4,
    "w": 85,
    "h": 19,
    "frames": 1
  },
  "LIST_WOOD_PANEL_RIGHTCORNER": {
    "file": "menu_droite_pan_attrpredef&boitnoir.png",
    "x": 12,
    "y": 2,
    "w": 97,
    "h": 20,
    "frames": 1
  },
  "LIST_WOOD_PANEL_LEFTSIDE": {
    "file": "menu_droite_pan_attrpredef&boitnoir.png",
    "x": 5,
    "y": 23,
    "w": 93,
    "h": 48,
    "frames": 1
  },
  "LIST_WOOD_PANEL_MID": {
    "file": "menu_droite_pan_attrpredef&boitnoir.png",
    "x": 12,
    "y": 23,
    "w": 85,
    "h": 48,
    "frames": 1
  },
  "LIST_WOOD_PANEL_RIGHTSIDE": {
    "file": "menu_droite_pan_attrpredef&boitnoir.png",
    "x": 12,
    "y": 23,
    "w": 95,
    "h": 48,
    "frames": 1
  },
  "LIST_WOOD_PANEL_BOTTOMLEFT": {
    "file": "menu_droite_pan_attrpredef&boitnoir.png",
    "x": 1,
    "y": 129,
    "w": 98,
    "h": 27,
    "frames": 1
  },
  "LIST_WOOD_PANEL_BOTTOMMID": {
    "file": "menu_droite_pan_attrpredef&boitnoir.png",
    "x": 13,
    "y": 129,
    "w": 85,
    "h": 24,
    "frames": 1
  },
  "LIST_WOOD_PANEL_BOTTOMRIGHT": {
    "file": "menu_droite_pan_attrpredef&boitnoir.png",
    "x": 13,
    "y": 129,
    "w": 100,
    "h": 27,
    "frames": 1
  },
  "OUTCOME_CANCEL": {
    "file": "pann_list3.png",
    "x": 0,
    "y": 100,
    "w": 28,
    "h": 28,
    "frames": 5
  },
  "OUTCOME_OK": {
    "file": "info_dino1.png",
    "x": 0,
    "y": 157,
    "w": 28,
    "h": 28,
    "frames": 5
  },
  "OPTIONS_BUTTON": {
    "file": "menu_droite_pan_attrpredef&boitnoir.png",
    "x": 116,
    "y": 228,
    "w": 28,
    "h": 28,
    "frames": 5
  },
  "OPTIONS_SAVE_BUTTON": {
    "file": "menu_droite_BOUTS_resto&souv3.png",
    "x": 0,
    "y": 195,
    "w": 28,
    "h": 28,
    "frames": 5
  },
  "OPTIONS_LOAD_BUTTON": {
    "file": "menu_droite_BOUTS_resto&souv3.png",
    "x": 0,
    "y": 223,
    "w": 28,
    "h": 28,
    "frames": 5
  },
  "CONSTRUCTION_FENCE": {
    "file": "menu_droite_menu_const_Attr&Encl.png",
    "x": 116,
    "y": 28,
    "w": 28,
    "h": 28,
    "frames": 5
  },
  "ROAD_ICON": {
    "file": "menu_droite_pan_resto&souv.png",
    "x": 0,
    "y": 187,
    "w": 28,
    "h": 28,
    "frames": 5
  },
  "TREEDECO_BUTTON": {
    "file": "menu_droite_pan_resto&souv.png",
    "x": 0,
    "y": 131,
    "w": 28,
    "h": 28,
    "frames": 5
  },
  "BOUT_SECUANDFOOD_FOOD": {
    "file": "menu_droite_BOUTS_resto&souv2.png",
    "x": 0,
    "y": 0,
    "w": 39,
    "h": 39,
    "frames": 5
  },
  "FOOD_ICON": {
    "file": "info_dino1.png",
    "x": 0,
    "y": 185,
    "w": 28,
    "h": 28,
    "frames": 1
  },
  "OUTCOME_EXIT_GAME": {
    "file": "mini_map2.png",
    "x": 0,
    "y": 0,
    "w": 35,
    "h": 36,
    "frames": 5
  },
  "DINO_REG_ALIM_CARNI": {
    "file": "info_dino1.png",
    "x": 26,
    "y": 72,
    "w": 24,
    "h": 24,
    "frames": 1
  },
  "DINO_REG_ALIM_HERBI": {
    "file": "info_dino1.png",
    "x": 26,
    "y": 48,
    "w": 24,
    "h": 24,
    "frames": 1
  },
  "DINO_BESOINS_FOOD": {
    "file": "info_dino1.png",
    "x": 215,
    "y": 52,
    "w": 24,
    "h": 24,
    "frames": 1
  }
};

const UI_ASSETS = '/assets/original-ui/';
const money = (value: number) => Math.round(value).toLocaleString('en-US');

/** Native 2002 sprite overlay. All screen anchors are from ParkInterface.Ini. */
export function createUI(onAction: (action: UIAction) => void) {
  const root = document.createElement('div');
  root.className = 'game-ui';
  root.setAttribute('aria-label', 'Dino Island park yönetimi');
  const layer = document.createElement('div');
  layer.className = 'ui-native';
  root.append(layer);
  document.body.append(root);
  let panel: string | null = null;
  let data: UIData = { money: 75000, visitors: 0, dinosaurCount: 0, happiness: 100,
    day: 1, time: 9, paused: false, speed: 1, species: [], buildItems: [], dinosaurs: [] };
  let panelSignature = '';
  let selectedId: number | undefined;
  let toastTimer: ReturnType<typeof setTimeout>;
  const bindings = new Map<string, HTMLElement>();
  const panelButtons = new Map<string, HTMLButtonElement[]>();
  // Resolved asynchronously from the original overlay definitions. Until the
  // fetch completes, the existing adapted DOM remains fully operational.
  let overlayLayout: {
    park: Map<string, ParkWidgetNode>;
    construction: Map<string, ParkWidgetNode>;
  } | null = null;

  function place(node: HTMLElement, x: number, y: number, w?: number, h?: number) {
    Object.assign(node.style, { left: `${x}px`, top: `${y}px` });
    if (w !== undefined) node.style.width = `${w}px`;
    if (h !== undefined) node.style.height = `${h}px`;
    return node;
  }
  function paint(node: HTMLElement, name: string, frame = 0) {
    const s = SPRITES[name];
    if (!s) return;
    node.style.backgroundImage = `url("${UI_ASSETS}${s.file}")`;
    node.style.backgroundPosition = `${-s.x - s.w * frame}px ${-s.y}px`;
    node.style.width = `${s.w}px`;
    node.style.height = `${s.h}px`;
  }
  function sprite(name: string, x: number, y: number, parent: HTMLElement) {
    const element = document.createElement('div');
    element.className = 'ui-sprite';
    element.setAttribute('aria-hidden', 'true');
    paint(element, name);
    place(element, x, y);
    parent.append(element);
    return element;
  }
  function button(name: string, x: number, y: number, label: string, action: UIAction | (() => void), parent: HTMLElement) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'sprite-button';
    element.title = label;
    element.setAttribute('aria-label', label);
    const normal = SPRITES[name].frames > 1 ? 1 : 0;
    const draw = (frame: number) => paint(element, name, Math.min(frame, SPRITES[name].frames - 1));
    draw(normal);
    place(element, x, y);
    element.addEventListener('pointerenter', () => draw(2));
    element.addEventListener('pointerleave', () => draw(element.getAttribute('aria-pressed') === 'true' ? 3 : normal));
    element.addEventListener('pointerdown', () => draw(3));
    element.addEventListener('pointerup', () => draw(2));
    element.addEventListener('click', () => typeof action === 'function' ? action() : onAction(action));
    parent.append(element);
    return element;
  }
  function text(parent: HTMLElement, name: string, x: number, y: number, w: number, h = 13) {
    const element = document.createElement('span');
    element.className = 'gauge-value';
    place(element, x, y, w, h);
    parent.append(element);
    bindings.set(name, element);
    return element;
  }
  function panelButton(name: string, x: number, y: number, label: string, target: 'dinosaurs' | 'build' | 'genetics' | 'park' | 'settings', parent: HTMLElement) {
    const b = button(name, x, y, label, () => {
      const next = panel === target ? null : target;
      setPanel(next);
      if (next) onAction({ type: 'panel', panel: target });
      else onAction({ type: 'close' });
    }, parent);
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-controls', 'park-dialog');
    panelButtons.set(target, [...(panelButtons.get(target) || []), b]);
    return b;
  }

  const right = document.createElement('div');
  right.className = 'native-right';
  right.setAttribute('role', 'toolbar');
  right.setAttribute('aria-label', 'Park menüsü');
  layer.append(right);
  sprite('RIGHT_PANEL_IMAGE_TOP', 0, 0, right);
  sprite('RIGHT_PANEL_IMAGE_BOTTOM', 16, 223, right);
  panelButton('LABO_ICON', 27, 23, 'Genetik laboratuvarı', 'genetics', right);
  panelButton('CONSTRUCTION_ICON', 40, 117, 'Yollar, çitler ve çevre düzenlemesi', 'build', right);
  panelButton('BUILDING_ICON', 41, 177, 'Binalar ve park inşaatı', 'build', right);
  panelButton('TRANSPORT_ICON', 41, 230, 'Park bilgileri ve ziyaretçiler', 'park', right);
  panelButton('PURCHASE_ICON', 41, 280, 'Dinozor satın al', 'dinosaurs', right);
  panelButton('OPTIONS_ICON', 41, 330, 'Oyun seçenekleri', 'settings', right);
  const clock = text(right, 'time', 22, 389, 40, 17);
  clock.title = 'Saat';
  const day = text(right, 'day', 67, 389, 20, 17);
  day.title = 'Gün';

  const navigation = document.createElement('div');
  navigation.className = 'native-navigation';
  navigation.setAttribute('role', 'toolbar');
  navigation.setAttribute('aria-label', 'Kamera');
  layer.append(navigation);
  sprite('RIGHT_PANEL_IMAGE_LEFT', 0, 0, navigation);
  button('ZOOM_BUTTON', 31, 57, 'Yakınlaştır (+)', { type: 'zoom', direction: 1 }, navigation);
  button('DEZOOM_BUTTON', 59, 57, 'Uzaklaştır (−)', { type: 'zoom', direction: -1 }, navigation);
  button('GORIGHT_BUTTON', 65, 93, 'Kamerayı sağa kaydır', { type: 'tool', tool: 'pan-right' }, navigation);
  button('GOLEFT_BUTTON', 29, 93, 'Kamerayı sola kaydır', { type: 'tool', tool: 'pan-left' }, navigation);
  button('GOTOP_BUTTON', 47, 75, 'Kamerayı ileri kaydır', { type: 'tool', tool: 'pan-up' }, navigation);
  button('GOBOTTOM_BUTTON', 47, 109, 'Kamerayı geri kaydır', { type: 'tool', tool: 'pan-down' }, navigation);
  button('TURNRIGHT_BUTTON', 54, 89, 'Kamerayı sağa döndür (E)', { type: 'rotate', direction: 1 }, navigation);
  button('TURNLEFT_BUTTON', 44, 89, 'Kamerayı sola döndür (Q)', { type: 'rotate', direction: -1 }, navigation);

  const map = document.createElement('div');
  map.className = 'native-map';
  layer.append(map);
  sprite('MAP_PANEL_IMAGE', 0, 0, map);
  const minimap = document.createElement('canvas');
  minimap.className = 'minimap-canvas';
  minimap.width = minimap.height = 136;
  minimap.setAttribute('aria-label', 'Adanın küçük haritası');
  minimap.title = 'Adaya dönmek için çift tıkla';
  minimap.addEventListener('dblclick', () => onAction({ type: 'home' }));
  map.append(minimap);
  button('MINI_MAP_ZOOMIN_BUTTON', 9, 128, 'Haritaya yakınlaş', { type: 'zoom', direction: 1 }, map);
  button('MINI_MAP_ZOOMOUT_BUTTON', 9, 145, 'Haritadan uzaklaş', { type: 'zoom', direction: -1 }, map);

  const gauge = document.createElement('div');
  gauge.className = 'native-gauge';
  gauge.setAttribute('aria-label', 'Park göstergeleri');
  layer.append(gauge);
  sprite('GAUGE_PANEL_PART_LEFT', 0, 0, gauge);
  panelButton('BUDGET_PANEL_BUTTON', 13, 0, 'Park bütçesi', 'park', gauge);
  sprite('BUDGET_AMOUNT_BACKGROUND', 44, 0, gauge);
  text(gauge, 'money', 49, 9, 55);
  panelButton('VISITOR_PANEL_BUTTON', 123, 0, 'Ziyaretçiler', 'park', gauge);
  sprite('VISITOR_AMOUNT_BACKGROUND', 154, 0, gauge);
  text(gauge, 'visitors', 159, 9, 40);
  panelButton('DINO_LIST_PANEL_BUTTON', 218, 0, 'Dinozor listesi', 'dinosaurs', gauge);
  sprite('VISITOR_AMOUNT_BACKGROUND', 249, 0, gauge);
  text(gauge, 'dinosaurCount', 254, 9, 40);
  panelButton('SHOW_LIST_PANEL_BUTTON', 313, 0, 'Dinozor mutluluğu', 'park', gauge);
  sprite('VISITOR_AMOUNT_BACKGROUND', 344, 0, gauge);
  text(gauge, 'happiness', 349, 9, 40);
  panelButton('PADDOCK_LIST_PANEL_BUTTON', 408, 0, 'Çit ve alan inşa et', 'build', gauge);
  sprite('VISITOR_AMOUNT_BACKGROUND', 439, 0, gauge);
  text(gauge, 'objectives', 444, 9, 40);
  sprite('WARNING_INFO_PANEL_IMAGE', 503, 0, gauge);
  panelButton('WARNING_REPAIR_BUTTON', 521, 3, 'Park durumu', 'park', gauge);

  const dialog = document.createElement('section');
  dialog.id = 'park-dialog';
  dialog.className = 'native-dialog';
  dialog.hidden = true;
  dialog.setAttribute('aria-label', 'Park yönetimi');
  layer.append(dialog);
  const dialogBody = document.createElement('div');
  dialogBody.className = 'dialog-body';
  dialog.append(dialogBody);
  const selection = document.createElement('section');
  selection.className = 'dino-selection';
  selection.hidden = true;
  selection.setAttribute('aria-label', 'Seçilen dinozor');
  layer.append(selection);
  const toastArea = document.createElement('div');
  toastArea.className = 'park-toast';
  toastArea.setAttribute('role', 'status');
  toastArea.setAttribute('aria-live', 'polite');
  root.append(toastArea);

  // Construction popup uses CONSTRUCTION_PANEL exactly: 112×48 at x=592,y=122,
  // right/down aligned in the original 800×600 reference frame.
  const constructionShell = document.createElement('section');
  constructionShell.className = 'native-construction';
  constructionShell.hidden = true;
  constructionShell.setAttribute('aria-label', 'İnşaat kısayolları');
  layer.append(constructionShell);

  function woodFrame(parent: HTMLElement, height: number) {
    parent.querySelectorAll('.wood-frame').forEach(n => n.remove());
    const frame = document.createElement('div');
    frame.className = 'wood-frame';
    parent.prepend(frame);
    const frameWidth = parent.offsetWidth || 283;
    const exactPurchase = frameWidth > 300;
    sprite('LIST_WOOD_PANEL_LEFTCORNER', 0, 0, frame);
    if (exactPurchase) {
      // DINO_ACHAT_SAVE_WOOD uses three exact 85px TOPMID sections before the
      // right corner; retain the original seams instead of stretching one tile.
      for (let x = 98; x + 85 <= frameWidth - 97; x += 85) sprite('LIST_WOOD_PANEL_TOPMID', x, 4, frame);
    } else sprite('LIST_WOOD_PANEL_TOPMID', 98, 4, frame);
    sprite('LIST_WOOD_PANEL_RIGHTCORNER', frameWidth - 100, 2, frame);
    const middle = Math.max(48, height - 49);
    const left = sprite('LIST_WOOD_PANEL_LEFTSIDE', 5, 22, frame);
    const mid = sprite('LIST_WOOD_PANEL_MID', 98, 22, frame);
    const rightEdge = sprite('LIST_WOOD_PANEL_RIGHTSIDE', frameWidth - 100, 22, frame);
    // Repeat the original weave vertically; do not stretch its pixel pattern.
    const repeatedMids: HTMLElement[] = exactPurchase
      ? [98, 183, 268].slice(1).flatMap(x => [sprite('LIST_WOOD_PANEL_MID', x, 22, frame)])
      : [];
    for (const [node, name] of [[left, 'LIST_WOOD_PANEL_LEFTSIDE'], [mid, 'LIST_WOOD_PANEL_MID'], ...repeatedMids.map(n => [n, 'LIST_WOOD_PANEL_MID'] as const), [rightEdge, 'LIST_WOOD_PANEL_RIGHTSIDE']] as const) {
      const s = SPRITES[name];
      node.style.height = `${middle}px`;
      node.style.backgroundImage = 'none';
      for (let offset = 0; offset < middle; offset += s.h) {
        const tile = sprite(name, 0, offset, node);
        tile.style.height = `${Math.min(s.h, middle - offset)}px`;
      }
    }
    sprite('LIST_WOOD_PANEL_BOTTOMLEFT', 0, height - 27, frame);
    if (exactPurchase) {
      for (let x = 98; x + 85 <= frameWidth - 100; x += 85) sprite('LIST_WOOD_PANEL_BOTTOMMID', x, height - 27, frame);
    } else sprite('LIST_WOOD_PANEL_BOTTOMMID', 98, height - 27, frame);
    sprite('LIST_WOOD_PANEL_BOTTOMRIGHT', frameWidth - 100, height - 27, frame);
    parent.style.height = `${height}px`;
    if (parent === dialog) positionDialog();
  }
  function applyExactShell(node: ParkWidgetNode, element: HTMLElement): boolean {
    const anchor = widgetAnchor(node);
    Object.assign(element.style, {
      left: '', top: '', right: '', bottom: '',
      ...(anchor.left !== undefined ? { left: `${anchor.left}px` } : {}),
      ...(anchor.top !== undefined ? { top: `${anchor.top}px` } : {}),
      ...(anchor.right !== undefined ? { right: `${anchor.right}px` } : {}),
      ...(anchor.bottom !== undefined ? { bottom: `${anchor.bottom}px` } : {}),
      width: `${anchor.width}px`,
      height: `${anchor.height}px`,
    });
    return true;
  }
  function updateShellVisibility() {
    const construction = overlayLayout?.construction.get('CONSTRUCTION_PANEL');
    constructionShell.hidden = panel !== 'build' || !construction;
    if (panel === 'dinosaurs') {
      const purchase = overlayLayout?.construction.get('DINO_ACHAT_SAVE_PANEL');
      if (purchase) {
        applyExactShell(purchase, dialog);
        dialogBody.style.width = `${purchase.absoluteBounds.width - 40}px`;
        return;
      }
    }
    // Other panels keep the existing adapted 283px native dialog.
    dialog.style.width = '';
    dialog.style.right = '';
    dialog.style.bottom = '';
    dialogBody.style.width = '';
    positionDialog();
  }
  async function loadOverlayLayout() {
    try {
      const [park, constructionParsed] = await Promise.all([
        loadRemoteOverlayFiles(
          '/original/Data/Overlay/ParkInterface.Ini',
          '/original/Data/Overlay/ParkGraphicDB.Ini',
        ),
        loadRemoteOverlayFiles(
          '/original/Data/Overlay/ConstructionInterface.Ini',
          '/original/Data/Overlay/ParkGraphicDB.Ini',
        ),
      ]);
      const byName = (list: readonly ParkWidgetNode[]) =>
        new Map(list.map(node => [node.name, node] as const));
      overlayLayout = {
        park: byName(park.widgetsFlat),
        construction: byName(constructionParsed.widgetsFlat),
      };
      // HUD roots are exactly the ParkInterface root widgets; child offsets
      // already use the same INI coordinates.
      const hud = [
        ['NAVIGATION_PANEL', navigation], ['RIGHT_PANEL', right],
        ['MAP_PANEL', map], ['GAUGE_PANEL', gauge],
      ] as const;
      for (const [name, element] of hud) {
        const widget = overlayLayout.park.get(name);
        if (widget) applyExactShell(widget, element);
      }
      const constructionPanel = overlayLayout.construction.get('CONSTRUCTION_PANEL')!;
      applyExactShell(constructionPanel, constructionShell);
      const shellGraphic = park.graphics.get('CONSTRUCTION_ATTRACTION_PANEL_IMAGE');
      if (shellGraphic) {
        constructionShell.style.backgroundImage = `url("${overlayTextureUrl(shellGraphic.fileName)}")`;
        constructionShell.style.backgroundPosition = `${-shellGraphic.x}px ${-shellGraphic.y}px`;
      }
      // Exact BUTTON bounds/textures from ConstructionInterface + ParkGraphicDB.
      const shellActions: Array<[string, string, UIAction]> = [
        ['OPEN_CONSTRUCTION_FENCE', 'Çit inşası', { type: 'tool', tool: 'fence' }],
        ['OPEN_CONSTRUCTION_KIT', 'Yol inşası', { type: 'tool', tool: 'road' }],
        ['OPEN_CONSTRUCTION_ATTRACTION_PREDEF', 'Çevre düzenlemesi', { type: 'tool', tool: 'tree' }],
      ];
      for (const [name, label, action] of shellActions) {
        const widget = overlayLayout.construction.get(name);
        const textureName = widget?.values['TEXTURE']?.text;
        if (!widget || !textureName || !SPRITES[textureName]) continue;
        button(textureName, widget.bounds.x, widget.bounds.y, label, action, constructionShell);
      }
      updateShellVisibility();
      if (!dialog.hidden) renderPanel();
    } catch {
      // Offline-safe fallback: retain the previously verified adapted UI.
    }
  }
  function positionDialog() {
    // Keep long native dialogs inside the original 800×600 playfield as well.
    const available = layer.clientHeight - dialog.offsetHeight - 12;
    dialog.style.bottom = `${Math.max(36, Math.min(224, available))}px`;
  }
  function actionButton(label: string, run: () => void, className = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `native-text-button ${className}`;
    b.textContent = label;
    b.addEventListener('click', run);
    return b;
  }
  function heading(title: string, description?: string) {
    const h = document.createElement('h1');
    h.textContent = title;
    dialogBody.append(h);
    if (description) {
      const p = document.createElement('p'); p.className = 'dialog-note';
      p.textContent = description; dialogBody.append(p);
    }
  }
  function createRow(parent: HTMLElement, title: string, detail: string) {
    const row = document.createElement('div');
    row.className = 'park-list-row';
    const label = document.createElement('span');
    const name = document.createElement('strong'); name.textContent = title;
    const subtitle = document.createElement('small'); subtitle.textContent = detail;
    label.append(name, subtitle); row.append(label); parent.append(row);
    return row;
  }
  function renderPanel() {
    dialogBody.replaceChildren();
    if (!panel) return;
    const title = { dinosaurs: 'Dinozor satın al', build: 'Park inşaatı', genetics: 'Genetik laboratuvarı', park: 'Park yönetimi', settings: 'Seçenekler' }[panel] || 'Dino Island';
    dialog.setAttribute('aria-label', title);
    if (panel === 'dinosaurs') {
      heading(title, 'Bir tür seç, ardından adaya tıklayarak yerleştir.');
      for (const item of data.species) {
        const row = createRow(dialogBody, item.name, `$${money(item.cost)}`);
        if (item.thumbnail) {
          const thumbnail = document.createElement('img');
          thumbnail.className = 'species-thumbnail'; thumbnail.src = item.thumbnail;
          thumbnail.alt = ''; row.prepend(thumbnail);
        }
        const b = actionButton('Satın al', () => onAction({ type: 'spawn', species: item.id }));
        b.dataset.cost = String(item.cost); row.append(b);
      }
      if (data.dinosaurs.length) {
        const subtitle = document.createElement('h2'); subtitle.textContent = `Parktaki dinozorlar (${data.dinosaurs.length})`;
        dialogBody.append(subtitle);
        for (const d of data.dinosaurs) {
          const row = createRow(dialogBody, d.name, d.species);
          row.append(actionButton('Besle', () => onAction({ type: 'feed', id: d.id })));
        }
      }
    } else if (panel === 'build') {
      heading(title, 'Bir araç seç. İnşa etmek için araziye tıkla.');
      const icons: Record<string, string> = { path: 'ROAD_ICON', road: 'ROAD_ICON', fence: 'CONSTRUCTION_FENCE', tree: 'TREEDECO_BUTTON', feeder: 'FOOD_ICON', food: 'FOOD_ICON' };
      for (const item of data.buildItems) {
        const row = createRow(dialogBody, item.name, `$${money(item.cost)}`);
        const icon = icons[item.id];
        if (icon) {
          const image = document.createElement('span'); image.className = 'build-icon';
          paint(image, icon, SPRITES[icon].frames > 1 ? 1 : 0); row.prepend(image);
        }
        const b = actionButton('İnşa et', () => onAction({ type: 'tool', tool: item.id }));
        b.dataset.cost = String(item.cost); row.append(b);
      }
      dialogBody.append(actionButton('Seçim aracına dön', () => { onAction({ type: 'close' }); onAction({ type: 'tool', tool: 'select' }); setPanel(null); }));
    } else if (panel === 'genetics') {
      heading(title, 'İki dinozorun özelliklerini birleştir. Üretim bedeli: $2,000.');
      const selects: HTMLSelectElement[] = [];
      for (const [index, label] of ['Birinci ebeveyn', 'İkinci ebeveyn'].entries()) {
        const field = document.createElement('label'); field.className = 'native-field';
        const caption = document.createElement('span'); caption.textContent = label;
        const select = document.createElement('select');
        select.name = `parent-${index}`;
        for (const d of data.dinosaurs) {
          const option = document.createElement('option'); option.value = String(d.id); option.textContent = `${d.name} (${d.species})`;
          select.append(option);
        }
        if (index === 1 && select.options.length > 1) select.selectedIndex = 1;
        selects.push(select); field.append(caption, select); dialogBody.append(field);
      }
      const breed = actionButton('Melez dinozor üret', () => onAction({ type: 'breed', first: selects[0].value, second: selects[1].value }));
      breed.disabled = data.dinosaurs.length < 2 || data.money < 2000;
      breed.dataset.cost = '2000';
      dialogBody.append(breed);
    } else if (panel === 'park') {
      heading(title);
      const stats = document.createElement('dl'); stats.className = 'park-stats';
      for (const [key, label] of [['money', 'Bütçe'], ['visitors', 'Ziyaretçi'], ['dinosaurCount', 'Dinozor'], ['happiness', 'Mutluluk']] as const) {
        const dt = document.createElement('dt'); dt.textContent = label;
        const dd = document.createElement('dd'); dd.dataset.stat = key;
        stats.append(dt, dd);
      }
      dialogBody.append(stats);
      if (data.objectives?.length) {
        const h = document.createElement('h2'); h.textContent = 'Park hedefleri'; dialogBody.append(h);
        for (const [index, objective] of data.objectives.entries()) {
          const row = createRow(dialogBody, `${objective.complete ? '✓' : '·'} ${objective.title}`, objective.progress || '');
          row.querySelector('small')!.dataset.objective = String(index);
        }
      }
      dialogBody.append(actionButton('Adaya dön', () => { onAction({ type: 'home' }); onAction({ type: 'close' }); setPanel(null); }));
    } else if (panel === 'settings') {
      heading(title);
      const actions = document.createElement('div'); actions.className = 'options-actions';
      for (const [name, label, action] of [['OPTIONS_SAVE_BUTTON', 'Oyunu kaydet', 'save'], ['OPTIONS_LOAD_BUTTON', 'Kaydı yükle', 'load']] as const) {
        const row = document.createElement('div'); row.className = 'option-row';
        button(name, 0, 0, label, { type: action }, row);
        row.append(actionButton(label, () => onAction({ type: action })));
        actions.append(row);
      }
      const pause = actionButton(data.paused ? 'Oyuna devam et' : 'Oyunu duraklat', () => onAction({ type: 'pause' }));
      pause.dataset.setting = 'pause'; actions.append(pause);
      const speeds = document.createElement('div'); speeds.className = 'speed-options';
      speeds.setAttribute('role', 'group'); speeds.setAttribute('aria-label', 'Oyun hızı');
      for (const speed of [1, 2, 4]) {
        const b = actionButton(`${speed}×`, () => onAction({ type: 'speed', speed }));
        b.dataset.speed = String(speed); speeds.append(b);
      }
      actions.append(speeds, actionButton('Sesi aç / kapat', () => onAction({ type: 'audio' })), actionButton('Kamerayı adaya getir', () => onAction({ type: 'home' })));
      dialogBody.append(actions);
      const help = document.createElement('p'); help.className = 'dialog-note controls-note';
      help.textContent = 'Sürükle: kamerayı kaydır · Tekerlek: yakınlaştır · Q / E: döndür · Esc: aracı kapat · Boşluk: duraklat';
      dialogBody.append(help);
    }
    button('OUTCOME_CANCEL', 235, 10, 'Menüyü kapat (Esc)', () => { setPanel(null); onAction({ type: 'close' }); }, dialog);
    // Height follows actual content, with an exact native woven frame around it.
    const height = Math.min(510, Math.max(190, dialogBody.scrollHeight + 42));
    woodFrame(dialog, height);
    refreshPanelValues();
  }
  function refreshPanelValues() {
    dialogBody.querySelectorAll<HTMLElement>('[data-objective]').forEach(el => {
      el.textContent = data.objectives?.[Number(el.dataset.objective)]?.progress || '';
    });
    dialogBody.querySelectorAll<HTMLElement>('[data-stat]').forEach(el => {
      const key = el.dataset.stat as 'money' | 'visitors' | 'dinosaurCount' | 'happiness';
      const value = data[key]; el.textContent = key === 'money' ? `$${money(value)}` : key === 'happiness' ? `${Math.round(value)}%` : money(value);
    });
    dialogBody.querySelectorAll<HTMLButtonElement>('[data-cost]').forEach(el => {
      el.disabled = Number(el.dataset.cost) > data.money || (el.dataset.cost === '2000' && panel === 'genetics' && data.dinosaurs.length < 2);
      el.title = el.disabled ? 'Bütçe yetersiz' : '';
    });
    const pause = dialogBody.querySelector('[data-setting="pause"]');
    if (pause) pause.textContent = data.paused ? 'Oyuna devam et' : 'Oyunu duraklat';
    dialogBody.querySelectorAll('[data-speed]').forEach(el => el.setAttribute('aria-pressed', String(Number((el as HTMLElement).dataset.speed) === data.speed)));
  }
  function setPanel(next: string | null) {
    if (next === panel) return;
    panel = next;
    dialog.hidden = !next;
    dialog.querySelectorAll(':scope > .sprite-button').forEach(n => n.remove());
    for (const [name, buttons] of panelButtons) for (const b of buttons) {
      b.setAttribute('aria-expanded', String(name === next));
      b.setAttribute('aria-pressed', String(name === next));
    }
    renderPanel();
    updateShellVisibility();
  }
  function update(next: UIData) {
    data = next;
    const values: Record<string, string> = {
      money: money(data.money), visitors: money(data.visitors), dinosaurCount: money(data.dinosaurCount),
      happiness: `${Math.round(data.happiness)}%`, objectives: String(data.objectives?.filter(o => o.complete).length || 0),
      time: `${String(Math.floor(data.time) % 24).padStart(2, '0')}:${String(Math.floor((data.time % 1) * 60)).padStart(2, '0')}`,
      day: String(data.day),
    };
    for (const [key, value] of Object.entries(values)) {
      const node = bindings.get(key); if (node && node.textContent !== value) node.textContent = value;
    }
    right.classList.toggle('simulation-paused', data.paused);
    const signature = JSON.stringify([data.species, data.buildItems, data.dinosaurs, data.objectives?.map(o => [o.title, o.complete])]);
    if (signature !== panelSignature) {
      panelSignature = signature;
      if (panel) {
        // Preserve the chosen parents while roster/cost data changes.
        const selected = [...dialogBody.querySelectorAll('select')].map(el => el.value);
        dialog.querySelectorAll(':scope > .sprite-button').forEach(n => n.remove());
        renderPanel();
        dialogBody.querySelectorAll('select').forEach((el, i) => { if ([...el.options].some(o => o.value === selected[i])) el.value = selected[i]; });
      }
    } else refreshPanelValues();
    const d = data.selectedDinosaur;
    selection.hidden = !d;
    if (d && selectedId !== d.id) {
      selectedId = d.id;
      selection.replaceChildren();
      woodFrame(selection, 160);
      const content = document.createElement('div'); content.className = 'selection-content';
      const name = document.createElement('h2'); name.dataset.selected = 'name';
      const species = document.createElement('p'); species.dataset.selected = 'species';
      const meters = document.createElement('p'); meters.dataset.selected = 'meters';
      content.append(name, species, meters, actionButton('Dinozoru besle', () => { if (data.selectedDinosaur) onAction({ type: 'feed', id: data.selectedDinosaur.id }); }));
      selection.append(content);
      button('OUTCOME_CANCEL', 235, 10, 'Dinozor seçimini kapat', { type: 'close' }, selection);
    }
    if (d) {
      selection.querySelector('[data-selected="name"]')!.textContent = d.name;
      selection.querySelector('[data-selected="species"]')!.textContent = d.species;
      selection.querySelector('[data-selected="meters"]')!.textContent = `Tokluk ${Math.round(d.hunger)}%  ·  Mutluluk ${Math.round(d.happiness)}%`;
    } else selectedId = undefined;
  }
  function toast(message: string) {
    clearTimeout(toastTimer); toastArea.textContent = message; toastArea.classList.add('is-visible');
    toastTimer = setTimeout(() => toastArea.classList.remove('is-visible'), 5000);
  }
  function resize() {
    root.style.setProperty('--ui-scale', String(Math.min(1, window.innerWidth / 800, window.innerHeight / 600)));
    if (!dialog.hidden) positionDialog();
  }
  window.addEventListener('resize', resize);
  resize(); update(data);
  void loadOverlayLayout();
  return { update, setPanel, toast, minimap, dispose() {
    clearTimeout(toastTimer); window.removeEventListener('resize', resize); root.remove();
  } };
}
