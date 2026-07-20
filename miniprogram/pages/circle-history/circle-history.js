const avatarCache = require('../../utils/avatar.js')

Page({
  data: { circleId: '', seasons: [], loading: true },

  onLoad(options) {
    this.setData({ circleId: options.id || '' })
  },

  async onShow() {
    if (!this.data.circleId) return
    try {
      const db = wx.cloud.database()
      const query = () =>
        db
          .collection('seasons')
          .where({ circleId: this.data.circleId, status: 'settled' })
          .orderBy('settledAt', 'desc')
      const first = await query().limit(20).get()
      let all = first.data || []
      for (let skip = 20; all.length === skip; skip += 20) {
        const page = await query().skip(skip).limit(20).get()
        all = all.concat(page.data || [])
        if ((page.data || []).length < 20) break
      }
      const seasons = all.map(s => this._decorate(s))
      this.setData({ seasons, loading: false })
      this._resolveDisplayAvatars()
    } catch (err) {
      console.error(err)
      this.setData({ loading: false })
    }
  },

  // 战报卡只用结果数据：最终前三、赛季区间、计入局数；不展示过程信息
  _decorate(s) {
    const fill = r => {
      const cached = avatarCache.cached(r.openid) || {}
      const avatar = cached.avatar || r.avatar || ''
      return {
        rank: r.rank,
        openid: r.openid,
        nickname: avatarCache.meaningfulNickname(cached.nickname)
          ? cached.nickname
          : r.nickname || '玩家',
        avatar,
        displayAvatar:
          avatarCache.displayCached(avatar) ||
          (avatar && !avatar.startsWith('cloud://') ? avatar : '')
      }
    }
    const top3 = (s.rankings || [])
      .filter(r => r.rank > 0 && r.rank <= 3 && (r.games || 0) > 0)
      .sort((a, b) => a.rank - b.rank)
      .map(fill)
    const fmt = value => {
      const d = new Date(value)
      return `${d.getMonth() + 1}.${d.getDate()}`
    }
    const gamesCount = Array.isArray(s.gameSummaries)
      ? s.gameSummaries.filter(g => !g.excluded).length
      : Number(s.calculationMeta?.qualifiedCount) || 0
    return {
      _id: s._id,
      seasonName: s.seasonName,
      champion: top3.find(r => r.rank === 1) || null,
      runners: top3.filter(r => r.rank > 1),
      dateRange: s.startAt && s.endAt ? `${fmt(s.startAt)} - ${fmt(s.endAt)}` : '',
      gamesCount
    }
  },

  // 头像展示 URL 后台补齐，只在有变化时提交一次
  async _resolveDisplayAvatars() {
    const fileIDs = []
    this.data.seasons.forEach(s => {
      ;[s.champion, ...(s.runners || [])].forEach(r => {
        if (r && r.avatar && r.avatar.startsWith('cloud://')) fileIDs.push(r.avatar)
      })
    })
    if (!fileIDs.length) return
    try {
      const urls = await avatarCache.resolveDisplayUrls(fileIDs)
      let changed = false
      const patchRow = r => {
        if (!r || !r.avatar) return r
        const url = urls[r.avatar]
        if (!url || url === r.displayAvatar) return r
        changed = true
        return { ...r, displayAvatar: url }
      }
      const next = this.data.seasons.map(s => ({
        ...s,
        champion: patchRow(s.champion),
        runners: (s.runners || []).map(patchRow)
      }))
      if (changed) this.setData({ seasons: next })
    } catch (err) {
      console.warn('[circle-history avatars]', err)
    }
  }
})
