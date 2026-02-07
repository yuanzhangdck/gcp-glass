# GCP Glass Panel 💎

> A futuristic, deep dark glass-morphism UI for managing Google Cloud Platform (GCE) instances.

## ✨ Features

- **🎨 Deep Dark Glass UI**: Premium visual design with Google Blue accents.
- **⚡ Quick Deploy**: Launch GCE VMs (e2-micro, etc) in any zone.
- **🔄 IP Swap**: One-click Public IP rotation (IPv4 & IPv6).
- **🛡️ Auto Firewall**: Automatically opens ports 0-65535 on creation.
- **🔐 Root Unlock**: Startup script to enable Root Password login.
- **📦 Native Node.js**: Lightweight deployment with PM2.

---

## 🇬🇧 English

### 🚀 One-Click Install

Run this command on your server (Ubuntu/Debian/CentOS):

```bash
bash <(curl -sL https://raw.githubusercontent.com/yuanzhangdck/gcp-glass/main/install.sh)
```

**What this script does:**
1. Installs **Node.js 20**, **Git**, and **PM2**.
2. Clones the repository to `~/gcp-glass`.
3. Installs dependencies and starts the server on port **3002**.
4. Configures **PM2** to auto-start on boot.

### 🐳 Docker Install (Alternative)

```bash
docker run -d \
  --name gcp-glass \
  --restart always \
  -p 3002:3002 \
  -v $(pwd)/data:/app/data \
  ghcr.io/yuanzhangdck/gcp-glass:latest
```

### 🔑 Default Credentials

- **URL**: `http://YOUR_IP:3002`
- **Password**: `password` (Change it in Settings)
- **Setup**: Paste your Service Account JSON in Settings.

---

## 🇨🇳 中文说明

### 🚀 一键安装

在您的服务器终端执行以下命令：

```bash
bash <(curl -sL https://raw.githubusercontent.com/yuanzhangdck/gcp-glass/main/install.sh)
```

**脚本功能：**
1. 自动检测并安装 **Node.js 20**、**Git** 和 **PM2**。
2. 拉取代码到 `~/gcp-glass` 目录。
3. 安装依赖并启动服务（默认端口 **3002**）。
4. 配置开机自启和崩溃重启保护。

### 🐳 Docker 安装 (可选)

```bash
docker run -d \
  --name gcp-glass \
  --restart always \
  -p 3002:3002 \
  -v $(pwd)/data:/app/data \
  ghcr.io/yuanzhangdck/gcp-glass:latest
```

### 🔑 默认信息

- **访问地址**: `http://服务器IP:3002`
- **默认密码**: `password` (请登录后在设置中修改)
- **配置**: 首次登录需在设置中粘贴 Service Account JSON。

## 📄 License

MIT
