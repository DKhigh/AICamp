/**
 * CarVisualizer - Cinematic Zoom, Pan & Layer Inspection Engine
 * Handles exterior-to-cutaway transitions and smooth part zooms
 */

class CarVisualizer {
  constructor(options = {}) {
    this.container = document.getElementById(options.containerId || 'carViewportContainer');
    this.world = document.getElementById(options.worldId || 'carWorld');
    this.svg = document.getElementById(options.svgId || 'carSvg');
    this.zoomBadge = document.getElementById(options.zoomBadgeId || 'zoomLevelBadge');
    this.floatingResetBtn = document.getElementById('floatingResetBtn');
    this.breadcrumbSep = document.getElementById('crumbSep');
    this.breadcrumbPart = document.getElementById('crumbCurrentPart');

    this.currentPart = 'all'; // 'all', 'engine', 'brake', 'wheel', 'electronics', 'body'
    this.currentMode = 'exterior'; // 'exterior' | 'cutaway'

    // Camera Transform State
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;

    // Drag-to-pan state
    this.isDragging = false;
    this.startX = 0;
    this.startY = 0;

    // Presets for smooth zooming into specific vehicle sections
    // (Percentages and scales calibrated for the 1000x600 SVG viewBox)
    this.partCameraTargets = {
      all: {
        scale: 1.0,
        x: 0,
        y: 0,
        name: '차량 전체 (외형)',
        title: '생산 관리 시스템',
        desc: '차량의 부품을 선택하여 생산 현황과 문제를 확인할 수 있습니다.'
      },
      engine: {
        scale: 2.45,
        x: 230,
        y: -10,
        name: '엔진 어셈블리 (Engine)',
        title: '엔진 부품 상세 보기',
        desc: '엔진을 선택하면 구성 부품의 상세 위치와 연결 정보를 확인할 수 있습니다.'
      },
      brake: {
        scale: 2.8,
        x: 80,
        y: -230,
        name: '브레이크 시스템 (Brake)',
        title: '브레이크 시스템 상세 보기',
        desc: '전륜 4-피스톤 스포츠 캘리퍼 및 360mm 벤틸레이티드 디스크 로터 조립 라인입니다.'
      },
      wheel: {
        scale: 2.6,
        x: -330,
        y: -170,
        name: '바퀴 및 타이어 (Wheel & Tire)',
        title: '바퀴 / 타이어 시스템 상세 보기',
        desc: '19인치 다이아몬드 컷팅 단조 알로이 휠 및 고성능 미쉐린 서머 타이어 구성입니다.'
      },
      electronics: {
        scale: 2.2,
        x: -40,
        y: 80,
        name: '전장 및 배터리 시스템 (Electronics)',
        title: '전장 & 배터리 시스템 상세 보기',
        desc: '48V 마일드 하이브리드 리튬 배터리 팩 및 중앙 ECU 통합 하네스 배선입니다.'
      },
      body: {
        scale: 1.8,
        x: -160,
        y: -30,
        name: '차체 및 섀시 구조 (Body & Chassis)',
        title: '차체 & 섀시 구조 상세 보기',
        desc: '초고장력 강판(AHSS) 핫스탬핑 B필러 및 경량 알루미늄 도어 프레임 강성 구조입니다.'
      }
    };

    // Sub-pins map
    this.subPins = {
      engine: ['pinFuelPump', 'pinCylinder', 'pinTurbo'],
      brake: ['pinBrakePad', 'pinRotor'],
      wheel: ['pinTire', 'pinRim'],
      electronics: ['pinBattery'],
      body: []
    };

    this.onPartChangeCallback = null;

    this.initEvents();
    this.setMode('exterior');
    this.zoomToPart('all');
  }

