#!/usr/bin/env node
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Config file path
const CONFIG_PATH = path.join(os.homedir(), '.config', 'dokploy-skill', 'config.json');

// Load config file
function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return null;
    }
    const content = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    console.error(`Failed to load config: ${e.message}`);
    return null;
  }
}

// Parse the --server argument
function parseServerArg() {
  const serverArg = process.argv.find(arg => arg.startsWith('--server='));
  if (serverArg) {
    return serverArg.split('=')[1];
  }
  return process.env.DOKPLOY_SERVER || null;
}

// Mask an API key for display
function maskKey(key) {
  if (!key || key.length < 9) return '***';
  return key.slice(0, 3) + '...' + key.slice(-5);
}

// Generate a cryptographically strong password
function genPass() {
  return crypto.randomBytes(18).toString('base64url');
}

async function trpc(endpoint, method = 'GET', body = null) {
  const url = new URL(`/api/trpc/${endpoint}`, CONFIG.url);
  if (method === 'GET' && body) {
    url.searchParams.set('input', JSON.stringify({ json: body }));
  }

  const options = {
    method,
    headers: { 'x-api-key': CONFIG.apiKey, 'Content-Type': 'application/json' }
  };

  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json;
        try {
          json = JSON.parse(data);
        } catch {
          // Non-JSON body: treat any non-2xx as an error
          if (res.statusCode >= 400) {
            return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
          }
          return resolve(data);
        }
        // tRPC surfaces failures in an `error` field even with a 200 body
        if (json.error) {
          const msg = json.error?.json?.message || json.error?.message || JSON.stringify(json.error);
          return reject(new Error(msg));
        }
        if (res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
        }
        resolve(json.result?.data?.json ?? json);
      });
    });
    req.on('error', reject);
    if (method === 'POST' && body) req.write(JSON.stringify({ json: body }));
    req.end();
  });
}

// Global CONFIG, initialized in main()
let CONFIG = null;

