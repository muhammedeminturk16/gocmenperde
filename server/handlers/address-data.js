const TURKIYE_API_BASE = 'https://turkiyeapi.dev/api/v1/districts';
const NOMINATIM_SEARCH_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

function toComparable(value) {
  return String(value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqTrimmedStrings(values) {
  return Array.from(
    new Set((Array.isArray(values) ? values : []).map((v) => String(v || '').trim()).filter(Boolean))
  );
}



function getStreetSortKey(name) {
  const normalized = toComparable(name);
  if (/\bcadde(si)?\b|\bcd\b/.test(normalized)) return `0-${normalized}`;
  if (/\bsokak\b|\bsokagi\b|\bsk\b/.test(normalized)) return `1-${normalized}`;
  if (/\bbulvar\b/.test(normalized)) return `2-${normalized}`;
  return `3-${normalized}`;
}

function sortStreetValues(values) {
  return uniqTrimmedStrings(values).sort((a, b) => getStreetSortKey(a).localeCompare(getStreetSortKey(b), 'tr'));
}

async function fetchNeighborhoodStreetsFromOsm({ city, district, neighborhood }) {
  const query = [neighborhood, district, city, 'Türkiye'].filter(Boolean).join(', ');
  const geocodeUrl = `${NOMINATIM_SEARCH_ENDPOINT}?format=jsonv2&limit=1&countrycodes=tr&q=${encodeURIComponent(query)}`;
  const geocodeResponse = await fetch(geocodeUrl, {
    headers: { 'User-Agent': 'gocmenperde-address-service/1.0' },
  });
  if (!geocodeResponse.ok) return [];
  const geocodePayload = await geocodeResponse.json();
  const bbox = Array.isArray(geocodePayload?.[0]?.boundingbox) ? geocodePayload[0].boundingbox : [];
  if (bbox.length !== 4) return [];

  const [south, north, west, east] = bbox.map((item) => Number(item));
  if ([south, north, west, east].some((item) => Number.isNaN(item))) return [];

  const overpassQuery = `
[out:json][timeout:25];
(
  way["highway"]["name"](${south},${west},${north},${east});
);
out tags;
`;

  const overpassResponse = await fetch(OVERPASS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': 'gocmenperde-address-service/1.0',
    },
    body: `data=${encodeURIComponent(overpassQuery)}`,
  });
  if (!overpassResponse.ok) return [];
  const overpassPayload = await overpassResponse.json();
  const names = (Array.isArray(overpassPayload?.elements) ? overpassPayload.elements : [])
    .map((item) => item?.tags?.name)
    .filter(Boolean);

  return sortStreetValues(names.filter((name) => {
    const normalized = toComparable(name);
    return (
      /\bcadde(si)?\b|\bcd\b/.test(normalized) ||
      /\bsokak\b|\bsokagi\b|\bsk\b/.test(normalized) ||
      /\bbulvar\b/.test(normalized)
    );
  }));
}

function isStreetLikeName(value) {
  const normalized = toComparable(value);
  return (
    /\bcadde(si)?\b|\bcd\b/.test(normalized) ||
    /\bsokak\b|\bsokagi\b|\bsk\b/.test(normalized) ||
    /\bbulvar\b/.test(normalized)
  );
}

function collectStreetLikeValuesDeep(source, collector, depth = 0) {
  if (depth > 5 || source == null) return;

  if (typeof source === 'string') {
    const value = source.trim();
    if (value && isStreetLikeName(value)) collector.push(value);
    return;
  }

  if (Array.isArray(source)) {
    source.forEach((item) => collectStreetLikeValuesDeep(item, collector, depth + 1));
    return;
  }

  if (typeof source !== 'object') return;

  const keys = [
    'streets',
    'roads',
    'avenues',
    'bulvards',
    'boulevards',
    'streets_and_roads',
    'caddeSokaklar',
    'sokaklar',
    'caddeler',
    'ways',
    'items',
  ];

  keys.forEach((key) => {
    if (source[key] != null) collectStreetLikeValuesDeep(source[key], collector, depth + 1);
  });

  Object.values(source).forEach((value) => {
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (normalized && isStreetLikeName(normalized)) collector.push(normalized);
      return;
    }
    if (Array.isArray(value) || (value && typeof value === 'object')) {
      collectStreetLikeValuesDeep(value, collector, depth + 1);
    }
  });
}

function normalizeStreetValues(entry) {
  const values = [];
  collectStreetLikeValuesDeep(entry, values);
  const directKeys = [
    'streets',
    'roads',
    'avenues',
    'bulvards',
    'boulevards',
    'streets_and_roads',
    'caddeSokaklar',
    'sokaklar',
    'caddeler',
    'ways',
    'items',
  ];
  directKeys.forEach((key) => {
    const value = entry?.[key];
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (typeof item === 'string' && item.trim()) values.push(item.trim());
      });
    }
  });
  return uniqTrimmedStrings(values);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const city = String(req.query?.city || '').trim();
  const district = String(req.query?.district || '').trim();
  const neighborhood = String(req.query?.neighborhood || '').trim();

  if (!city || !district) {
    return res.status(400).json({ error: 'city ve district zorunludur.' });
  }

  try {
    const endpoint = `${TURKIYE_API_BASE}?name=${encodeURIComponent(district)}&province=${encodeURIComponent(city)}`;
    const upstream = await fetch(endpoint);
    if (!upstream.ok) {
      return res.status(502).json({ error: 'Adres verisi alınamadı.' });
    }
    const payload = await upstream.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const matchedDistrict =
      rows.find((row) => toComparable(row?.name) === toComparable(district)) || rows[0] || {};

    const neighborhoodsRaw = Array.isArray(matchedDistrict?.neighborhoods) ? matchedDistrict.neighborhoods : [];
    const streetsByNeighborhood = {};
    neighborhoodsRaw.forEach((entry) => {
      const neighborhoodName = String(entry?.name || entry || '').trim();
      if (!neighborhoodName) return;
      streetsByNeighborhood[neighborhoodName] = sortStreetValues(normalizeStreetValues(entry));
    });

    if (neighborhood) {
      const neighborhoodKey = Object.keys(streetsByNeighborhood).find(
        (key) => toComparable(key) === toComparable(neighborhood)
      );
      const directStreets = sortStreetValues(streetsByNeighborhood[neighborhoodKey || neighborhood] || []);
      if (directStreets.length) {
        return res.status(200).json({
          success: true,
          city,
          district,
          neighborhood,
          streets: directStreets,
          source: 'turkiyeapi',
        });
      }

      const fallbackStreets = await fetchNeighborhoodStreetsFromOsm({ city, district, neighborhood });
      return res.status(200).json({
        success: true,
        city,
        district,
        neighborhood,
        streets: fallbackStreets,
        source: 'osm',
      });
    }

    return res.status(200).json({
      success: true,
      city,
      district,
      neighborhoods: uniqTrimmedStrings(neighborhoodsRaw.map((entry) => entry?.name || entry)),
      streetsByNeighborhood,
    });
  } catch (_) {
    return res.status(500).json({ error: 'Adres verisi alınırken hata oluştu.' });
  }
};
