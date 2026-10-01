// Excel(data/ppc_data.xlsx + data/ppc_extra.xlsx) → src/data/reference.json, employees.json  (DESIGN.md §4.2)
// 실행: npm run data
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wb = XLSX.read(readFileSync(resolve(root, 'data/ppc_data.xlsx')));

function rows(sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`시트가 없습니다: ${sheetName}`);
  return XLSX.utils.sheet_to_json(ws, { defval: null });
}

const text = (v) => String(v ?? '').trim();
// §4.2-1: 납기 칸이 텍스트('4')로 들어와도 정수로 읽는다
const int = (v, label) => {
  const n = Number(text(v));
  if (!Number.isInteger(n)) throw new Error(`정수가 아닙니다: ${label} = ${JSON.stringify(v)}`);
  return n;
};
const num = (v, label) => {
  const n = Number(text(v));
  if (!Number.isFinite(n)) throw new Error(`숫자가 아닙니다: ${label} = ${JSON.stringify(v)}`);
  return n;
};

// §4.2-3: 부품 1개당 소재 필요량(kg)을 제품코드로 조인
const kgByPart = new Map(
  rows('제품별_자재').map((r) => [text(r['제품코드']), num(r['제품 1개당 필요량'], '제품 1개당 필요량')]),
);

const parts = rows('생산제품').map((r) => {
  const code = text(r['제품코드']);
  if (!kgByPart.has(code)) throw new Error(`제품별_자재 시트에 ${code}가 없습니다`);
  return {
    code,
    name: text(r['생산제품']),
    category: text(r['제품분류']),
    materialName: text(r['주요자재']),
    defaultSupplier: text(r['기본 공급업체']),
    kgPerUnit: kgByPart.get(code),
  };
});

// §4.2-1-1: '준수율 등급' 열(수식)은 읽지 않는다. 등급은 앱이 준수율로 직접 계산한다
const suppliers = rows('공급업체').map((r) => ({
  code: text(r['업체코드']),
  name: text(r['업체명']),
  // §4.2-2: 쉼표로 나누고 공백 제거. 비교는 정확히 일치로만 한다
  materials: text(r['공급 가능 자재'])
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean),
  leadDays: int(r['기본 납기(일)'], '기본 납기(일)'),
  altLeadDays: int(r['대체 납기(일)'], '대체 납기(일)'),
  status: text(r['상태']),
  monthlyCapacityKg: num(r['월 공급가능량(kg)'], '월 공급가능량(kg)'),
  onTimeRate: num(r['납기 준수율(%)'], '납기 준수율(%)'),
}));

// §4.1: 현재재고(kg)는 쓰지 않는다. §4.2-4: 납기 기준은 공급업체 시트
const materials = rows('자재').map((r) => ({
  code: text(r['자재코드']),
  name: text(r['자재명']),
  unit: text(r['단위']),
  defaultSupplier: text(r['기본 공급업체']),
  leadDays: int(r['기본 납기(일)'], '자재 기본 납기(일)'),
  altAvgLeadDays: num(r['대체업체 평균 납기(일)'], '대체업체 평균 납기(일)'),
}));

const delayPresets = rows('지연상황_예시').map((r) => ({
  id: text(r['상황']),
  reason: text(r['지연 원인']),
  supplierName: text(r['기존 업체']),
  materialName: text(r['문제 자재']),
  delayDays: int(r['지연일수'], '지연일수'),
  compareCount: int(r['비교 대상 업체 수'], '비교 대상 업체 수'),
}));

// §4.2-7: 변환 결과 확인
const expected = { parts: 30, suppliers: 48, materials: 7, delayPresets: 3 };
const actual = {
  parts: parts.length,
  suppliers: suppliers.length,
  materials: materials.length,
  delayPresets: delayPresets.length,
};
for (const key of Object.keys(expected)) {
  if (actual[key] !== expected[key]) {
    throw new Error(`${key} 개수가 다릅니다: 기대 ${expected[key]}, 실제 ${actual[key]}`);
  }
}

