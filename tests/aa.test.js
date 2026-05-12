// tests/aa.test.js
const assert = require('assert')
const { aaEven, aaWinnerByRatio, applyShares } = require('../miniprogram/utils/aa.js')

function run(name, fn) {
  try { fn(); console.log('  \u2713', name) }
  catch (err) { console.error('  \u2717', name, '\n   ', err.message); process.exitCode = 1 }
}

console.log('aaEven()')

run('整除：4 人均摊 100', () => {
  const r = aaEven([
    { openid: 'a', nickname: 'A', profit: 50 },
    { openid: 'b', nickname: 'B', profit: 30 },
    { openid: 'c', nickname: 'C', profit: -40 },
    { openid: 'd', nickname: 'D', profit: -40 }
  ], 100)
  assert.strictEqual(r.length, 4)
  r.forEach(s => assert.strictEqual(s.share, 25))
})

run('不整除：3 人均摊 100，余数从前往后', () => {
  const r = aaEven([
    { openid: 'a', nickname: 'A' }, { openid: 'b', nickname: 'B' }, { openid: 'c', nickname: 'C' }
  ], 100)
  assert.deepStrictEqual(r.map(x => x.share), [34, 33, 33])
  assert.strictEqual(r.reduce((s, x) => s + x.share, 0), 100)
})

run('费用为 0：每人 0', () => {
  const r = aaEven([{ openid: 'a', nickname: 'A' }, { openid: 'b', nickname: 'B' }], 0)
  assert.strictEqual(r[0].share, 0)
})

console.log('aaWinnerByRatio()')

run('两赢家按比例：80/20 → 80/20', () => {
  const r = aaWinnerByRatio([
    { openid: 'a', nickname: 'A', profit:  80 },
    { openid: 'b', nickname: 'B', profit:  20 },
    { openid: 'c', nickname: 'C', profit: -50 },
    { openid: 'd', nickname: 'D', profit: -50 }
  ], 100)
  const map = Object.fromEntries(r.map(s => [s.openid, s.share]))
  assert.strictEqual(map.a, 80)
  assert.strictEqual(map.b, 20)
  assert.strictEqual(map.c, 0)
  assert.strictEqual(map.d, 0)
  assert.strictEqual(r.reduce((s, x) => s + x.share, 0), 100)
})

run('余数补到最大赢家', () => {
  const r = aaWinnerByRatio([
    { openid: 'a', nickname: 'A', profit:  60 },
    { openid: 'b', nickname: 'B', profit:  40 },
    { openid: 'c', nickname: 'C', profit: -100 }
  ], 7)
  // floor: a=4(60/100*7=4.2), b=2(40/100*7=2.8), 余 1 补到 a
  const map = Object.fromEntries(r.map(s => [s.openid, s.share]))
  assert.strictEqual(map.a + map.b, 7)
  assert.ok(map.a >= map.b, '最大赢家应至少不少于次大赢家')
  assert.strictEqual(map.c, 0)
})

run('无赢家退化为 even', () => {
  const r = aaWinnerByRatio([
    { openid: 'a', nickname: 'A', profit: 0 },
    { openid: 'b', nickname: 'B', profit: 0 }
  ], 100)
  assert.strictEqual(r[0].share, 50)
  assert.strictEqual(r[1].share, 50)
})

console.log('applyShares()')

run('合并 AA 后总 finalProfit 仍为 -totalCost（正确）', () => {
  const players = [
    { openid: 'a', nickname: 'A', profit:  60 },
    { openid: 'b', nickname: 'B', profit:  40 },
    { openid: 'c', nickname: 'C', profit: -100 }
  ]
  const shares = aaWinnerByRatio(players, 30)
  const merged = applyShares(players, shares)
  const sum = merged.reduce((s, x) => s + x.finalProfit, 0)
  assert.strictEqual(sum, -30, 'AA 后净额应等于负的总费用')
})
