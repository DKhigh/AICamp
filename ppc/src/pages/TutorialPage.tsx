// 튜토리얼 `/tutorial`: 처음 온 사람에게 "어떤 버튼을 누르면 어떤 화면이 나오는지"를 그림으로 보여 준다.
// 화면 그림은 public/tutorial/*.png (시연 초기 데이터 상태의 실제 화면을 찍은 것). DB 데이터 없이도 열린다.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

// 그림을 다시 찍으면 이 숫자를 올린다: 파일 이름이 같아서, 올리지 않으면 브라우저가 예전 그림을 계속 보여 준다
const SHOT_VERSION = 2;
const img = (name: string) => `${import.meta.env.BASE_URL}tutorial/${name}.png?v=${SHOT_VERSION}`;

/** 상단 바의 버튼을 그대로 흉내 낸 그림 (누를 수는 없다) */
function BarButton({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'nav' | 'danger' | 'light' | 'primary' }) {
  const cls = {
    default: 'rounded-md border border-sky-400/60 bg-slate-700 text-white',
    nav: 'rounded-full bg-accent text-white',
    danger: 'rounded-md bg-red-600 text-white',
    light: 'rounded-md border border-slate-300 bg-white text-slate-800',
    primary: 'rounded-md bg-accent text-white',
  }[tone];
  return <span className={`inline-flex items-center whitespace-nowrap px-3 py-1.5 text-[13px] font-bold shadow-sm ${cls}`}>{children}</span>;
}

