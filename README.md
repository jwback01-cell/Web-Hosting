# 이미지 저장소 (사내 전용)

쇼핑몰 업로드용 상품 이미지를 보관·관리하는 내부 사이트입니다.

## 기능
- 직원별 이메일/비밀번호 로그인 (Supabase Auth)
- 제품(폴더) 생성 / 이름변경 / 삭제
- 이미지 다중 업로드 (드래그앤드롭)
- 이미지 그리드 보기 + 호버 액션 (URL 복사 / 삭제)
- 드래그앤드롭으로 이미지 순서 변경
- 제품의 모든 URL 한 번에 복사

## 처음 한 번만 — Supabase 세팅

### 1. 프로젝트 생성
- https://supabase.com 가입 → New project
- DB 비밀번호는 잘 보관 (메모장 등)

### 2. SQL Editor 에서 아래 쿼리 실행

```sql
-- 제품 테이블
create table public.products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  sort_order  int  default 0,
  owner_id    uuid references auth.users(id),
  image_count int  default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- 이미지 테이블
create table public.images (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products(id) on delete cascade,
  storage_path text not null,
  public_url   text not null,
  file_name    text,
  file_size    int,
  sort_order   int  default 0,
  uploaded_by  uuid references auth.users(id),
  created_at   timestamptz default now()
);

create index images_product_idx on public.images(product_id);

-- 이미지 개수를 products.image_count 에 자동 반영하는 트리거
create or replace function public._update_image_count() returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT') then
    update public.products set image_count = image_count + 1, updated_at = now() where id = new.product_id;
  elsif (tg_op = 'DELETE') then
    update public.products set image_count = greatest(image_count - 1, 0), updated_at = now() where id = old.product_id;
  end if;
  return null;
end$$;

create trigger trg_images_count
after insert or delete on public.images
for each row execute function public._update_image_count();

-- RLS (Row Level Security) — 로그인된 사용자만 접근
alter table public.products enable row level security;
alter table public.images   enable row level security;

create policy "auth users full access on products"
  on public.products for all
  to authenticated using (true) with check (true);

create policy "auth users full access on images"
  on public.images for all
  to authenticated using (true) with check (true);
```

### 3. Storage 버킷 생성
- Storage 메뉴 → New bucket
- 이름: `product-images`
- Public bucket 체크 (✓) — 이미지를 공개 URL로 접근 가능
- 생성 후 → Policies 탭에서:
  - "Allow authenticated uploads" : `for insert to authenticated using (true)`
  - "Allow authenticated deletes" : `for delete to authenticated using (true)`
  - "Allow public reads" : `for select to public using (true)`

### 4. 직원 계정 생성
- Authentication → Users → Add user → Send invitation 또는 직접 email/password 입력
- 직원 2명 등록

### 5. API 키 확인
- Project Settings → API
- `Project URL` 과 `anon public` 키를 메모

## 배포

### Vercel (권장)
1. 이 폴더를 GitHub 새 저장소로 푸시
2. https://vercel.com → Add New Project → 해당 저장소 선택
3. Framework Preset: **Other** (자동 감지됨)
4. Deploy

### 첫 접속
- 배포된 URL 접속 시 Supabase URL / anon key 입력 프롬프트가 한 번 뜸
- 직원 이메일/비밀번호로 로그인

## 로컬 실행 (테스트용)
```bash
# Python
python -m http.server 8080
# → http://localhost:8080

# Node 가 있다면
npx serve .
```

## 폴더 구조
```
image-host/
├── index.html      # 단일 파일 SPA
├── vercel.json
├── .gitignore
└── README.md
```

## 향후 개선 아이디어
- 제품별 ZIP 다운로드
- 이미지 EXIF 정보 표시
- 직원별 활동 로그
- 검색 강화 (태그 등)
