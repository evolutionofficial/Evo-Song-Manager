'use strict';
// MEDIA — pencatatan ke media.log (maks 1 MB, lalu diputar ke media.log.old).
const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '..', 'media.log');

function log(msg, tag = '') {
  const line = `[${new Date().toLocaleString('id-ID')}]${tag ? ' [' + tag + ']' : ''} ${msg}`;
  console.log(line);
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > 1024 * 1024) fs.renameSync(LOG_PATH, LOG_PATH + '.old');
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch (_) { /* log tidak boleh menghentikan program */ }
}

module.exports = { log, LOG_PATH };
