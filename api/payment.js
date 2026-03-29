const SUPPORTED_CURRENCIES = new Set(['try', 'usd', 'eur', 'gbp']);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Sadece POST desteklenir.' });
  }

  const { action } = req.query || {};
  if (action !== 'create-checkout-session') {
    return res.status(400).json({ error: 'Geçersiz işlem.' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'STRIPE_SECRET_KEY tanımlı değil.' });
  }

  try {
    const {
      items = [],
      customer = {},
      successUrl,
      cancelUrl,
      currency = 'try',
      orderNote = ''
    } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Ödeme için en az bir ürün gereklidir.' });
    }

    const normalizedCurrency = String(currency).toLowerCase();
    if (!SUPPORTED_CURRENCIES.has(normalizedCurrency)) {
      return res.status(400).json({ error: 'Desteklenmeyen para birimi.' });
    }

    const lineItems = items.map((item) => {
      const unitAmount = Number(item.price);
      const quantity = Number(item.qty || 1);

      if (!Number.isFinite(unitAmount) || unitAmount <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('Ürün fiyatı veya adedi geçersiz.');
      }

      return {
        price_data: {
          currency: normalizedCurrency,
          product_data: {
            name: String(item.name || 'Ürün'),
            description: item.variant ? String(item.variant).slice(0, 250) : undefined
          },
          unit_amount: Math.round(unitAmount * 100)
        },
        quantity: Math.round(quantity)
      };
    });

    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('success_url', successUrl || 'https://example.com/?payment=success');
    params.set('cancel_url', cancelUrl || 'https://example.com/?payment=cancel');

    if (customer?.email) {
      params.set('customer_email', String(customer.email).trim().toLowerCase());
    }

    if (orderNote) {
      params.set('metadata[order_note]', String(orderNote).slice(0, 500));
    }

    lineItems.forEach((line, index) => {
      params.set(`line_items[${index}][price_data][currency]`, line.price_data.currency);
      params.set(`line_items[${index}][price_data][product_data][name]`, line.price_data.product_data.name);
      if (line.price_data.product_data.description) {
        params.set(
          `line_items[${index}][price_data][product_data][description]`,
          line.price_data.product_data.description
        );
      }
      params.set(`line_items[${index}][price_data][unit_amount]`, String(line.price_data.unit_amount));
      params.set(`line_items[${index}][quantity]`, String(line.quantity));
    });

    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    const data = await stripeResponse.json();

    if (!stripeResponse.ok) {
      const message = data?.error?.message || 'Ödeme oturumu oluşturulamadı.';
      return res.status(502).json({ error: message });
    }

    return res.status(200).json({
      success: true,
      checkout_url: data.url,
      session_id: data.id
    });
  } catch (err) {
    console.error('Payment error:', err.message);
    return res.status(500).json({ error: 'Sunucu hatası: ' + err.message });
  }
};
