// components/blind-timer/blind-timer.js — 盲注计时器（断线可恢复）
function pad(n) { return n < 10 ? '0' + n : '' + n }

Component({
  properties: {
    levelStartedAt: { type: null, value: null },
    blindUpMinutes: { type: Number, value: 20 },
    currentLevel:   { type: Number, value: 0 },
    blindStructure: { type: Array,  value: [] },
    paused:         { type: Boolean, value: false },
    pausedAt:       { type: null, value: null },
    pausedAccumMs:  { type: Number, value: 0 },
    isHost:         { type: Boolean, value: false }
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
    attached() { this._tick(); this._timer = setInterval(() => this._tick(), 1000) },
    detached() { if (this._timer) clearInterval(this._timer) }
  },
  methods: {
    _tick() {
      const { levelStartedAt, blindUpMinutes, paused, pausedAt, pausedAccumMs } = this.data
      if (!levelStartedAt) { this.setData({ remaining: '--:--' }); return }
      const start = new Date(levelStartedAt).getTime()
      const now = Date.now()
      let pausedMs = pausedAccumMs || 0
      if (paused && pausedAt) pausedMs += now - new Date(pausedAt).getTime()
      const elapsed = now - start - pausedMs
      const totalMs = blindUpMinutes * 60 * 1000
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
