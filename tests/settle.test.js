// tests/settle.test.js — 清算贪心算法单元测试
const assert = require('assert')
const { settle } = require('../miniprogram/utils/settle.js')

function run(name, fn) {
  try { fn(); console.log('  \u2713', name) }
  catch (err) { console.error('  \u2717', name, '\n   ', err.message); process.exitCode = 1 }
}

console.log('settle()')

run('单赢单输：1 笔转账', () => {
  const t = settle([{ nickname: 'A', profit: 100 }, { nickname: 'B', profit: -100 }])
  assert.strictEqual(t.length, 1)
  assert.deepStrictEqual(t[0], { from: 'B', to: 'A', amount: 100 })
})

run('两赢两输：≤ n-1 笔', () => {
  const players = [
    { nickname: 'A', profit:  60 },
    { nickname: 'B', profit:  40 },
    { nickname: 'C', profit: -50 },
    { nickname: 'D', profit: -50 }
  ]
  const t = settle(players)
  assert.ok(t.length <= players.length - 1, `转账数应 ≤ n-1，实为 ${t.length}`)
  // 校验每位玩家最终净额正确
  const net = {}
  players.forEach(p => { net[p.nickname] = 0 })
  t.forEach(x => { net[x.from] -= x.amount; net[x.to] += x.amount })
  players.forEach(p => assert.strictEqual(net[p.nickname], p.profit, `${p.nickname} 净额不对`))
})

run('零和不平衡：拒绝输入应被业务层校验，settle 仍可运行', () => {
  // settle 本身不强制校验，只算可结算部分；此处仅验证不抛
  const t = settle([{ nickname: 'A', profit: 50 }, { nickname: 'B', profit: -30 }])
  assert.ok(Array.isArray(t))
})

run('空输入：返回 []', () => {
  assert.deepStrictEqual(settle([]), [])
  assert.deepStrictEqual(settle([{ nickname: 'A', profit: 0 }]), [])
})

run('多人复杂场景：6 人净额一致', () => {
  const players = [
    { nickname: 'A', profit:  300 },
    { nickname: 'B', profit:  150 },
    { nickname: 'C', profit:   50 },
    { nickname: 'D', profit: -100 },
    { nickname: 'E', profit: -150 },
    { nickname: 'F', profit: -250 }
  ]
  const t = settle(players)
  const net = {}
  players.forEach(p => net[p.nickname] = 0)
  t.forEach(x => { net[x.from] -= x.amount; net[x.to] += x.amount })
  players.forEach(p => assert.strictEqual(net[p.nickname], p.profit))
  assert.ok(t.length <= 5)
})
