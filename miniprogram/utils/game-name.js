const MAX_GAME_NAME_LENGTH = 40
const RISKY_NAME_PATTERN =
  /(赌|博彩|现金|真钱|人民币|rmb|赢\s*钱|充值|提现|兑付|抽水|转账|收款|输赢结算|虚拟\s*筹码\s*买卖)/i
const LEGACY_AUTO_NAME_PATTERN =
  /^(.{1,24})的(?:深夜|周末|欢乐|激烈|经典|传奇|硬核|友谊|神秘|必胜)(?:江湖局|聚会|约局|夜局|桌局|鏖战|对局|切磋|局)(?:\s*[（(]\d{2}-\d{2}[）)])?$/
const DEFAULT_NAME_IDEAS = [
  '娱乐手账',
  '好运记录',
  '欢乐小记',
  '今日趣记',
  '趣味手账',
  '轻松记录',
  '开心存档',
  '快乐一刻'
]
const CURRENT_AUTO_NAME_PATTERN =
  /^(.{1,24})的(?:娱乐手账|好运记录|欢乐小记|今日趣记|趣味手账|轻松记录|开心存档|快乐一刻)(?:\s*[（(]\d{2}-\d{2}[）)])?$/

function compact(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

function truncate(value, maxLength = MAX_GAME_NAME_LENGTH) {
  return Array.from(value).slice(0, maxLength).join('')
}

function hasRiskyGameName(value) {
  return RISKY_NAME_PATTERN.test(compact(value))
}

// 自定义名称只规整空白与长度，不收紧旧客户端已能通过的规则。
function normalizeGameName(value) {
  return truncate(compact(value))
}

function recoverLegacyNickname(value) {
  const name = compact(value)
  const match = name.match(CURRENT_AUTO_NAME_PATTERN) || name.match(LEGACY_AUTO_NAME_PATTERN)
  return match ? compact(match[1]) : ''
}

// 当天日期（MM-DD），供默认记录名带上，便于列表区分。
function todayDateTag(date) {
  const d = date instanceof Date ? date : new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function buildDefaultGameName(nickname, variantIndex, date) {
  const host = compact(nickname) || '朋友'
  const pickedIndex = Number.isInteger(variantIndex)
    ? Math.abs(variantIndex) % DEFAULT_NAME_IDEAS.length
    : Math.floor(Math.random() * DEFAULT_NAME_IDEAS.length)
  const suffix = `（${todayDateTag(date)}）`
  const fixed = `的${DEFAULT_NAME_IDEAS[pickedIndex]}${suffix}`
  return `${truncate(host, MAX_GAME_NAME_LENGTH - Array.from(fixed).length)}${fixed}`
}

module.exports = {
  MAX_GAME_NAME_LENGTH,
  DEFAULT_NAME_IDEAS,
  hasRiskyGameName,
  normalizeGameName,
  recoverLegacyNickname,
  todayDateTag,
  buildDefaultGameName
}
