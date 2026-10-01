/**
 * Application Controller for ICBM 3D Studio
 * Integrates 3D Visualizer, Dynamic Bottom Detail Card, Color Picker, and Modals
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize 3D Visualizer
  const visualizer = new Car3DVisualizer({
    canvasId: 'webglCanvas',
    containerId: 'studioViewport'
  });

  // Data Store for Part Details (for bottom card & BOM modal)
  const partsData = {
    all: {
      title: '차량 전체 외형 (Exterior)',
      desc: '세단 블루프린트 1:1 기반 정밀 3D 모델입니다. 마우스로 360° 자유 회전 및 휠 줌인이 가능합니다.',
      thumb: './assets/sedan_blueprint.png',
      category: '차량 전체 어셈블리',
      partNo: 'SEDAN-K5-2026',
      statusTag: '전체 외형 모드 (정상)',
      statusClass: 'badge-success',
      metrics: [
        { label: '전장/전폭/전고', val: '4,905 / 1,860 / 1,445 mm' },
        { label: '휠베이스', val: '2,850 mm' },
        { label: '공차 중량', val: '1,520 kg' }
      ],
      bom: [
        { name: '3.3L V6 트윈터보 가솔린 엔진', qty: '1 EA', supplier: '현대모비스', status: '부품 부족 (연료펌프)', statusClass: 'text-warning' },
        { name: '4-피스톤 전륜 스포츠 브레이크', qty: '2 SET', supplier: '(주)태성모터스', status: '납품 지연 (7일)', statusClass: 'text-danger' },
        { name: '19인치 알로이 휠 & 타이어', qty: '4 SET', supplier: '미쉐린/핸즈', status: '납품 지연 (2일)', statusClass: 'text-warning' },
        { name: '48V 마일드 하이브리드 배터리', qty: '1 EA', supplier: 'LG에너지솔루션', status: '재고 부족 (5일분)', statusClass: 'text-danger' },
        { name: '초고장력 강판 모노코크 차체', qty: '1 UNIT', supplier: '현대제철', status: '정상 가동', statusClass: 'text-success' }
      ]
    },
    engine: {
      title: '엔진룸 및 파워트레인 어셈블리',
      desc: '3D 엔진룸 확대 시 후드(Hood)가 자동으로 열리며 V6 실린더 블록, 트윈터보, 연료펌프가 노출됩니다.',
      thumb: './assets/engine_thumb.jpg',
      category: '파워트레인 / 엔진 어셈블리',
      partNo: 'ENG-33T-9920',
      statusTag: '부품 부족 1건 (연료펌프 3일)',
      statusClass: 'badge-warning',
      metrics: [
        { label: '엔진 형식', val: '3.3L V6 Twin-Turbo GDi' },
        { label: '최고 출력', val: '370 PS @ 6,000 RPM' },
        { label: '체결 토크 적합도', val: '98.4 Nm (PASS)' }
      ],
      bom: [
        { name: '고압 직분사 연료펌프 (GDI)', qty: '1 EA', supplier: '(주)보쉬코리아', status: '재고 부족 3일 ⚠️', statusClass: 'text-warning' },
        { name: '실린더 블록 (알루미늄 V6)', qty: '1 EA', supplier: '현대위아', status: '정상 입고', statusClass: 'text-success' },
        { name: '트윈스크롤 전자식 터보차저', qty: '2 EA', supplier: '가렛모션', status: '정상 입고', statusClass: 'text-success' },
        { name: '라디에이터 고효율 냉각 모듈', qty: '1 EA', supplier: '한온시스템', status: '정상 입고', statusClass: 'text-success' }
      ]
    },
    brake: {
      title: '전륜 4-피스톤 스포츠 브레이크 시스템',
      desc: '360mm 대구경 벤틸레이티드 디스크 로터와 고성능 레드 4-피스톤 모노블록 캘리퍼 조립부입니다.',
      thumb: './assets/sedan_blueprint.png',
      category: '섀시 / 제동 시스템',
      partNo: 'BRK-FRT-4P-08',
      statusTag: '납품 지연 7일 ⚠️ (태성모터스)',
      statusClass: 'badge-danger',
      metrics: [
        { label: '로터 직경', val: '360 mm x 34 mm' },
        { label: '캘리퍼 사양', val: '알루미늄 모노블록 4-피스톤' },
        { label: '라인 마감', val: 'D-2일 이내 수급 필요' }
      ],
      bom: [
        { name: '세라믹 컴파운드 브레이크 패드', qty: '500 EA', supplier: '(주)태성모터스', status: '납품 지연 7일 ⚠️', statusClass: 'text-danger' },
        { name: '360mm 슬롯형 벤틸레이티드 로터', qty: '2 EA', supplier: '평화정공', status: '정상 납품', statusClass: 'text-success' },
        { name: '모노블록 4P 스포츠 캘리퍼', qty: '2 EA', supplier: '만도제동', status: '정상 납품', statusClass: 'text-success' }
      ]
    },
    wheel: {
      title: '19인치 단조 알로이 휠 & 고성능 타이어',
      desc: '블루프린트 기준 10-스포크 알로이 휠과 245/40R19 미쉐린 서머 타이어 및 TPMS 센서 구성입니다.',
      thumb: './assets/sedan_blueprint.png',
      category: '섀시 / 휠 & 타이어 어셈블리',
      partNo: 'WHL-19D-MIC',
      statusTag: '납품 지연 2일 (타이어)',
      statusClass: 'badge-warning',
      metrics: [
        { label: '타이어 규격', val: '245/40R 19 (98Y)' },
        { label: '휠 사양', val: '19 x 8.5J 단조 알루미늄' },
        { label: '체결 토크', val: '140 Nm 정밀 세팅' }
      ],
      bom: [
        { name: '미쉐린 245/40R19 타이어', qty: '4 EA', supplier: '미쉐린코리아', status: '납품 지연 2일', statusClass: 'text-warning' },
        { name: '19인치 단조 10-스포크 알로이 휠', qty: '4 EA', supplier: '핸즈코퍼레이션', status: '정상 보유', statusClass: 'text-success' },
        { name: 'TPMS 무선 공기압 센서', qty: '4 EA', supplier: '만도', status: '정상 보유', statusClass: 'text-success' }
      ]
    },
    electronics: {
      title: '전장 및 48V 마일드 하이브리드 배터리',
      desc: '차량 플로어 하부에 배치된 48V 리튬이온 배터리 팩 및 중앙 통합 ECU 하네스 시스템입니다.',
      thumb: './assets/sedan_blueprint.png',
      category: '전장 / 파워 매니지먼트',
      partNo: 'ELC-48V-BAT',
      statusTag: '재고 부족 5일분 ⚠️',
      statusClass: 'badge-danger',
      metrics: [
        { label: '배터리 용량', val: '0.46 kWh (48V Li-ion)' },
        { label: 'ECU 통신', val: 'CAN-FD 고속 통신 버스' },
        { label: '품질 지수', val: 'PASS (셀 전압 균일도 99.8%)' }
      ],
      bom: [
        { name: '48V 리튬이온 배터리 모듈', qty: '1 EA', supplier: 'LG에너지솔루션', status: '재고 부족 5일분 ⚠️', statusClass: 'text-danger' },
        { name: '통합 도메인 컨트롤러 (ECU)', qty: '1 EA', supplier: '현대오토에버', status: '정상 납품', statusClass: 'text-success' }
      ]
    },
    body: {
      title: '초고장력 강판(AHSS) 모노코크 섀시',
      desc: '1500MPa 핫스탬핑 B-필러와 링구조 캐빈 설계로 강성과 충돌 안전성을 극대화한 차체 구조입니다.',
      thumb: './assets/sedan_blueprint.png',
      category: '차체 / 화이트 바디 (BIW)',
      partNo: 'BDY-AHSS-BIW',
      statusTag: '정상 가동 (결함율 0.01% 이하)',
      statusClass: 'badge-success',
      metrics: [
        { label: '핫스탬핑 강판 비율', val: '24.5%' },
        { label: '평균 인장강도', val: '67.8 kgf/mm²' },
        { label: '스폿 용접점수', val: '4,820 포인트 완료' }
      ],
      bom: [
        { name: '핫스탬핑 1500MPa B-필러', qty: '2 EA', supplier: '현대제철', status: '정상 조립', statusClass: 'text-success' },
        { name: '알루미늄 후드 & 도어 프레임', qty: '4 EA', supplier: '성우하이텍', status: '정상 조립', statusClass: 'text-success' }
      ]
    }
  };

  // 2. Synchronize 3D Visualizer Part Changes with UI
  visualizer.onPartChange((partKey, preset) => {
    // A. Update Top Toolbar Buttons
    document.querySelectorAll('.part-btn').forEach(btn => {
      if (btn.dataset.part === partKey) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // B. Update Floating Bottom Card
    const data = partsData[partKey] || partsData.all;
    const detailTitle = document.getElementById('detailTitle');
    const detailDesc = document.getElementById('detailDesc');
    const detailThumbImg = document.getElementById('detailThumbImg');
    const detailStatusTag = document.getElementById('detailStatusTag');
    const detailMetricsRow = document.getElementById('detailMetricsRow');

    if (detailTitle) detailTitle.textContent = data.title;
    if (detailDesc) detailDesc.textContent = data.desc;
    if (detailThumbImg) detailThumbImg.src = data.thumb;
    if (detailStatusTag) {
      detailStatusTag.textContent = data.statusTag;
      detailStatusTag.className = `badge-status-tag ${data.statusClass}`;
    }
    if (detailMetricsRow && data.metrics) {
      detailMetricsRow.innerHTML = data.metrics.map(m => `
        <span class="metric-chip">${m.label}: <strong>${m.val}</strong></span>
      `).join('');
    }
  });

  // 3. Top Toolbar Part Buttons Click
  document.querySelectorAll('.part-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const part = btn.dataset.part;
      visualizer.zoomToPart(part);
    });
  });

  // 4. Exterior vs X-Ray Mode Toggle
  const btnExterior = document.getElementById('btnModeExterior');
  const btnCutaway = document.getElementById('btnModeCutaway');

  if (btnExterior && btnCutaway) {
    btnExterior.addEventListener('click', () => {
      btnExterior.classList.add('active');
      btnCutaway.classList.remove('active');
      visualizer.setMode('exterior');
      showToast('3D 차량 외형 도장 모드로 전환되었습니다.');
    });

    btnCutaway.addEventListener('click', () => {
      btnCutaway.classList.add('active');
      btnExterior.classList.remove('active');
      visualizer.setMode('cutaway');
      showToast('내부 기계 및 섀시 X-Ray 투시 모드가 활성화되었습니다.');
    });
  }

  // 5. 360 Auto-Rotate Toggle
  const btnAutoRotate = document.getElementById('btnAutoRotate');
  if (btnAutoRotate) {
    btnAutoRotate.addEventListener('click', () => {
      visualizer.autoRotate = !visualizer.autoRotate;
      if (visualizer.autoRotate) {
        btnAutoRotate.classList.add('active');
        showToast('360도 자동 회전이 시작되었습니다.');
      } else {
        btnAutoRotate.classList.remove('active');
        showToast('자동 회전이 정지되었습니다.');
      }
    });
  }

  // 6. Color Picker
  document.querySelectorAll('.color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      const colorHex = dot.dataset.color;
      visualizer.setCarColor(colorHex);
      showToast(`차량 외장 도장 색상이 변경되었습니다.`);
    });
  });

  // 7. Modal 1: BOM & Spec Modal
  const detailModal = document.getElementById('detailModalBackdrop');
  const btnOpenDetail = document.getElementById('btnOpenDetailModal');
  const btnCloseDetail = document.getElementById('btnCloseDetailModal');
  const btnCloseDetailBottom = document.getElementById('btnCloseDetailModalBottom');

  function openDetailModal() {
    const activePart = visualizer.currentPart || 'all';
    const data = partsData[activePart] || partsData.all;

    const modalCategoryBadge = document.getElementById('modalCategoryBadge');
    const modalPartTitle = document.getElementById('modalPartTitle');
    const specModalPartNo = document.getElementById('specModalPartNo');
    const bomModalTableBody = document.getElementById('bomModalTableBody');

    if (modalCategoryBadge) modalCategoryBadge.textContent = data.category;
    if (modalPartTitle) modalPartTitle.textContent = `${data.title} - BOM 및 공정 검측 데이터`;
    if (specModalPartNo) specModalPartNo.textContent = data.partNo;

    if (bomModalTableBody && data.bom) {
      bomModalTableBody.innerHTML = data.bom.map(item => `
        <tr>
          <td><strong>${item.name}</strong></td>
          <td>${item.qty}</td>
          <td>${item.supplier}</td>
          <td><span class="${item.statusClass} font-bold">${item.status}</span></td>
        </tr>
      `).join('');
    }

    if (detailModal) detailModal.classList.add('active');
  }

  function closeDetailModal() {
    if (detailModal) detailModal.classList.remove('active');
  }

  if (btnOpenDetail) btnOpenDetail.addEventListener('click', openDetailModal);
  if (btnCloseDetail) btnCloseDetail.addEventListener('click', closeDetailModal);
  if (btnCloseDetailBottom) btnCloseDetailBottom.addEventListener('click', closeDetailModal);

  // 8. Modal 2: Alternative Supplier Modal
  const supplierModal = document.getElementById('supplierModalBackdrop');
  const btnFindSupplier = document.getElementById('btnFindSupplierFromCard');
  const btnCloseSupplier = document.getElementById('btnCloseSupplierModal');
  const btnCancelSupplier = document.getElementById('btnCancelSupplierModal');

  function openSupplierModal() {
    if (supplierModal) supplierModal.classList.add('active');
  }

  function closeSupplierModal() {
    if (supplierModal) supplierModal.classList.remove('active');
  }

  if (btnFindSupplier) btnFindSupplier.addEventListener('click', openSupplierModal);
  if (btnCloseSupplier) btnCloseSupplier.addEventListener('click', closeSupplierModal);
  if (btnCancelSupplier) btnCancelSupplier.addEventListener('click', closeSupplierModal);

  // Supplier Order Transfer Button
  document.querySelectorAll('.supplier-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const supplier = btn.dataset.supplier;
      const qty = btn.dataset.qty;
      closeSupplierModal();

      // Update Brake data in store
      if (partsData.brake) {
        partsData.brake.statusTag = `✓ ${supplier} 대체 발주 완료 (납기 2일)`;
        partsData.brake.statusClass = 'badge-success';
        if (partsData.brake.bom[0]) {
          partsData.brake.bom[0].supplier = `(주)${supplier}`;
          partsData.brake.bom[0].status = '발주 완료 (2일 입고 예정)';
          partsData.brake.bom[0].statusClass = 'text-success';
        }
      }

      // Re-trigger visualizer callback to refresh bottom card if currently viewing brake
      if (visualizer.currentPart === 'brake') {
        visualizer.zoomToPart('brake');
      }

      showToast(`(주)${supplier} 로 브레이크 패드 ${qty} EA 긴급 대체 발주가 접수되었습니다!`);
    });
  });

  // Close modals on backdrop click
  window.addEventListener('click', (e) => {
    if (e.target === detailModal) closeDetailModal();
    if (e.target === supplierModal) closeSupplierModal();
  });

  // ESC to reset view & close modals
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDetailModal();
      closeSupplierModal();
      if (visualizer.currentPart !== 'all') {
        visualizer.zoomToPart('all');
      }
    }
  });

  // Toast Notification
  function showToast(message) {
    const toast = document.getElementById('toastNotification');
    const toastText = document.getElementById('toastText');
    if (!toast || !toastText) return;

    toastText.textContent = message;
    toast.classList.add('show');

    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2800);
  }

  window.app = {
    visualizer,
    showToast,
    openDetailModal,
    openSupplierModal
  };

  console.log('ICBM 3D Automotive Studio initialized successfully.');
});
