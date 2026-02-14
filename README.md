# GCP Glass Console

一个轻量级的 Google Cloud Platform 虚拟机管理面板，支持多账号管理、一键开机、换 IP、IPv6 等功能。

## 功能特性

- 🔐 密码登录 + 随机 Token 认证（httpOnly Cookie）
- 👥 多账号管理（添加 / 删除 / 重命名 / 切换）
- 🖥️ VM 实例管理（创建 / 启动 / 停止 / 删除）
- 🔄 一键更换 IPv4 / IPv6 地址
- 🌐 创建实例时可选附加 IPv6
- 📋 操作审计日志
- 💾 实例列表浏览器缓存（30 分钟）
- 📱 移动端响应式适配
- ☁️ 支持 Cloudflare CDN（自动获取真实 IP）

## 部署

### 环境要求

- Node.js 18+
- PM2（推荐）

### 安装步骤

```bash
# 克隆项目
git clone https://github.com/yuanzhangdck/gcp-glass.git
cd gcp-glass

# 安装依赖
npm install

# 启动（默认端口 3002）
PORT=3002 pm2 start server.js --name gcp-glass

# 保存 PM2 进程列表（开机自启）
pm2 save
```

### Docker 部署

```bash
docker build -t gcp-glass .
docker run -d -p 3002:3002 -v ./data:/app/data --name gcp-glass gcp-glass
```

## 获取 GCP 服务账号密钥

面板通过 GCP 服务账号的 JSON 密钥来调用 API，获取步骤如下：

### 1. 创建服务账号

1. 打开 [GCP Console - IAM](https://console.cloud.google.com/iam-admin/service-accounts)
2. 选择你的项目
3. 点击 **创建服务账号**
4. 填写名称（如 `gcp-glass`），点击 **创建并继续**
5. 授予角色，选择 **Compute Admin**（`roles/compute.admin`），点击 **继续** → **完成**

### 2. 生成密钥

1. 在服务账号列表中，点击刚创建的账号
2. 切换到 **密钥** 标签页
3. 点击 **添加密钥** → **创建新密钥**
4. 选择 **JSON** 格式，点击 **创建**
5. 浏览器会自动下载一个 `.json` 文件，这就是你需要的密钥

### 3. 启用 API

确保项目已启用以下 API：

- [Compute Engine API](https://console.cloud.google.com/apis/api/compute.googleapis.com)

在 GCP Console 中打开上面的链接，点击 **启用** 即可。

### 4. 添加到面板

1. 登录面板
2. 点击侧边栏的 **➕ Add Account**
3. 填写备注名称（建议用 Gmail 邮箱方便识别）
4. 将下载的 JSON 密钥文件内容粘贴到输入框
5. 点击 **Add Account**

## 使用说明

### 默认密码

首次部署默认密码为 `password`，请登录后立即在 **Settings** 中修改。

### 多账号管理

- 侧边栏显示所有已添加的 GCP 账号
- 点击账号名称切换当前操作的账号
- 点击 ✎ 按钮修改账号备注
- 点击 ✕ 按钮删除账号

### 创建实例

1. 在左侧 **Deploy New VM** 面板填写：
   - 实例名称
   - 区域 / 可用区（支持选择 Region 自动分配 Zone）
   - 机器类型
   - 操作系统镜像
   - Root 密码
   - 是否启用 IPv6
2. 点击 **Deploy Instance**

### 更换 IP

- 点击实例操作栏的 **v4** 按钮更换 IPv4 地址
- 点击 **v6** 按钮更换 IPv6 地址
- 更换后会自动轮询刷新状态

## 目录结构

```
gcp-glass/
├── server.js          # 后端主程序
├── package.json
├── Dockerfile
├── public/
│   ├── index.html     # 主页面
│   ├── login.html     # 登录页
│   ├── app.js         # 前端逻辑
│   ├── logo.svg       # Logo
│   ├── favicon.ico    # 网站图标
│   └── favicon-192.png
└── data/              # 运行时数据（自动生成）
    ├── accounts.json  # 账号列表
    ├── config.json    # 面板配置
    ├── key-*.json     # 各账号的服务账号密钥
    └── audit.log      # 审计日志
```

## 安全说明

- 密钥文件自动设置 `chmod 600` 权限
- Cookie 使用 `httpOnly` + `sameSite: strict`
- 认证使用随机 Token，非固定值
- 所有敏感操作记录审计日志
- 支持 `CF-Connecting-IP` 获取 CDN 后真实 IP

## License

ISC
