// pages/profile/profile.js — 我的（采用 chooseAvatar + nickname 新规范）
const app = getApp()

const DEFAULT_AVATAR = '/images/default-avatar.png'

Page({
  data: {
    avatarUrl: DEFAULT_AVATAR,
    nickname: '',
    editing: false,
    demoMode: false,
    firstTime: false,
    stats: { totalGames: 0, totalProfit: 0, biggestWin: 0, biggestLoss: 0, winRate: 0 }
  },

  onLoad(options) {
    if (options.firstTime === '1') {
      this.setData({ firstTime: true, editing: true })
    }
  },

  async onShow() {
    this.setData({ demoMode: !!app.globalData.demoMode })
    const cached = wx.getStorageSync('user_profile') || {}
    if (cached.nickname) this.setData({ nickname: cached.nickname })
    if (cached.avatarUrl) this.setData({ avatarUrl: cached.avatarUrl })
    await this._refresh()
  },

  async _refresh() {
    try {
      const res = await wx.cloud.callFunction({ name: 'whoami', data: {} })
      const user = res?.result?.user
      const openid = res.result.openid
      if (user?.nickname && !this.data.nickname) this.setData({ nickname: user.nickname })
      if (user?.avatar && this.data.avatarUrl === DEFAULT_AVATAR)
        this.setData({ avatarUrl: user.avatar })
      app.globalData.openid = openid
      app.globalData.userDoc = user
      await this._computeRealStats(openid)
    } catch (err) {
      console.error(err)
    }
  },

  async _computeRealStats(openid) {
    try {
      const db = wx.cloud.database()
      const _ = db.command
      const all = []
      for (let skip = 0; skip < 200; skip += 20) {
        const r = await db
          .collection('games')
          .where({ status: 'ended', players: _.elemMatch({ openid }) })
          .orderBy('endedAt', 'asc')
          .skip(skip)
          .limit(20)
          .get()
        all.push(...r.data)
        if (r.data.length < 20) break
      }
      const filtered = all.filter(
        g => !(Array.isArray(g.hiddenForOpenids) && g.hiddenForOpenids.includes(openid))
      )
      let totalProfit = 0,
        biggestWin = 0,
        biggestLoss = 0,
        wins = 0
      filtered.forEach(g => {
        const me = (g.players || []).find(p => p.openid === openid)
        if (!me) return
        const raw = me.finalProfit ?? me.profit ?? 0
        const ratio = Number(g.scoreRatio) > 0 ? Number(g.scoreRatio) : 1
        const score = Math.round(raw / ratio)
        totalProfit += score
        if (score > biggestWin) biggestWin = score
        if (score < biggestLoss) biggestLoss = score
        if (score > 0) wins++
      })
      const totalGames = filtered.length
      const winRate = totalGames > 0 ? Math.round((wins * 1000) / totalGames) / 10 : 0
      this.setData({ stats: { totalGames, totalProfit, biggestWin, biggestLoss, wins, winRate } })
    } catch (err) {
      console.error(err)
    }
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
    if (!nickname) {
      wx.showToast({ title: '请输入昵称', icon: 'none' })
      return
    }

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

  onStats() {
    wx.navigateTo({ url: '/pages/stats/stats' })
  },
  onHistory() {
    wx.navigateTo({ url: '/pages/history/history' })
  },
  onAbout() {
    wx.navigateTo({ url: '/pages/about/about' })
  },
  onLearnTerms() {
    wx.navigateTo({ url: '/pages/learn-terms/learn-terms' })
  },
  onLearnHandChart() {
    wx.navigateTo({ url: '/pages/learn-hand-chart/learn-hand-chart' })
  },
  onLearnOdds() {
    wx.navigateTo({ url: '/pages/learn-odds/learn-odds' })
  },
  onLearnRules() {
    wx.navigateTo({ url: '/pages/learn-rules/learn-rules' })
  },
  onClearCache() {
    wx.clearStorageSync()
    wx.showToast({ title: '已清除', icon: 'success' })
    this.setData({ avatarUrl: DEFAULT_AVATAR, nickname: '' })
  },

  onResetDemo() {
    wx.showModal({
      title: '重置 Demo 数据',
      content: '将清空当前 mock 数据并恢复初始 5 局历史 + 1 局进行中，仅在 Demo 模式生效',
      success: r => {
        if (!r.confirm) return
        app.resetDemo()
        wx.showToast({ title: '已重置', icon: 'success' })
        setTimeout(() => this._refresh(), 100)
      }
    })
  }
})
