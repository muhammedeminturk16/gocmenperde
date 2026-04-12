// server/lib/_paytr-config.js
module.exports = {
  getPaytrCredentials: () => {
    // NEXT_PUBLIC ekini unut, doğrudan Vercel'in en temel okuma yöntemini kullanıyoruz
    const id = process.env.PAYTR_MERCHANT_ID || '';
    const key = process.env.PAYTR_MERCHANT_KEY || '';
    const salt = process.env.PAYTR_MERCHANT_SALT || '';

    console.log("Sistem Kontrolü:", { id: !!id, key: !!key, salt: !!salt });

    return {
      merchantId: id.trim(),
      merchantKey: key.trim(),
      merchantSalt: salt.trim(),
      hasRequiredCredentials: !!(id && key && salt)
    };
  }
};
