---
name: dokploy
description: Dokploy 运维管理。部署、停止、启动服务，管理项目和域名。使用 /dokploy 查看状态，/dokploy deploy 部署服务。
---

# Dokploy 运维 Skill

通过 API 管理 Dokploy 服务。

## 首次使用

使用前需要先配置服务器信息：

```bash
# 添加服务器
node scripts/dokploy.js init --name=myserver --url=https://your-dokploy.com --key=your-api-key

# 可选：配置 Git 代理（用于私有仓库访问）
node scripts/dokploy.js init --git-proxy="https://user:token@proxy.example.com/https://github.com"

# 查看当前配置
node scripts/dokploy.js config
```

配置文件保存在 `~/.config/dokploy-skill/config.json`，权限 0600。

## 用法

```
/dokploy [action] [options]
```

## 多服务器支持

支持配置多个 Dokploy 服务器，通过 `--server` 参数切换：

```bash
# 添加多个服务器
node scripts/dokploy.js init --name=prod --url=https://prod.example.com --key=xxx
node scripts/dokploy.js init --name=staging --url=https://staging.example.com --key=yyy

# 设置默认服务器
node scripts/dokploy.js init --default=prod

# 使用默认服务器
node scripts/dokploy.js list

# 切换到指定服务器
node scripts/dokploy.js --server=staging list
```

`setup-git` 命令会根据服务器的 `useGitProxy` 配置自动决定是否使用 Git 代理。

## 部署前检查（重要）

**部署前必须在本地构建成功，再推送代码：**

```bash
# 1. 本地构建验证
docker compose build

# 2. 本地运行测试（可选）
docker compose up -d
docker compose logs -f
docker compose down

# 3. 构建成功后，提交并推送
git add .
git commit -m "feat: xxx"
git push

# 4. 触发远程部署
node scripts/dokploy.js deploy <composeId>
```

## Raw Compose 部署（重要）

当部署第三方 Docker 镜像（如 new-api、vaultwarden 等）时，使用 Raw Compose 模式：

### 为什么需要 Raw Compose？

1. **端口冲突**：第三方 docker-compose.yml 通常直接映射端口（如 `3000:3000`），会与其他服务冲突
2. **网络隔离**：需要连接到 `dokploy-network` 才能被 Traefik 路由
3. **自定义配置**：可以调整环境变量、依赖关系等

### Raw Compose 模板

```yaml
services:
  app:
    image: some/image:latest
    restart: always
    networks:
      - dokploy-network  # 必须！Traefik 通过此网络访问服务
      - internal         # 内部服务通信
    environment:
      - TZ=Asia/Shanghai
      - DATABASE_URL=postgres://user:pass@db:5432/dbname
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    restart: always
    networks:
      - internal  # 数据库只需内部网络
    environment:
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
      - POSTGRES_DB=dbname
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user -d dbname"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s

networks:
  dokploy-network:
    external: true  # 使用 Dokploy 的外部网络
  internal:
    driver: bridge  # 内部服务通信

volumes:
  postgres_data:
```

### 关键配置说明

| 配置 | 说明 |
|------|------|
| `dokploy-network: external: true` | **必须**。连接到 Dokploy 的 Traefik 网络 |
| 主服务连接 `dokploy-network` | **必须**。否则 Traefik 无法路由，返回 404 |
| 数据库/Redis 只连接 `internal` | 安全考虑，内部服务不暴露给 Traefik |
| 不要映射端口 | 不要写 `ports: - "3000:3000"`，让 Traefik 处理 |
| 不要手动添加 Traefik labels | Dokploy 会自动添加，手动添加可能冲突 |

### 部署流程

```bash
# 1. 创建项目
node scripts/dokploy.js create-project myapp

# 2. 创建 Compose
node scripts/dokploy.js create-compose myapp <envId>

# 3. 设置 Raw Compose（本地文件）
node scripts/dokploy.js set-raw-compose <composeId> ./my-compose.yml

# 4. 添加域名（serviceName 必须与 compose 中的服务名一致）
node scripts/dokploy.js add-domain <composeId> app.example.com 3000 app

# 5. 启用 SSL
node scripts/dokploy.js enable-ssl <domainId>

# 6. 部署
node scripts/dokploy.js deploy <composeId>
```

