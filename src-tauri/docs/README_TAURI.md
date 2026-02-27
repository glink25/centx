使用tauri开发时，需要注意是否提前执行 
```
# 初始化在目
pnpm tauri ios init

# 更新图标
pnpm tauri icon ./public/logo.png

```
Info.plist
需要配置xcode项目的网络访问权限
```
App Transport Security Settings
Allow Arbitrary Loads yes
```
还需要手动配置deep-link，在URL types中添加"dailycent"，才能正常触发OAuth回调