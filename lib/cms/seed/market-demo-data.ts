/**
 * GENERATED — do not edit by hand. Source: scripts/gen-market-demo-data.ts
 * over a live capture (scripts/capture-market-data.ts → scratch/market-capture.json).
 *
 * REAL Dubai competitor market data (project names, prices, price-per-sqft, and
 * the real per-area Area_Trend summary) captured from the Property Finder
 * reseller (uae-real-estate-data-api1). Baked static + deterministic so the
 * prospecting workspace's FALLBACK seed is realistic and area-varied when the
 * live provider quota is exhausted. Aggregate buyer-segment / nationality labels
 * are deterministic, non-PII, and demo-only. Stamped `demo = true` at seed.
 *
 * Captured: 2026-06-22T12:18:19.669Z · source host: uae-real-estate-data-api1.p.rapidapi.com
 * 12 developers · 132 projects · 180 transactions · 6 area-trend rows
 */

export interface DemoDeveloper { sourceRef: string; name: string; }
export interface DemoProject {
  ref: string; developerRef: string; name: string; area: string;
  segment: "ultra_luxury" | "luxury" | "premium" | "mid";
  unitTypes: string[]; priceMin: number; priceMax: number; avgPricePerSqft: number;
  lat?: number; lng?: number;
}
export interface DemoTransaction {
  sourceRef: string; projectSourceRef: string; communityName: string; areaName: string;
  txnType: "sale"; txnDate: string; unitType: string; areaSqm: number | null;
  bedrooms: number | null; priceAed: number | null; pricePerSqft: number | null;
  buyerSegment: string; buyerNationality: string;
}
export interface DemoIndex {
  areaName: string; segment: "ultra_luxury" | "luxury" | "premium" | "mid";
  period: string; indexValue: number; avgPricePerSqft: number; yoyPct: number;
  roiPct: number; volume: number; trend: Record<string, number>;
}

export const DEMO_DEVELOPERS: DemoDeveloper[] = [
  {
    "sourceRef": "dev-independent-developer",
    "name": "Independent Developer"
  },
  {
    "sourceRef": "dev-omniyat",
    "name": "Omniyat"
  },
  {
    "sourceRef": "dev-branded-residence-operator",
    "name": "Branded Residence Operator"
  },
  {
    "sourceRef": "dev-nakheel",
    "name": "Nakheel"
  },
  {
    "sourceRef": "dev-kerzner-international",
    "name": "Kerzner International"
  },
  {
    "sourceRef": "dev-damac-properties",
    "name": "DAMAC Properties"
  },
  {
    "sourceRef": "dev-select-group",
    "name": "Select Group"
  },
  {
    "sourceRef": "dev-emaar-properties",
    "name": "Emaar Properties"
  },
  {
    "sourceRef": "dev-binghatti-developers",
    "name": "Binghatti Developers"
  },
  {
    "sourceRef": "dev-danube-properties",
    "name": "Danube Properties"
  },
  {
    "sourceRef": "dev-azizi-developments",
    "name": "Azizi Developments"
  },
  {
    "sourceRef": "dev-ellington-properties",
    "name": "Ellington Properties"
  }
];

