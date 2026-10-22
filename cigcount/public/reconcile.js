// Pure reconciliation math — shared by the page and the tests.
// Formula (Tennessee sales-tax / Retail Accountability Program reconciliation):
//   Expected on shelf = Beginning + Purchases (deliveries) - Sales (register)
//   Difference        = Actually counted - Expected
// 1 carton = 10 packs. 1 pack = 20 cigarettes (sticks), unless marked otherwise.
export const PACKS_PER_CARTON = 10;
export const STICKS_PER_PACK = 20;
export const TN_STAMP_PER_PACK = 0.62; // $0.031 per cigarette x 20, Tenn. Code 67-4-1004

export function toPacks({ packs = 0, cartons = 0 } = {}) {
  return Math.max(0, Math.round(Number(packs) || 0)) + Math.max(0, Math.round(Number(cartons) || 0)) * PACKS_PER_CARTON;
}

export function reconcileBrand(row) {
  const beginning = Number(row.beginning) || 0;
  const purchases = Number(row.purchases) || 0;
  const sales = Number(row.sales) || 0;
  const actual = Number(row.actual) || 0;
  const expected = beginning + purchases - sales;
  const diff = actual - expected;
  const status = diff === 0 ? 'exact' : Math.abs(diff) <= Math.max(5, Math.round(Math.abs(expected) * 0.02)) ? 'close' : 'check';
  return { brand: row.brand, beginning, purchases, sales, expected, actual, diff, status };
}

export function reconcile(rows, { avgPrice = 9, taxRate = 0.0925 } = {}) {
  const brands = (rows || []).map(reconcileBrand);
  const totals = brands.reduce((t, b) => ({
    beginning: t.beginning + b.beginning, purchases: t.purchases + b.purchases,
    sales: t.sales + b.sales, expected: t.expected + b.expected,
    actual: t.actual + b.actual, diff: t.diff + b.diff,
  }), { beginning: 0, purchases: 0, sales: 0, expected: 0, actual: 0, diff: 0 });
  const missingPacks = Math.max(0, -totals.diff);
  const extraPacks = Math.max(0, totals.diff);
  return {
    brands, totals,
    missingPacks, extraPacks,
    missingRetailValue: +(missingPacks * avgPrice).toFixed(2),
    estimatedSalesTaxOnMissing: +(missingPacks * avgPrice * taxRate).toFixed(2),
    stampTaxAlreadyPaidOnMissing: +(missingPacks * TN_STAMP_PER_PACK).toFixed(2),
    cartonsActual: +(totals.actual / PACKS_PER_CARTON).toFixed(1),
    sticksActual: totals.actual * STICKS_PER_PACK,
  };
}

export function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(result, meta = {}) {
  const head = ['Brand', 'Beginning packs', 'Purchases packs', 'Sales packs', 'Expected packs', 'Counted packs', 'Difference packs', 'Counted cartons', 'Counted sticks'];
  const lines = [
    ['Cigarette count sheet', meta.store || '', meta.date || ''].map(csvEscape).join(','),
    ['Beginning + Purchases - Sales = Expected. Difference = Counted - Expected.', '', ''].map(csvEscape).join(','),
    head.map(csvEscape).join(','),
    ...result.brands.map(b => [b.brand, b.beginning, b.purchases, b.sales, b.expected, b.actual, b.diff, +(b.actual / PACKS_PER_CARTON).toFixed(1), b.actual * STICKS_PER_PACK].map(csvEscape).join(',')),
    ['TOTAL', result.totals.beginning, result.totals.purchases, result.totals.sales, result.totals.expected, result.totals.actual, result.totals.diff, result.cartonsActual, result.sticksActual].map(csvEscape).join(','),
  ];
  return lines.join('\n') + '\n';
}
