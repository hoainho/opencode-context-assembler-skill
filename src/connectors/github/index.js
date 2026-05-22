'use strict';

const { match } = require('./match');
const { collect: collectImpl } = require('./collect');
const { normalize } = require('./normalize');

function createGithubConnector({ mcpClient } = {}) {
  if (!mcpClient || typeof mcpClient.call !== 'function') {
    throw new TypeError('createGithubConnector: mcpClient.call must be a function');
  }
  return {
    source: 'github',
    match,
    collect: (task) => collectImpl(task, { mcpClient }),
    normalize,
  };
}

module.exports = {
  source: 'github',
  match,
  collect: async () => {
    throw new Error('github connector: collect() requires mcpClient — use createGithubConnector({ mcpClient }) instead');
  },
  normalize,
  createGithubConnector,
};
