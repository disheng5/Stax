// components/blind-timer/blind-timer.js — 盲注计时器
Component({
  properties: {
    levelStartedAt: { type: null, value: null },
    blindUpMinutes: { type: Number, value: 20 },
    currentLevel: { type: Number, value: 0 },
    blindStructure: { type: Array, value: [] },
    paused: { type: Boolean, value: false }
  },
  data: { remaining: '00:00', currentBlind: { sb: 0, bb: 0 } },
  lifetimes: {
    attached() { this._tick(); this._timer = setInterval(() => this._tick(), 1000) },
    detached() { if (this._timer) clearInterval(this._timer) }
  },
  methods: {
    _tick() {
      // TODO: 计算剩余时间，处理 paused / 升盲弹窗
    }
  }
})
