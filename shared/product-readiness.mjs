const selectionStates = new Set(['frozen', 'candidate', 'design-required']);
const procurementStates = new Set(['available', 'digital-only', 'not-ordered', 'ordered']);
const checkStatuses = new Set(['passed', 'failed', 'blocked', 'not-started']);
const fitClasses = new Set(['product-core', 'integrated-candidate', 'bench-only', 'design-required']);
const procurementActions = new Set(['buy-now', 'hold']);

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertUniqueIds(items, label) {
  const ids = new Set();
  for (const item of items) {
    if (!item.id || ids.has(item.id)) throw new Error(`${label} contains a missing or duplicate id`);
    ids.add(item.id);
  }
}

export function validateEvtBom(bom) {
  assertRecord(bom, 'EVT BOM');
  if (!Array.isArray(bom.items) || !bom.items.length) throw new Error('EVT BOM requires items');
  assertUniqueIds(bom.items, 'EVT BOM');
  for (const item of bom.items) {
    if (!item.name || !item.subsystem || !item.requirement) throw new Error(`BOM item ${item.id} is incomplete`);
    if (!Number.isInteger(item.quantity) || item.quantity < 1) throw new Error(`BOM item ${item.id} has invalid quantity`);
    if (!Number.isInteger(item.purchaseQuantity) || item.purchaseQuantity < item.quantity) {
      throw new Error(`BOM item ${item.id} has invalid purchase quantity`);
    }
    if (!selectionStates.has(item.selectionState)) throw new Error(`BOM item ${item.id} has invalid selection state`);
    if (!procurementStates.has(item.procurementState)) throw new Error(`BOM item ${item.id} has invalid procurement state`);
    if (item.fitClass && !fitClasses.has(item.fitClass)) throw new Error(`BOM item ${item.id} has invalid fit class`);
    if (item.dimensionsMm && (
      !Array.isArray(item.dimensionsMm) ||
      item.dimensionsMm.length !== 3 ||
      item.dimensionsMm.some((dimension) => !Number.isFinite(dimension) || dimension <= 0)
    )) throw new Error(`BOM item ${item.id} has invalid dimensions`);
    if (item.quotedUnitPriceUsd !== undefined && (
      !Number.isFinite(item.quotedUnitPriceUsd) ||
      item.quotedUnitPriceUsd < 0 ||
      !item.quoteCheckedAt
    )) throw new Error(`BOM item ${item.id} has an invalid quote`);
  }
  return bom;
}

export function validateEvtPinPlan(plan) {
  assertRecord(plan, 'EVT pin plan');
  if (!Array.isArray(plan.reserved) || !Array.isArray(plan.assignments)) throw new Error('EVT pin plan requires pin lists');
  const reserved = new Set();
  for (const pin of plan.reserved) {
    if (!Number.isInteger(pin.gpio) || pin.gpio < 0 || pin.gpio > 48 || reserved.has(pin.gpio)) {
      throw new Error('EVT pin plan has an invalid reserved GPIO');
    }
    reserved.add(pin.gpio);
  }
  const avoided = new Set((plan.avoid || []).map((pin) => pin.gpio));
  const assigned = new Set();
  for (const pin of plan.assignments) {
    if (!Number.isInteger(pin.gpio) || pin.gpio < 0 || pin.gpio > 48 || !pin.signal || !pin.direction) {
      throw new Error('EVT pin plan has an invalid assignment');
    }
    if (reserved.has(pin.gpio) || avoided.has(pin.gpio) || assigned.has(pin.gpio)) {
      throw new Error(`EVT pin plan conflicts on GPIO${pin.gpio}`);
    }
    assigned.add(pin.gpio);
  }
  return plan;
}

export function evaluateDomesticProcurement(plan) {
  assertRecord(plan, 'Domestic procurement plan');
  if (plan.currency !== 'CNY') throw new Error('Domestic procurement plan must use CNY');
  if (!Number.isInteger(plan.rigCount) || plan.rigCount < 1) throw new Error('Domestic procurement plan has invalid rig count');
  if (!Array.isArray(plan.items) || !plan.items.length) throw new Error('Domestic procurement plan requires items');
  assertUniqueIds(plan.items, 'Domestic procurement plan');
  const shipping = plan.shippingEstimateCny;
  if (!shipping || !Number.isFinite(shipping.min) || !Number.isFinite(shipping.max) || shipping.min < 0 || shipping.max < shipping.min) {
    throw new Error('Domestic procurement plan has invalid shipping estimate');
  }
  for (const item of plan.items) {
    if (!item.name || !Number.isInteger(item.purchaseQuantity) || item.purchaseQuantity < 1) {
      throw new Error(`Domestic procurement item ${item.id} is incomplete`);
    }
    if (!procurementActions.has(item.action)) throw new Error(`Domestic procurement item ${item.id} has invalid action`);
    if (item.procurementState !== 'not-ordered' && item.procurementState !== 'ordered' && item.procurementState !== 'available') {
      throw new Error(`Domestic procurement item ${item.id} has invalid procurement state`);
    }
    if (!Array.isArray(item.selectionChecks) || !item.selectionChecks.length) {
      throw new Error(`Domestic procurement item ${item.id} requires selection checks`);
    }
    if (typeof item.searchUrl !== 'string' || !item.searchUrl.startsWith('https://s.taobao.com/search?')) {
      throw new Error(`Domestic procurement item ${item.id} requires a Taobao search URL`);
    }
    if (item.action === 'buy-now') {
      const price = item.estimatedUnitPriceCny;
      if (!price || !Number.isFinite(price.min) || !Number.isFinite(price.max) || price.min < 0 || price.max < price.min) {
        throw new Error(`Domestic procurement item ${item.id} has invalid price estimate`);
      }
    } else if (!item.holdReason) {
      throw new Error(`Held domestic procurement item ${item.id} requires a reason`);
    }
  }
  const buyNow = plan.items.filter((item) => item.action === 'buy-now');
  const hardwareMinCny = buyNow.reduce((total, item) => total + (item.estimatedUnitPriceCny.min * item.purchaseQuantity), 0);
  const hardwareMaxCny = buyNow.reduce((total, item) => total + (item.estimatedUnitPriceCny.max * item.purchaseQuantity), 0);
  return Object.freeze({
    profile: plan.profile,
    rigCount: plan.rigCount,
    buyNow: buyNow.length,
    hold: plan.items.length - buyNow.length,
    ordered: plan.items.filter((item) => item.procurementState === 'ordered').length,
    available: plan.items.filter((item) => item.procurementState === 'available').length,
    hardwareMinCny,
    hardwareMaxCny,
    checkoutMinCny: hardwareMinCny + shipping.min,
    checkoutMaxCny: hardwareMaxCny + shipping.max
  });
}