## 常见问题排查

### 1. 端口冲突：`port is already allocated`

**原因**：docker-compose.yml 直接映射了端口

**解决**：使用 Raw Compose 模式，移除 `ports` 配置

### 2. 数据库连接失败：`hostname resolving error: lookup db`

**原因**：服务之间没有在同一个网络中

**解决**：确保所有需要互相通信的服务都在同一个网络（如 `internal`）

### 3. Traefik 404：域名配置后访问返回 404

**可能原因**：
- 主服务没有连接到 `dokploy-network`
- `serviceName` 与 compose 中的服务名不匹配
- 容器没有正常启动

**排查步骤**：
```bash
# 1. 检查部署状态
node scripts/dokploy.js status <composeId>

# 2. 确认域名配置的 serviceName 与 compose 服务名一致

# 3. 确认 compose 中主服务连接了 dokploy-network
```

### 4. Service name not found

**原因**：域名的 `serviceName` 为空或不匹配

**解决**：
```bash
node scripts/dokploy.js update-domain <domainId> <正确的服务名>
node scripts/dokploy.js deploy <composeId>
```

## 操作

| 操作 | 说明 | 示例 |
|------|------|------|
| (无) | 列出所有项目和服务状态 | `/dokploy` |
| init | 初始化/更新配置 | `/dokploy init --name=dok --url=https://example.com --key=xxx` |
| config | 查看当前配置（key 脱敏） | `/dokploy config` |
| status &lt;id&gt; | 查看指定 Compose 状态 | `/dokploy status abc123` |
| deploy &lt;id&gt; | 部署服务 | `/dokploy deploy abc123` |
| stop &lt;id&gt; | 停止服务 | `/dokploy stop abc123` |
| start &lt;id&gt; | 启动服务 | `/dokploy start abc123` |
| logs &lt;id&gt; | 查看部署记录 | `/dokploy logs abc123` |
| create-project &lt;name&gt; | 创建新项目 | `/dokploy create-project myapp` |
| create-compose &lt;name&gt; &lt;envId&gt; | 创建 Compose 服务 | `/dokploy create-compose web env123` |
| setup-git &lt;id&gt; &lt;owner/repo&gt; [branch] | 配置 Git 仓库（自动使用代理） | `/dokploy setup-git abc123 user/repo main` |
| add-domain &lt;id&gt; &lt;host&gt; &lt;port&gt; [service] | 添加域名 | `/dokploy add-domain abc123 app.example.com 3000 web` |
| enable-ssl &lt;domainId&gt; | 启用 SSL | `/dokploy enable-ssl domain123` |
| delete-domain &lt;domainId&gt; | 删除域名 | `/dokploy delete-domain domain123` |
| update-domain &lt;domainId&gt; &lt;serviceName&gt; | 更新域名的 serviceName | `/dokploy update-domain domain123 web` |
| set-raw-compose &lt;id&gt; &lt;file&gt; | 设置 Raw Compose 配置 | `/dokploy set-raw-compose abc123 compose.yml` |
| create-mysql &lt;name&gt; &lt;envId&gt; &lt;db&gt; &lt;user&gt; | 创建 MySQL 数据库 | `/dokploy create-mysql mydb env123 appdb appuser` |
| deploy-mysql &lt;mysqlId&gt; | 部署 MySQL | `/dokploy deploy-mysql mysql123` |
| mysql-status &lt;mysqlId&gt; | 查看 MySQL 状态 | `/dokploy mysql-status mysql123` |
| create-volume &lt;id&gt; &lt;name&gt; &lt;path&gt; | 创建 Volume 挂载 | `/dokploy create-volume abc123 app_data /app/data` |
| create-bind &lt;id&gt; &lt;host&gt; &lt;path&gt; | 创建 Bind 挂载 | `/dokploy create-bind abc123 /data/uploads /app/uploads` |
| list-mounts &lt;composeId&gt; | 查看挂载列表 | `/dokploy list-mounts abc123` |

## 执行方式

