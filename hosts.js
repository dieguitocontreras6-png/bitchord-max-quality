'use strict';

/**
 * Host health memory. archive.org round-robins its storage nodes, and a node
 * can be down for minutes; remembering which hosts recently failed avoids
 * paying the connect timeout on every request.
 */

const SICK_MS = 10 * 60000;
const sickUntil = new Map();

function isSick(host) {
  const until = sickUntil.get(host);
  if (!until) return false;
  if (Date.now() > until) {
    sickUntil.delete(host);
    return false;
  }
  return true;
}

function markSick(host) {
  sickUntil.set(host, Date.now() + SICK_MS);
}

function stats() {
  return { sickHosts: sickUntil.size };
}

module.exports = { isSick, markSick, stats };
