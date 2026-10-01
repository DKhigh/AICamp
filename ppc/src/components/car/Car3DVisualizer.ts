/**
 * Car3DVisualizer — car-manager/car-3d-visualizer.js를 모듈로 옮긴 것.
 * 세단 3D 모델, 마우스 회전, 부품 줌인, 후드 열림, 3D → 화면 좌표 핫스팟 투영은 원본 그대로이고,
 * PPC의 BOM 7개 부품(엔진·변속기·브레이크·서스펜션·조향·차체·배터리)에 맞게 다음을 바꿨다.
 *  - 핫스팟·카메라 시점을 7개 부품으로 재구성 (변속기·서스펜션·조향 메쉬 추가)
 *  - 부품 상태(차질/대응 중/주의/정상)를 해당 부품 메쉬의 색으로 표시
 *  - 대시보드 안에 들어가므로 휠 줌을 끄고(페이지 스크롤 유지), dispose()를 추가
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

export type CarPartKey = 'engine' | 'transmission' | 'brake' | 'suspension' | 'steering' | 'body' | 'battery';
export type FocusKey = CarPartKey | 'all';
export type ViewMode = 'exterior' | 'cutaway';
export type StatusLevel = 'danger' | 'info' | 'warn' | 'normal';

export const CAR_PART_KEYS: CarPartKey[] = ['engine', 'transmission', 'brake', 'suspension', 'steering', 'body', 'battery'];

interface CameraPreset {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  hoodOpen: boolean;
  /** 차체 안쪽 부품이라 줌인할 때 X-Ray 투시로 보여 준다 */
  xray: boolean;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const CAMERA_PRESETS: Record<FocusKey, CameraPreset> = {
  all: { pos: v(-9.0, 4.4, 9.8), target: v(0.1, 0.7, 0), hoodOpen: false, xray: false },
  engine: { pos: v(-4.8, 2.9, 2.5), target: v(-2.6, 1.1, 0), hoodOpen: true, xray: false },
  transmission: { pos: v(-3.0, 3.3, 3.9), target: v(-1.5, 0.8, 0), hoodOpen: false, xray: true },
  brake: { pos: v(-3.2, 0.85, 3.4), target: v(-2.6, 0.65, 1.85), hoodOpen: false, xray: false },
  suspension: { pos: v(4.9, 2.7, 3.9), target: v(2.6, 0.95, 1.3), hoodOpen: false, xray: true },
  steering: { pos: v(-2.6, 2.9, 3.6), target: v(-1.5, 1.05, 0.5), hoodOpen: false, xray: true },
  body: { pos: v(0.0, 1.8, 6.2), target: v(0, 1.1, 0), hoodOpen: false, xray: false },
  battery: { pos: v(-0.6, 2.8, 3.0), target: v(0, 0.8, 0.2), hoodOpen: false, xray: true },
};

/** 핫스팟 배지가 붙는 3D 좌표 */
const ANCHORS: Record<CarPartKey, THREE.Vector3> = {
  engine: v(-2.7, 1.45, 0.2),
  transmission: v(-1.4, 1.1, 0.0),
  brake: v(-2.6, 0.65, 1.85),
  suspension: v(2.6, 1.25, 1.55),
  steering: v(-0.85, 1.65, 0.75),
  body: v(0.5, 1.2, 1.78),
  battery: v(0.9, 0.5, 1.4),
};

const STATUS_COLOR: Record<Exclude<StatusLevel, 'normal'>, number> = {
  danger: 0xef4444,
  info: 0x3b82f6,
  warn: 0xf59e0b,
};

interface Accent {
  material: THREE.MeshStandardMaterial;
  baseColor: number;
}

export interface Car3DOptions {
  container: HTMLElement;
  /** 핫스팟 DOM 요소. 매 프레임 화면 좌표로 옮긴다 */
  getHotspot: (key: CarPartKey) => HTMLElement | null;
}