export const DEMO_PROJECTS: DemoProject[] = [
  {
    "ref": "pf-palm-jumeirah-bella",
    "developerRef": "dev-independent-developer",
    "name": "Bella",
    "area": "Palm Jumeirah",
    "segment": "ultra_luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 6418560,
    "priceMax": 12600000,
    "avgPricePerSqft": 5451,
    "lat": 25.114929,
    "lng": 55.137455
  },
  {
    "ref": "pf-palm-jumeirah-the-alba-residences-by-omniyat-building-1",
    "developerRef": "dev-omniyat",
    "name": "The Alba Residences by Omniyat Building 1",
    "area": "Palm Jumeirah",
    "segment": "ultra_luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 16361144,
    "priceMax": 73957500,
    "avgPricePerSqft": 8133,
    "lat": 25.114929,
    "lng": 55.137455
  },
  {
    "ref": "pf-palm-jumeirah-al-shahla",
    "developerRef": "dev-independent-developer",
    "name": "Al Shahla",
    "area": "Palm Jumeirah",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2480000,
    "priceMax": 2480000,
    "avgPricePerSqft": 2167,
    "lat": 25.114929,
    "lng": 55.137455
  },
  {
    "ref": "pf-palm-jumeirah-avita",
    "developerRef": "dev-independent-developer",
    "name": "Avita",
    "area": "Palm Jumeirah",
    "segment": "ultra_luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 5810000,
    "priceMax": 16907940,
    "avgPricePerSqft": 6404,
    "lat": 25.114929,
    "lng": 55.137455
  },
  {
    "ref": "pf-palm-jumeirah-serenia-living-tower-3",
    "developerRef": "dev-independent-developer",
    "name": "Serenia Living Tower 3",
    "area": "Palm Jumeirah",
    "segment": "ultra_luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 22426000,
    "priceMax": 22426000,
    "avgPricePerSqft": 3500,
    "lat": 25.114929,
    "lng": 55.137455
  },
  {
    "ref": "pf-palm-jumeirah-the-fairmont-palm-residence-north",
    "developerRef": "dev-branded-residence-operator",
    "name": "The Fairmont Palm Residence North",
    "area": "Palm Jumeirah",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2615000,
    "priceMax": 2615000,
    "avgPricePerSqft": 1990,
    "lat": 25.114929,
    "lng": 55.137455
  },
  {
    "ref": "pf-palm-jumeirah-palm-beach-towers-2",
    "developerRef": "dev-nakheel",
    "name": "Palm Beach Towers 2",
    "area": "Palm Jumeirah",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 3750000,
    "priceMax": 3750000,
    "avgPricePerSqft": 3287,
    "lat": 25.114929,
    "lng": 55.137455
  },
  {
    "ref": "pf-palm-jumeirah-al-hamri",
    "developerRef": "dev-independent-developer",
    "name": "Al Hamri",
    "area": "Palm Jumeirah",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 3400000,
    "priceMax": 3400000,
    "avgPricePerSqft": 2192,
    "lat": 25.114929,
    "lng": 55.137455
  },
  {
    "ref": "pf-palm-jumeirah-marina-residences-4",
    "developerRef": "dev-independent-developer",
    "name": "Marina Residences 4",
    "area": "Palm Jumeirah",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 4050000,
    "priceMax": 4050000,
    "avgPricePerSqft": 2278,
    "lat": 25.114929,
    "lng": 55.137455
  },
  {
    "ref": "pf-palm-jumeirah-seven-palm",
    "developerRef": "dev-independent-developer",
    "name": "Seven Palm",
    "area": "Palm Jumeirah",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1282238,
    "priceMax": 1480000,
    "avgPricePerSqft": 3096,
    "lat": 25.114929,
    "lng": 55.137455
  },
  {
    "ref": "pf-palm-jumeirah-royal-amwaj-residences-south",
    "developerRef": "dev-kerzner-international",
    "name": "Royal Amwaj Residences South",
    "area": "Palm Jumeirah",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 3950000,
    "priceMax": 3950000,
    "avgPricePerSqft": 2266,
    "lat": 25.114929,
    "lng": 55.137455
  },
  {
    "ref": "pf-palm-jumeirah-abu-keibal",
    "developerRef": "dev-independent-developer",
    "name": "Abu Keibal",
    "area": "Palm Jumeirah",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 4800000,
    "priceMax": 4800000,
    "avgPricePerSqft": 2164,
    "lat": 25.114929,
    "lng": 55.137455
  },
  {
    "ref": "pf-palm-jumeirah-the-fairmont-palm-residence-south",
    "developerRef": "dev-branded-residence-operator",
    "name": "The Fairmont Palm Residence South",
    "area": "Palm Jumeirah",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2575000,
    "priceMax": 2575000,
    "avgPricePerSqft": 1993,
    "lat": 25.114929,
    "lng": 55.137455
  },
  {
    "ref": "pf-palm-jumeirah-al-hatimi",
    "developerRef": "dev-independent-developer",
    "name": "Al Hatimi",
    "area": "Palm Jumeirah",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 10300000,
    "priceMax": 10300000,
    "avgPricePerSqft": 1967,
    "lat": 25.114929,
    "lng": 55.137455
  },
  {
    "ref": "pf-palm-jumeirah-oceana-atlantic",
    "developerRef": "dev-independent-developer",
    "name": "Oceana Atlantic",
    "area": "Palm Jumeirah",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 7360000,
    "priceMax": 7360000,
    "avgPricePerSqft": 3228,
    "lat": 25.114929,
    "lng": 55.137455
  },
  {
    "ref": "pf-palm-jumeirah-serenia-residences-west",
    "developerRef": "dev-independent-developer",
    "name": "Serenia Residences West",
    "area": "Palm Jumeirah",
    "segment": "ultra_luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 6600000,
    "priceMax": 6600000,
    "avgPricePerSqft": 3705,
    "lat": 25.114929,
    "lng": 55.137455
  },
  {
    "ref": "pf-palm-jumeirah-como-residences",
    "developerRef": "dev-independent-developer",
    "name": "Como Residences",
    "area": "Palm Jumeirah",
    "segment": "ultra_luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 41000000,
    "priceMax": 41000000,
    "avgPricePerSqft": 4434,
    "lat": 25.114929,
    "lng": 55.137455
  },
  {
    "ref": "pf-palm-jumeirah-marina-residences-3",
    "developerRef": "dev-independent-developer",
    "name": "Marina Residences 3",
    "area": "Palm Jumeirah",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 3850000,
    "priceMax": 3850000,
    "avgPricePerSqft": 2205,
    "lat": 25.114929,
    "lng": 55.137455
  },
  {
    "ref": "pf-dubai-marina-time-place-tower",
    "developerRef": "dev-independent-developer",
    "name": "Time Place Tower",
    "area": "Dubai Marina",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1420075,
    "priceMax": 1420075,
    "avgPricePerSqft": 1614,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-sanibel-tower",
    "developerRef": "dev-independent-developer",
    "name": "Sanibel Tower",
    "area": "Dubai Marina",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1880000,
    "priceMax": 1880000,
    "avgPricePerSqft": 2068,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-marina-heights",
    "developerRef": "dev-independent-developer",
    "name": "Marina Heights",
    "area": "Dubai Marina",
    "segment": "mid",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1300000,
    "priceMax": 1300000,
    "avgPricePerSqft": 1286,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-liv-lux",
    "developerRef": "dev-independent-developer",
    "name": "Liv Lux",
    "area": "Dubai Marina",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 4057157,
    "priceMax": 4057157,
    "avgPricePerSqft": 2627,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-botanica-tower",
    "developerRef": "dev-independent-developer",
    "name": "Botanica Tower",
    "area": "Dubai Marina",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2050000,
    "priceMax": 2050000,
    "avgPricePerSqft": 1697,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-damac-heights",
    "developerRef": "dev-damac-properties",
    "name": "Damac Heights",
    "area": "Dubai Marina",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2800000,
    "priceMax": 2860000,
    "avgPricePerSqft": 2102,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-5242-tower-1",
    "developerRef": "dev-independent-developer",
    "name": "5242 Tower 1",
    "area": "Dubai Marina",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2800000,
    "priceMax": 3420000,
    "avgPricePerSqft": 2757,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-al-habtoor-grand-resort-autograph-collection",
    "developerRef": "dev-independent-developer",
    "name": "Al Habtoor Grand Resort Autograph Collection",
    "area": "Dubai Marina",
    "segment": "ultra_luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 10781668,
    "priceMax": 10781668,
    "avgPricePerSqft": 4700,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-the-torch",
    "developerRef": "dev-independent-developer",
    "name": "The Torch",
    "area": "Dubai Marina",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1250000,
    "priceMax": 1250000,
    "avgPricePerSqft": 1547,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-sparkle-tower-2",
    "developerRef": "dev-independent-developer",
    "name": "Sparkle Tower 2",
    "area": "Dubai Marina",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1070000,
    "priceMax": 1070000,
    "avgPricePerSqft": 2593,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-marina-diamond-3",
    "developerRef": "dev-independent-developer",
    "name": "Marina Diamond 3",
    "area": "Dubai Marina",
    "segment": "mid",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1011360,
    "priceMax": 1011360,
    "avgPricePerSqft": 1391,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-residences-du-port",
    "developerRef": "dev-independent-developer",
    "name": "Residences Du Port",
    "area": "Dubai Marina",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 3850000,
    "priceMax": 3850000,
    "avgPricePerSqft": 3069,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-jumeirah-living-marina-gate",
    "developerRef": "dev-select-group",
    "name": "Jumeirah Living Marina Gate",
    "area": "Dubai Marina",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2115000,
    "priceMax": 2115000,
    "avgPricePerSqft": 2239,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-opal-tower-marina",
    "developerRef": "dev-independent-developer",
    "name": "Opal Tower Marina",
    "area": "Dubai Marina",
    "segment": "mid",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1230000,
    "priceMax": 1292643,
    "avgPricePerSqft": 1185,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-marina-diamond-6",
    "developerRef": "dev-independent-developer",
    "name": "Marina Diamond 6",
    "area": "Dubai Marina",
    "segment": "mid",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1250000,
    "priceMax": 1250000,
    "avgPricePerSqft": 1153,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-the-point",
    "developerRef": "dev-independent-developer",
    "name": "The Point",
    "area": "Dubai Marina",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1500000,
    "priceMax": 1500000,
    "avgPricePerSqft": 1975,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-marina-pinnacle",
    "developerRef": "dev-independent-developer",
    "name": "Marina Pinnacle",
    "area": "Dubai Marina",
    "segment": "mid",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1800000,
    "priceMax": 1800000,
    "avgPricePerSqft": 1149,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-marinascape-avant",
    "developerRef": "dev-omniyat",
    "name": "Marinascape Avant",
    "area": "Dubai Marina",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 4750000,
    "priceMax": 4750000,
    "avgPricePerSqft": 2191,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-zumurud-tower",
    "developerRef": "dev-independent-developer",
    "name": "Zumurud Tower",
    "area": "Dubai Marina",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 780000,
    "priceMax": 780000,
    "avgPricePerSqft": 1818,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-elite-residence",
    "developerRef": "dev-independent-developer",
    "name": "Elite Residence",
    "area": "Dubai Marina",
    "segment": "mid",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1350000,
    "priceMax": 1350000,
    "avgPricePerSqft": 1406,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-marina-crown",
    "developerRef": "dev-independent-developer",
    "name": "Marina Crown",
    "area": "Dubai Marina",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 3300000,
    "priceMax": 3300000,
    "avgPricePerSqft": 1518,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-skyview-tower",
    "developerRef": "dev-independent-developer",
    "name": "Skyview Tower",
    "area": "Dubai Marina",
    "segment": "mid",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1150000,
    "priceMax": 1150000,
    "avgPricePerSqft": 1470,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-marina-gate-1",
    "developerRef": "dev-select-group",
    "name": "Marina Gate 1",
    "area": "Dubai Marina",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 5100000,
    "priceMax": 5100000,
    "avgPricePerSqft": 2800,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-marina-quays-west",
    "developerRef": "dev-independent-developer",
    "name": "Marina Quays West",
    "area": "Dubai Marina",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1725000,
    "priceMax": 1725000,
    "avgPricePerSqft": 2189,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-almass",
    "developerRef": "dev-independent-developer",
    "name": "Almass",
    "area": "Dubai Marina",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 8159353,
    "priceMax": 8159353,
    "avgPricePerSqft": 2011,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-al-fairooz-tower",
    "developerRef": "dev-independent-developer",
    "name": "Al Fairooz Tower",
    "area": "Dubai Marina",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 12100000,
    "priceMax": 12100000,
    "avgPricePerSqft": 2797,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-dubai-marina-23-marina",
    "developerRef": "dev-independent-developer",
    "name": "23 Marina",
    "area": "Dubai Marina",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 3250000,
    "priceMax": 3250000,
    "avgPricePerSqft": 2010,
    "lat": 25.078367,
    "lng": 55.14041
  },
  {
    "ref": "pf-downtown-dubai-the-st-regis-residences-tower-1",
    "developerRef": "dev-branded-residence-operator",
    "name": "The St. Regis Residences - Tower 1",
    "area": "Downtown Dubai",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 3490000,
    "priceMax": 3490000,
    "avgPricePerSqft": 2800,
    "lat": 25.194985,
    "lng": 55.278414
  },
  {
    "ref": "pf-downtown-dubai-bellevue-tower-1",
    "developerRef": "dev-independent-developer",
    "name": "Bellevue Tower 1",
    "area": "Downtown Dubai",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1500000,
    "priceMax": 2200000,
    "avgPricePerSqft": 1930,
    "lat": 25.194985,
    "lng": 55.278414
  },
  {
    "ref": "pf-downtown-dubai-boulevard-central-tower-1",
    "developerRef": "dev-emaar-properties",
    "name": "Boulevard Central Tower 1",
    "area": "Downtown Dubai",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2750000,
    "priceMax": 2750000,
    "avgPricePerSqft": 2365,
    "lat": 25.194985,
    "lng": 55.278414
  },
  {
    "ref": "pf-downtown-dubai-tajer-residences",
    "developerRef": "dev-independent-developer",
    "name": "Tajer Residences",
    "area": "Downtown Dubai",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2500000,
    "priceMax": 2500000,
    "avgPricePerSqft": 2610,
    "lat": 25.194985,
    "lng": 55.278414
  },
  {
    "ref": "pf-downtown-dubai-burj-royale",
    "developerRef": "dev-kerzner-international",
    "name": "Burj Royale",
    "area": "Downtown Dubai",
    "segment": "ultra_luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 3750000,
    "priceMax": 3750000,
    "avgPricePerSqft": 3911,
    "lat": 25.194985,
    "lng": 55.278414
  },
  {
    "ref": "pf-downtown-dubai-burj-khalifa",
    "developerRef": "dev-emaar-properties",
    "name": "Burj Khalifa",
    "area": "Downtown Dubai",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2650000,
    "priceMax": 2900000,
    "avgPricePerSqft": 2516,
    "lat": 25.194985,
    "lng": 55.278414
  },
  {
    "ref": "pf-downtown-dubai-blvd-heights-tower-1",
    "developerRef": "dev-emaar-properties",
    "name": "BLVD Heights Tower 1",
    "area": "Downtown Dubai",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2200000,
    "priceMax": 2200000,
    "avgPricePerSqft": 2468,
    "lat": 25.194985,
    "lng": 55.278414
  },
  {
    "ref": "pf-downtown-dubai-city-center-residences",
    "developerRef": "dev-independent-developer",
    "name": "City Center Residences",
    "area": "Downtown Dubai",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1607583,
    "priceMax": 4650000,
    "avgPricePerSqft": 2524,
    "lat": 25.194985,
    "lng": 55.278414
  },
  {
    "ref": "pf-downtown-dubai-fairmont-residences-solara-tower",
    "developerRef": "dev-branded-residence-operator",
    "name": "Fairmont Residences Solara Tower",
    "area": "Downtown Dubai",
    "segment": "ultra_luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 10679000,
    "priceMax": 10679000,
    "avgPricePerSqft": 4166,
    "lat": 25.194985,
    "lng": 55.278414
  },
  {
    "ref": "pf-downtown-dubai-society-house",
    "developerRef": "dev-independent-developer",
    "name": "Society House",
    "area": "Downtown Dubai",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2381961,
    "priceMax": 2381961,
    "avgPricePerSqft": 2770,
    "lat": 25.194985,
    "lng": 55.278414
  },
  {
    "ref": "pf-downtown-dubai-the-lofts-west",
    "developerRef": "dev-independent-developer",
    "name": "The Lofts West",
    "area": "Downtown Dubai",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1735000,
    "priceMax": 1735000,
    "avgPricePerSqft": 1962,
    "lat": 25.194985,
    "lng": 55.278414
  },
  {
    "ref": "pf-downtown-dubai-standpoint-tower-1",
    "developerRef": "dev-independent-developer",
    "name": "Standpoint Tower 1",
    "area": "Downtown Dubai",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1500000,
    "priceMax": 1500000,
    "avgPricePerSqft": 1784,
    "lat": 25.194985,
    "lng": 55.278414
  },
  {
    "ref": "pf-downtown-dubai-the-st-regis-residences-tower-2",
    "developerRef": "dev-branded-residence-operator",
    "name": "The St. Regis Residences - Tower 2",
    "area": "Downtown Dubai",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 3775000,
    "priceMax": 3775000,
    "avgPricePerSqft": 2598,
    "lat": 25.194985,
    "lng": 55.278414
  },
  {
    "ref": "pf-downtown-dubai-south-ridge-4",
    "developerRef": "dev-independent-developer",
    "name": "South Ridge 4",
    "area": "Downtown Dubai",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1800000,
    "priceMax": 3500000,
    "avgPricePerSqft": 1881,
    "lat": 25.194985,
    "lng": 55.278414
  },
  {
    "ref": "pf-downtown-dubai-blvd-heights-tower-2",
    "developerRef": "dev-emaar-properties",
    "name": "BLVD Heights Tower 2",
    "area": "Downtown Dubai",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2150000,
    "priceMax": 2150000,
    "avgPricePerSqft": 2315,
    "lat": 25.194985,
    "lng": 55.278414
  },
  {
    "ref": "pf-downtown-dubai-mada-residences-by-artar",
    "developerRef": "dev-independent-developer",
    "name": "Mada Residences by ARTAR",
    "area": "Downtown Dubai",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 4300000,
    "priceMax": 4300000,
    "avgPricePerSqft": 1786,
    "lat": 25.194985,
    "lng": 55.278414
  },
  {
    "ref": "pf-downtown-dubai-baccarat-hotel-and-residences",
    "developerRef": "dev-independent-developer",
    "name": "Baccarat Hotel and Residences",
    "area": "Downtown Dubai",
    "segment": "ultra_luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 53000000,
    "priceMax": 53000000,
    "avgPricePerSqft": 5622,
    "lat": 25.194985,
    "lng": 55.278414
  },
  {
    "ref": "pf-downtown-dubai-burj-vista-tower-1",
    "developerRef": "dev-independent-developer",
    "name": "Burj Vista Tower 1",
    "area": "Downtown Dubai",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 4200000,
    "priceMax": 4200000,
    "avgPricePerSqft": 2545,
    "lat": 25.194985,
    "lng": 55.278414
  },
  {
    "ref": "pf-downtown-dubai-binghatti-skyblade",
    "developerRef": "dev-binghatti-developers",
    "name": "Binghatti Skyblade",
    "area": "Downtown Dubai",
    "segment": "ultra_luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 3254999,
    "priceMax": 3669999,
    "avgPricePerSqft": 4035,
    "lat": 25.194985,
    "lng": 55.278414
  },
  {
    "ref": "pf-downtown-dubai-29-burj-boulevard-tower-1",
    "developerRef": "dev-emaar-properties",
    "name": "29 Burj Boulevard Tower 1",
    "area": "Downtown Dubai",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1900000,
    "priceMax": 1900000,
    "avgPricePerSqft": 2173,
    "lat": 25.194985,
    "lng": 55.278414
  },
  {
    "ref": "pf-downtown-dubai-zanzebeel-2",
    "developerRef": "dev-independent-developer",
    "name": "Zanzebeel 2",
    "area": "Downtown Dubai",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 4500000,
    "priceMax": 4500000,
    "avgPricePerSqft": 1803,
    "lat": 25.194985,
    "lng": 55.278414
  },
  {
    "ref": "pf-downtown-dubai-damac-maison-the-distinction",
    "developerRef": "dev-damac-properties",
    "name": "Damac Maison The Distinction",
    "area": "Downtown Dubai",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2000000,
    "priceMax": 2000000,
    "avgPricePerSqft": 1615,
    "lat": 25.194985,
    "lng": 55.278414
  },
  {
    "ref": "pf-downtown-dubai-elegance-tower",
    "developerRef": "dev-independent-developer",
    "name": "Elegance Tower",
    "area": "Downtown Dubai",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2180000,
    "priceMax": 2180000,
    "avgPricePerSqft": 2674,
    "lat": 25.194985,
    "lng": 55.278414
  },
  {
    "ref": "pf-business-bay-royal-regency-suites-tower-two",
    "developerRef": "dev-kerzner-international",
    "name": "Royal Regency Suites Tower Two",
    "area": "Business Bay",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2035825,
    "priceMax": 2035825,
    "avgPricePerSqft": 1821,
    "lat": 25.18739,
    "lng": 55.263829
  },
  {
    "ref": "pf-business-bay-peninsula-four",
    "developerRef": "dev-independent-developer",
    "name": "Peninsula Four",
    "area": "Business Bay",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1150000,
    "priceMax": 3536000,
    "avgPricePerSqft": 2401,
    "lat": 25.18739,
    "lng": 55.263829
  },
  {
    "ref": "pf-business-bay-dg1",
    "developerRef": "dev-damac-properties",
    "name": "DG1",
    "area": "Business Bay",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2700000,
    "priceMax": 2700000,
    "avgPricePerSqft": 2631,
    "lat": 25.18739,
    "lng": 55.263829
  },
  {
    "ref": "pf-business-bay-meera",
    "developerRef": "dev-independent-developer",
    "name": "Meera",
    "area": "Business Bay",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2675000,
    "priceMax": 2675000,
    "avgPricePerSqft": 2094,
    "lat": 25.18739,
    "lng": 55.263829
  },
  {
    "ref": "pf-business-bay-noura-tower",
    "developerRef": "dev-independent-developer",
    "name": "Noura Tower",
    "area": "Business Bay",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2320000,
    "priceMax": 2750000,
    "avgPricePerSqft": 1791,
    "lat": 25.18739,
    "lng": 55.263829
  },
  {
    "ref": "pf-business-bay-business-bay-mall",
    "developerRef": "dev-independent-developer",
    "name": "Business Bay Mall",
    "area": "Business Bay",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2525000,
    "priceMax": 2525000,
    "avgPricePerSqft": 1577,
    "lat": 25.18739,
    "lng": 55.263829
  },
  {
    "ref": "pf-business-bay-tower-b",
    "developerRef": "dev-independent-developer",
    "name": "Tower B",
    "area": "Business Bay",
    "segment": "mid",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1450000,
    "priceMax": 1825000,
    "avgPricePerSqft": 1417,
    "lat": 25.18739,
    "lng": 55.263829
  },
  {
    "ref": "pf-business-bay-binghatti-aquarise",
    "developerRef": "dev-binghatti-developers",
    "name": "Binghatti Aquarise",
    "area": "Business Bay",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1197999,
    "priceMax": 3200000,
    "avgPricePerSqft": 2515,
    "lat": 25.18739,
    "lng": 55.263829
  },
  {
    "ref": "pf-business-bay-capital-bay-tower-b",
    "developerRef": "dev-independent-developer",
    "name": "Capital Bay Tower B",
    "area": "Business Bay",
    "segment": "mid",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 750000,
    "priceMax": 750000,
    "avgPricePerSqft": 1386,
    "lat": 25.18739,
    "lng": 55.263829
  },
  {
    "ref": "pf-business-bay-canal-bay",
    "developerRef": "dev-independent-developer",
    "name": "Canal Bay",
    "area": "Business Bay",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1977000,
    "priceMax": 1977000,
    "avgPricePerSqft": 1778,
    "lat": 25.18739,
    "lng": 55.263829
  },
  {
    "ref": "pf-business-bay-peninsula-three",
    "developerRef": "dev-independent-developer",
    "name": "Peninsula Three",
    "area": "Business Bay",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2100000,
    "priceMax": 2100000,
    "avgPricePerSqft": 3008,
    "lat": 25.18739,
    "lng": 55.263829
  },
  {
    "ref": "pf-business-bay-bayz-101-by-danube",
    "developerRef": "dev-danube-properties",
    "name": "Bayz 101 by Danube",
    "area": "Business Bay",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 3077000,
    "priceMax": 3077000,
    "avgPricePerSqft": 2729,
    "lat": 25.18739,
    "lng": 55.263829
  },
  {
    "ref": "pf-business-bay-one-by-binghatti",
    "developerRef": "dev-binghatti-developers",
    "name": "One By Binghatti",
    "area": "Business Bay",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2175000,
    "priceMax": 4674999,
    "avgPricePerSqft": 2654,
    "lat": 25.18739,
    "lng": 55.263829
  },
  {
    "ref": "pf-business-bay-peninsula-two",
    "developerRef": "dev-independent-developer",
    "name": "Peninsula Two",
    "area": "Business Bay",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1075000,
    "priceMax": 1075000,
    "avgPricePerSqft": 2534,
    "lat": 25.18739,
    "lng": 55.263829
  },
  {
    "ref": "pf-business-bay-the-quayside",
    "developerRef": "dev-independent-developer",
    "name": "The Quayside",
    "area": "Business Bay",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1964828,
    "priceMax": 1964828,
    "avgPricePerSqft": 2537,
    "lat": 25.18739,
    "lng": 55.263829
  },
  {
    "ref": "pf-business-bay-downtown-residences",
    "developerRef": "dev-independent-developer",
    "name": "Downtown Residences",
    "area": "Business Bay",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 3235292,
    "priceMax": 3235292,
    "avgPricePerSqft": 2934,
    "lat": 25.18739,
    "lng": 55.263829
  },
  {
    "ref": "pf-business-bay-binghatti-canal",
    "developerRef": "dev-binghatti-developers",
    "name": "Binghatti Canal",
    "area": "Business Bay",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2300000,
    "priceMax": 2300000,
    "avgPricePerSqft": 1726,
    "lat": 25.18739,
    "lng": 55.263829
  },
  {
    "ref": "pf-business-bay-one-river-point",
    "developerRef": "dev-independent-developer",
    "name": "One River Point",
    "area": "Business Bay",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 5211828,
    "priceMax": 5211828,
    "avgPricePerSqft": 2935,
    "lat": 25.18739,
    "lng": 55.263829
  },
  {
    "ref": "pf-business-bay-upside-living",
    "developerRef": "dev-independent-developer",
    "name": "UPSIDE Living",
    "area": "Business Bay",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1536888,
    "priceMax": 1536888,
    "avgPricePerSqft": 2726,
    "lat": 25.18739,
    "lng": 55.263829
  },
  {
    "ref": "pf-dubai-hills-estate-park-heights-2-tower-1",
    "developerRef": "dev-independent-developer",
    "name": "Park Heights 2 Tower 1",
    "area": "Dubai Hills Estate",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1200000,
    "priceMax": 2060000,
    "avgPricePerSqft": 1885,
    "lat": 25.112958,
    "lng": 55.257113
  },
  {
    "ref": "pf-dubai-hills-estate-greenside-residence-tower-a",
    "developerRef": "dev-independent-developer",
    "name": "Greenside Residence Tower A",
    "area": "Dubai Hills Estate",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1604888,
    "priceMax": 1604888,
    "avgPricePerSqft": 2157,
    "lat": 25.112958,
    "lng": 55.257113
  },
  {
    "ref": "pf-dubai-hills-estate-golfville-block-a",
    "developerRef": "dev-independent-developer",
    "name": "Golfville Block A",
    "area": "Dubai Hills Estate",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1580000,
    "priceMax": 1580000,
    "avgPricePerSqft": 2056,
    "lat": 25.112958,
    "lng": 55.257113
  },
  {
    "ref": "pf-dubai-hills-estate-vida-residences-club-point-a",
    "developerRef": "dev-branded-residence-operator",
    "name": "Vida Residences Club Point A",
    "area": "Dubai Hills Estate",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1755888,
    "priceMax": 2945888,
    "avgPricePerSqft": 2467,
    "lat": 25.112958,
    "lng": 55.257113
  },
  {
    "ref": "pf-dubai-hills-estate-the-fairway",
    "developerRef": "dev-branded-residence-operator",
    "name": "The Fairway",
    "area": "Dubai Hills Estate",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 30150000,
    "priceMax": 30150000,
    "avgPricePerSqft": 2633,
    "lat": 25.112958,
    "lng": 55.257113
  },
  {
    "ref": "pf-dubai-hills-estate-executive-residences-1",
    "developerRef": "dev-independent-developer",
    "name": "Executive Residences 1",
    "area": "Dubai Hills Estate",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2200000,
    "priceMax": 2200000,
    "avgPricePerSqft": 2200,
    "lat": 25.112958,
    "lng": 55.257113
  },
  {
    "ref": "pf-dubai-hills-estate-prive-residence",
    "developerRef": "dev-independent-developer",
    "name": "Prive Residence",
    "area": "Dubai Hills Estate",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 900000,
    "priceMax": 1400000,
    "avgPricePerSqft": 2080,
    "lat": 25.112958,
    "lng": 55.257113
  },
  {
    "ref": "pf-dubai-hills-estate-park-lane-3b",
    "developerRef": "dev-independent-developer",
    "name": "Park Lane 3B",
    "area": "Dubai Hills Estate",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1452888,
    "priceMax": 1452888,
    "avgPricePerSqft": 1915,
    "lat": 25.112958,
    "lng": 55.257113
  },
  {
    "ref": "pf-dubai-hills-estate-hillsedge-tower-b",
    "developerRef": "dev-independent-developer",
    "name": "Hillsedge Tower B",
    "area": "Dubai Hills Estate",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1866888,
    "priceMax": 1866888,
    "avgPricePerSqft": 2624,
    "lat": 25.112958,
    "lng": 55.257113
  },
  {
    "ref": "pf-dubai-hills-estate-park-point-building-d",
    "developerRef": "dev-independent-developer",
    "name": "Park Point Building D",
    "area": "Dubai Hills Estate",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1950000,
    "priceMax": 1950000,
    "avgPricePerSqft": 1926,
    "lat": 25.112958,
    "lng": 55.257113
  },
  {
    "ref": "pf-dubai-hills-estate-palace-residences-2",
    "developerRef": "dev-independent-developer",
    "name": "Palace Residences 2",
    "area": "Dubai Hills Estate",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2050000,
    "priceMax": 2050000,
    "avgPricePerSqft": 2743,
    "lat": 25.112958,
    "lng": 55.257113
  },
  {
    "ref": "pf-dubai-hills-estate-park-lane-1b",
    "developerRef": "dev-independent-developer",
    "name": "Park Lane 1B",
    "area": "Dubai Hills Estate",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2467888,
    "priceMax": 2467888,
    "avgPricePerSqft": 2184,
    "lat": 25.112958,
    "lng": 55.257113
  },
  {
    "ref": "pf-dubai-hills-estate-hills-park",
    "developerRef": "dev-independent-developer",
    "name": "Hills Park",
    "area": "Dubai Hills Estate",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1430000,
    "priceMax": 2100000,
    "avgPricePerSqft": 2249,
    "lat": 25.112958,
    "lng": 55.257113
  },
  {
    "ref": "pf-dubai-hills-estate-address-residences-dubai-hills-estate-tower-a",
    "developerRef": "dev-branded-residence-operator",
    "name": "Address Residences Dubai Hills Estate Tower A",
    "area": "Dubai Hills Estate",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1908930,
    "priceMax": 1908930,
    "avgPricePerSqft": 2536,
    "lat": 25.112958,
    "lng": 55.257113
  },
  {
    "ref": "pf-dubai-hills-estate-collective-2-0-tower-b",
    "developerRef": "dev-independent-developer",
    "name": "Collective 2.0 Tower B",
    "area": "Dubai Hills Estate",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1060000,
    "priceMax": 1060000,
    "avgPricePerSqft": 2139,
    "lat": 25.112958,
    "lng": 55.257113
  },
  {
    "ref": "pf-dubai-hills-estate-golf-hillside",
    "developerRef": "dev-independent-developer",
    "name": "Golf Hillside",
    "area": "Dubai Hills Estate",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 3026888,
    "priceMax": 3026888,
    "avgPricePerSqft": 1610,
    "lat": 25.112958,
    "lng": 55.257113
  },
  {
    "ref": "pf-dubai-hills-estate-park-horizon-tower-1",
    "developerRef": "dev-independent-developer",
    "name": "Park Horizon Tower 1",
    "area": "Dubai Hills Estate",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1500000,
    "priceMax": 1500000,
    "avgPricePerSqft": 2025,
    "lat": 25.112958,
    "lng": 55.257113
  },
  {
    "ref": "pf-dubai-hills-estate-parkwood-tower-a",
    "developerRef": "dev-independent-developer",
    "name": "Parkwood Tower A",
    "area": "Dubai Hills Estate",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 4583888,
    "priceMax": 4583888,
    "avgPricePerSqft": 2538,
    "lat": 25.112958,
    "lng": 55.257113
  },
  {
    "ref": "pf-dubai-hills-estate-elvira-2",
    "developerRef": "dev-independent-developer",
    "name": "Elvira 2",
    "area": "Dubai Hills Estate",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1799888,
    "priceMax": 1799888,
    "avgPricePerSqft": 2563,
    "lat": 25.112958,
    "lng": 55.257113
  },
  {
    "ref": "pf-dubai-hills-estate-socio-at-dubai-hills-estate-tower-2",
    "developerRef": "dev-independent-developer",
    "name": "Socio at Dubai Hills Estate Tower 2",
    "area": "Dubai Hills Estate",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1080000,
    "priceMax": 1080000,
    "avgPricePerSqft": 2228,
    "lat": 25.112958,
    "lng": 55.257113
  },
  {
    "ref": "pf-dubai-hills-estate-399-hills-park-b",
    "developerRef": "dev-independent-developer",
    "name": "399 Hills Park B",
    "area": "Dubai Hills Estate",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2010000,
    "priceMax": 2010000,
    "avgPricePerSqft": 2131,
    "lat": 25.112958,
    "lng": 55.257113
  },
  {
    "ref": "pf-dubai-hills-estate-golf-grand",
    "developerRef": "dev-independent-developer",
    "name": "Golf Grand",
    "area": "Dubai Hills Estate",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2100000,
    "priceMax": 2100000,
    "avgPricePerSqft": 1817,
    "lat": 25.112958,
    "lng": 55.257113
  },
  {
    "ref": "pf-dubai-hills-estate-parkside-hills",
    "developerRef": "dev-independent-developer",
    "name": "Parkside Hills",
    "area": "Dubai Hills Estate",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2242888,
    "priceMax": 2242888,
    "avgPricePerSqft": 2095,
    "lat": 25.112958,
    "lng": 55.257113
  },
  {
    "ref": "pf-jumeirah-village-circle-azizi-ruby",
    "developerRef": "dev-azizi-developments",
    "name": "Azizi Ruby",
    "area": "Jumeirah Village Circle",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 659300,
    "priceMax": 1543410,
    "avgPricePerSqft": 1649,
    "lat": 25.056388,
    "lng": 55.208121
  },
  {
    "ref": "pf-jumeirah-village-circle-q-gardens-lofts",
    "developerRef": "dev-independent-developer",
    "name": "Q Gardens Lofts",
    "area": "Jumeirah Village Circle",
    "segment": "mid",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 510175,
    "priceMax": 510175,
    "avgPricePerSqft": 1099,
    "lat": 25.056388,
    "lng": 55.208121
  },
  {
    "ref": "pf-jumeirah-village-circle-binghatti-apex",
    "developerRef": "dev-binghatti-developers",
    "name": "Binghatti Apex",
    "area": "Jumeirah Village Circle",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 809099.07,
    "priceMax": 1599999,
    "avgPricePerSqft": 1915,
    "lat": 25.056388,
    "lng": 55.208121
  },
  {
    "ref": "pf-jumeirah-village-circle-maison-elysee-2",
    "developerRef": "dev-independent-developer",
    "name": "Maison Elysee 2",
    "area": "Jumeirah Village Circle",
    "segment": "mid",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 980407.5,
    "priceMax": 980407.5,
    "avgPricePerSqft": 1457,
    "lat": 25.056388,
    "lng": 55.208121
  },
  {
    "ref": "pf-jumeirah-village-circle-squarex-residence",
    "developerRef": "dev-independent-developer",
    "name": "SquareX Residence",
    "area": "Jumeirah Village Circle",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 670015.68,
    "priceMax": 670015.68,
    "avgPricePerSqft": 1592,
    "lat": 25.056388,
    "lng": 55.208121
  },
  {
    "ref": "pf-jumeirah-village-circle-casa-vista-residence-by-golden-woods",
    "developerRef": "dev-independent-developer",
    "name": "Casa Vista Residence by Golden Woods",
    "area": "Jumeirah Village Circle",
    "segment": "mid",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 714510,
    "priceMax": 838940,
    "avgPricePerSqft": 1004,
    "lat": 25.056388,
    "lng": 55.208121
  },
  {
    "ref": "pf-jumeirah-village-circle-the-haven-gardens",
    "developerRef": "dev-independent-developer",
    "name": "The Haven Gardens",
    "area": "Jumeirah Village Circle",
    "segment": "mid",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1650000,
    "priceMax": 1650000,
    "avgPricePerSqft": 1208,
    "lat": 25.056388,
    "lng": 55.208121
  },
  {
    "ref": "pf-jumeirah-village-circle-chaimaa-avenue-2",
    "developerRef": "dev-independent-developer",
    "name": "Chaimaa Avenue 2",
    "area": "Jumeirah Village Circle",
    "segment": "mid",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1580000,
    "priceMax": 1580000,
    "avgPricePerSqft": 1046,
    "lat": 25.056388,
    "lng": 55.208121
  },
  {
    "ref": "pf-jumeirah-village-circle-binghatti-phantom",
    "developerRef": "dev-binghatti-developers",
    "name": "Binghatti Phantom",
    "area": "Jumeirah Village Circle",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1835000,
    "priceMax": 1835000,
    "avgPricePerSqft": 2012,
    "lat": 25.056388,
    "lng": 55.208121
  },
  {
    "ref": "pf-jumeirah-village-circle-skyhills-residences-2",
    "developerRef": "dev-independent-developer",
    "name": "Skyhills Residences 2",
    "area": "Jumeirah Village Circle",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 692735,
    "priceMax": 1279087.31,
    "avgPricePerSqft": 1564,
    "lat": 25.056388,
    "lng": 55.208121
  },
  {
    "ref": "pf-jumeirah-village-circle-xanadu-residence-2",
    "developerRef": "dev-independent-developer",
    "name": "Xanadu Residence 2",
    "area": "Jumeirah Village Circle",
    "segment": "mid",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1600000,
    "priceMax": 1600000,
    "avgPricePerSqft": 1157,
    "lat": 25.056388,
    "lng": 55.208121
  },
  {
    "ref": "pf-jumeirah-village-circle-fortunato",
    "developerRef": "dev-independent-developer",
    "name": "Fortunato",
    "area": "Jumeirah Village Circle",
    "segment": "mid",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 780000,
    "priceMax": 780000,
    "avgPricePerSqft": 922,
    "lat": 25.056388,
    "lng": 55.208121
  },
  {
    "ref": "pf-jumeirah-village-circle-gardenia-1",
    "developerRef": "dev-independent-developer",
    "name": "Gardenia 1",
    "area": "Jumeirah Village Circle",
    "segment": "mid",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 842823,
    "priceMax": 842823,
    "avgPricePerSqft": 738,
    "lat": 25.056388,
    "lng": 55.208121
  },
  {
    "ref": "pf-jumeirah-village-circle-skyhills-residences-3",
    "developerRef": "dev-independent-developer",
    "name": "Skyhills Residences 3",
    "area": "Jumeirah Village Circle",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1658606.88,
    "priceMax": 1658606.88,
    "avgPricePerSqft": 1596,
    "lat": 25.056388,
    "lng": 55.208121
  },
  {
    "ref": "pf-jumeirah-village-circle-squarex-one",
    "developerRef": "dev-independent-developer",
    "name": "SquareX One",
    "area": "Jumeirah Village Circle",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 690000,
    "priceMax": 690000,
    "avgPricePerSqft": 1840,
    "lat": 25.056388,
    "lng": 55.208121
  },
  {
    "ref": "pf-jumeirah-village-circle-binghatti-amberhall",
    "developerRef": "dev-binghatti-developers",
    "name": "Binghatti Amberhall",
    "area": "Jumeirah Village Circle",
    "segment": "mid",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1259999,
    "priceMax": 1259999,
    "avgPricePerSqft": 1482,
    "lat": 25.056388,
    "lng": 55.208121
  },
  {
    "ref": "pf-jumeirah-village-circle-serenz-by-danube-tower-b",
    "developerRef": "dev-danube-properties",
    "name": "Serenz by Danube Tower B",
    "area": "Jumeirah Village Circle",
    "segment": "luxury",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 946560,
    "priceMax": 946560,
    "avgPricePerSqft": 2213,
    "lat": 25.056388,
    "lng": 55.208121
  },
  {
    "ref": "pf-jumeirah-village-circle-stonehenge-residence",
    "developerRef": "dev-independent-developer",
    "name": "Stonehenge Residence",
    "area": "Jumeirah Village Circle",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 710000,
    "priceMax": 710000,
    "avgPricePerSqft": 1590,
    "lat": 25.056388,
    "lng": 55.208121
  },
  {
    "ref": "pf-jumeirah-village-circle-binghatti-circle",
    "developerRef": "dev-binghatti-developers",
    "name": "Binghatti Circle",
    "area": "Jumeirah Village Circle",
    "segment": "premium",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 709999,
    "priceMax": 709999,
    "avgPricePerSqft": 1754,
    "lat": 25.056388,
    "lng": 55.208121
  },
  {
    "ref": "pf-jumeirah-village-circle-binghatti-corner",
    "developerRef": "dev-binghatti-developers",
    "name": "Binghatti Corner",
    "area": "Jumeirah Village Circle",
    "segment": "mid",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 1300000,
    "priceMax": 1300000,
    "avgPricePerSqft": 1038,
    "lat": 25.056388,
    "lng": 55.208121
  },
  {
    "ref": "pf-jumeirah-village-circle-belgravia-3b",
    "developerRef": "dev-ellington-properties",
    "name": "Belgravia 3B",
    "area": "Jumeirah Village Circle",
    "segment": "mid",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 2425000,
    "priceMax": 2425000,
    "avgPricePerSqft": 1202,
    "lat": 25.056388,
    "lng": 55.208121
  },
  {
    "ref": "pf-jumeirah-village-circle-the-orchard-place-tower-b",
    "developerRef": "dev-independent-developer",
    "name": "The Orchard Place Tower B",
    "area": "Jumeirah Village Circle",
    "segment": "mid",
    "unitTypes": [
      "apartment"
    ],
    "priceMin": 4687500,
    "priceMax": 4687500,
    "avgPricePerSqft": 1499,
    "lat": 25.056388,
    "lng": 55.208121
  }
];

