// components/blind-timer/blind-timer.js — 盲注计时器（断线可恢复）
function pad(n) {
  return n < 10 ? '0' + n : '' + n
}
function toMs(value) {
  if (!value) return NaN
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value === 'string') return new Date(value).getTime()
  if (typeof value === 'object') {
    if (typeof value.getTime === 'function') return value.getTime()
    if (typeof value.toDate === 'function') return value.toDate().getTime()
    if (typeof value.$date === 'string') return new Date(value.$date).getTime()
  }
  return new Date(value).getTime()
}

Component({
  properties: {
    levelStartedAt: { type: null, value: null },
    blindUpMinutes: { type: Number, value: 20 },
    currentLevel: { type: Number, value: 0 },
    blindStructure: { type: Array, value: [] },
    paused: { type: Boolean, value: false },
    pausedAt: { type: null, value: null },
    pausedAccumMs: { type: Number, value: 0 },
    isHost: { type: Boolean, value: false }
  },
  data: {
    remaining: '00:00',
    currentBlind: { sb: 0, bb: 0, ante: 0 },
    nextBlind: null,
    timeUp: false
  },
  observers: {
    'currentLevel, blindStructure': function (lv, struct) {
      const cur = (struct && struct[lv]) || { sb: 0, bb: 0, ante: 0 }
      const nxt = (struct && struct[lv + 1]) || null
      this.setData({ currentBlind: cur, nextBlind: nxt, timeUp: false })
    }
  },
  lifetimes: {
    attached() {
      this._startTimer()
    },
    detached() {
      this._stopTimer()
    }
  },
  // 页面切后台时停表省电省 setData，回前台恢复；
  // 剩余时间基于 levelStartedAt 绝对时间计算，恢复后不漂移
  pageLifetimes: {
    show() {
      this._startTimer()
    },
    hide() {
      this._stopTimer()
    }
  },
  methods: {
    _startTimer() {
      if (this._timer) return
      this._tick()
      this._timer = setInterval(() => this._tick(), 1000)
    },
    _stopTimer() {
      if (this._timer) {
        clearInterval(this._timer)
        this._timer = null
      }
    },
    _tick() {
      const { levelStartedAt, blindUpMinutes, paused, pausedAt, pausedAccumMs } = this.data
      if (!levelStartedAt) {
        this.setData({ remaining: '--:--' })
        return
      }
      const start = toMs(levelStartedAt)
      const now = Date.now()
      let pausedMs = Number(pausedAccumMs) || 0
      if (paused && pausedAt) pausedMs += now - toMs(pausedAt)
      const totalMs = Number(blindUpMinutes) * 60 * 1000
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(pausedMs) ||
        !Number.isFinite(totalMs) ||
        totalMs <= 0
      ) {
        this.setData({ remaining: '--:--' })
        return
      }
      const elapsed = now - start - pausedMs
      const left = Math.max(0, totalMs - elapsed)
      const s = Math.floor(left / 1000)
      this.setData({ remaining: `${pad(Math.floor(s / 60))}:${pad(s % 60)}` })
      if (left <= 0 && !this.data.timeUp) {
        this.setData({ timeUp: true })
        this.triggerEvent('timeup', { nextLevel: this.data.currentLevel + 1 })
      }
    }
  }
})
