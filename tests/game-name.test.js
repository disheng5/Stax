const assert = require('assert')
const clientPolicy = require('../miniprogram/utils/game-name.js')
const cloudPolicy = require('../cloudfunctions/createGame/game-name.js')

// 自定义名称保持兼容；自动名称使用简短、中性的娱乐记录表达。
assert.strictEqual(clientPolicy.normalizeGameName(' 周末朋友局 '), '周末朋友局')
assert.strictEqual(
  clientPolicy.normalizeGameName('  周末   朋友局  '),
  '周末 朋友局',
  '仅规整空白，不追加任何标识'
)
assert.strictEqual(clientPolicy.buildDefaultGameName('小明', 0), '小明的娱乐手账')
assert.strictEqual(clientPolicy.buildDefaultGameName('小明', 1), '小明的好运记录')
assert.ok(Array.from(clientPolicy.buildDefaultGameName('非常长的昵称'.repeat(10), 1)).length <= 40)
assert.ok(
  clientPolicy.DEFAULT_NAME_IDEAS.every(
    idea =>
      !clientPolicy.hasRiskyGameName(idea) &&
      !/(聚会|交友|社交|赌|牌|筹码|输|赢|盲|对局|约局)/.test(idea)
  ),
  '默认名称应简短、中性，不使用牌面或社交风险表述'
)

;[
  ['eter的神秘聚会（07-10）', 'eter'],
  ['小明的硬核约局 (07-11)', '小明']
].forEach(([name, nickname]) => {
  assert.strictEqual(clientPolicy.recoverLegacyNickname(name), nickname)
  assert.strictEqual(cloudPolicy.recoverLegacyNickname(name), nickname)
})
assert.strictEqual(clientPolicy.recoverLegacyNickname('小明的娱乐手账'), '小明')
assert.strictEqual(cloudPolicy.recoverLegacyNickname('小明的好运记录'), '小明')

;['周末朋友局', '自定义的神秘故事'].forEach(name => {
  assert.strictEqual(clientPolicy.recoverLegacyNickname(name), '', `不应猜测自定义名称：${name}`)
  assert.strictEqual(
    cloudPolicy.recoverLegacyNickname(name),
    '',
    `云函数不应猜测自定义名称：${name}`
  )
})

;['现金局', '今晚抽水', 'RMB 结算', '可以兑付', '充值后参加', '今晚赢钱', '结束后转账'].forEach(
  name => {
    assert.strictEqual(clientPolicy.hasRiskyGameName(name), true, `客户端应拦截：${name}`)
    assert.strictEqual(cloudPolicy.hasRiskyGameName(name), true, `云函数应拦截：${name}`)
  }
)

;['朋友欢乐局', '周末积分练习', '老友局'].forEach(name => {
  assert.strictEqual(clientPolicy.hasRiskyGameName(name), false, `正常名称不应被拦截：${name}`)
  assert.strictEqual(cloudPolicy.normalizeGameName(name), clientPolicy.normalizeGameName(name))
})

console.log('game-name tests passed')
