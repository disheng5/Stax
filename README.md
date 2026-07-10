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
│   ├── pages/           # 主包页面（牌局 / 圈子 / 战绩）
│   ├── packageLearn/    # 分包：学习模块 + 关于
│   ├── components/      # 自研组件（玩家卡 / 盲注计时 / 折线图 …）
│   ├── utils/           # 工具函数（结算 / 邀请码 / 统计 / Mock）
│   ├── images/          # 静态图片
│   └── styles/          # 主题样式
└── cloudfunctions/      # 18 个云函数（牌局 / 圈子赛季 / AI / 用户）
```

## 本地开发
1. 安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 导入本仓库目录，AppID 填写自有小程序 AppID（个人主体）或测试号
3. **直接编译即可看到完整 UI 跑起来**（默认 Demo 模式，0 配置 0 依赖）
4. 想接真实云：在 `miniprogram/app.js` 把 `ENV_ID` 替换为云开发环境 ID，按 `docs/CLOUD_SETUP.md` 建集合、建索引并部署云函数

## 验证
```
npm install
npm run check       # 单元测试 + Mock E2E + 合规扫描
npm run test:mock   # 仅跑 Mock 全链路（不依赖任何外部环境）
```

## 部署步骤
- 云开发部署：`docs/CLOUD_SETUP.md`
- 提审指南：`docs/DEPLOY.md`
- 演示流程：`docs/DEMO.md`

## License
MIT
