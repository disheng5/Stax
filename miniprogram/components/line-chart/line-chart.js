// components/line-chart/line-chart.js — 纯 WXML 折线图，无 Canvas
Component({
  properties: {
    points: { type: Array, value: [] },
    height: { type: Number, value: 180 },
    color: { type: String, value: '#2B6CB0' }
  },
  observers: {
    points: function (pts) {
      this._build(pts)
    },
    height: function (h) {
      this.setData({ heightRpx: (h || 180) * 2 })
    }
  },
  lifetimes: {
    attached() {
      this.setData({ heightRpx: (this.data.height || 180) * 2 })
    }
  },
  methods: {
    _build(pts) {
      if (!pts || !pts.length) {
        this.setData({
          segments: [],
          dots: [],
          bars: [],
          gridLines: [],
          yLabels: [],
          xLabels: [],
          empty: true
        })
        return
      }

      const W = 300
      const H = 150
      const PAD_L = 36
      const PAD_R = 8
      const PAD_T = 12
      const PAD_B = 24
      const plotW = W - PAD_L - PAD_R
      const plotH = H - PAD_T - PAD_B

      const ys = pts.map(p => Number(p.y) || 0)
      const deltas = pts.map(p => Number(p.delta) || 0)
      const rawMax = Math.max(...ys, ...deltas, 0)
      const rawMin = Math.min(...ys, ...deltas, 0)
      const niceStep = this._niceStep(rawMax - rawMin)
      let domainMax = Math.ceil(rawMax / niceStep) * niceStep
      let domainMin = Math.floor(rawMin / niceStep) * niceStep
      if (domainMax === domainMin) {
        domainMax += niceStep
        domainMin -= niceStep
      }
      const range = domainMax - domainMin

      const toX = i => PAD_L + (pts.length > 1 ? (i / (pts.length - 1)) * plotW : plotW / 2)
      const toY = v => PAD_T + plotH - ((v - domainMin) / range) * plotH

      const toXp = i => ((toX(i) / W) * 100).toFixed(2) + '%'
      const toYp = v => ((toY(v) / H) * 100).toFixed(2) + '%'

      const lineColor = this.data.color || '#2E8540'
      const zeroY = toY(0)

      const barWidth = Math.max(4, Math.min(16, plotW / Math.max(pts.length * 1.8, 1)))
      const bars = deltas.map((v, i) => {
        const y = toY(v)
        const top = Math.min(y, zeroY)
        const height = Math.max(2, Math.abs(zeroY - y))
        return {
          left: (((toX(i) - barWidth / 2) / W) * 100).toFixed(2) + '%',
          top: ((top / H) * 100).toFixed(2) + '%',
          width: ((barWidth / W) * 100).toFixed(2) + '%',
          height: ((height / H) * 100).toFixed(2) + '%',
          color: v >= 0 ? 'rgba(239, 68, 68, 0.48)' : 'rgba(46, 157, 91, 0.42)'
        }
      })

      // 折线 segments
      const segments = []
      for (let i = 0; i < pts.length - 1; i++) {
        const x1 = toX(i),
          y1 = toY(ys[i])
        const x2 = toX(i + 1),
          y2 = toY(ys[i + 1])
        const dx = x2 - x1,
          dy = y2 - y1
        const len = Math.sqrt(dx * dx + dy * dy)
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI
        segments.push({
          left: ((x1 / W) * 100).toFixed(2) + '%',
          top: ((y1 / H) * 100).toFixed(2) + '%',
          width: ((len / W) * 100).toFixed(2) + '%',
          angle: angle.toFixed(2),
          color: lineColor
        })
      }

      // 数据点
      const dots = pts.map((p, i) => ({
        left: toXp(i),
        top: toYp(ys[i]),
        color: lineColor
      }))

      const yLabels = []
      for (let v = domainMin; v <= domainMax + niceStep / 2; v += niceStep) {
        const yp = toY(v)
        yLabels.unshift({
          label: this._label(v),
          top: ((yp / H) * 100).toFixed(2) + '%'
        })
      }
      const gridLines = yLabels.map(l => ({ ...l }))

      // X 轴标签（最多 5 个）
      const maxX = 5
      const step = Math.max(1, Math.ceil(pts.length / maxX))
      const xLabels = pts
        .map((p, i) => ({ left: toXp(i), label: p.x, i }))
        .filter((_, i) => i % step === 0 || i === pts.length - 1)

      this.setData({ segments, dots, bars, gridLines, yLabels, xLabels, empty: false })
    },

    _niceStep(range) {
      if (!range || range <= 0) return 100
      const raw = range / 5
      const pow = Math.pow(10, Math.floor(Math.log10(raw)))
      const unit = raw / pow
      if (unit <= 1) return pow
      if (unit <= 2) return 2 * pow
      if (unit <= 5) return 5 * pow
      return 10 * pow
    },

    _label(v) {
      const n = Math.round(v)
      return String(Object.is(n, -0) ? 0 : n)
    }
  },
  data: {
    segments: [],
    dots: [],
    bars: [],
    gridLines: [],
    yLabels: [],
    xLabels: [],
    empty: true,
    heightRpx: 360
  }
})
