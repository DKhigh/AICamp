/**
 * Car3DVisualizer — car-manager/car-3d-visualizer.js를 모듈로 옮긴 것.
 * 마우스 회전, 부품 줌인, 후드 열림, 3D → 화면 좌표 핫스팟 투영은 원본 방식 그대로이고,
 * PPC의 BOM 7개 부품(엔진·변속기·브레이크·서스펜션·조향·차체·배터리)에 맞게 다음을 바꿨다.
 *  - 차체: 상자 조합 대신 옆모습 윤곽선을 폭 방향으로 밀어낸(Extrude) 세단. 휠 아치를 윤곽에서 파내고
 *    바퀴·엔진을 차체 안쪽 치수에 맞춰, 부품이 차체를 뚫고 나오지 않는다
 *  - 핫스팟·카메라 시점을 7개 부품으로 재구성 (변속기·서스펜션·조향 메쉬 추가)
 *  - 부품 상태(차질/대응 중/주의/정상)를 해당 부품 메쉬의 색으로 표시
 *  - 대시보드 안에 들어가므로 휠 줌을 끄고(페이지 스크롤 유지), dispose()를 추가
 *
 * 좌표: 앞이 -x, 위가 +y, 운전석(왼쪽)이 +z. 길이 약 8.6, 폭 3.5, 높이 2.35.
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
  // 차가 가로로 놓였을 때도 앞뒤가 잘리지 않도록 넉넉히 떨어져서 본다
  all: { pos: v(-12.6, 6.0, 13.7), target: v(0.1, 0.6, 0), hoodOpen: false, xray: false },
  engine: { pos: v(-5.6, 3.1, 3.0), target: v(-2.75, 0.95, 0), hoodOpen: true, xray: true },
  transmission: { pos: v(-3.0, 3.3, 3.9), target: v(-1.5, 0.8, 0), hoodOpen: false, xray: true },
  brake: { pos: v(-3.3, 0.9, 3.6), target: v(-2.6, 0.62, 1.5), hoodOpen: false, xray: false },
  suspension: { pos: v(4.9, 2.7, 3.9), target: v(2.6, 0.9, 1.1), hoodOpen: false, xray: true },
  steering: { pos: v(-2.6, 2.9, 3.6), target: v(-1.5, 1.05, 0.5), hoodOpen: false, xray: true },
  body: { pos: v(0.0, 1.8, 6.6), target: v(0, 1.1, 0), hoodOpen: false, xray: false },
  battery: { pos: v(-0.6, 2.8, 3.0), target: v(0, 0.8, 0.2), hoodOpen: false, xray: true },
};

/** 핫스팟 배지가 붙는 3D 좌표 */
const ANCHORS: Record<CarPartKey, THREE.Vector3> = {
  engine: v(-2.75, 1.38, 0.2),
  transmission: v(-1.4, 1.1, 0.0),
  brake: v(-2.6, 0.62, 1.72),
  suspension: v(2.6, 1.15, 1.2),
  steering: v(-0.85, 1.65, 0.75),
  body: v(0.5, 1.15, 1.76),
  battery: v(0.9, 0.55, 1.2),
};

const STATUS_COLOR: Record<Exclude<StatusLevel, 'normal'>, number> = {
  danger: 0xef4444,
  info: 0x3b82f6,
  warn: 0xf59e0b,
};