const actions = {
  async init() {
    // Parse arguments
    const args = process.argv.slice(2);
    let name = null, url = null, key = null, gitProxy = null, defaultServer = null;

    for (const arg of args) {
      if (arg.startsWith('--name=')) name = arg.split('=')[1];
      else if (arg.startsWith('--url=')) url = arg.split('=')[1];
      else if (arg.startsWith('--key=')) key = arg.split('=')[1];
      else if (arg.startsWith('--git-proxy=')) gitProxy = arg.split('=')[1];
      else if (arg.startsWith('--default=')) defaultServer = arg.split('=')[1];
    }

    // Load existing config
    let config = loadConfig() || { servers: {} };

    // Add/update a server
    if (name && url && key) {
      config.servers[name] = { url, apiKey: key };
      // First server becomes the default
      if (!config.defaultServer) {
        config.defaultServer = name;
      }
      console.log(`Server "${name}" configured`);
    }

    // Set the Git proxy
    if (gitProxy) {
      config.gitProxy = gitProxy;
      console.log('Git proxy configured');
    }

    // Set the default server
    if (defaultServer) {
      if (config.servers[defaultServer]) {
        config.defaultServer = defaultServer;
        console.log(`Default server set to: ${defaultServer}`);
      } else {
        console.error(`Server "${defaultServer}" does not exist`);
        process.exit(1);
      }
    }

    // Create the config directory
    const configDir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Write the config file
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
    console.log(`Config saved to: ${CONFIG_PATH}`);
  },

  async config() {
    const config = loadConfig();
    if (!config) {
      console.log('No config file found');
      return;
    }

    console.log('\n=== Dokploy config ===\n');

    if (config.servers && Object.keys(config.servers).length > 0) {
      for (const [name, server] of Object.entries(config.servers)) {
        const isDefault = name === config.defaultServer;
        console.log(`Server: ${name} (${server.url})${isDefault ? ' [default]' : ''}`);
        console.log(`        API key: ${maskKey(server.apiKey)}`);
        if (server.useGitProxy) {
          console.log(`        uses Git proxy`);
        }
      }
    } else {
      console.log('No servers configured');
    }

    if (config.gitProxy) {
      console.log('\nGit proxy: configured');
    }
  },

  async list() {
    const projects = await trpc('project.all', 'GET');
    console.log('\n=== Projects ===\n');
    for (const p of projects || []) {
      console.log(`[${p.projectId}] ${p.name}`);
      // Walk each project's environments
      const envs = p.environments || [];
      for (const env of envs) {
        if (env.compose?.length) {
          for (const c of env.compose) {
            console.log(`  └─ [${c.composeId}] ${c.name} (${c.composeStatus || 'unknown'})`);
          }
        }
      }
    }
  },

  async status(composeId) {
    if (!composeId) return console.error('Usage: status <composeId>');
    const data = await trpc('compose.one', 'GET', { composeId });
    console.log('\n=== Compose status ===');
    console.log(`Name: ${data.name}`);
    console.log(`appName: ${data.appName}`);
    console.log(`Status: ${data.composeStatus}`);
    console.log(`Type: ${data.composeType}`);
    console.log(`Source: ${data.sourceType}`);
    if (data.customGitUrl) console.log(`Git: ${data.customGitUrl} (${data.customGitBranch})`);
    if (data.domains?.length) {
      console.log('\nDomains:');
      for (const d of data.domains) {
        console.log(`  - ${d.host}:${d.port} -> serviceName: "${d.serviceName || ''}" [${d.domainId}]`);
      }
    }
    if (data.composeFile) {
      console.log('\nCompose file:');
      console.log(data.composeFile);
    }
  },

  async deploy(composeId) {
    if (!composeId) return console.error('Usage: deploy <composeId>');
    await trpc('compose.deploy', 'POST', { composeId });
    console.log(`Deployment triggered: ${composeId}`);
  },

  async stop(composeId) {
    if (!composeId) return console.error('Usage: stop <composeId>');
    await trpc('compose.stop', 'POST', { composeId });
    console.log(`Stopped: ${composeId}`);
  },

  async start(composeId) {
    if (!composeId) return console.error('Usage: start <composeId>');
    await trpc('compose.start', 'POST', { composeId });
    console.log(`Started: ${composeId}`);
  },

  async logs(composeId) {
    if (!composeId) return console.error('Usage: logs <composeId>');
    const data = await trpc('deployment.allByCompose', 'GET', { composeId });
    console.log('\n=== Deployments ===\n');
    for (const d of (data || []).slice(0, 10)) {
      console.log(`[${d.deploymentId}] ${d.status} - ${new Date(d.createdAt).toLocaleString()}`);
    }
  },

  async 'deployment-log'(deploymentId) {
    if (!deploymentId) return console.error('Usage: deployment-log <deploymentId>');
    const data = await trpc('deployment.one', 'GET', { deploymentId });
    console.log(JSON.stringify(data, null, 2));
  },

  async 'create-project'(name, description = '') {
    if (!name) return console.error('Usage: create-project <name> [description]');
    const data = await trpc('project.create', 'POST', { name, description });
    console.log(`Project created:`);
    console.log(`  projectId: ${data.projectId}`);
    console.log(`  environmentId: ${data.environment?.environmentId}`);
  },

  async 'create-compose'(name, environmentId) {
    if (!name || !environmentId) return console.error('Usage: create-compose <name> <environmentId>');
    const data = await trpc('compose.create', 'POST', {
      name, environmentId, composeType: 'docker-compose'
    });
    console.log(`Compose created:`);
    console.log(`  composeId: ${data.composeId}`);
  },

  async 'setup-git'(composeId, repoPath, branch = 'main') {
    if (!composeId || !repoPath) return console.error('Usage: setup-git <composeId> <owner/repo> [branch]');
    // Use the proxy only if the server is configured for it
    const repoUrl = CONFIG.useGitProxy && CONFIG.gitProxy
      ? `${CONFIG.gitProxy}/${repoPath}.git`
      : `https://github.com/${repoPath}.git`;
    await trpc('compose.update', 'POST', {
      composeId,
      sourceType: 'git',
      customGitUrl: repoUrl,
      customGitBranch: branch,
      composePath: './docker-compose.yml'
    });
    console.log(`Git repo configured: ${repoPath} (${branch})`);
    console.log(`  URL: ${repoUrl}`);
    if (CONFIG.useGitProxy) console.log(`  (using proxy)`);
  },

  async 'set-raw-compose'(composeId, composeFile) {
    if (!composeId || !composeFile) return console.error('Usage: set-raw-compose <composeId> <composeFile>');
    const content = fs.readFileSync(composeFile, 'utf8');
    await trpc('compose.update', 'POST', {
      composeId,
      sourceType: 'raw',
      composeFile: content
    });
    console.log(`Raw compose set: ${composeId}`);
  },

  async 'add-domain'(composeId, host, port, serviceName = '') {
    if (!composeId || !host || !port) return console.error('Usage: add-domain <composeId> <host> <port> [serviceName]');
    const body = { host, port: parseInt(port), composeId };
    if (serviceName) body.serviceName = serviceName;
    const data = await trpc('domain.create', 'POST', body);
    console.log(`Domain added:`);
    console.log(`  domainId: ${data.domainId}`);
    console.log(`  host: ${host}`);
  },

  async 'enable-ssl'(domainId) {
    if (!domainId) return console.error('Usage: enable-ssl <domainId>');
    const domain = await trpc('domain.one', 'GET', { domainId });
    await trpc('domain.update', 'POST', {
      domainId,
      host: domain.host,
      port: domain.port,
      https: true,
      certificateType: 'letsencrypt'
    });
    console.log(`SSL enabled: ${domain.host}`);
  },

  async 'delete-domain'(domainId) {
    if (!domainId) return console.error('Usage: delete-domain <domainId>');
    await trpc('domain.delete', 'POST', { domainId });
    console.log(`Domain deleted: ${domainId}`);
  },

  async 'update-domain'(domainId, serviceName) {
    if (!domainId) return console.error('Usage: update-domain <domainId> <serviceName>');
    const domain = await trpc('domain.one', 'GET', { domainId });
    await trpc('domain.update', 'POST', {
      domainId,
      host: domain.host,
      port: domain.port,
      https: domain.https,
      certificateType: domain.certificateType,
      serviceName: serviceName || ''
    });
    console.log(`Domain updated: ${domain.host}, serviceName: ${serviceName || '(empty)'}`);
  },

  async 'create-mysql'(name, environmentId, dbName, dbUser, dbPass, rootPass) {
    if (!name || !environmentId || !dbName || !dbUser) {
      return console.error('Usage: create-mysql <name> <environmentId> <dbName> <dbUser> [dbPass] [rootPass]');
    }
    // Generate strong passwords when not provided
    dbPass = dbPass || genPass();
    rootPass = rootPass || genPass();

    const data = await trpc('mysql.create', 'POST', {
      name,
      appName: name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      environmentId,
      databaseName: dbName,
      databaseUser: dbUser,
      databasePassword: dbPass,
      databaseRootPassword: rootPass,
      dockerImage: 'mysql:8'
    });

    console.log(`MySQL created:`);
    console.log(`  mysqlId: ${data.mysqlId}`);
    console.log(`  appName: ${data.appName}`);
    console.log(`  database: ${dbName}`);
    console.log(`  user: ${dbUser}`);
    console.log(`  password: ${dbPass}`);
    console.log(`  root password: ${rootPass}`);
    console.log(`\nConnection info (inside docker-compose):`);
    console.log(`  HOST: ${data.appName}`);
    console.log(`  PORT: 3306`);
  },

  async 'deploy-mysql'(mysqlId) {
    if (!mysqlId) return console.error('Usage: deploy-mysql <mysqlId>');
    await trpc('mysql.deploy', 'POST', { mysqlId });
    console.log(`MySQL deployment triggered: ${mysqlId}`);
  },

  async 'mysql-status'(mysqlId) {
    if (!mysqlId) return console.error('Usage: mysql-status <mysqlId>');
    const data = await trpc('mysql.one', 'GET', { mysqlId });
    console.log('\n=== MySQL status ===');
    console.log(`Name: ${data.name}`);
    console.log(`Status: ${data.applicationStatus}`);
    console.log(`Database: ${data.databaseName}`);
    console.log(`User: ${data.databaseUser}`);
    console.log(`Internal host: ${data.appName}`);
  },

  async 'create-volume'(serviceId, volumeName, mountPath, serviceType = 'compose') {
    if (!serviceId || !volumeName || !mountPath) {
      return console.error('Usage: create-volume <serviceId> <volumeName> <mountPath> [serviceType]');
    }
    const data = await trpc('mounts.create', 'POST', {
      type: 'volume',
      volumeName,
      mountPath,
      serviceId,
      serviceType
    });
    console.log(`Volume created:`);
    console.log(`  mountId: ${data.mountId}`);
    console.log(`  volumeName: ${volumeName}`);
    console.log(`  mountPath: ${mountPath}`);
  },

  async 'create-bind'(serviceId, hostPath, mountPath, serviceType = 'compose') {
    if (!serviceId || !hostPath || !mountPath) {
      return console.error('Usage: create-bind <serviceId> <hostPath> <mountPath> [serviceType]');
    }
    const data = await trpc('mounts.create', 'POST', {
      type: 'bind',
      hostPath,
      mountPath,
      serviceId,
      serviceType
    });
    console.log(`Bind mount created:`);
    console.log(`  mountId: ${data.mountId}`);
    console.log(`  hostPath: ${hostPath}`);
    console.log(`  mountPath: ${mountPath}`);
  },

  async 'list-mounts'(composeId) {
    if (!composeId) return console.error('Usage: list-mounts <composeId>');
    const data = await trpc('compose.loadMountsByService', 'GET', { composeId });
    console.log('\n=== Mounts ===\n');
    if (!data || Object.keys(data).length === 0) {
      console.log('No mounts');
      return;
    }
    for (const [service, mounts] of Object.entries(data)) {
      console.log(`Service: ${service}`);
      for (const m of mounts) {
        console.log(`  [${m.mountId}] ${m.type}: ${m.hostPath || m.volumeName} -> ${m.mountPath}`);
      }
    }
  }
};