export const DEMO_TRANSACTIONS: DemoTransaction[] = [
  {
    "sourceRef": "pf-txn-1601834333acc6ec2502f7a661375d59",
    "projectSourceRef": "pf-palm-jumeirah-bella",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 119.7,
    "bedrooms": 2,
    "priceAed": 6552280,
    "pricePerSqft": 5083,
    "buyerSegment": "HNW individual",
    "buyerNationality": "United Arab Emirates"
  },
  {
    "sourceRef": "pf-txn-bd49249e2fea263be47b104e40bee01b",
    "projectSourceRef": "pf-palm-jumeirah-bella",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 119.7,
    "bedrooms": 2,
    "priceAed": 6418560,
    "pricePerSqft": 4980,
    "buyerSegment": "HNW individual",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-09257391211d942378c50a348033e4de",
    "projectSourceRef": "pf-palm-jumeirah-bella",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-10",
    "unitType": "apartment",
    "areaSqm": 168.9,
    "bedrooms": 3,
    "priceAed": 12600000,
    "pricePerSqft": 6930,
    "buyerSegment": "Golden visa holder",
    "buyerNationality": "United Kingdom"
  },
  {
    "sourceRef": "pf-txn-3a83039230d47a487a3e923fe5fb6be4",
    "projectSourceRef": "pf-palm-jumeirah-bella",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-10",
    "unitType": "apartment",
    "areaSqm": 145.9,
    "bedrooms": 2,
    "priceAed": 8802240,
    "pricePerSqft": 5604,
    "buyerSegment": "Family office",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-85875518dbe9f6bcc3628776cb38b68d",
    "projectSourceRef": "pf-palm-jumeirah-bella",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-10",
    "unitType": "apartment",
    "areaSqm": 162.4,
    "bedrooms": 2,
    "priceAed": 8143680,
    "pricePerSqft": 4658,
    "buyerSegment": "Family office",
    "buyerNationality": "Saudi Arabia"
  },
  {
    "sourceRef": "pf-txn-459674486ae690ea56890c4d031aeeff",
    "projectSourceRef": "pf-palm-jumeirah-the-alba-residences-by-omniyat-building-1",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 260.4,
    "bedrooms": 3,
    "priceAed": 21872266,
    "pricePerSqft": 7802,
    "buyerSegment": "Golden visa holder",
    "buyerNationality": "United Kingdom"
  },
  {
    "sourceRef": "pf-txn-adae4dc8a6caaccfa1d78cfa9c8164e2",
    "projectSourceRef": "pf-palm-jumeirah-the-alba-residences-by-omniyat-building-1",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 189.7,
    "bedrooms": 2,
    "priceAed": 16361144,
    "pricePerSqft": 8014,
    "buyerSegment": "Golden visa holder",
    "buyerNationality": "United Kingdom"
  },
  {
    "sourceRef": "pf-txn-aff09f518b7d575a9909a3775aa03408",
    "projectSourceRef": "pf-palm-jumeirah-the-alba-residences-by-omniyat-building-1",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 753.1,
    "bedrooms": 4,
    "priceAed": 73957500,
    "pricePerSqft": 9123,
    "buyerSegment": "International investor",
    "buyerNationality": "United Arab Emirates"
  },
  {
    "sourceRef": "pf-txn-f89a85187437aed32d91b53ae41a0434",
    "projectSourceRef": "pf-palm-jumeirah-the-alba-residences-by-omniyat-building-1",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 191.3,
    "bedrooms": 2,
    "priceAed": 16361144,
    "pricePerSqft": 7946,
    "buyerSegment": "Golden visa holder",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-abeacbaa1e9b7570c69b28634a673459",
    "projectSourceRef": "pf-palm-jumeirah-the-alba-residences-by-omniyat-building-1",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-17",
    "unitType": "apartment",
    "areaSqm": 242.9,
    "bedrooms": 3,
    "priceAed": 21097264,
    "pricePerSqft": 8069,
    "buyerSegment": "International investor",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-2a620f93edd3fd90d2001f8dc28cfda8",
    "projectSourceRef": "pf-palm-jumeirah-the-alba-residences-by-omniyat-building-1",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-12",
    "unitType": "apartment",
    "areaSqm": 193.7,
    "bedrooms": 2,
    "priceAed": 16361144,
    "pricePerSqft": 7846,
    "buyerSegment": "HNW individual",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-4fe8d1ba202cec7e0d78934b23d47c46",
    "projectSourceRef": "pf-palm-jumeirah-al-shahla",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 106.3,
    "bedrooms": 1,
    "priceAed": 2480000,
    "pricePerSqft": 2167,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "United Kingdom"
  },
  {
    "sourceRef": "pf-txn-5f4ace380bc4c0293d0813de1662acdb",
    "projectSourceRef": "pf-palm-jumeirah-avita",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 82.7,
    "bedrooms": 1,
    "priceAed": 5810000,
    "pricePerSqft": 6526,
    "buyerSegment": "Family office",
    "buyerNationality": "United Arab Emirates"
  },
  {
    "sourceRef": "pf-txn-a993b23dad238fa7149050fea62a2a58",
    "projectSourceRef": "pf-palm-jumeirah-avita",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 228.6,
    "bedrooms": 3,
    "priceAed": 16907940,
    "pricePerSqft": 6871,
    "buyerSegment": "HNW individual",
    "buyerNationality": "United Arab Emirates"
  },
  {
    "sourceRef": "pf-txn-196b950c629192fe5bdfa5e4fe83a241",
    "projectSourceRef": "pf-palm-jumeirah-avita",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-09",
    "unitType": "apartment",
    "areaSqm": 201.7,
    "bedrooms": 3,
    "priceAed": 12625140,
    "pricePerSqft": 5815,
    "buyerSegment": "HNW individual",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-607c0a54eaa616f7758481bbd61fab0f",
    "projectSourceRef": "pf-palm-jumeirah-serenia-living-tower-3",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 595.2,
    "bedrooms": 4,
    "priceAed": 22426000,
    "pricePerSqft": 3500,
    "buyerSegment": "HNW individual",
    "buyerNationality": "United Kingdom"
  },
  {
    "sourceRef": "pf-txn-353d6525252987641636a9ea72124a1a",
    "projectSourceRef": "pf-palm-jumeirah-the-fairmont-palm-residence-north",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 122.1,
    "bedrooms": 1,
    "priceAed": 2615000,
    "pricePerSqft": 1990,
    "buyerSegment": "End user",
    "buyerNationality": "Saudi Arabia"
  },
  {
    "sourceRef": "pf-txn-1f9524d875a4736bd5d3b1cf1d927c33",
    "projectSourceRef": "pf-palm-jumeirah-palm-beach-towers-2",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-17",
    "unitType": "apartment",
    "areaSqm": 106,
    "bedrooms": 1,
    "priceAed": 3750000,
    "pricePerSqft": 3287,
    "buyerSegment": "End user",
    "buyerNationality": "Saudi Arabia"
  },
  {
    "sourceRef": "pf-txn-5f3b7a4a9c126559f192100545069c1d",
    "projectSourceRef": "pf-palm-jumeirah-al-hamri",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-17",
    "unitType": "apartment",
    "areaSqm": 144.1,
    "bedrooms": 2,
    "priceAed": 3400000,
    "pricePerSqft": 2192,
    "buyerSegment": "End user",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-c9401a10bbefeee072283d0524ebd450",
    "projectSourceRef": "pf-palm-jumeirah-marina-residences-4",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-17",
    "unitType": "apartment",
    "areaSqm": 165.2,
    "bedrooms": 2,
    "priceAed": 4050000,
    "pricePerSqft": 2278,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-cd1e11a6a46baaf273c65494696371f3",
    "projectSourceRef": "pf-palm-jumeirah-seven-palm",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-17",
    "unitType": "apartment",
    "areaSqm": 66.4,
    "bedrooms": 1,
    "priceAed": 1282238,
    "pricePerSqft": 1793,
    "buyerSegment": "International investor",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-033b9b809a14b1a5effe71dcf68d54b0",
    "projectSourceRef": "pf-palm-jumeirah-seven-palm",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-10",
    "unitType": "apartment",
    "areaSqm": 31.3,
    "bedrooms": 0,
    "priceAed": 1480000,
    "pricePerSqft": 4398,
    "buyerSegment": "End user",
    "buyerNationality": "United Arab Emirates"
  },
  {
    "sourceRef": "pf-txn-4b09519ec634e540720b7d853ecf18fd",
    "projectSourceRef": "pf-palm-jumeirah-royal-amwaj-residences-south",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 162,
    "bedrooms": 2,
    "priceAed": 3950000,
    "pricePerSqft": 2266,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-5d8280bfbef1b7708b32597fbf634927",
    "projectSourceRef": "pf-palm-jumeirah-abu-keibal",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 206.1,
    "bedrooms": 3,
    "priceAed": 4800000,
    "pricePerSqft": 2164,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "United Arab Emirates"
  },
  {
    "sourceRef": "pf-txn-d483c40dbab7236127c55213838a4ef3",
    "projectSourceRef": "pf-palm-jumeirah-the-fairmont-palm-residence-south",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-12",
    "unitType": "apartment",
    "areaSqm": 120,
    "bedrooms": 1,
    "priceAed": 2575000,
    "pricePerSqft": 1993,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "Saudi Arabia"
  },
  {
    "sourceRef": "pf-txn-860dc679b0ef3a52e046ffb2601d0532",
    "projectSourceRef": "pf-palm-jumeirah-al-hatimi",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-11",
    "unitType": "apartment",
    "areaSqm": 486.4,
    "bedrooms": 4,
    "priceAed": 10300000,
    "pricePerSqft": 1967,
    "buyerSegment": "International investor",
    "buyerNationality": "Saudi Arabia"
  },
  {
    "sourceRef": "pf-txn-c08c0fd800e1a6ec52d752f515558694",
    "projectSourceRef": "pf-palm-jumeirah-oceana-atlantic",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-11",
    "unitType": "apartment",
    "areaSqm": 211.8,
    "bedrooms": 3,
    "priceAed": 7360000,
    "pricePerSqft": 3228,
    "buyerSegment": "End user",
    "buyerNationality": "United Kingdom"
  },
  {
    "sourceRef": "pf-txn-8519b748facee9c5cac513ab6549e9d1",
    "projectSourceRef": "pf-palm-jumeirah-serenia-residences-west",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-10",
    "unitType": "apartment",
    "areaSqm": 165.5,
    "bedrooms": 2,
    "priceAed": 6600000,
    "pricePerSqft": 3705,
    "buyerSegment": "HNW individual",
    "buyerNationality": "Saudi Arabia"
  },
  {
    "sourceRef": "pf-txn-77caf2ba35e6755f7d9356acd6e69ed6",
    "projectSourceRef": "pf-palm-jumeirah-como-residences",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-09",
    "unitType": "apartment",
    "areaSqm": 859,
    "bedrooms": 4,
    "priceAed": 41000000,
    "pricePerSqft": 4434,
    "buyerSegment": "Golden visa holder",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-9773dbe5fb9e32c44ee291e4721c2d68",
    "projectSourceRef": "pf-palm-jumeirah-marina-residences-3",
    "communityName": "Palm Jumeirah",
    "areaName": "Palm Jumeirah",
    "txnType": "sale",
    "txnDate": "2026-06-09",
    "unitType": "apartment",
    "areaSqm": 162.2,
    "bedrooms": 2,
    "priceAed": 3850000,
    "pricePerSqft": 2205,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-790571932b62649ac291884998b65cb2",
    "projectSourceRef": "pf-dubai-marina-time-place-tower",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-20",
    "unitType": "apartment",
    "areaSqm": 81.7,
    "bedrooms": 1,
    "priceAed": 1420075,
    "pricePerSqft": 1614,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-ea14e46e9848517ab156fd7b92c5e007",
    "projectSourceRef": "pf-dubai-marina-sanibel-tower",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-20",
    "unitType": "apartment",
    "areaSqm": 84.4,
    "bedrooms": 1,
    "priceAed": 1880000,
    "pricePerSqft": 2068,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "United Kingdom"
  },
  {
    "sourceRef": "pf-txn-178c04fe83810b027d1f55340cfbee04",
    "projectSourceRef": "pf-dubai-marina-marina-heights",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 93.9,
    "bedrooms": 1,
    "priceAed": 1300000,
    "pricePerSqft": 1286,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "United Kingdom"
  },
  {
    "sourceRef": "pf-txn-30ea0f6bca1f9e49b2d3ceb335dacae4",
    "projectSourceRef": "pf-dubai-marina-liv-lux",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 143.5,
    "bedrooms": 2,
    "priceAed": 4057157,
    "pricePerSqft": 2627,
    "buyerSegment": "Golden visa holder",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-47532fb8fadd154f7fa074722525365b",
    "projectSourceRef": "pf-dubai-marina-botanica-tower",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 112.2,
    "bedrooms": 2,
    "priceAed": 2050000,
    "pricePerSqft": 1697,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-7b8efdbb224269342382d8737cdda05c",
    "projectSourceRef": "pf-dubai-marina-damac-heights",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 115.3,
    "bedrooms": 2,
    "priceAed": 2860000,
    "pricePerSqft": 2304,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-265dac8fc61bdb2289b21cfd09ce962a",
    "projectSourceRef": "pf-dubai-marina-damac-heights",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 136.9,
    "bedrooms": 2,
    "priceAed": 2800000,
    "pricePerSqft": 1900,
    "buyerSegment": "International investor",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-aafa2c57c9fec22aad5e3ea8381d1dde",
    "projectSourceRef": "pf-dubai-marina-5242-tower-1",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 104.3,
    "bedrooms": 2,
    "priceAed": 3420000,
    "pricePerSqft": 3047,
    "buyerSegment": "International investor",
    "buyerNationality": "Saudi Arabia"
  },
  {
    "sourceRef": "pf-txn-167052441dafe90a4bcf7019052b3041",
    "projectSourceRef": "pf-dubai-marina-5242-tower-1",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-17",
    "unitType": "apartment",
    "areaSqm": 105.4,
    "bedrooms": 2,
    "priceAed": 2800000,
    "pricePerSqft": 2467,
    "buyerSegment": "Golden visa holder",
    "buyerNationality": "United Arab Emirates"
  },
  {
    "sourceRef": "pf-txn-b1adbfa95636a54bd44c9c7a06570660",
    "projectSourceRef": "pf-dubai-marina-al-habtoor-grand-resort-autograph-collection",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 213.1,
    "bedrooms": 2,
    "priceAed": 10781668,
    "pricePerSqft": 4700,
    "buyerSegment": "HNW individual",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-d98798058d62b04ac35bfbc28b370a40",
    "projectSourceRef": "pf-dubai-marina-the-torch",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 75.1,
    "bedrooms": 1,
    "priceAed": 1250000,
    "pricePerSqft": 1547,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "United Arab Emirates"
  },
  {
    "sourceRef": "pf-txn-011133854f3941fe1e743227dc9941f4",
    "projectSourceRef": "pf-dubai-marina-sparkle-tower-2",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 38.3,
    "bedrooms": 0,
    "priceAed": 1070000,
    "pricePerSqft": 2593,
    "buyerSegment": "International investor",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-395234b99ec44a07c49d5769521d4cf2",
    "projectSourceRef": "pf-dubai-marina-marina-diamond-3",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 67.5,
    "bedrooms": 1,
    "priceAed": 1011360,
    "pricePerSqft": 1391,
    "buyerSegment": "End user",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-7e7654b1f1021a23ec175747121334f8",
    "projectSourceRef": "pf-dubai-marina-residences-du-port",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 116.5,
    "bedrooms": 2,
    "priceAed": 3850000,
    "pricePerSqft": 3069,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-846312d5e7448f5ce3f473300436a1dd",
    "projectSourceRef": "pf-dubai-marina-jumeirah-living-marina-gate",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 87.7,
    "bedrooms": 1,
    "priceAed": 2115000,
    "pricePerSqft": 2239,
    "buyerSegment": "International investor",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-b7ece5f3bc7fe550d0db2eadca290d8b",
    "projectSourceRef": "pf-dubai-marina-opal-tower-marina",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 98.9,
    "bedrooms": 1,
    "priceAed": 1230000,
    "pricePerSqft": 1156,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-13a3055079952441d3db9705bff62a3f",
    "projectSourceRef": "pf-dubai-marina-opal-tower-marina",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 98.9,
    "bedrooms": 1,
    "priceAed": 1292643,
    "pricePerSqft": 1215,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-b8c16449dee3541ffa853739efd06bf0",
    "projectSourceRef": "pf-dubai-marina-marina-diamond-6",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 100.7,
    "bedrooms": 2,
    "priceAed": 1250000,
    "pricePerSqft": 1153,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "United Kingdom"
  },
  {
    "sourceRef": "pf-txn-29a82eca80a132967ac1aec99724dc57",
    "projectSourceRef": "pf-dubai-marina-the-point",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-17",
    "unitType": "apartment",
    "areaSqm": 70.6,
    "bedrooms": 1,
    "priceAed": 1500000,
    "pricePerSqft": 1975,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-329e0add38a8d19cb4cf40bd81e70fb1",
    "projectSourceRef": "pf-dubai-marina-marina-pinnacle",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-17",
    "unitType": "apartment",
    "areaSqm": 145.5,
    "bedrooms": 3,
    "priceAed": 1800000,
    "pricePerSqft": 1149,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-09084a4590148c6e38441495811b5f23",
    "projectSourceRef": "pf-dubai-marina-marinascape-avant",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 201.4,
    "bedrooms": 3,
    "priceAed": 4750000,
    "pricePerSqft": 2191,
    "buyerSegment": "International investor",
    "buyerNationality": "Saudi Arabia"
  },
  {
    "sourceRef": "pf-txn-41c68bd6e2540c89d8cf8ad1c38e31ce",
    "projectSourceRef": "pf-dubai-marina-zumurud-tower",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 39.8,
    "bedrooms": 0,
    "priceAed": 780000,
    "pricePerSqft": 1818,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "United Arab Emirates"
  },
  {
    "sourceRef": "pf-txn-53f43a4debb88f1d9101d8438a0c03fb",
    "projectSourceRef": "pf-dubai-marina-elite-residence",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 89.2,
    "bedrooms": 1,
    "priceAed": 1350000,
    "pricePerSqft": 1406,
    "buyerSegment": "End user",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-5ba417e3747d23c060e283666735e333",
    "projectSourceRef": "pf-dubai-marina-marina-crown",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 201.9,
    "bedrooms": 3,
    "priceAed": 3300000,
    "pricePerSqft": 1518,
    "buyerSegment": "International investor",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-68c07cfdb35ed9d5dfc5f634d4237c9b",
    "projectSourceRef": "pf-dubai-marina-skyview-tower",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 72.7,
    "bedrooms": 1,
    "priceAed": 1150000,
    "pricePerSqft": 1470,
    "buyerSegment": "End user",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-948bd095df519c12531d2f99fe1cdb22",
    "projectSourceRef": "pf-dubai-marina-marina-gate-1",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 169.2,
    "bedrooms": 3,
    "priceAed": 5100000,
    "pricePerSqft": 2800,
    "buyerSegment": "International investor",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-f63e6818b05b2aa7ed828cad91deb475",
    "projectSourceRef": "pf-dubai-marina-marina-quays-west",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 73.2,
    "bedrooms": 1,
    "priceAed": 1725000,
    "pricePerSqft": 2189,
    "buyerSegment": "International investor",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-c5fdc28df5722ed53db9197e43acfe55",
    "projectSourceRef": "pf-dubai-marina-almass",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-13",
    "unitType": "apartment",
    "areaSqm": 377,
    "bedrooms": 3,
    "priceAed": 8159353,
    "pricePerSqft": 2011,
    "buyerSegment": "International investor",
    "buyerNationality": "Saudi Arabia"
  },
  {
    "sourceRef": "pf-txn-107740ea719bca0609452429a9b15ee0",
    "projectSourceRef": "pf-dubai-marina-al-fairooz-tower",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-12",
    "unitType": "apartment",
    "areaSqm": 401.9,
    "bedrooms": 3,
    "priceAed": 12100000,
    "pricePerSqft": 2797,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-4539d6f7348a00d54efa760e95316ccf",
    "projectSourceRef": "pf-dubai-marina-23-marina",
    "communityName": "Dubai Marina",
    "areaName": "Dubai Marina",
    "txnType": "sale",
    "txnDate": "2026-06-12",
    "unitType": "apartment",
    "areaSqm": 150.2,
    "bedrooms": 2,
    "priceAed": 3250000,
    "pricePerSqft": 2010,
    "buyerSegment": "End user",
    "buyerNationality": "United Arab Emirates"
  },
  {
    "sourceRef": "pf-txn-4d4d476aa0ba7f1c12d0bb3f63cf6094",
    "projectSourceRef": "pf-downtown-dubai-the-st-regis-residences-tower-1",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 115.8,
    "bedrooms": 2,
    "priceAed": 3490000,
    "pricePerSqft": 2800,
    "buyerSegment": "HNW individual",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-4feaf49ec56707380563d36e0ce79a55",
    "projectSourceRef": "pf-downtown-dubai-bellevue-tower-1",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 81.4,
    "bedrooms": 1,
    "priceAed": 1500000,
    "pricePerSqft": 1711,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "United Kingdom"
  },
  {
    "sourceRef": "pf-txn-73ae3f289e5a9ee2e82ea56156605c41",
    "projectSourceRef": "pf-downtown-dubai-bellevue-tower-1",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 95.1,
    "bedrooms": 2,
    "priceAed": 2200000,
    "pricePerSqft": 2148,
    "buyerSegment": "International investor",
    "buyerNationality": "United Kingdom"
  },
  {
    "sourceRef": "pf-txn-7741b3233ccd79791db182b9d1004784",
    "projectSourceRef": "pf-downtown-dubai-boulevard-central-tower-1",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 108,
    "bedrooms": 2,
    "priceAed": 2750000,
    "pricePerSqft": 2365,
    "buyerSegment": "HNW individual",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-d147890bdf1eb14882de2a64c71f08a2",
    "projectSourceRef": "pf-downtown-dubai-tajer-residences",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 89,
    "bedrooms": 1,
    "priceAed": 2500000,
    "pricePerSqft": 2610,
    "buyerSegment": "End user",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-22626c0edd279da7577c78784fbf1c8b",
    "projectSourceRef": "pf-downtown-dubai-burj-royale",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 89.1,
    "bedrooms": 2,
    "priceAed": 3750000,
    "pricePerSqft": 3911,
    "buyerSegment": "International investor",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-232f5208e3224d8b52cea1b1ceb193e4",
    "projectSourceRef": "pf-downtown-dubai-burj-khalifa",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 102.5,
    "bedrooms": 1,
    "priceAed": 2650000,
    "pricePerSqft": 2403,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-103d690e75342ecf8088041ae26ea785",
    "projectSourceRef": "pf-downtown-dubai-burj-khalifa",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-13",
    "unitType": "apartment",
    "areaSqm": 102.5,
    "bedrooms": 1,
    "priceAed": 2900000,
    "pricePerSqft": 2629,
    "buyerSegment": "Golden visa holder",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-4dc15e525d4e74cb8109f8db3a047835",
    "projectSourceRef": "pf-downtown-dubai-blvd-heights-tower-1",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 82.8,
    "bedrooms": 1,
    "priceAed": 2200000,
    "pricePerSqft": 2468,
    "buyerSegment": "International investor",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-79014cb9e2e3a632f9bdcac482cea10e",
    "projectSourceRef": "pf-downtown-dubai-city-center-residences",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 73.3,
    "bedrooms": 1,
    "priceAed": 1607583,
    "pricePerSqft": 2038,
    "buyerSegment": "International investor",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-8ebfd67c60d5806fb1bb8ec6c7da3c45",
    "projectSourceRef": "pf-downtown-dubai-city-center-residences",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-17",
    "unitType": "apartment",
    "areaSqm": 73.1,
    "bedrooms": 1,
    "priceAed": 1854023,
    "pricePerSqft": 2357,
    "buyerSegment": "End user",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-5f8d0308a0c12f288f026ee8edcd96d0",
    "projectSourceRef": "pf-downtown-dubai-city-center-residences",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 136,
    "bedrooms": 3,
    "priceAed": 4650000,
    "pricePerSqft": 3177,
    "buyerSegment": "HNW individual",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-9886b621b5b218d07bfde36392fc8245",
    "projectSourceRef": "pf-downtown-dubai-fairmont-residences-solara-tower",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 238.1,
    "bedrooms": 3,
    "priceAed": 10679000,
    "pricePerSqft": 4166,
    "buyerSegment": "HNW individual",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-ab6b360c7144ae7f1f48f287c875a1f7",
    "projectSourceRef": "pf-downtown-dubai-society-house",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 79.9,
    "bedrooms": 1,
    "priceAed": 2381961,
    "pricePerSqft": 2770,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-d7c11ef89d0126ead568f03f94a1c053",
    "projectSourceRef": "pf-downtown-dubai-the-lofts-west",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 82.1,
    "bedrooms": 1,
    "priceAed": 1735000,
    "pricePerSqft": 1962,
    "buyerSegment": "International investor",
    "buyerNationality": "United Kingdom"
  },
  {
    "sourceRef": "pf-txn-4420ca4ade12a4eb44d241184ef9eb8c",
    "projectSourceRef": "pf-downtown-dubai-standpoint-tower-1",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-17",
    "unitType": "apartment",
    "areaSqm": 78.1,
    "bedrooms": 1,
    "priceAed": 1500000,
    "pricePerSqft": 1784,
    "buyerSegment": "International investor",
    "buyerNationality": "United Arab Emirates"
  },
  {
    "sourceRef": "pf-txn-48f59d9b2ceb19ab38d67d4bb0fa5d7b",
    "projectSourceRef": "pf-downtown-dubai-the-st-regis-residences-tower-2",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-17",
    "unitType": "apartment",
    "areaSqm": 135,
    "bedrooms": 2,
    "priceAed": 3775000,
    "pricePerSqft": 2598,
    "buyerSegment": "End user",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-4f24f1bb642b08970bdbe495e273dc50",
    "projectSourceRef": "pf-downtown-dubai-south-ridge-4",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-17",
    "unitType": "apartment",
    "areaSqm": 151.9,
    "bedrooms": 2,
    "priceAed": 3500000,
    "pricePerSqft": 2141,
    "buyerSegment": "End user",
    "buyerNationality": "United Arab Emirates"
  },
  {
    "sourceRef": "pf-txn-a362fa4a8ae3fd68448243bc8e02a829",
    "projectSourceRef": "pf-downtown-dubai-south-ridge-4",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-17",
    "unitType": "apartment",
    "areaSqm": 101.2,
    "bedrooms": 1,
    "priceAed": 1800000,
    "pricePerSqft": 1653,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-4b3c9e5b7e893c365aa4ea296c34af8d",
    "projectSourceRef": "pf-downtown-dubai-south-ridge-4",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 90.5,
    "bedrooms": 1,
    "priceAed": 1800000,
    "pricePerSqft": 1848,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "United Arab Emirates"
  },
  {
    "sourceRef": "pf-txn-828d172782ec6e45b010c1b4f49e62b2",
    "projectSourceRef": "pf-downtown-dubai-blvd-heights-tower-2",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-17",
    "unitType": "apartment",
    "areaSqm": 86.3,
    "bedrooms": 1,
    "priceAed": 2150000,
    "pricePerSqft": 2315,
    "buyerSegment": "End user",
    "buyerNationality": "United Kingdom"
  },
  {
    "sourceRef": "pf-txn-b3627b75e3f15056764c4bc714fc1c74",
    "projectSourceRef": "pf-downtown-dubai-mada-residences-by-artar",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-17",
    "unitType": "apartment",
    "areaSqm": 223.7,
    "bedrooms": 3,
    "priceAed": 4300000,
    "pricePerSqft": 1786,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-f4f463e52c7a1a015980a6a9442b83a5",
    "projectSourceRef": "pf-downtown-dubai-baccarat-hotel-and-residences",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-17",
    "unitType": "apartment",
    "areaSqm": 875.7,
    "bedrooms": 5,
    "priceAed": 53000000,
    "pricePerSqft": 5622,
    "buyerSegment": "HNW individual",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-0a0b0e540ea3c386f2f7224801cc7661",
    "projectSourceRef": "pf-downtown-dubai-burj-vista-tower-1",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 153.3,
    "bedrooms": 2,
    "priceAed": 4200000,
    "pricePerSqft": 2545,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-0af395b475218f386b5a161618713124",
    "projectSourceRef": "pf-downtown-dubai-binghatti-skyblade",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 89.8,
    "bedrooms": 1,
    "priceAed": 3669999,
    "pricePerSqft": 3796,
    "buyerSegment": "Family office",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-deeeaedd0c97c232376a889f72922fc2",
    "projectSourceRef": "pf-downtown-dubai-binghatti-skyblade",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 70.7,
    "bedrooms": 1,
    "priceAed": 3254999,
    "pricePerSqft": 4274,
    "buyerSegment": "Family office",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-3e50f7729d0a03a0834b4b0fcd9ad4e8",
    "projectSourceRef": "pf-downtown-dubai-29-burj-boulevard-tower-1",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 81.2,
    "bedrooms": 1,
    "priceAed": 1900000,
    "pricePerSqft": 2173,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-a20ab5f97b65402d0b9fff514675eaa3",
    "projectSourceRef": "pf-downtown-dubai-zanzebeel-2",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 231.8,
    "bedrooms": 2,
    "priceAed": 4500000,
    "pricePerSqft": 1803,
    "buyerSegment": "End user",
    "buyerNationality": "Saudi Arabia"
  },
  {
    "sourceRef": "pf-txn-ae29dfe9e57aac28399a4081d79117c4",
    "projectSourceRef": "pf-downtown-dubai-damac-maison-the-distinction",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 115.1,
    "bedrooms": 2,
    "priceAed": 2000000,
    "pricePerSqft": 1615,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "Saudi Arabia"
  },
  {
    "sourceRef": "pf-txn-edcd5a74ad5fb5e6f429039ca37d8e96",
    "projectSourceRef": "pf-downtown-dubai-elegance-tower",
    "communityName": "Downtown Dubai",
    "areaName": "Downtown Dubai",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 75.7,
    "bedrooms": 1,
    "priceAed": 2180000,
    "pricePerSqft": 2674,
    "buyerSegment": "Golden visa holder",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-d997be489d91454a078e3f1ffa300253",
    "projectSourceRef": "pf-business-bay-royal-regency-suites-tower-two",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-20",
    "unitType": "apartment",
    "areaSqm": 103.9,
    "bedrooms": 1,
    "priceAed": 2035825,
    "pricePerSqft": 1821,
    "buyerSegment": "End user",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-e7065e634126d06f899d9b3744bcaa52",
    "projectSourceRef": "pf-business-bay-peninsula-four",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-20",
    "unitType": "apartment",
    "areaSqm": 46.7,
    "bedrooms": 0,
    "priceAed": 1150000,
    "pricePerSqft": 2287,
    "buyerSegment": "HNW individual",
    "buyerNationality": "United Kingdom"
  },
  {
    "sourceRef": "pf-txn-2f5b17c55f670c0f527b813c4c21c89c",
    "projectSourceRef": "pf-business-bay-peninsula-four",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 80.2,
    "bedrooms": 1,
    "priceAed": 2200000,
    "pricePerSqft": 2549,
    "buyerSegment": "International investor",
    "buyerNationality": "Saudi Arabia"
  },
  {
    "sourceRef": "pf-txn-5629d1e32f662bd27a585138e840d959",
    "projectSourceRef": "pf-business-bay-peninsula-four",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 48.3,
    "bedrooms": 0,
    "priceAed": 1198000,
    "pricePerSqft": 2304,
    "buyerSegment": "International investor",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-82922623ce975d3ae9bbaeba53a1e001",
    "projectSourceRef": "pf-business-bay-peninsula-four",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 133.4,
    "bedrooms": 2,
    "priceAed": 3536000,
    "pricePerSqft": 2463,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-080327b2e89ae14c0cdd353a307d99a9",
    "projectSourceRef": "pf-business-bay-dg1",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 95.3,
    "bedrooms": 1,
    "priceAed": 2700000,
    "pricePerSqft": 2631,
    "buyerSegment": "Golden visa holder",
    "buyerNationality": "Saudi Arabia"
  },
  {
    "sourceRef": "pf-txn-087032f6359cb0432ef02525405ed26c",
    "projectSourceRef": "pf-business-bay-meera",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 118.7,
    "bedrooms": 2,
    "priceAed": 2675000,
    "pricePerSqft": 2094,
    "buyerSegment": "End user",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-0a2839e39dc565c098b654ea5800e08a",
    "projectSourceRef": "pf-business-bay-noura-tower",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 123.6,
    "bedrooms": 2,
    "priceAed": 2320000,
    "pricePerSqft": 1743,
    "buyerSegment": "International investor",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-a9d83024fc2e436e52d0d42682c83413",
    "projectSourceRef": "pf-business-bay-noura-tower",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 138.9,
    "bedrooms": 2,
    "priceAed": 2750000,
    "pricePerSqft": 1839,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "United Kingdom"
  },
  {
    "sourceRef": "pf-txn-0cee35487c2b14ad0f349afea2abb197",
    "projectSourceRef": "pf-business-bay-business-bay-mall",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 148.7,
    "bedrooms": 2,
    "priceAed": 2525000,
    "pricePerSqft": 1577,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "Saudi Arabia"
  },
  {
    "sourceRef": "pf-txn-177bd4622cec4b3466226204dea8f196",
    "projectSourceRef": "pf-business-bay-tower-b",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 133.3,
    "bedrooms": 2,
    "priceAed": 1825000,
    "pricePerSqft": 1272,
    "buyerSegment": "End user",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-b63b747938ab9f049a070619e8ff888b",
    "projectSourceRef": "pf-business-bay-tower-b",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 86.3,
    "bedrooms": 1,
    "priceAed": 1450000,
    "pricePerSqft": 1561,
    "buyerSegment": "End user",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-4e520e6bc4c92c0cc76fe35486bbf4b8",
    "projectSourceRef": "pf-business-bay-binghatti-aquarise",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 125.7,
    "bedrooms": 2,
    "priceAed": 3200000,
    "pricePerSqft": 2365,
    "buyerSegment": "HNW individual",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-11a3bac2e80ecae94f157b5dc1e31f19",
    "projectSourceRef": "pf-business-bay-binghatti-aquarise",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 41.6,
    "bedrooms": 0,
    "priceAed": 1197999,
    "pricePerSqft": 2677,
    "buyerSegment": "Golden visa holder",
    "buyerNationality": "United Kingdom"
  },
  {
    "sourceRef": "pf-txn-74372dca1b129e1704ac9b6ac01a1140",
    "projectSourceRef": "pf-business-bay-binghatti-aquarise",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 72.9,
    "bedrooms": 1,
    "priceAed": 2000000,
    "pricePerSqft": 2548,
    "buyerSegment": "HNW individual",
    "buyerNationality": "Saudi Arabia"
  },
  {
    "sourceRef": "pf-txn-dba5b1b2122548a268e3dfeeb859e8d8",
    "projectSourceRef": "pf-business-bay-binghatti-aquarise",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 75.3,
    "bedrooms": 1,
    "priceAed": 2000000,
    "pricePerSqft": 2469,
    "buyerSegment": "International investor",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-7a40f3d637a940d910fa9ce73d06b406",
    "projectSourceRef": "pf-business-bay-capital-bay-tower-b",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 50.3,
    "bedrooms": 0,
    "priceAed": 750000,
    "pricePerSqft": 1386,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-8c9890ab96d3fd441e50a11f7b597404",
    "projectSourceRef": "pf-business-bay-canal-bay",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 103.3,
    "bedrooms": 2,
    "priceAed": 1977000,
    "pricePerSqft": 1778,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "United Kingdom"
  },
  {
    "sourceRef": "pf-txn-99a42aa17186bf554a227bf77b26e468",
    "projectSourceRef": "pf-business-bay-peninsula-three",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 64.9,
    "bedrooms": 1,
    "priceAed": 2100000,
    "pricePerSqft": 3008,
    "buyerSegment": "End user",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-af2785bf59950ee7b6a8bff2ae09b3d0",
    "projectSourceRef": "pf-business-bay-bayz-101-by-danube",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 104.7,
    "bedrooms": 2,
    "priceAed": 3077000,
    "pricePerSqft": 2729,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "Saudi Arabia"
  },
  {
    "sourceRef": "pf-txn-f96eba2fbb68a26527bf9f3df64c4d2f",
    "projectSourceRef": "pf-business-bay-one-by-binghatti",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 93.8,
    "bedrooms": 1,
    "priceAed": 2175000,
    "pricePerSqft": 2155,
    "buyerSegment": "Golden visa holder",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-0f1b0580f4d9f36d37e77c2bcbd7c767",
    "projectSourceRef": "pf-business-bay-one-by-binghatti",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 143.9,
    "bedrooms": 2,
    "priceAed": 4674999,
    "pricePerSqft": 3018,
    "buyerSegment": "End user",
    "buyerNationality": "United Kingdom"
  },
  {
    "sourceRef": "pf-txn-2cb9e8f30155bc8f22b80876c0f9a6b3",
    "projectSourceRef": "pf-business-bay-one-by-binghatti",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 110.9,
    "bedrooms": 1,
    "priceAed": 3149999,
    "pricePerSqft": 2639,
    "buyerSegment": "Golden visa holder",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-389da3d0c1cba09c04e5f73c33c93e43",
    "projectSourceRef": "pf-business-bay-one-by-binghatti",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 76.4,
    "bedrooms": 1,
    "priceAed": 2303249.17,
    "pricePerSqft": 2802,
    "buyerSegment": "International investor",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-091a9c3e3de1ec3899e1055e164791ed",
    "projectSourceRef": "pf-business-bay-peninsula-two",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 39.4,
    "bedrooms": 0,
    "priceAed": 1075000,
    "pricePerSqft": 2534,
    "buyerSegment": "End user",
    "buyerNationality": "United Kingdom"
  },
  {
    "sourceRef": "pf-txn-1f532a4a78b8602353335199e4ea251f",
    "projectSourceRef": "pf-business-bay-the-quayside",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 71.9,
    "bedrooms": 1,
    "priceAed": 1964828,
    "pricePerSqft": 2537,
    "buyerSegment": "End user",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-5db9b3e8cc9df17e987cb9761172ea09",
    "projectSourceRef": "pf-business-bay-downtown-residences",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 102.5,
    "bedrooms": 2,
    "priceAed": 3235292,
    "pricePerSqft": 2934,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-c7e511d1a9bdfc7b9509a799a8e4ff85",
    "projectSourceRef": "pf-business-bay-binghatti-canal",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 123.8,
    "bedrooms": 2,
    "priceAed": 2300000,
    "pricePerSqft": 1726,
    "buyerSegment": "International investor",
    "buyerNationality": "Saudi Arabia"
  },
  {
    "sourceRef": "pf-txn-c93b6bfa8cca6bbbfa9e89343a36be4f",
    "projectSourceRef": "pf-business-bay-one-river-point",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 165,
    "bedrooms": 2,
    "priceAed": 5211828,
    "pricePerSqft": 2935,
    "buyerSegment": "HNW individual",
    "buyerNationality": "United Arab Emirates"
  },
  {
    "sourceRef": "pf-txn-06f1de86afeba5ddde840e52244f7b00",
    "projectSourceRef": "pf-business-bay-upside-living",
    "communityName": "Business Bay",
    "areaName": "Business Bay",
    "txnType": "sale",
    "txnDate": "2026-06-17",
    "unitType": "apartment",
    "areaSqm": 52.4,
    "bedrooms": 0,
    "priceAed": 1536888,
    "pricePerSqft": 2726,
    "buyerSegment": "End user",
    "buyerNationality": "United Arab Emirates"
  },
  {
    "sourceRef": "pf-txn-1743e9e0457ec985c369994a628fac31",
    "projectSourceRef": "pf-dubai-hills-estate-park-heights-2-tower-1",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 99.9,
    "bedrooms": 2,
    "priceAed": 2060000,
    "pricePerSqft": 1916,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-368274840a99d2f20afa5a8b0fb13241",
    "projectSourceRef": "pf-dubai-hills-estate-park-heights-2-tower-1",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 89,
    "bedrooms": 2,
    "priceAed": 1800000,
    "pricePerSqft": 1879,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-e415f9ac563926a905d3f9bbf8c15747",
    "projectSourceRef": "pf-dubai-hills-estate-park-heights-2-tower-1",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 59.9,
    "bedrooms": 1,
    "priceAed": 1200000,
    "pricePerSqft": 1860,
    "buyerSegment": "International investor",
    "buyerNationality": "United Arab Emirates"
  },
  {
    "sourceRef": "pf-txn-1e0a5ee91ea420bd931f0d08e73a2b7d",
    "projectSourceRef": "pf-dubai-hills-estate-greenside-residence-tower-a",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 69.1,
    "bedrooms": 1,
    "priceAed": 1604888,
    "pricePerSqft": 2157,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-2a7dca7690cab4bdc3699bcec19fab02",
    "projectSourceRef": "pf-dubai-hills-estate-golfville-block-a",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 71.4,
    "bedrooms": 2,
    "priceAed": 1580000,
    "pricePerSqft": 2056,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "Saudi Arabia"
  },
  {
    "sourceRef": "pf-txn-6d23b68a3478dda7f6e0457b149c5f5b",
    "projectSourceRef": "pf-dubai-hills-estate-vida-residences-club-point-a",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 73.2,
    "bedrooms": 1,
    "priceAed": 1755888,
    "pricePerSqft": 2227,
    "buyerSegment": "HNW individual",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-d8416039bc3607fe6343ae4386055e1e",
    "projectSourceRef": "pf-dubai-hills-estate-vida-residences-club-point-a",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 101.1,
    "bedrooms": 2,
    "priceAed": 2945888,
    "pricePerSqft": 2707,
    "buyerSegment": "HNW individual",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-840c0d241894142352e278205c1e8d13",
    "projectSourceRef": "pf-dubai-hills-estate-the-fairway",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 1064,
    "bedrooms": null,
    "priceAed": 30150000,
    "pricePerSqft": 2633,
    "buyerSegment": "International investor",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-35c8f5e940f74bdcee659b2f0de1c508",
    "projectSourceRef": "pf-dubai-hills-estate-executive-residences-1",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 92.9,
    "bedrooms": 2,
    "priceAed": 2200000,
    "pricePerSqft": 2200,
    "buyerSegment": "International investor",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-800b1736775e9f691daead446d748d70",
    "projectSourceRef": "pf-dubai-hills-estate-prive-residence",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 62.1,
    "bedrooms": 1,
    "priceAed": 1400000,
    "pricePerSqft": 2094,
    "buyerSegment": "End user",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-99e3832ede19efd626da00aced79ce99",
    "projectSourceRef": "pf-dubai-hills-estate-prive-residence",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 66.1,
    "bedrooms": 1,
    "priceAed": 1350000,
    "pricePerSqft": 1898,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-15284d321dbd4b600fe3dc524d70ea12",
    "projectSourceRef": "pf-dubai-hills-estate-prive-residence",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-12",
    "unitType": "apartment",
    "areaSqm": 37.2,
    "bedrooms": 0,
    "priceAed": 900000,
    "pricePerSqft": 2249,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "United Kingdom"
  },
  {
    "sourceRef": "pf-txn-a4364950a83b33d71773c66910b51daa",
    "projectSourceRef": "pf-dubai-hills-estate-park-lane-3b",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 70.5,
    "bedrooms": 1,
    "priceAed": 1452888,
    "pricePerSqft": 1915,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-0c4fd6d130eefd79bb68e32c94296ffc",
    "projectSourceRef": "pf-dubai-hills-estate-hillsedge-tower-b",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-17",
    "unitType": "apartment",
    "areaSqm": 66.1,
    "bedrooms": 1,
    "priceAed": 1866888,
    "pricePerSqft": 2624,
    "buyerSegment": "HNW individual",
    "buyerNationality": "United Kingdom"
  },
  {
    "sourceRef": "pf-txn-51d500510051eae05b9830eb939ab190",
    "projectSourceRef": "pf-dubai-hills-estate-park-point-building-d",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-17",
    "unitType": "apartment",
    "areaSqm": 94.1,
    "bedrooms": 2,
    "priceAed": 1950000,
    "pricePerSqft": 1926,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-a1baf06484d0eccc8e99009fbd9c25ce",
    "projectSourceRef": "pf-dubai-hills-estate-palace-residences-2",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-17",
    "unitType": "apartment",
    "areaSqm": 69.4,
    "bedrooms": 1,
    "priceAed": 2050000,
    "pricePerSqft": 2743,
    "buyerSegment": "End user",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-0934db536f9666286f2ab1da7eef813a",
    "projectSourceRef": "pf-dubai-hills-estate-park-lane-1b",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 105,
    "bedrooms": 2,
    "priceAed": 2467888,
    "pricePerSqft": 2184,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-094a9c7cb36e41062edd9cb0a9d2eb49",
    "projectSourceRef": "pf-dubai-hills-estate-hills-park",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 62.5,
    "bedrooms": 1,
    "priceAed": 1784888,
    "pricePerSqft": 2652,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "Saudi Arabia"
  },
  {
    "sourceRef": "pf-txn-38b4e3e7ab3ef9c33a342fa09f2db4f4",
    "projectSourceRef": "pf-dubai-hills-estate-hills-park",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-12",
    "unitType": "apartment",
    "areaSqm": 99.1,
    "bedrooms": 2,
    "priceAed": 2100000,
    "pricePerSqft": 1968,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-3c3392a15cdcd6008186829f505a8b3f",
    "projectSourceRef": "pf-dubai-hills-estate-hills-park",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-12",
    "unitType": "apartment",
    "areaSqm": 62.5,
    "bedrooms": 1,
    "priceAed": 1430000,
    "pricePerSqft": 2125,
    "buyerSegment": "Golden visa holder",
    "buyerNationality": "United Kingdom"
  },
  {
    "sourceRef": "pf-txn-64d3171f95441fa544e9bc11896e08e6",
    "projectSourceRef": "pf-dubai-hills-estate-address-residences-dubai-hills-estate-tower-a",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 69.9,
    "bedrooms": 1,
    "priceAed": 1908930,
    "pricePerSqft": 2536,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "Saudi Arabia"
  },
  {
    "sourceRef": "pf-txn-cc4e79e3793120d3d37e23bae90a79a2",
    "projectSourceRef": "pf-dubai-hills-estate-collective-2-0-tower-b",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 46,
    "bedrooms": 1,
    "priceAed": 1060000,
    "pricePerSqft": 2139,
    "buyerSegment": "International investor",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-e35781a6e94580cd75d63b956c9b56a3",
    "projectSourceRef": "pf-dubai-hills-estate-golf-hillside",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-16",
    "unitType": "apartment",
    "areaSqm": 174.6,
    "bedrooms": 2,
    "priceAed": 3026888,
    "pricePerSqft": 1610,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-02f8648b24ba1ec86335893cda9a5db7",
    "projectSourceRef": "pf-dubai-hills-estate-park-horizon-tower-1",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-12",
    "unitType": "apartment",
    "areaSqm": 68.8,
    "bedrooms": 1,
    "priceAed": 1500000,
    "pricePerSqft": 2025,
    "buyerSegment": "International investor",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-4001c1fef4fac93d73fa1bbb6827aa58",
    "projectSourceRef": "pf-dubai-hills-estate-parkwood-tower-a",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-12",
    "unitType": "apartment",
    "areaSqm": 167.8,
    "bedrooms": 3,
    "priceAed": 4583888,
    "pricePerSqft": 2538,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-433b5bc620daa21eb4df37e1a8df3a36",
    "projectSourceRef": "pf-dubai-hills-estate-elvira-2",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-12",
    "unitType": "apartment",
    "areaSqm": 65.2,
    "bedrooms": 1,
    "priceAed": 1799888,
    "pricePerSqft": 2563,
    "buyerSegment": "Golden visa holder",
    "buyerNationality": "United Kingdom"
  },
  {
    "sourceRef": "pf-txn-7a8eff53af633a6e5dc870d53d50f993",
    "projectSourceRef": "pf-dubai-hills-estate-socio-at-dubai-hills-estate-tower-2",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-12",
    "unitType": "apartment",
    "areaSqm": 45,
    "bedrooms": 1,
    "priceAed": 1080000,
    "pricePerSqft": 2228,
    "buyerSegment": "International investor",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-4e30cffdb9a43db2d2a0a0e4f1c71a8d",
    "projectSourceRef": "pf-dubai-hills-estate-399-hills-park-b",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-11",
    "unitType": "apartment",
    "areaSqm": 87.6,
    "bedrooms": 1,
    "priceAed": 2010000,
    "pricePerSqft": 2131,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-9bb3559011c194ff2f6db2a7add1e8fa",
    "projectSourceRef": "pf-dubai-hills-estate-golf-grand",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-11",
    "unitType": "apartment",
    "areaSqm": 107.4,
    "bedrooms": 2,
    "priceAed": 2100000,
    "pricePerSqft": 1817,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-dce934121ad560321be034790f54ec28",
    "projectSourceRef": "pf-dubai-hills-estate-parkside-hills",
    "communityName": "Dubai Hills Estate",
    "areaName": "Dubai Hills Estate",
    "txnType": "sale",
    "txnDate": "2026-06-11",
    "unitType": "apartment",
    "areaSqm": 99.5,
    "bedrooms": 2,
    "priceAed": 2242888,
    "pricePerSqft": 2095,
    "buyerSegment": "End user",
    "buyerNationality": "United Arab Emirates"
  },
  {
    "sourceRef": "pf-txn-bb6464054b7e112bca40d9737cbfd868",
    "projectSourceRef": "pf-jumeirah-village-circle-azizi-ruby",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-21",
    "unitType": "apartment",
    "areaSqm": 34.6,
    "bedrooms": 0,
    "priceAed": 659300,
    "pricePerSqft": 1768,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "United Kingdom"
  },
  {
    "sourceRef": "pf-txn-218b6ac3a9631095fec4de9f9a0ecb7b",
    "projectSourceRef": "pf-jumeirah-village-circle-azizi-ruby",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 93.7,
    "bedrooms": 2,
    "priceAed": 1543410,
    "pricePerSqft": 1529,
    "buyerSegment": "End user",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-261b66c2299f571b93f7754fa718c5d9",
    "projectSourceRef": "pf-jumeirah-village-circle-q-gardens-lofts",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-20",
    "unitType": "apartment",
    "areaSqm": 43.1,
    "bedrooms": 0,
    "priceAed": 510175,
    "pricePerSqft": 1099,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-053009e8bc015ee067da5958b9a26476",
    "projectSourceRef": "pf-jumeirah-village-circle-binghatti-apex",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 38.8,
    "bedrooms": 0,
    "priceAed": 809099.07,
    "pricePerSqft": 1938,
    "buyerSegment": "International investor",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-2893de2df1ee77d7b1657cda39784dee",
    "projectSourceRef": "pf-jumeirah-village-circle-binghatti-apex",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 84.5,
    "bedrooms": 1,
    "priceAed": 1599999,
    "pricePerSqft": 1760,
    "buyerSegment": "International investor",
    "buyerNationality": "United Arab Emirates"
  },
  {
    "sourceRef": "pf-txn-4d90311674112c3c941ba2430fe0b24d",
    "projectSourceRef": "pf-jumeirah-village-circle-binghatti-apex",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 39.9,
    "bedrooms": 0,
    "priceAed": 879999,
    "pricePerSqft": 2047,
    "buyerSegment": "End user",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-0a8efd7c0b49961d417109070d88d996",
    "projectSourceRef": "pf-jumeirah-village-circle-maison-elysee-2",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 62.5,
    "bedrooms": 1,
    "priceAed": 980407.5,
    "pricePerSqft": 1457,
    "buyerSegment": "End user",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-1727b08f2b668840f3e5e2b80c7bb996",
    "projectSourceRef": "pf-jumeirah-village-circle-squarex-residence",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 39.1,
    "bedrooms": 0,
    "priceAed": 670015.68,
    "pricePerSqft": 1592,
    "buyerSegment": "End user",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-1a9e4cb88bd0a9f1c4002f657fa673b4",
    "projectSourceRef": "pf-jumeirah-village-circle-casa-vista-residence-by-golden-woods",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 66.3,
    "bedrooms": 1,
    "priceAed": 720000,
    "pricePerSqft": 1009,
    "buyerSegment": "End user",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-36dc13b31c97071325df18e5ebecdb04",
    "projectSourceRef": "pf-jumeirah-village-circle-casa-vista-residence-by-golden-woods",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 65.6,
    "bedrooms": 1,
    "priceAed": 714510,
    "pricePerSqft": 1011,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "United Arab Emirates"
  },
  {
    "sourceRef": "pf-txn-8cf99a41327cbb2a346006f861e1e7b2",
    "projectSourceRef": "pf-jumeirah-village-circle-casa-vista-residence-by-golden-woods",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 78.6,
    "bedrooms": 1,
    "priceAed": 838940,
    "pricePerSqft": 991,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-335566ccda3edb9973ec44e9fc91b7a0",
    "projectSourceRef": "pf-jumeirah-village-circle-the-haven-gardens",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 126.9,
    "bedrooms": 2,
    "priceAed": 1650000,
    "pricePerSqft": 1208,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-5de37a336b32b7a06c9634dec3836912",
    "projectSourceRef": "pf-jumeirah-village-circle-chaimaa-avenue-2",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 140.4,
    "bedrooms": 2,
    "priceAed": 1580000,
    "pricePerSqft": 1046,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-5f2a4e84595806934f0f83c4024d8d08",
    "projectSourceRef": "pf-jumeirah-village-circle-binghatti-phantom",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 84.7,
    "bedrooms": 1,
    "priceAed": 1835000,
    "pricePerSqft": 2012,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "Russia"
  },
  {
    "sourceRef": "pf-txn-600ef84f96abee77a86a3e59f0ba10f6",
    "projectSourceRef": "pf-jumeirah-village-circle-skyhills-residences-2",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 99.2,
    "bedrooms": 1,
    "priceAed": 1279087.31,
    "pricePerSqft": 1198,
    "buyerSegment": "End user",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-b4278a7b4010bf4a4300e87185b12aea",
    "projectSourceRef": "pf-jumeirah-village-circle-skyhills-residences-2",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 38.6,
    "bedrooms": 0,
    "priceAed": 746278,
    "pricePerSqft": 1798,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-c2eb463d83802fcc30ea9e7dddb4ca28",
    "projectSourceRef": "pf-jumeirah-village-circle-skyhills-residences-2",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 38.6,
    "bedrooms": 0,
    "priceAed": 692735,
    "pricePerSqft": 1669,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-01afcd7f28a4d9a294427273e42ac9e8",
    "projectSourceRef": "pf-jumeirah-village-circle-skyhills-residences-2",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 74.5,
    "bedrooms": 1,
    "priceAed": 1275330,
    "pricePerSqft": 1591,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "Saudi Arabia"
  },
  {
    "sourceRef": "pf-txn-68205be6d1729f214df283b76e219294",
    "projectSourceRef": "pf-jumeirah-village-circle-xanadu-residence-2",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 128.5,
    "bedrooms": 2,
    "priceAed": 1600000,
    "pricePerSqft": 1157,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-6f458e1428f80dac4853e2efea99276b",
    "projectSourceRef": "pf-jumeirah-village-circle-fortunato",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 78.6,
    "bedrooms": 1,
    "priceAed": 780000,
    "pricePerSqft": 922,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-708fa75b4df8b7a393dbccfc9c5ed4ef",
    "projectSourceRef": "pf-jumeirah-village-circle-gardenia-1",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 106.1,
    "bedrooms": 1,
    "priceAed": 842823,
    "pricePerSqft": 738,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "United Arab Emirates"
  },
  {
    "sourceRef": "pf-txn-7977d5923a50579e19546fe84668abea",
    "projectSourceRef": "pf-jumeirah-village-circle-skyhills-residences-3",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 96.5,
    "bedrooms": 2,
    "priceAed": 1658606.88,
    "pricePerSqft": 1596,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-9cb43af918e1228c290dd40f50db633b",
    "projectSourceRef": "pf-jumeirah-village-circle-squarex-one",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 34.8,
    "bedrooms": 0,
    "priceAed": 690000,
    "pricePerSqft": 1840,
    "buyerSegment": "International investor",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-a1ba624f27f74edc239ce178dc82bd22",
    "projectSourceRef": "pf-jumeirah-village-circle-binghatti-amberhall",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 79,
    "bedrooms": 1,
    "priceAed": 1259999,
    "pricePerSqft": 1482,
    "buyerSegment": "Buy-to-let investor",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-b2c093a0b8c3264f2eb89e32b9872a6a",
    "projectSourceRef": "pf-jumeirah-village-circle-serenz-by-danube-tower-b",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 39.7,
    "bedrooms": 0,
    "priceAed": 946560,
    "pricePerSqft": 2213,
    "buyerSegment": "End user",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-b5dc59798dd536b5efb82c4f4335fdec",
    "projectSourceRef": "pf-jumeirah-village-circle-stonehenge-residence",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 41.5,
    "bedrooms": 0,
    "priceAed": 710000,
    "pricePerSqft": 1590,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-f0c51a6b3ddffe7ca6d42359b08129b4",
    "projectSourceRef": "pf-jumeirah-village-circle-binghatti-circle",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 37.6,
    "bedrooms": 0,
    "priceAed": 709999,
    "pricePerSqft": 1754,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "Germany"
  },
  {
    "sourceRef": "pf-txn-fe0b00c6caacafc6763bbdc6ad5104a9",
    "projectSourceRef": "pf-jumeirah-village-circle-binghatti-corner",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-19",
    "unitType": "apartment",
    "areaSqm": 116.3,
    "bedrooms": 2,
    "priceAed": 1300000,
    "pricePerSqft": 1038,
    "buyerSegment": "End user",
    "buyerNationality": "China"
  },
  {
    "sourceRef": "pf-txn-100d885ff41d3e0598e42baf9cefc369",
    "projectSourceRef": "pf-jumeirah-village-circle-belgravia-3b",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 187.4,
    "bedrooms": 2,
    "priceAed": 2425000,
    "pricePerSqft": 1202,
    "buyerSegment": "First-time buyer",
    "buyerNationality": "India"
  },
  {
    "sourceRef": "pf-txn-14672dc8394ebf3fbfea618e86190650",
    "projectSourceRef": "pf-jumeirah-village-circle-the-orchard-place-tower-b",
    "communityName": "Jumeirah Village Circle",
    "areaName": "Jumeirah Village Circle",
    "txnType": "sale",
    "txnDate": "2026-06-18",
    "unitType": "apartment",
    "areaSqm": 290.4,
    "bedrooms": 3,
    "priceAed": 4687500,
    "pricePerSqft": 1499,
    "buyerSegment": "End user",
    "buyerNationality": "United Arab Emirates"
  }
];

