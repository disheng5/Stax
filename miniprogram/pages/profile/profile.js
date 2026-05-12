// pages/profile/profile.js — 我的（采用 chooseAvatar + nickname 新规范）
const app = getApp()

const DEFAULT_AVATAR = '/images/default-avatar.png'

Page({
  data: {
    avatarUrl: DEFAULT_AVATAR,
    nickname: '',
    editing: false,
    stats: { totalGames: 0, totalProfit: 0, biggestWin: 0, biggestLoss: 0, winRate: 0 }
  },

  async onShow() {
    const cached = wx.getStorageSync('user_profile') || {}
    if (cached.nickname) this.setData({ nickname: cached.nickname })
    if (cached.avatarUrl) this.setData({ avatarUrl: cached.avatarUrl })
    await this._refresh()
  },

  async _refresh() {
    try {
      const res = await wx.cloud.callFunction({ name: 'whoami', data: {} })
      const user = res?.result?.user
      if (user?.stats) {
        const s = user.stats
        const winRate = s.totalGames > 0 ? Math.round(((s.wins || 0) * 1000) / s.totalGames) / 10 : 0
        this.setData({ stats: { ...s, winRate } })
      }
      if (user?.nickname && !this.data.nickname) this.setData({ nickname: user.nickname })
      if (user?.avatar  && this.data.avatarUrl === DEFAULT_AVATAR) this.setData({ avatarUrl: user.avatar })
      app.globalData.openid = res.result.openid
      app.globalData.userDoc = user
    } catch (err) { console.error(err) }
  },

  // ===== 新规范：chooseAvatar =====
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail
    this.setData({ avatarUrl, editing: true })
  },

  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value, editing: true })
  },

  async onSaveProfile() {
    const nickname = (this.data.nickname || '').trim()
    if (!nickname) { wx.showToast({ title: '请输入昵称', icon: 'none' }); return }

    let avatarUrl = this.data.avatarUrl
    // 如果是临时文件，需上传云存储拿到 fileID
    if (avatarUrl && !avatarUrl.startsWith('cloud://') && !avatarUrl.startsWith('/')) {
      try {
        wx.showLoading({ title: '上传头像…' })
        const upload = await wx.cloud.uploadFile({
          cloudPath: `avatars/${app.globalData.openid || Date.now()}_${Date.now()}.jpg`,
          filePath: avatarUrl
        })
        avatarUrl = upload.fileID
        wx.hideLoading()
      } catch (err) {
        wx.hideLoading()
        console.error(err)
        wx.showToast({ title: '头像上传失败', icon: 'none' })
        return
      }
    }

    wx.showLoading({ title: '保存中…' })
    try {
      await wx.cloud.callFunction({
        name: 'whoami',
        data: { upsertNickname: nickname, upsertAvatar: avatarUrl }
      })
      wx.setStorageSync('user_profile', { nickname, avatarUrl })
      app.globalData.userInfo = { nickName: nickname, avatarUrl }
      this.setData({ editing: false, avatarUrl })
      wx.hideLoading()
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (err) {
      wx.hideLoading()
      console.error(err)
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  },

  onStats()    { wx.navigateTo({ url: '/pages/stats/stats' }) },
  onHistory()  { wx.navigateTo({ url: '/pages/history/history' }) },
  onAbout()    { wx.navigateTo({ url: '/pages/about/about' }) },
  onClearCache() {
    wx.clearStorageSync()
    wx.showToast({ title: '已清除', icon: 'success' })
    this.setData({ avatarUrl: DEFAULT_AVATAR, nickname: '' })
  }
})
