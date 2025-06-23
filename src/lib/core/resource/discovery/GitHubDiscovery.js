const logger = require('../../../utils/logger')
const RegistryData = require('../RegistryData')
const ResourceData = require('../ResourceData')
const GitHubAdapter = require('../../../adapters/GitHubAdapter')
const GitHubConfigManager = require('../../../utils/GitHubConfigManager')

/**
 * GitHub资源发现器
 * 扫描GitHub仓库中的角色资源并生成注册表
 */
class GitHubDiscovery {
  constructor() {
    this.source = 'github'
    this.priority = 3 // 优先级：package(1) < project(2) < github(3)
    this.configManager = new GitHubConfigManager()
    this.githubAdapter = null // 延迟初始化，需要配置信息
    this.registryData = null
    this.initialized = false
  }

  /**
   * 初始化发现器
   */
  async initialize() {
    if (this.initialized) {
      return
    }

    try {
      await this.configManager.initialize()

      // 使用全局配置初始化GitHubAdapter
      const globalConfig = this.configManager.getConfig()
      this.githubAdapter = new GitHubAdapter(globalConfig)

      this.initialized = true
      logger.debug('[GitHubDiscovery] 发现器初始化完成')
    } catch (error) {
      logger.error(`[GitHubDiscovery] 初始化失败: ${error.message}`)
      this.initialized = false
    }
  }

  /**
   * 发现GitHub资源并生成注册表
   * @returns {Promise<RegistryData>} 注册表数据
   */
  async discoverRegistry() {
    await this.initialize()

    const config = this.configManager.getConfig()
    if (!config.enabled) {
      logger.debug('[GitHubDiscovery] GitHub发现器已禁用')
      return RegistryData.createEmpty(this.source, 'memory://github-registry')
    }

    const enabledRepos = this.configManager.getEnabledRepositories()
    if (enabledRepos.length === 0) {
      logger.debug('[GitHubDiscovery] 没有启用的GitHub仓库')
      return RegistryData.createEmpty(this.source, 'memory://github-registry')
    }

    this.registryData = RegistryData.createEmpty(this.source, 'memory://github-registry')

    // 并发扫描所有启用的仓库
    const scanPromises = enabledRepos.map(repo => this._scanRepository(repo))
    const results = await Promise.allSettled(scanPromises)

    // 处理扫描结果
    let totalResources = 0
    results.forEach((result, index) => {
      const repo = enabledRepos[index]
      const repoKey = `${repo.owner}/${repo.name}`
      if (result.status === 'fulfilled') {
        totalResources += result.value
        logger.debug(`[GitHubDiscovery] 仓库 ${repoKey} 扫描完成: ${result.value} 个资源`)
      } else {
        logger.error(`[GitHubDiscovery] 仓库 ${repoKey} 扫描失败: ${result.reason.message}`)
      }
    })

    logger.info(`[GitHubDiscovery] GitHub资源发现完成: ${totalResources} 个资源`)
    return this.registryData
  }

  /**
   * 获取注册表数据
   * @returns {Promise<RegistryData>} 注册表数据
   */
  async getRegistryData() {
    try {
      logger.debug('[GitHubDiscovery] getRegistryData called')
      if (!this.registryData) {
        logger.debug('[GitHubDiscovery] No cached registry data, discovering...')
        this.registryData = await this.discoverRegistry()
      }
      logger.debug(`[GitHubDiscovery] Returning registry data with ${this.registryData.resources.length} resources`)
      return this.registryData
    } catch (error) {
      logger.error(`[GitHubDiscovery] getRegistryData failed: ${error.message}`)
      logger.error(`[GitHubDiscovery] Stack: ${error.stack}`)
      // Return empty registry on error to prevent breaking the system
      return RegistryData.createEmpty(this.source, 'memory://github-registry-error')
    }
  }

  /**
   * 刷新注册表
   */
  async refresh() {
    this.registryData = null
    await this.discoverRegistry()
    logger.info('[GitHubDiscovery] 注册表已刷新')
  }

