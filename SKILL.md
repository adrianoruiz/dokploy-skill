---
name: dokploy
description: Dokploy ops management. Deploy, stop, and start services; manage projects and domains. Use /dokploy to see status, /dokploy deploy to deploy a service.
---

# Dokploy Ops Skill

Manage Dokploy services through the API.

## First-time setup

Configure your server before using the skill:

```bash
# Add a server
node scripts/dokploy.js init --name=myserver --url=https://your-dokploy.com --key=your-api-key

# Optional: configure a Git proxy (for private repo access)
node scripts/dokploy.js init --git-proxy="https://user:token@proxy.example.com/https://github.com"

# View the current config
node scripts/dokploy.js config
```

The config is stored at `~/.config/dokploy-skill/config.json` with `0600` permissions.

## Usage

```
/dokploy [action] [options]
```

## Multi-server support

Configure multiple Dokploy servers and switch with the `--server` flag:

```bash
# Add several servers
node scripts/dokploy.js init --name=prod --url=https://prod.example.com --key=xxx
node scripts/dokploy.js init --name=staging --url=https://staging.example.com --key=yyy

# Set the default server
node scripts/dokploy.js init --default=prod

# Use the default server
node scripts/dokploy.js list

# Switch to a specific server
node scripts/dokploy.js --server=staging list
```

`setup-git` automatically decides whether to use the Git proxy based on the server's `useGitProxy` setting.

## Pre-deploy checklist (important)

**Always build successfully locally before pushing code:**

```bash
# 1. Verify the build locally
docker compose build

# 2. Run locally to test (optional)
docker compose up -d
docker compose logs -f
docker compose down

# 3. Once the build succeeds, commit and push
git add .
git commit -m "feat: xxx"
git push

# 4. Trigger the remote deployment
node scripts/dokploy.js deploy <composeId>
```

## Raw Compose deployment (important)

When deploying third-party Docker images (e.g. new-api, vaultwarden), use Raw Compose mode:

### Why Raw Compose?

1. **Port conflicts** — third-party `docker-compose.yml` files usually map ports directly (e.g. `3000:3000`), which collide with other services.
2. **Network isolation** — services must join `dokploy-network` to be routed by Traefik.
3. **Custom config** — lets you adjust environment variables, dependencies, etc.

### Raw Compose template

```yaml
services:
  app:
    image: some/image:latest
    restart: always
    networks:
      - dokploy-network  # Required! Traefik reaches the service through this network
      - internal         # Internal service communication
    environment:
      - TZ=America/Sao_Paulo
      - DATABASE_URL=postgres://user:pass@db:5432/dbname
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    restart: always
    networks:
      - internal  # The database only needs the internal network
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
    external: true  # Use Dokploy's external network
  internal:
    driver: bridge  # Internal service communication

volumes:
  postgres_data:
```

### Key settings

| Setting | Meaning |
|---------|---------|
| `dokploy-network: external: true` | **Required.** Connects to Dokploy's Traefik network. |
| Main service joins `dokploy-network` | **Required.** Otherwise Traefik cannot route and returns 404. |
| DB/Redis join only `internal` | Security: internal services are not exposed to Traefik. |
| Do not map ports | Do not write `ports: - "3000:3000"`; let Traefik handle it. |
| Do not add Traefik labels manually | Dokploy adds them automatically; manual labels may conflict. |

### Deployment flow

```bash
# 1. Create a project
node scripts/dokploy.js create-project myapp

# 2. Create a compose service
node scripts/dokploy.js create-compose myapp <envId>

# 3. Set the Raw Compose (local file)
node scripts/dokploy.js set-raw-compose <composeId> ./my-compose.yml

# 4. Add a domain (serviceName must match the service name in the compose file)
node scripts/dokploy.js add-domain <composeId> app.example.com 3000 app

# 5. Enable SSL
node scripts/dokploy.js enable-ssl <domainId>

# 6. Deploy
node scripts/dokploy.js deploy <composeId>
```

## Troubleshooting

### 1. Port conflict: `port is already allocated`

**Cause**: the `docker-compose.yml` maps ports directly.

**Fix**: use Raw Compose mode and remove the `ports` config.

### 2. Database connection failure: `hostname resolving error: lookup db`

**Cause**: the services are not on the same network.

**Fix**: make sure every service that needs to communicate joins the same network (e.g. `internal`).

### 3. Traefik 404: domain configured but returns 404

**Possible causes**:
- The main service is not connected to `dokploy-network`.
- `serviceName` does not match the service name in the compose file.
- The container did not start correctly.

**Steps**:
```bash
# 1. Check deployment status
node scripts/dokploy.js status <composeId>

# 2. Confirm the domain's serviceName matches the compose service name

# 3. Confirm the main service in the compose file joins dokploy-network
```

### 4. Service name not found

**Cause**: the domain's `serviceName` is empty or does not match.

**Fix**:
```bash
node scripts/dokploy.js update-domain <domainId> <correctServiceName>
node scripts/dokploy.js deploy <composeId>
```

## Actions