export const DEMO_PRICE_INDEX: DemoIndex[] = [
  {
    "areaName": "Palm Jumeirah",
    "segment": "ultra_luxury",
    "period": "2026-Q2",
    "indexValue": 125.8,
    "avgPricePerSqft": 4159,
    "yoyPct": 25.8,
    "roiPct": 5.6,
    "volume": 5,
    "trend": {
      "saleAvgPrice": 10351725,
      "saleAvgPriceChange": 25.78,
      "saleAvgPricePerSqft": 4159,
      "rentalYield": 5.62,
      "volumeChange": -4.85
    }
  },
  {
    "areaName": "Dubai Marina",
    "segment": "luxury",
    "period": "2026-Q2",
    "indexValue": 108.6,
    "avgPricePerSqft": 2232,
    "yoyPct": 8.6,
    "roiPct": 6.1,
    "volume": 57,
    "trend": {
      "saleAvgPrice": 2923120,
      "saleAvgPriceChange": 8.64,
      "saleAvgPricePerSqft": 2232,
      "rentalYield": 6.09,
      "volumeChange": -56.83
    }
  },
  {
    "areaName": "Downtown Dubai",
    "segment": "luxury",
    "period": "2026-Q2",
    "indexValue": 103.9,
    "avgPricePerSqft": 3152,
    "yoyPct": 3.9,
    "roiPct": 5.5,
    "volume": 29,
    "trend": {
      "saleAvgPrice": 4540703,
      "saleAvgPriceChange": 3.91,
      "saleAvgPricePerSqft": 3152,
      "rentalYield": 5.48,
      "volumeChange": -28.64
    }
  },
  {
    "areaName": "Business Bay",
    "segment": "luxury",
    "period": "2026-Q2",
    "indexValue": 112.2,
    "avgPricePerSqft": 2544,
    "yoyPct": 12.2,
    "roiPct": 6.4,
    "volume": 6,
    "trend": {
      "saleAvgPrice": 2571522,
      "saleAvgPriceChange": 12.22,
      "saleAvgPricePerSqft": 2544,
      "rentalYield": 6.43,
      "volumeChange": -5.67
    }
  },
  {
    "areaName": "Dubai Hills Estate",
    "segment": "luxury",
    "period": "2026-Q2",
    "indexValue": 104.6,
    "avgPricePerSqft": 2427,
    "yoyPct": 4.6,
    "roiPct": 6,
    "volume": 45,
    "trend": {
      "saleAvgPrice": 2774265,
      "saleAvgPriceChange": 4.56,
      "saleAvgPricePerSqft": 2427,
      "rentalYield": 5.96,
      "volumeChange": -45.33
    }
  },
  {
    "areaName": "Jumeirah Village Circle",
    "segment": "mid",
    "period": "2026-Q2",
    "indexValue": 105.7,
    "avgPricePerSqft": 1484,
    "yoyPct": 5.7,
    "roiPct": 7.7,
    "volume": 16,
    "trend": {
      "saleAvgPrice": 1073321,
      "saleAvgPriceChange": 5.7,
      "saleAvgPricePerSqft": 1484,
      "rentalYield": 7.72,
      "volumeChange": -16.31
    }
  }
];