/** "이 버튼을 누르면" 표시: 어두운 상단 바 위에 놓인 버튼처럼 보이게 한다 */
function Press({ children, where, dark = true }: { children: ReactNode; where: string; dark?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 ${dark ? 'bg-header' : 'border border-slate-200 bg-slate-50'}`}>
        <span aria-hidden className="text-base">👆</span>
        {children}
      </span>
      <span className="text-[13px] text-slate-500">{where}</span>
    </div>
  );
}

/** 누른 뒤에 나오는 화면 그림. 누르면 원본 크기로 새 창에서 연다 */
function Shot({ name, alt, caption, narrow = false }: { name: string; alt: string; caption?: string; narrow?: boolean }) {
  return (
    <figure className={narrow ? 'mx-auto w-full max-w-md' : 'w-full'}>
      <a href={img(name)} target="_blank" rel="noreferrer" title="누르면 크게 봅니다" className="block overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-card">
        <img src={img(name)} alt={alt} loading="lazy" className="block w-full" />
      </a>
      {caption && <figcaption className="mt-1.5 text-center text-xs text-slate-500">{caption}</figcaption>}
    </figure>
  );
}

function Arrow() {
  return (
    <p aria-hidden className="py-1 text-center text-xl font-bold leading-none text-accent">
      ↓
    </p>
  );
}

function Step({ no, title, lead, children }: { no: number; title: string; lead: string; children: ReactNode }) {
  return (
    <section id={`step-${no}`} className="scroll-mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-base font-extrabold text-white">{no}</span>
        <div className="min-w-0">
          <h2 className="text-lg font-extrabold tracking-tight text-slate-900">{title}</h2>
          <p className="mt-0.5 text-[13px] text-slate-600">{lead}</p>
        </div>
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

/** 화면 그림 옆(아래)에 붙는 설명 목록 */
function Notes({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-1.5 text-[13px] leading-relaxed text-slate-700">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

const B = ({ children }: { children: ReactNode }) => <strong className="font-bold text-slate-900">{children}</strong>;

const PAGES: { label: string; to: string; shot: string; summary: string; notes: string[] }[] = [
  {
    label: '대시보드',
    to: '/',
    shot: 'dashboard',
    summary: '지금 공장 상황을 한 화면에서 봅니다',
    notes: [
      '맨 위: 진행 중인 차질(빨강)과 재고 부족(노랑) 알림',
      '숫자 4칸: 지금 만들 수 있는 차량 수, 입고 예정을 더한 수, 수리 중인 차량, 차질 건수',
      '차량 모델: 부품을 누르면 그 부품을 확대하고 재고·입고 일정을 보여 줍니다',
      '아래쪽: 입고 예정 발주, 생산 예측, 주문 납기 현황',
    ],
  },
  {
    label: '출차 일정',
    to: '/shipments',
    shot: 'shipments',
    summary: '완성된 차가 언제 몇 대 나가는지 봅니다',
    notes: ['날짜별 출차 대수와 색상별 대수', '이미 출차한 차량의 실적 (차량 번호·납품처)', '주문별로 납기를 맞출 수 있는지'],
  },
  {
    label: '수리 차량',
    to: '/repairs',
    shot: 'repairs',
    summary: '수리하러 들어온 차량을 봅니다',
    notes: ['차량별 고장 난 곳, 담당 정비사, 진행 상태', '차량 번호를 누르면 고장 난 곳을 차량 모델에서 보여 줍니다 (아래 4번)', '수리에 필요한 부품 합계와 재고'],
  },
  {
    label: '이력',
    to: '/history',
    shot: 'history',
    summary: '지금까지 누가 무엇을 했는지 봅니다',
    notes: ['발주 목록 (입고 대기·지연·입고 완료·취소)', '차질과 그 대응 결과', '납기 추가·취소, 활동 기록 (사원 이름과 시각)'],
  },
];

const TOC = ['로그인', '상단 메뉴', '발주', '납기 추가', '수리 차량 선택'];

export function TutorialPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-6">
        <p className="text-[13px] font-bold tracking-wide text-accent">처음 오셨나요?</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">PPC 생산관리 튜토리얼</h1>
        <p className="mt-1.5 text-sm text-slate-600">
          어떤 버튼을 누르면 어떤 화면이 나오는지 순서대로 보여 줍니다. <B>👆 표시가 누르는 버튼</B>이고, 그 아래 그림이 누른 뒤에 나오는 화면입니다. 그림을
          누르면 크게 볼 수 있습니다.
        </p>
        <nav aria-label="튜토리얼 목차" className="mt-3 flex flex-wrap gap-2">
          {TOC.map((title, no) => (
            <a key={title} href={`#step-${no}`} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[13px] font-semibold text-slate-700 hover:border-accent hover:text-accent">
              {no}. {title}
            </a>
          ))}
        </nav>
      </header>

      <Step no={0} title="로그인" lead="구경은 로그인 없이 할 수 있습니다. 발주·납기 추가처럼 데이터를 바꾸는 일은 로그인해야 버튼이 보입니다.">
        <Press where="화면 맨 위 오른쪽">
          <BarButton>로그인</BarButton>
        </Press>
        <Arrow />
        <div className="grid items-center gap-4 md:grid-cols-2">
          <Shot name="login" alt="사원번호를 입력하는 로그인 창" caption="사원번호 입력 창이 뜹니다" narrow />
          <Notes
            items={[
              <>
                <B>사원번호</B>를 넣으면 아래에 이름이 나타납니다. 번호는 가려져서 보이지 않습니다.
              </>,
              <>
                창 안의 <BarButton tone="primary">로그인</BarButton> 을 누르면 끝. 그 뒤로는 사원번호를 다시 묻지 않습니다.
              </>,
            ]}
          />
        </div>
        <Arrow />
        <Shot name="topbar-in" alt="로그인한 뒤의 상단 바" caption="로그인하면 윗줄 오른쪽이 내 이름으로 바뀌고, 아랫줄 오른쪽에 [+ 발주] [⚠ 차질 발생] [데이터 초기화] 버튼이 생깁니다" />
        <Notes
          items={[
            <>
              <BarButton>+ 발주</BarButton> 부품을 주문합니다 (아래 2번).
            </>,
            <>
              <BarButton tone="danger">⚠ 차질 발생</BarButton> 부품이 늦게 온다는 연락을 받았을 때 등록합니다. 등록하면 대시보드 맨 위에 빨간 알림이 뜨고, 대체 업체를 추천받을 수
              있습니다.
            </>,
            <>
              <BarButton>● 이름 · 로그아웃</BarButton> 누르면 로그아웃합니다. 내가 한 일은 이 이름으로 이력에 남습니다.
            </>,
            <>
              <BarButton>데이터 초기화</BarButton> 모든 데이터를 처음 시연 상태로 되돌립니다. <B>다른 사람 화면의 데이터도 함께 지워지니</B> 주의하세요.
            </>,
          ]}
        />
      </Step>

      <Step no={1} title="상단 메뉴" lead="화면 맨 위의 메뉴 네 개로 페이지를 옮겨 다닙니다. 지금 보고 있는 페이지는 파랗게 표시됩니다.">
        <div className="grid gap-4 md:grid-cols-2">
          {PAGES.map((p) => (
            <div key={p.label} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <Press where={p.summary}>
                <BarButton tone="nav">{p.label}</BarButton>
              </Press>
              <Arrow />
              <Shot name={p.shot} alt={`${p.label} 페이지 화면`} />
              <Notes items={p.notes} />
              <Link to={p.to} className="mt-auto self-start pt-1 text-[13px] font-bold text-accent hover:underline">
                {p.label} 직접 열어 보기 →
              </Link>
            </div>
          ))}
        </div>
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
          메뉴 옆 <B>검색창</B>에 부품이나 업체 이름(예: 엔진, 대성메탈)을 넣으면, 어느 업체에서 얼마에·며칠 만에 살 수 있는지 찾아 줍니다.
        </p>
      </Step>

      <Step no={2} title="발주 (부품 주문)" lead="부품이 모자랄 것 같을 때 업체에 주문을 넣습니다. 로그인해야 버튼이 보입니다.">
        <Press where="상단 바 · 대시보드의 부품 카드와 재고 부족 알림에도 [발주] 버튼이 있습니다">
          <BarButton>+ 발주</BarButton>
        </Press>
        <Arrow />
        <div className="grid items-start gap-4 md:grid-cols-2">
          <Shot name="order" alt="부품 발주 창" caption="부품 발주 창이 뜹니다" narrow />
          <Notes
            items={[
              <>
                <B>부품</B>을 고르면 그 부품을 파는 <B>업체</B> 목록이 나옵니다. 업체마다 단가·납기·준수율(약속한 날짜를 지킨 비율)이 다릅니다.
              </>,
              <>
                <B>수량</B>을 넣으면 <B>발주 금액</B>과 <B>도착 예정일</B>을 바로 계산해 보여 줍니다. 많이 주문할수록 도착이 늦어집니다.
              </>,
              <>수량 칸 아래에 그 업체에 지금 더 주문할 수 있는 한도가 나옵니다.</>,
              <>빨간 경고가 뜨면 그 업체에 해결되지 않은 차질이 있다는 뜻입니다. 다른 업체도 확인하세요.</>,
              <>
                <BarButton tone="primary">발주 등록</BarButton> 을 누르면 주문이 저장되고, 대시보드의 "입고 예정 발주"와 생산 예측에 바로 반영됩니다.
              </>,
            ]}
          />
        </div>
      </Step>

      <Step no={3} title="납기 추가 (고객 주문 등록)" lead="고객이 차량을 언제까지 몇 대 달라고 했는지 등록합니다. 로그인해야 버튼이 보입니다.">
        <Press dark={false} where={'대시보드 아래쪽 "주문 납기 현황" 카드의 오른쪽 위'}>
          <BarButton tone="light">+ 납기 추가</BarButton>
        </Press>
        <div className="mx-auto max-w-xl">
          <Shot name="due-card" alt="대시보드의 주문 납기 현황 카드" caption="이 카드에서 [+ 납기 추가]를 누릅니다" />
        </div>
        <Arrow />
        <div className="grid items-start gap-4 md:grid-cols-2">
          <Shot name="due" alt="납기 추가 창" caption="납기 추가 창이 뜹니다" narrow />
          <Notes
            items={[
              <>
                <B>고객</B> 이름과 <B>납기</B>(받기로 한 날짜)를 넣습니다.
              </>,
              <>
                <B>색상별 수량</B>은 필요한 색에만 넣으면 됩니다. 여러 색을 한 번에 주문할 수 있습니다.
              </>,
              <>수량을 넣으면 그 납기를 맞출 수 있는지 미리 계산해 알려 줍니다. 차체 재고가 모자라면 경고가 나옵니다.</>,
              <>
                <BarButton tone="primary">납기 추가</BarButton> 를 누르면 "주문 납기 현황"에 색상별로 한 줄씩 생기고, 출차 일정에도 반영됩니다.
              </>,
            ]}
          />
        </div>
      </Step>

      <Step no={4} title="수리할 차량 선택" lead="수리 차량 페이지에서 차량을 누르면 어디가 고장 났는지 보여 줍니다. 로그인 없이 볼 수 있습니다.">
        <Press dark={false} where='"수리 차량" 페이지 목록의 차량 번호'>
          <span className="font-mono text-[13px] font-bold text-accent underline">C02-T3G7U0MK</span>
        </Press>
        <Arrow />
        <Shot name="repair-detail" alt="선택한 수리 차량의 상세 화면" caption="목록 아래에 그 차량의 상세가 열립니다" />
        <Notes
          items={[
            <>
              <B>차량 모델</B>: 고장 난 부품만 빨갛게 표시합니다. 끌면 돌려 볼 수 있고, 부품을 누르면 확대합니다.
            </>,
            <>
              <B>고장 난 곳 · 고객 요청사항</B>: 증상과 고객이 남긴 말을 보여 줍니다.
            </>,
            <>
              <B>담당 정비사</B> 이름을 누르면 연락처와 경력이 나옵니다.
            </>,
            <>
              <B>수리해야 하는 부품</B>: 필요한 수량, 재고가 확보됐는지, 노란 칸의 수리 시 주의사항을 보여 줍니다. 로그인했다면 옆의 [발주]로 바로 주문할 수 있습니다.
            </>,
          ]}
        />
      </Step>

      <div className="flex justify-center pb-4">
        <Link to="/" className="rounded-md bg-accent px-5 py-2.5 text-sm font-bold text-white shadow hover:opacity-90">
          대시보드로 가서 직접 써 보기 →
        </Link>
      </div>
    </div>
  );
}
