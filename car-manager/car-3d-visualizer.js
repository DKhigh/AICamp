/**
 * Car3DVisualizer - Interactive 3D WebGL Vehicle Visualizer with Three.js
 * Implements real 3D model based on modern sports sedan blueprint (Kia K5 style)
 * Supports mouse orbit rotation, cinematic part zoom, animated hood, and 3D projected hotspots
 */

class Car3DVisualizer {
  constructor(options = {}) {
    this.canvas = document.getElementById(options.canvasId || 'webglCanvas');
    this.container = document.getElementById(options.containerId || 'studioViewport');
    this.floatingResetBtn = document.getElementById('floatingResetBtn');
    
    if (typeof THREE === 'undefined') {
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:#1e293b;color:#ffffff;padding:24px;border-radius:12px;text-align:center;box-shadow:0 10px 25px rgba(0,0,0,0.3);z-index:999;';
      errorDiv.innerHTML = '<h3 style="margin-bottom:8px;font-size:18px;">WebGL 3D 라이브러리 로딩 중...</h3><p style="font-size:14px;color:#94a3b8;">네트워크 연결을 확인해주세요.</p>';
      this.container.appendChild(errorDiv);
      return;
    }

    this.currentPart = 'all';
    this.currentMode = 'exterior'; // 'exterior' | 'cutaway'
    this.autoRotate = false;
    this.currentColor = 0xf8fafc; // Snow White Pearl default

    // Callbacks
    this.onPartChangeCallback = null;

    // Camera animation state
    this.isTransitioning = false;
    this.cameraStartPos = new THREE.Vector3();
    this.cameraEndPos = new THREE.Vector3();
    this.targetStartPos = new THREE.Vector3();
    this.targetEndPos = new THREE.Vector3();
    this.transitionProgress = 0;
    this.transitionDuration = 1200; // ms
    this.transitionStartTime = 0;

    // 3D Anchor positions for Hotspot Badges
    this.anchors = {
      engine: new THREE.Vector3(-2.6, 1.45, 0.2),
      brake: new THREE.Vector3(-2.6, 0.65, 1.85),
      wheel: new THREE.Vector3(2.6, 0.65, 1.85),
      electronics: new THREE.Vector3(0.1, 1.4, 0.7),
      body: new THREE.Vector3(0.0, 1.6, 1.8)
    };

    // Sub-pin 3D Anchors
    this.subAnchors = {
      fuelPump: new THREE.Vector3(-2.2, 1.35, 0.5),
      turbo: new THREE.Vector3(-3.1, 1.25, -0.4),
      brakePad: new THREE.Vector3(-2.6, 0.82, 1.95),
      tire: new THREE.Vector3(2.6, 1.25, 1.85),
      battery: new THREE.Vector3(0.0, 0.6, 0.0)
    };

    // Camera viewpoints for each part
    this.cameraPresets = {
      all: {
        pos: new THREE.Vector3(8.5, 3.8, 8.5),
        target: new THREE.Vector3(0, 0.8, 0),
        hoodOpen: false,
        name: '차량 전체 외형'
      },
      engine: {
        pos: new THREE.Vector3(-4.8, 2.9, 2.5),
        target: new THREE.Vector3(-2.6, 1.1, 0),
        hoodOpen: true,
        name: '엔진룸 (Engine Bay)'
      },
      brake: {
        pos: new THREE.Vector3(-3.2, 0.85, 3.4),
        target: new THREE.Vector3(-2.6, 0.65, 1.85),
        hoodOpen: false,
        name: '전륜 스포츠 브레이크 (Brake)'
      },
      wheel: {
        pos: new THREE.Vector3(2.1, 0.85, 3.5),
        target: new THREE.Vector3(2.6, 0.65, 1.85),
        hoodOpen: false,
        name: '후륜 19인치 알로이 휠 & 타이어'
      },
      electronics: {
        pos: new THREE.Vector3(-0.6, 2.8, 3.0),
        target: new THREE.Vector3(0, 0.8, 0.2),
        hoodOpen: false,
        name: '전장 및 48V 배터리 팩'
      },
      body: {
        pos: new THREE.Vector3(0.0, 1.8, 6.2),
        target: new THREE.Vector3(0, 1.1, 0),
        hoodOpen: false,
        name: '초고장력 강판 섀시 구조'
      }
    };

    this.initThree();
    this.createCarModel();
    this.initEvents();
    this.animate();
  }

