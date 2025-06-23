const BasePouchCommand = require('../BasePouchCommand')
const GitHubConfigManager = require('../../../utils/GitHubConfigManager')
const GitHubProtocol = require('../../resource/protocols/GitHubProtocol')
const GitHubDiscovery = require('../../resource/discovery/GitHubDiscovery')
const GitHubAdapter = require('../../../adapters/GitHubAdapter')
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
      availableTransitions: ['config', 'test', 'discover', 'cache', 'stats'],
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
        }
      ],
      metadata: {
        systemVersion: 'GitHub集成 v1.0',
        supportedOperations: ['config', 'test', 'discover', 'cache', 'stats']
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
- \`stats\` - 统计信息
- \`repo\` - 仓库管理
- \`auth\` - 认证管理

**示例**:
- \`promptx github config show\` - 显示当前配置
- \`promptx github test\` - 测试所有仓库连接
- \`promptx github cache clear\` - 清空缓存
- \`promptx github discover\` - 发现GitHub资源

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
}

module.exports = GitHubCommand
