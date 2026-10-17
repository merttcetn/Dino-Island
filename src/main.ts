import './style.css';
import './game.css';
import { ParkScene } from './scene.ts';
import { createUI, type UIAction, type UIData } from './ui.ts';
import { LoopingMusic } from './music.ts';
import { loadOriginalBaseGenomes, type OriginalGenome } from './original-genetics.ts';
import { SPECIES, BUILD_ITEMS, SAVE_KEY, createInitialState, buyDinosaur, placeBuilding, feedDinosaur, breedDinosaurs, tick, serializeGame, parseSavedGame, getSpecies, type GameState, type Point } from './simulation.ts';

const app = document.querySelector<HTMLDivElement>('#app')!;
const loading = document.createElement('div');
loading.className = 'loading-screen';
loading.innerHTML = '<div class="loading-panel"><strong>DINO ISLAND</strong><p>Adana geri dönüyorsun…</p><progress aria-label="Ada yükleniyor"></progress><small>Özgün ada ve dinozorlar yükleniyor.</small></div>';
app.append(loading);
let park: ParkScene | undefined;
let state: GameState;
let selectedId: number | null = null;
let panel: string | null = null;
let frame = 0;
let ui: ReturnType<typeof createUI>;
let thumbnailMap: Record<string, string> = {};
let originalGenomes: Record<string, OriginalGenome> = {};
let persistenceAvailable = true;
// Keep the active track through Vite updates instead of pausing/recreating it.
const music: LoopingMusic = import.meta.hot?.data.music ?? new LoopingMusic('/assets/original-audio/musEquateur.mp3');
const clickSound = new Audio('/assets/original-audio/select.wav');
clickSound.volume = 0.25;
let lastToastError = '';

function persist(manual = false): void {
  try {
    localStorage.setItem(SAVE_KEY, serializeGame(state));
    if (manual) ui.toast('Parkın kaydedildi.');
  } catch {
    persistenceAvailable = false;
    if (manual) ui.toast('Tarayıcı kayda izin vermedi. Park bu oturumda açık kalacak.');
  }
}

function onAction(action: UIAction): void {
  if (!state || !park) return;
  if (music.enabled) { clickSound.currentTime = 0; void clickSound.play().catch(() => {}); }
  switch (action.type) {
    case 'panel': panel = panel === action.panel ? null : action.panel; ui.setPanel(panel); park.setTool(null); break;
    case 'close': panel = null; ui.setPanel(null); park.setTool(null); selectedId = null; park.selected = null; break;
    case 'spawn': {
      const species = getSpecies(action.species);
      if (species) {
        park.setTool({ type: 'dino', species: species.id });
        ui.setPanel(null); panel = null;
        ui.toast(`${species.name}: çitle çevrili bir alana tıkla. İptal: Esc`);
      }
      break;
    }
    case 'tool': {
      const cameraPan: Record<string, [number, number]> = { 'pan-left': [-10, 0], 'pan-right': [10, 0], 'pan-up': [0, 10], 'pan-down': [0, -10] };
      const pan = cameraPan[action.tool];
      if (pan) { park.pan(...pan); break; }
      if (action.tool === 'select') { park.setTool(null); selectedId = null; park.selected = null; break; }
      if (BUILD_ITEMS.some(item => item.id === action.tool)) {
        park.setTool({ type: 'building', kind: action.tool });
        ui.setPanel(null); panel = null;
        ui.toast('Yerleştirmek için adaya tıkla. Döndür: R · İptal: Esc');
      }
      break;
    }
    case 'feed': ui.toast(feedDinosaur(state, action.id).message); break;
    case 'breed': ui.toast(breedDinosaurs(state, Number(action.first), Number(action.second)).message); break;
    case 'save': persist(true); break;
    case 'load': {
      try {
        const text = localStorage.getItem(SAVE_KEY);
        const saved = text && parseSavedGame(text);
        if (saved) { state = saved; selectedId = null; park.selected = null; park.setTool(null); ui.toast('Kaydettiğin park yüklendi.'); }
        else ui.toast('Henüz geçerli bir park kaydı yok.');
      } catch { ui.toast('Bu tarayıcıda kayda erişilemiyor.'); }
      break;
    }
    case 'home': park.home(); break;
    case 'rotate': park.rotate(action.direction); break;
    case 'zoom': park.zoom(action.direction); break;
    case 'pause': state.paused = !state.paused; break;
    case 'speed': if ([1, 2, 4].includes(action.speed)) state.speed = action.speed; break;
    case 'audio': {
      void music.setEnabled(!music.enabled)
        .then(enabled => ui.toast(enabled ? 'Ada müziği açık.' : 'Ada müziği kapalı.'))
        .catch(error => { console.error(error); ui.toast('Müzik çalınamadı.'); });
      break;
    }
  }
  updateUI();
}

