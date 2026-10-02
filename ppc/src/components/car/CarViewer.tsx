// 3D 차량 뷰어: 부품 핫스팟을 누르면 그 부품으로 줌인한다 (car-manager의 3D 스튜디오를 대시보드에 넣은 것)
import { useEffect, useRef, useState, type ReactNode } from 'react';
import blueprintUrl from '../../assets/sedan_blueprint.png';
import type { PartStatus } from '../../lib/planning';
import { Car3DVisualizer, type CarPartKey, type StatusLevel, type ViewMode } from './Car3DVisualizer';
import { colorOf, reference } from '../../lib/reference';
import { ColorSwatch } from '../ui';
import { CarPartIcon, HOTSPOT_OFFSET, paintOf, STATUS_LEVEL } from './carParts';

export interface CarViewerItem {
  key: CarPartKey;
  name: string;
  status: PartStatus;
  isBottleneck: boolean;
}

export function CarViewer({
  items,
  focus,
  onFocus,
  detail,
  initialMode = 'exterior',
  colorCode = null,
  onColorChange,
}: {
  items: CarViewerItem[];
  focus: CarPartKey | null;
  onFocus: (key: CarPartKey | null) => void;
  /** 선택한 부품의 상세 카드 (뷰어 아래쪽에 떠 있다) */
  detail: ReactNode;
  /** 처음 보기 모드. 수리 차량 화면은 안쪽 부품이 보이도록 X-Ray로 연다 */
  initialMode?: ViewMode;
  /** 차체 도장 색 (Excel '차량색상'의 색상 코드). 없으면 펄 화이트 */
  colorCode?: string | null;
  /** 주면 뷰어에 색상 고르기 버튼이 생긴다 */
  onColorChange?: (colorCode: string) => void;
}) {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const hotspotRefs = useRef<Partial<Record<CarPartKey, HTMLDivElement | null>>>({});
  const vizRef = useRef<Car3DVisualizer | null>(null);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<ViewMode>(initialMode);
  const [autoRotate, setAutoRotate] = useState(false);

  useEffect(() => {
    const container = canvasHostRef.current;
    if (!container) return;
    try {
      const viz = new Car3DVisualizer({ container, getHotspot: (key) => hotspotRefs.current[key] ?? null });
      vizRef.current = viz;
      return () => {
        vizRef.current = null;
        viz.dispose();
      };
    } catch {
      // WebGL을 쓸 수 없는 브라우저: 도면 이미지로 대신한다
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    vizRef.current?.zoomToPart(focus ?? 'all');
  }, [focus]);

  const statusKey = items.map((i) => `${i.key}:${i.status}`).join(',');
  useEffect(() => {
    const statuses: Partial<Record<CarPartKey, StatusLevel>> = {};
    for (const item of items) statuses[item.key] = STATUS_LEVEL[item.status];
    vizRef.current?.setStatuses(statuses);
    // items는 매 렌더마다 새 배열이라 상태 문자열(statusKey)로 비교한다
  }, [statusKey]);

  useEffect(() => vizRef.current?.setMode(mode), [mode]);
  useEffect(() => vizRef.current?.setBodyColor(paintOf(colorOf(colorCode)?.name)), [colorCode]);
  useEffect(() => vizRef.current?.setAutoRotate(autoRotate), [autoRotate]);

  if (failed) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg bg-slate-100 p-6 text-center">
        <img src={blueprintUrl} alt="세단 도면" className="max-h-44 w-full object-contain opacity-80" />
        <p className="text-sm text-slate-500">이 브라우저에서는 3D 보기(WebGL)를 쓸 수 없어 도면으로 대신합니다. 부품 정보는 옆의 카드에서 확인하세요.</p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 select-none overflow-hidden rounded-lg bg-studio" onDoubleClick={() => onFocus(null)}>
      {/* 캔버스는 Car3DVisualizer가 이 안에 넣는다 (React가 관리하지 않는 노드라 전용 칸을 둔다) */}
      <div ref={canvasHostRef} className="absolute inset-0" />

      <div className="absolute left-3 top-3 z-30 flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-slate-200 bg-white/90 p-0.5 shadow-sm backdrop-blur">
          {(['exterior', 'cutaway'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              title={m === 'exterior' ? '외형 모드: 도장된 차체' : 'X-Ray 투시 모드: 차체 안쪽 부품이 보인다'}
              className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                mode === m ? 'bg-header text-white' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              {m === 'exterior' ? '외형' : 'X-Ray 투시'}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAutoRotate((on) => !on)}
          aria-pressed={autoRotate}
          className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold shadow-sm backdrop-blur transition-colors ${
            autoRotate ? 'border-sky-400 bg-sky-600 text-white' : 'border-slate-200 bg-white/90 text-slate-600 hover:text-slate-900'
          }`}
        >
          360° 회전
        </button>
      </div>

      {/* 차량 색상 고르기: Excel '차량색상'의 색으로 도장을 바꿔 본다 */}
      {onColorChange && !focus && (
        <div
          // 좁은 화면에서는 '360° 회전' 버튼과 겹치지 않게 보기 모드 줄 아래에 둔다
          className="absolute left-3 top-[52px] z-30 flex items-center gap-1 rounded-md border border-slate-200 bg-white/90 px-1.5 py-1 shadow-sm backdrop-blur sm:left-auto sm:right-3 sm:top-3"
          role="group"
          aria-label="차량 색상"
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {reference.colors.map((c) => {
            const active = c.code === colorCode;
            return (
              <button
                key={c.code}
                type="button"
                onClick={() => onColorChange(c.code)}
                aria-pressed={active}
                aria-label={`차량 색상 ${c.name}`}
                title={`${c.name} · ${c.description}`}
                className={`flex h-6 w-6 items-center justify-center rounded-full transition-shadow ${active ? 'ring-2 ring-accent ring-offset-1' : 'hover:ring-2 hover:ring-slate-300'}`}
              >
                <ColorSwatch code={c.code} size={16} />
              </button>
            );
          })}
        </div>
      )}

      {focus ? (
        <button
          type="button"
          onClick={() => onFocus(null)}
          className="absolute right-3 top-3 z-30 rounded-full border-[1.5px] border-blue-200 bg-white px-3.5 py-1.5 text-xs font-bold text-accent shadow-md hover:bg-accent-light"
        >
          ⟲ 전체 외형으로
        </button>
      ) : (
        <p className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-full border border-slate-200 bg-white/85 px-3 py-1.5 text-[11px] text-slate-600 backdrop-blur">
          드래그 <strong className="text-accent">360° 회전</strong> · 부품 클릭 <strong className="text-accent">확대</strong> · 더블클릭{' '}
          <strong className="text-accent">복귀</strong>
        </p>
      )}

      <div className="car-hotspots">
        {items.map((item) => {
          const { dx, dy } = HOTSPOT_OFFSET[item.key];
          const length = Math.hypot(dx, dy);
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
          const active = focus === item.key;
          return (
            <div
              key={item.key}
              className="car-hotspot"
              // 배지를 기준점에서 띄울 거리. Car3DVisualizer가 화면 밖으로 나가지 않게 조정한다
              data-dx={dx}
              data-dy={dy}
              ref={(el) => {
                hotspotRefs.current[item.key] = el;
              }}
            >
              <span className="car-hotspot-line" style={{ width: length, transform: `rotate(${angle}deg)` }} />
              <span className="car-hotspot-dot" />
              <button
                type="button"
                className={`car-hotspot-pill ${active ? 'is-active' : ''}`}
                style={{ left: dx, top: dy }}
                onClick={(e) => {
                  e.stopPropagation();
                  onFocus(active ? null : item.key);
                }}
                onDoubleClick={(e) => e.stopPropagation()}
                aria-pressed={active}
                title={`${item.name}: ${item.status}${item.isBottleneck ? ' · 병목' : ''}`}
              >
                <span className="car-hotspot-icon">
                  <CarPartIcon part={item.key} />
                </span>
                <span className="text-[11px] font-bold tracking-tight text-slate-900 sm:text-[13px]">{item.name}</span>
                {item.isBottleneck && (
                  <span className="rounded bg-slate-900 px-1 py-px text-[10px] font-bold text-white">병목</span>
                )}
                <span className={`status-dot ${STATUS_LEVEL[item.status]}`} />
                <span className="sr-only">상태 {item.status}</span>
              </button>
            </div>
          );
        })}
      </div>

      {focus && detail && (
        <div
          className="pop-in absolute inset-x-3 bottom-3 z-30 rounded-xl border border-slate-200/85 bg-white/95 p-4 shadow-popup backdrop-blur"
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {detail}
        </div>
      )}
    </div>
  );
}
