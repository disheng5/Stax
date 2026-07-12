const assert = require('assert')
const { FORBIDDEN_WORDINGS, hasForbiddenWording } = require('../miniprogram/utils/wording.js')

// === 所有禁用措辞必须被检测到 ===
FORBIDDEN_WORDINGS.forEach(word => {
  assert.strictEqual(hasForbiddenWording(`今晚${word}了`), true, `"${word}" 应命中`)
})

// === 中性表述不应命中 ===
const safeTexts = [
  '今晚 MVP：Alice，贡献了全场最大正积分。',
  '近 5 场回升，进攻选择比上一段更有效。',
  '结果在短期里很响，决策质量通常更安静。',
  '兵贵胜，不贵久。',
  '善战者，致人而不致于人。',
  '买入 3 手，共 11 手。',
  '本场积分 +1100。',
  '全场 6 次买入。'
]
safeTexts.forEach(text => {
  assert.strictEqual(hasForbiddenWording(text), false, `应安全：${text}`)
})

// === 空值/undefined 安全 ===
assert.strictEqual(hasForbiddenWording(''), false)
assert.strictEqual(hasForbiddenWording(null), false)
assert.strictEqual(hasForbiddenWording(undefined), false)

console.log('ai-wording.test.js passed')