// ── 추가 자료(data/ppc_extra.xlsx): 단가 · 발주권한자 · 차량색상 · 주의사항 · 지연시간 ─────────────
// 이 파일의 공급업체 시트는 납기 준수율이 다양화되기 전 값(전부 93%)이라 쓰지 않는다.
// 업체·부품 기본 정보는 계속 ppc_data.xlsx가 기준이고, 여기서는 새로 생긴 시트만 읽는다.
const extra = XLSX.read(readFileSync(resolve(root, 'data/ppc_extra.xlsx')));
function extraRows(sheetName) {
  const ws = extra.Sheets[sheetName];
  if (!ws) throw new Error(`ppc_extra.xlsx에 시트가 없습니다: ${sheetName}`);
  return XLSX.utils.sheet_to_json(ws, { defval: null });
}

// 업체별 자재 공급단가(원/kg). 발주 금액 = 단가 × 부품 1개당 소재 필요량(kg) × 수량
const supplierNames = new Set(suppliers.map((s) => s.name));
const prices = extraRows('업체별_자재단가').map((r) => ({
  supplierName: text(r['업체명']),
  materialName: text(r['자재명']),
  pricePerKg: num(r['공급단가(원/kg)'], '공급단가(원/kg)'),
}));
for (const p of prices) {
  if (!supplierNames.has(p.supplierName)) throw new Error(`단가 시트의 업체가 공급업체 시트에 없습니다: ${p.supplierName}`);
}
for (const s of suppliers) {
  for (const m of s.materials) {
    if (!prices.some((p) => p.supplierName === s.name && p.materialName === m)) {
      throw new Error(`단가가 없습니다: ${s.name} · ${m}`);
    }
  }
}

const colors = extraRows('차량색상').map((r) => ({
  code: text(r['색상 코드']),
  name: text(r['자동차 색상']),
  description: text(r['색상 설명']),
}));

const cautions = extraRows('주의사항').map((r) => ({
  partName: text(r['부품명']),
  text: text(r['점검 및 취급 안내']),
}));

// 지연시간: '3일' · '2주' · '1주일' · '2개월' → 일수. 열 이름('10개 발주')의 숫자가 그 단계의 최소 수량이다
function daysOf(label) {
  const m = /^(\d+)\s*(일|주일|주|개월)$/.exec(text(label));
  if (!m) throw new Error(`지연시간을 읽을 수 없습니다: ${JSON.stringify(label)}`);
  return Number(m[1]) * { 일: 1, 주: 7, 주일: 7, 개월: 30 }[m[2]];
}
const qtyDelays = extraRows('지연시간').map((r) => ({
  partName: text(r['부품']),
  tiers: Object.keys(r)
    .filter((k) => /^\d+개 발주$/.test(k))
    .map((k) => ({ minQty: Number(k.replace('개 발주', '')), days: daysOf(r[k]), label: text(r[k]) }))
    .sort((a, b) => a.minQty - b.minQty),
}));

const out = resolve(root, 'src/data/reference.json');
writeFileSync(out, JSON.stringify({ parts, suppliers, materials, delayPresets, prices, colors, cautions, qtyDelays }, null, 2) + '\n');
console.log(
  `reference.json 생성: parts ${actual.parts} · suppliers ${actual.suppliers} · materials ${actual.materials} · delayPresets ${actual.delayPresets} · prices ${prices.length} · colors ${colors.length} · cautions ${cautions.length} · qtyDelays ${qtyDelays.length}`,
);

// 발주권한자 → src/data/employees.json. '발주 권한'이 Y인 사원만 넣는다.
// (테스트용 사원번호 0000은 엑셀이 아니라 src/lib/employees.ts에 있다.)
const employees = extraRows('발주권한자')
  .filter((r) => text(r['발주 권한']).toUpperCase() === 'Y')
  .map((r) => ({ no: text(r['사원번호']).toUpperCase(), name: text(r['이름']), dept: text(r['부서']), rank: text(r['직급']) }));
if (new Set(employees.map((e) => e.no)).size !== employees.length) throw new Error('사원번호가 겹칩니다');
writeFileSync(resolve(root, 'src/data/employees.json'), JSON.stringify(employees, null, 2) + '\n');
console.log(`employees.json 생성: ${employees.length}명`);
