const BasePouchCommand = require('../BasePouchCommand')
const GitHubConfigManager = require('../../../utils/GitHubConfigManager')
const GitHubProtocol = require('../../resource/protocols/GitHubProtocol')
const GitHubDiscovery = require('../../resource/discovery/GitHubDiscovery')
const GitHubAdapter = require('../../../adapters/GitHubAdapter')
const ProjectDiscovery = require('../../resource/discovery/ProjectDiscovery')
const { getDirectoryService } = require('../../../utils/DirectoryService')
const fs = require('fs-extra')
const path = require('path')
const logger = require('../../../utils/logger')

/**
 * GitHub管理命令
 * 提供GitHub配置、连接测试、缓存管理等功能
 */
class GitHubCommand extends BasePouchCommand {
  constructor() {
    super()
    this.configManager = new GitHubConfigManager()
    this.githubProtocol = new GitHubProtocol()
    this.githubDiscovery = new GitHubDiscovery()
    this.githubAdapter = new GitHubAdapter()
    this.projectDiscovery = new ProjectDiscovery()
    this.directoryService = getDirectoryService()
  }

  /**
   * 获取锦囊目的说明
   * @returns {string} 目的说明
   */
  getPurpose() {
    return 'GitHub集成管理 - 配置、测试和管理GitHub仓库中的角色资源'
  }

  /**
   * 获取PATEOAS导航信息
   * @param {Array} args - 命令参数
   * @returns {Object} PATEOAS导航
   */
  async getPATEOAS() {
    return {
      currentState: 'github_management',
      availableTransitions: ['config', 'test', 'discover', 'cache', 'stats', 'upload'],
      nextActions: [
        {
          name: 'GitHub配置管理',
          description: '查看或配置GitHub集成设置',
          method: 'promptx github config',
          priority: 'high'
        },
        {
          name: 'GitHub连接测试',
          description: '测试GitHub API连接和权限',
          method: 'promptx github test',
          priority: 'medium'
        },
        {
          name: 'GitHub资源发现',
          description: '扫描GitHub仓库中的角色资源',
          method: 'promptx github discover',
          priority: 'medium'
        },
        {
          name: 'GitHub角色上传',
          description: '上传项目级角色到GitHub仓库',
          method: 'promptx github upload <role-name>',
          priority: 'medium'
        }
      ],
      metadata: {
        systemVersion: 'GitHub集成 v1.0',
        supportedOperations: ['config', 'test', 'discover', 'cache', 'stats', 'upload']
      }
    }
  }

  /**
   * 获取命令内容
   * @param {Array} args - 命令参数
   * @returns {Promise<string>} 命令输出
   */
  async getContent(args) {
    const [subCommand, ...subArgs] = args

    try {
      switch (subCommand) {
        case 'config':
          return await this.handleConfig(subArgs)
        case 'test':
          return await this.handleTest(subArgs)
        case 'cache':
          return await this.handleCache(subArgs)
        case 'discover':
          return await this.handleDiscover(subArgs)
        case 'stats':
          return await this.handleStats(subArgs)
        case 'repo':
          return await this.handleRepo(subArgs)
        case 'auth':
          return await this.handleAuth(subArgs)
        case 'upload':
          return await this.handleUpload(subArgs)
        default:
          return this.getHelp()
      }
    } catch (error) {
      logger.error(`[GitHubCommand] 命令执行失败: ${error.message}`)
      return `❌ 命令执行失败: ${error.message}`
    }
  }

  /**
   * 处理配置相关命令
   * @private
   */
  async handleConfig(args) {
    const [action] = args

    switch (action) {
      case 'show':
        return await this.showConfig()
      case 'validate':
        return await this.validateConfig()
      case 'init':
        return await this.initConfig()
      default:
        return this.getConfigHelp()
    }
  }