  initThree() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || (window.innerHeight - 64);

    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf1f5f9);
    this.scene.fog = new THREE.FogExp2(0xf1f5f9, 0.025);

    // 2. Camera
    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    this.camera.position.copy(this.cameraPresets.all.pos);

    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    // 4. OrbitControls
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03; // Disallow going underneath the ground
    this.controls.minDistance = 2.0;
    this.controls.maxDistance = 22.0;
    this.controls.target.copy(this.cameraPresets.all.target);
    this.controls.update();

    // 5. Studio Lighting Setup
    this.initLighting();

    // 6. Studio Floor & Circular Contact Shadow
    this.initFloor();
  }

  initLighting() {
    // Ambient soft daylight
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    this.scene.add(ambientLight);

    // Main Key Sunlight
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

    // Fill Light (Opposite side)
    const fillLight = new THREE.DirectionalLight(0xdbeafe, 0.65);
    fillLight.position.set(8, 8, -6);
    this.scene.add(fillLight);

    // Rim / Contour Light (Emphasizes sporty sedan roofline)
    const rimLight = new THREE.DirectionalLight(0xffedd5, 0.9);
    rimLight.position.set(0, 10, -10);
    this.scene.add(rimLight);
  }

  initFloor() {
    // Technical Blueprint Grid Floor
    const floorGeo = new THREE.PlaneGeometry(60, 60);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.85,
      metalness: 0.1
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Radial studio stage ring
    const ringGeo = new THREE.RingGeometry(4.8, 4.88, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x94a3b8, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.001;
    this.scene.add(ring);

    // Grid helper for CAD look
    const grid = new THREE.GridHelper(30, 30, 0x94a3b8, 0xcbd5e1);
    grid.position.y = 0.002;
    this.scene.add(grid);
  }

  /**
   * Constructs the 3D Sports Sedan based on the uploaded blueprint
   */
  createCarModel() {
    this.carRoot = new THREE.Group();
    this.scene.add(this.carRoot);

    // Materials Store for Live Paint Changes & X-Ray Mode
    this.materials = {
      bodyPaint: new THREE.MeshPhysicalMaterial({
        color: this.currentColor,
        metalness: 0.7,
        roughness: 0.22,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1,
        reflectivity: 0.9
      }),
      glass: new THREE.MeshPhysicalMaterial({
        color: 0x0f172a,
        metalness: 0.9,
        roughness: 0.05,
        transmission: 0.6,
        transparent: true,
        opacity: 0.75
      }),
      chrome: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 0.95,
        roughness: 0.08
      }),
      tireRubber: new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.85,
        metalness: 0.15
      }),
      alloyRim: new THREE.MeshStandardMaterial({
        color: 0xf1f5f9,
        metalness: 0.88,
        roughness: 0.18
      }),
      brakeRotor: new THREE.MeshStandardMaterial({
        color: 0xcbd5e1,
        metalness: 0.9,
        roughness: 0.25
      }),
      brakeCaliper: new THREE.MeshStandardMaterial({
        color: 0xdc2626,
        roughness: 0.3,
        metalness: 0.5
      }),
      engineMetal: new THREE.MeshStandardMaterial({
        color: 0x334155,
        metalness: 0.8,
        roughness: 0.35
      }),
      turboGold: new THREE.MeshStandardMaterial({
        color: 0xd97706,
        metalness: 0.9,
        roughness: 0.3
      }),
      batteryPack: new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        metalness: 0.6,
        roughness: 0.4
      }),
      chassisFrame: new THREE.MeshStandardMaterial({
        color: 0x2563eb,
        wireframe: false,
        metalness: 0.5,
        roughness: 0.5
      })
    };

    // 1. Lower Chassis & Undercarriage
    const chassisGeo = new THREE.BoxGeometry(8.2, 0.3, 3.4);
    const chassis = new THREE.Mesh(chassisGeo, this.materials.engineMetal);
    chassis.position.set(0, 0.45, 0);
    chassis.castShadow = true;
    chassis.receiveShadow = true;
    this.carRoot.add(chassis);

    // 2. Main Aerodynamic Sedan Body Shell
    this.buildBodyShell();

    // 3. Animated Hood (Pivots Open when Zoomed to Engine)
    this.buildAnimatedHood();

    // 4. Cabin Greenhouse: Windshield, Side Windows, Roof & C-Pillar
    this.buildGreenhouse();

    // 5. Front Fascia: Grille & LED Headlights
    this.buildFrontFascia();

    // 6. Rear End: Taillights, Diffuser & Exhausts
    this.buildRearEnd();

    // 7. Internal Engine Bay (Cylinder block, turbo, intake, fuel pump)
    this.buildEngineBay();

    // 8. Underfloor 48V Battery Pack & Electronics
    this.buildBatteryElectronics();

    // 9. 4 Performance Sports Wheels & Braking Calipers
    this.buildWheelsAndBrakes();
  }

  buildBodyShell() {
    // Central Cabin Lower Body
    const cabinLowerGeo = new THREE.BoxGeometry(4.4, 0.85, 3.5);
    const cabinLower = new THREE.Mesh(cabinLowerGeo, this.materials.bodyPaint);
    cabinLower.position.set(0, 0.95, 0);
    cabinLower.castShadow = true;
    this.carRoot.add(cabinLower);

    // Front Fender Section
    const frontFenderGeo = new THREE.BoxGeometry(2.4, 0.75, 3.46);
    const frontFender = new THREE.Mesh(frontFenderGeo, this.materials.bodyPaint);
    frontFender.position.set(-2.8, 0.9, 0);
    frontFender.castShadow = true;
    this.carRoot.add(frontFender);

    // Rear Quarter Panel Section
    const rearQuarterGeo = new THREE.BoxGeometry(2.2, 0.8, 3.46);
    const rearQuarter = new THREE.Mesh(rearQuarterGeo, this.materials.bodyPaint);
    rearQuarter.position.set(2.8, 0.92, 0);
    rearQuarter.castShadow = true;
    this.carRoot.add(rearQuarter);

    // Aerodynamic Side Skirts (Left & Right)
    [-1.75, 1.75].forEach(z => {
      const skirtGeo = new THREE.BoxGeometry(4.8, 0.14, 0.12);
      const skirt = new THREE.Mesh(skirtGeo, this.materials.engineMetal);
      skirt.position.set(0, 0.38, z);
      this.carRoot.add(skirt);

      // Fender Side Vent (From Blueprint image behind front wheel)
      const ventGeo = new THREE.BoxGeometry(0.35, 0.12, 0.04);
      const vent = new THREE.Mesh(ventGeo, this.materials.chrome);
      vent.position.set(-1.8, 1.15, z > 0 ? z + 0.01 : z - 0.01);
      this.carRoot.add(vent);

      // Side Mirrors
      const mirrorArmGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.25);
      const mirrorArm = new THREE.Mesh(mirrorArmGeo, this.materials.engineMetal);
      mirrorArm.rotation.z = Math.PI / 4;
      mirrorArm.position.set(-1.3, 1.5, z > 0 ? z + 0.15 : z - 0.15);
      this.carRoot.add(mirrorArm);

      const mirrorHeadGeo = new THREE.BoxGeometry(0.32, 0.18, 0.14);
      const mirrorHead = new THREE.Mesh(mirrorHeadGeo, this.materials.bodyPaint);
      mirrorHead.position.set(-1.3, 1.58, z > 0 ? z + 0.24 : z - 0.24);
      this.carRoot.add(mirrorHead);

      // Door Handles (Front & Rear)
      [-0.4, 0.9].forEach(x => {
        const handleGeo = new THREE.BoxGeometry(0.38, 0.08, 0.06);
        const handle = new THREE.Mesh(handleGeo, this.materials.chrome);
        handle.position.set(x, 1.25, z > 0 ? z + 0.02 : z - 0.02);
        this.carRoot.add(handle);
      });
    });
  }

  buildAnimatedHood() {
    // Pivot group positioned at the base of the windshield
    this.hoodPivot = new THREE.Group();
    this.hoodPivot.position.set(-1.6, 1.35, 0);
    this.carRoot.add(this.hoodPivot);

    // Sculpted Hood Mesh
    const hoodGeo = new THREE.BoxGeometry(2.35, 0.08, 3.25);
    this.hoodMesh = new THREE.Mesh(hoodGeo, this.materials.bodyPaint);
    this.hoodMesh.position.set(-1.18, 0.04, 0); // Center relative to pivot
    this.hoodMesh.rotation.z = 0.06; // Slight aerodynamic forward slant
    this.hoodMesh.castShadow = true;
    this.hoodPivot.add(this.hoodMesh);

    // Dual Character Ridge Lines on Hood
    [-0.65, 0.65].forEach(z => {
      const ridgeGeo = new THREE.BoxGeometry(2.1, 0.03, 0.06);
      const ridge = new THREE.Mesh(ridgeGeo, this.materials.chrome);
      ridge.position.set(-1.18, 0.09, z);
      ridge.rotation.z = 0.06;
      this.hoodPivot.add(ridge);
    });
  }

  buildGreenhouse() {
    // Arched Roof Panel
    const roofGeo = new THREE.BoxGeometry(3.2, 0.08, 2.9);
    const roof = new THREE.Mesh(roofGeo, this.materials.bodyPaint);
    roof.position.set(0.1, 2.38, 0);
    roof.castShadow = true;
    this.carRoot.add(roof);

    // Front Windshield (Slanted)
    const windshieldGeo = new THREE.BoxGeometry(1.6, 0.06, 3.0);
    const windshield = new THREE.Mesh(windshieldGeo, this.materials.glass);
    windshield.position.set(-1.0, 1.88, 0);
    windshield.rotation.z = 0.65;
    this.carRoot.add(windshield);

    // Rear Windshield (Fastback slope matching blueprint)
    const rearGlassGeo = new THREE.BoxGeometry(1.8, 0.06, 2.9);
    const rearGlass = new THREE.Mesh(rearGlassGeo, this.materials.glass);
    rearGlass.position.set(1.4, 1.85, 0);
    rearGlass.rotation.z = -0.58;
    this.carRoot.add(rearGlass);

    // Side Windows & Chrome Surrounds
    [-1.52, 1.52].forEach(z => {
      const sideGlassGeo = new THREE.BoxGeometry(3.1, 0.72, 0.05);
      const sideGlass = new THREE.Mesh(sideGlassGeo, this.materials.glass);
      sideGlass.position.set(0.1, 1.82, z);
      this.carRoot.add(sideGlass);

      // B-Pillar Structural Post (Gloss Black)
      const bPillarGeo = new THREE.BoxGeometry(0.18, 0.76, 0.08);
      const bPillar = new THREE.Mesh(bPillarGeo, this.materials.engineMetal);
      bPillar.position.set(0.1, 1.82, z);
      this.carRoot.add(bPillar);

      // Chrome Window Upper Arch Trim
      const trimGeo = new THREE.BoxGeometry(3.3, 0.04, 0.04);
      const trim = new THREE.Mesh(trimGeo, this.materials.chrome);
      trim.position.set(0.1, 2.22, z);
      this.carRoot.add(trim);
    });
  }

  buildFrontFascia() {
    // Front Bumper Lower Chin
    const bumperGeo = new THREE.BoxGeometry(0.65, 0.6, 3.4);
    const bumper = new THREE.Mesh(bumperGeo, this.materials.bodyPaint);
    bumper.position.set(-4.05, 0.7, 0);
    bumper.castShadow = true;
    this.carRoot.add(bumper);

    // Tiger-Nose Front Grille Mesh
    const grilleGeo = new THREE.BoxGeometry(0.1, 0.42, 2.1);
    const grilleMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.5,
      metalness: 0.8
    });
    const grille = new THREE.Mesh(grilleGeo, grilleMat);
    grille.position.set(-4.32, 0.88, 0);
    this.carRoot.add(grille);

    // Chrome Grille Surround
    const grilleFrameGeo = new THREE.BoxGeometry(0.08, 0.46, 2.18);
    const grilleFrame = new THREE.Mesh(grilleFrameGeo, this.materials.chrome);
    grilleFrame.position.set(-4.31, 0.88, 0);
    this.carRoot.add(grilleFrame);

    // Sleek LED Headlights (Left & Right)
    [-1.25, 1.25].forEach(z => {
      const lightGeo = new THREE.BoxGeometry(0.45, 0.18, 0.55);
      const lightMat = new THREE.MeshStandardMaterial({
        color: 0xe0f2fe,
        emissive: 0x38bdf8,
        emissiveIntensity: 0.75,
        roughness: 0.1
      });
      const light = new THREE.Mesh(lightGeo, lightMat);
      light.position.set(-4.1, 1.08, z);
      light.rotation.y = z > 0 ? -0.2 : 0.2;
      this.carRoot.add(light);
    });
  }

  buildRearEnd() {
    // Rear Bumper
    const rearBumperGeo = new THREE.BoxGeometry(0.6, 0.65, 3.42);
    const rearBumper = new THREE.Mesh(rearBumperGeo, this.materials.bodyPaint);
    rearBumper.position.set(4.0, 0.72, 0);
    rearBumper.castShadow = true;
    this.carRoot.add(rearBumper);

    // Ducktail Trunk Lip
    const trunkLipGeo = new THREE.BoxGeometry(0.5, 0.12, 2.9);
    const trunkLip = new THREE.Mesh(trunkLipGeo, this.materials.bodyPaint);
    trunkLip.position.set(3.85, 1.45, 0);
    this.carRoot.add(trunkLip);

    // Full-Width Connected LED Taillight Bar
    const tailGeo = new THREE.BoxGeometry(0.12, 0.16, 2.85);
    const tailMat = new THREE.MeshStandardMaterial({
      color: 0x991b1b,
      emissive: 0xef4444,
      emissiveIntensity: 0.95
    });
    const tail = new THREE.Mesh(tailGeo, tailMat);
    tail.position.set(4.28, 1.35, 0);
    this.carRoot.add(tail);

    // Dual Chrome Exhaust Pipes
    [-0.95, 0.95].forEach(z => {
      const exhaustGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.35, 16);
      const exhaust = new THREE.Mesh(exhaustGeo, this.materials.chrome);
      exhaust.rotation.z = Math.PI / 2;
      exhaust.position.set(4.25, 0.42, z);
      this.carRoot.add(exhaust);
    });
  }

  buildEngineBay() {
    this.engineGroup = new THREE.Group();
    this.engineGroup.position.set(-2.7, 0.95, 0);
    this.carRoot.add(this.engineGroup);

    // V6 Cylinder Block
    const blockGeo = new THREE.BoxGeometry(1.2, 0.65, 0.95);
    const block = new THREE.Mesh(blockGeo, this.materials.engineMetal);
    block.position.set(0, 0.15, 0);
    this.engineGroup.add(block);

    // Cylinder Head Covers (Ribbed Top)
    const headCoverGeo = new THREE.BoxGeometry(1.05, 0.15, 0.85);
    const headCover = new THREE.Mesh(headCoverGeo, this.materials.alloyRim);
    headCover.position.set(0, 0.52, 0);
    this.engineGroup.add(headCover);

    // Intake Manifold Runners (6 curved pipes)
    for (let i = 0; i < 6; i++) {
      const runnerGeo = new THREE.TorusGeometry(0.18, 0.045, 8, 16, Math.PI);
      const runner = new THREE.Mesh(runnerGeo, this.materials.chrome);
      const xOffset = -0.4 + i * 0.16;
      runner.position.set(xOffset, 0.58, (i % 2 === 0 ? 0.22 : -0.22));
      runner.rotation.x = i % 2 === 0 ? Math.PI / 2 : -Math.PI / 2;
      this.engineGroup.add(runner);
    }

    // Twin Turbocharger Units (Gold/Bronze Metallic)
    [-0.55, 0.55].forEach(z => {
      const turboGeo = new THREE.TorusGeometry(0.18, 0.07, 12, 24);
      const turbo = new THREE.Mesh(turboGeo, this.materials.turboGold);
      turbo.position.set(-0.35, 0.22, z);
      turbo.rotation.y = Math.PI / 2;
      this.engineGroup.add(turbo);
    });

    // High Pressure Fuel Pump (Issue Item: 부족 3일 - Red Accent)
    const pumpGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.28, 16);
    this.fuelPumpMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      emissive: 0xef4444,
      emissiveIntensity: 0.6,
      metalness: 0.8,
      roughness: 0.2
    });
    const pump = new THREE.Mesh(pumpGeo, this.fuelPumpMat);
    pump.position.set(0.42, 0.45, 0.28);
    this.engineGroup.add(pump);

    // Radiator Fan & Core Module
    const radGeo = new THREE.BoxGeometry(0.12, 0.65, 1.8);
    const rad = new THREE.Mesh(radGeo, this.materials.engineMetal);
    rad.position.set(-0.85, 0.18, 0);
    this.engineGroup.add(rad);
  }

  buildBatteryElectronics() {
    this.batteryGroup = new THREE.Group();
    this.batteryGroup.position.set(0.1, 0.52, 0);
    this.carRoot.add(this.batteryGroup);

    // Underfloor 48V Battery Pack Casing
    const batGeo = new THREE.BoxGeometry(3.6, 0.22, 2.6);
    const bat = new THREE.Mesh(batGeo, this.materials.batteryPack);
    this.batteryGroup.add(bat);

    // Battery Cell Module Accents
    for (let i = -1.2; i <= 1.2; i += 0.8) {
      const cellGeo = new THREE.BoxGeometry(0.55, 0.06, 2.3);
      const cellMat = new THREE.MeshStandardMaterial({
        color: 0x0284c7,
        emissive: 0x38bdf8,
        emissiveIntensity: 0.4
      });
      const cell = new THREE.Mesh(cellGeo, cellMat);
      cell.position.set(i, 0.12, 0);
      this.batteryGroup.add(cell);
    }
  }

  buildWheelsAndBrakes() {
    this.wheels = [];
    this.wheelPositions = [
      { x: -2.6, y: 0.65, z: 1.78, name: 'frontLeft', isFront: true },
      { x: -2.6, y: 0.65, z: -1.78, name: 'frontRight', isFront: true },
      { x: 2.6, y: 0.65, z: 1.78, name: 'rearLeft', isFront: false },
      { x: 2.6, y: 0.65, z: -1.78, name: 'rearRight', isFront: false }
    ];

    this.wheelPositions.forEach(wp => {
      const wheelAssembly = new THREE.Group();
      wheelAssembly.position.set(wp.x, wp.y, wp.z);
      this.carRoot.add(wheelAssembly);

      // Rubber Performance Tire
      const tireGeo = new THREE.CylinderGeometry(0.65, 0.65, 0.38, 32);
      const tire = new THREE.Mesh(tireGeo, this.materials.tireRubber);
      tire.rotation.x = Math.PI / 2;
      tire.castShadow = true;
      wheelAssembly.add(tire);

      // Multi-Spoke 19-inch Sport Alloy Rim
      const rimRimGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.39, 32);
      const rim = new THREE.Mesh(rimRimGeo, this.materials.alloyRim);
      rim.rotation.x = Math.PI / 2;
      wheelAssembly.add(rim);

      // 10 Spokes
      const spokeGroup = new THREE.Group();
      spokeGroup.position.set(0, 0, wp.z > 0 ? 0.18 : -0.18);
      for (let s = 0; s < 10; s++) {
        const spokeGeo = new THREE.BoxGeometry(0.06, 0.45, 0.04);
        const spoke = new THREE.Mesh(spokeGeo, this.materials.alloyRim);
        spoke.rotation.z = (s * Math.PI) / 5;
        spokeGroup.add(spoke);
      }
      wheelAssembly.add(spokeGroup);

      // Ventilated Brake Disc Rotor
      const rotorGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.05, 32);
      const rotor = new THREE.Mesh(rotorGeo, this.materials.brakeRotor);
      rotor.rotation.x = Math.PI / 2;
      rotor.position.set(0, 0, wp.z > 0 ? 0.08 : -0.08);
      wheelAssembly.add(rotor);

      // Red Sport Brake Caliper (Front Wheels have larger 4-Piston Caliper)
      const caliperGeo = new THREE.BoxGeometry(0.18, wp.isFront ? 0.34 : 0.24, 0.12);
      const caliper = new THREE.Mesh(caliperGeo, this.materials.brakeCaliper);
      caliper.position.set(0.3, 0.18, wp.z > 0 ? 0.08 : -0.08);
      wheelAssembly.add(caliper);

      this.wheels.push(wheelAssembly);
    });
  }

  /**
   * Set Car Paint Color dynamically
   */
  setCarColor(hexColor) {
    this.currentColor = hexColor;
    if (this.materials && this.materials.bodyPaint) {
      this.materials.bodyPaint.color.set(hexColor);
    }
  }

  /**
   * Toggle between Exterior (외형 모드) and Cutaway (X-Ray 투시 모드)
   */
  setMode(mode) {
    this.currentMode = mode;
    const isCutaway = mode === 'cutaway';

    if (isCutaway) {
      // Body shell becomes semi-transparent X-Ray
      this.materials.bodyPaint.transparent = true;
      this.materials.bodyPaint.opacity = 0.28;
      this.materials.bodyPaint.wireframe = false;
      this.materials.glass.opacity = 0.2;
      // Illuminate internal battery & engine
      if (this.fuelPumpMat) this.fuelPumpMat.emissiveIntensity = 1.2;
    } else {
      // Restore glossy metallic paint
      this.materials.bodyPaint.transparent = false;
      this.materials.bodyPaint.opacity = 1.0;
      this.materials.glass.opacity = 0.75;
      if (this.fuelPumpMat) this.fuelPumpMat.emissiveIntensity = 0.6;
    }
  }

  /**
   * Smoothly Zoom Camera to a Part
   */
  zoomToPart(part) {
    if (!this.cameraPresets[part]) part = 'all';
    this.currentPart = part;
    const preset = this.cameraPresets[part];

    // Start Smooth Camera Interpolation
    this.cameraStartPos.copy(this.camera.position);
    this.cameraEndPos.copy(preset.pos);
    this.targetStartPos.copy(this.controls.target);
    this.targetEndPos.copy(preset.target);

    this.transitionStartTime = performance.now();
    this.transitionProgress = 0;
    this.isTransitioning = true;

    // Animated Hood: Open when viewing Engine, Close otherwise
    this.targetHoodAngle = preset.hoodOpen ? -0.65 : 0.0;

    // Show / Hide Floating Reset Button
    if (this.floatingResetBtn) {
      this.floatingResetBtn.style.display = part === 'all' ? 'none' : 'flex';
    }

    // Update Sub-pin visibility
    this.updateSubPins(part);

    // Trigger external callback
    if (typeof this.onPartChangeCallback === 'function') {
      this.onPartChangeCallback(part, preset);
    }
  }

  updateSubPins(part) {
    // Hide all sub-pins
    document.querySelectorAll('.sub-pin-callout-3d').forEach(pin => {
      pin.style.display = 'none';
    });

    if (part === 'engine') {
      document.getElementById('pinFuelPump3D').style.display = 'block';
      document.getElementById('pinTurbo3D').style.display = 'block';
    } else if (part === 'brake') {
      document.getElementById('pinBrakePad3D').style.display = 'block';
    } else if (part === 'wheel') {
      document.getElementById('pinTire3D').style.display = 'block';
    } else if (part === 'electronics') {
      document.getElementById('pinBattery3D').style.display = 'block';
    }
  }

  /**
   * Project 3D vector to 2D screen coordinates and position HTML badge
   */
  projectToScreen(vector3D, elementId) {
    const el = document.getElementById(elementId);
    if (!el || el.style.display === 'none') return;

    const v = vector3D.clone();
    // Transform to car space
    v.applyMatrix4(this.carRoot.matrixWorld);
    // Project to camera NDC [-1, 1]
    v.project(this.camera);

    // If point is behind camera, hide it
    if (v.z > 1.0) {
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      return;
    }

    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    const x = (v.x * 0.5 + 0.5) * width;
    const y = (-(v.y * 0.5) + 0.5) * height;

    el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
    el.style.opacity = '1';
    el.style.pointerEvents = 'auto';
  }

  updateHotspots() {
    // 1. Main 3D Badges
    this.projectToScreen(this.anchors.engine, 'badgeEngine3D');
    this.projectToScreen(this.anchors.brake, 'badgeBrake3D');
    this.projectToScreen(this.anchors.wheel, 'badgeWheel3D');
    this.projectToScreen(this.anchors.electronics, 'badgeElectronics3D');
    this.projectToScreen(this.anchors.body, 'badgeBody3D');

    // 2. Sub-pin Callouts (When zoomed in)
    this.projectToScreen(this.subAnchors.fuelPump, 'pinFuelPump3D');
    this.projectToScreen(this.subAnchors.turbo, 'pinTurbo3D');
    this.projectToScreen(this.subAnchors.brakePad, 'pinBrakePad3D');
    this.projectToScreen(this.subAnchors.tire, 'pinTire3D');
    this.projectToScreen(this.subAnchors.battery, 'pinBattery3D');
  }

  initEvents() {
    // Window resize
    window.addEventListener('resize', () => {
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    });

    // Hotspot badge click triggers zoom
    document.querySelectorAll('.hotspot-badge-3d').forEach(badge => {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        const part = badge.dataset.part;
        if (this.currentPart === part) {
          this.zoomToPart('all');
        } else {
          this.zoomToPart(part);
        }
      });
    });

    // Floating Reset Button
    if (this.floatingResetBtn) {
      this.floatingResetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.zoomToPart('all');
      });
    }

    // Clicking anywhere empty on the canvas resets if zoomed
    this.canvas.addEventListener('dblclick', () => {
      this.zoomToPart('all');
    });
  }

  animate() {
    requestAnimationFrame(this.animate.bind(this));

    // Handle Smooth Camera Interpolation
    if (this.isTransitioning) {
      const elapsed = performance.now() - this.transitionStartTime;
      let t = elapsed / this.transitionDuration;
      if (t >= 1.0) {
        t = 1.0;
        this.isTransitioning = false;
      }

      // Smooth Cubic-Bezier Easing
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      this.camera.position.lerpVectors(this.cameraStartPos, this.cameraEndPos, ease);
      this.controls.target.lerpVectors(this.targetStartPos, this.targetEndPos, ease);
    }

    // Smooth Hood Opening / Closing Animation
    if (this.hoodPivot && this.targetHoodAngle !== undefined) {
      this.hoodPivot.rotation.z += (this.targetHoodAngle - this.hoodPivot.rotation.z) * 0.08;
    }

    // Auto-Rotate Mode
    if (this.autoRotate && !this.isTransitioning) {
      this.carRoot.rotation.y += 0.005;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    // Update 3D screen projected hotspots
    this.updateHotspots();
  }

  onPartChange(callback) {
    this.onPartChangeCallback = callback;
  }
}

window.Car3DVisualizer = Car3DVisualizer;
