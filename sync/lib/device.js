'use strict';
// SYNC — identitas komputer ini. Dibuat sekali, lalu dipakai First Club Sync dan Evo Media Agent
// supaya database tahu pekerjaan mana milik komputer mana. Bukan rahasia: hanya nomor acak + nama.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DEVICE_PATH = path.join(__dirname, '..', 'device.json');

function loadDevice() {
  let d = {};
  try { d = JSON.parse(fs.readFileSync(DEVICE_PATH, 'utf8')) || {}; } catch (_) { /* belum ada */ }
  if (!/^[0-9a-f-]{36}$/i.test(String(d.id || ''))) d.id = crypto.randomUUID();
  if (!d.name) d.name = os.hostname() || (process.platform === 'darwin' ? 'MacBook' : 'PC');
  d.platform = process.platform;
  try { fs.writeFileSync(DEVICE_PATH, JSON.stringify({ id: d.id, name: d.name }, null, 2)); }
  catch (_) { /* folder hanya-baca: id tetap dipakai untuk sesi ini */ }
  return d;
}

module.exports = { loadDevice, DEVICE_PATH };