  /**
   * 显示当前配置
   * @private
   */
  async showConfig() {
    try {
      await this.configManager.initialize()
      const config = this.configManager.getConfig()
      
      let output = '📋 **GitHub配置信息**\n\n'
      output += `**状态**: ${config.enabled ? '✅ 已启用' : '❌ 已禁用'}\n`
      output += `**版本**: ${config.version}\n`
      output += `**全局Token**: ${config.auth?.token ? '✅ 已配置' : '❌ 未配置'}\n`
      output += `**缓存**: ${config.cache?.enabled ? '✅ 已启用' : '❌ 已禁用'}\n`
      
      if (config.cache?.enabled) {
        output += `  - TTL: ${config.cache.ttl}秒\n`
        output += `  - 最大缓存: ${config.cache.maxSize}个文件\n`
      }
      
      output += `\n**仓库配置** (${config.repositories?.length || 0}个):\n`
      
      if (config.repositories && config.repositories.length > 0) {
        for (const repo of config.repositories) {
          const repoKey = `${repo.owner}/${repo.name}`
          output += `\n📁 **${repoKey}**\n`
          output += `  - 分支: ${repo.branch || 'main'}\n`
          output += `  - 状态: ${repo.enabled ? '✅ 已启用' : '❌ 已禁用'}\n`
          output += `  - 类型: ${repo.private ? '🔒 私有' : '🌐 公开'}\n`
          output += `  - 角色前缀: ${repo.rolePrefix}\n`
          output += `  - 优先级: ${repo.priority}\n`
          output += `  - 专用Token: ${repo.token ? '✅ 已配置' : '❌ 未配置'}\n`
          if (repo.metadata?.description) {
            output += `  - 描述: ${repo.metadata.description}\n`
          }
        }
      } else {
        output += '\n⚠️ 未配置任何仓库\n'
      }
      
      return output
    } catch (error) {
      return `❌ 获取配置失败: ${error.message}`
    }
  }

  /**
   * 验证配置
   * @private
   */
  async validateConfig() {
    try {
      await this.configManager.initialize()
      
      if (!this.configManager.initialized) {
        return '❌ 配置未正确初始化，请检查配置文件'
      }
      
      const config = this.configManager.getConfig()
      if (!config.enabled) {
        return '⚠️ GitHub功能已禁用'
      }
      
      const enabledRepos = this.configManager.getEnabledRepositories()
      if (enabledRepos.length === 0) {
        return '⚠️ 没有启用的仓库配置'
      }
      
      let output = '🔍 **GitHub连接测试**\n\n'
      
      for (const repo of enabledRepos) {
        const repoKey = `${repo.owner}/${repo.name}`
        output += `📁 **${repoKey}** (${repo.branch || 'main'})\n`
        
        try {
          const result = await this.configManager.validateConnection(repoKey)
          if (result.success) {
            output += `  ✅ 连接成功\n`
            output += `  - 类型: ${result.private ? '🔒 私有' : '🌐 公开'}\n`
            output += `  - 权限: 读取${result.permissions?.write ? '、写入' : ''}${result.permissions?.admin ? '、管理' : ''}\n`
            if (result.lastUpdated) {
              output += `  - 最后更新: ${new Date(result.lastUpdated).toLocaleString()}\n`
            }
          } else {
            output += `  ❌ 连接失败: ${result.error}\n`
          }
        } catch (error) {
          output += `  ❌ 测试失败: ${error.message}\n`
        }
        
        output += '\n'
      }
      
      return output
    } catch (error) {
      return `❌ 验证失败: ${error.message}`
    }
  }

  /**
   * 初始化配置
   * @private
   */
  async initConfig() {
    try {
      // 强制重新初始化，这会创建默认配置文件
      await this.configManager.initialize()
      
      return `✅ GitHub配置已初始化
      
📝 **下一步操作**:
1. 编辑配置文件: \`.promptx/github.config.json\`
2. 设置GitHub Personal Access Token
3. 配置要扫描的仓库信息
4. 运行 \`promptx github test\` 验证连接

📖 详细配置说明请参考: docs/github-integration-guide.md`
    } catch (error) {
      return `❌ 初始化失败: ${error.message}`
    }
  }

  /**
   * 处理连接测试命令
   * @private
   */
  async handleTest(args) {
    const [repoKey] = args
    
    try {
      await this.configManager.initialize()
      
      if (repoKey) {
        // 测试指定仓库
        const result = await this.configManager.validateConnection(repoKey)
        if (result.success) {
          return `✅ 仓库 "${repoKey}" 连接成功\n- 类型: ${result.private ? '私有' : '公开'}\n- 分支: ${result.branch}`
        } else {
          return `❌ 仓库 "${repoKey}" 连接失败: ${result.error}`
        }
      } else {
        // 测试所有仓库
        const results = await this.configManager.validateConnection()
        
        let output = '🔍 **GitHub连接测试结果**\n\n'
        
        for (const [repo, result] of Object.entries(results)) {
          output += `📁 **${repo}**: `
          if (result.success) {
            output += '✅ 连接成功\n'
          } else {
            output += `❌ 连接失败 - ${result.error}\n`
          }
        }
        
        return output
      }
    } catch (error) {
      return `❌ 测试失败: ${error.message}`
    }
  }

