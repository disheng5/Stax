function changedPatch(data, patch) {
  const changed = {}
  for (const [key, value] of Object.entries(patch)) {
    const old = key.split('.').reduce((x, k) => x?.[k], data)
    if (JSON.stringify(old) === JSON.stringify(value)) continue
    if (key === 'game' && old && value) {
      for (const [field, item] of Object.entries(value)) {
        if (JSON.stringify(old[field]) !== JSON.stringify(item)) changed[`game.${field}`] = item
      }
    } else changed[key] = value
  }
  return changed
}
function batchRender(page, render) {
  const original = page.setData
  const combined = {}
  page.setData = patch => Object.assign(combined, patch)
  try {
    render()
  } finally {
    page.setData = original
  }
  const patch = changedPatch(page.data, combined)
  if (Object.keys(patch).length) original.call(page, patch)
}
module.exports = { changedPatch, batchRender }