  /**
   * 扫描单个仓库
   * @private
   */
  async _scanRepository(repoConfig) {
    try {
      const repoKey = `${repoConfig.owner}/${repoConfig.name}`
      logger.debug(`[GitHubDiscovery] 开始扫描仓库: ${repoKey}`)
      
      // 获取角色前缀下的所有文件
      const files = await this.githubAdapter.getFilesRecursively(repoConfig, repoConfig.rolePrefix, {
        branch: repoConfig.branch,
        fileExtensions: ['.md'],
        maxDepth: 5
      })
      
      let resourceCount = 0
      
      // 按目录分组文件
      const roleGroups = this._groupFilesByRole(files, repoConfig.rolePrefix)
      
      // 处理每个角色组
      for (const [roleId, roleFiles] of roleGroups) {
        try {
          await this._processRoleGroup(repoConfig, roleId, roleFiles)
          resourceCount += roleFiles.length
        } catch (error) {
          logger.warn(`[GitHubDiscovery] 处理角色组失败 ${roleId}: ${error.message}`)
        }
      }
      
      return resourceCount
    } catch (error) {
      logger.error(`[GitHubDiscovery] 扫描仓库失败 ${repoConfig.owner}/${repoConfig.name}: ${error.message}`)
      throw error
    }
  }

  /**
   * 按角色分组文件 (改进版 - 支持多种文件结构)
   * @private
   */
  _groupFilesByRole(files, rolePrefix) {
    const roleGroups = new Map()

    for (const file of files) {
      // 移除前缀，获取相对路径
      const relativePath = file.path.startsWith(rolePrefix)
        ? file.path.substring(rolePrefix.length)
        : file.path

      // 跳过非角色文件
      if (!this._isRoleRelatedFile(relativePath)) {
        continue
      }

      // 提取角色ID (支持多种结构)
      const roleId = this._extractRoleIdFlexible(relativePath)
      if (!roleId) {
        continue
      }

      if (!roleGroups.has(roleId)) {
        roleGroups.set(roleId, [])
      }

      roleGroups.get(roleId).push({
        ...file,
        relativePath,
        fullPath: file.path, // 保留完整路径用于生成引用
        resourceType: this._getResourceType(relativePath)
      })
    }

    return roleGroups
  }

  /**
   * 处理角色组 (改进版 - 支持多种文件结构)
   * @private
   */
  async _processRoleGroup(repoConfig, roleId, roleFiles) {
    // 查找主角色文件 (支持多种命名模式)
    const mainRoleFile = this._findMainRoleFile(roleFiles, roleId)

    if (!mainRoleFile) {
      logger.debug(`[GitHubDiscovery] 跳过角色组 ${roleId}: 未找到主角色文件`)
      logger.debug(`[GitHubDiscovery] 可用文件: ${roleFiles.map(f => f.relativePath).join(', ')}`)
      return
    }

    const repoKey = `${repoConfig.owner}/${repoConfig.name}`
    const branch = repoConfig.branch || 'main'

    logger.debug(`[GitHubDiscovery] 处理角色 ${roleId}, 主文件: ${mainRoleFile.relativePath}`)

    // 创建主角色资源
    const roleResource = new ResourceData({
      id: roleId,
      source: this.source,
      protocol: 'role',
      name: this._generateRoleName(roleId),
      description: this._generateRoleDescription(roleId),
      reference: `@github://${repoKey}@${branch}/${mainRoleFile.fullPath}`,
      metadata: {
        repository: repoKey,
        branch: branch,
        repositoryPriority: repoConfig.priority,
        sha: mainRoleFile.sha,
        size: mainRoleFile.size,
        htmlUrl: mainRoleFile.html_url,
        downloadUrl: mainRoleFile.download_url,
        scannedAt: new Date().toISOString()
      }
    })

    this.registryData.addResource(roleResource)
    
    // 处理相关资源文件
    for (const file of roleFiles) {
      if (file === mainRoleFile) {
        continue // 跳过主角色文件
      }
      
      const resourceType = file.resourceType
      if (!resourceType) {
        continue
      }
      
      const resourceId = this._extractResourceId(file.relativePath, resourceType)
      if (!resourceId) {
        continue
      }
      
      const resource = new ResourceData({
        id: resourceId,
        source: this.source,
        protocol: resourceType,
        name: this._generateResourceName(resourceId, resourceType),
        description: this._generateResourceDescription(resourceId, resourceType),
        reference: `@github://${repoKey}@${branch}/${file.fullPath}`,
        metadata: {
          repository: repoKey,
          branch: branch,
          repositoryPriority: repoConfig.priority,
          roleId: roleId,
          sha: file.sha,
          size: file.size,
          htmlUrl: file.html_url,
          downloadUrl: file.download_url,
          scannedAt: new Date().toISOString()
        }
      })
      
      this.registryData.addResource(resource)
    }
  }

  /**
   * 判断是否为角色相关文件 (改进版 - 支持更多文件类型)
   * @private
   */
  _isRoleRelatedFile(relativePath) {
    const supportedExtensions = ['.role.md', '.thought.md', '.execution.md', '.knowledge.md', '.md']
    return supportedExtensions.some(ext => relativePath.toLowerCase().endsWith(ext.toLowerCase()))
  }

