'use strict';

const { runHiddenGate } = require('./gate');
const { runAgent } = require('./loop');
const { SYSTEM_PROMPT, parseAction } = require('./protocol');
const { buildAgentRunSpec, listSplit, listTaskDirs, loadTask, validateTaskDir } = require('./task');
const { AgentWorker } = require('./worker');
const { Workspace, WorkspaceError } = require('./workspace');

module.exports = Object.freeze({
  AgentWorker, SYSTEM_PROMPT, Workspace, WorkspaceError,
  buildAgentRunSpec, listSplit, listTaskDirs, loadTask, parseAction, runAgent, runHiddenGate, validateTaskDir,
});