使用 Bash 工具执行脚本：

```bash
node scripts/dokploy.js <action> [options]
```

## 示例工作流

### 查看所有项目
```bash
node scripts/dokploy.js
```

### 部署服务
```bash
node scripts/dokploy.js deploy <composeId>
```

### 创建新项目并部署
```bash
# 1. 创建项目
node scripts/dokploy.js create-project myapp

# 2. 创建 Compose（使用返回的 environmentId）
node scripts/dokploy.js create-compose web <envId>

# 3. 配置 Git 仓库（只需 owner/repo，自动使用代理）
node scripts/dokploy.js setup-git <composeId> user/repo main

# 4. 添加域名
node scripts/dokploy.js add-domain <composeId> app.example.com 3000

# 5. 部署
node scripts/dokploy.js deploy <composeId>
```

## CI/CD 配置

Dokploy 支持 Git Webhook 自动部署。配置 Git 仓库后，在 GitHub 仓库设置中添加 Webhook：

1. 进入 GitHub 仓库 Settings > Webhooks
2. 添加 Webhook URL（从 Dokploy 控制台获取）
3. Content type: application/json
4. 选择 "Just the push event"

推送代码后会自动触发部署。

## 私有仓库配置

使用 `init` 命令配置 Git 代理后，`setup-git` 会自动处理私有仓库访问：

```bash
# 配置代理
node scripts/dokploy.js init --git-proxy="https://user:token@proxy.example.com/https://github.com"

# setup-git 时只需提供 owner/repo 格式
node scripts/dokploy.js setup-git <composeId> myorg/myrepo main
# 自动转换为代理 URL
```

## SQLite 迁移到 MySQL

### 迁移步骤

```bash
# 1. 创建 MySQL 数据库（密码自动生成）
node scripts/dokploy.js create-mysql myapp-db <envId> appdb appuser

# 2. 部署 MySQL
node scripts/dokploy.js deploy-mysql <mysqlId>

# 3. 等待 MySQL 启动（约 30 秒）

# 4. 本地导出 SQLite 数据为 SQL
sqlite3 local.db .dump > dump.sql

# 5. 转换 SQLite SQL 为 MySQL 格式
# 6. 通过 Dokploy 控制台或 SSH 导入数据
```

### docker-compose.yml 配置示例

```yaml
services:
  app:
    environment:
      - DATABASE_URL=mysql://appuser:password@myapp-db:3306/appdb
    depends_on:
      - db

  db:
    image: mysql:8
    environment:
      MYSQL_DATABASE: appdb
      MYSQL_USER: appuser
      MYSQL_PASSWORD: password
      MYSQL_ROOT_PASSWORD: rootpassword
    volumes:
      - mysql_data:/var/lib/mysql

volumes:
  mysql_data:
```

### 注意事项

1. MySQL 内部主机名是 `appName`（创建时返回）
2. 端口固定为 3306
3. 密码不指定时自动生成，请保存好
4. 初始化 SQL 放在 `/docker-entrypoint-initdb.d/` 目录会自动执行

## Volume 存储管理

### 创建 Volume

```bash
# 创建命名 Volume（推荐，Docker 管理）
node scripts/dokploy.js create-volume <composeId> app_uploads /app/uploads

# 创建 Bind Mount（映射主机目录）
node scripts/dokploy.js create-bind <composeId> /data/myapp/uploads /app/uploads
```

### 常见存储场景

| 场景 | 挂载路径 | 说明 |
|------|----------|------|
| 用户上传 | /app/uploads | 图片、文件等 |
| 静态资源 | /app/public | 生成的静态文件 |
| 日志文件 | /app/logs | 应用日志 |
| 缓存目录 | /app/cache | 临时缓存 |
| 数据库文件 | /var/lib/mysql | MySQL 数据 |

### 注意事项

1. **Volume** - Docker 管理，数据在 `/var/lib/docker/volumes/`，推荐用于数据持久化
2. **Bind Mount** - 直接映射主机目录，适合需要主机访问的场景
3. 部署前创建 Volume，否则容器内数据会丢失
4. 备份重要数据时，备份 Volume 或主机目录
