# 分享封面

## 本地修复

- 原封面 `miniprogram/images/share-cover.png` 是 144 x 144 的占位图标，放大后不适合作为分享卡片封面。
- 新封面 `miniprogram/images/share-cover-v2.png` 为 1000 x 800、5:4 的包内 PNG，约 161 KiB。保留旧文件，不更改小程序图标。
- `miniprogram/utils/share.js` 统一使用新路径；首页、战绩、房间和积分榜的标题及邀请路径不变。不使用页面截图、网络下载或分享时临时绘图。
- 封面仅含 StaxKit、品牌副标题与装饰线，不包含个人或房间数据。
- 图片尺寸、比例、体积上限及四个页面的分享路径由 `tests/share-profile.test.js` 回归覆盖。

5:4 比例及包内图片用法参考[腾讯云开发文档](https://docs.cloudbase.net/recipes/add-share-with-params-miniprogram)。200 KiB 是本项目资源预算，不是微信接口限制。

## 素材来源

使用内置 image_gen 工具生成，随后仅作尺寸规范化及 PNG 调色板压缩，没有新增项目运行时依赖。

生成提示词：

```text
Use case: logo-brand. Asset type: production WeChat mini-program share cover for StaxKit. Create a finished flat 2D brand graphic, exactly 1280 x 1024 pixels (5:4 landscape). Full bleed solid muted medium blue background #386EA9, no gradients or texture. In the middle, an exceptionally crisp large white sans-serif wordmark spelled exactly 'StaxKit', font comparable to Helvetica Neue Bold, regular letter spacing. Below it, smaller but clearly readable white text spelled exactly "Hold'em, held right." in a regular sans-serif. Center the two lines as one calm balanced group, with ample breathing room on all sides, keeping all text safely within the middle 70 percent of the width and middle 50 percent of height. Add a single small fine muted gold horizontal rule centered below this group as a restrained accent. Premium, simple, clear, timeless typography. No other text. No cards, poker suits, chips, coins, numerical scores, people, avatars, shadows, UI controls, photographs, watermarks, or mockup surroundings. This is a static privacy-safe cover, not a screenshot. Large wordmark must remain legible at a 250 x 200 thumbnail size.
```

## 验收与发布边界

- 2026-09-17 本地已通过 `npm run check`、`npm run lint`、`git diff --check`，并检查 1000 x 800 原图及 250 x 200 缩略预览；微信真机分享待验收。
- 本次仅修改包内图片与前端分享引用，无需部署云函数。
- 真机需从四个入口分别新建分享卡片，检查封面清晰度、文字完整性和邀请落点；不能用聊天里此前发送的旧卡片作为新包验收依据。
- 自动检查与本地图像预览不能替代微信实际压缩后的真机验收。
- 未进行前端上传或线上发布；测试通过不代表已上线。
