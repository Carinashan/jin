/* 难度探针：几种对抗性投球策略下，游戏多久会判负？（不改动 index.html，仅测量） */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/\/\* ==PHYSICS-START== \*\/([\s\S]*?)\/\* ==PHYSICS-END== \*\//)[1];
const CFG = {
  W: 480, H: 780, dangerY: 116, inset: 3, gravity: 2400,
  levels: [{ r: 20, score: 2 }, { r: 25, score: 4 }, { r: 31, score: 8 }, { r: 38, score: 14 }, { r: 46, score: 22 },
           { r: 56, score: 32 }, { r: 68, score: 46 }, { r: 82, score: 64 }, { r: 98, score: 90 },
           { r: 116, score: 130 }, { r: 136, score: 200 }]
};
const DT = 1 / 60;
const sb = { console }; vm.createContext(sb); vm.runInContext(src, sb);
const createWorld = sb.createWorld;
function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
const rr = r => CFG.inset + r + Math.random() * 0; // unused

/* 通用跑法：policy(t, w, put) 每帧调用；put(level,x) 投球 */
function play(name, seconds, policy) {
  const w = createWorld(CFG);
  let t = 0, ended = null, maxN = 0, killed = 0;
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i++) {
    policy(t, w, (lv, x) => w.add(lv, x, 80, 0, 0));
    w.step(DT);
    t += DT;
    if (w.state.bodies.length > maxN) maxN = w.state.bodies.length;
    if (w.state.over) { ended = t; break; }
  }
  const rest = w.state.bodies.length;
  console.log(
    `${name.padEnd(34)} 判负=${(w.state.over ? ended.toFixed(1) + 's' : '否').padEnd(7)}` +
    ` 分数=${String(w.state.score).padStart(6)} 合成=${String(w.state.merges).padStart(4)}` +
    ` 场上=${String(rest).padStart(3)} 峰值=${String(maxN).padStart(3)} 最高级=${w.state.maxLevel}`
  );
  return w;
}
const X = [60, 172, 284, 396];

console.log('\n== 难度探针（每种策略最多模拟 180s）==');
play('A 随机横坐标·只投1级球', 180, (t, w, put) => { const r = rng(11); });
{
  const rnd = rng(11); let k = 0;
  play('A 随机横坐标·只投1级球', 180, (t, w, put) => { if (k < 400 && t > k * 0.75) { put(0, 20 + rnd() * 430); k++; } });
}
{
  let k = 0;
  play('B 固定居中·只投1级球', 180, (t, w, put) => { if (k < 400 && t > k * 0.75) { put(0, 240); k++; } });
}
{
  const rnd = rng(5); let k = 0;
  play('C 随机横坐标·1~3级混合', 180, (t, w, put) => {
    if (k < 400 && t > k * 0.75) { put(Math.floor(rnd() * 3), 20 + rnd() * 430); k++; }
  });
}
{
  let k = 0;
  play('D 四列定点·狂投6级球', 180, (t, w, put) => { if (k < 120 && t > k * 0.5) { put(5, X[k % 4]); k++; } });
}
{
  let k = 0;
  play('E 四列定点·狂投4级球', 180, (t, w, put) => { if (k < 200 && t > k * 0.4) { put(3, X[k % 4]); k++; } });
}
{
  let k = 0;
  play('F 居中·狂投9级大球', 180, (t, w, put) => { if (k < 40 && t > k * 0.9) { put(8, 240); k++; } });
}
console.log('');
