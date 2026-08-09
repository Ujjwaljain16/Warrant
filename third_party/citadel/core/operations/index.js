'use strict';

// NOT UPSTREAM. Subset aggregator written for the warrant repository so the
// verbatim upstream scripts under ../../scripts resolve `require('../core/operations')`.
// Upstream's own index.js aggregates ~20 modules (graph scheduler, compiler, receipts, ...)
// that this repository deliberately does not import. See UPSTREAM_PROVENANCE.md.

module.exports = Object.freeze({
  ...require('./canonical'),
  ...require('./constants'),
  ...require('./journal'),
  ...require('./recovery'),
  DIGEST_PATTERN: require('./validation').DIGEST_PATTERN,
  validateStepAttempt: require('./validation').validateStepAttempt,
});
