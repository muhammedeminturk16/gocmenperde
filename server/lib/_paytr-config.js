// server/lib/_paytr-config.js

/**
 * PayTR kimlik bilgilerini güvenli bir şekilde çeker.
 * Vercel üzerindeki Environment Variables ve yerel .env dosyalarını destekler.
 */
function getPaytrCredentials() {
  // Öncelik NEXT_PUBLIC_ önekli olanlardadır (Next.js standartı)
  const merchantId = (
    process.env.NEXT_PUBLIC_PAYTR_MERCHANT_ID || 
    process.env.PAYTR_MERCHANT_ID || 
    ''
  ).trim();

  const merchantKey = (
    process.env.NEXT_PUBLIC_PAYTR_MERCHANT_KEY || 
    process.env.PAYTR_MERCHANT_KEY || 
    ''
  ).trim();

  const merchantSalt = (
    process.env.NEXT_PUBLIC_PAYTR_MERCHANT_SALT || 
    process.env.PAYTR_MERCHANT_SALT || 
    ''
  ).trim();

  // KRİTİK LOG: Vercel Logs sekmesinde hangisinin eksik olduğunu net göreceksin
  console.log("=== PayTR Yapılandırma Kontrolü ===");
  console.log("ID Durumu:", merchantId ? "✅ Yüklendi" : "❌ EKSİK");
  console.log("Key Durumu:", merchantKey ? "✅ Yüklendi" : "❌ EKSİK");
  console.log("Salt Durumu:", merchantSalt ? "✅ Yüklendi" : "❌ EKSİK");
  console.log("====================================");

  return {
    merchantId,
    merchantKey,
    merchantSalt,
    hasRequiredCredentials: Boolean(merchantId && merchantKey && merchantSalt)
  };
}

module.exports = {
  getPaytrCredentials
};
