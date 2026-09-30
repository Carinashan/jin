/* 真实浏览器端到端验收：用 CDP 驱动 Edge headless 打开 index.html，
   模拟鼠标/键盘/触摸操作，截图 + 通过页面自带的 SUIKA 调试钩子读取内部状态。
   需要 danger-full-access（Chromium 的 mojo IPC 用命名管道，沙箱下会被拒）。 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const PAGE = 'file:///E:/AI/1/index.html';
const SHOTS = path.join(__dirname, 'shots');
const REPORT = path.join(__dirname, 'browser_report.json');
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const pageErrors = [];
function rec(ok, name, detail) {
  results.push({ ok: !!ok, name, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? '  \x1b[32mPASS\x1b[0m ' : '  \x1b[31mFAIL\x1b[0m ') + name + (detail !== undefined ? '  → ' + detail : ''));
}
function note(msg) { console.log('  · ' + msg); }

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = {};
    ws.addEventListener('message', ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id);
        if (m.error) rej(new Error('CDP ' + m.id + ' ' + JSON.stringify(m.error))); else res(m.result);
      } else if (m.method) (this.handlers[m.method] || []).forEach(f => f(m.params));
    });
  }
  on(method, fn) { (this.handlers[method] = this.handlers[method] || []).push(fn); }
  send(method, params) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('CDP 超时: ' + method)); } }, 20000);
    });
  }
}

let edgeProc = null;
function killEdge() {
  try { if (edgeProc && !edgeProc.killed) edgeProc.kill(); } catch (e) {}
  try { if (edgeProc) spawn('taskkill', ['/F', '/T', '/PID', String(edgeProc.pid)], { stdio: 'ignore' }); } catch (e) {}
}

const problems = [];
async function main() {
  edgeProc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--mute-audio', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--force-device-scale-factor=1', '--window-size=520,1010',
    '--allow-file-access-from-files',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + path.join(__dirname, '.edgeprofile'),
    'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find(t => t.type === 'page');
    } catch (e) { problems.push('等待 CDP 端口: ' + e.message); }
  }
  if (!target) throw new Error('Edge CDP 未就绪（端口 ' + PORT + '）');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', () => rej(new Error('WebSocket 连接失败')));
  });
  const cdp = new CDP(ws);
  cdp.on('Runtime.exceptionThrown', p => {
    const t = '未捕获异常: ' + ((p.exceptionDetails && p.exceptionDetails.text) || '') + ' ' +
      (((p.exceptionDetails || {}).exception || {}).description || '');
    pageErrors.push(t); note('⚠ ' + t.split('\n')[0]);
  });
  cdp.on('Log.entryAdded', p => {
    if (p.entry && p.entry.level === 'error') { pageErrors.push('日志错误: ' + p.entry.text); note('⚠ ' + p.entry.text); }
  });
  cdp.on('Runtime.consoleAPICalled', p => {
    const txt = p.args.map(a => a.value !== undefined ? a.value : a.description).join(' ');
    if (p.type === 'error' || p.type === 'warning') { pageErrors.push(p.type + ': ' + txt); note('⚠ ' + txt); }
    else note('console.' + p.type + ': ' + txt);
  });

  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: PAGE });
  await sleep(1200);

  const evalJS = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面求值异常: ' + r.exceptionDetails.text + ' ' +
      (((r.exceptionDetails || {}).exception || {}).description || ''));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64'));
    return Buffer.from(r.data, 'base64').length;
  };

  const ua = await evalJS('navigator.userAgent');
  const ver = (ua.match(/Edg\/[\d.]+/) || ['Edge'])[0];
  console.log(`\n== 合成大静子 · 真实浏览器端到端验收（${ver}）==\n`);

  /* ---------- 启动健康检查 ---------- */
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) { ready = await evalJS('document.readyState === "complete" && typeof SUIKA === "object"'); if (!ready) await sleep(200); }
  if (!ready) {
    const diag = await evalJS(`({ readyState: document.readyState, title: document.title, url: location.href,
      hasSuika: typeof SUIKA, hasCreateWorld: typeof createWorld, hasSprites: typeof SPRITE_DATA,
      scripts: document.scripts.length, canvases: document.querySelectorAll('canvas').length,
      cvRect: (document.getElementById('cv') ? JSON.stringify(document.getElementById('cv').getBoundingClientRect()) : 'no #cv'),
      bodyHead: document.body.textContent.slice(0, 160) })`);
    note('诊断：' + JSON.stringify(diag));
    await shot('99-debug.png');
    rec(false, 'A1 页面加载完成、游戏已初始化', JSON.stringify(diag));
    throw new Error('游戏未初始化');
  }
  rec(ready, 'A1 页面加载完成、游戏已初始化');

  const boot = await evalJS(`(function(){
    var r = SUIKA.canvas.getBoundingClientRect();
    return { title: document.title, cssW: Math.round(r.width), cssH: Math.round(r.height),
             pxW: SUIKA.canvas.width, pxH: SUIKA.canvas.height, dpr: window.devicePixelRatio,
             sprites: SUIKA.sprites(), levels: SUIKA.LEVELS.length,
             held: !!SUIKA.held, score: document.getElementById('score').textContent,
             hasNext: !!document.getElementById('nextimg').src,
               innerW: window.innerWidth, innerH: window.innerHeight,
               imgProto: SUIKA.LEVELS.map(function(l){ return l.img; }) };
  })()`);
  rec(boot.title.indexOf('合成大静子') >= 0, 'A2 页面标题正确', boot.title);
  rec(boot.sprites === 5, 'A3 5 张表情包已内联', boot.sprites + ' 张');
  rec(boot.levels === 11, 'A4 等级表 11 级', boot.levels);
  rec(Math.abs(boot.cssW / boot.cssH - 480 / 780) < 0.02 && boot.cssW > 100,
      'A5 画布按 480:780 等比适配', `${boot.cssW}x${boot.cssH} css / ${boot.pxW}x${boot.pxH} px / dpr=${boot.dpr}`);
  rec(boot.held === true && boot.hasNext, 'A6 开局即有待落下的表情包 + NEXT 预览');
  rec(boot.score === '0', 'A7 初始分数为 0', boot.score);
  await shot('01-idle.png');

  /* ---------- 鼠标投球 ---------- */
  const rect = await evalJS(`(function(){ var r = SUIKA.canvas.getBoundingClientRect(); return {left:r.left, top:r.top, width:r.width, height:r.height}; })()`);
  const cx = (logicalX) => rect.left + (logicalX / 480) * rect.width;
  const cy = rect.top + rect.height * 0.32;
  async function mouseDrop(logicalX) {
    const x = cx(logicalX), y = cy;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0, pointerType: 'mouse' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
    await sleep(30);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' });
  }
  const before = await evalJS('SUIKA.state.bodies.length');
  for (let i = 0; i < 6; i++) { await mouseDrop(90 + i * 60); await sleep(430); }
  const afterMouse = await evalJS('({n: SUIKA.state.bodies.length, score: SUIKA.state.score, merged: SUIKA.state.merges})');
  rec(afterMouse.n > before, 'B1 鼠标点击能投放表情包（真实 PointerEvent 路径）',
      `${before} → ${afterMouse.n} 个球，分数 ${afterMouse.score}，合成 ${afterMouse.merged} 次`);
  const colored = await evalJS(`(function(){
    var c = SUIKA.canvas, g = c.getContext('2d');
    var y = Math.max(0, c.height - Math.round(c.height * 0.20));
    var d = g.getImageData(0, y, c.width, 4).data, n = 0;
    for (var i = 0; i < d.length; i += 4){
      var mx = Math.max(d[i], d[i+1], d[i+2]), mn = Math.min(d[i], d[i+1], d[i+2]);
      if (mx - mn > 40) n++;
    }
    return n;
  })()`);
  rec(colored > 20, 'B2 画布上真的画出了彩色表情包（像素采样）', colored + ' 个彩色像素');
  await shot('02-after-mouse-drops.png');

  /* ---------- 键盘 ---------- */
  async function key(k, code, vk) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  }
  const xBefore = await evalJS('SUIKA.aimX');
  await key('ArrowLeft', 'ArrowLeft', 37);
  await key('ArrowLeft', 'ArrowLeft', 37);
  const xAfter = await evalJS('SUIKA.aimX');
  rec(xAfter === Math.max(0, xBefore - 44), 'C1 方向键可左右瞄准', `${xBefore} → ${xAfter}`);
  const nBeforeSpace = await evalJS('SUIKA.state.bodies.length');
  await key(' ', 'Space', 32);
  await sleep(150);
  const nAfterSpace = await evalJS('SUIKA.state.bodies.length');
  rec(nAfterSpace === nBeforeSpace + 1, 'C2 空格键投放表情包', `${nBeforeSpace} → ${nAfterSpace}`);

  /* ---------- 合成与得分 ---------- */
  const beforeMerge = await evalJS('SUIKA.state.merges');
  for (let i = 0; i < 14; i++) { await mouseDrop(240); await sleep(400); }
  const mid = await evalJS('({n: SUIKA.state.bodies.length, score: SUIKA.state.score, merged: SUIKA.state.merges, max: SUIKA.state.maxLevel, hud: document.getElementById("score").textContent})');
  rec(mid.merged > beforeMerge, 'D1 同列投放触发合成', `合成 ${beforeMerge} → ${mid.merged} 次`);
  rec(Number(mid.hud) === mid.score && mid.score > 0, 'D2 HUD 分数与内部状态一致', `HUD=${mid.hud} 内部=${mid.score}`);
  rec(mid.max >= 1, 'D3 合成出的等级在提升', '最高 ' + (mid.max + 1) + ' 级');
  await shot('03-after-merges.png');

  /* ---------- 触摸 + 手机视口 ---------- */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await sleep(500);
  const mrect = await evalJS(`(function(){ var r = SUIKA.canvas.getBoundingClientRect(); return {left:r.left, top:r.top, width:r.width, height:r.height, vw: window.innerWidth, overflow: document.documentElement.scrollWidth - window.innerWidth}; })()`);
  rec(mrect.width <= mrect.vw + 0.5 && mrect.overflow <= 1, 'E1 手机视口下画布自适应、无横向溢出',
      `画布 ${Math.round(mrect.width)}px / 视口 ${mrect.vw}px / 溢出 ${mrect.overflow}px`);
  const nBeforeTouch = await evalJS('SUIKA.state.bodies.length');
  const tx = mrect.left + mrect.width * 0.35, ty = mrect.top + mrect.height * 0.3;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx, y: ty, id: 1 }] });
  await sleep(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: tx + 20, y: ty, id: 1 }] });
  await sleep(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(250);
  const nAfterTouch = await evalJS('SUIKA.state.bodies.length');
  rec(nAfterTouch === nBeforeTouch + 1, 'E2 触摸松手即投放（手机玩法）', `${nBeforeTouch} → ${nAfterTouch}`);
  await shot('04-mobile.png');
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await sleep(400);

  /* ---------- 判负与结束面板 ---------- */
  await evalJS('SUIKA.state.dangerTimer = 1.79; SUIKA.add(0, 240, 90);');
  await sleep(600);
  const over = await evalJS(`({
    over: SUIKA.state.over, paused: SUIKA.paused,
    on: document.getElementById('overlay').classList.contains('on'),
    ovScore: document.getElementById('ovScore').textContent,
    ovMax: document.getElementById('ovMax').textContent,
    ovMerge: document.getElementById('ovMerge').textContent,
    best: localStorage.getItem('suika-face-best'),
    hudBest: document.getElementById('best').textContent
  })`);
  rec(over.over && over.paused && over.on, 'F1 顶到死亡线后弹出结束面板', JSON.stringify({ over: over.over, paused: over.paused, on: over.on }));
  rec(Number(over.ovScore) > 0 && Number(over.ovMax) >= 1 && Number(over.ovMerge) > 0, 'F2 结束面板显示分数/最高级/合成次数',
      `分数=${over.ovScore} 最高=${over.ovMax} 合成=${over.ovMerge}`);
  rec(Number(over.best) >= Number(over.ovScore) && Number(over.hudBest) === Number(over.best), 'F3 最高分写入 localStorage 并同步 HUD',
      `best=${over.best} HUD=${over.hudBest}`);
  await shot('05-gameover.png');

  /* ---------- 重开 ---------- */
  const btn = await evalJS(`(function(){ var r = document.getElementById('ovBtn').getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2}; })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(40);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(700);
  const restarted = await evalJS(`({ on: document.getElementById('overlay').classList.contains('on'), score: SUIKA.state.score,
    hud: document.getElementById('score').textContent, n: SUIKA.state.bodies.length, paused: SUIKA.paused, over: SUIKA.state.over })`);
  rec(!restarted.on && restarted.score === 0 && !restarted.paused && !restarted.over, 'G1 点击「再玩一次」能重开', JSON.stringify(restarted));
  await mouseDrop(150);
  await sleep(400);
  const playable = await evalJS('SUIKA.state.bodies.length');
  rec(playable >= 1, 'G2 重开后可以继续玩', '场上 ' + playable + ' 个球');
  await shot('06-restarted.png');

  rec(pageErrors.length === 0, 'H1 运行期间无 JS 错误/警告', pageErrors.length ? pageErrors[0] : '无');
  return results.filter(r => !r.ok).length;
}

let code = 1;
const watchdog = setTimeout(() => { console.log('✗ 总超时，强制退出'); killEdge(); process.exit(3); }, 300000);
main().then(f => { code = f ? 1 : 0; }).catch(e => { console.log('✗ 未捕获错误: ' + ((e && e.stack) || e)); code = 2; })
  .finally(async () => {
    clearTimeout(watchdog);
    const pass = results.filter(r => r.ok).length, fail = results.length - pass;
    try {
      fs.writeFileSync(REPORT, JSON.stringify({ when: new Date().toISOString(), pass, fail, results, pageErrors, problems }, null, 2));
    } catch (e) {}
    console.log('\n---------------------------------------------');
    console.log(`  浏览器验收：通过 ${pass} / ${results.length}`);
    results.filter(r => !r.ok).forEach(r => console.log('   - ' + r.name + ' → ' + r.detail));
    console.log('  页面运行时错误：' + (pageErrors.length ? pageErrors.length + ' 条' : '无'));
    console.log('  截图目录：' + SHOTS);
    console.log('---------------------------------------------\n');
    killEdge(); await sleep(300); process.exit(code);
  });
