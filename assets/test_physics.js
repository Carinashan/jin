/* 无头物理测试：从 index.html 抽取物理内核（PHYSICS-START/END 之间），在 Node vm 中运行 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(HTML, 'utf8');
const mm = html.match(/\/\* ==PHYSICS-START== \*\/([\s\S]*?)\/\* ==PHYSICS-END== \*\//);
if (!mm) { console.error('✗ 找不到物理内核标记'); process.exit(2); }

/* 用 index.html 里真实参数的一份拷贝（r/img/hue/ring/score 与主程序一致） */
const CFG = {
  W: 480, H: 780, dangerY: 116, inset: 3, gravity: 2400,
  levels: [
    { r: 20,  score: 2   }, { r: 25,  score: 4   }, { r: 31,  score: 8   },
    { r: 38,  score: 14  }, { r: 46,  score: 22  }, { r: 56,  score: 32  },
    { r: 68,  score: 46  }, { r: 82,  score: 64  }, { r: 98,  score: 90  },
    { r: 116, score: 130 }, { r: 136, score: 200 }
  ]
};
const MAXLV = CFG.levels.length - 1;
const DT = 1 / 60;

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(mm[1], sandbox);
const createWorld = sandbox.createWorld;
if (typeof createWorld !== 'function') { console.error('✗ createWorld 未导出'); process.exit(2); }

/* ---------------- 断言工具 ---------------- */
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \x1b[32mPASS\x1b[0m ' + name); }
  else {
    fail++; failures.push(name + (extra ? ' → ' + extra : ''));
    console.log('  \x1b[31mFAIL\x1b[0m ' + name + (extra ? '  → ' + extra : ''));
  }
}
/* 稳定性检查：返回 {bad, worstPen, nan} */
function audit(w) {
  let bad = 0, worstPen = 0, nan = 0;
  const bs = w.state.bodies;
  for (const b of bs) {
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx) || !Number.isFinite(b.vy) ||
        !Number.isFinite(b.angle) || !Number.isFinite(b.r)) { nan++; bad++; continue; }
    const p = Math.max(
      CFG.inset - (b.x - b.r),
      (b.x + b.r) - (CFG.W - CFG.inset),
      (b.y + b.r) - (CFG.H - CFG.inset)
    );
    if (p > 0.01) { bad++; if (p > worstPen) worstPen = p; }
  }
  return { bad, worstPen, nan, n: bs.length };
}
function run(w, seconds, onFrame) {
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i++) {
    w.step(DT);
    if (onFrame) onFrame(i, w);
    if (w.state.over) return i + 1;
  }
  return frames;
}
/* 可复现随机数 */
function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

console.log('\n== 合成大静子 · 物理内核无头测试 ==\n');

/* ---------------- 1. 落地静止 ---------------- */
{
  const w = createWorld(CFG);
  const b = w.add(0, 240, 100, 0, 0);
  run(w, 3);
  const a = audit(w);
  ok('1 落地后静止在地板上', a.bad === 0 && Math.abs(b.vy) < 8 && Math.abs((b.y + b.r) - (CFG.H - CFG.inset)) < 1.5,
     `y=${b.y.toFixed(2)} vy=${b.vy.toFixed(3)} bad=${a.bad}`);
}

/* ---------------- 2. 同级相撞合成（重叠摆位） ---------------- */
{
  const w = createWorld(CFG);
  w.add(0, 200, 300, 0, 0);
  w.add(0, 225, 300, 0, 0);   // 间距 25 < 2r=40 → 立刻重叠
  run(w, 1.0);
  const a = audit(w);
  ok('2 同级相撞合成为 1 球', w.state.merges === 1 && w.state.bodies.length === 1 && a.bad === 0,
     `merges=${w.state.merges} n=${w.state.bodies.length} bad=${a.bad}`);
  ok('2b 合成后等级 +1 且计分正确', w.state.bodies[0] && w.state.bodies[0].level === 1 && w.state.score === CFG.levels[1].score,
     `lv=${w.state.bodies[0] && w.state.bodies[0].level} score=${w.state.score}`);
}

/* ---------------- 3. 异级不合成 ---------------- */
{
  const w = createWorld(CFG);
  w.add(0, 220, 300, 0, 0);
  w.add(1, 250, 300, 0, 0);   // r=20 + r=25 = 45 > 30 → 重叠但不同级
  run(w, 2.5);
  const a = audit(w);
  ok('3 不同级只推挤不合成', w.state.merges === 0 && w.state.bodies.length === 2 && a.bad === 0,
     `merges=${w.state.merges} n=${w.state.bodies.length} bad=${a.bad}`);
}