async function main() {
  // Strip the --server argument out
  const args = process.argv.slice(2).filter(arg => !arg.startsWith('--server='));
  const [action = 'list', ...actionArgs] = args;

  // init and config do not need a server config loaded
  if (action === 'init' || action === 'config') {
    const fn = actions[action];
    if (fn) {
      try {
        await fn(...actionArgs);
      } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
      }
    }
    return;
  }

  // Every other command needs a config
  const config = loadConfig();
  if (!config || !config.servers || Object.keys(config.servers).length === 0) {
    console.error('No config file found. Run init first to configure a server:');
    console.error('node dokploy.js init --name=myserver --url=https://your-server.com --key=your-api-key');
    process.exit(1);
  }

  // Resolve which server to use
  const serverName = parseServerArg() || config.defaultServer;
  const serverConfig = config.servers[serverName];

  if (!serverConfig) {
    console.error(`Unknown server: ${serverName}`);
    console.log('Available servers: ' + Object.keys(config.servers).join(', '));
    process.exit(1);
  }

  // Set the global CONFIG
  CONFIG = {
    url: serverConfig.url,
    apiKey: serverConfig.apiKey,
    useGitProxy: serverConfig.useGitProxy || false,
    gitProxy: config.gitProxy || null
  };

  const fn = actions[action];
  if (!fn) {
    console.error(`Unknown action: ${action}`);
    console.log('Available actions: ' + Object.keys(actions).join(', '));
    console.log(`Current server: ${serverName} (${CONFIG.url})`);
    process.exit(1);
  }

  try {
    await fn(...actionArgs);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();
