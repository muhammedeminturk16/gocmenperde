export default async function handler(req, res) {
// CORS
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Access-Control-Allow-Methods’, ‘POST, OPTIONS’);
res.setHeader(‘Access-Control-Allow-Headers’, ‘Content-Type’);
if (req.method === ‘OPTIONS’) return res.status(200).end();
if (req.method !== ‘POST’) return res.status(405).json({ error: ‘Method not allowed’ });

try {
const { name, phone, address, note, payment, items, total } = req.body;

```
// Validasyon
if (!name || !phone || !address || !items?.length) {
  return res.status(400).json({ error: 'Eksik bilgi' });
}

// Sipariş objesi oluştur
const order = {
  id: 'GP-' + Date.now(),
  date: new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }),
  name, phone, address,
  note: note || '-',
  payment: { kapida: 'Kapıda Ödeme', havale: 'Havale/EFT', kredikarti: 'Kredi Kartı' }[payment] || payment,
  items,
  total
};

// EmailJS üzerinden mail gönder
const emailPayload = {
  service_id:   process.env.EMAILJS_SERVICE_ID   || 'service_ek1695p',
  template_id:  process.env.EMAILJS_TEMPLATE_ID  || 'template_o4bnwvi',
  user_id:      process.env.EMAILJS_USER_ID       || '2YShEY9OBdyUyU3Xf',
  accessToken:  process.env.EMAILJS_ACCESS_TOKEN  || 'IgcBKCdkCKlxrYIrcqJgA',
  template_params: {
    from_name:      order.name,
    from_phone:     order.phone,
    reply_to:       'noreply@gocmenperde.com.tr',
    to_name:        'Göçmen Perde',
    order_total:    order.total.toLocaleString('tr-TR') + ' TL',
    payment_method: order.payment,
    delivery_addr:  order.address,
    message: [
      '📦 SİPARİŞ NO: ' + order.id,
      '📅 TARİH: ' + order.date,
      '',
      '👤 MÜŞTERİ: ' + order.name,
      '📞 TELEFON: ' + order.phone,
      '💳 ÖDEME: ' + order.payment,
      '📍 ADRES: ' + order.address,
      '📝 NOT: ' + order.note,
      '',
      '🛒 ÜRÜNLER:',
      ...order.items.map(i => `  • ${i.name} | ${i.qty} ${i.isMeter ? 'mt' : 'adet'} × ${i.price.toLocaleString('tr-TR')} TL = ${i.sub.toLocaleString('tr-TR')} TL`),
      '',
      '💰 TOPLAM: ' + order.total.toLocaleString('tr-TR') + ' TL'
    ].join('\n')
  }
};

const emailRes = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(emailPayload)
});

return res.status(200).json({
  success: true,
  orderId: order.id,
  emailSent: emailRes.ok
});
```

} catch (err) {
console.error(‘Order API error:’, err);
return res.status(500).json({ error: ‘Sunucu hatası’, detail: err.message });
}
}