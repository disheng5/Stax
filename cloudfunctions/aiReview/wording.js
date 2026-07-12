// 镜像自 miniprogram/utils/wording.js —— AI 措辞守卫。
// 改动其一必须同步另一处并跑 tests/ai-wording.test.js。
const FORBIDDEN_WORDINGS = [
  '最大输家',
  '独吞',
  'AI 都看不下去了',
  '学费',
  'ATM',
  '别硬刚',
  '别上头',
  '认怂',
  '输得最稳',
  '钱包',
  '及时收手'
]

function hasForbiddenWording(text) {
  if (!text || typeof text !== 'string') return false
  return FORBIDDEN_WORDINGS.some(word => text.includes(word))
}

module.exports = { FORBIDDEN_WORDINGS, hasForbiddenWording }