  /**
   * 处理缓存管理命令
   * @private
   */
  async handleCache(args) {
    const [action, repoKey] = args
    
    try {
      await this.githubProtocol.initialize()
      
      switch (action) {
        case 'stats': {
          const stats = await this.githubProtocol.getStats()
          return this.formatCacheStats(stats)
        }
        case 'clear':
          if (repoKey) {
            await this.githubProtocol.clearRepositoryCache(repoKey)
            return `✅ 仓库 "${repoKey}" 缓存已清空`
          } else {
            await this.githubProtocol.clearCache()
            return '✅ 所有GitHub缓存已清空'
          }
        default:
          return this.getCacheHelp()
      }
    } catch (error) {
      return `❌ 缓存操作失败: ${error.message}`
    }
  }

  /**
   * 处理资源发现命令
   * @private
   */
  async handleDiscover() {
    try {
      await this.githubDiscovery.initialize()
      
      let output = '🔍 **GitHub资源发现**\n\n'
      output += '正在扫描GitHub仓库中的角色资源...\n\n'
      
      const registry = await this.githubDiscovery.discoverRegistry()
      
      if (registry.resources.length === 0) {
        output += '⚠️ 未发现任何GitHub角色资源\n'
        output += '\n💡 **可能的原因**:\n'
        output += '- GitHub功能未启用\n'
        output += '- 没有配置启用的仓库\n'
        output += '- 仓库中没有符合规范的角色文件\n'
        output += '- 网络连接或权限问题\n'
      } else {
        output += `✅ 发现 ${registry.resources.length} 个GitHub资源\n\n`
        
        // 按仓库分组显示
        const repoGroups = new Map()
        for (const resource of registry.resources) {
          const repo = resource.metadata?.repository || 'unknown'
          if (!repoGroups.has(repo)) {
            repoGroups.set(repo, [])
          }
          repoGroups.get(repo).push(resource)
        }
        
        for (const [repo, resources] of repoGroups) {
          const branch = resources[0]?.metadata?.branch || 'main'
          output += `📁 **${repo}@${branch}** (${resources.length}个资源)\n`
          
          const roleResources = resources.filter(r => r.protocol === 'role')
          if (roleResources.length > 0) {
            output += `  📝 角色 (${roleResources.length}个):\n`
            for (const role of roleResources) {
              output += `    - ${role.id}\n`
            }
          }
          
          output += '\n'
        }
      }
      
      return output
    } catch (error) {
      return `❌ 资源发现失败: ${error.message}`
    }
  }

  /**
   * 处理统计信息命令
   * @private
   */
  async handleStats() {
    try {
      await this.githubProtocol.initialize()
      const stats = await this.githubProtocol.getStats()
      
      let output = '📊 **GitHub统计信息**\n\n'
      output += `**协议状态**: ${stats.initialized ? '✅ 已初始化' : '❌ 未初始化'}\n`
      output += `**配置状态**: ${stats.config.enabled ? '✅ 已启用' : '❌ 已禁用'}\n`
      output += `**仓库总数**: ${stats.config.repositoriesCount}\n`
      output += `**启用仓库数**: ${stats.config.enabledRepositoriesCount}\n`
      output += `**全局Token**: ${stats.config.hasGlobalToken ? '✅ 已配置' : '❌ 未配置'}\n\n`
      
      output += '**缓存统计**:\n'
      output += `- 缓存状态: ${stats.cache.enabled ? '✅ 已启用' : '❌ 已禁用'}\n`
      output += `- 内存缓存: ${stats.cache.memoryCache.size} 项\n`
      output += `- 磁盘缓存: ${stats.cache.diskCache.size} 个文件\n`
      output += `- 磁盘使用: ${(stats.cache.diskCache.totalSize / 1024).toFixed(2)} KB\n`
      
      return output
    } catch (error) {
      return `❌ 获取统计信息失败: ${error.message}`
    }
  }

