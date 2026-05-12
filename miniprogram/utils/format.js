// utils/format.js — 格式化工具
function pad(n) { return n < 10 ? '0' + n : '' + n }

function formatDate(date) {
  const d = new Date(date)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function formatDateTime(date) {
  const d = new Date(date)
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`
  return `${pad(m)}:${pad(sec)}`
}

function formatProfit(n) {
  if (n > 0) return '+' + n
  return '' + n
}

module.exports = { formatDate, formatDateTime, formatDuration, formatProfit }
