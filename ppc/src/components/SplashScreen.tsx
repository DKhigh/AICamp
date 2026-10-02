// 휴대폰·태블릿으로 사이트에 처음 들어올 때만 보이는 로딩 화면 (팀 ICBM 로고).
// 화면 사이를 오갈 때는 나오지 않는다: 앱이 처음 뜰 때 한 번만 보이고, 데이터를 다 읽으면 사라진다.
import { useEffect, useState } from 'react';
import { IcbmLogo } from './IcbmLogo';

/** 로딩이 아무리 빨라도 로고가 한 번은 움직이는 것이 보이게 하는 최소 시간 */
const MIN_SHOW_MS = 1600;
const FADE_MS = 350;

/**
 * 휴대폰·태블릿인지 (처음 뜰 때 한 번만 본다).
 * 화면이 좁거나(휴대폰), 손가락 터치가 주 입력인 기기(가로로 놓은 태블릿은 폭이 PC만큼 넓다)면 로딩 화면을 보여 준다.
 * 마우스를 쓰는 PC에서는 보여 주지 않는다.
 */
function isPhone(): boolean {
  try {
    return window.matchMedia('(max-width: 767px), (pointer: coarse)').matches;
  } catch {
    return false;
  }
}

const NAVY = '#0f1d3a';
const BACKGROUND = '#F1F5F9';

export function SplashScreen({ ready }: { ready: boolean }) {
  const [show, setShow] = useState(isPhone);
  const [leaving, setLeaving] = useState(false);
  const [minElapsed, setMinElapsed] = useState(false);

  useEffect(() => {
    if (!show) return;
    const timer = window.setTimeout(() => setMinElapsed(true), MIN_SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [show]);

  useEffect(() => {
    if (!show || !ready || !minElapsed) return;
    setLeaving(true);
    const timer = window.setTimeout(() => setShow(false), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [show, ready, minElapsed]);

  if (!show) return null;
  return (
    <div
      role="status"
      aria-label="PPC 생산관리를 불러오는 중입니다"
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center gap-7 transition-opacity ${leaving ? 'opacity-0' : 'opacity-100'}`}
      style={{ background: BACKGROUND, transitionDuration: `${FADE_MS}ms` }}
    >
      <IcbmLogo className="h-44 w-44" animated background={BACKGROUND} />
      <p className="text-4xl font-black tracking-[0.12em]" style={{ color: NAVY }}>
        ICBM
      </p>
      <p className="text-xs font-semibold text-slate-500">PPC 생산관리를 불러오는 중…</p>
    </div>
  );
}
