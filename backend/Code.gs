// ACC Scoreboard backend. A web app bound to the Google Sheet that holds the data.
// GET returns the live draw; POST takes {action, pin, ...} and returns the live draw.
// PINs live in Script Properties: ADMIN_PIN (draw setup) and SCORE_PIN (score entry).

var TABS = {
  Draws: ['id', 'name', 'date', 'ends', 'minutes', 'startedAt', 'leftMs', 'showTimer'],
  Games: ['drawId', 'sheet', 'team1', 'logo1', 'team2', 'logo2', 'stone1', 'hammer', 'ends', 'final'],
  Logos: ['id', 'name', 'data']
};
var CACHE_KEY = 'live-draw';
var MAX_LOGO_CHARS = 45000; // A Sheet cell holds 50,000 characters.
var MAX_PIN_FAILURES = 10;

var ACTIONS = {
  login: { role: 'score', fn: function () { return {}; }, noLock: true },
  timer: { role: 'score', fn: timerAction },
  setEnd: { role: 'score', fn: setEnd },
  swapHammer: { role: 'score', fn: swapHammer },
  setFinal: { role: 'score', fn: setFinal },
  saveDraw: { role: 'admin', fn: saveDraw },
  deleteDraw: { role: 'admin', fn: deleteDraw },
  goLive: { role: 'admin', fn: goLive },
  saveLogo: { role: 'admin', fn: saveLogo },
  deleteLogo: { role: 'admin', fn: deleteLogo }
};

// Run once from the editor to create the tabs.
function setup() {
  var book = SpreadsheetApp.getActive();
  Object.keys(TABS).forEach(function (name) {
    var sheet = book.getSheetByName(name) || book.insertSheet(name);
    sheet.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]);
    sheet.setFrozenRows(1);
  });
}

function doGet(e) {
  var params = (e && e.parameter) || {};
  return respond(function () {
    if (params.action === 'logos') return { logos: readTab('Logos') };
    if (params.action === 'draws') return { draws: allDraws(), liveId: liveId() };
    return {};
  });
}

function doPost(e) {
  return respond(function () {
    var body = JSON.parse(e.postData.contents);
    var action = ACTIONS[body.action];
    if (!action) throw new Error('Unknown action');
    var role = checkPin(body.pin, action.role);
    if (action.noLock) return { role: role };
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      var result = action.fn(body) || {};
      cacheLive(buildLive());
      return result;
    } finally {
      lock.releaseLock();
    }
  });
}

function respond(work) {
  var out;
  try {
    out = work();
    out.ok = true;
    out.draw = liveDraw();
  } catch (err) {
    out = { ok: false, error: err.message };
  }
  out.now = Date.now();
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function checkPin(pin, role) {
  var cache = CacheService.getScriptCache();
  var failures = Number(cache.get('pin-failures')) || 0;
  if (failures >= MAX_PIN_FAILURES) throw new Error('Too many wrong PINs. Try again in 5 minutes.');
  var props = PropertiesService.getScriptProperties();
  var adminPin = props.getProperty('ADMIN_PIN');
  var scorePin = props.getProperty('SCORE_PIN');
  pin = String(pin === undefined ? '' : pin);
  var held = pin && pin === adminPin ? 'admin' : pin && pin === scorePin ? 'score' : '';
  if (!held) cache.put('pin-failures', String(failures + 1), 300);
  if (!held || (role === 'admin' && held !== 'admin')) throw new Error('Wrong PIN');
  return held;
}

// ----- Sheet access. Every cell is stored as text so a team name is never run as a formula.

function readTab(name) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(name);
  var columns = TABS[name];
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, columns.length).getValues().map(function (row, i) {
    var item = { _row: i + 2 };
    columns.forEach(function (column, c) { item[column] = row[c]; });
    return item;
  });
}

