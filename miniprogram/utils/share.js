// Never let WeChat fall back to a screenshot of private page content.
function safeShare(path = '/pages/index/index', title = 'StaxKit · 朋友局娱乐积分记录') {
  return { title, path, imageUrl: '/images/share-cover-v2.png' }
}
module.exports = { safeShare }
