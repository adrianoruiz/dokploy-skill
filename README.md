# Dokploy Skill for Claude Code

A Claude Code skill for managing [Dokploy](https://dokploy.com) deployments via the API — deploy services, manage projects, domains, databases and volumes.

## Installation

1. Clone this repo into your Claude Code skills directory:

````bash
git clone https://github.com/adrianoruiz/dokploy-skill.git ~/.claude/skills/dokploy
````

2. Initialize your server configuration:

````bash
node ~/.claude/skills/dokploy/scripts/dokploy.js init --name=myserver --url=https://your-dokploy.com --key=your-api-key
````

3. (Optional) Configure Git proxy for private repos:

````bash
node ~/.claude/skills/dokploy/scripts/dokploy.js init --git-proxy="https://user:token@proxy.example.com/https://github.com"
````

## Usage

In Claude Code, use the `/dokploy` command:

```
/dokploy                              # List all projects
/dokploy status <composeId>           # Check compose status
/dokploy deploy <composeId>           # Deploy a service
/dokploy stop <composeId>             # Stop a service
/dokploy start <composeId>            # Start a service
/dokploy logs <composeId>             # View deployment logs
/dokploy create-project <name>        # Create a new project
/dokploy create-compose <name> <env>  # Create a compose service
/dokploy setup-git <id> <repo> [branch] # Configure Git repo
/dokploy add-domain <id> <host> <port>  # Add domain
/dokploy enable-ssl <domainId>        # Enable SSL
/dokploy config                       # View current config
```

## Multi-Server Support

Add multiple servers and switch between them:

````bash
# Add servers
node dokploy.js init --name=prod --url=https://prod.example.com --key=xxx
node dokploy.js init --name=staging --url=https://staging.example.com --key=yyy

# Set default
node dokploy.js init --default=prod

# Switch per command
/dokploy --server=staging list
````

## Configuration

Config is stored at `~/.config/dokploy-skill/config.json` with restricted permissions (0600).

```json
{
  "defaultServer": "prod",
  "servers": {
    "prod": {
      "url": "https://prod.example.com",
      "apiKey": "your-api-key"
    }
  },
  "gitProxy": "https://user:token@proxy/https://github.com"
}
```

## License

MIT
