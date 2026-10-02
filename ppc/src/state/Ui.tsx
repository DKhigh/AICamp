// 어느 화면에서나 열 수 있는 모달(발주, 차질 발생)의 열림 상태
import { createContext, useContext } from 'react';

export interface UiValue {
  /** 발주 모달을 연다. partCode·supplierName을 주면 그 부품·업체가 미리 선택된다 */
  openOrder: (partCode?: string, supplierName?: string) => void;
  openDisruption: () => void;
  /** 업체 정보 창을 연다 (연락처, 납품 부품과 가격, 준수율, 발주 가능량) */
  openSupplier: (supplierName: string) => void;
}

export const UiContext = createContext<UiValue | null>(null);

export function useUi(): UiValue {
  const value = useContext(UiContext);
  if (!value) throw new Error('UiContext 안에서만 쓸 수 있습니다');
  return value;
}
