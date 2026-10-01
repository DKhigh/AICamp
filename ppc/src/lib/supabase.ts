// Supabase 클라이언트 (DESIGN.md §3.4)
// publishable key만 쓴다. secret key(sb_secret_…)는 절대 프론트엔드에 넣지 않는다.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/** 환경 변수가 없으면 null → 이 브라우저에만 저장하는 로컬 데모 모드로 동작한다 */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