  /**
   * 格式化缓存统计信息
   * @private
   */
  formatCacheStats(stats) {
    let output = '📊 **GitHub缓存统计**\n\n'
    output += `**缓存状态**: ${stats.cache.enabled ? '✅ 已启用' : '❌ 已禁用'}\n\n`
    
    if (stats.cache.enabled) {
      output += `**内存缓存**: ${stats.cache.memoryCache.size} 项\n`
      output += `**磁盘缓存**: ${stats.cache.diskCache.size} 个文件\n`
      output += `**磁盘使用**: ${(stats.cache.diskCache.totalSize / 1024).toFixed(2)} KB\n\n`
      
      if (stats.cache.diskCache.items.length > 0) {
        output += '**最近缓存文件**:\n'
        const recentFiles = stats.cache.diskCache.items
          .sort((a, b) => new Date(b.mtime) - new Date(a.mtime))
          .slice(0, 5)
        
        for (const file of recentFiles) {
          const size = (file.size / 1024).toFixed(2)
          const time = new Date(file.mtime).toLocaleString()
          output += `- ${file.repository}@${file.branch}:${file.path} (${size}KB, ${time})\n`
        }
      }
    }
    
    return output
  }

  /**
   * 获取帮助信息
   * @private
   */
  getHelp() {
    return `🔧 **GitHub管理命令**

**用法**: \`promptx github <子命令> [参数]\`

**子命令**:
- \`config\` - 配置管理
- \`test\` - 连接测试
- \`cache\` - 缓存管理
- \`discover\` - 资源发现
- \`upload\` - 角色上传
- \`stats\` - 统计信息
- \`repo\` - 仓库管理
- \`auth\` - 认证管理

**示例**:
- \`promptx github config show\` - 显示当前配置
- \`promptx github test\` - 测试所有仓库连接
- \`promptx github cache clear\` - 清空缓存
- \`promptx github discover\` - 发现GitHub资源
- \`promptx github upload <角色名> [仓库]\` - 上传角色到GitHub

使用 \`promptx github <子命令>\` 查看具体子命令的帮助信息。`
  }

  /**
   * 获取配置帮助
   * @private
   */
  getConfigHelp() {
    return `🔧 **GitHub配置管理**

**用法**: \`promptx github config <操作>\`

**操作**:
- \`show\` - 显示当前配置
- \`validate\` - 验证配置并测试连接
- \`init\` - 初始化默认配置

**示例**:
- \`promptx github config show\`
- \`promptx github config validate\`
- \`promptx github config init\``
  }

  /**
   * 获取缓存帮助
   * @private
   */
  getCacheHelp() {
    return `🗄️ **GitHub缓存管理**

**用法**: \`promptx github cache <操作> [仓库]\`

**操作**:
- \`stats\` - 显示缓存统计信息
- \`clear [仓库]\` - 清空缓存（可指定仓库）

**示例**:
- \`promptx github cache stats\`
- \`promptx github cache clear\`
- \`promptx github cache clear owner/repo\``
  }

  /**
   * 处理角色上传命令
   * @param {Array} args - 命令参数
   * @private
   */
  async handleUpload(args) {
    const [roleName, repoKey, ...options] = args

    try {
      logger.debug(`[GitHubCommand] 开始处理上传命令: roleName=${roleName}, repoKey=${repoKey}`)

      // 初始化配置管理器
      await this.configManager.initialize()

      if (!this.configManager.initialized) {
        return '❌ GitHub配置未初始化，请先运行 `promptx github config init`'
      }

      const config = this.configManager.getConfig()
      if (!config.enabled) {
        return '❌ GitHub功能已禁用，请在配置中启用'
      }

      // 如果没有指定角色名，显示可用角色列表
      if (!roleName) {
        logger.debug(`[GitHubCommand] 显示可用角色列表`)
        return await this.showAvailableRoles()
      }

      // 如果没有指定仓库，显示可用仓库列表
      if (!repoKey) {
        return await this.showAvailableRepositories(roleName)
      }

      // 验证仓库配置
      const repoConfig = this.configManager.getRepositoryConfig(repoKey)
      if (!repoConfig) {
        return `❌ 仓库 "${repoKey}" 未在配置中找到`
      }

      if (!repoConfig.enabled) {
        return `❌ 仓库 "${repoKey}" 已禁用`
      }

      // 简化权限检查 - 用户已确认有写入权限
      logger.debug(`[GitHubCommand] 跳过权限检查，直接进行上传 (用户已确认有权限)`)

      // 可选：简单验证仓库存在性
      try {
        const repoConfig = this.configManager.getRepositoryConfig(repoKey)
        if (!repoConfig) {
          return `❌ 仓库 "${repoKey}" 未在配置中找到`
        }

        logger.info(`[GitHubCommand] 仓库配置验证成功: ${repoKey}`)

      } catch (error) {
        logger.error(`[GitHubCommand] 仓库配置验证失败: ${error.message}`)
        return `❌ 仓库配置验证失败: ${error.message}`
      }

      // 执行简化的上传流程
      return await this.performSimpleUpload(roleName, repoConfig)

    } catch (error) {
      logger.error(`[GitHubCommand] 上传失败: ${error.message}`)
      return `❌ 上传失败: ${error.message}`
    }
  }

