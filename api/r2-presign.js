// Cloudflare R2 presigned URL 발급기
// 브라우저가 직접 R2 에 업로드/삭제할 수 있게 일회용 인증 URL 을 만들어 반환.
// 인증: Supabase JWT 검증 (로그인된 사용자만 가능)

import { AwsClient } from 'aws4fetch';

async function verifySupabaseToken(token) {
  if (!token) return false;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return false;
  try {
    const r = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
    });
    return r.ok;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 만 허용됩니다' });
    return;
  }

  // 1) 인증 — Supabase 로그인된 사용자인지 확인
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!(await verifySupabaseToken(token))) {
    res.status(401).json({ error: '로그인이 필요합니다 (인증 만료된 경우 다시 로그인)' });
    return;
  }

  // 2) 환경변수 확인
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  const publicBase = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBase) {
    res.status(500).json({
      error: 'R2 환경변수가 설정되지 않았습니다',
      missing: {
        R2_ACCOUNT_ID: !accountId,
        R2_ACCESS_KEY_ID: !accessKeyId,
        R2_SECRET_ACCESS_KEY: !secretAccessKey,
        R2_BUCKET_NAME: !bucket,
        R2_PUBLIC_URL: !publicBase,
      },
    });
    return;
  }

  // 3) 본문 파싱
  const body = req.body || {};
  const { key, contentType, action } = body;
  if (!key || typeof key !== 'string') {
    res.status(400).json({ error: 'key (저장 경로) 가 필요합니다' });
    return;
  }
  const op = action === 'delete' ? 'delete' : 'put';
  const method = op === 'delete' ? 'DELETE' : 'PUT';

  // 4) presigned URL 생성
  try {
    const r2 = new AwsClient({
      accessKeyId,
      secretAccessKey,
      region: 'auto',
      service: 's3',
    });

    // R2 키는 URL 인코딩 (한글/공백 안전)
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${encodedKey}?X-Amz-Expires=3600`;

    const init = { method };
    if (op === 'put' && contentType) {
      init.headers = { 'Content-Type': contentType };
    }
    const signed = await r2.sign(endpoint, { ...init, aws: { signQuery: true } });

    res.status(200).json({
      presignedUrl: signed.url,
      publicUrl: `${publicBase}/${encodedKey}`,
      method,
      key,
    });
  } catch (e) {
    res.status(500).json({ error: 'presign 실패', detail: e.message || String(e) });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};
