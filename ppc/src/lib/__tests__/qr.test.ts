import { describe, expect, it } from 'vitest';
import { displayUrl, qrPath, qrViewSize, QR_QUIET_ZONE, siteQr } from '../qr';

describe('발표용 QR 코드', () => {
  it('배포 주소를 담고 있다', () => {
    expect(siteQr.url).toBe('https://ppcaicamp.vercel.app/');
    expect(displayUrl(siteQr.url)).toBe('ppcaicamp.vercel.app');
  });

  it('무늬는 정사각형이고 0과 1로만 되어 있다', () => {
    const size = siteQr.modules.length;
    expect(size).toBe(29); // 버전 3
    for (const row of siteQr.modules) expect(row).toMatch(new RegExp(`^[01]{${size}}$`));
  });

  it('세 모서리에 위치 찾기 무늬가 있다', () => {
    const m = siteQr.modules;
    const n = m.length;
    const FINDER = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
    FINDER.forEach((line, r) => {
      expect(m[r].slice(0, 7)).toBe(line); // 왼쪽 위
      expect(m[r].slice(n - 7)).toBe(line); // 오른쪽 위
      expect(m[n - 7 + r].slice(0, 7)).toBe(line); // 왼쪽 아래
    });
  });

  it('둘레 여백은 4칸이다', () => {
    expect(QR_QUIET_ZONE).toBe(4);
    expect(qrViewSize(siteQr.modules)).toBe(37);
  });

  it('검은 칸을 행마다 이어서 path로 만든다', () => {
    expect(qrPath(['101', '011'], 0)).toBe('M0 0h1v1h-1zM2 0h1v1h-1zM1 1h2v1h-2z');
    expect(qrPath(['1'], 4)).toBe('M4 4h1v1h-1z');
  });

  it('path의 넓이가 검은 칸 수와 같다', () => {
    const dark = siteQr.modules.join('').split('1').length - 1;
    const area = [...qrPath(siteQr.modules).matchAll(/h(\d+)v1/g)].reduce((sum, m) => sum + Number(m[1]), 0);
    expect(area).toBe(dark);
  });
});
