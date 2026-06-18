-- ih_kv 공용 동기화 테이블 — 로그인한 모든 사용자가 읽기/쓰기 가능하도록 RLS 수정
-- (증상: 마스터가 아닌 계정에서 '시작' 등 변경 후 새로고침하면 되돌아감
--        = 다른 계정이 만든 행을 수정하지 못해 클라우드 저장 실패)
--
-- 실행 방법: Supabase 대시보드(프로젝트 ktqqibjkwpocnxrtsvpd) → SQL Editor → 붙여넣고 Run

-- 테이블이 없다면 생성 (이미 있으면 무시됨)
create table if not exists public.ih_kv (
  key        text primary key,
  data       jsonb,
  updated_by uuid,
  updated_at timestamptz default now()
);

alter table public.ih_kv enable row level security;

-- 기존 제한적 정책 제거 (이름이 다르면 대시보드 Authentication→Policies 에서 직접 삭제)
drop policy if exists "ih_kv read"            on public.ih_kv;
drop policy if exists "ih_kv write"           on public.ih_kv;
drop policy if exists "ih_kv insert"          on public.ih_kv;
drop policy if exists "ih_kv update"          on public.ih_kv;
drop policy if exists "ih_kv owner update"    on public.ih_kv;
drop policy if exists "ih_kv authenticated all" on public.ih_kv;
drop policy if exists "Enable read access for all users" on public.ih_kv;

-- 공용 워크스페이스: 로그인(authenticated)한 사용자는 모든 행 읽기/쓰기 허용
create policy "ih_kv authenticated all"
  on public.ih_kv
  for all
  to authenticated
  using (true)
  with check (true);
