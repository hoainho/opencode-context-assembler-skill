'use strict';

const crypto = require('crypto');

function canonicalJSON(value) {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`canonicalJSON: non-finite number ${value} not allowed`);
    }
    return Number.isInteger(value) ? value.toString() : value.toString();
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJSON).join(',') + ']';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const parts = [];
    for (const k of keys) {
      const v = value[k];
      if (v === undefined) continue;
      parts.push(JSON.stringify(k) + ':' + canonicalJSON(v));
    }
    return '{' + parts.join(',') + '}';
  }
  throw new TypeError(`canonicalJSON: unsupported type ${typeof value}`);
}

function sha256(input) {
  const buf = typeof input === 'string' ? input : canonicalJSON(input);
  return crypto.createHash('sha256').update(buf, 'utf8').digest('hex');
}

module.exports = {
  canonicalJSON,
  sha256,
};
