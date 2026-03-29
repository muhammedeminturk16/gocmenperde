# Online Ödeme Altyapısı Kurulum Planı (Göçmen Perde)

Bu projede şu an checkout ekranında kart alanları görünüyor ama **gerçek kart tahsilatı yok**. Güvenli canlı ödeme için kart bilgilerini kendi sunucunda toplamak yerine Stripe Checkout / iyzico Hosted Payment Page gibi bir yönlendirme sayfası kullanmalısın.

## 1) Mevcut durum (neden eksik?)

- `index.html` içinde `kredikarti` seçeneği mevcut, fakat ödeme sağlayıcıya giden gerçek bir API çağrısı yok.
- Siparişler doğrudan `/api/orders?action=create` ile kaydediliyor.
- Bu yüzden şu anda “kartla ödeme” sadece arayüz seviyesinde görünüyor.

## 2) Bu repoya eklenen temel ödeme endpoint'i

Bu çalışma ile `api/payment.js` dosyası eklendi:

- `POST /api/payment?action=create-checkout-session`
- Ürün listesinden Stripe Checkout Session oluşturur.
- Dönüşte `checkout_url` verir; kullanıcı o URL'ye yönlendirilir.

### Beklenen body örneği

```json
{
  "items": [
    { "name": "Fon Perde", "price": 1299.9, "qty": 2 }
  ],
  "customer": { "email": "musteri@example.com" },
  "successUrl": "https://senindomainin.com/?payment=success",
  "cancelUrl": "https://senindomainin.com/?payment=cancel",
  "currency": "try",
  "orderNote": "Ölçü notu"
}
```

## 3) Vercel ortam değişkenleri

Vercel Project Settings → Environment Variables:

- `STRIPE_SECRET_KEY=sk_live_...`

> Not: Testte `sk_test_...` kullan.

## 4) Frontend entegrasyonu (en kritik adım)

`submitOrder()` içinde, ödeme yöntemi `kredikarti` ise şu akışı kullan:

1. Sepet + müşteri bilgilerini `/api/payment?action=create-checkout-session` endpoint’ine gönder.
2. Dönen `checkout_url` ile `window.location.href = checkout_url` yap.
3. `successUrl` dönüşünde siparişi “ödendi” statüsüyle kaydet.
4. `cancelUrl` dönüşünde kullanıcıyı checkout’a geri al.

## 5) Güvenlik ve doğruluk

- Toplam tutarı **frontend’den körü körüne kabul etme**; backend’de ürün fiyatını tekrar doğrula.
- Mümkünse webhook ile ödeme sonucunu kesinleştir (`checkout.session.completed`).
- Kart numarası/CVV’yi asla kendi DB’ne yazma.

## 6) Türkiye için alternatif

Eğer Stripe yerine iyzico / PayTR kullanacaksan mantık aynıdır:

- Backend'de ödeme oturumu/token üret.
- Kullanıcıyı sağlayıcının güvenli ödeme sayfasına yönlendir.
- Callback/webhook ile siparişi kesinleştir.

---

İstersen bir sonraki adımda `index.html` içindeki `submitOrder()` fonksiyonunu doğrudan bu endpoint’e bağlayıp, “kartla ödeme”yi uçtan uca çalışır hale getirebilirim.
