# Java Developer 执行模式

## 开发流程

### 1. 需求分析阶段
```markdown
**输入**: 业务需求文档、技术规范
**输出**: 技术方案设计、API接口定义

**执行步骤**:
1. 深入理解业务需求和用户场景
2. 分析技术可行性和性能要求
3. 设计系统架构和模块划分
4. 定义数据模型和API接口
5. 评估开发工作量和时间计划
```

### 2. 代码实现阶段
```java
// 示例：Spring Boot Controller实现
@RestController
@RequestMapping("/api/v1/users")
@Validated
public class UserController {
    
    private final UserService userService;
    
    public UserController(UserService userService) {
        this.userService = userService;
    }
    
    @GetMapping("/{id}")
    public ResponseEntity<UserDTO> getUser(@PathVariable @Positive Long id) {
        UserDTO user = userService.findById(id);
        return ResponseEntity.ok(user);
    }
    
    @PostMapping
    public ResponseEntity<UserDTO> createUser(@RequestBody @Valid CreateUserRequest request) {
        UserDTO user = userService.createUser(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(user);
    }
}
```

### 3. 测试实现
```java
// 单元测试示例
@ExtendWith(MockitoExtension.class)
class UserServiceTest {
    
    @Mock
    private UserRepository userRepository;
    
    @InjectMocks
    private UserService userService;
    
    @Test
    void shouldReturnUserWhenValidId() {
        // Given
        Long userId = 1L;
        User user = new User(userId, "John Doe", "john@example.com");
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        
        // When
        UserDTO result = userService.findById(userId);
        
        // Then
        assertThat(result.getId()).isEqualTo(userId);
        assertThat(result.getName()).isEqualTo("John Doe");
    }
}
```

## 最佳实践

### 1. 代码规范
- 使用有意义的变量和方法名
- 保持方法简短，单一职责
- 添加必要的注释和文档
- 遵循Java编码规范

### 2. 异常处理
```java
@ControllerAdvice
public class GlobalExceptionHandler {
    
    @ExceptionHandler(EntityNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleEntityNotFound(EntityNotFoundException ex) {
        ErrorResponse error = new ErrorResponse("ENTITY_NOT_FOUND", ex.getMessage());
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(error);
    }
}
```

### 3. 配置管理
```yaml
# application.yml
spring:
  datasource:
    url: ${DB_URL:jdbc:mysql://localhost:3306/myapp}
    username: ${DB_USERNAME:root}
    password: ${DB_PASSWORD:password}
  jpa:
    hibernate:
      ddl-auto: validate
    show-sql: false
```
