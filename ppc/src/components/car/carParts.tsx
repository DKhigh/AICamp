// 라인 부품 코드 ↔ 3D 모델의 부품 위치
import type { PartStatus } from '../../lib/planning';
import type { CarPartKey, StatusLevel } from './Car3DVisualizer';

export const CAR_PART_BY_CODE: Record<string, CarPartKey> = {
  P007: 'engine',
  P024: 'transmission',
  P001: 'brake',
  P004: 'suspension',
  P010: 'steering',
  P012: 'body',
  P013: 'battery',
};

/**
 * 3D 모델의 도장 색. Excel '차량색상' 시트의 색 이름으로 정한다 (Excel에는 색 이름만 있다).
 * 표에 없는 이름은 펄 화이트로 칠한다.
 */
const PAINT_BY_COLOR_NAME: Record<string, number> = {
  화이트: 0xf3f5f8,
  블랙: 0x15181f,
  레드: 0xb3161c,
  블루: 0x1f4fd1,
  그레이: 0x6b7280,
  실버: 0xc9ced6,
  네이비: 0x172554,
  그린: 0x15803d,
  옐로우: 0xeab308,
  오렌지: 0xea580c,
  브라운: 0x7c2d12,
  베이지: 0xd9c8a3,
};
export const DEFAULT_PAINT = 0xf3f5f8;

export function paintOf(colorName: string | null | undefined): number {
  return PAINT_BY_COLOR_NAME[colorName ?? ''] ?? DEFAULT_PAINT;
}

export const STATUS_LEVEL: Record<PartStatus, StatusLevel> = {
  차질: 'danger',
  '대응 중': 'info',
  주의: 'warn',
  정상: 'normal',
};

/** 핫스팟 알약을 기준점에서 얼마나 띄울지 (px). 서로 겹치지 않게 방사형으로 벌린다 */
export const HOTSPOT_OFFSET: Record<CarPartKey, { dx: number; dy: number }> = {
  engine: { dx: -78, dy: -62 },
  transmission: { dx: -18, dy: -112 },
  steering: { dx: 44, dy: -96 },
  body: { dx: 86, dy: -40 },
  brake: { dx: -70, dy: 62 },
  battery: { dx: 24, dy: 78 },
  suspension: { dx: 74, dy: 52 },
};

export function CarPartIcon({ part }: { part: CarPartKey }) {
  const common = { viewBox: '0 0 24 24', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (part) {
    case 'engine':
      return (
        <svg {...common}>
          <rect x="6" y="8" width="11" height="9" rx="1.5" />
          <path d="M9 8V5h5v3M3 11v4M17 11h3v4h-3M6 12H3" />
        </svg>
      );
    case 'transmission':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3.2" />
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
        </svg>
      );
    case 'brake':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'suspension':
      return (
        <svg {...common}>
          <path d="M12 2v3M12 19v3M7 6h10l-10 3.5h10L7 13h10L7 16.5h10" />
        </svg>
      );
    case 'steering':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="2" />
          <path d="M12 14v6.5M10.2 11.2 4 9.5M13.8 11.2 20 9.5" />
        </svg>
      );
    case 'body':
      return (
        <svg {...common}>
          <path d="M3 16v-3.5l2.2-5.2A2 2 0 0 1 7 6h10a2 2 0 0 1 1.8 1.3L21 12.5V16M3 16h18M3 16v2M21 16v2" />
          <path d="M7.5 13h.01M16.5 13h.01" />
        </svg>
      );
    case 'battery':
      return (
        <svg {...common}>
          <rect x="3" y="8" width="16" height="9" rx="1.5" />
          <path d="M21.5 11v3M10 10.5l-2 2.2h3l-2 2.3" />
        </svg>
      );
  }
}
