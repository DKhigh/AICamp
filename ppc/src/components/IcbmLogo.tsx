// 팀 ICBM 로고: 가운데 파란 마름모를 남색 팔 네 개가 둘러싼 모양. 상단 바와 모바일 로딩 화면이 함께 쓴다.
const NAVY = '#0f1d3a';

/**
 * 로고의 팔 하나: 굵은 막대와 끝의 고리. slide는 팔이 미끄러지는 방향(팔의 긴 쪽, 바깥으로)이다.
 * animated면 네 팔이 차례로 들어갔다 나오며 기계가 맞물려 움직이는 것처럼 보인다 (index.css .splash-arm).
 */
function Arm({
  d,
  pivot,
  slide,
  delay,
  animated,
  hole,
}: {
  d: string;
  pivot: [number, number];
  slide: [number, number];
  delay: number;
  animated: boolean;
  hole: string;
}) {
  return (
    <g
      className={animated ? 'splash-arm' : undefined}
      style={animated ? { ['--sx' as string]: `${slide[0]}px`, ['--sy' as string]: `${slide[1]}px`, animationDelay: `${delay}s` } : undefined}
    >
      <path d={d} fill="none" stroke={NAVY} strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pivot[0]} cy={pivot[1]} r="6.5" fill={hole} />
    </g>
  );
}

export function IcbmLogo({
  className,
  animated = false,
  background = '#F1F5F9',
}: {
  className?: string;
  /** 로딩 화면에서만 켠다 */
  animated?: boolean;
  /** 로고가 놓이는 바탕색 (고리의 구멍을 이 색으로 뚫는다) */
  background?: string;
}) {
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden>
      {/* 가운데 파란 마름모 */}
      <path
        d="M100 85 L123 100 L100 115 L77 100 Z"
        fill="#1d76f2"
        stroke="#1d76f2"
        strokeWidth="6"
        strokeLinejoin="round"
        className={animated ? 'splash-core' : undefined}
      />
      {/* 위·아래는 꺾인 팔, 좌·우는 곧은 팔 (가운데를 기준으로 서로 마주 본다) */}
      <Arm d="M100 30 L64 52 L64 82" pivot={[100, 30]} slide={[6.8, -4.2]} delay={0} animated={animated} hole={background} />
      <Arm d="M114 62 L160 92" pivot={[160, 92]} slide={[6.6, 4.3]} delay={0.18} animated={animated} hole={background} />
      <Arm d="M100 170 L136 148 L136 118" pivot={[100, 170]} slide={[-6.8, 4.2]} delay={0.36} animated={animated} hole={background} />
      <Arm d="M86 138 L40 108" pivot={[40, 108]} slide={[-6.6, -4.3]} delay={0.54} animated={animated} hole={background} />
    </svg>
  );
}
