'use strict';
// Synthetic demo data. Every company, person and code here is invented.

function rng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const contractTypes = ['Open Access Supply', 'Bilateral Purchase', 'Bilateral Sale', 'Green PPA', 'Exchange (DAM)', 'BESS Tolling'];
const products = ['Round The Clock', 'Peak', 'Off-Peak', 'Solar Profile', 'Base Load'];
const granularities = ['15 Min', 'Hourly', 'Daily', 'Monthly'];
const timeZones = ['IST', 'UTC'];
const componentTypes = ['Fixed Price', 'Index Price', 'External Reference'];
const marketProducts = ['DAM', 'RTM', 'TAM', 'G-DAM', 'Bilateral'];
const users = ['demo.trader', 'ops.analyst', 'risk.manager'];
const security = require('./security');
const holidayCalendars = ['India - National', 'India - Maharashtra', 'India - Karnataka'];

const counterparties = [
  ['ARV', 'Aravalli Steel Works', 'Industrial', 'North'],
  ['CCL', 'Coastal Cement Ltd', 'Industrial', 'West'],
  ['DTM', 'Deccan Textile Mills', 'Industrial', 'South'],
  ['HHP', 'Himgiri Hydro Power', 'Generator', 'North'],
  ['NAF', 'Narmada Agro Foods', 'Industrial', 'West'],
  ['SDC', 'Sahyadri Data Centres', 'Commercial', 'West'],
  ['KCH', 'Konkan Chemicals', 'Industrial', 'West'],
  ['TSP', 'Thar Solar Parks', 'Generator', 'North'],
  ['VPM', 'Vindhya Paper Mills', 'Industrial', 'Central'],
  ['GCS', 'Ganga Cold Storage', 'Commercial', 'East'],
  ['SWF', 'Satpura Wind Farms', 'Generator', 'Central'],
  ['MPL', 'Malabar Ports Ltd', 'Commercial', 'South'],
  ['NRD', 'Northern Retail Discom', 'Utility', 'North'],
  ['BXT', 'Bharat Exchange Traders', 'Trader', 'West']
];

const legalEntities = [
  ['GTE', 'GridTrade Energy Pvt Ltd', 'India'],
  ['GTR', 'GridTrade Renewables Pvt Ltd', 'India'],
  ['GTP', 'GridTrade Power Trading LLP', 'India']
];

const nodes = [
  ['NR-DEL-01', 'Delhi', 'North'], ['NR-JPR-01', 'Jaipur', 'North'], ['NR-CHD-01', 'Chandigarh', 'North'],
  ['WR-MUM-02', 'Mumbai', 'West'], ['WR-AMD-01', 'Ahmedabad', 'West'], ['WR-PNQ-01', 'Pune', 'West'],
  ['SR-BLR-01', 'Bengaluru', 'South'], ['SR-CHN-01', 'Chennai', 'South'], ['ER-KOL-01', 'Kolkata', 'East'],
  ['CR-BPL-01', 'Bhopal', 'Central']
];

const commodities = [
  ['Energy', true, contractTypes],
  ['Capacity', true, ['Open Access Supply', 'Bilateral Purchase', 'Bilateral Sale', 'BESS Tolling']],
  ['Renewable Energy Certificate', true, ['Green PPA', 'Open Access Supply']],
  ['Ancillary Services', true, ['BESS Tolling', 'Exchange (DAM)']],
  ['Transmission Charges', false, ['Open Access Supply', 'Bilateral Purchase']]
];

