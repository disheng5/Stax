const app = getApp()
const avatarCache = require('../../utils/avatar.js')

Page({
  data: {
    circleId: '',
    circle: null,
    season: null,
    ranked: [],
    unranked: [],
    seasonGames: [],
    seasonCount: 0,
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
      if (snapshot?.circle && Date.now() - (snapshot.ts || 0) < 2 * 24 * 60 * 60 * 1000) {
        const isOwner = snapshot.circle.ownerOpenid === app.globalData.openid
        this.setData({ circle: snapshot.circle, isOwner })
        this._applySeason(snapshot.season || null)
        if (Array.isArray(snapshot.season?.gameSummaries)) {
          this._setSeasonGames(snapshot.season.gameSummaries)
        }
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

  async _fetch() {
    if (!this.data.circleId) return
    try {
      await app.globalData.openidReady
      const openid = app.globalData.openid
      const db = wx.cloud.database()
      const got = await db.collection('circles').doc(this.data.circleId).get()
      const circle = got.data
      const isOwner = circle.ownerOpenid === openid
      let season = null

      if (circle.currentSeasonId) {
        const s = await db
          .collection('seasons')
          .doc(circle.currentSeasonId)
          .get()
          .catch(() => null)
        if (s && s.data) season = s.data
      }

      this.setData({ circle, isOwner })
      this._applySeason(season)
      this._persistSnapshot(circle, season)
      this._loadSeasonGames(circle, season)
      this._startSeasonWatch(circle, season)
    } catch (err) {
      console.error(err)
      this.setData({ loading: false })
    }
  },

  _persistSnapshot(circle = this.data.circle, season = this.data.season) {
    if (!this.data.circleId || !circle) return
    try {
      wx.setStorageSync(`stax_circle_${this.data.circleId}`, {
        ts: Date.now(),
        circle,
        season
      })
    } catch (_) {}
  },

  _applySeason(season) {
    let ranked = [],
      unranked = [],
      daysLeft = 0
    if (season) {
      const now = new Date()
      daysLeft = Math.max(0, Math.ceil((new Date(season.endAt) - now) / (24 * 60 * 60 * 1000)))
      ranked = (season.rankings || []).filter(r => r.rank > 0).sort((a, b) => a.rank - b.rank)
      unranked = (season.rankings || []).filter(r => r.rank === 0)
    }
    avatarCache.putProfiles([...(ranked || []), ...(unranked || [])], { source: 'snapshot' })
    // users 缓存优先于赛季快照，避免旧排名把刚修改的新资料覆盖回去。
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
    const enrich = r => {
      const wins = Number(r.wins) || 0
      const games = Number(r.games) || 0
      const hasWins = r.wins !== undefined && r.wins !== null
      const winRate = hasWins
        ? games
          ? Math.round((wins * 1000) / games) / 10
          : 0
        : Number(r.winRate) || 0
      return fill({ ...r, winRate })
    }
    ranked = ranked.map(enrich)
    unranked = unranked.map(enrich)
    this.setData({ season, ranked, unranked, daysLeft, loading: false })
    if (this.data.circle) this._persistSnapshot(this.data.circle, season)
    this._resolveRankProfiles()
    this._resolveRankDisplayAvatars()
    this._repairBrokenWinRate(season)
  },

  _isBrokenWinRateSeason(season) {
    if (!season || !Array.isArray(season.rankings)) return false
    const algorithmVersion = Number(season.calculationMeta?.algorithmVersion) || 0
    if (season.rankings.length && algorithmVersion < 4) return true
    const hasGenericProfiles = season.rankings.some(
      rank => !avatarCache.meaningfulNickname(rank.nickname)
    )
    if (hasGenericProfiles) return true
    const played = season.rankings.filter(r => Number(r.games) > 0)
    if (played.length < 2) return false
    const hasAnyWin = played.some(r => Number(r.wins) > 0 || Number(r.winRate) > 0)
    const hasGames = Array.isArray(season.gameSummaries) && season.gameSummaries.length > 0
    return hasGames && !hasAnyWin
  },

  async _repairBrokenWinRate(season) {
    if (!this._isBrokenWinRateSeason(season)) return
    if (this._winRateRepairing === season._id || this._winRateRepairTried === season._id) return
    this._winRateRepairing = season._id
    try {
      await wx.cloud.callFunction({
        name: 'calcSeasonScore',
        data: { circleId: this.data.circleId }
      })
      this._winRateRepairTried = season._id
      const db = wx.cloud.database()
      const latest = await db
        .collection('seasons')
        .doc(season._id)
        .get()
        .catch(() => null)
      if (latest && latest.data) {
        this._applySeason(latest.data)
        if (Array.isArray(latest.data.gameSummaries)) {
          this._setSeasonGames(latest.data.gameSummaries)
        }
      }
    } catch (err) {
      console.error('[repair winRate]', err)
    } finally {
      this._winRateRepairing = ''
    }
  },

  _closeSeasonWatch() {
    if (!this.seasonWatcher) return
    try {
      this.seasonWatcher.close()
    } catch (_) {}
    this.seasonWatcher = null
    this._seasonWatchId = ''
  },

  _startSeasonWatch(circle, season) {
    if (!season || !season._id) {
      this._closeSeasonWatch()
      return
    }
    if (this.seasonWatcher && this._seasonWatchId === season._id) return
    this._closeSeasonWatch()
    this._seasonWatchId = season._id
    try {
      const db = wx.cloud.database()
      this.seasonWatcher = db
        .collection('seasons')
        .doc(season._id)
        .watch({
          onChange: snapshot => {
            const latest = snapshot.docs && snapshot.docs[0]
            if (!latest) return
            this._applySeason(latest)
            if (Array.isArray(latest.gameSummaries)) {
              this._setSeasonGames(latest.gameSummaries)
            }
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

  // 排名资料以 users 表为准，节流刷新；旧 season.rankings 里的头像/昵称只用于首帧。
  async _resolveRankProfiles() {
    const all = [...(this.data.ranked || []), ...(this.data.unranked || [])]
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
    this.setData({ ranked: patch(this.data.ranked), unranked: patch(this.data.unranked) })
    this._resolveRankDisplayAvatars()
  },

  async _resolveRankDisplayAvatars() {
    if (this._rankDisplayRefreshing) {
      this._rankDisplayQueued = true
      return
    }
    const all = [...(this.data.ranked || []), ...(this.data.unranked || [])]
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
      this.setData({ ranked: patch(this.data.ranked), unranked: patch(this.data.unranked) })
    } finally {
      this._rankDisplayRefreshing = false
      if (this._rankDisplayQueued) {
        this._rankDisplayQueued = false
        setTimeout(() => this._resolveRankDisplayAvatars(), 0)
      }
    }
  },

  _decorateSummary(g) {
    const dur = new Date(g.endedAt) - new Date(g.startedAt)
    const h = Math.floor(dur / 3600000)
    const m = Math.floor((dur % 3600000) / 60000)
    const d = new Date(g.endedAt)
    return {
      _id: g._id,
      name: g.name,
      playerCount: g.playerCount,
      dateStr: `${d.getMonth() + 1}/${d.getDate()}`,
      durationStr: h > 0 ? `${h}h ${m}` : `${m}m`,
      excluded: !!g.excluded
    }
  },

  // 统一设置赛季比赛列表 + 计数（本赛季 N 场只数未排除的）
  _setSeasonGames(summaries, season = this.data.season) {
    const list = (summaries || []).map(g => this._decorateSummary(g))
    const listedCount = list.filter(g => !g.excluded).length
    const exactCount = Number(season?.calculationMeta?.qualifiedCount)
    this.setData({
      seasonGames: list,
      seasonCount: Number.isFinite(exactCount) ? exactCount : listedCount
    })
  },

  // 榜主行内排除/恢复某场比赛
  onToggleSeasonGame(e) {
    if (!this.data.isOwner) return
    const { id, excluded } = e.currentTarget.dataset
    const nextExclude = !excluded
    wx.showModal({
      title: nextExclude ? '排除本场' : '恢复本场',
      content: nextExclude ? '该场将不计入本赛季积分与排名。' : '该场将重新计入本赛季积分与排名。',
      confirmText: nextExclude ? '排除' : '恢复',
      success: async r => {
        if (!r.confirm) return
        wx.showLoading({ title: '处理中…' })
        try {
          const res = await wx.cloud.callFunction({
            name: 'excludeGame',
            data: { gameId: id, exclude: nextExclude, circleId: this.data.circleId }
          })
          wx.hideLoading()
          if (!res.result || !res.result.ok) {
            wx.showToast({ title: res.result?.error === 'NOT_HOST' ? '仅榜主可操作' : '操作失败', icon: 'none' })
            return
          }
          // 本地先翻转，界面即时反馈；重算完成后 onShow 再校正为权威数据
          const seasonGames = this.data.seasonGames.map(g =>
            g._id === id ? { ...g, excluded: nextExclude } : g
          )
          this.setData({
            seasonGames,
            seasonCount: Math.max(0, this.data.seasonCount + (nextExclude ? -1 : 1))
          })
          this._lastFetch = 0
          wx.showToast({ title: nextExclude ? '已排除' : '已恢复', icon: 'success' })
        } catch (_) {
          wx.hideLoading()
          wx.showToast({ title: '网络异常', icon: 'none' })
        }
      }
    })
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
