# 📸 拾光小相 — Skyline 照片工具箱

一款基于 **AI 人像抠图** 的微信小程序，支持一键生成证件照、更换背景色、多规格尺寸裁切、六寸排版照生成等功能。

当前本地版本采用「首页 / 作品 / 我的」，首页提供常用入口，全部工具页支持搜索和分类；新增功能统一注册，后续可接入文档等实用工具。已实现独立编辑与导出工作台、原图对比、自定义尺寸、本地压缩、裁剪旋转和可恢复草稿。所有页面采用 **Skyline + glass-easel**，证件照处理继续复用原 Java / Python 接口。

开发与验收记录见 [开发验收说明](docs/开发验收说明.md)，最新设计与新工具接入方式见 [界面升级与功能扩展方案](docs/界面升级与功能扩展方案.md)。

> 前端使用微信小程序原生开发 + TDesign 组件库，后端使用 Spring Boot + MyBatis-Plus，AI 图像处理基于 [HivisionIDPhotos](https://github.com/Zeyi-Lin/HivisionIDPhotos)。

## ✨ 功能特性

- 🤖 **AI 智能抠图**：自动识别人像并去除背景，生成透明底证件照
- 🎨 **一键换背景色**：预设蓝、白、红等常用底色，支持自定义颜色选择器
- 📐 **多规格尺寸**：内置一寸、二寸、小一寸等常用证件照尺寸，自动裁切
- 🖨️ **六寸排版照**：一键生成可直接冲印的六寸排版照片
- ☁️ **云端历史记录**：登录后自动保存处理记录，支持 7 天内查看和下载
- 🔒 **内容安全**：集成微信内容安全检测 API，可选接入自定义 NSFW 鉴黄服务
- 📱 **微信登录**：微信一键授权登录，无需注册

## 🖼️ 系统功能界面

![系统功能界面](https://raw.githubusercontent.com/weijunli-No1/changePhotoBackground/main/docs/assets/profile-demo.png)

## 🚀 微信小程序码

<img src="https://raw.githubusercontent.com/weijunli-No1/changePhotoBackground/main/docs/assets/miniprogram-qrcode.png" width="200" />

## 🏗️ 项目架构

```
├── mini-program/          # 微信小程序前端
│   ├── pages/
│   │   ├── index/         # 首页 - 常用工具、继续编辑
│   │   ├── library/       # 全部工具 - 搜索、分类与入口
│   │   ├── edit/          # 证件照编辑 - 规格、底色与构图
│   │   ├── export/        # 预览保存 - 登录、额度与广告
│   │   ├── tools/         # 本地压缩、裁剪旋转
│   │   ├── history/       # 作品 - 本地草稿、云端证件照
│   │   ├── profile/       # 我的 - 资料、额度、帮助与退出
│   │   ├── account/       # 头像昵称编辑
│   │   ├── support/       # 帮助与客服
│   │   └── document/      # 隐私及协议（不是文件处理工具）
│   └── components/        # 自定义组件
├── backend/               # Java 后端服务 (Spring Boot)
│   └── src/main/
│       ├── java/com/photo/bg/
│       │   ├── controller/    # 接口控制器
│       │   ├── service/       # 业务逻辑层
│       │   ├── config/        # 配置类 (微信、MinIO 等)
│       │   └── entity/        # 数据实体
│       └── resources/
│           └── application.yml
├── database/              # 数据库初始化脚本
├── api_CN.md              # API 接口文档 (中文)
└── api_EN.md              # API 接口文档 (English)
```

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | 微信小程序原生 + [TDesign 小程序组件库](https://tdesign.tencent.com/miniprogram) |
| **后端** | Spring Boot 2.7 · Java 8 · MyBatis-Plus · Hutool |
| **AI 引擎** | [HivisionIDPhotos](https://github.com/Zeyi-Lin/HivisionIDPhotos)（Python，提供人像抠图、背景替换等 API） |
| **数据库** | MySQL 8.0 |
| **对象存储** | MinIO |
| **微信 SDK** | [WxJava](https://github.com/Wechat-Group/WxJava)（微信小程序登录、内容安全检测） |

## 🚀 快速开始

### 前置依赖

- JDK 8+
- Maven 3.6+
- MySQL 8.0+
- MinIO（或兼容 S3 的对象存储服务）
- Python 3.8+（用于运行 HivisionIDPhotos）
- 微信开发者工具

### 1. 初始化数据库

```bash
mysql -u root -p < database/init_schema.sql
```

### 2. 启动 AI 图像处理服务

参考 [HivisionIDPhotos](https://github.com/Zeyi-Lin/HivisionIDPhotos) 部署文档，启动 API 服务（默认端口 `7860`）：

```bash
python deploy_api.py
```

### 3. 配置并启动后端服务

修改 `backend/src/main/resources/application.yml` 中的以下配置：

```yaml
spring:
  datasource:
    url: jdbc:mysql://127.0.0.1:3306/photo_bg?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai
    username: root
    password: your_mysql_password        # ← 修改为你的数据库密码

wx:
  miniapp:
    appid: your_wechat_appid             # ← 修改为你的小程序 AppID
    secret: your_wechat_secret           # ← 修改为你的小程序 Secret
    rewarded-ad-unit-id: ${WX_REWARDED_AD_UNIT_ID:adunit-8643a04d0caed362} # 可通过环境变量覆盖

python-api:
  base-url: http://127.0.0.1:7860       # HivisionIDPhotos 服务地址

minio:
  endpoint: https://your-minio-endpoint:9000
  access-key: your_minio_access_key
  secret-key: your_minio_secret_key
  bucket-name: your_bucket_name
```

启动后端：

```bash
cd backend
mvn spring-boot:run
```

### 4. 配置并运行小程序

1. 用微信开发者工具导入 `mini-program/` 目录
2. 修改 `mini-program/project.config.json` 中的 `appid` 为你自己的小程序 AppID
3. 修改 `mini-program/app.js` 中的 `baseUrl` 为你的后端服务地址
4. 构建 npm（工具栏 → 工具 → 构建 npm）
5. 编译运行

## 📖 API 文档

激励视频已配置广告位 `adunit-8643a04d0caed362`。当前版本在 `mini-program/app.js` 中显式指定该广告位，优先于线上旧广告配置。清空 `rewardedVideoAdUnitIdOverride` 后，可使用后端 `/api/app/config` 下发的广告位。广告实例仅在导出页面内使用；完整观看并记录奖励成功后，继续原先的单图或排版保存操作。实际投放仍需微信真机验证。

前端逻辑回归测试（Node.js 18+）：

```bash
cd mini-program
npm test
```

详见：
- [中文文档](api_CN.md)
- [English Documentation](api_EN.md)

主要接口：

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/photo/generate-idphoto` | POST | 上传照片，AI 抠图生成透明底证件照 |
| `/api/photo/add-background` | POST | 为透明底照片添加背景色 |
| `/api/photo/generate-layout` | POST | 生成六寸排版照 |
| `/api/user/login` | POST | 微信登录 |
| `/api/user/usage` | GET | 查询每日使用配额 |
| `/api/history/save` | POST | 保存证件照到历史记录 |
| `/api/history/list` | GET | 获取历史记录列表 |

## 📁 数据库设计

| 表名 | 说明 |
|------|------|
| `t_user` | 用户表（微信 openid、昵称、头像） |
| `t_photo_history` | 证件照历史记录（处理后照片 URL、原图、背景色） |
| `t_user_daily_usage` | 用户每日使用统计（保存次数、广告观看次数） |

## ⚙️ 环境变量 / 配置说明

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `server.port` | 后端服务端口 | `8080` |
| `spring.datasource.url` | MySQL 连接地址 | `jdbc:mysql://127.0.0.1:3306/photo_bg` |
| `wx.miniapp.appid` | 微信小程序 AppID | — |
| `wx.miniapp.secret` | 微信小程序 Secret | — |
| `python-api.base-url` | HivisionIDPhotos API 地址 | `http://127.0.0.1:7860` |
| `minio.endpoint` | MinIO 服务地址 | — |
| `nsfw.enabled` | 是否启用自定义鉴黄服务 | `false` |
| `nsfw.api-url` | 自定义鉴黄服务地址 | `http://127.0.0.1:3006/checkImg` |

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'feat: add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 提交 Pull Request

## 📄 License

本项目采用 [MIT License](LICENSE) 开源协议。

## 🙏 致谢

- [HivisionIDPhotos](https://github.com/Zeyi-Lin/HivisionIDPhotos) — AI 证件照处理引擎
- [HivisionIDPhotos-wechat-weapp](https://github.com/no1xuan/HivisionIDPhotos-wechat-weapp) — 借鉴了图片敏感性校验逻辑
- [WxJava](https://github.com/Wechat-Group/WxJava) — 微信 Java SDK
- [TDesign](https://tdesign.tencent.com/miniprogram) — 腾讯设计系统小程序组件库
