# Stax · 长河筹略

> Hold'em, held right.

线下德州扑克牌局**筹码记账 + 盲注计时 + 战绩统计**工具，附轻量学习模块。

## 合规声明
长河筹略（Stax）仅供朋友间线下竞技扑克记账与学习交流使用，**严禁用于任何形式的赌博活动**。请遵守当地法律法规。

## 技术栈
- 微信原生小程序（WXML + WXSS + JS）
- 云开发 CloudBase（云函数 + 云数据库 + 云存储）
- ESLint + Prettier，2 空格缩进，无分号

## 目录结构
```
stax/
├── miniprogram/         # 小程序前端
│   ├── pages/           # 13 个页面
│   ├── components/      # 4 个自研组件
│   ├── utils/           # 工具函数（结算 / 邀请码 / 格式化）
│   ├── images/          # 静态图片
│   └── styles/          # 主题样式
└── cloudfunctions/      # 5 个云函数
    ├── createGame/
    ├── joinGame/
    ├── recordTransaction/
    ├── settleGame/
    └── seedTerms/
```

## 本地开发
1. 安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 导入本仓库目录，AppID 填写自有小程序 AppID（个人主体）
3. 在 `miniprogram/app.js` 中将 `your-env-id` 替换为云开发环境 ID
4. 右上角「云开发」→ 部署 5 个云函数；执行 `seedTerms` 初始化术语词典
5. 建立 6 个数据库集合：`users / games / transactions / terms / handRanks`，权限按 Spec §2.6 配置

## 部署步骤
详见 `docs/DEPLOY.md`（待补全）。

## License
MIT
