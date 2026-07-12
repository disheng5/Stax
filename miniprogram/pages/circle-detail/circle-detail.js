const app = getApp()
const avatarCache = require('../../utils/avatar.js')

Page({
  data: {
    circleId: '',
    circle: null,
    season: null,
    honors: [],
    members: [],
    me: null,
    myGames: [],
    isOwner: false,
    daysLeft: 0,
    loading: true
  },

  onLoad(options) {
    const circleId = options.id || ''
    this.setData({ circleId })
    if (!circleId) return
    try {
      const snapshot = wx.getStorageSync(`stax_circle_${circleId}`)
      if (snapshot?.view && Date.now() - (snapshot.ts || 0) < 2 * 24 * 60 * 60 * 1000) {
        if (snapshot.circle) {
          this.setData({
            circle: snapshot.circle,
            isOwner: snapshot.circle.ownerOpenid === app.globalData.openid
          })
        }
        this._applyView(snapshot.view)
      }
    } catch (_) {}
  },

  async onShow() {
    // 30s 节流；重置赛季等主动操作直接调 _fetch 不受此限
    if (this._lastFetch && Date.now() - this._lastFetch < 30000) return
    await this._fetch()
    this._lastFetch = Date.now()
  },

  onUnload() {
    this._closeSeasonWatch()
  },

  // 服务端最小视图：不再在客户端直读全量 rankings；隐私裁剪由 getSeasonView 完成。
  async _fetch() {
    if (!this.data.circleId) return
    try {
      await app.globalData.openidReady
      const res = await wx.cloud.callFunction({
        name: 'getSeasonView',
        data: { circleId: this.data.circleId }
      })
      const view = res && res.result
      if (!view || !view.ok) {
        this.setData({ loading: false })
        return
      }
      // 圈子基础信息（名称/成员数/邀请码/owner 判定）仍需 circle 文档
      const db = wx.cloud.database()
      const got = await db
        .collection('circles')
        .doc(this.data.circleId)
        .get()
        .catch(() => null)
      const circle = got && got.data ? got.data : this.data.circle
      if (circle) {
        this.setData({ circle, isOwner: circle.ownerOpenid === app.globalData.openid })
      }
      this._applyView(view)
      this._persistSnapshot(circle, view)
      this._startSeasonWatch(view.season)
    } catch (err) {
      console.error(err)
      this.setData({ loading: false })
    }
  },

  _persistSnapshot(circle = this.data.circle, view) {
    if (!this.data.circleId) return
    try {
      wx.setStorageSync(`stax_circle_${this.data.circleId}`, {
        ts: Date.now(),
        circle,
        view
      })
    } catch (_) {}
  },

  _applyView(view) {
    if (!view) {
      this.setData({ loading: false })
      return
    }
    const season = view.season || null
    let daysLeft = 0
    if (season && season.endAt) {
      const now = new Date()
      daysLeft = Math.max(0, Math.ceil((new Date(season.endAt) - now) / (24 * 60 * 60 * 1000)))
    }
    // 荣誉前三 / 成员：只有头像与昵称（+名次），做本地资料兜底与缓存优先
    avatarCache.putProfiles([...(view.honors || []), ...(view.members || [])], {
      source: 'snapshot'
    })
    const fill = r => {
      const cached = avatarCache.cached(r.openid) || {}
      const avatar = cached.avatar || r.avatar || ''
      const nickname = avatarCache.meaningfulNickname(cached.nickname)
        ? cached.nickname
        : avatarCache.meaningfulNickname(r.nickname)
          ? r.nickname
          : '玩家'
      return {
        ...r,
        nickname,
        avatar,
        displayAvatar:
          avatarCache.displayCached(avatar) ||
          (avatar && !avatar.startsWith('cloud://') ? avatar : '')
      }
    }
    const honors = (view.honors || []).map(fill)
    const members = (view.members || []).map(fill)
    this.setData({
      season,
      honors,
      members,
      me: view.me || null,
      myGames: (view.myGames || []).map(g => this._decorateMyGame(g)),
      daysLeft,
      loading: false
    })
    this._resolveRankProfiles()
    this._resolveRankDisplayAvatars()
  },

  _closeSeasonWatch() {
    if (!this.seasonWatcher) return
    try {
      this.seasonWatcher.close()
    } catch (_) {}
    this.seasonWatcher = null
    this._seasonWatchId = ''
  },

  _startSeasonWatch(season) {
    if (!season || !season.seasonId) {
      this._closeSeasonWatch()
      return
    }
    if (this.seasonWatcher && this._seasonWatchId === season.seasonId) return
    this._closeSeasonWatch()
    this._seasonWatchId = season.seasonId
    try {
      const db = wx.cloud.database()
      this.seasonWatcher = db
        .collection('seasons')
        .doc(season.seasonId)
        .watch({
          // 只作为"数据已变"的信号，收到后重新拉取服务端裁剪视图（不直读 rankings）
          onChange: () => {
            this._lastFetch = 0
            this._fetch()
          },
          onError: err => {
            console.warn('[season watch]', err)
            this._closeSeasonWatch()
          }
        })
    } catch (err) {
      console.warn('[season watch unavailable]', err)
      this._closeSeasonWatch()
    }
  },

  // 荣誉/成员资料以 users 表为准，节流刷新；视图里的头像/昵称只用于首帧。
  async _resolveRankProfiles() {
    const all = [...(this.data.honors || []), ...(this.data.members || [])]
    const shouldRefreshAll =
      !this._rankProfileRefreshAt || Date.now() - this._rankProfileRefreshAt > 60000
    const need = all
      .filter(r => shouldRefreshAll || !r.avatar || !r.nickname || avatarCache.isStale(r.openid))
      .map(r => r.openid)
    if (!need.length) return
    if (this._rankProfileRefreshing) return
    this._rankProfileRefreshing = true
    let map = {}
    try {
      map = await avatarCache.resolve(need, { force: shouldRefreshAll })
      this._rankProfileRefreshAt = Date.now()
    } finally {
      this._rankProfileRefreshing = false
    }
    const patch = list =>
      (list || []).map(r => {
        const latest = map[r.openid]
        if (!latest) return r
        const avatar = latest.avatar || r.avatar || ''
        const nickname = avatarCache.meaningfulNickname(latest.nickname)
          ? latest.nickname
          : r.nickname || '玩家'
        const displayAvatar =
          avatarCache.displayCached(avatar) ||
          (avatar && !avatar.startsWith('cloud://') ? avatar : '')
        return avatar !== r.avatar || nickname !== r.nickname || displayAvatar !== r.displayAvatar
          ? { ...r, avatar, nickname, displayAvatar }
          : r
      })
    this.setData({ honors: patch(this.data.honors), members: patch(this.data.members) })
    this._resolveRankDisplayAvatars()
  },

  async _resolveRankDisplayAvatars() {
    if (this._rankDisplayRefreshing) {
      this._rankDisplayQueued = true
      return
    }
    const all = [...(this.data.honors || []), ...(this.data.members || [])]
    const fileIDs = all.map(rank => rank.avatar).filter(Boolean)
    if (!fileIDs.some(fileID => fileID.startsWith('cloud://'))) return
    this._rankDisplayRefreshing = true
    try {
      const urls = await avatarCache.resolveDisplayUrls(fileIDs)
      const patch = list =>
        (list || []).map(rank => {
          const displayAvatar = urls[rank.avatar] || rank.displayAvatar || ''
          return displayAvatar && displayAvatar !== rank.displayAvatar
            ? { ...rank, displayAvatar }
            : rank
        })
      this.setData({ honors: patch(this.data.honors), members: patch(this.data.members) })
    } finally {
      this._rankDisplayRefreshing = false
      if (this._rankDisplayQueued) {
        this._rankDisplayQueued = false
        setTimeout(() => this._resolveRankDisplayAvatars(), 0)
      }
    }
  },

  _decorateMyGame(g) {
    const d = new Date(g.endedAt)
    const dur = new Date(g.endedAt) - new Date(g.startedAt)
    const h = Math.floor(dur / 3600000)
    const m = Math.floor((dur % 3600000) / 60000)
    return {
      _id: g._id,
      name: g.name,
      playerCount: g.playerCount,
      myProfit: g.myProfit,
      dateStr: `${d.getMonth() + 1}/${d.getDate()}`,
      durationStr: h > 0 ? `${h}h ${m}` : `${m}m`,
      counted: g.counted !== false
    }
  },

  onOpenGame(e) {
    wx.navigateTo({ url: '/pages/game-detail/game-detail?id=' + e.currentTarget.dataset.id })
  },

  // 赛季比赛列表直读 season.gameSummaries（calcSeasonScore 结算时写入），
  // 不再在客户端扫描 games 集合（也绕开了客户端单次 20 条上限）。
  // 老赛季文档没有摘要字段时触发一次重算回填。
  async _loadSeasonGames(circle, season) {
    if (!season) {
      this._setSeasonGames([])
      return
    }
    if (Array.isArray(season.gameSummaries)) {
      this._setSeasonGames(season.gameSummaries)
      return
    }
    try {
      await wx.cloud.callFunction({
        name: 'calcSeasonScore',
        data: { circleId: circle._id }
      })
      const db = wx.cloud.database()
      const s = await db
        .collection('seasons')
        .doc(season._id)
        .get()
        .catch(() => null)
      if (s && s.data) {
        this._applySeason(s.data)
        if (Array.isArray(s.data.gameSummaries)) {
          this._setSeasonGames(s.data.gameSummaries)
          return
        }
      }
    } catch (err) {
      console.error('[loadSeasonGames backfill]', err)
    }
    this._setSeasonGames([])
  },

  onOpenGame(e) {
    wx.navigateTo({ url: '/pages/game-detail/game-detail?id=' + e.currentTarget.dataset.id })
  },

  onRankTap(e) {
    if (!this.data.isOwner) return
    const { openid, name } = e.currentTarget.dataset
    if (!openid) return
    if (openid === app.globalData.openid) {
      wx.showToast({ title: '榜主不能移出自己', icon: 'none' })
      return
    }
    wx.showModal({
      title: '移出积分榜',
      content: `将「${name || '该成员'}」移出「${this.data.circle?.name || '积分榜'}」？`,
      confirmText: '移出',
      confirmColor: '#C8102E',
      success: async r => {
        if (!r.confirm) return
        wx.showLoading({ title: '处理中…' })
        try {
          const res = await wx.cloud.callFunction({
            name: 'removeCircleMember',
            data: { circleId: this.data.circleId, targetOpenid: openid }
          })
          if (!res.result?.ok) {
            wx.hideLoading()
            const msg =
              {
                NOT_OWNER: '仅榜主可操作',
                OWNER_CANNOT_REMOVE: '榜主不能移出自己',
                NOT_MEMBER: '该成员不在积分榜'
              }[res.result?.error] ||
              res.result?.error ||
              '操作失败'
            wx.showToast({ title: msg, icon: 'none' })
            return
          }
          wx.hideLoading()
          wx.showToast({ title: '已移出' })
          this._lastFetch = 0
          await this._fetch()
        } catch (err) {
          wx.hideLoading()
          console.error(err)
          wx.showToast({ title: '网络异常', icon: 'none' })
        }
      }
    })
  },

  onHistory() {
    wx.navigateTo({ url: '/pages/circle-history/circle-history?id=' + this.data.circleId })
  },

  onLeave() {
    wx.showModal({
      title: '退出圈子',
      content: '退出后不再参与排名，已有积分保留。',
      confirmText: '退出',
      confirmColor: '#C8102E',
      success: async r => {
        if (!r.confirm) return
        try {
          const res = await wx.cloud.callFunction({
            name: 'leaveCircle',
            data: { circleId: this.data.circleId }
          })
          if (res.result?.ok) {
            wx.showToast({ title: '已退出' })
            wx.navigateBack()
          } else {
            wx.showToast({ title: res.result?.error || '操作失败', icon: 'none' })
          }
        } catch (_) {
          wx.showToast({ title: '网络异常', icon: 'none' })
        }
      }
    })
  },

  onResetSeason() {
    wx.showModal({
      title: '重置本季积分',
      content: '将清空当前赛季所有积分并重新计算，确定吗？',
      confirmText: '重置',
      confirmColor: '#C8102E',
      success: async r => {
        if (!r.confirm) return
        wx.showLoading({ title: '重置中…' })
        try {
          const res = await wx.cloud.callFunction({
            name: 'resetSeason',
            data: { circleId: this.data.circleId }
          })
          wx.hideLoading()
          if (res.result?.ok) {
            const count = Number(res.result.qualifiedCount) || 0
            wx.showToast({
              title: count > 0 ? `已重算 ${count} 场` : '无合规局入榜',
              icon: 'none'
            })
            this._lastFetch = 0
            await this._fetch()
          } else {
            let msg = res.result?.error || '操作失败'
            if (res.result?.error === 'NO_ACTIVE_SEASON') msg = '当前无进行中赛季'
            else if (res.result?.error === 'CALC_FAILED') msg = '重算失败，请稍后重试'
            wx.showToast({ title: msg, icon: 'none' })
          }
        } catch (_) {
          wx.hideLoading()
          wx.showToast({ title: '网络异常', icon: 'none' })
        }
      }
    })
  },

  onDissolve() {
    wx.showModal({
      title: '解散圈子',
      content: '解散后所有成员将无法查看此圈子。',
      confirmText: '解散',
      confirmColor: '#C8102E',
      success: async r => {
        if (!r.confirm) return
        try {
          const res = await wx.cloud.callFunction({
            name: 'dissolveCircle',
            data: { circleId: this.data.circleId }
          })
          if (res.result?.ok) {
            wx.showToast({ title: '已解散' })
            wx.navigateBack()
          } else {
            wx.showToast({ title: res.result?.error || '操作失败', icon: 'none' })
          }
        } catch (_) {
          wx.showToast({ title: '网络异常', icon: 'none' })
        }
      }
    })
  },

  onShareAppMessage() {
    const c = this.data.circle
    return {
      title: `来「${c.name}」一起切磋，看看谁是魁首`,
      path: `/pages/circle-join/circle-join?code=${c.inviteCode}`
    }
  }
})
