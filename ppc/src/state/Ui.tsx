// 어느 화면에서나 열 수 있는 모달(발주, 차질 발생)의 열림 상태
import { createContext, useContext } from 'react';

export interface UiValue {
  /** 발주 모달을 연다. partCode를 주면 그 부품이 미리 선택된다 */
  openOrder: (partCode?: string) => void;
  openDisruption: () => void;
}

export const UiContext = createContext<UiValue | null>(null);

export function useUi(): UiValue {
  const value = useContext(UiContext);
  if (!value) throw new Error('UiContext 안에서만 쓸 수 있습니다');
  return value;
}
