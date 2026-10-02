// 휴대폰으로 사이트에 처음 들어올 때만 보이는 로딩 화면 (팀 ICBM 로고).
// 화면 사이를 오갈 때는 나오지 않는다: 앱이 처음 뜰 때 한 번만 보이고, 데이터를 다 읽으면 사라진다.
import { useEffect, useState } from 'react';

/** 로딩이 아무리 빨라도 로고가 한 번은 움직이는 것이 보이게 하는 최소 시간 */
const MIN_SHOW_MS = 1600;
const FADE_MS = 350;

/** 휴대폰 폭인지 (처음 뜰 때 한 번만 본다) */
function isPhone(): boolean {
  try {
    return window.matchMedia('(max-width: 767px)').matches;
  } catch {
    return false;
  }
}

const NAVY = '#0f1d3a';
const BACKGROUND = '#F1F5F9';

/**
 * 로고의 팔 하나: 굵은 막대와 끝의 고리. dx·dy는 팔이 미끄러지는 방향(팔의 긴 쪽, 바깥으로)이다.
 * 네 팔이 차례로 들어갔다 나오며 기계가 맞물려 움직이는 것처럼 보인다.
 */
function Arm({ d, pivot, slide, delay }: { d: string; pivot: [number, number]; slide: [number, number]; delay: number }) {
  return (
    <g className="splash-arm" style={{ ['--sx' as string]: `${slide[0]}px`, ['--sy' as string]: `${slide[1]}px`, animationDelay: `${delay}s` }}>
      <path d={d} fill="none" stroke={NAVY} strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pivot[0]} cy={pivot[1]} r="6.5" fill={BACKGROUND} />
    </g>
  );
}

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
      <svg viewBox="0 0 200 200" className="h-44 w-44" aria-hidden>
        {/* 가운데 파란 마름모 */}
        <path d="M100 85 L123 100 L100 115 L77 100 Z" fill="#1d76f2" stroke="#1d76f2" strokeWidth="6" strokeLinejoin="round" className="splash-core" />
        {/* 위·아래는 꺾인 팔, 좌·우는 곧은 팔 (가운데를 기준으로 서로 마주 본다) */}
        <Arm d="M100 30 L64 52 L64 82" pivot={[100, 30]} slide={[6.8, -4.2]} delay={0} />
        <Arm d="M114 62 L160 92" pivot={[160, 92]} slide={[6.6, 4.3]} delay={0.18} />
        <Arm d="M100 170 L136 148 L136 118" pivot={[100, 170]} slide={[-6.8, 4.2]} delay={0.36} />
        <Arm d="M86 138 L40 108" pivot={[40, 108]} slide={[-6.6, -4.3]} delay={0.54} />
      </svg>
      <p className="text-4xl font-black tracking-[0.12em]" style={{ color: NAVY }}>
        ICBM
      </p>
      <p className="text-xs font-semibold text-slate-500">PPC 생산관리를 불러오는 중…</p>
    </div>
  );
}
