const MAX_GAME_NAME_LENGTH = 40
const RISKY_NAME_PATTERN =
  /(赌|博彩|现金|真钱|人民币|rmb|赢\s*钱|充值|提现|兑付|抽水|转账|收款|输赢结算|虚拟\s*筹码\s*买卖)/i
const LEGACY_AUTO_NAME_PATTERN =
  /^(.{1,24})的(?:深夜|周末|欢乐|激烈|经典|传奇|硬核|友谊|神秘|必胜)(?:江湖局|聚会|约局|夜局|桌局|鏖战|对局|切磋|局)(?:\s*[（(]\d{2}-\d{2}[）)])?$/
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

// 仅去空白 + 截断到上限；与客户端一致，不再追加合规后缀
function normalizeGameName(value) {
  return truncate(compact(value))
}

function recoverLegacyNickname(value) {
  const name = compact(value)
  const match = name.match(CURRENT_AUTO_NAME_PATTERN) || name.match(LEGACY_AUTO_NAME_PATTERN)
  return match ? compact(match[1]) : ''
}

module.exports = { hasRiskyGameName, normalizeGameName, recoverLegacyNickname }
