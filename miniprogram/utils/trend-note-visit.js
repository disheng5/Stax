const memory = new Map()

function readCursor(key) {
  try {
    const saved = wx.getStorageSync(key)
    if (Number.isSafeInteger(saved) && saved >= 0) return Math.max(saved, memory.get(key) || 0)
  } catch (_) {}
  return memory.get(key) || 0
}

// Advance only when read, never when a cached frame or a watch response is rendered.
function createNoteVisit(openid) {
  const key = `stax_trend_note_cursor_v1_${openid}`
  const variation = readCursor(key)
  let read = false
  return {
    variation,
    markRead() {
      if (read) return
      read = true
      const next = Math.max(readCursor(key), variation + 1)
      memory.set(key, next)
      try {
        wx.setStorageSync(key, next)
      } catch (_) {}
    }
  }
}

module.exports = { createNoteVisit }
