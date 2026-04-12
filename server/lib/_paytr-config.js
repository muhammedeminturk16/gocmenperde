// server/lib/_paytr-config.js

function getPaytrCredentials() {
  // Vercel panelinde girdiğin isimlerle birebir eşleşmeli
  const merchantId = process.env.NEXT_PUBLIC_PAYTR_MERCHANT_ID || process.env.PAYTR_MERCHANT_ID;
const merchantKey = process.env.NEXT_PUBLIC_PAYTR_MERCHANT_KEY || process.env.PAYTR_MERCHANT_KEY;
const merchantSalt = process.env.NEXT_PUBLIC_PAYTR_MERCHANT_SALT || process.env.PAYTR_MERCHANT_SALT;

  // Hata ayıklama için Log kaydı (Vercel Logs sekmesinde görünür)
  console.log("PayTR Kimlik Kontrolü:", {
    id_mevcut: !!merchantId,
    key_mevcut: !!merchantKey,
    salt_mevcut: !!merchantSalt
  });

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
