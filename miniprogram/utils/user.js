// utils/user.js — 当前用户资料的本地快照（云端 users 才是权威数据）
const GENERIC_NICKNAMES = new Set(['玩家', '庄家', '微信用户', '未设置昵称'])

function normalizeNickname(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function isMeaningfulNickname(value) {
  const nickname = normalizeNickname(value)
  return !!nickname && !GENERIC_NICKNAMES.has(nickname)
}

function readLocalProfile(expectedOpenid = '') {
  const p = wx.getStorageSync('user_profile') || {}
  let lastOpenid = ''
  try {
    lastOpenid = wx.getStorageSync('last_openid') || ''
  } catch (_) {}
  const profile = {
    nickname: normalizeNickname(p.nickname || p.nickName),
    avatar: p.avatarUrl || p.avatar || '',
    updatedAt: p.updatedAt || p.profileUpdatedAt || '',
    openid: p.openid || lastOpenid
  }
  if (expectedOpenid && profile.openid !== expectedOpenid) {
    return { nickname: '', avatar: '', updatedAt: '', openid: profile.openid }
  }
  return profile
}

function writeLocalProfile(profile = {}) {
  const current = readLocalProfile()
  const nickname = normalizeNickname(profile.nickname || profile.nickName || current.nickname)
  const avatar = profile.avatar || profile.avatarUrl || current.avatar || ''
  const updatedAt = profile.updatedAt || profile.profileUpdatedAt || current.updatedAt || ''
  const openid = profile.openid || current.openid || ''
  const next = { nickname, avatarUrl: avatar, updatedAt, openid }
  wx.setStorageSync('user_profile', next)
  return { nickname, avatar, updatedAt, openid }
}

module.exports = {
  isMeaningfulNickname,
  normalizeNickname,
  readLocalProfile,
  writeLocalProfile
}