function writeRow(name, rowNumber, item) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(name);
  var columns = TABS[name];
  if (rowNumber > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 50);
  sheet.getRange(rowNumber, 1, 1, columns.length)
    .setNumberFormat('@')
    .setValues([columns.map(function (column) { return String(item[column]); })]);
}

function appendRow(name, item) {
  writeRow(name, SpreadsheetApp.getActive().getSheetByName(name).getLastRow() + 1, item);
}

function deleteRows(name, rows) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(name);
  rows.map(function (row) { return row._row; }).sort(function (a, b) { return b - a; })
    .forEach(function (rowNumber) { sheet.deleteRow(rowNumber); });
}

// ----- Reading draws

function toGame(row) {
  return {
    sheet: Number(row.sheet), team1: String(row.team1), logo1: String(row.logo1),
    team2: String(row.team2), logo2: String(row.logo2), stone: String(row.stone1),
    hammer: Number(row.hammer), ends: JSON.parse(row.ends || '[]'), final: String(row.final) === 'true'
  };
}

function toDraw(row, games) {
  return {
    id: String(row.id), name: String(row.name), date: String(row.date), ends: Number(row.ends),
    minutes: Number(row.minutes), startedAt: Number(row.startedAt), leftMs: Number(row.leftMs),
    showTimer: String(row.showTimer) !== 'false', // Draws saved before this setting existed are blank.
    games: games.filter(function (game) { return String(game.drawId) === String(row.id); })
      .map(toGame).sort(function (a, b) { return a.sheet - b.sheet; })
  };
}

function allDraws() {
  var games = readTab('Games');
  return readTab('Draws').map(function (row) { return toDraw(row, games); });
}

function liveId() {
  return PropertiesService.getScriptProperties().getProperty('LIVE_DRAW') || '';
}

function buildLive() {
  var id = liveId();
  var row = readTab('Draws').filter(function (draw) { return String(draw.id) === id; })[0];
  return row ? toDraw(row, readTab('Games')) : null;
}

function liveDraw() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(CACHE_KEY);
  if (hit) return JSON.parse(hit).draw;
  var draw = buildLive();
  cacheLive(draw);
  return draw;
}

function cacheLive(draw) {
  CacheService.getScriptCache().put(CACHE_KEY, JSON.stringify({ draw: draw }), 60);
}

function findDraw(id) {
  var row = readTab('Draws').filter(function (draw) { return String(draw.id) === String(id); })[0];
  if (!row) throw new Error('That draw no longer exists');
  return row;
}

function findGame(drawId, sheet) {
  var row = readTab('Games').filter(function (game) {
    return String(game.drawId) === String(drawId) && Number(game.sheet) === Number(sheet);
  })[0];
  if (!row) throw new Error('That game no longer exists');
  return row;
}

// ----- Admin actions

function cleanText(value, limit) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, limit);
}

function saveDraw(body) {
  var draw = body.draw;
  var minutes = Math.min(Math.max(Number(draw.minutes) || 95, 1), 600);
  var row = draw.id ? findDraw(draw.id) : null;
  var item = row || { id: Utilities.getUuid().slice(0, 8), startedAt: 0, leftMs: minutes * 60000 };
  if (row && !Number(row.startedAt) && Number(row.leftMs) === Number(row.minutes) * 60000) item.leftMs = minutes * 60000;
  item.name = cleanText(draw.name, 60) || 'Draw';
  item.date = cleanText(draw.date, 10);
  item.ends = Math.min(Math.max(Number(draw.ends) || 8, 1), 12);
  item.minutes = minutes;
  item.showTimer = draw.showTimer !== false;
  if (row) writeRow('Draws', row._row, item); else appendRow('Draws', item);

  var existing = readTab('Games').filter(function (game) { return String(game.drawId) === String(item.id); });
  for (var sheet = 1; sheet <= 4; sheet++) {
    var game = (draw.games || []).filter(function (g) { return Number(g.sheet) === sheet; })[0] || {};
    var current = existing.filter(function (g) { return Number(g.sheet) === sheet; })[0];
    var next = current || { drawId: item.id, sheet: sheet, ends: '[]', final: false };
    next.team1 = cleanText(game.team1, 40);
    next.team2 = cleanText(game.team2, 40);
    next.logo1 = cleanText(game.logo1, 40);
    next.logo2 = cleanText(game.logo2, 40);
    next.stone1 = game.stone === 'blue' ? 'blue' : 'red';
    next.hammer = Number(game.hammer) === 1 ? 1 : 0;
    if (current) writeRow('Games', current._row, next); else appendRow('Games', next);
  }
  if (!liveId()) PropertiesService.getScriptProperties().setProperty('LIVE_DRAW', item.id);
  return { id: item.id };
}

