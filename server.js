// MAZE DASH 서버 (Node.js, 외부 패키지 없음)
// 실행: node server.js  →  http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_PATH || path.join(__dirname, 'records.json');
const STATIC_DIR = path.join(__dirname, 'static');
const QUEST_COUNT = 10;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };

let records = [];
try { records = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')).filter(r => r && r.quest); } catch (e) { records = []; }
const save = () => { try { fs.writeFileSync(DATA_FILE, JSON.stringify(records)); } catch (e) { console.error('저장 실패', e.message); } };

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

/* 퀘스트별 랭킹: 닉네임마다 최고 기록 1개 */
function questRanking(quest) {
  const best = new Map();
  for (const r of records) {
    if (r.quest !== quest) continue;
    const b = best.get(r.nickname);
    if (!b || r.time_ms < b.time_ms) best.set(r.nickname, r);
  }
  return [...best.values()].sort((a, b) => a.time_ms - b.time_ms || a.id - b.id);
}

/* 전체 랭킹: 클리어한 퀘스트 수가 많은 순, 같으면 총 시간이 짧은 순 */
function totalRanking() {
  const by = new Map();
  for (const r of records) {
    const m = by.get(r.nickname) || by.set(r.nickname, new Map()).get(r.nickname);
    if (!m.has(r.quest) || r.time_ms < m.get(r.quest)) m.set(r.quest, r.time_ms);
  }
  return [...by.entries()]
    .map(([nickname, m]) => ({ nickname, cleared: m.size, total_ms: [...m.values()].reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.cleared - a.cleared || a.total_ms - b.total_ms);
}

function addRecord(d) {
  const nickname = String(d.nickname || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 10);
  const quest = Number(d.quest), moves = Number(d.moves), time = Number(d.time_ms);
  const ok = nickname && Number.isInteger(quest) && quest >= 1 && quest <= QUEST_COUNT &&
             Number.isFinite(moves) && moves > 0 && moves < 100000 && Number.isFinite(time) && time >= 500 && time < 3600000;
  if (!ok) throw new Error('bad');
  const id = records.length ? records[records.length - 1].id + 1 : 1;
  const created_at = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  records.push({ id, created_at, nickname, quest, moves, time_ms: Math.round(time) });
  if (records.length > 5000) records = records.slice(-5000);
  save();
  return questRanking(quest).findIndex(r => r.nickname === nickname) + 1;
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'POST' && url.pathname === '/api/records') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 10000) req.destroy(); });
    req.on('end', () => {
      try { send(res, 201, { ok: true, rank: addRecord(JSON.parse(body || '{}')) }); }
      catch (e) { send(res, 400, { error: '잘못된 요청' }); }
    });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/ranking') {
    return send(res, 200, { top: questRanking(Number(url.searchParams.get('quest'))).slice(0, 10) });
  }
  if (req.method === 'GET' && url.pathname === '/api/total') {
    return send(res, 200, { top: totalRanking().slice(0, 10), quest_count: QUEST_COUNT });
  }
  if (req.method === 'GET' && url.pathname === '/api/stats') {
    const total = records.length;
    return send(res, 200, {
      total,
      players: new Set(records.map(r => r.nickname)).size,
      avg_sec: total ? Math.round(records.reduce((a, r) => a + r.time_ms, 0) / total / 100) / 10 : 0
    });
  }
  if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });

  const file = url.pathname === '/' ? '/index.html' : url.pathname === '/stats' ? '/stats.html' : url.pathname.replace(/^\/static/, '');
  const full = path.normalize(path.join(STATIC_DIR, file));
  if (!full.startsWith(STATIC_DIR)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, data, TYPES[path.extname(full)] || 'application/octet-stream');
  });
}).listen(PORT, () => console.log(`서버 실행 중: http://localhost:${PORT}`));
