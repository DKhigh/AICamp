// 발표용 QR 코드 무늬 → src/data/qr.json
// 실행: npm run qr              (기본 주소)
//       npm run qr -- https://새주소/   (주소를 바꿀 때)
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-generator';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] ?? 'https://ppcaicamp.vercel.app/';

// 오류 복원 Q(약 25%): 빔프로젝터의 번짐·반사·비스듬한 각도에서도 읽히게 한다.
// 이 주소 길이에서는 M과 칸 수가 같아서(29×29) Q를 써도 칸이 작아지지 않는다.
const qr = qrcode(0, 'Q');
qr.addData(url);
qr.make();

const size = qr.getModuleCount();
const modules = [];
for (let r = 0; r < size; r++) {
  let row = '';
  for (let c = 0; c < size; c++) row += qr.isDark(r, c) ? '1' : '0';
  modules.push(row);
}

writeFileSync(resolve(root, 'src/data/qr.json'), JSON.stringify({ url, modules }, null, 2) + '\n');
console.log(`qr.json: ${url} (${size}×${size}칸)`);