function updateUI(): void {
  const dinosaur = state.dinosaurs.find(dino => dino.id === selectedId);
  const happiness = state.dinosaurs.reduce((sum, dino) => sum + dino.happiness, 0) / Math.max(1, state.dinosaurs.length);
  const data: UIData = {
    money: state.money, visitors: state.visitors, dinosaurCount: state.dinosaurs.length,
    happiness, day: state.day, time: (10 + state.elapsed / 20) % 24, paused: state.paused, speed: state.speed,
    species: SPECIES.map(s => ({ ...s, thumbnail: thumbnailMap[s.id] })),
    buildItems: BUILD_ITEMS.map(item => ({ ...item })),
    dinosaurs: state.dinosaurs.map(d => ({ id: d.id, name: d.name, species: getSpecies(d.species)!.name })),
    selectedDinosaur: dinosaur ? { ...dinosaur, species: getSpecies(dinosaur.species)!.name } : undefined,
    objectives: [
      { title: 'Parka yeni bir dinozor getir', complete: state.dinosaurs.length > 4 },
      { title: 'Bir yemlik yerleştir', complete: state.buildings.some(b => b.kind === 'feeder') },
      { title: 'Laboratuvarda bir yumurta üret', complete: state.eggs.length > 0 || state.dinosaurs.some(d => d.parents) },
    ],
  };
  ui.update(data);
}

async function boot(): Promise<void> {
  try {
    park = new ParkScene(app);
    const text = loading.querySelector('small')!;
    [, originalGenomes] = await Promise.all([
      park.initialize(message => { text.textContent = message; }),
      loadOriginalBaseGenomes(SPECIES.map(species => species.id)),
    ]);
    state = createInitialState(park.world.defaultCameraTarget ?? { x: 8, z: 18 }, originalGenomes);
    try {
      const saved = localStorage.getItem(SAVE_KEY);
      const restored = saved && parseSavedGame(saved);
      if (restored) state = restored;
    } catch { persistenceAvailable = false; }
    ui = createUI(onAction);
    park.onSelect = id => { selectedId = id; updateUI(); };
    park.onPlace = point => {
      if (!park?.tool) return;
      if (park.world.terrainHeight(point.x, point.z) <= 0.2) { ui.toast('Bu yapı karaya yerleştirilmeli.'); return; }
      const tool = park.tool;
      const result = tool.type === 'dino'
        ? buyDinosaur(state, tool.species, point, originalGenomes[tool.species])
        : placeBuilding(state, tool.kind, point, park.rotation);
      ui.toast(result.message);
      updateUI();
    };
    park.onError = message => {
      console.error(message);
      if (lastToastError !== message) { lastToastError = message; ui.toast('Bir oyun varlığı yüklenemedi. Ayrıntı konsolda.'); }
    };
    updateUI();
    loading.remove();
    ui.toast('Dino Island’a tekrar hoş geldin. Kamerayı sürükleyebilir, sağdaki düğmelerle parkını kurabilirsin.');
    let last = performance.now(), uiClock = 0, saveClock = 0;
    const animate = (now: number): void => {
      const delta = Math.min((now - last) / 1000, 0.1); last = now;
      tick(state, delta).forEach(message => ui.toast(message));
      park!.update(state, delta);
      uiClock += delta; saveClock += delta;
      if (uiClock > 0.2) { updateUI(); park!.drawMinimap(ui.minimap, state); uiClock = 0; }
      if (saveClock > 30 && persistenceAvailable) { persist(); saveClock = 0; }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    thumbnailMap = await park.thumbnails();
    updateUI();
    ui.minimap.addEventListener('click', event => {
      const rect = ui.minimap.getBoundingClientRect();
      park!.centerOn({ x: (event.clientX - rect.left) / rect.width * 1024 - 512, z: (event.clientY - rect.top) / rect.height * 1024 - 512 });
    });
    window.addEventListener('keydown', event => {
      if (event.target instanceof HTMLElement && (event.target.closest('input,select,textarea') || event.target.isContentEditable)) return;
      if (event.code === 'Escape') { onAction({ type: 'close' }); selectedId = null; park!.selected = null; }
      if (event.code === 'Space') { event.preventDefault(); onAction({ type: 'pause' }); }
      if (event.code === 'KeyR' && park!.tool) { park!.rotation += Math.PI / 2; ui.toast('Yerleştirme yönü döndürüldü.'); }
      if (event.code === 'KeyF') onAction({ type: 'home' });
      if (event.code === 'KeyB') onAction({ type: 'panel', panel: 'build' });
      if (event.code === 'KeyG') onAction({ type: 'panel', panel: 'genetics' });
    });
    window.addEventListener('pagehide', () => { if (state && persistenceAvailable) persist(); });
    if (import.meta.env.DEV) {
      Object.assign(window, {
        __DINO_ISLAND__: {
          getState: () => structuredClone(state),
          diagnostics: () => park!.diagnostics(),
          project: (point: Point) => {
            const THREEPoint = park!.camera.position.clone().set(point.x, park!.world.terrainHeight(point.x, point.z), point.z).project(park!.camera);
            const rect = park!.canvas.getBoundingClientRect();
            return { x: (THREEPoint.x + 1) / 2 * rect.width, y: (-THREEPoint.y + 1) / 2 * rect.height };
          },
        },
      });
    }
  } catch (error) {
    console.error(error);
    const content = loading.querySelector('.loading-panel')!;
    content.replaceChildren();
    const title = document.createElement('strong'); title.textContent = 'Ada yüklenemedi';
    const description = document.createElement('p'); description.textContent = error instanceof Error ? error.message : String(error);
    const retry = document.createElement('button'); retry.textContent = 'Yeniden dene'; retry.addEventListener('click', () => location.reload());
    content.append(title, description, retry);
  }
}

void boot();
if (import.meta.hot) import.meta.hot.dispose(data => {
  data.music = music;
  cancelAnimationFrame(frame); park?.dispose(); ui?.dispose();
});