function deleteDraw(body) {
  findDraw(body.id);
  deleteRows('Games', readTab('Games').filter(function (g) { return String(g.drawId) === String(body.id); }));
  deleteRows('Draws', readTab('Draws').filter(function (d) { return String(d.id) === String(body.id); }));
  if (liveId() === String(body.id)) PropertiesService.getScriptProperties().deleteProperty('LIVE_DRAW');
}

function goLive(body) {
  findDraw(body.id);
  PropertiesService.getScriptProperties().setProperty('LIVE_DRAW', String(body.id));
}

function saveLogo(body) {
  var data = String(body.data || '');
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(data)) throw new Error('That is not a supported image');
  if (data.length > MAX_LOGO_CHARS) throw new Error('That image is too large');
  var item = { id: Utilities.getUuid().slice(0, 8), name: cleanText(body.name, 40) || 'Logo', data: data };
  appendRow('Logos', item);
  return { id: item.id };
}

function deleteLogo(body) {
  deleteRows('Logos', readTab('Logos').filter(function (logo) { return String(logo.id) === String(body.id); }));
}

// ----- Score entry actions

function timerAction(body) {
  var row = findDraw(body.id);
  var now = Date.now();
  var startedAt = Number(row.startedAt);
  var left = Number(row.leftMs);
  var running = startedAt > 0;
  if (body.op === 'start') {
    if (!running) startedAt = now;
  } else if (body.op === 'pause') {
    if (running) { left -= now - startedAt; startedAt = 0; }
  } else if (body.op === 'adjust') {
    left += Number(body.ms) || 0;
  } else if (body.op === 'reset') {
    left = Number(row.minutes) * 60000;
    startedAt = 0;
  } else {
    throw new Error('Unknown timer action');
  }
  row.startedAt = startedAt;
  row.leftMs = left;
  writeRow('Draws', row._row, row);
}

// An end is {team: 0|1, pts: 1-8} or, for a blank end, {team: null, pts: 0}.
// end: null removes the last end. An index equal to the end count adds the next end.
function setEnd(body) {
  var row = findGame(body.drawId, body.sheet);
  var ends = JSON.parse(row.ends || '[]');
  var index = Number(body.index);
  if (!(index >= 0) || index > ends.length || index >= 20) throw new Error('That end is out of order. Refresh and try again.');
  if (body.end === null) {
    if (index !== ends.length - 1) throw new Error('Only the last end can be cleared');
    ends.pop();
  } else {
    var team = body.end.team === null ? null : Number(body.end.team);
    var pts = Number(body.end.pts);
    var valid = team === null ? pts === 0 : (team === 0 || team === 1) && pts >= 1 && pts <= 8 && pts % 1 === 0;
    if (!valid) throw new Error('That is not a valid score');
    ends[index] = { team: team, pts: pts };
  }
  row.ends = JSON.stringify(ends);
  writeRow('Games', row._row, row);
}

function swapHammer(body) {
  var row = findGame(body.drawId, body.sheet);
  row.hammer = Number(row.hammer) === 1 ? 0 : 1;
  writeRow('Games', row._row, row);
}

function setFinal(body) {
  var row = findGame(body.drawId, body.sheet);
  row.final = body.final === true;
  writeRow('Games', row._row, row);
}
