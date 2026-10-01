/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** (선택) 기준일을 고정한다. 없으면 항상 오늘 */
  readonly VITE_BASE_DATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
