// 발표용 QR 코드. 무늬는 scripts/make-qr.mjs가 만든 src/data/qr.json을 그대로 쓴다.
import qrJson from '../data/qr.json';

/** QR 둘레의 흰 여백(칸). 규격이 요구하는 최소 4칸 — 줄이면 인식이 잘 안 된다 */
export const QR_QUIET_ZONE = 4;

export interface QrCode {
  url: string;
  /** 한 줄이 한 행. '1' = 검은 칸 */
  modules: string[];
}

export const siteQr: QrCode = qrJson;

/** 주소에서 'https://'와 끝의 '/'를 뺀, 손으로 치기 좋은 표기 */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** 여백을 포함한 한 변의 칸 수 (SVG viewBox 크기) */
export function qrViewSize(modules: string[], quietZone = QR_QUIET_ZONE): number {
  return modules.length + quietZone * 2;
}

/** 검은 칸을 SVG path로. 같은 행에서 이어진 칸은 한 조각으로 묶는다 */
export function qrPath(modules: string[], quietZone = QR_QUIET_ZONE): string {
  const parts: string[] = [];
  modules.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (row[c] !== '1') {
        c += 1;
        continue;
      }
      let end = c;
      while (end < row.length && row[end] === '1') end += 1;
      parts.push(`M${c + quietZone} ${r + quietZone}h${end - c}v1h${c - end}z`);
      c = end;
    }
  });
  return parts.join('');
}
