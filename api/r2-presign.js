// Cloudflare R2 presigned URL 발급기 (배치 지원)
// 입력: { items: [{key, contentType, action}, ...] }  또는 (호환) { key, contentType, action }
// 출력: { items: [{presignedUrl, publicUrl, key, method}, ...] }
// 인증: Supabase JWT 검증 — 한 번만 (배치 전체에 대해)

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

  // 1) 인증 (1회만 — 배치 전체)
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!(await verifySupabaseToken(token))) {
    res.status(401).json({ error: '로그인이 필요합니다' });
    return;
  }

  // 2) 환경변수
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

  // 3) 입력 파싱 — 배치 또는 단일
  const body = req.body || {};
  let items;
  if (Array.isArray(body.items) && body.items.length > 0) {
    items = body.items;
  } else if (body.key) {
    items = [{ key: body.key, contentType: body.contentType, action: body.action }];
  } else {
    res.status(400).json({ error: 'items 배열 또는 key 가 필요합니다' });
    return;
  }
  if (items.length > 200) {
    res.status(400).json({ error: '한 번에 최대 200개까지 가능합니다' });
    return;
  }

  // 4) R2 클라이언트 생성 (1회만)
  const r2 = new AwsClient({
    accessKeyId,
    secretAccessKey,
    region: 'auto',
    service: 's3',
  });

  // 5) 모든 키 presign — 병렬
  try {
    const signedResults = await Promise.all(items.map(async (it) => {
      const key = String(it.key || '');
      if (!key) throw new Error('key 누락');
      const op = it.action === 'delete' ? 'delete' : 'put';
      const method = op === 'delete' ? 'DELETE' : 'PUT';
      const encodedKey = key.split('/').map(encodeURIComponent).join('/');
      const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${encodedKey}?X-Amz-Expires=3600`;
      const init = { method };
      if (op === 'put' && it.contentType) {
        init.headers = { 'Content-Type': it.contentType };
      }
      const signed = await r2.sign(endpoint, { ...init, aws: { signQuery: true } });
      return {
        presignedUrl: signed.url,
        publicUrl: `${publicBase}/${encodedKey}`,
        method,
        key,
      };
    }));
    res.status(200).json({ items: signedResults });
  } catch (e) {
    res.status(500).json({ error: 'presign 실패', detail: e.message || String(e) });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
};
