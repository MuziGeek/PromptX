# PromptX GitHub集成指南

## 📋 概述

PromptX现在支持GitHub作为角色资源来源，允许您将角色文件存储在GitHub仓库中，实现角色的版本控制、团队协作和开源分享。

## 🚀 快速开始

### 1. 安装GitHub SDK依赖

```bash
npm install @octokit/rest
```

### 2. 创建GitHub Personal Access Token

1. 访问 [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)
2. 点击 "Generate new token (classic)"
3. 设置token名称，如 "PromptX Integration"
4. 选择适当的权限：
   - 对于公开仓库：无需特殊权限
   - 对于私有仓库：选择 `repo` 权限
5. 点击 "Generate token" 并保存生成的token

### 3. 配置GitHub访问

创建配置文件 `.promptx/github.config.json`：

```json
{
  "version": "1.0.0",
  "enabled": true,
  "cache": {
    "enabled": true,
    "ttl": 3600,
    "maxSize": 100
  },
  "auth": {
    "token": "your-github-token-here",
    "type": "token"
  },
  "repositories": [
    {
      "owner": "your-username",
      "name": "promptx-roles",
      "branch": "main",
      "enabled": true,
      "rolePrefix": "roles/",
      "priority": 100,
      "private": false,
      "token": "",
      "metadata": {
        "description": "我的PromptX角色库",
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    }
  ]
}
```

### 4. 在GitHub仓库中组织角色文件

按照以下目录结构组织角色文件：

```
your-repo/
└── roles/
    ├── java-developer/
    │   ├── java-developer.role.md
    │   ├── thought/
    │   │   └── java-developer.thought.md
    │   └── execution/
    │       ├── java-developer.execution.md
    │       ├── spring-framework.execution.md
    │       └── database-design.execution.md
    └── product-manager/
        ├── product-manager.role.md
        ├── thought/
        │   └── product-manager.thought.md
        └── execution/
            ├── product-manager.execution.md
            └── market-analysis.execution.md
```

### 5. 验证配置

使用以下命令验证GitHub配置：

```bash
npx promptx github config init
npx promptx github test
npx promptx github discover
npx promptx welcome
```

## 🔧 配置详解

### 配置文件结构

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `version` | string | 是 | 配置文件版本 |
| `enabled` | boolean | 否 | 是否启用GitHub功能，默认true |
| `cache` | object | 否 | 缓存配置 |
| `auth` | object | 否 | 全局认证配置 |
| `repositories` | array | 是 | GitHub仓库配置列表 |

### 认证配置

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `token` | string | 否 | GitHub Personal Access Token |
| `type` | string | 否 | 认证类型，目前支持"token" |

### 仓库配置

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `owner` | string | 是 | 仓库所有者（用户名或组织名） |
| `name` | string | 是 | 仓库名称 |
| `branch` | string | 否 | 分支名称，默认"main" |
| `enabled` | boolean | 否 | 是否启用此仓库，默认true |
| `rolePrefix` | string | 否 | 角色文件前缀，默认"roles/" |
| `priority` | number | 否 | 优先级，数字越大优先级越高，默认100 |
| `private` | boolean | 否 | 是否为私有仓库，默认false |
| `token` | string | 否 | 仓库特定token（覆盖全局token） |

### 缓存配置

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `enabled` | boolean | 否 | 是否启用缓存，默认true |
| `ttl` | number | 否 | 缓存TTL（秒），默认3600 |
| `maxSize` | number | 否 | 最大缓存文件数，默认100 |

## 📁 角色文件组织

### 目录结构规范

```
{rolePrefix}/
└── {roleId}/
    ├── {roleId}.role.md          # 主角色文件（必需）
    ├── thought/                  # 思维模式目录
    │   ├── {roleId}.thought.md   # 主思维文件
    │   └── *.thought.md          # 其他思维文件
    ├── execution/                # 执行模式目录
    │   ├── {roleId}.execution.md # 主执行文件
    │   └── *.execution.md        # 其他执行文件
    └── knowledge/                # 知识体系目录
        └── *.knowledge.md        # 知识文件
```

### 角色文件格式

角色文件使用标准的DPML格式，支持GitHub协议引用：

```xml
<role>
  <personality>
    @!thought://remember
    @!thought://recall
    
    # 角色核心身份
    我是专业的Java后端开发专家...
    
    @!thought://java-developer
  </personality>
  
  <principle>
    # 开发原则
    @!execution://java-developer
    @!execution://spring-framework
  </principle>
  
  <knowledge>
    # 专业知识
    @!execution://database-design
  </knowledge>
</role>
```

## 🔗 协议引用

### GitHub协议格式

```
@github://owner/repo/path/to/file.md
@github://owner/repo@branch/path/to/file.md
```

示例：
```
@github://myorg/promptx-roles/roles/java-developer/java-developer.role.md
@github://myorg/promptx-roles@develop/roles/java-developer/java-developer.role.md
```

### 引用类型

- `@!github://` - 强制引用，解析失败时报错
- `@?github://` - 可选引用，解析失败时优雅降级
- `@github://` - 标准引用，默认行为

## 🚀 高级功能

### 多仓库配置

支持配置多个GitHub仓库，实现角色的分层管理：

