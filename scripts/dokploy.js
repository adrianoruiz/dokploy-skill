#!/usr/bin/env node
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 配置文件路径
const CONFIG_PATH = path.join(os.homedir(), '.config', 'dokploy-skill', 'config.json');

// 加载配置文件
function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return null;
    }
    const content = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    console.error(`配置文件加载失败: ${e.message}`);
    return null;
  }
}

// 解析 --server 参数
function parseServerArg() {
  const serverArg = process.argv.find(arg => arg.startsWith('--server='));
  if (serverArg) {
    return serverArg.split('=')[1];
  }
  return process.env.DOKPLOY_SERVER || null;
}

// 脱敏显示 key
function maskKey(key) {
  if (!key || key.length < 9) return '***';
  return key.slice(0, 3) + '...' + key.slice(-5);
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
        try {
          const json = JSON.parse(data);
          resolve(json.result?.data?.json || json);
        } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (method === 'POST' && body) req.write(JSON.stringify({ json: body }));
    req.end();
  });
}

// 全局 CONFIG 变量，在 main 中初始化
let CONFIG = null;

const actions = {
  async init() {
    // 解析参数
    const args = process.argv.slice(2);
    let name = null, url = null, key = null, gitProxy = null, defaultServer = null;

    for (const arg of args) {
      if (arg.startsWith('--name=')) name = arg.split('=')[1];
      else if (arg.startsWith('--url=')) url = arg.split('=')[1];
      else if (arg.startsWith('--key=')) key = arg.split('=')[1];
      else if (arg.startsWith('--git-proxy=')) gitProxy = arg.split('=')[1];
      else if (arg.startsWith('--default=')) defaultServer = arg.split('=')[1];
    }

    // 读取现有配置
    let config = loadConfig() || { servers: {} };

    // 添加/更新服务器
    if (name && url && key) {
      config.servers[name] = { url, apiKey: key };
      // 如果是第一个服务器，设为默认
      if (!config.defaultServer) {
        config.defaultServer = name;
      }
      console.log(`服务器 ${name} 已配置`);
    }

    // 设置 Git 代理
    if (gitProxy) {
      config.gitProxy = gitProxy;
      console.log('Git 代理已配置');
    }

    // 设置默认服务器
    if (defaultServer) {
      if (config.servers[defaultServer]) {
        config.defaultServer = defaultServer;
        console.log(`默认服务器已设置为: ${defaultServer}`);
      } else {
        console.error(`服务器 ${defaultServer} 不存在`);
        process.exit(1);
      }
    }

    // 创建目录
    const configDir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // 写入配置文件
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
    console.log(`配置已保存到: ${CONFIG_PATH}`);
  },

  async config() {
    const config = loadConfig();
    if (!config) {
      console.log('未找到配置文件');
      return;
    }

    console.log('\n=== Dokploy 配置 ===\n');

    if (config.servers && Object.keys(config.servers).length > 0) {
      for (const [name, server] of Object.entries(config.servers)) {
        const isDefault = name === config.defaultServer;
        console.log(`服务器: ${name} (${server.url})${isDefault ? ' [默认]' : ''}`);
        console.log(`         API Key: ${maskKey(server.apiKey)}`);
        if (server.useGitProxy) {
          console.log(`         使用 Git 代理`);
        }
      }
    } else {
      console.log('未配置服务器');
    }

    if (config.gitProxy) {
      console.log('\nGit 代理: 已配置');
    }
  },

  async list() {
    const projects = await trpc('project.all', 'GET');
    console.log('\n=== 项目列表 ===\n');
    for (const p of projects || []) {
      console.log(`[${p.projectId}] ${p.name}`);
      // 获取每个项目的详细信息
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
    if (!composeId) return console.error('用法: status <composeId>');
    const data = await trpc('compose.one', 'GET', { composeId });
    console.log('\n=== Compose 状态 ===');
    console.log(`名称: ${data.name}`);
    console.log(`appName: ${data.appName}`);
    console.log(`状态: ${data.composeStatus}`);
    console.log(`类型: ${data.composeType}`);
    console.log(`源: ${data.sourceType}`);
    if (data.customGitUrl) console.log(`Git: ${data.customGitUrl} (${data.customGitBranch})`);
    if (data.domains?.length) {
      console.log('\n域名配置:');
      for (const d of data.domains) {
        console.log(`  - ${d.host}:${d.port} -> serviceName: "${d.serviceName || ''}" [${d.domainId}]`);
      }
    }
    if (data.composeFile) {
      console.log('\nCompose 文件内容:');
      console.log(data.composeFile);
    }
  },

  async deploy(composeId) {
    if (!composeId) return console.error('用法: deploy <composeId>');
    await trpc('compose.deploy', 'POST', { composeId });
    console.log(`部署已触发: ${composeId}`);
  },

  async stop(composeId) {
    if (!composeId) return console.error('用法: stop <composeId>');
    await trpc('compose.stop', 'POST', { composeId });
    console.log(`已停止: ${composeId}`);
  },

  async start(composeId) {
    if (!composeId) return console.error('用法: start <composeId>');
    await trpc('compose.start', 'POST', { composeId });
    console.log(`已启动: ${composeId}`);
  },

  async logs(composeId) {
    if (!composeId) return console.error('用法: logs <composeId>');
    const data = await trpc('deployment.allByCompose', 'GET', { composeId });
    console.log('\n=== 部署记录 ===\n');
    for (const d of (data || []).slice(0, 10)) {
      console.log(`[${d.deploymentId}] ${d.status} - ${new Date(d.createdAt).toLocaleString()}`);
    }
  },

  async 'deployment-log'(deploymentId) {
    if (!deploymentId) return console.error('用法: deployment-log <deploymentId>');
    const data = await trpc('deployment.one', 'GET', { deploymentId });
    console.log(JSON.stringify(data, null, 2));
  },

  async 'create-project'(name, description = '') {
    if (!name) return console.error('用法: create-project <name> [description]');
    const data = await trpc('project.create', 'POST', { name, description });
    console.log(`项目已创建:`);
    console.log(`  projectId: ${data.projectId}`);
    console.log(`  environmentId: ${data.environment?.environmentId}`);
  },

  async 'create-compose'(name, environmentId) {
    if (!name || !environmentId) return console.error('用法: create-compose <name> <environmentId>');
    const data = await trpc('compose.create', 'POST', {
      name, environmentId, composeType: 'docker-compose'
    });
    console.log(`Compose 已创建:`);
    console.log(`  composeId: ${data.composeId}`);
  },

  async 'setup-git'(composeId, repoPath, branch = 'main') {
    if (!composeId || !repoPath) return console.error('用法: setup-git <composeId> <owner/repo> [branch]');
    // 根据服务器配置决定是否使用代理
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
    console.log(`Git 仓库已配置: ${repoPath} (${branch})`);
    console.log(`  URL: ${repoUrl}`);
    if (CONFIG.useGitProxy) console.log(`  (使用代理)`);
  },

  async 'set-raw-compose'(composeId, composeFile) {
    if (!composeId || !composeFile) return console.error('用法: set-raw-compose <composeId> <composeFile>');
    const content = fs.readFileSync(composeFile, 'utf8');
    await trpc('compose.update', 'POST', {
      composeId,
      sourceType: 'raw',
      composeFile: content
    });
    console.log(`Raw Compose 已设置: ${composeId}`);
  },

  async 'add-domain'(composeId, host, port, serviceName = '') {
    if (!composeId || !host || !port) return console.error('用法: add-domain <composeId> <host> <port> [serviceName]');
    const body = { host, port: parseInt(port), composeId };
    if (serviceName) body.serviceName = serviceName;
    const data = await trpc('domain.create', 'POST', body);
    console.log(`域名已添加:`);
    console.log(`  domainId: ${data.domainId}`);
    console.log(`  host: ${host}`);
  },

  async 'enable-ssl'(domainId) {
    if (!domainId) return console.error('用法: enable-ssl <domainId>');
    const domain = await trpc('domain.one', 'GET', { domainId });
    await trpc('domain.update', 'POST', {
      domainId,
      host: domain.host,
      port: domain.port,
      https: true,
      certificateType: 'letsencrypt'
    });
    console.log(`SSL 已启用: ${domain.host}`);
  },

  async 'delete-domain'(domainId) {
    if (!domainId) return console.error('用法: delete-domain <domainId>');
    await trpc('domain.delete', 'POST', { domainId });
    console.log(`域名已删除: ${domainId}`);
  },

  async 'update-domain'(domainId, serviceName) {
    if (!domainId) return console.error('用法: update-domain <domainId> <serviceName>');
    const domain = await trpc('domain.one', 'GET', { domainId });
    await trpc('domain.update', 'POST', {
      domainId,
      host: domain.host,
      port: domain.port,
      https: domain.https,
      certificateType: domain.certificateType,
      serviceName: serviceName || ''
    });
    console.log(`域名已更新: ${domain.host}, serviceName: ${serviceName || '(空)'}`);
  },

  async 'create-mysql'(name, environmentId, dbName, dbUser, dbPass, rootPass) {
    if (!name || !environmentId || !dbName || !dbUser) {
      return console.error('用法: create-mysql <name> <environmentId> <dbName> <dbUser> [dbPass] [rootPass]');
    }
    // 生成随机密码
    const genPass = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
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

    console.log(`MySQL 已创建:`);
    console.log(`  mysqlId: ${data.mysqlId}`);
    console.log(`  appName: ${data.appName}`);
    console.log(`  数据库: ${dbName}`);
    console.log(`  用户: ${dbUser}`);
    console.log(`  密码: ${dbPass}`);
    console.log(`  Root密码: ${rootPass}`);
    console.log(`\n连接信息 (docker-compose 内部):`);
    console.log(`  HOST: ${data.appName}`);
    console.log(`  PORT: 3306`);
  },

  async 'deploy-mysql'(mysqlId) {
    if (!mysqlId) return console.error('用法: deploy-mysql <mysqlId>');
    await trpc('mysql.deploy', 'POST', { mysqlId });
    console.log(`MySQL 部署已触发: ${mysqlId}`);
  },

  async 'mysql-status'(mysqlId) {
    if (!mysqlId) return console.error('用法: mysql-status <mysqlId>');
    const data = await trpc('mysql.one', 'GET', { mysqlId });
    console.log('\n=== MySQL 状态 ===');
    console.log(`名称: ${data.name}`);
    console.log(`状态: ${data.applicationStatus}`);
    console.log(`数据库: ${data.databaseName}`);
    console.log(`用户: ${data.databaseUser}`);
    console.log(`内部主机: ${data.appName}`);
  },

  async 'create-volume'(serviceId, volumeName, mountPath, serviceType = 'compose') {
    if (!serviceId || !volumeName || !mountPath) {
      return console.error('用法: create-volume <serviceId> <volumeName> <mountPath> [serviceType]');
    }
    const data = await trpc('mounts.create', 'POST', {
      type: 'volume',
      volumeName,
      mountPath,
      serviceId,
      serviceType
    });
    console.log(`Volume 已创建:`);
    console.log(`  mountId: ${data.mountId}`);
    console.log(`  volumeName: ${volumeName}`);
    console.log(`  mountPath: ${mountPath}`);
  },

  async 'create-bind'(serviceId, hostPath, mountPath, serviceType = 'compose') {
    if (!serviceId || !hostPath || !mountPath) {
      return console.error('用法: create-bind <serviceId> <hostPath> <mountPath> [serviceType]');
    }
    const data = await trpc('mounts.create', 'POST', {
      type: 'bind',
      hostPath,
      mountPath,
      serviceId,
      serviceType
    });
    console.log(`Bind Mount 已创建:`);
    console.log(`  mountId: ${data.mountId}`);
    console.log(`  hostPath: ${hostPath}`);
    console.log(`  mountPath: ${mountPath}`);
  },

  async 'list-mounts'(composeId) {
    if (!composeId) return console.error('用法: list-mounts <composeId>');
    const data = await trpc('compose.loadMountsByService', 'GET', { composeId });
    console.log('\n=== Mounts 列表 ===\n');
    if (!data || Object.keys(data).length === 0) {
      console.log('暂无挂载');
      return;
    }
    for (const [service, mounts] of Object.entries(data)) {
      console.log(`服务: ${service}`);
      for (const m of mounts) {
        console.log(`  [${m.mountId}] ${m.type}: ${m.hostPath || m.volumeName} -> ${m.mountPath}`);
      }
    }
  }
};

async function main() {
  // 过滤掉 --server 参数
  const args = process.argv.slice(2).filter(arg => !arg.startsWith('--server='));
  const [action = 'list', ...actionArgs] = args;

  // init 和 config 命令不需要加载服务器配置
  if (action === 'init' || action === 'config') {
    const fn = actions[action];
    if (fn) {
      try {
        await fn(...actionArgs);
      } catch (e) {
        console.error('错误:', e.message);
        process.exit(1);
      }
    }
    return;
  }

  // 其他命令需要加载配置
  const config = loadConfig();
  if (!config || !config.servers || Object.keys(config.servers).length === 0) {
    console.error('未找到配置文件。请先运行 init 命令配置服务器:');
    console.error('node dokploy.js init --name=myserver --url=https://your-server.com --key=your-api-key');
    process.exit(1);
  }

  // 解析服务器参数
  const serverName = parseServerArg() || config.defaultServer;
  const serverConfig = config.servers[serverName];

  if (!serverConfig) {
    console.error(`未知服务器: ${serverName}`);
    console.log('可用服务器: ' + Object.keys(config.servers).join(', '));
    process.exit(1);
  }

  // 设置全局 CONFIG
  CONFIG = {
    url: serverConfig.url,
    apiKey: serverConfig.apiKey,
    useGitProxy: serverConfig.useGitProxy || false,
    gitProxy: config.gitProxy || null
  };

  const fn = actions[action];
  if (!fn) {
    console.error(`未知操作: ${action}`);
    console.log('可用操作: ' + Object.keys(actions).join(', '));
    console.log(`当前服务器: ${serverName} (${CONFIG.url})`);
    process.exit(1);
  }

  try {
    await fn(...actionArgs);
  } catch (e) {
    console.error('错误:', e.message);
    process.exit(1);
  }
}

main();
