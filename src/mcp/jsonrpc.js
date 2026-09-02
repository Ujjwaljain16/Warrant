'use strict';

// MCP revisions this server speaks. MODERN_VERSION is the current revision (stateless: no initialize handshake, every
// request carries its version in _meta, server/discover). The legacy revisions use the initialize handshake; the server
// serves both eras (docs/MCP.md).
const MODERN_VERSION = '2026-07-28';
const LEGACY_VERSIONS = Object.freeze(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']);
const SUPPORTED_VERSIONS = Object.freeze([MODERN_VERSION, ...LEGACY_VERSIONS]);

const META = Object.freeze({
  version: 'io.modelcontextprotocol/protocolVersion',
  capabilities: 'io.modelcontextprotocol/clientCapabilities',
  clientInfo: 'io.modelcontextprotocol/clientInfo',
  serverInfo: 'io.modelcontextprotocol/serverInfo',
});

const CODES = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  UNSUPPORTED_PROTOCOL_VERSION: -32022, // 2026-07-28
});

// A protocol-level failure: becomes a JSON-RPC error response.
class RpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
  }
}

// A tool-execution failure: becomes a normal result with isError: true, so the model can read it and adjust.
class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}

// Splits a byte stream into newline-delimited messages without ever buffering more than maxBytes of one message.
// An over-long line yields one { oversize: true } item, and the rest of that line is discarded.
class LineSplitter {
  constructor(maxBytes) {
    this.max = maxBytes;
    this.chunks = [];
    this.size = 0;
    this.discarding = false;
  }

  push(buf) {
    const out = [];
    let start = 0;
    for (;;) {
      const nl = buf.indexOf(0x0a, start);
      if (nl === -1) { this._append(buf.subarray(start), out); return out; }
      this._append(buf.subarray(start, nl), out);
      if (this.discarding) this.discarding = false;
      else out.push({ line: this._take() });
      start = nl + 1;
    }
  }

  // Anything left when the stream ends is a final, unterminated message.
  end() {
    if (this.discarding || this.size === 0) return [];
    return [{ line: this._take() }];
  }

  _take() {
    const text = Buffer.concat(this.chunks).toString('utf8').replace(/\r$/, '');
    this.chunks = [];
    this.size = 0;
    return text;
  }

  _append(part, out) {
    if (this.discarding || part.length === 0) return;
    this.size += part.length;
    if (this.size > this.max) {
      this.discarding = true;
      this.chunks = [];
      this.size = 0;
      out.push({ oversize: true });
      return;
    }
    this.chunks.push(part);
  }
}

module.exports = Object.freeze({
  CODES, LEGACY_VERSIONS, LineSplitter, META, MODERN_VERSION, RpcError, SUPPORTED_VERSIONS, ToolError,
});
