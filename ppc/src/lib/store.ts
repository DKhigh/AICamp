// DB 테이블 접근 계층. Supabase(공유 DB)와 로컬(이 브라우저만) 두 구현이 같은 인터페이스를 쓴다.
import type { SupabaseClient } from '@supabase/supabase-js';

export type TableName = 'settings' | 'line_parts' | 'purchase_orders' | 'disruptions' | 'customer_orders';
export type Row = Record<string, unknown>;
type Key = string | number;

export const TABLES: TableName[] = ['settings', 'line_parts', 'purchase_orders', 'disruptions', 'customer_orders'];

export const KEY_COLUMN: Record<TableName, string> = {
  settings: 'id',
  line_parts: 'part_code',
  purchase_orders: 'id',
  disruptions: 'id',
  customer_orders: 'id',
};

export interface Store {
  readonly mode: 'supabase' | 'local';
  select(table: TableName): Promise<Row[]>;
  insert(table: TableName, rows: Row[]): Promise<void>;
  update(table: TableName, key: Key, patch: Row): Promise<void>;
  /** 테이블의 모든 행을 지운다 */
  clear(table: TableName): Promise<void>;
}

export function supabaseStore(client: SupabaseClient): Store {
  const check = (error: { message: string } | null) => {
    if (error) throw new Error(error.message);
  };
  return {
    mode: 'supabase',
    async select(table) {
      const { data, error } = await client.from(table).select('*');
      check(error);
      return (data ?? []) as Row[];
    },
    async insert(table, rows) {
      if (rows.length === 0) return;
      const { error } = await client.from(table).insert(rows);
      check(error);
    },
    async update(table, key, patch) {
      const { error } = await client.from(table).update(patch).eq(KEY_COLUMN[table], key);
      check(error);
    },
    async clear(table) {
      // supabase-js의 delete는 필터가 반드시 필요하다 (§5 C-1). settings.id는 정수라 0과 비교한다
      const never = table === 'settings' ? 0 : '__none__';
      const { error } = await client.from(table).delete().neq(KEY_COLUMN[table], never);
      check(error);
    },
  };
}

type Db = Record<TableName, Row[]>;
const emptyDb = (): Db => ({ settings: [], line_parts: [], purchase_orders: [], disruptions: [], customer_orders: [] });

/** 메모리 저장소. persist를 주면 바뀔 때마다 통째로 넘긴다 */
export function memoryStore(initial?: Db, persist?: (db: Db) => void): Store {
  const db: Db = initial ?? emptyDb();
  const save = () => persist?.(db);
  return {
    mode: 'local',
    async select(table) {
      return db[table].map((row) => ({ ...row }));
    },
    async insert(table, rows) {
      const keyCol = KEY_COLUMN[table];
      for (const row of rows) {
        if (db[table].some((r) => r[keyCol] === row[keyCol])) {
          throw new Error(`이미 있는 번호입니다: ${String(row[keyCol])} (다른 사람이 먼저 저장했을 수 있습니다. 새로고침 후 다시 시도하세요)`);
        }
        db[table].push({ ...row });
      }
      save();
    },
    async update(table, key, patch) {
      const row = db[table].find((r) => r[KEY_COLUMN[table]] === key);
      if (row) Object.assign(row, patch);
      save();
    },
    async clear(table) {
      db[table] = [];
      save();
    },
  };
}

const LOCAL_DB_KEY = 'ppc.localdb.v1';

/** localStorage에 저장하는 로컬 데모 저장소. 저장소를 못 쓰면 메모리로만 동작한다 */
export function localStore(): Store {
  let initial: Db | undefined;
  try {
    const raw = window.localStorage.getItem(LOCAL_DB_KEY);
    if (raw) initial = { ...emptyDb(), ...(JSON.parse(raw) as Partial<Db>) };
  } catch {
    initial = undefined;
  }
  return memoryStore(initial, (db) => {
    try {
      window.localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(db));
    } catch {
      // 저장에 실패해도 이번 세션 메모리에는 남아 있다
    }
  });
}