  /**
   * 显示可用角色列表
   * @private
   */
  async showAvailableRoles() {
    try {
      logger.debug('[GitHubCommand] 显示可用角色列表')

      // 超级简化实现
      const resourcesDir = path.join(process.cwd(), '.promptx', 'resource', 'domain')

      if (!await fs.pathExists(resourcesDir)) {
        return `❌ 角色目录不存在: .promptx/resource/domain/`
      }

      const items = await fs.readdir(resourcesDir)
      const roles = []

      for (const item of items) {
        const itemPath = path.join(resourcesDir, item)
        try {
          const stat = await fs.stat(itemPath)
          if (stat.isDirectory()) {
            roles.push(item)
          }
        } catch (error) {
          // 忽略错误，继续处理下一个
        }
      }

      if (roles.length === 0) {
        return `⚠️ 没有找到任何角色`
      }

      let output = `📋 **可上传的角色** (${roles.length}个):\n\n`

      for (const role of roles) {
        output += `📝 ${role}\n`
      }

      output += `\n💡 **使用**: \`promptx github upload <角色名> MuziGeeK/promptX_Role\``

      return output

    } catch (error) {
      logger.error(`[GitHubCommand] 角色列表失败: ${error.message}`)
      return `❌ 获取角色列表失败: ${error.message}`
    }
  }

  /**
   * 执行简化的上传流程
   * @param {string} roleName - 角色名
   * @param {Object} repoConfig - 仓库配置
   * @private
   */
  async performSimpleUpload(roleName, repoConfig) {
    try {
      logger.debug(`[GitHubCommand] 执行简化上传: ${roleName}`)

      // 检查角色文件是否存在
      const roleDir = path.join(process.cwd(), '.promptx', 'resource', 'domain', roleName)
      const roleFile = path.join(roleDir, `${roleName}.role.md`)

      if (!await fs.pathExists(roleFile)) {
        return `❌ 角色文件不存在: ${roleFile}`
      }

      // 读取角色文件内容
      const content = await fs.readFile(roleFile, 'utf-8')

      // 使用GitHubAdapter上传文件（它会自动处理SHA值）
      const targetPath = `roles/${roleName}/${roleName}.role.md`
      const message = `Upload ${roleName} role via PromptX`

      logger.info(`[GitHubCommand] 上传文件: ${targetPath}`)

      const result = await this.githubAdapter.createOrUpdateFile(
        repoConfig,
        targetPath,
        content,
        message,
        { branch: repoConfig.branch || 'main' }
      )

      return `✅ **上传成功!**

📄 **文件**: ${targetPath}
🔗 **查看**: https://github.com/${repoConfig.owner}/${repoConfig.name}/blob/${repoConfig.branch || 'main'}/${targetPath}
🔗 **提交**: ${result.commit.url}

🎉 角色 "${roleName}" 已成功上传到 ${repoConfig.owner}/${repoConfig.name}!
📝 **操作**: ${result.action === 'created' ? '新建文件' : '更新文件'}`

    } catch (error) {
      logger.error(`[GitHubCommand] 简化上传失败: ${error.message}`)
      return `❌ 上传失败: ${error.message}`
    }
  }