| Action | Description | Example |
|--------|-------------|---------|
| (none) | List all projects and service status | `/dokploy` |
| init | Initialize/update config | `/dokploy init --name=dok --url=https://example.com --key=xxx` |
| config | View current config (key masked) | `/dokploy config` |
| status &lt;id&gt; | View a compose's status | `/dokploy status abc123` |
| deploy &lt;id&gt; | Deploy a service | `/dokploy deploy abc123` |
| stop &lt;id&gt; | Stop a service | `/dokploy stop abc123` |
| start &lt;id&gt; | Start a service | `/dokploy start abc123` |
| logs &lt;id&gt; | View deployment history | `/dokploy logs abc123` |
| create-project &lt;name&gt; | Create a new project | `/dokploy create-project myapp` |
| create-compose &lt;name&gt; &lt;envId&gt; | Create a compose service | `/dokploy create-compose web env123` |
| setup-git &lt;id&gt; &lt;owner/repo&gt; [branch] | Configure a Git repo (auto proxy) | `/dokploy setup-git abc123 user/repo main` |
| add-domain &lt;id&gt; &lt;host&gt; &lt;port&gt; [service] | Add a domain | `/dokploy add-domain abc123 app.example.com 3000 web` |
| enable-ssl &lt;domainId&gt; | Enable SSL | `/dokploy enable-ssl domain123` |
| delete-domain &lt;domainId&gt; | Delete a domain | `/dokploy delete-domain domain123` |
| update-domain &lt;domainId&gt; &lt;serviceName&gt; | Update a domain's serviceName | `/dokploy update-domain domain123 web` |
| set-raw-compose &lt;id&gt; &lt;file&gt; | Set the Raw Compose config | `/dokploy set-raw-compose abc123 compose.yml` |
| create-mysql &lt;name&gt; &lt;envId&gt; &lt;db&gt; &lt;user&gt; | Create a MySQL database | `/dokploy create-mysql mydb env123 appdb appuser` |
| deploy-mysql &lt;mysqlId&gt; | Deploy MySQL | `/dokploy deploy-mysql mysql123` |
| mysql-status &lt;mysqlId&gt; | View MySQL status | `/dokploy mysql-status mysql123` |
| create-volume &lt;id&gt; &lt;name&gt; &lt;path&gt; | Create a volume mount | `/dokploy create-volume abc123 app_data /app/data` |
| create-bind &lt;id&gt; &lt;host&gt; &lt;path&gt; | Create a bind mount | `/dokploy create-bind abc123 /data/uploads /app/uploads` |
| list-mounts &lt;composeId&gt; | List mounts | `/dokploy list-mounts abc123` |

## How it runs

Run the script with the Bash tool:

```bash
node scripts/dokploy.js <action> [options]
```

## Example workflows

### List all projects
```bash
node scripts/dokploy.js
```

### Deploy a service
```bash
node scripts/dokploy.js deploy <composeId>
```

### Create a new project and deploy
```bash
# 1. Create the project
node scripts/dokploy.js create-project myapp

# 2. Create a compose (using the returned environmentId)
node scripts/dokploy.js create-compose web <envId>

# 3. Configure the Git repo (just owner/repo, proxy applied automatically)
node scripts/dokploy.js setup-git <composeId> user/repo main

# 4. Add a domain
node scripts/dokploy.js add-domain <composeId> app.example.com 3000

# 5. Deploy
node scripts/dokploy.js deploy <composeId>
```

## CI/CD

Dokploy supports auto-deploy via Git webhook. After configuring the Git repo, add a webhook in the GitHub repo settings:

1. Go to the GitHub repo Settings > Webhooks
2. Add the webhook URL (from the Dokploy console)
3. Content type: application/json
4. Select "Just the push event"

Pushing code then triggers a deployment automatically.

## Private repositories

After configuring a Git proxy with `init`, `setup-git` handles private repo access automatically:

```bash
# Configure the proxy
node scripts/dokploy.js init --git-proxy="https://user:token@proxy.example.com/https://github.com"

# setup-git only needs the owner/repo format
node scripts/dokploy.js setup-git <composeId> myorg/myrepo main
# Automatically rewritten to the proxy URL
```

## Migrating SQLite to MySQL

### Steps

```bash
# 1. Create a MySQL database (password generated automatically)
node scripts/dokploy.js create-mysql myapp-db <envId> appdb appuser

# 2. Deploy MySQL
node scripts/dokploy.js deploy-mysql <mysqlId>

# 3. Wait for MySQL to start (~30 seconds)

# 4. Export the local SQLite data to SQL
sqlite3 local.db .dump > dump.sql

# 5. Convert the SQLite SQL to MySQL format
# 6. Import the data through the Dokploy console or via SSH
```

### docker-compose.yml example

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

### Notes

1. The MySQL internal hostname is `appName` (returned on create).
2. The port is fixed at 3306.
3. Passwords are generated automatically when not provided — save them.
4. Init SQL placed in `/docker-entrypoint-initdb.d/` runs automatically.

## Volume storage management

### Create a volume

```bash
# Create a named volume (recommended, Docker-managed)
node scripts/dokploy.js create-volume <composeId> app_uploads /app/uploads

# Create a bind mount (maps a host directory)
node scripts/dokploy.js create-bind <composeId> /data/myapp/uploads /app/uploads
```

### Common storage scenarios

| Scenario | Mount path | Notes |
|----------|------------|-------|
| User uploads | /app/uploads | Images, files, etc. |
| Static assets | /app/public | Generated static files |
| Log files | /app/logs | Application logs |
| Cache directory | /app/cache | Temporary cache |
| Database files | /var/lib/mysql | MySQL data |

### Notes

1. **Volume** — Docker-managed, data lives in `/var/lib/docker/volumes/`. Recommended for persistence.
2. **Bind mount** — maps a host directory directly; good when host access is needed.
3. Create the volume before deploying, otherwise container data is lost.
4. Back up important data by backing up the volume or host directory.