export class Car3DVisualizer {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private getHotspot: Car3DOptions['getHotspot'];

  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private carRoot = new THREE.Group();
  private hoodPivot = new THREE.Group();
  private resizeObserver: ResizeObserver;
  private rafId = 0;
  private disposed = false;

  private bodyPaint!: THREE.MeshPhysicalMaterial;
  private glass!: THREE.MeshPhysicalMaterial;
  private chrome!: THREE.MeshStandardMaterial;
  private tireRubber!: THREE.MeshStandardMaterial;
  private alloyRim!: THREE.MeshStandardMaterial;
  private brakeRotor!: THREE.MeshStandardMaterial;
  private engineMetal!: THREE.MeshStandardMaterial;
  private turboGold!: THREE.MeshStandardMaterial;
  private batteryPack!: THREE.MeshStandardMaterial;
  private accents: Partial<Record<CarPartKey, Accent>> = {};
  private statuses: Partial<Record<CarPartKey, StatusLevel>> = {};

  private focus: FocusKey = 'all';
  private userMode: ViewMode = 'exterior';
  private autoRotate = false;
  private targetHoodAngle = 0;

  // 카메라 전환 애니메이션
  private isTransitioning = false;
  private cameraStart = new THREE.Vector3();
  private cameraEnd = new THREE.Vector3();
  private targetStart = new THREE.Vector3();
  private targetEnd = new THREE.Vector3();
  private transitionStart = 0;
  private readonly transitionMs = 1200;
  private projected = new THREE.Vector3();

  constructor(options: Car3DOptions) {
    this.container = options.container;
    this.getHotspot = options.getHotspot;

    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 500;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'car-canvas';
    // WebGL을 못 쓰는 환경이면 여기서 예외가 난다 → 호출한 쪽에서 대체 화면을 보여 준다
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.container.appendChild(this.canvas);

    this.scene.background = new THREE.Color(0xf1f5f9);
    this.scene.fog = new THREE.FogExp2(0xf1f5f9, 0.025);

    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    this.camera.position.copy(CAMERA_PRESETS.all.pos);

    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.enableZoom = false; // 대시보드 스크롤을 막지 않는다. 확대는 부품 선택으로 한다
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03; // 바닥 아래로 내려가지 않게
    this.controls.minDistance = 2.0;
    this.controls.maxDistance = 22.0;
    this.controls.target.copy(CAMERA_PRESETS.all.target);
    this.controls.update();

    this.initLighting();
    this.initFloor();
    this.createCarModel();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);

