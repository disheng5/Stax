// utils/user.js — 读取本地缓存的昵称头像（兼容新旧授权方式）
function readLocalProfile() {
  const p = wx.getStorageSync('user_profile') || {}
  return {
    nickname: p.nickname || p.nickName || '',
    avatar:   p.avatarUrl || p.avatar || ''
  }
}

module.exports = { readLocalProfile }