function build() {
  const r = rng(20261021);
  const pick = a => a[Math.floor(r() * a.length)];
  const now = new Date();
  const db = {
    seq: {},
    counterparties: [], legalEntities: [], commodities: [], nodes: [],
    contracts: [], components: [], versions: [], trades: [], timeseries: [], tsData: {},
    ingestionJobs: [], audit: []
  };
  const next = k => (db.seq[k] = (db.seq[k] || 0) + 1);

  counterparties.forEach(([code, name, type, region]) => db.counterparties.push({
    id: next('counterparties'), code, name, type, region,
    creditLimit: Math.round(5 + r() * 95) * 10, // INR lakh
    enabled: true, isSystem: false
  }));
  legalEntities.forEach(([code, name, country]) => db.legalEntities.push({
    id: next('legalEntities'), code, name, country, enabled: true,
    taxId: `DEMO${code}${pad(Math.floor(r() * 9999), 4)}`
  }));
  commodities.forEach(([name, isSystem, types]) => db.commodities.push({
    id: next('commodities'), name, enabled: true, isSystem, contractTypes: types.slice()
  }));
  nodes.forEach(([code, city, region]) => db.nodes.push({ id: next('nodes'), code, name: `${code} (${city})`, region }));

  // Time series: one meter series per load site plus a few price curves.
  const loadCps = db.counterparties.filter(c => c.type !== 'Generator' && c.type !== 'Trader');
  loadCps.forEach(cp => {
    db.timeseries.push({
      id: next('timeseries'), name: `Meter ${cp.name}`, formula: `METER_${cp.code}_KWH`,
      type: 'Input - Complex', profileType: 'Time Array', granularity: 'Hourly', dataType: 'Decimal',
      unit: 'MWh', timeZone: 'IST', enabled: true, isSystem: false, manual: true, base: 2 + r() * 18
    });
  });
  [['Price IEX DAM North', 'PX_IEX_DAM_N'], ['Price IEX DAM West', 'PX_IEX_DAM_W'], ['Price IEX RTM', 'PX_IEX_RTM'], ['Solar Shape Rajasthan', 'SHAPE_SOLAR_RJ']]
    .forEach(([name, formula], i) => db.timeseries.push({
      id: next('timeseries'), name, formula, type: i === 3 ? 'Calculated' : 'Input - Simple',
      profileType: 'Time Array', granularity: 'Hourly', dataType: 'Decimal',
      unit: i === 3 ? '%' : 'INR/MWh', timeZone: 'IST', enabled: true, isSystem: true, manual: false, base: i === 3 ? 0 : 3500 + r() * 2500
    }));

  // Contracts with components.
  const sites = ['Unit 1', 'Unit 2', 'Plant', 'Campus', 'Works', 'Warehouse'];
  const TYPE_CODE = { 'Open Access Supply': 'OA', 'Bilateral Purchase': 'BP', 'Bilateral Sale': 'BS', 'Green PPA': 'GPPA', 'Exchange (DAM)': 'DAM', 'BESS Tolling': 'BESS' };
  const used = new Set();
  const uniqueName = n => { let x = n, k = 2; while (used.has(x)) x = `${n} (${k++})`; used.add(x); return x; };
  for (let i = 0; i < 26; i++) {
    const cp = pick(db.counterparties);
    const type = cp.type === 'Generator' ? pick(['Bilateral Purchase', 'Green PPA', 'BESS Tolling']) : pick(['Open Access Supply', 'Bilateral Sale', 'Exchange (DAM)', 'Open Access Supply']);
    const start = new Date(2025 + Math.floor(r() * 2), Math.floor(r() * 12), 1);
    const end = new Date(start.getFullYear() + 1 + Math.floor(r() * 4), 11, 31);
    const le = type === 'Green PPA' ? db.legalEntities[1] : pick(db.legalEntities);
    const node = pick(db.nodes);
    const meter = db.timeseries.find(t => t.formula === `METER_${cp.code}_KWH`);
    const commoditiesFor = db.commodities.filter(c => c.enabled && c.contractTypes.includes(type)).map(c => c.name);
    const id = next('contracts');
    const status = i % 7 === 0 ? 'Draft' : (i % 5 === 0 ? 'Validated' : 'Approved');
    const createdAt = new Date(now.getTime() - (200 - i * 6) * 86400000);
    const c = {
      id, name: uniqueName(`${cp.name.split(' ')[0]} ${pick(sites)} ${TYPE_CODE[type]}-${String(start.getFullYear()).slice(2)}`),
      type, internalRef: `GT-${start.getFullYear()}-${pad(id, 4)}`,
      transactionType: type.includes('Purchase') || type === 'Green PPA' || type === 'BESS Tolling' ? 'Purchase' : 'Sale',
      counterpartyId: cp.id, legalEntityId: le.id, marketParticipant: `MP-${le.code}-0${1 + Math.floor(r() * 3)}`,
      orderOfAccount: `${le.code}${pad(Math.floor(r() * 900) + 100, 3)}`,
      studyContract: i % 9 === 4, timeZone: 'IST', effectiveDate: ymd(start), startDate: ymd(start), endDate: ymd(end),
      commodities: commoditiesFor.slice(0, 1 + Math.floor(r() * Math.min(3, commoditiesFor.length))),
      nodeId: node.id, meterId: meter ? meter.id : null, holidayCalendar: pick(holidayCalendars),
      contractedMw: Math.round((1 + r() * 24) * 10) / 10,
      status, validated: status !== 'Draft', version: 1, notes: '',
      createdBy: pick(users), createdAt: createdAt.toISOString(), updatedBy: null, updatedAt: createdAt.toISOString()
    };
    db.contracts.push(c);

    const compCount = 1 + Math.floor(r() * 3);
    for (let k = 0; k < compCount; k++) {
      const ctype = k === 0 && meter ? 'External Reference' : pick(['Fixed Price', 'Index Price']);
      db.components.push({
        id: next('components'), contractId: id,
        name: ctype === 'External Reference' ? `Meter ${cp.name}` : `${pick(products)} ${ctype === 'Fixed Price' ? 'Price' : 'Index'}`,
        commodity: c.commodities[0], product: pick(products), granularity: 'Hourly', type: ctype,
        price: ctype === 'Fixed Price' ? Math.round(3000 + r() * 4000) : null,
        indexSeriesId: ctype === 'Index Price' ? db.timeseries.find(t => t.formula === 'PX_IEX_DAM_N').id : null,
        adder: ctype === 'Index Price' ? Math.round(r() * 300) : null,
        referenceSeriesId: ctype === 'External Reference' ? meter.id : null,
        updateValue: 'When underlying data changes', usage: ctype === 'External Reference' ? 'Volume' : 'Price'
      });
    }
    db.versions.push({ id: next('versions'), contractId: id, version: 1, effectiveDate: c.effectiveDate, createdAt: c.createdAt, createdBy: c.createdBy, comment: 'Initial version', snapshot: JSON.parse(JSON.stringify(c)) });
  }

  // Trades for the last 10 days and next few.
  for (let i = 0; i < 70; i++) {
    const cp = pick(db.counterparties);
    const d = new Date(now.getTime() - Math.floor(r() * 10) * 86400000);
    const product = pick(marketProducts);
    const delivery = new Date(d.getTime() + 86400000 * (product === 'TAM' ? 7 : 1));
    const linked = r() < 0.4 ? pick(db.contracts) : null;
    db.trades.push({
      id: next('trades'), tradeRef: `TR-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(i + 1, 3)}`,
      tradeDate: ymd(d), buySell: r() < 0.5 ? 'Buy' : 'Sell', counterpartyId: cp.id, product,
      deliveryStart: ymd(delivery), deliveryEnd: ymd(new Date(delivery.getTime() + (product === 'TAM' ? 6 : 0) * 86400000)),
      block: pick(['00:00-24:00', '06:00-18:00', '18:00-23:00', '00:00-06:00']),
      volumeMw: Math.round((5 + r() * 95) * 10) / 10, priceInrMwh: Math.round(2500 + r() * 6500),
      status: pick(['New', 'Confirmed', 'Confirmed', 'Settled', 'Confirmed']), trader: pick(users),
      contractId: linked ? linked.id : null, source: 'Manual', comments: ''
    });
  }

  db.ingestionJobs.push({
    id: next('ingestionJobs'), fileName: 'trades_2026-10-19.csv', target: 'trades', status: 'Completed', total: 42, accepted: 42, rejected: 0, warnings: 0,
    startedAt: new Date(now.getTime() - 2 * 86400000).toISOString(), finishedAt: new Date(now.getTime() - 2 * 86400000 + 2300).toISOString(), user: 'ops.analyst', errors: []
  });
  db.ingestionJobs.push({
    id: next('ingestionJobs'), fileName: 'meter_reads_2026-10-20.csv', target: 'meter', status: 'Completed with warnings', total: 96, accepted: 94, rejected: 2, warnings: 3,
    startedAt: new Date(now.getTime() - 86400000).toISOString(), finishedAt: new Date(now.getTime() - 86400000 + 4100).toISOString(), user: 'ops.analyst',
    errors: [
      { row: 18, column: 'value', severity: 'Error', message: "Value 'n/a' is not a number" },
      { row: 51, column: 'interval', severity: 'Error', message: 'Interval 25 is outside 1-24 for hourly data' },
      { row: 33, column: 'value', severity: 'Warning', message: 'Value 0.0 for a working-day peak hour; check the meter' },
      { row: 34, column: 'value', severity: 'Warning', message: 'Value 0.0 for a working-day peak hour; check the meter' },
      { row: 77, column: 'value', severity: 'Warning', message: 'Spike: 48.2 MWh is over 3x the daily average' }
    ]
  });
  db.roles = security.seedRoles();
  db.users = security.seedUsers(now);
  db.seq.roles = db.roles.length;
  db.seq.users = db.users.length;
  return db;
}

module.exports = { build, contractTypes, products, granularities, timeZones, componentTypes, marketProducts, users, holidayCalendars, rng, ymd };
