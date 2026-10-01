// QR 접속 `/qr`: 발표 화면(빔프로젝터)에 띄워 청중이 휴대폰으로 사이트에 들어오게 한다.
// 멀리서도 찍히도록 QR을 화면 높이에 맞춰 최대한 크게, 순수한 검정/흰색으로 그린다.
import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui';
import { displayUrl, qrPath, qrViewSize, siteQr } from '../lib/qr';

const STEPS = ['휴대폰 카메라 앱을 켭니다', 'QR 코드를 화면에 맞춥니다', '화면에 뜨는 링크를 누릅니다'];

export function QrPage() {
  const frame = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const viewSize = qrViewSize(siteQr.modules);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === frame.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  function toggleFull() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frame.current?.requestFullscreen();
  }

  return (
    // @container: 글자 크기를 이 틀의 너비(cqw)에 맞춰, 보통 화면과 전체 화면에서 같은 비율로 키운다
    <div
      ref={frame}
      className={`@container flex items-center justify-center bg-white ${
        full ? 'p-[4dvh]' : 'rounded-xl border border-slate-200 p-4 shadow-card sm:p-6 lg:min-h-[calc(100dvh_-_100px)]'
      }`}
    >
      <div className="flex w-full flex-col items-center justify-center gap-6 @3xl:flex-row @3xl:gap-[4cqw]">
        <svg
          viewBox={`0 0 ${viewSize} ${viewSize}`}
          shapeRendering="crispEdges"
          role="img"
          aria-label={`${siteQr.url} QR 코드`}
          className={`aspect-square shrink-0 ${
            full ? 'w-[min(100%,58dvh)] @3xl:w-[min(62cqw,92dvh)]' : 'w-[min(100%,calc(100dvh_-_170px))] @3xl:w-[min(62cqw,calc(100dvh_-_150px))]'
          }`}
        >
          <rect width={viewSize} height={viewSize} fill="#ffffff" />
          <path d={qrPath(siteQr.modules)} fill="#000000" />
        </svg>

        <div className="min-w-0 text-center @3xl:text-left">
          <p className="text-[clamp(0.8rem,1.4cqw,1.75rem)] font-bold tracking-wide text-accent">PPC 생산관리 · 직접 써 보세요</p>
          <h1 className="mt-[0.3em] text-[clamp(1.6rem,3.7cqw,5.5rem)] font-extrabold leading-[1.15] tracking-tight text-slate-900">
            휴대폰 카메라로
            <br />
            QR을 찍으세요
          </h1>

          <ol className="mt-[1.2em] space-y-[0.5em] text-left text-[clamp(1rem,1.7cqw,2.5rem)] font-semibold text-slate-700">
            {STEPS.map((step, i) => (
              <li key={step} className="flex items-center gap-[0.6em]">
                <span className="flex h-[1.7em] w-[1.7em] shrink-0 items-center justify-center rounded-full bg-slate-900 text-[0.8em] font-bold text-white">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>

          <div className="mt-[1.4em] text-[clamp(1.2rem,2.5cqw,4rem)]">
            <p className="text-[0.5em] font-semibold text-slate-500">QR이 안 찍히면 주소를 직접 입력하세요</p>
            <p className="mt-[0.15em] whitespace-nowrap font-mono font-bold tracking-tight text-slate-900">{displayUrl(siteQr.url)}</p>
          </div>

          {document.fullscreenEnabled && (
            <Button variant={full ? 'secondary' : 'primary'} className="mt-6" onClick={toggleFull}>
              {full ? '전체 화면 끝내기 (Esc)' : '⛶ 전체 화면으로 크게 보기'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
