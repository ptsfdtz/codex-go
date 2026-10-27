import { cloudOrigin } from './cloud';

export type Invitation = {
  v: number;
  hostId: string;
  cloud?: { origin: string; accountId: string };
  tlsServerName: string;
  fingerprint: string;
  token: string;
  expiresAt: string;
};
export function parseInvitation(text: string, hostId: string, scope: string): Invitation {
  let qr: Invitation;
  try {
    qr = JSON.parse(text);
  } catch {
    throw new Error('请导入完整的公网配对信息');
  }
  if (
    !qr ||
    qr.v !== 3 ||
    qr.hostId !== hostId ||
    qr.cloud?.origin !== cloudOrigin ||
    qr.cloud?.accountId !== scope.split(':')[0] ||
    qr.tlsServerName !== '127.0.0.1' ||
    !/^[a-f0-9]{64}$/i.test(qr.fingerprint) ||
    !/^[A-Za-z0-9_-]{43}$/.test(qr.token) ||
    !Number.isFinite(Date.parse(qr.expiresAt)) ||
    Date.parse(qr.expiresAt) <= Date.now()
  )
    throw new Error('配对信息已过期，或与当前账户、电脑不匹配');
  return qr;
}

export async function invitationFromImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024)
    throw new Error('请选择不超过 8 MiB 的 PNG、JPEG 或 WebP 二维码图片');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('浏览器无法读取二维码图片，请粘贴配对信息');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const { default: jsQR } = await import('jsqr');
    const result = jsQR(pixels.data, pixels.width, pixels.height);
    if (!result?.data) throw new Error('未识别到二维码，请选择清晰的完整配对码图片');
    return result.data;
  } finally {
    bitmap.close();
  }
}
