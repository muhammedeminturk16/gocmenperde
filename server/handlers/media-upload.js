const { requireCloudinaryConfig } = require('../lib/_cloudinary');

const ADMIN_API_KEY = 'gocmen1993';
const MAX_BASE64_CHARS = 14 * 1024 * 1024;

function sanitizeSegment(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Desteklenmeyen method.' });
  }

  if (req.headers['x-admin-key'] !== ADMIN_API_KEY) {
    return res.status(403).json({ error: 'Yetkisiz.' });
  }

  try {
    const fileBase64 = String(req.body?.fileBase64 || '').trim();
    const mimeType = String(req.body?.mimeType || '').trim().toLowerCase();
    const prefix = sanitizeSegment(req.body?.prefix || 'image') || 'image';

    if (!fileBase64) return res.status(400).json({ error: 'Dosya içeriği zorunlu.' });
    if (!mimeType.startsWith('image/')) return res.status(400).json({ error: 'Sadece görsel yüklenebilir.' });
    if (fileBase64.length > MAX_BASE64_CHARS) return res.status(413).json({ error: 'Dosya boyutu çok büyük.' });

    const cloudinary = requireCloudinaryConfig();
    const uploadResult = await cloudinary.uploader.upload(`data:${mimeType};base64,${fileBase64}`, {
      folder: 'gocmenperde',
      resource_type: 'image',
      public_id: `${prefix}-${Date.now()}`,
      overwrite: false,
      unique_filename: true,
      use_filename: false,
    });

    return res.status(200).json({
      success: true,
      url: String(uploadResult.secure_url || '').trim(),
      publicId: String(uploadResult.public_id || '').trim(),
      width: Number(uploadResult.width) || 0,
      height: Number(uploadResult.height) || 0,
      format: String(uploadResult.format || '').trim(),
    });
  } catch (err) {
    console.error('media-upload error:', err.message);
    return res.status(500).json({ error: 'Yükleme başarısız: ' + err.message });
  }
};