/* ---------------- 4. 连锁合成 ---------------- */
{
  const w = createWorld(CFG);
  [200, 222, 244, 266].forEach(x => w.add(0, x, 300, 0, 0));
  run(w, 1.5);
  const a = audit(w);
  const lv = w.state.bodies.map(b => b.level).sort((p, q) => p - q);
  ok('4 四连链式合成到 2 级', w.state.merges === 3 && w.state.bodies.length === 1 && lv[0] === 2 && a.bad === 0,
     `merges=${w.state.merges} n=${w.state.bodies.length} levels=[${lv}] bad=${a.bad}`);
  ok('4b 连击加成使得分 > 基础 16', w.state.score > 16, `score=${w.state.score}`);
}

/* ---------------- 5. 一球一帧只合成一次 ---------------- */
{
  const w = createWorld(CFG);
  w.add(0, 240, 300, 0, 0);
  w.add(0, 250, 300, 0, 0);
  w.add(0, 260, 300, 0, 0);
  w.step(DT);
  ok('5 三球重叠单帧只产生 1 次合成', w.state.merges === 1, `merges=${w.state.merges}`);
}

/* ---------------- 6. 顶层双消 ---------------- */
{
  const w = createWorld(CFG);
  w.add(MAXLV, 200, 400, 0, 0);
  w.add(MAXLV, 230, 400, 0, 0);
  run(w, 1.0);
  const ev = w.state.events.filter(e => e.type === 'bigwin');
  ok('6 两个顶级球相撞双消 +500', w.state.bodies.length === 0 && ev.length === 1 && w.state.score === 500,
     `n=${w.state.bodies.length} bigwin=${ev.length} score=${w.state.score}`);
}

/* ---------------- 7. 死亡判定（钉在死亡线上方） ---------------- */
{
  const w = createWorld(CFG);
  const b = w.add(3, 240, CFG.dangerY - 10, 0, 0);
  let t = 0, hit = null;
  run(w, 8, () => {
    t += DT;
    if (!w.state.over) { b.y = CFG.dangerY - 10; b.x = 240; b.vx = 0; b.vy = 0; }
    else if (hit === null) hit = t;
  });
  ok('7 顶住死亡线 1.8s 后判负', w.state.over === true && w.state.events.some(e => e.type === 'gameover'),
     `over=${w.state.over} t=${hit === null ? 'n/a' : hit.toFixed(2)}s`);
  ok('7b 判负耗时约 2.9s（1.1s 成熟 + 1.8s 计时）', hit !== null && hit > 2.5 && hit < 3.6,
     `t=${hit === null ? 'n/a' : hit.toFixed(2)}s`);
}

/* ---------------- 8. 60 球混战：稳定 / 不出界 / 有合成 ---------------- */
{
  const w = createWorld(CFG);
  const rnd = rng(20240531);
  for (let i = 0; i < 60; i++) {
    const lv = Math.floor(rnd() * 6);
    const r = CFG.levels[lv].r;
    w.add(lv, CFG.inset + r + rnd() * (CFG.W - 2 * CFG.inset - 2 * r), 150 + rnd() * 500, (rnd() - 0.5) * 300, (rnd() - 0.5) * 300);
  }
  run(w, 30);
  const a = audit(w);
  ok('8 60 球混战 30s 无 NaN/无出界', a.bad === 0 && Number.isFinite(w.state.score),
     `bad=${a.bad} nan=${a.nan} worstPen=${a.worstPen.toFixed(3)} score=${w.state.score}`);
  ok('8b 混战中有合成发生', w.state.merges > 0, `merges=${w.state.merges}`);
}