function rectangularVolume(dimensions) {
  return dimensions.reduce((total, value) => total * value, 1);
}

export function evaluateServiceBayFit(bomInput, serviceBayMm) {
  const bom = validateEvtBom(bomInput);
  if (!Array.isArray(serviceBayMm) || serviceBayMm.length !== 3 || serviceBayMm.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Service bay dimensions are invalid');
  }
  const grouped = bom.items.filter((item) => item.packingGroup === 'service-bay');
  const measured = grouped.filter((item) => item.dimensionsMm);
  const minimumComponentVolumeMm3 = measured.reduce((total, item) => (
    total + (rectangularVolume(item.dimensionsMm) * item.quantity)
  ), 0);
  const rawServiceBayVolumeMm3 = rectangularVolume(serviceBayMm);
  return Object.freeze({
    dimensionsMm: Object.freeze([...serviceBayMm]),
    serviceBayVolumeMm3: Math.round(rawServiceBayVolumeMm3 * 10) / 10,
    minimumComponentVolumeMm3: Math.round(minimumComponentVolumeMm3 * 10) / 10,
    minimumFillRatio: Math.round((minimumComponentVolumeMm3 / rawServiceBayVolumeMm3) * 1000) / 1000,
    overCapacity: minimumComponentVolumeMm3 > rawServiceBayVolumeMm3,
    measuredItems: measured.length,
    missingDimensions: Object.freeze(grouped.filter((item) => !item.dimensionsMm).map((item) => item.id))
  });
}

export function validateEvtAcceptance(plan) {
  assertRecord(plan, 'EVT acceptance plan');
  if (!Array.isArray(plan.checks) || !plan.checks.length) throw new Error('EVT acceptance plan requires checks');
  assertUniqueIds(plan.checks, 'EVT acceptance plan');
  for (const check of plan.checks) {
    if (!check.name || !check.category || !check.target) throw new Error(`Acceptance check ${check.id} is incomplete`);
    if (!checkStatuses.has(check.status)) throw new Error(`Acceptance check ${check.id} has invalid status`);
    if (check.status === 'passed' && (!Array.isArray(check.evidence) || !check.evidence.length)) {
      throw new Error(`Passed acceptance check ${check.id} requires evidence`);
    }
    if (check.status === 'blocked' && !check.blocker) throw new Error(`Blocked acceptance check ${check.id} requires a blocker`);
  }
  return plan;
}

export function evaluateProductReadiness(bomInput, planInput, { pinPlan = null, serviceBayMm = null, domesticProcurement = null } = {}) {
  const bom = validateEvtBom(bomInput);
  const plan = validateEvtAcceptance(planInput);
  const selected = bom.items.filter((item) => item.selectionState === 'frozen').length;
  const procured = bom.items.filter((item) => item.procurementState === 'available').length;
  const required = plan.checks.filter((check) => check.required !== false);
  const passed = required.filter((check) => check.status === 'passed');
  const categories = [...new Set(required.map((check) => check.category))].sort().map((category) => {
    const checks = required.filter((check) => check.category === category);
    return {
      category,
      passed: checks.filter((check) => check.status === 'passed').length,
      total: checks.length
    };
  });
  const quotedItems = bom.items.filter((item) => Number.isFinite(item.quotedUnitPriceUsd));
  const quotedSubtotalUsd = quotedItems.reduce((total, item) => (
    total + (item.quotedUnitPriceUsd * item.purchaseQuantity)
  ), 0);
  const hardware = Object.freeze({
    pinPlan: pinPlan ? Object.freeze({ assignments: validateEvtPinPlan(pinPlan).assignments.length, conflicts: 0 }) : null,
    serviceBay: serviceBayMm ? evaluateServiceBayFit(bom, serviceBayMm) : null
  });
  const hardwareReady = !hardware.serviceBay?.overCapacity;
  return Object.freeze({
    model: plan.model || bom.model,
    stage: plan.stage || bom.stage,
    ready: required.length > 0 && passed.length === required.length && hardwareReady,
    bom: Object.freeze({
      total: bom.items.length,
      selected,
      procured,
      quoted: quotedItems.length,
      quotedSubtotalUsd: Math.round(quotedSubtotalUsd * 100) / 100
    }),
    domesticProcurement: domesticProcurement ? evaluateDomesticProcurement(domesticProcurement) : null,
    hardware,
    acceptance: Object.freeze({ total: required.length, passed: passed.length, categories }),
    blockers: Object.freeze(required
      .filter((check) => check.status !== 'passed')
      .map((check) => Object.freeze({ id: check.id, name: check.name, status: check.status, blocker: check.blocker || '尚未开始' })))
  });
}
