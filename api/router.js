// api/router.js veya ana server dosyanın EN ÜSTÜNE ekle
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// PayTR değişkenlerini burada bir kez konsola yazdır ki yüklendiğini gör
console.log("Sistem Başlatıldı - PayTR ID:", process.env.PAYTR_MERCHANT_ID ? "OK" : "YOK");
const auth = require('../server/handlers/auth');
const customer = require('../server/handlers/customer');
const customers = require('../server/handlers/customers');
const favorites = require('../server/handlers/favorites');
const orders = require('../server/handlers/orders');
const payment = require('../server/handlers/payment');
const paytrCallback = require('../server/handlers/paytr-callback');
const paytrRefund = require('../server/handlers/paytr-refund');
const paytrReport = require('../server/handlers/paytr-report');
const sliderAds = require('../server/handlers/slider-ads');
const adminSliderAds = require('../server/handlers/admin/slider-ads');
const fromYouShowcase = require('../server/handlers/from-you-showcase');
const adminFromYouShowcase = require('../server/handlers/admin/from-you-showcase');
const slider = require('../server/handlers/slider');
const visits = require('../server/handlers/visits');
const addressData = require('../server/handlers/address-data');
const stockAlerts = require('../server/handlers/stock-alerts');
const campaigns = require('../server/handlers/campaigns');
const adminCampaigns = require('../server/handlers/admin/campaigns');

const ROUTES = {
  'auth': auth,
  'customer': customer,
  'customers': customers,
  'favorites': favorites,
  'orders': orders,
  'payment': payment,
  'paytr-callback': paytrCallback,
  'paytr-refund': paytrRefund,
  'paytr-report': paytrReport,
  'slider-ads': sliderAds,
  'admin/slider-ads': adminSliderAds,
  'from-you-showcase': fromYouShowcase,
  'admin/from-you-showcase': adminFromYouShowcase,
  'slider': slider,
  'visits': visits,
  'address-data': addressData,
  'stock-alerts': stockAlerts,
  'campaigns': campaigns,
  'admin/campaigns': adminCampaigns,
};

module.exports = async function handler(req, res) {
  const route = String(req.query?.route || '').replace(/^\/+|\/+$/g, '');
  const endpoint = ROUTES[route];

  if (!endpoint) {
    return res.status(404).json({ error: 'API endpoint bulunamadı.' });
  }

  return endpoint(req, res);
};