/* ---------------- 9. 自动投球稳定性 + 判负可达性 ---------------- */
{
  const w = createWorld(CFG);
  const rnd = rng(777);
  let drops = 0, maxBodies = 0, t = 0;
  run(w, 120, () => {
    t += DT;
    if (drops < 200 && t > drops * 0.75) {
      const r = CFG.levels[0].r;
      w.add(0, CFG.inset + r + rnd() * (CFG.W - 2 * CFG.inset - 2 * r), 80, (rnd() - 0.5) * 40, 0);
      drops++;
    }
    if (w.state.bodies.length > maxBodies) maxBodies = w.state.bodies.length;
  });
  const a = audit(w);
  ok('9 自动投球 120s 稳定（无 NaN/无出界）', a.bad === 0, `bad=${a.bad} worstPen=${a.worstPen.toFixed(3)}`);
  ok('9b 投球能持续得分与合成', w.state.score > 500 && w.state.merges > 30,
     `score=${w.state.score} merges=${w.state.merges} n=${a.n} 峰值=${maxBodies} 最高级=${w.state.maxLevel}`);
}
/* ---------------- 9c. 四列狂投大球：真实玩法下会输 ---------------- */
{
  const w = createWorld(CFG);
  const X = [60, 172, 284, 396];
  let k = 0, t = 0, ended = null;
  run(w, 150, () => {
    t += DT;
    if (k < 200 && t > k * 0.4) { w.add(3, X[k % 4], 80, 0, 0); k++; }
    if (w.state.over && ended === null) ended = t;
  });
  const a = audit(w);
  ok('9c 恶意投球最终会判负（死亡路径真实可达）', w.state.over === true && ended < 150 && a.bad === 0,
     `over=${w.state.over} t=${ended === null ? 'n/a' : ended.toFixed(1) + 's'} n=${a.n} 最高级=${w.state.maxLevel}`);
}
/* ---------------- 9d. 初始密堆压力测试（同级自我合成，不应崩） ---------------- */
{
  const w = createWorld(CFG);
  const step = 126;                       // 6/5 级交错：同级只在斜向，初始互不接触
  for (let row = 0; row < 6; row++)
    for (let col = 0; col < 3; col++) {
      const lv = (row + col) % 2 ? 5 : 6;
      const r = CFG.levels[lv].r;
      w.add(lv, CFG.inset + r + col * step, CFG.H - CFG.inset - 60 - row * step, 0, 0);
    }
  const n0 = w.state.bodies.length;
  run(w, 12);
  const a = audit(w);
  // 注：密堆后同级会互相找到并合成，所以场地"静态塞满"几乎不可达——真正的失败来自动态堆积（见 9c）
  ok('9d 18 球密堆不崩、无出界、靠合成自我疏解', a.bad === 0 && w.state.merges > 0 && a.n < n0,
     `n0=${n0} → n=${a.n} merges=${w.state.merges} bad=${a.bad} worstPen=${a.worstPen.toFixed(3)}`);
}

/* ---------------- 10. 确定性 ---------------- */
{
  function scripted(seed) {
    const w = createWorld(CFG);
    const rnd = rng(seed);
    let t = 0, k = 0;
    run(w, 25, () => {
      t += DT;
      if (k < 30 && t > k * 0.8) { w.add(0, 60 + rnd() * 360, 80, 0, 0); k++; }
    });
    return w;
  }
  const A = scripted(4242), B = scripted(4242);
  let same = A.state.score === B.state.score && A.state.merges === B.state.merges && A.state.bodies.length === B.state.bodies.length;
  if (same) for (let i = 0; i < A.state.bodies.length; i++) {
    if (A.state.bodies[i].x !== B.state.bodies[i].x || A.state.bodies[i].y !== B.state.bodies[i].y) { same = false; break; }
  }
  ok('10 相同输入完全可复现', same,
     `A(score=${A.state.score},m=${A.state.merges},n=${A.state.bodies.length}) B(score=${B.state.score},m=${B.state.merges},n=${B.state.bodies.length})`);
}

/* ---------------- 11. 数量守恒（无凭空生成） ---------------- */
{
  const w = createWorld(CFG);
  for (let i = 0; i < 8; i++) w.add(i % 2 ? 1 : 0, 60 + i * 45, 150 + (i % 3) * 60, 0, 0); // 间隔足够，互不接触
  run(w, 12);
  const a = audit(w);
  ok('11 互不接触时球数守恒', a.n === 8 && w.state.merges === 0 && a.bad === 0,
     `n=${a.n} merges=${w.state.merges} bad=${a.bad}`);
}

/* ---------------- 12. 重置 ---------------- */
{
  const w = createWorld(CFG);
  w.add(0, 240, 300, 0, 0); w.add(0, 250, 300, 0, 0);
  run(w, 1);
  w.reset();
  ok('12 reset 清空状态', w.state.bodies.length === 0 && w.state.score === 0 && w.state.merges === 0 &&
     w.state.over === false && w.state.events.length === 0,
     JSON.stringify({ n: w.state.bodies.length, score: w.state.score, over: w.state.over }));
  const b = w.add(0, 240, 200, 0, 0);
  run(w, 3);
  ok('12b reset 后可继续正常游戏', audit(w).bad === 0 && Math.abs(b.vy) < 8, `vy=${b.vy.toFixed(3)}`);
}

/* ---------------- 汇总 ---------------- */
console.log('\n---------------------------------------------');
console.log(`  通过 ${pass} / ${pass + fail}`);
if (fail) { console.log('  失败项：'); failures.forEach(f => console.log('   - ' + f)); }
console.log('---------------------------------------------\n');
process.exit(fail ? 1 : 0);