// ── 차체 치수 ───────────────────────────────────────────────────────────────
const WHEEL_X = 2.6; // 앞바퀴 -WHEEL_X, 뒷바퀴 +WHEEL_X
const WHEEL_Y = 0.62;
const WHEEL_Z = 1.5; // 바퀴 중심. 타이어 바깥면(1.68)이 차체 옆면(1.75)보다 안쪽이다
const WHEEL_R = 0.62;
const ARCH_R = 0.78;
const SILL_Y = 0.4;
const CORE_HALF = 1.3; // 차체 중심부(엔진·실내가 들어가는 통)의 반폭
const BODY_HALF = 1.75;
const CABIN_HALF = 1.48;

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
  /** 겉 장식(그릴, 전후 램프, 몰딩, 손잡이, 미러). X-Ray 투시에서는 숨긴다 */
  private exterior = new THREE.Group();
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private carRoot = new THREE.Group();
  private hoodPivot = new THREE.Group();
  private resizeObserver: ResizeObserver;
  private rafId = 0;
  private disposed = false;

  private bodyPaint!: THREE.MeshPhysicalMaterial;
  private glass!: THREE.MeshLambertMaterial;
  private chrome!: THREE.MeshStandardMaterial;
  private darkTrim!: THREE.MeshStandardMaterial;
  private tireRubber!: THREE.MeshStandardMaterial;
  private alloyRim!: THREE.MeshStandardMaterial;
  private brakeRotor!: THREE.MeshStandardMaterial;
  private engineMetal!: THREE.MeshStandardMaterial;
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

  private box(parent: THREE.Object3D, size: [number, number, number], material: THREE.Material, x: number, y: number, z: number) {
    return this.add(parent, new THREE.Mesh(new THREE.BoxGeometry(...size), material), x, y, z);
  }

  /** 옆모습 윤곽(xy)을 z 방향으로 밀어낸 메쉬. z = zFrom ~ zFrom + depth (bevel이 있으면 양쪽으로 그만큼 더) */
  private extrude(shape: THREE.Shape, zFrom: number, depth: number, material: THREE.Material, bevel = 0) {
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      curveSegments: 20,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 3,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = zFrom;
    mesh.castShadow = true;
    this.carRoot.add(mesh);
    return mesh;
  }

  /** 차체 아랫부분(벨트라인 아래)의 옆모습. withArches면 휠 아치를 파낸다 */
  private bodyProfile(withArches: boolean): THREE.Shape {
    const s = new THREE.Shape();
    s.moveTo(-4.15, SILL_Y);
    s.quadraticCurveTo(-4.34, 0.45, -4.32, 0.75); // 앞 범퍼
    s.quadraticCurveTo(-4.3, 1.08, -3.85, 1.2); // 노즈
    s.quadraticCurveTo(-2.8, 1.36, -1.75, 1.44); // 후드
    s.lineTo(3.0, 1.52); // 벨트라인
    s.quadraticCurveTo(3.9, 1.55, 4.2, 1.46); // 트렁크
    s.quadraticCurveTo(4.36, 1.3, 4.32, 0.8); // 뒷면
    s.quadraticCurveTo(4.3, 0.44, 4.1, SILL_Y); // 뒤 범퍼
    if (withArches) {
      const half = Math.sqrt(ARCH_R ** 2 - (WHEEL_Y - SILL_Y) ** 2);
      const a = Math.asin((WHEEL_Y - SILL_Y) / ARCH_R);
      for (const x of [WHEEL_X, -WHEEL_X]) {
        s.lineTo(x + half, SILL_Y);
        s.absarc(x, WHEEL_Y, ARCH_R, -a, Math.PI + a, false);
      }
    }
    s.lineTo(-4.15, SILL_Y);
    return s;
  }

  private createCarModel() {
    this.scene.add(this.carRoot);

    // 도장은 한 가지 색(펄 화이트)으로 고정한다
    this.bodyPaint = new THREE.MeshPhysicalMaterial({
      color: 0xf3f5f8,
      metalness: 0.25,
      roughness: 0.32,
      clearcoat: 1.0,
      clearcoatRoughness: 0.12,
    });
    // 반사광이 없는 재질: 앞유리가 조명을 받아 하얗게 날아가 보이지 않게 한다
    this.glass = new THREE.MeshLambertMaterial({ color: 0x0f172a, transparent: true, opacity: 0.82 });
    this.chrome = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.9, roughness: 0.15 });
    this.darkTrim = new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.3, roughness: 0.6 });
    this.tireRubber = new THREE.MeshStandardMaterial({ color: 0x0b0f17, roughness: 0.92, metalness: 0 });
    this.alloyRim = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.75, roughness: 0.25, side: THREE.DoubleSide });
    this.brakeRotor = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.3 });
    this.engineMetal = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.35 });
    this.batteryPack = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.6, roughness: 0.4 });

    this.buildBodyShell();
    this.buildHood();
    this.buildCabin();
    this.buildExteriorDetails();
    this.buildEngineBay();
    this.buildTransmission();
    this.buildSteering();
    this.buildBattery();
    this.buildWheelsBrakesSuspension();
  }

  private buildBodyShell() {
    // 중심부: 휠 아치가 없는 통. 엔진·변속기·배터리가 이 안에 들어 있어 외형 모드에서는 보이지 않는다
    this.extrude(this.bodyProfile(false), -CORE_HALF, CORE_HALF * 2, this.bodyPaint).receiveShadow = true;

    // 좌우 펜더·도어 패널: 휠 아치를 파낸 윤곽. 바퀴는 이 두께 안(z 1.3~1.75)에 들어간다
    const bevel = 0.05;
    const depth = BODY_HALF - bevel - (CORE_HALF - 0.1);
    this.extrude(this.bodyProfile(true), CORE_HALF - 0.1, depth, this.bodyPaint, bevel);
    this.extrude(this.bodyProfile(true), -(CORE_HALF - 0.1) - depth, depth, this.bodyPaint, bevel);

    // 휠 하우스 안쪽(어두운 라이너)
    const a = Math.asin((WHEEL_Y - SILL_Y) / ARCH_R);
    const liner = new THREE.CircleGeometry(ARCH_R - 0.02, 40, -a, Math.PI + 2 * a);
    for (const x of [-WHEEL_X, WHEEL_X]) {
      this.add(this.carRoot, new THREE.Mesh(liner, this.darkTrim), x, WHEEL_Y, CORE_HALF + 0.004);
      this.add(this.carRoot, new THREE.Mesh(liner, this.darkTrim), x, WHEEL_Y, -CORE_HALF - 0.004).rotation.y = Math.PI;
    }
  }

  private buildHood() {
    // 카울(앞유리 아래)을 축으로 열리는 얇은 후드 패널. 차체 윗면 곡선을 그대로 따른다
    const px = -1.78;
    const py = 1.44;
    this.hoodPivot.position.set(px, py, 0);
    this.carRoot.add(this.hoodPivot);

    const lift = 0.012;
    const t = 0.035;
    const s = new THREE.Shape();
    s.moveTo(-3.8 - px, 1.208 + lift - py);
    s.quadraticCurveTo(-2.8 - px, 1.36 + lift - py, 0, lift);
    s.lineTo(0, lift + t);
    s.quadraticCurveTo(-2.8 - px, 1.36 + lift + t - py, -3.8 - px, 1.208 + lift + t - py);

    const half = 1.42;
    const hood = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: half * 2, bevelEnabled: false, curveSegments: 16 }), this.bodyPaint);
    hood.position.z = -half;
    hood.castShadow = true;
    this.hoodPivot.add(hood);
  }

  private buildCabin() {
    // 유리 온실: 앞유리 → 길게 뻗은 지붕 → 트렁크 끝까지 완만하게 내려가는 뒷유리 (대형 패스트백 세단의 비례)
    // 특정 양산차를 그대로 옮기지 않는다: 창 나눔과 필러 모양은 이 모델만의 것이다
    const roofFront: [number, number] = [-0.5, 2.24];
    const roofRear: [number, number] = [1.55, 2.24];
    const tail: [number, number] = [3.55, 1.4];
    const outline = (shape: THREE.Shape) => {
      shape.moveTo(-1.82, 1.3);
      shape.lineTo(...roofFront);
      shape.quadraticCurveTo(0.5, 2.38, ...roofRear);
      shape.quadraticCurveTo(2.75, 2.0, ...tail);
    };
    const glass = new THREE.Shape();
    outline(glass);
    this.extrude(glass, -CABIN_HALF, CABIN_HALF * 2, this.glass).castShadow = false;

    // 옆면 프레임(A·B·C 필러와 루프 레일): 유리 윤곽에서 창문 세 개를 뚫은 판
    const frame = new THREE.Shape();
    outline(frame);
    const frontWindow = new THREE.Path();
    frontWindow.moveTo(-1.2, 1.56);
    frontWindow.lineTo(-0.34, 2.11);
    frontWindow.lineTo(0.36, 2.16);
    frontWindow.lineTo(0.36, 1.57);
    const rearWindow = new THREE.Path();
    rearWindow.moveTo(0.56, 1.57);
    rearWindow.lineTo(0.56, 2.16);
    rearWindow.lineTo(1.5, 2.12);
    rearWindow.lineTo(1.78, 1.6);
    // 쿼터 글라스: 뒷문 뒤의 작은 사다리꼴 창
    const quarterWindow = new THREE.Path();
    quarterWindow.moveTo(1.98, 1.6);
    quarterWindow.lineTo(1.72, 2.07);
    quarterWindow.lineTo(2.1, 1.97);
    quarterWindow.lineTo(2.62, 1.63);
    frame.holes.push(frontWindow, rearWindow, quarterWindow);
    const plate = 0.05;
    this.extrude(frame, CABIN_HALF, plate, this.bodyPaint);
    this.extrude(frame, -CABIN_HALF - plate, plate, this.bodyPaint);

    // 지붕 패널
    const roof = new THREE.Shape();
    roof.moveTo(-0.55, 2.2);
    roof.quadraticCurveTo(0.5, 2.38, 1.6, 2.21);
    roof.lineTo(1.6, 2.23);
    roof.quadraticCurveTo(0.5, 2.43, -0.55, 2.22);
    const roofHalf = CABIN_HALF + plate;
    this.extrude(roof, -roofHalf, roofHalf * 2, this.bodyPaint);
  }

  private buildExteriorDetails() {
    // 그릴·램프·몰딩 같은 겉 장식은 한 묶음으로 두고, X-Ray 투시에서는 통째로 숨긴다 (안쪽 부품을 가리지 않게)
    this.carRoot.add(this.exterior);
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xe0f2fe, emissive: 0xbae6fd, emissiveIntensity: 0.9, roughness: 0.1 });
    const tailMat = new THREE.MeshStandardMaterial({ color: 0x991b1b, emissive: 0xef4444, emissiveIntensity: 0.9 });

    // 앞: 좌우를 잇는 얇은 주간주행등 — 가운데가 끊긴 세 토막으로 나눠 이 모델만의 얼굴을 만든다
    this.box(this.exterior, [0.06, 0.035, 1.5], lightMat, -4.27, 1.1, 0);
    for (const z of [-1.2, 1.2]) this.box(this.exterior, [0.1, 0.05, 0.62], lightMat, -4.2, 1.09, z);
    // 넓은 그릴: 무늬 그물 대신 가로 살 다섯 줄 (상표·로고는 넣지 않는다)
    this.box(this.exterior, [0.07, 0.5, 2.5], this.darkTrim, -4.31, 0.74, 0);
    for (let i = 0; i < 5; i++) this.box(this.exterior, [0.03, 0.022, 2.36 - i * 0.16], this.chrome, -4.35, 0.94 - i * 0.095, 0);
    // 그릴 양옆의 세로형 헤드램프와 하단 립
    for (const z of [-1.4, 1.4]) this.box(this.exterior, [0.07, 0.3, 0.16], lightMat, -4.27, 0.78, z);
    this.box(this.exterior, [0.14, 0.05, 2.9], this.chrome, -4.24, 0.42, 0);

    // 뒤: 좌우를 잇는 테일라이트 바 + 양 끝에서 아래로 꺾이는 세로 램프, 하단 디퓨저와 크롬 띠
    this.box(this.exterior, [0.1, 0.05, 3.1], tailMat, 4.32, 1.3, 0);
    for (const z of [-1.5, 1.5]) this.box(this.exterior, [0.1, 0.24, 0.07], tailMat, 4.31, 1.16, z);
    this.box(this.exterior, [0.08, 0.22, 2.7], this.darkTrim, 4.28, 0.58, 0);
    this.box(this.exterior, [0.1, 0.035, 2.3], this.chrome, 4.29, 0.46, 0);

    for (const out of [1, -1]) {
      const z = out * BODY_HALF;
      // 사이드 실 몰딩과 그 위의 크롬 띠
      this.box(this.exterior, [3.55, 0.1, 0.05], this.darkTrim, 0, SILL_Y + 0.07, z + out * 0.01);
      this.box(this.exterior, [3.3, 0.025, 0.05], this.chrome, 0, SILL_Y + 0.14, z + out * 0.012);
      // 벨트라인(창문 아래)을 따라가는 크롬 선
      this.box(this.exterior, [4.3, 0.022, 0.03], this.chrome, 0.62, 1.5, z + out * 0.004);
      // 도어 분할선과 문 안으로 숨은 손잡이
      for (const x of [-1.6, 0.46, 1.9]) this.box(this.exterior, [0.018, 0.8, 0.02], this.darkTrim, x, 0.98, z + out * 0.002);
      for (const x of [0.06, 1.5]) this.box(this.exterior, [0.3, 0.03, 0.02], this.chrome, x, 1.32, z + out * 0.004);
      // 사이드 미러
      this.box(this.exterior, [0.1, 0.05, 0.3], this.darkTrim, -1.38, 1.5, out * (CABIN_HALF + 0.15));
      this.box(this.exterior, [0.26, 0.16, 0.12], this.bodyPaint, -1.38, 1.56, out * (CABIN_HALF + 0.34));
    }
  }

  private buildEngineBay() {
    // 후드 아래에 들어가는 높이로 맞춘다 (후드는 이 위치에서 y ≈ 1.30~1.36)
    const engine = this.add(this.carRoot, new THREE.Group(), -2.75, 0.75, 0);

    this.box(engine, [1.1, 0.5, 0.9], this.engineMetal, 0, 0.1, 0);
    // 실린더 헤드 커버 = 엔진 상태 표시 메쉬
    const cover = this.accent('engine', 0xe2e8f0, 0.8, 0.25);
    this.box(engine, [0.95, 0.1, 0.8], cover, 0, 0.4, 0);

    // 흡기 러너
    for (let i = 0; i < 6; i++) {
      const runner = this.add(
        engine,
        new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 8, 16, Math.PI), this.chrome),
        -0.35 + i * 0.14,
        0.4,
        i % 2 === 0 ? 0.2 : -0.2,
      );
      runner.rotation.y = Math.PI / 2;
    }
    // 터보, 연료펌프, 라디에이터
    for (const z of [-0.6, 0.6]) {
      const turbo = this.add(engine, new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.05, 12, 24), this.engineMetal), -0.3, 0.12, z);
      turbo.rotation.y = Math.PI / 2;
    }
    this.add(engine, new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 16), this.chrome), 0.42, 0.3, 0.25);
    this.box(engine, [0.1, 0.5, 1.7], this.engineMetal, -0.85, 0.1, 0);
  }

  private buildTransmission() {
    const mat = this.accent('transmission', 0x94a3b8);
    const group = this.add(this.carRoot, new THREE.Group(), -1.55, 0.86, 0);

    const bell = this.add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.32, 0.35, 20), mat), -0.35, 0, 0);
    bell.rotation.z = Math.PI / 2;
    const gearCase = this.add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.9, 20), mat), 0.25, 0, 0);
    gearCase.rotation.z = Math.PI / 2;
    // 뒤로 가는 구동축
    const shaft = this.add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.4, 12), this.engineMetal), 2.4, -0.05, 0);
    shaft.rotation.z = Math.PI / 2;
  }

  private buildSteering() {
    const mat = this.accent('steering', 0x475569);
    const up = new THREE.Vector3(0, 1, 0);

    // 앞바퀴 사이의 랙 (중심부 폭 안에 들어간다)
    const rack = this.add(this.carRoot, new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 12), mat), -2.05, 0.66, 0);
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
    const group = this.add(this.carRoot, new THREE.Group(), 0.1, 0.54, 0);
    this.box(group, [3.4, 0.2, 2.3], this.batteryPack, 0, 0, 0);

    const cell = this.accent('battery', 0x64748b, 0.5, 0.4);
    for (let x = -1.2; x <= 1.2; x += 0.8) this.box(group, [0.55, 0.06, 2.0], cell, x, 0.11, 0);
  }

  private buildWheelsBrakesSuspension() {
    const caliperMat = this.accent('brake', 0x475569, 0.5, 0.3);
    const springMat = this.accent('suspension', 0x94a3b8);
    const tireWidth = 0.36;

    for (const x of [-WHEEL_X, WHEEL_X]) {
      for (const out of [1, -1]) {
        const isFront = x < 0;
        const wheel = this.add(this.carRoot, new THREE.Group(), x, WHEEL_Y, out * WHEEL_Z);

        // 타이어(가운데가 뚫린 고리)와 림 통: 스포크 사이로 브레이크가 보인다
        const tire = this.add(wheel, new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.13, 0.13, 14, 40), this.tireRubber), 0, 0, 0);
        tire.scale.z = tireWidth / 0.26;
        tire.castShadow = true;
        const barrel = this.add(
          wheel,
          new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, tireWidth - 0.04, 36, 1, true), this.alloyRim),
          0,
          0,
          0,
        );
        barrel.rotation.x = Math.PI / 2;

        // 살 열두 개가 한쪽으로 살짝 기운 바람개비 모양의 휠과 허브
        const face = out * (tireWidth / 2 - 0.03);
        for (let n = 0; n < 12; n++) {
          const arm = this.add(wheel, new THREE.Group(), 0, 0, face);
          arm.rotation.z = (n * Math.PI) / 6;
          // 허브에서 림까지 가는 살. 바깥쪽이 회전 방향으로 기울어 있다
          const blade = this.box(arm, [0.05, 0.31, 0.03], n % 2 === 0 ? this.alloyRim : this.darkTrim, out * 0.045, 0.24, 0);
          blade.rotation.z = out * -0.3;
        }
        const hub = this.add(wheel, new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 20), this.darkTrim), 0, 0, face + out * 0.01);
        hub.rotation.x = Math.PI / 2;

        // 브레이크: 디스크 로터 + 캘리퍼(상태 표시 메쉬)
        const rotor = this.add(wheel, new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.04, 32), this.brakeRotor), 0, 0, out * 0.04);
        rotor.rotation.x = Math.PI / 2;
        this.box(wheel, [0.16, isFront ? 0.3 : 0.22, 0.13], caliperMat, 0.24, 0.14, out * 0.04);

        // 서스펜션: 로어암 + 댐퍼 + 코일 스프링(상태 표시 메쉬). 차체 중심부 안쪽에 있다
        const strut = this.add(this.carRoot, new THREE.Group(), x, WHEEL_Y, out * (WHEEL_Z - 0.4));
        this.box(strut, [0.14, 0.06, 0.4], this.engineMetal, 0, -0.05, out * 0.05);
        this.add(strut, new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.66, 10), this.engineMetal), 0, 0.3, 0);
        for (let i = 0; i < 4; i++) {
          const coil = this.add(strut, new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.03, 8, 20), springMat), 0, 0.14 + i * 0.12, 0);
          coil.rotation.x = Math.PI / 2;
        }
      }
    }
  }

  // ── 외부에서 부르는 조작 ─────────────────────────────────────────────────

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

    this.targetHoodAngle = preset.hoodOpen ? -0.7 : 0;
    this.applyMode();
  }

  private applyMode() {
    const cutaway = this.userMode === 'cutaway' || CAMERA_PRESETS[this.focus].xray;
    this.bodyPaint.transparent = cutaway;
    this.bodyPaint.opacity = cutaway ? 0.22 : 1.0;
    this.bodyPaint.depthWrite = !cutaway;
    this.bodyPaint.needsUpdate = true;
    this.glass.opacity = cutaway ? 0.15 : 0.82;
    this.glass.depthWrite = !cutaway;
    this.exterior.visible = !cutaway;
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