    this.animate = this.animate.bind(this);
    this.rafId = requestAnimationFrame(this.animate);
  }

  // ── 무대 ────────────────────────────────────────────────────────────────

  private initLighting() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.25);
    keyLight.position.set(-8, 12, 8);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 30;
    keyLight.shadow.bias = -0.0005;
    const d = 8;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xdbeafe, 0.65);
    fillLight.position.set(8, 8, -6);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffedd5, 0.9);
    rimLight.position.set(0, 10, -10);
    this.scene.add(rimLight);
  }

  private initFloor() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.85, metalness: 0.1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(4.8, 4.88, 64),
      new THREE.MeshBasicMaterial({ color: 0x94a3b8, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.001;
    this.scene.add(ring);

    const grid = new THREE.GridHelper(30, 30, 0x94a3b8, 0xcbd5e1);
    grid.position.y = 0.002;
    this.scene.add(grid);
  }

  // ── 차량 모델 ───────────────────────────────────────────────────────────

  private accent(key: CarPartKey, baseColor: number, metalness = 0.7, roughness = 0.35) {
    const material = new THREE.MeshStandardMaterial({ color: baseColor, metalness, roughness });
    this.accents[key] = { material, baseColor };
    return material;
  }

  private add<T extends THREE.Object3D>(parent: THREE.Object3D, obj: T, x: number, y: number, z: number): T {
    obj.position.set(x, y, z);
    parent.add(obj);
    return obj;
  }

  private createCarModel() {
    this.scene.add(this.carRoot);

    this.bodyPaint = new THREE.MeshPhysicalMaterial({
      color: 0xf8fafc,
      metalness: 0.7,
      roughness: 0.22,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
      reflectivity: 0.9,
    });
    this.glass = new THREE.MeshPhysicalMaterial({
      color: 0x0f172a,
      metalness: 0.9,
      roughness: 0.05,
      transmission: 0.6,
      transparent: true,
      opacity: 0.75,
    });
    this.chrome = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.95, roughness: 0.08 });
    this.tireRubber = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85, metalness: 0.15 });
    this.alloyRim = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, metalness: 0.88, roughness: 0.18 });
    this.brakeRotor = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.9, roughness: 0.25 });
    this.engineMetal = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.35 });
    this.turboGold = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.9, roughness: 0.3 });
    this.batteryPack = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.6, roughness: 0.4 });

    // 하부 섀시
    const chassis = this.add(this.carRoot, new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.3, 3.4), this.engineMetal), 0, 0.45, 0);
    chassis.castShadow = true;
    chassis.receiveShadow = true;

    this.buildBodyShell();
    this.buildAnimatedHood();
    this.buildGreenhouse();
    this.buildFrontFascia();
    this.buildRearEnd();
    this.buildEngineBay();
    this.buildTransmission();
    this.buildSteering();
    this.buildBattery();
    this.buildWheelsBrakesSuspension();
  }

  private buildBodyShell() {
    const paint = this.bodyPaint;
    this.add(this.carRoot, new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.85, 3.5), paint), 0, 0.95, 0).castShadow = true;
    this.add(this.carRoot, new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.75, 3.46), paint), -2.8, 0.9, 0).castShadow = true;
    this.add(this.carRoot, new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 3.46), paint), 2.8, 0.92, 0).castShadow = true;

    for (const z of [-1.75, 1.75]) {
      const out = z > 0 ? 1 : -1;
      this.add(this.carRoot, new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.14, 0.12), this.engineMetal), 0, 0.38, z);
      // 앞바퀴 뒤 펜더 벤트
      this.add(this.carRoot, new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.04), this.chrome), -1.8, 1.15, z + out * 0.01);
      // 사이드 미러
      const arm = this.add(
        this.carRoot,
        new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.25), this.engineMetal),
        -1.3,
        1.5,
        z + out * 0.15,
      );
      arm.rotation.z = Math.PI / 4;
      this.add(this.carRoot, new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.14), paint), -1.3, 1.58, z + out * 0.24);
      // 도어 핸들
      for (const x of [-0.4, 0.9]) {
        this.add(this.carRoot, new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.08, 0.06), this.chrome), x, 1.25, z + out * 0.02);
      }
    }
  }

  private buildAnimatedHood() {
    // 앞유리 아래를 축으로 후드가 열린다
    this.hoodPivot.position.set(-1.6, 1.35, 0);
    this.carRoot.add(this.hoodPivot);

    const hood = this.add(this.hoodPivot, new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.08, 3.25), this.bodyPaint), -1.18, 0.04, 0);
    hood.rotation.z = 0.06;
    hood.castShadow = true;

    for (const z of [-0.65, 0.65]) {
      const ridge = this.add(this.hoodPivot, new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.03, 0.06), this.chrome), -1.18, 0.09, z);
      ridge.rotation.z = 0.06;
    }
  }

  private buildGreenhouse() {
    this.add(this.carRoot, new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 2.9), this.bodyPaint), 0.1, 2.38, 0).castShadow = true;

    const windshield = this.add(this.carRoot, new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 3.0), this.glass), -1.0, 1.88, 0);
    windshield.rotation.z = 0.65;
    const rearGlass = this.add(this.carRoot, new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 2.9), this.glass), 1.4, 1.85, 0);
    rearGlass.rotation.z = -0.58;

    for (const z of [-1.52, 1.52]) {
      this.add(this.carRoot, new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.72, 0.05), this.glass), 0.1, 1.82, z);
      this.add(this.carRoot, new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.76, 0.08), this.engineMetal), 0.1, 1.82, z);
      this.add(this.carRoot, new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.04, 0.04), this.chrome), 0.1, 2.22, z);
    }
  }

  private buildFrontFascia() {
    this.add(this.carRoot, new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.6, 3.4), this.bodyPaint), -4.05, 0.7, 0).castShadow = true;

    const grilleMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5, metalness: 0.8 });
    this.add(this.carRoot, new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 2.1), grilleMat), -4.32, 0.88, 0);
    this.add(this.carRoot, new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.46, 2.18), this.chrome), -4.31, 0.88, 0);

    const lightMat = new THREE.MeshStandardMaterial({
      color: 0xe0f2fe,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.75,
      roughness: 0.1,
    });
    for (const z of [-1.25, 1.25]) {
      const light = this.add(this.carRoot, new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.18, 0.55), lightMat), -4.1, 1.08, z);
      light.rotation.y = z > 0 ? -0.2 : 0.2;
    }
  }

  private buildRearEnd() {
    this.add(this.carRoot, new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.65, 3.42), this.bodyPaint), 4.0, 0.72, 0).castShadow = true;
    this.add(this.carRoot, new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 2.9), this.bodyPaint), 3.85, 1.45, 0);

    const tailMat = new THREE.MeshStandardMaterial({ color: 0x991b1b, emissive: 0xef4444, emissiveIntensity: 0.95 });
    this.add(this.carRoot, new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 2.85), tailMat), 4.28, 1.35, 0);

    for (const z of [-0.95, 0.95]) {
      const exhaust = this.add(this.carRoot, new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.35, 16), this.chrome), 4.25, 0.42, z);
      exhaust.rotation.z = Math.PI / 2;
    }
  }

  private buildEngineBay() {
    const engine = this.add(this.carRoot, new THREE.Group(), -2.7, 0.95, 0);

    this.add(engine, new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.65, 0.95), this.engineMetal), 0, 0.15, 0);
    // 실린더 헤드 커버 = 엔진 상태 표시 메쉬
    const cover = this.accent('engine', 0xf1f5f9, 0.88, 0.18);
    this.add(engine, new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.15, 0.85), cover), 0, 0.52, 0);

    // 흡기 매니폴드 러너 6개
    for (let i = 0; i < 6; i++) {
      const runner = this.add(
        engine,
        new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.045, 8, 16, Math.PI), this.chrome),
        -0.4 + i * 0.16,
        0.58,
        i % 2 === 0 ? 0.22 : -0.22,
      );
      runner.rotation.x = i % 2 === 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    // 트윈 터보
    for (const z of [-0.55, 0.55]) {
      const turbo = this.add(engine, new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.07, 12, 24), this.turboGold), -0.35, 0.22, z);
      turbo.rotation.y = Math.PI / 2;
    }
    // 고압 연료펌프, 라디에이터
    this.add(engine, new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.28, 16), this.chrome), 0.42, 0.45, 0.28);
    this.add(engine, new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.65, 1.8), this.engineMetal), -0.85, 0.18, 0);
  }

  private buildTransmission() {
    const mat = this.accent('transmission', 0x94a3b8);
    const group = this.add(this.carRoot, new THREE.Group(), -1.55, 0.86, 0);

    const bell = this.add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.35, 20), mat), -0.35, 0, 0);
    bell.rotation.z = Math.PI / 2;
    const gearCase = this.add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.2, 0.9, 20), mat), 0.25, 0, 0);
    gearCase.rotation.z = Math.PI / 2;
    // 뒤로 가는 구동축
    const shaft = this.add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.4, 12), this.engineMetal), 2.4, -0.05, 0);
    shaft.rotation.z = Math.PI / 2;
  }

  private buildSteering() {
    const mat = this.accent('steering', 0x475569);
    const up = new THREE.Vector3(0, 1, 0);

    // 앞바퀴 사이의 랙
    const rack = this.add(this.carRoot, new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.1, 12), mat), -2.05, 0.66, 0);
    rack.rotation.x = Math.PI / 2;

    // 랙에서 운전석 핸들까지의 컬럼
    const from = v(-2.05, 0.66, 0.75);
    const to = v(-0.85, 1.6, 0.75);
    const dir = to.clone().sub(from);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, dir.length(), 10), mat);
    column.position.copy(from.clone().add(to).multiplyScalar(0.5));
    column.quaternion.setFromUnitVectors(up, dir.clone().normalize());
    this.carRoot.add(column);

    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.035, 10, 28), mat);
    wheel.position.copy(to);
    wheel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
    this.carRoot.add(wheel);
  }

  private buildBattery() {
    const group = this.add(this.carRoot, new THREE.Group(), 0.1, 0.52, 0);
    this.add(group, new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.22, 2.6), this.batteryPack), 0, 0, 0);

    const cell = this.accent('battery', 0x64748b, 0.5, 0.4);
    for (let x = -1.2; x <= 1.2; x += 0.8) {
      this.add(group, new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 2.3), cell), x, 0.12, 0);
    }
  }

  private buildWheelsBrakesSuspension() {
    const caliperMat = this.accent('brake', 0x475569, 0.5, 0.3);
    const springMat = this.accent('suspension', 0x94a3b8);

    const wheelPositions = [
      { x: -2.6, z: 1.78, isFront: true },
      { x: -2.6, z: -1.78, isFront: true },
      { x: 2.6, z: 1.78, isFront: false },
      { x: 2.6, z: -1.78, isFront: false },
    ];

    for (const wp of wheelPositions) {
      const out = wp.z > 0 ? 1 : -1;
      const wheel = this.add(this.carRoot, new THREE.Group(), wp.x, 0.65, wp.z);

      const tire = this.add(wheel, new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.38, 32), this.tireRubber), 0, 0, 0);
      tire.rotation.x = Math.PI / 2;
      tire.castShadow = true;
      const rim = this.add(wheel, new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.39, 32), this.alloyRim), 0, 0, 0);
      rim.rotation.x = Math.PI / 2;

      // 10-스포크
      const spokes = this.add(wheel, new THREE.Group(), 0, 0, out * 0.18);
      for (let s = 0; s < 10; s++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.04), this.alloyRim);
        spoke.rotation.z = (s * Math.PI) / 5;
        spokes.add(spoke);
      }

      // 브레이크: 디스크 로터 + 캘리퍼(상태 표시 메쉬)
      const rotor = this.add(wheel, new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 32), this.brakeRotor), 0, 0, out * 0.08);
      rotor.rotation.x = Math.PI / 2;
      this.add(wheel, new THREE.Mesh(new THREE.BoxGeometry(0.18, wp.isFront ? 0.34 : 0.24, 0.12), caliperMat), 0.3, 0.18, out * 0.08);

      // 서스펜션: 로어암 + 댐퍼 + 코일 스프링(상태 표시 메쉬), 바퀴 안쪽
      const strut = this.add(this.carRoot, new THREE.Group(), wp.x, 0.65, wp.z - out * 0.46);
      this.add(strut, new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.5), this.engineMetal), 0, -0.05, out * 0.1);
      this.add(strut, new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 10), this.engineMetal), 0, 0.42, 0);
      for (let i = 0; i < 5; i++) {
        const coil = this.add(strut, new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.032, 8, 20), springMat), 0, 0.2 + i * 0.13, 0);
        coil.rotation.x = Math.PI / 2;
      }
    }
  }

  // ── 외부에서 부르는 조작 ─────────────────────────────────────────────────

  setCarColor(hex: string) {
    this.bodyPaint.color.set(hex);
  }

  setMode(mode: ViewMode) {
    this.userMode = mode;
    this.applyMode();
  }

  setAutoRotate(on: boolean) {
    this.autoRotate = on;
  }

  /** 부품 상태를 해당 메쉬의 색으로 표시한다. 없는 키는 정상으로 본다 */
  setStatuses(statuses: Partial<Record<CarPartKey, StatusLevel>>) {
    this.statuses = statuses;
    for (const key of CAR_PART_KEYS) {
      const accent = this.accents[key];
      if (!accent) continue;
      const level = statuses[key] ?? 'normal';
      if (level === 'normal') {
        accent.material.color.setHex(accent.baseColor);
        accent.material.emissive.setHex(0x000000);
        accent.material.emissiveIntensity = 1;
      } else {
        accent.material.color.setHex(STATUS_COLOR[level]);
        accent.material.emissive.setHex(STATUS_COLOR[level]);
        accent.material.emissiveIntensity = level === 'warn' ? 0.35 : 0.6;
      }
    }
  }

  /** 카메라를 부품으로 부드럽게 옮긴다 ('all'이면 전체 외형) */
  zoomToPart(part: FocusKey) {
    this.focus = part;
    const preset = CAMERA_PRESETS[part];

    this.cameraStart.copy(this.camera.position);
    this.cameraEnd.copy(preset.pos);
    this.targetStart.copy(this.controls.target);
    this.targetEnd.copy(preset.target);
    this.transitionStart = performance.now();
    this.isTransitioning = true;

    this.targetHoodAngle = preset.hoodOpen ? -0.65 : 0;
    this.applyMode();
  }

  private applyMode() {
    const cutaway = this.userMode === 'cutaway' || CAMERA_PRESETS[this.focus].xray;
    this.bodyPaint.transparent = cutaway;
    this.bodyPaint.opacity = cutaway ? 0.28 : 1.0;
    this.bodyPaint.depthWrite = !cutaway;
    this.bodyPaint.needsUpdate = true;
    this.glass.opacity = cutaway ? 0.2 : 0.75;
  }

  // ── 프레임 ──────────────────────────────────────────────────────────────

  private resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private updateHotspots() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    for (const key of CAR_PART_KEYS) {
      const el = this.getHotspot(key);
      if (!el) continue;

      const p = this.projected.copy(ANCHORS[key]).applyMatrix4(this.carRoot.matrixWorld).project(this.camera);
      // 카메라 뒤에 있거나, 다른 부품을 보고 있는 동안에는 숨긴다
      const hidden = p.z > 1 || (this.focus !== 'all' && this.focus !== key);
      if (hidden) {
        el.style.opacity = '0';
        el.style.visibility = 'hidden';
        continue;
      }
      const x = (p.x * 0.5 + 0.5) * width;
      const y = (-p.y * 0.5 + 0.5) * height;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.style.opacity = '1';
      el.style.visibility = 'visible';
    }
  }

  private animate(now: number) {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.animate);

    if (this.isTransitioning) {
      let t = (now - this.transitionStart) / this.transitionMs;
      if (t >= 1) {
        t = 1;
        this.isTransitioning = false;
      }
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.camera.position.lerpVectors(this.cameraStart, this.cameraEnd, ease);
      this.controls.target.lerpVectors(this.targetStart, this.targetEnd, ease);
    }

    this.hoodPivot.rotation.z += (this.targetHoodAngle - this.hoodPivot.rotation.z) * 0.08;

    if (this.autoRotate && !this.isTransitioning) {
      this.carRoot.rotation.y += 0.005;
    }

    // 차질 부품은 깜빡인다
    const pulse = 0.55 + 0.4 * Math.sin(now / 260);
    for (const key of CAR_PART_KEYS) {
      if (this.statuses[key] === 'danger') {
        const accent = this.accents[key];
        if (accent) accent.material.emissiveIntensity = pulse;
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.updateHotspots();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else if (material) material.dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