  /**
   * 显示可用仓库列表
   * @param {string} roleName - 角色名
   * @private
   */
  async showAvailableRepositories(roleName) {
    try {
      const enabledRepos = this.configManager.getEnabledRepositories()

      if (enabledRepos.length === 0) {
        return `❌ 没有启用的仓库配置

💡 **配置仓库的方法**:
1. 编辑配置文件: .promptx/github.config.json
2. 添加仓库配置并设置 enabled: true
3. 运行 \`promptx github test\` 验证连接

📖 详细说明请参考: docs/github-integration-guide.md`
      }

      let output = `📋 **可用的目标仓库** (角色: ${roleName})\n\n`

      for (const repo of enabledRepos) {
        const repoKey = `${repo.owner}/${repo.name}`
        output += `📁 **${repoKey}**\n`
        output += `  - 分支: ${repo.branch || 'main'}\n`
        output += `  - 类型: ${repo.private ? '🔒 私有' : '🌐 公开'}\n`
        output += `  - 角色前缀: ${repo.rolePrefix || '无'}\n`
        output += `  - 优先级: ${repo.priority}\n\n`
      }

      output += `💡 **使用方法**: \`promptx github upload ${roleName} <仓库>\`\n`
      output += `📖 **示例**: \`promptx github upload ${roleName} ${enabledRepos[0].owner}/${enabledRepos[0].name}\``

      return output

    } catch (error) {
      return `❌ 获取仓库列表失败: ${error.message}`
    }
  }

  /**
   * 上传角色文件
   * @param {string} roleName - 角色名
   * @param {Object} repoConfig - 仓库配置
   * @param {Array} options - 选项
   * @private
   */
  async uploadRoleFiles(roleName, repoConfig, options = []) {
    try {
      logger.debug(`[GitHubCommand] 开始上传角色文件: ${roleName}`)

      // 简化路径获取
      const roleDir = path.join(process.cwd(), '.promptx', 'resource', 'domain', roleName)

      if (!await fs.pathExists(roleDir)) {
        return `❌ 角色 "${roleName}" 不存在于项目中`
      }

      // 扫描角色文件
      const files = await this.scanRoleFiles(roleDir, roleName)

      if (files.totalFiles === 0) {
        return `❌ 角色 "${roleName}" 没有找到任何文件`
      }

      // 准备上传文件列表
      const uploadFiles = []
      // 清理路径前缀，确保没有双斜杠
      const rolePrefix = repoConfig.rolePrefix ? repoConfig.rolePrefix.replace(/\/$/, '') : 'roles'
      const baseTargetPath = `${rolePrefix}/${roleName}`

      // 添加角色文件
      if (files.role) {
        uploadFiles.push({
          path: `${baseTargetPath}/${roleName}.role.md`,
          content: files.role.content,
          message: `Add/Update role: ${roleName}`
        })
      }

      // 添加思维文件
      for (const thought of files.thoughts) {
        uploadFiles.push({
          path: `${baseTargetPath}/${thought.name}`,
          content: thought.content,
          message: `Add/Update thought for ${roleName}: ${thought.name}`
        })
      }

      // 添加执行文件
      for (const execution of files.executions) {
        uploadFiles.push({
          path: `${baseTargetPath}/${execution.name}`,
          content: execution.content,
          message: `Add/Update execution for ${roleName}: ${execution.name}`
        })
      }

      // 添加知识文件
      for (const knowledge of files.knowledge) {
        uploadFiles.push({
          path: `${baseTargetPath}/${knowledge.name}`,
          content: knowledge.content,
          message: `Add/Update knowledge for ${roleName}: ${knowledge.name}`
        })
      }

      // 解析选项
      const uploadOptions = this.parseUploadOptions(options)

      // 显示上传预览
      let output = `🚀 **准备上传角色: ${roleName}**\n\n`
      output += `📁 **目标仓库**: ${repoConfig.owner}/${repoConfig.name}\n`
      output += `🌿 **目标分支**: ${uploadOptions.branch || repoConfig.branch || 'main'}\n`
      output += `📂 **目标路径**: ${baseTargetPath}/\n`
      output += `📄 **文件数量**: ${uploadFiles.length} 个\n\n`

      output += `📋 **文件列表**:\n`
      for (const file of uploadFiles) {
        output += `  - ${file.path}\n`
      }
      output += '\n'

      // 执行上传
      output += `⏳ **开始上传...**\n\n`

      let uploadResult
      try {
        uploadResult = await this.githubAdapter.uploadFiles(
          repoConfig,
          uploadFiles,
          {
            branch: uploadOptions.branch || repoConfig.branch || 'main',
            baseMessage: `Upload role "${roleName}" via PromptX`
          }
        )
      } catch (error) {
        logger.error(`[GitHubCommand] 批量上传失败: ${error.message}`)
        return `❌ 上传过程中发生错误: ${error.message}

💡 **可能的解决方案**:
1. 检查网络连接是否稳定
2. 确认GitHub服务是否正常
3. 验证token权限是否足够
4. 检查仓库是否存在且可访问`
      }

      // 显示上传结果
      output += `✅ **上传完成!**\n\n`
      output += `📊 **结果统计**:\n`
      output += `  - 成功: ${uploadResult.success.length} 个文件\n`
      output += `  - 失败: ${uploadResult.failed.length} 个文件\n`
      output += `  - 总计: ${uploadResult.total} 个文件\n\n`

      if (uploadResult.success.length > 0) {
        output += `✅ **成功上传的文件**:\n`
        for (const file of uploadResult.success) {
          output += `  - ${file.path} (${file.action})\n`
        }
        output += '\n'
      }

      if (uploadResult.failed.length > 0) {
        output += `❌ **上传失败的文件**:\n`
        for (const file of uploadResult.failed) {
          output += `  - ${file.path}: ${file.error}\n`
        }
        output += '\n'
      }

      // 添加查看链接
      if (uploadResult.success.length > 0) {
        const firstCommit = uploadResult.success[0].commit
        if (firstCommit && firstCommit.url) {
          output += `🔗 **查看提交**: ${firstCommit.url}\n`
        }

        const repoUrl = `https://github.com/${repoConfig.owner}/${repoConfig.name}/tree/${uploadOptions.branch || repoConfig.branch || 'main'}/${baseTargetPath}`
        output += `🔗 **查看角色**: ${repoUrl}\n`
      }

      return output

    } catch (error) {
      logger.error(`[GitHubCommand] 上传角色文件失败: ${error.message}`)
      return `❌ 上传失败: ${error.message}`
    }
  }