```json
{
  "repositories": [
    {
      "owner": "myorg",
      "name": "prod-roles",
      "branch": "main",
      "priority": 200,
      "private": true,
      "metadata": {
        "description": "生产环境角色库"
      }
    },
    {
      "owner": "myorg", 
      "name": "dev-roles",
      "branch": "develop",
      "priority": 100,
      "private": false,
      "metadata": {
        "description": "开发环境角色库"
      }
    }
  ]
}
```

### 分支和版本管理

支持指定不同分支和使用Git标签：

```json
{
  "owner": "myorg",
  "name": "promptx-roles",
  "branch": "v1.0.0",  // 可以是分支名或标签名
  "enabled": true
}
```

### 缓存管理

GitHub角色支持智能缓存机制：

- **SHA验证**：基于Git commit SHA检查文件是否更新
- **TTL控制**：配置缓存过期时间
- **容量限制**：自动清理最旧的缓存文件
- **网络容错**：网络异常时使用过期缓存

### 权限管理

支持不同级别的访问权限：

- **公开仓库**：无需token即可访问
- **私有仓库**：需要配置有效的Personal Access Token
- **组织仓库**：支持组织级别的权限管理
- **仓库特定token**：为不同仓库配置不同的访问token

## 🛠️ 管理命令

### 配置管理

```bash
# 初始化配置
npx promptx github config init

# 显示当前配置
npx promptx github config show

# 验证配置和连接
npx promptx github config validate
```

### 连接测试

```bash
# 测试所有仓库连接
npx promptx github test

# 测试指定仓库连接
npx promptx github test owner/repo
```

### 缓存管理

```bash
# 显示缓存统计
npx promptx github cache stats

# 清空所有缓存
npx promptx github cache clear

# 清空指定仓库缓存
npx promptx github cache clear owner/repo
```

### 资源发现

```bash
# 发现GitHub角色资源
npx promptx github discover

# 显示系统统计信息
npx promptx github stats
```

## 🔒 安全最佳实践

### Token安全

- 使用最小权限原则配置token权限
- 定期轮换Personal Access Token
- 不要将token提交到版本控制系统
- 使用环境变量存储敏感token

### 仓库安全

- 对私有仓库启用分支保护
- 使用代码审查流程
- 定期审计仓库访问权限
- 启用GitHub安全警报

### 配置安全

- 限制配置文件访问权限
- 使用不同的token访问不同仓库
- 定期检查token使用情况
- 监控异常访问行为

## 📊 性能优化

### 缓存策略

- 启用本地缓存减少API请求
- 合理设置TTL平衡性能和实时性
- 使用SHA验证避免不必要的下载

### API优化

- 使用递归获取减少API调用次数
- 配置合理的请求超时和重试
- 监控API使用限制

### 网络优化

- 选择就近的GitHub服务器
- 使用CDN加速（如GitHub Pages）
- 配置合理的并发限制

## 🤝 团队协作

### 角色共享

1. **创建组织仓库**：在GitHub组织下创建角色仓库
2. **设置权限**：为团队成员分配适当的仓库权限
3. **分支策略**：使用Git Flow或GitHub Flow管理角色版本
4. **代码审查**：对角色变更进行代码审查

### 版本管理

1. **语义化版本**：使用语义化版本标记角色版本
2. **变更日志**：维护详细的变更日志
3. **发布管理**：使用GitHub Releases管理角色发布
4. **回滚策略**：制定角色回滚策略

## 🛠️ 故障排除

### 常见问题

1. **配置文件不存在**
   - 运行 `npx promptx github config init` 自动创建
   - 手动创建 `.promptx/github.config.json` 文件

2. **GitHub连接失败**
   - 检查Personal Access Token是否有效
   - 确认仓库名称和所有者正确
   - 验证网络连接和防火墙设置

3. **权限不足**
   - 检查token权限范围
   - 确认对仓库有读取权限
   - 验证私有仓库的访问权限

4. **角色发现失败**
   - 确认角色文件按规范组织
   - 检查rolePrefix配置是否正确
   - 验证分支名称是否存在

### 调试模式

启用调试日志：

```bash
DEBUG=promptx:github npx promptx github discover
```

### API限制

GitHub API有使用限制：
- 未认证请求：60次/小时
- 认证请求：5000次/小时
- 建议启用缓存减少API调用

## 📚 API参考

### GitHubConfigManager

```javascript
const configManager = new GitHubConfigManager()
await configManager.initialize()
const config = configManager.getConfig()
const repoConfig = configManager.getRepositoryConfig('owner/repo')
const result = await configManager.validateConnection()
```

### GitHubProtocol

```javascript
const protocol = new GitHubProtocol()
await protocol.initialize()
const content = await protocol.loadContent('@github://owner/repo/path/file.md')
const exists = await protocol.exists('@github://owner/repo/path/file.md')
await protocol.refreshCache('@github://owner/repo/path/file.md')
```

### GitHubDiscovery

```javascript
const discovery = new GitHubDiscovery()
await discovery.initialize()
const registry = await discovery.discoverRegistry()
await discovery.refresh()
```

## 🤝 贡献指南

欢迎为GitHub集成功能贡献代码：

1. Fork项目仓库
2. 创建功能分支
3. 提交代码变更
4. 创建Pull Request

## 📄 许可证

MIT License - 详见 [LICENSE](../LICENSE) 文件
