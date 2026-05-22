'use strict';

const { match } = require('./match');
const { collect: collectImpl } = require('./collect');
const { normalize } = require('./normalize');

function createJiraConnector({ mcpClient } = {}) {
  if (!mcpClient || typeof mcpClient.call !== 'function') {
    throw new TypeError('createJiraConnector: mcpClient.call must be a function');
  }
  return {
    source: 'jira',
    match,
    collect: (task) => collectImpl(task, { mcpClient }),
    normalize,
  };
}

const stubConnector = {
  source: 'jira',
  match,
  collect: async (task) => {
    void task;
    throw new Error('jira connector: collect() requires mcpClient — use createJiraConnector({ mcpClient }) instead');
  },
  normalize,
};

module.exports = {
  source: 'jira',
  match,
  collect: stubConnector.collect,
  normalize,
  createJiraConnector,
};