  /**
   * 扫描角色文件
   * @param {string} roleDir - 角色目录
   * @param {string} roleName - 角色名
   * @private
   */
  async scanRoleFiles(roleDir, roleName) {
    const files = {
      role: null,
      thoughts: [],
      executions: [],
      knowledge: [],
      totalFiles: 0
    }

    try {
      const items = await fs.readdir(roleDir)

      for (const item of items) {
        const itemPath = path.join(roleDir, item)
        const stat = await fs.stat(itemPath)

        if (stat.isFile()) {
          const content = await fs.readFile(itemPath, 'utf-8')

          if (item === `${roleName}.role.md`) {
            files.role = { name: item, content }
            files.totalFiles++
          } else if (item.endsWith('.thought.md')) {
            files.thoughts.push({ name: item, content })
            files.totalFiles++
          } else if (item.endsWith('.execution.md')) {
            files.executions.push({ name: item, content })
            files.totalFiles++
          } else if (item.endsWith('.knowledge.md')) {
            files.knowledge.push({ name: item, content })
            files.totalFiles++
          } else if (item.endsWith('.md')) {
            // 其他markdown文件也作为知识文件处理
            files.knowledge.push({ name: item, content })
            files.totalFiles++
          }
        }
      }

    } catch (error) {
      logger.error(`[GitHubCommand] 扫描角色文件失败: ${error.message}`)
    }

    return files
  }

  /**
   * 解析上传选项
   * @param {Array} options - 选项数组
   * @private
   */
  parseUploadOptions(options) {
    const parsed = {}

    for (let i = 0; i < options.length; i++) {
      const option = options[i]

      if (option === '--branch' || option === '-b') {
        parsed.branch = options[i + 1]
        i++ // 跳过下一个参数
      } else if (option === '--force' || option === '-f') {
        parsed.force = true
      } else if (option === '--dry-run') {
        parsed.dryRun = true
      }
    }

    return parsed
  }
}

module.exports = GitHubCommand
