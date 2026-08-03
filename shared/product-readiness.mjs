const selectionStates = new Set(['frozen', 'candidate', 'design-required']);
const procurementStates = new Set(['available', 'digital-only', 'not-ordered', 'ordered']);
const checkStatuses = new Set(['passed', 'failed', 'blocked', 'not-started']);

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
    if (!selectionStates.has(item.selectionState)) throw new Error(`BOM item ${item.id} has invalid selection state`);
    if (!procurementStates.has(item.procurementState)) throw new Error(`BOM item ${item.id} has invalid procurement state`);
  }
  return bom;
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

export function evaluateProductReadiness(bomInput, planInput) {
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
  return Object.freeze({
    model: plan.model || bom.model,
    stage: plan.stage || bom.stage,
    ready: required.length > 0 && passed.length === required.length,
    bom: Object.freeze({ total: bom.items.length, selected, procured }),
    acceptance: Object.freeze({ total: required.length, passed: passed.length, categories }),
    blockers: Object.freeze(required
      .filter((check) => check.status !== 'passed')
      .map((check) => Object.freeze({ id: check.id, name: check.name, status: check.status, blocker: check.blocker || '尚未开始' })))
  });
}
