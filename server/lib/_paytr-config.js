// server/lib/_paytr-config.js
module.exports = {
  getPaytrCredentials: () => {
    const id = process.env.NEXT_PUBLIC_PAYTR_MERCHANT_ID || process.env.PAYTR_MERCHANT_ID || '';
    const key = process.env.NEXT_PUBLIC_PAYTR_MERCHANT_KEY || process.env.PAYTR_MERCHANT_KEY || '';
    const salt = process.env.NEXT_PUBLIC_PAYTR_MERCHANT_SALT || process.env.PAYTR_MERCHANT_SALT || '';

    return {
      merchantId: id.toString().trim(),
      merchantKey: key.toString().trim(),
      merchantSalt: salt.toString().trim(),
      hasRequiredCredentials: !!(id && key && salt)
    };
  }
};
