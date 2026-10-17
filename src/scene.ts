import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { animateOriginalModel, loadOriginalModel } from './original-models.ts';
import {
  applyOriginalCameraProfile,
  loadOriginalCameraConfigs,
  ORIGINAL_CAMERA_PROFILE,
} from './original-camera-runtime.ts';
import { createOriginalSkyRenderer, type OriginalSkyRenderer } from './original-sky-renderer.ts';
import { createOriginalWorld } from './original-world.ts';
import { SPECIES, getBuildItem, habitatAt, canBuild, type GameState, type Point, type SpeciesId } from './simulation.ts';

export type PlacementTool = { type: 'dino'; species: SpeciesId } | { type: 'building'; kind: string } | null;
type World = Awaited<ReturnType<typeof createOriginalWorld>>;
const MODEL_ROOT = '/original/Data/Graphics/';
const BUILD_MODELS: Record<string, string> = {
  fence: 'paddock/fences/fence_paddock_lod1.mesh',
  feeder: 'paddock/bowl/bowl.mesh',
  watchtower: 'paddock/ptview/ptview.mesh',
  restaurant: 'buildings/restaurants/restnat/restnat_lod2.mesh',
  farm: 'buildings/office/farm/farm_lod2.mesh',
};

export class ParkScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(43, 1, 0.5, 2200);
  readonly controls: OrbitControls;
  readonly canvas: HTMLCanvasElement;
  world!: World;
  selected: number | null = null;
  tool: PlacementTool = null;
  rotation = 0;
  onSelect: (id: number | null) => void = () => {};
  onPlace: (point: Point) => void = () => {};
  onError: (message: string) => void = () => {};
  private templates = new Map<string, Promise<THREE.Group>>();
  private dinos = new Map<number, THREE.Group>();
  private buildings = new Map<number, THREE.Object3D>();
  private pending = new Set<string>();
  private groundMaterial?: THREE.MeshLambertMaterial;
  private pointer = new THREE.Vector2();
  private ray = new THREE.Raycaster();
  private cursorPosition?: Point;
  private state?: GameState;
  private pointerDown?: { x: number; y: number; time: number };
  private keys = new Set<string>();
  private animatedDinosaurs = 0;
  private cameraConfigId = ORIGINAL_CAMERA_PROFILE;
  private cameraConfig?: ReturnType<typeof applyOriginalCameraProfile>;
  private sky?: OriginalSkyRenderer;
  private resizeObserver: ResizeObserver;
  private disposed = false;
  private mapImage?: HTMLImageElement;
  private preview = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({
    color: 0x8fe759, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false,
  }));
  private selection = new THREE.Mesh(new THREE.RingGeometry(3.5, 3.7, 48), new THREE.MeshBasicMaterial({
    color: 0xfff05a, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false,
  }));

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'park-canvas';
    this.canvas.setAttribute('data-testid', 'park-canvas');
    this.canvas.setAttribute('aria-label', 'Dino Island üç boyutlu parkı');
    this.canvas.tabIndex = 0;
    container.append(this.canvas);
    this.scene.background = new THREE.Color(0x75b9ef);
    // Data/States/FogParam.txt: 1500..2000, RGB(255,220,165).
    this.scene.fog = new THREE.Fog(0xffdca5, 1500, 2000);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sunlight = new THREE.DirectionalLight(0xffffe6, 1.15);
    sunlight.position.set(-90, 180, 90);
    sunlight.castShadow = true;
    sunlight.shadow.mapSize.set(1024, 1024);
    sunlight.shadow.camera.left = sunlight.shadow.camera.bottom = -90;
    sunlight.shadow.camera.right = sunlight.shadow.camera.top = 90;
    sunlight.shadow.camera.far = 400;
    sunlight.shadow.normalBias = 0.15;
    this.scene.add(sunlight, sunlight.target);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 14;
    this.controls.maxDistance = 500;
    this.controls.minPolarAngle = 0.15;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.12;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.preview.rotation.x = this.selection.rotation.x = -Math.PI / 2;
    this.preview.visible = this.selection.visible = false;
    this.preview.renderOrder = this.selection.renderOrder = 5;
    this.scene.add(this.preview, this.selection);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.canvas.addEventListener('pointerdown', this.handleDown);
    this.canvas.addEventListener('pointerup', this.handleUp);
    this.canvas.addEventListener('pointermove', this.handleMove);
    this.canvas.addEventListener('pointerleave', this.handleLeave);
    this.canvas.addEventListener('contextmenu', event => event.preventDefault());
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
  }

  async initialize(onProgress: (text: string) => void): Promise<void> {
    onProgress('Özgün ada haritası yükleniyor…');
    const manifestResponse = await fetch('/assets/manifest.json');
    if (!manifestResponse.ok) throw new Error('Original asset manifest is missing. Run scripts/prepare-assets.py.');
    const manifest = await manifestResponse.json() as Record<string, string>;
    const cameraConfigs = await loadOriginalCameraConfigs(manifest);
    this.cameraConfig = applyOriginalCameraProfile(this.camera, this.controls, cameraConfigs, this.cameraConfigId);
    this.world = await createOriginalWorld();
    this.scene.add(this.world.group);
    onProgress('Dinozor modelleri ve dokuları yükleniyor…');
    await Promise.all(SPECIES.map(s => this.template(s.id)));
    const pathKey = Object.keys(manifest).find(key => key.includes('ground.tga') && key.includes('/buildings/'));
    if (pathKey) {
      const texture = await new THREE.TextureLoader().loadAsync(manifest[pathKey]);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      this.groundMaterial = new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide });
    }
    if (this.world.minimapUrl) {
      this.mapImage = new Image();
      this.mapImage.src = this.world.minimapUrl;
    }
    const target = this.world.defaultCameraTarget ?? { x: 8, z: 18 };
    const light = this.scene.children.find(child => child instanceof THREE.DirectionalLight) as THREE.DirectionalLight;
    light.position.add(new THREE.Vector3(target.x, 0, target.z));
    light.target.position.set(target.x, 0, target.z);
    onProgress('Özgün gökyüzü ve kamera profili yükleniyor…');
    this.sky = await createOriginalSkyRenderer(manifest);
    this.sky.attach(this.scene);
    this.home();
  }

  private template(species: string): Promise<THREE.Group> {
    let pending = this.templates.get(species);
    if (!pending) {
      pending = loadOriginalModel(`${MODEL_ROOT}Actors/Dinos/${species}/${species}_lod1.mesh`);
      this.templates.set(species, pending);
    }
    return pending;
  }

  async thumbnails(): Promise<Record<string, string>> {
    const thumbs: Record<string, string> = {};
    const target = new THREE.WebGLRenderTarget(160, 110);
    const previousTarget = this.renderer.getRenderTarget();
    const previewScene = new THREE.Scene();
    previewScene.background = new THREE.Color(0x384168);
    previewScene.add(new THREE.AmbientLight(0xffffff, 1.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(4, 8, 8);
    previewScene.add(sun);
    const camera = new THREE.PerspectiveCamera(35, 160 / 110, 0.01, 1000);
    for (const species of SPECIES) {
      const model = (await this.template(species.id)).clone(true);
      previewScene.add(model);
      const bounds = new THREE.Box3().setFromObject(model);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z * 0.65) * 1.5;
      camera.position.copy(center).add(new THREE.Vector3(radius, radius * 0.5, radius));
      camera.lookAt(center);
      this.renderer.setRenderTarget(target);
      this.renderer.render(previewScene, camera);
      const pixels = new Uint8Array(160 * 110 * 4);
      this.renderer.readRenderTargetPixels(target, 0, 0, 160, 110, pixels);
      const canvas = document.createElement('canvas');
      canvas.width = 160; canvas.height = 110;
      const context = canvas.getContext('2d')!;
      const data = context.createImageData(160, 110);
      for (let row = 0; row < 110; row++) data.data.set(pixels.subarray((109 - row) * 640, (110 - row) * 640), row * 640);
      context.putImageData(data, 0, 0);
      thumbs[species.id] = canvas.toDataURL('image/png');
      previewScene.remove(model);
    }
    this.renderer.setRenderTarget(previousTarget);
    target.dispose();
    return thumbs;
  }

  home(): void {
    if (!this.world) return;
    const center = this.world.defaultCameraTarget ?? { x: 8, z: 18 };
    const height = this.world.terrainHeight(center.x, center.z);
    this.controls.target.set(center.x, height + 2, center.z);
    this.camera.position.set(center.x + 100, height + 102, center.z + 125);
    this.controls.update();
  }

  pan(x: number, z: number): void {
    const forward = new THREE.Vector3().subVectors(this.controls.target, this.camera.position);
    forward.y = 0; forward.normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const shift = right.multiplyScalar(x).addScaledVector(forward, z);
    this.controls.target.add(shift); this.camera.position.add(shift);
  }

  rotate(direction: number): void {
    const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), direction * Math.PI / 8);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }

  zoom(direction: number): void {
    const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    const bounds = this.cameraConfig?.distance ?? { min: 14, max: 500 };
    const distance = THREE.MathUtils.clamp(offset.length() * (direction > 0 ? 0.8 : 1.25), bounds.min, bounds.max);
    this.camera.position.copy(this.controls.target).add(offset.setLength(distance));
    this.controls.update();
  }

  centerOn(point: Point): void {
    const shift = new THREE.Vector3(point.x - this.controls.target.x, 0, point.z - this.controls.target.z);
    this.controls.target.add(shift); this.camera.position.add(shift);
  }

  setTool(tool: PlacementTool): void {
    this.tool = tool;
    this.preview.visible = false;
    this.canvas.style.cursor = tool ? 'crosshair' : '';
    // Keep one-finger drag free for camera rotation while a click places the selected item.
  }

  private resize(): void {
    const parent = this.canvas.parentElement!;
    const width = Math.max(parent.clientWidth, 1), height = Math.max(parent.clientHeight, 1);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private groundAt(clientX: number, clientY: number): Point | undefined {
    if (!this.world) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    this.ray.setFromCamera(this.pointer, this.camera);
    let y = this.world.terrainHeight(this.controls.target.x, this.controls.target.z);
    const hit = new THREE.Vector3();
    for (let i = 0; i < 4; i++) {
      if (!this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), hit)) return;
      y = this.world.terrainHeight(hit.x, hit.z);
    }
    return { x: Math.round(hit.x / 2) * 2, z: Math.round(hit.z / 2) * 2 };
  }

  validPlacement(point: Point): boolean {
    if (!this.tool || !this.state || !this.world) return false;
    if (this.world.terrainHeight(point.x, point.z) <= 0.2) return false;
    return this.tool.type === 'dino' ? Boolean(habitatAt(this.state, point)) : canBuild(this.state, this.tool.kind, point).ok;
  }

  private handleDown = (event: PointerEvent): void => {
    if (event.button === 0) this.pointerDown = { x: event.clientX, y: event.clientY, time: performance.now() };
  };
  private handleUp = (event: PointerEvent): void => {
    const down = this.pointerDown;
    this.pointerDown = undefined;
    if (event.button !== 0 || !down || Math.hypot(down.x - event.clientX, down.y - event.clientY) > 5 || performance.now() - down.time > 600) return;
    if (this.tool) {
      const point = this.groundAt(event.clientX, event.clientY);
      if (point) this.onPlace(point);
      return;
    }
    this.groundAt(event.clientX, event.clientY);
    const hits = this.ray.intersectObjects([...this.dinos.values()], true);
    let selected: number | null = null;
    if (hits.length) {
      let object: THREE.Object3D | null = hits[0].object;
      while (object && object.userData.dinosaurId === undefined) object = object.parent;
      selected = object?.userData.dinosaurId ?? null;
    }
    this.selected = selected;
    this.onSelect(selected);
  };
  private handleMove = (event: PointerEvent): void => {
    this.cursorPosition = this.groundAt(event.clientX, event.clientY);
  };
  private handleLeave = (): void => { this.cursorPosition = undefined; this.preview.visible = false; };
  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLElement && (event.target.closest('input,select,textarea,button') || event.target.isContentEditable)) return;
    this.keys.add(event.code);
  };
  private handleKeyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code); };
  private handleBlur = (): void => { this.keys.clear(); };

  update(state: GameState, delta: number): void {
    if (this.disposed || !this.world) return;
    this.state = state;
    this.animatedDinosaurs = 0;
    const cameraStep = delta * (this.cameraConfig?.moveSpeed.max ?? 20);
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.pan(0, cameraStep);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.pan(0, -cameraStep);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.pan(-cameraStep, 0);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.pan(cameraStep, 0);
    const rotationStep = this.cameraConfig?.rotationSpeed.max ?? 1.570796;
    if (this.keys.has('KeyQ')) this.smoothRotate(-rotationStep * delta);
    if (this.keys.has('KeyE')) this.smoothRotate(rotationStep * delta);
    this.controls.target.x = THREE.MathUtils.clamp(this.controls.target.x, -480, 480);
    this.controls.target.z = THREE.MathUtils.clamp(this.controls.target.z, -480, 480);
    this.controls.target.y = Math.max(0, this.world.terrainHeight(this.controls.target.x, this.controls.target.z)) + 2;
    this.controls.update();
    this.world.update(state.elapsed, state.paused ? 0 : delta * state.speed);
    this.sky?.update(state.paused ? 0 : delta * state.speed);
    const ids = new Set(state.dinosaurs.map(d => d.id));
    for (const [id, model] of this.dinos) if (!ids.has(id)) { this.scene.remove(model); this.dinos.delete(id); }
    for (const dinosaur of state.dinosaurs) {
      const model = this.dinos.get(dinosaur.id);
      if (!model) {
        const key = `dino-${dinosaur.id}`;
        if (!this.pending.has(key)) {
          this.pending.add(key);
          this.template(dinosaur.species).then(template => {
            if (this.disposed) return;
            const root = new THREE.Group();
            root.name = dinosaur.name;
            root.userData.dinosaurId = dinosaur.id;
            root.add(template.clone(true));
            this.dinos.set(dinosaur.id, root);
            this.scene.add(root);
          }).catch(error => this.onError(String(error))).finally(() => this.pending.delete(key));
        }
        continue;
      }
      const growth = dinosaur.parents ? Math.min(1, 0.45 + dinosaur.age / 180) : 1;
      model.scale.setScalar(growth);
      model.position.set(dinosaur.x, this.world.terrainHeight(dinosaur.x, dinosaur.z), dinosaur.z);
      model.rotation.y = dinosaur.heading;
      if (!state.paused && animateOriginalModel(model, state.elapsed + dinosaur.id * 0.37, 'walk')) this.animatedDinosaurs++;
    }
    const buildingIds = new Set(state.buildings.map(b => b.id));
    for (const [id, model] of this.buildings) if (!buildingIds.has(id)) { this.scene.remove(model); this.buildings.delete(id); }
    for (const building of state.buildings) {
      const key = `building-${building.id}`;
      if (this.buildings.has(building.id) || this.pending.has(key)) continue;
      this.pending.add(key);
      const load = building.kind === 'path'
        ? Promise.resolve(new THREE.Mesh(new THREE.PlaneGeometry(4, 4), this.groundMaterial ?? new THREE.MeshLambertMaterial({ color: 0xc7aa70, side: THREE.DoubleSide })))
        : loadOriginalModel(MODEL_ROOT + BUILD_MODELS[building.kind]);
      load.then(object => {
        if (this.disposed) return;
        const root = new THREE.Group();
        root.add(object);
        if (building.kind === 'path') object.rotation.x = -Math.PI / 2;
        root.position.set(building.x, this.world.terrainHeight(building.x, building.z) + 0.045, building.z);
        root.rotation.y = building.rotation;
        this.buildings.set(building.id, root); this.scene.add(root);
      }).catch(error => this.onError(String(error))).finally(() => this.pending.delete(key));
    }
    const selected = state.dinosaurs.find(d => d.id === this.selected);
    this.selection.visible = Boolean(selected);
    if (selected) this.selection.position.set(selected.x, this.world.terrainHeight(selected.x, selected.z) + 0.09, selected.z);
    this.preview.visible = Boolean(this.tool && this.cursorPosition);
    if (this.tool && this.cursorPosition) {
      const point = this.cursorPosition;
      this.preview.position.set(point.x, this.world.terrainHeight(point.x, point.z) + 0.12, point.z);
      this.preview.material.color.set(this.validPlacement(point) ? 0x7fff45 : 0xff4a35);
      const size = this.tool.type === 'dino' ? 5 : Math.max(3, (getBuildItem(this.tool.kind)?.radius ?? 2) * 2);
      this.preview.scale.setScalar(size / 4);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private smoothRotate(angle: number): void {
    const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    this.camera.position.copy(this.controls.target).add(offset);
  }

  drawMinimap(canvas: HTMLCanvasElement, state: GameState): void {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    const w = canvas.width, h = canvas.height;
    context.fillStyle = '#105fa4'; context.fillRect(0, 0, w, h);
    if (this.mapImage?.complete && this.mapImage.naturalWidth) context.drawImage(this.mapImage, 0, 0, w, h);
    const px = (x: number) => (x + 512) / 1024 * w;
    const pz = (z: number) => (z + 512) / 1024 * h;
    context.strokeStyle = '#f8ed87'; context.lineWidth = 1;
    for (const habitat of state.habitats) context.strokeRect(px(habitat.x - habitat.halfWidth), pz(habitat.z - habitat.halfDepth), habitat.halfWidth * 2 / 1024 * w, habitat.halfDepth * 2 / 1024 * h);
    context.fillStyle = '#fff49a';
    for (const dinosaur of state.dinosaurs) context.fillRect(px(dinosaur.x) - 1, pz(dinosaur.z) - 1, 2, 2);
    const visible = this.camera.position.distanceTo(this.controls.target) * 0.6 / 1024 * w;
    context.strokeStyle = '#fff';
    context.strokeRect(px(this.controls.target.x) - visible / 2, pz(this.controls.target.z) - visible / 2, visible, visible * 0.7);
  }

  diagnostics() {
    return {
      dinosaurModels: this.dinos.size,
      animatedDinosaurs: this.animatedDinosaurs,
      buildings: this.buildings.size,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      pending: this.pending.size,
      cameraProfile: this.cameraConfig ? this.cameraConfigId : null,
      cameraDistance: this.cameraConfig ? [this.cameraConfig.distance.min, this.cameraConfig.distance.max] : null,
      skybox: this.sky?.definition.island ?? null,
      cloudLayers: this.sky?.definition.clouds.layers.length ?? 0,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.sky?.dispose(this.scene);
    this.sky = undefined;
    this.resizeObserver.disconnect(); this.controls.dispose();
    this.canvas.removeEventListener('pointerdown', this.handleDown);
    this.canvas.removeEventListener('pointerup', this.handleUp);
    this.canvas.removeEventListener('pointermove', this.handleMove);
    this.canvas.removeEventListener('pointerleave', this.handleLeave);
    window.removeEventListener('keydown', this.handleKeyDown); window.removeEventListener('keyup', this.handleKeyUp); window.removeEventListener('blur', this.handleBlur);
    const geometries = new Set<THREE.BufferGeometry>(); const materials = new Set<THREE.Material>(); const textures = new Set<THREE.Texture>();
    this.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    });
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); textures.forEach(texture => texture.dispose());
    this.renderer.dispose(); this.canvas.remove();
  }
}