  initEvents() {
    // 1. Hotspot badge clicks
    document.querySelectorAll('.hotspot-badge').forEach(badge => {
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

    // 2. Direct click on wheel graphics
    const frontWheel = document.getElementById('exteriorFrontWheel');
    if (frontWheel) {
      frontWheel.addEventListener('click', (e) => {
        e.stopPropagation();
        this.zoomToPart('brake');
      });
    }

    const rearWheel = document.getElementById('exteriorRearWheel');
    if (rearWheel) {
      rearWheel.addEventListener('click', (e) => {
        e.stopPropagation();
        this.zoomToPart('wheel');
      });
    }

    // 3. Floating Reset Button
    if (this.floatingResetBtn) {
      this.floatingResetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.zoomToPart('all');
      });
    }

    // 4. Breadcrumb Root Click
    const crumbRoot = document.querySelector('.viewport-breadcrumb .crumb-link');
    if (crumbRoot) {
      crumbRoot.addEventListener('click', () => {
        this.zoomToPart('all');
      });
    }

    // 5. Mouse Drag-to-Pan on Canvas
    this.container.addEventListener('mousedown', (e) => {
      // Don't trigger if clicked on a button or badge
      if (e.target.closest('.hotspot-badge') || e.target.closest('button') || e.target.closest('.sub-pin-pill')) {
        return;
      }
      this.isDragging = true;
      this.startX = e.clientX - this.panX;
      this.startY = e.clientY - this.panY;
      this.world.style.transition = 'none'; // Instant pan tracking
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      this.panX = e.clientX - this.startX;
      this.panY = e.clientY - this.startY;
      this.applyTransform();
    });

    window.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.world.style.transition = 'transform 0.45s cubic-bezier(0.25, 1, 0.5, 1)';
      }
    });

    // 6. Scroll Wheel to Zoom In / Out
    this.container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      let newScale = this.scale * zoomFactor;
      if (newScale < 0.8) newScale = 0.8;
      if (newScale > 4.5) newScale = 4.5;

      this.scale = newScale;
      this.applyTransform();

      // If user zoomed in manually, show reset button
      if (this.scale > 1.25 && this.floatingResetBtn) {
        this.floatingResetBtn.style.display = 'flex';
      } else if (this.scale <= 1.05 && this.currentPart === 'all' && this.floatingResetBtn) {
        this.floatingResetBtn.style.display = 'none';
      }
    }, { passive: false });

    // 7. Click on empty canvas to zoom back out
    this.container.addEventListener('click', (e) => {
      if (e.target === this.container || e.target.tagName === 'rect' || e.target.id === 'carSvg') {
        if (this.currentPart !== 'all') {
          this.zoomToPart('all');
        }
      }
    });

    // 8. Sub-pin clicks for quick feedback
    document.querySelectorAll('.sub-pin-pill').forEach(pin => {
      pin.addEventListener('click', (e) => {
        e.stopPropagation();
        const pinText = pin.querySelector('.pin-text')?.innerText || '부품';
        const pinTag = pin.querySelector('.pin-tag')?.innerText || '';
        if (window.app && window.app.showToast) {
          window.app.showToast(`[${pinTag}] ${pinText} 상세 검측 정보를 불러왔습니다.`);
        }
      });
    });
  }

  /**
   * Set Exterior View vs Cutaway (X-Ray) Mode
   */
  setMode(mode) {
    this.currentMode = mode;
    if (mode === 'cutaway') {
      this.world.classList.add('mode-cutaway');
    } else {
      this.world.classList.remove('mode-cutaway');
    }
  }

  /**
   * Zoom smoothly into a specific vehicle part
   * @param {string} part 'all' | 'engine' | 'brake' | 'wheel' | 'electronics' | 'body'
   */
  zoomToPart(part) {
    if (!this.partCameraTargets[part]) part = 'all';
    this.currentPart = part;

    const target = this.partCameraTargets[part];
    this.scale = target.scale;
    this.panX = target.x;
    this.panY = target.y;

    // Restore smooth spring animation
    this.world.style.transition = 'transform 0.65s cubic-bezier(0.25, 1, 0.5, 1)';
    this.applyTransform();

    // Toggle Engine Zoomed class (for hood dissolve)
    if (part === 'engine') {
      this.world.classList.add('zoomed-engine');
    } else {
      this.world.classList.remove('zoomed-engine');
    }

    // Update Hotspot Badges Active States
    document.querySelectorAll('.hotspot-badge').forEach(badge => {
      if (badge.dataset.part === part) {
        badge.classList.add('active');
      } else {
        badge.classList.remove('active');
      }
    });

    // Update Sub-pin visibility
    this.updateSubPins(part);

    // Update Breadcrumbs & Floating Reset
    if (part === 'all') {
      if (this.floatingResetBtn) this.floatingResetBtn.style.display = 'none';
      if (this.breadcrumbSep) this.breadcrumbSep.style.display = 'none';
      if (this.breadcrumbPart) this.breadcrumbPart.style.display = 'none';
    } else {
      if (this.floatingResetBtn) this.floatingResetBtn.style.display = 'flex';
      if (this.breadcrumbSep) this.breadcrumbSep.style.display = 'inline';
      if (this.breadcrumbPart) {
        this.breadcrumbPart.style.display = 'inline';
        this.breadcrumbPart.textContent = target.name;
      }
    }

    // Trigger listener callback for external components (cards, pills, lists)
    if (typeof this.onPartChangeCallback === 'function') {
      this.onPartChangeCallback(part, target);
    }
  }

  /**
   * Hide all sub-pins and reveal only those belonging to the active part
   */
  updateSubPins(activePart) {
    // Hide all sub pins first
    document.querySelectorAll('.sub-pin-callout').forEach(pin => {
      pin.style.display = 'none';
    });

    if (activePart !== 'all' && this.subPins[activePart]) {
      this.subPins[activePart].forEach(id => {
        const pinEl = document.getElementById(id);
        if (pinEl) {
          pinEl.style.display = 'block';
        }
      });
    }
  }

  /**
   * Apply CSS transform to car-world
   */
  applyTransform() {
    this.world.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
    if (this.zoomBadge) {
      this.zoomBadge.textContent = `${Math.round(this.scale * 100)}%`;
    }
  }

  /**
   * Register callback when part changes
   */
  onPartChange(callback) {
    this.onPartChangeCallback = callback;
  }
}

window.CarVisualizer = CarVisualizer;