  /**
   * 提取角色ID (原版 - 保持向后兼容)
   * @private
   */
  _extractRoleId(relativePath) {
    const parts = relativePath.split('/')
    if (parts.length < 2) {
      return null
    }
    return parts[0]
  }

  /**
   * 灵活提取角色ID (新版 - 支持多种文件结构)
   * @private
   */
  _extractRoleIdFlexible(relativePath) {
    const parts = relativePath.split('/')

    // 情况1: 标准结构 roleId/roleId.role.md
    if (parts.length >= 2) {
      return parts[0]
    }

    // 情况2: 直接在roles目录下的文件 roleId.role.md
    if (parts.length === 1) {
      const fileName = parts[0]
      if (fileName.endsWith('.role.md')) {
        return fileName.replace('.role.md', '')
      }
      if (fileName.endsWith('.md')) {
        return fileName.replace('.md', '')
      }
    }

    return null
  }

  /**
   * 查找主角色文件 (支持多种命名模式)
   * @private
   */
  _findMainRoleFile(roleFiles, roleId) {
    // 优先级1: 标准命名 roleId/roleId.role.md
    let mainFile = roleFiles.find(file =>
      file.relativePath === `${roleId}/${roleId}.role.md`
    )
    if (mainFile) return mainFile

    // 优先级2: 直接命名 roleId.role.md
    mainFile = roleFiles.find(file =>
      file.relativePath === `${roleId}.role.md`
    )
    if (mainFile) return mainFile

    // 优先级3: 任何包含roleId的.role.md文件
    mainFile = roleFiles.find(file =>
      file.relativePath.includes(roleId) && file.relativePath.endsWith('.role.md')
    )
    if (mainFile) return mainFile

    // 优先级4: 目录下的任何.role.md文件
    mainFile = roleFiles.find(file =>
      file.relativePath.endsWith('.role.md')
    )
    if (mainFile) return mainFile

    // 优先级5: 任何.md文件 (作为fallback)
    mainFile = roleFiles.find(file =>
      file.relativePath.endsWith('.md')
    )

    return mainFile
  }

  /**
   * 获取资源类型
   * @private
   */
  _getResourceType(relativePath) {
    if (relativePath.endsWith('.role.md')) return 'role'
    if (relativePath.endsWith('.thought.md')) return 'thought'
    if (relativePath.endsWith('.execution.md')) return 'execution'
    if (relativePath.endsWith('.knowledge.md')) return 'knowledge'
    return null
  }

  /**
   * 提取资源ID
   * @private
   */
  _extractResourceId(relativePath, resourceType) {
    const fileName = relativePath.split('/').pop()
    const suffix = `.${resourceType}.md`
    
    if (fileName.endsWith(suffix)) {
      return fileName.substring(0, fileName.length - suffix.length)
    }
    
    return null
  }

  /**
   * 生成角色名称
   * @private
   */
  _generateRoleName(roleId) {
    return `${roleId.charAt(0).toUpperCase() + roleId.slice(1)} 角色 (GitHub)`
  }

  /**
   * 生成角色描述
   * @private
   */
  _generateRoleDescription(roleId) {
    return `来自GitHub的专业角色，提供 ${roleId} 领域的专业能力`
  }

  /**
   * 生成资源名称
   * @private
   */
  _generateResourceName(resourceId, resourceType) {
    const typeLabels = {
      thought: '思维模式',
      execution: '执行模式',
      knowledge: '知识体系'
    }
    
    const label = typeLabels[resourceType] || resourceType
    return `${resourceId.charAt(0).toUpperCase() + resourceId.slice(1)} ${label} (GitHub)`
  }

  /**
   * 生成资源描述
   * @private
   */
  _generateResourceDescription(resourceId, resourceType) {
    const typeDescriptions = {
      thought: '来自GitHub的思维模式，指导AI的思考方式',
      execution: '来自GitHub的执行模式，定义具体的行为模式',
      knowledge: '来自GitHub的知识体系，提供专业领域知识'
    }
    
    return typeDescriptions[resourceType] || `来自GitHub的${resourceType}资源`
  }

  /**
   * 获取发现器信息
   * @returns {Object} 发现器元数据
   */
  getDiscoveryInfo() {
    return {
      source: this.source,
      priority: this.priority,
      description: 'GitHub repository resource discovery'
    }
  }

  /**
   * 清理资源
   */
  cleanup() {
    if (this.githubAdapter) {
      this.githubAdapter.cleanup()
    }
    logger.debug('[GitHubDiscovery] 发现器资源已清理')
  }
}

module.exports = GitHubDiscovery
