# Online Ödeme Altyapısı (Göçmen Perde)

Bu repo artık kartla ödemeyi **PayTR iFrame v2 token akışı** ile başlatacak şekilde güncellendi.

## 1) Eklenen/Güncellenen endpoint

- `POST /api/payment?action=create-paytr-token`
- Sepetteki ürünleri PayTR formatına çevirir.
- `https://www.paytr.com/odeme/api/get-token` çağrısı yapar.
- Başarılı olursa `checkout_url` (PayTR güvenli ödeme URL’i) döndürür.

### Beklenen body örneği

```json
{
  "items": [
    { "name": "Fon Perde", "price": 1299.9, "qty": 2 }
  ],
  "customer": {
    "email": "musteri@example.com",
    "name": "Müşteri Adı",
    "phone": "05555555555"
  },
  "successUrl": "https://senindomainin.com/?payment=success",
  "cancelUrl": "https://senindomainin.com/?payment=cancel",
  "currency": "TL",
  "orderNote": "Ölçü notu",
  "shippingAddress": "Teslimat adresi"
}
```

## 2) Frontend akışı

`index.html` içindeki `submitOrder()` fonksiyonu ödeme yöntemi `kredikarti` olduğunda:

1. `/api/payment?action=create-paytr-token` endpoint’ine istek atar.
2. Dönüşte gelen `checkout_url`’e yönlendirir.
3. `?payment=success` dönüşünde siparişi yerel + API’ye kaydeder.
4. `?payment=cancel` dönüşünde kullanıcıyı checkout’da bırakır.

## 3) Gerekli ortam değişkenleri (Vercel)

- `PAYTR_MERCHANT_ID`
- `PAYTR_MERCHANT_KEY`
- `PAYTR_MERCHANT_SALT`
- `PAYTR_TEST_MODE` (`1` test, `0` canlı)
- `PAYTR_DEBUG_ON` (`1` debug, `0` kapalı)

## 4) Güvenlik notu

- Merchant bilgileri kod içine gömülmemeli; sadece ortam değişkenlerinden okunmalı.
- Callback doğrulaması (`/callback`) hash kontrolüyle ayrıca eklenmelidir.
- Ödeme sonucu kesinleştirmeyi callback/webhook ile yapmak önerilir.

## 5) Bu repodaki ek PayTR endpoint’leri

- Callback endpoint (hash doğrulama): `POST /api/paytr-callback`
- İşlem dökümü: `POST /api/paytr-report?action=transaction-report`
- İade: `POST /api/paytr-refund?action=refund`

