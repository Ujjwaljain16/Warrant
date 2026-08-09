'use strict';
// Profile upstream graph scheduler: drive an N-node layered DAG to completion, time per-transition cost.
const ops = require(require('path').resolve(process.argv[2] || process.env.CITADEL_UPSTREAM || '../citadel-upstream', 'core/operations'));
const D = (c) => 'sha256:' + c.repeat(64);
function build(n, width) {
  const nodes = [], edges = [];
  for (let i = 0; i < n; i++) nodes.push({ node_id: 'n' + i, step_id: 'n' + i, node_kind: 'deterministic',
    input_schema_digest: D('b'), output_schema_digest: D('c'), executor_profile: 'local', scope_digest: D('d'),
    timeout_ms: 1000, max_attempts: 1, max_visits: 1, effect_class: 'pure',
    verifier: { required: false, policy: 'none', evidence_types: [] } });
  for (let i = width; i < n; i++) edges.push({ edge_id: `e${i}`, from_node_id: 'n' + (i - width), to_node_id: 'n' + i,
    edge_kind: 'success', condition_digest: null, data_contract_digest: null });
  return { graph_version: '0.1', kind: 'operation_graph_spec', graph_id: 'perf', operation_spec_digest: D('a'),
    entry_node_ids: nodes.slice(0, width).map((x) => x.node_id), nodes, edges, joins: [],
    limits: { max_transitions: 100000, max_parallel: 4, max_total_attempts: 100000 }, created_at: '2026-07-21T00:00:00.000Z' };
}
for (const n of [20, 50, 100, 200]) {
  const g = build(n, 4);
  const t0 = process.hrtime.bigint();
  let st = ops.createGraphState ? ops.createGraphState(g) : null;
  let transitions = 0;
  for (;;) {
    const ev = ops.evaluateGraph(g, st);
    if (ev.complete) break;
    const id = ev.ready_node_ids[0] || ev.running_node_ids[0];
    if (!id) throw new Error('stuck');
    if (ev.ready_node_ids.includes(id)) { st = ops.transitionNode(g, st, id, 'running'); }
    else st = ops.transitionNode(g, st, id, 'passed');
    transitions++;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`nodes=${n} transitions=${transitions} total=${ms.toFixed(1)}ms per_transition=${(ms / transitions).toFixed(3)}ms`);
}
