const app = getApp()
const {
  fetchAllGames,
  getCachedGames,
  getCacheVersion,
  clearGamesCache
} = require('../../utils/game-data.js')
const { computeGameStats } = require('../../utils/stats.js')
const avatarCache = require('../../utils/avatar.js')
const {
  isMeaningfulNickname,
  readLocalProfile,
  writeLocalProfile
} = require('../../utils/user.js')

const DEFAULT_AVATAR = '/images/default-avatar.png'

Page({
  data: {
    avatarUrl: DEFAULT_AVATAR,
    avatarDisplayUrl: DEFAULT_AVATAR,
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
    const ver = getCacheVersion()
    const local = readLocalProfile()
    const localMatches =
      !app.globalData.openid || !local.openid || local.openid === app.globalData.openid
    const initial = { demoMode: !!app.globalData.demoMode }
    if (localMatches && local.nickname) initial.nickname = local.nickname
    if (localMatches && local.avatar) {
      initial.avatarUrl = local.avatar
      initial.avatarDisplayUrl =
        avatarCache.displayCached(local.avatar) ||
        (local.avatar.startsWith('cloud://') ? DEFAULT_AVATAR : local.avatar)
    }
    const snapshotOpenid = app.globalData.openid || local.openid
    if (localMatches && snapshotOpenid) {
      const cachedGames = getCachedGames(snapshotOpenid)
      if (cachedGames.length) initial.stats = computeGameStats(cachedGames, snapshotOpenid)
    }
    this.setData(initial)
    if (localMatches && local.avatar) this._resolveOwnAvatar(local.avatar)

    const statsFresh =
      this._lastFetch &&
      Date.now() - this._lastFetch < 30000 &&
      !this._dirty &&
      this._cacheVer === ver
    this._dirty = false
    this._cacheVer = ver
    await this._refresh({ statsFresh })
    this._lastFetch = Date.now()
  },

  _applyProfile(user = {}) {
    const local = readLocalProfile()
    const localMatches =
      !app.globalData.openid || !local.openid || local.openid === app.globalData.openid
    const nickname = isMeaningfulNickname(user.nickname)
      ? user.nickname.trim()
      : localMatches
        ? local.nickname
        : ''
    const avatar = user.avatar || (localMatches ? local.avatar : '') || ''
    const patch = {}
    if (nickname && (!this.data.editing || !this.data.nickname)) patch.nickname = nickname
    if (avatar && (!this.data.editing || this.data.avatarUrl === DEFAULT_AVATAR)) {
      patch.avatarUrl = avatar
      patch.avatarDisplayUrl =
        avatarCache.displayCached(avatar) ||
        (avatar.startsWith('cloud://') ? DEFAULT_AVATAR : avatar)
    }
    if (!localMatches && !isMeaningfulNickname(user.nickname) && !this.data.editing) {
      patch.nickname = ''
      patch.avatarUrl = user.avatar || DEFAULT_AVATAR
      patch.avatarDisplayUrl = user.avatar
        ? avatarCache.displayCached(user.avatar) || DEFAULT_AVATAR
        : DEFAULT_AVATAR
    }
    if (Object.keys(patch).length) this.setData(patch)
    if (avatar) this._resolveOwnAvatar(avatar)
  },

  async _resolveOwnAvatar(fileID) {
    if (!fileID || !fileID.startsWith('cloud://')) return
    const map = await avatarCache.resolveDisplayUrls([fileID])
    if (this.data.avatarUrl === fileID && map[fileID]) {
      this.setData({ avatarDisplayUrl: map[fileID] })
    }
  },

  async _refresh(options = {}) {
    try {
      await app.globalData.openidReady
      const latestUser = await app.refreshCurrentUser({ force: true })
      const openid = app.globalData.openid
      if (!openid) return
      this._applyProfile(latestUser || app.globalData.userDoc || {})
      const cached = getCachedGames(openid)
      if (cached.length) this.setData({ stats: computeGameStats(cached, openid) })
      if (!options.statsFresh || !cached.length) await this._computeRealStats(openid)
    } catch (err) {
      console.error(err)
    }
  },

  async _computeRealStats(openid) {
    try {
      const filtered = await fetchAllGames(openid)
      this.setData({ stats: computeGameStats(filtered, openid) })
    } catch (err) {
      console.error(err)
    }
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail
    this.setData({ avatarUrl, avatarDisplayUrl: avatarUrl, editing: true })
  },

  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value, editing: true })
  },

  async onSaveProfile() {
    const nickname = (this.data.nickname || '').trim()
    if (!isMeaningfulNickname(nickname)) {
      wx.showToast({ title: '请输入你的真实昵称', icon: 'none' })
      return
    }

    let avatarUrl = this.data.avatarUrl === DEFAULT_AVATAR ? '' : this.data.avatarUrl
    const chosenDisplayUrl = this.data.avatarDisplayUrl
    if (avatarUrl && !avatarUrl.startsWith('cloud://')) {
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
      const res = await wx.cloud.callFunction({
        name: 'whoami',
        data: {
          upsertNickname: nickname,
          upsertAvatar: avatarUrl || undefined,
          clientProfileUpdatedAt: Date.now()
        }
      })
      if (!res.result?.ok) throw new Error(res.result?.error || 'SAVE_PROFILE_FAILED')
      const user = res.result.user || { nickname, avatar: avatarUrl }
      const savedAvatar = user.avatar || avatarUrl || ''
      writeLocalProfile({ nickname: user.nickname || nickname, avatar: savedAvatar, updatedAt: user.updatedAt })
      app.globalData.userInfo = { nickName: user.nickname || nickname, avatarUrl: savedAvatar }
      app.applyCurrentUser(res.result.openid || app.globalData.openid, user)
      if (app.globalData.openid) {
        avatarCache.putProfiles(
          [
            {
              openid: app.globalData.openid,
              nickname: user.nickname || nickname,
              avatar: savedAvatar,
              updatedAt: user.updatedAt
            }
          ],
          { source: 'self', authoritative: true }
        )
      }
      this.setData({
        editing: false,
        firstTime: false,
        nickname: user.nickname || nickname,
        avatarUrl: savedAvatar || DEFAULT_AVATAR,
        avatarDisplayUrl:
          avatarCache.displayCached(savedAvatar) || chosenDisplayUrl || DEFAULT_AVATAR
      })
      this._resolveOwnAvatar(savedAvatar)
      this._lastFetch = 0
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
    wx.navigateTo({ url: '/packageLearn/pages/about/about' })
  },
  onLearnTerms() {
    wx.navigateTo({ url: '/packageLearn/pages/learn-terms/learn-terms' })
  },
  onLearnHandChart() {
    wx.navigateTo({ url: '/packageLearn/pages/learn-hand-chart/learn-hand-chart' })
  },
  onLearnOdds() {
    wx.navigateTo({ url: '/packageLearn/pages/learn-odds/learn-odds' })
  },
  onLearnRules() {
    wx.navigateTo({ url: '/packageLearn/pages/learn-rules/learn-rules' })
  },
  onClearCache() {
    const keep = new Set(['user_profile', 'compliance_shown', 'profile_guided', 'last_openid'])
    try {
      const info = wx.getStorageInfoSync()
      ;(info.keys || []).forEach(key => {
        if (!keep.has(key)) wx.removeStorageSync(key)
      })
    } catch (err) {
      console.warn('[clear cache]', err)
    }
    avatarCache.clear()
    clearGamesCache()
    wx.showToast({ title: '缓存已清理，资料已保留', icon: 'none' })
    this._lastFetch = 0
    this.setData({ avatarUrl: DEFAULT_AVATAR, avatarDisplayUrl: DEFAULT_AVATAR })
    this._refresh()
  },

  onResetDemo() {
    wx.showModal({
      title: '重置 Demo 数据',
      content: '将清空当前 mock 数据并恢复初始 5 局历史 + 1 局进行中，仅在 Demo 模式生效',
      success: r => {
        if (!r.confirm) return
        app.resetDemo()
        wx.showToast({ title: '已重置', icon: 'success' })
        this._lastFetch = 0
        setTimeout(() => this._refresh(), 100)
      }
    })
  }
})
