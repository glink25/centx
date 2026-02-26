我需要创建如下工作流：
拥有一个公开仓库 cent ：git@github.com:glink25/Cent.git
以及一个私有仓库 cent-tauri ：git@github.com:glink25/cent-tauri.git
现在我需要将公开仓库cent中的一个本地分支tauri（尚未推送到云端）推送到私有仓库cent-tauri的同名tauri分支中，使得开发时能够保持核心的代码始终与公开仓库一致。
为了方便迁移，请帮我编写一些脚本用于完成此工作流：
场景1:初始化
作用：首次创建tauri分支，将tauri分支推送到私有仓库的远端分支中，并且当我每次在tauri分支push时，默认推送到私有仓库。
```
#!/bin/bash

git remote add private https://github.com/glink25/cent-tauri.git

git checkout tauri

git push -u private tauri

git branch --set-upstream-to=private/tauri tauri

echo "初始化完成！现在 tauri 分支的默认推送目标已设置为私有仓库。"


# 1. 添加私有仓库作为新的 remote，命名为 "private"
# 2. 确保当前在 tauri 分支
# 3. 将本地 tauri 分支推送到私有仓库的 tauri 分支
# -u 参数会建立上游追踪关系，以后在该分支执行 git push 会默认推向这里
```

场景2:协作
当我在其他电脑上想要开发tauri分支时，我希望可以直接clone公开仓库，然后运行该脚本，它会自动帮我拉取私有仓库的远端tauri分支到本地，并且当我每次在tauri分支push时，默认推送到私有仓库。
```
#!/bin/bash

git remote add private https://github.com/glink25/cent-tauri.git

git fetch private

git checkout -b tauri private/tauri

git branch --set-upstream-to=private/tauri tauri

echo "协作环境配置完成！你现在处于 tauri 分支，push 操作将同步至私有仓库。"

# 1. 添加私有仓库远程地址
# 2. 从私有仓库抓取最新数据
# 3. 在本地创建 tauri 分支，并跟踪私有仓库的 tauri 分支
# 4. 设置该分支的默认推送目标为 private 远程库
```