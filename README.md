# 11班观察日记

高三（11）班两本手写观察日记的静态阅览站点：首页选册，阅读器里可以拖动或按键翻页。

- 纯静态：没有构建步骤、没有后端、没有第三方依赖，`index.html` 直接打开就能用。
- 两册：`斜塔`（90 个跨页）、`暗香`（19 个跨页），跨页图为原片的 WebP 版本。
- 翻页：CSS 3D 的「一叶翻面」，正面是本页右半、背面是下一页左半；支持拖拽、键盘、触摸滑动。

## 目录

```
index.html                  书架首页
reader.html                 阅读器
assets/
  css/  base.css            设计变量与氛围层
        home.css            首页布局
        reader.css          舞台、翻页、缩略图
  js/   books-data.js       书目与页清单（由脚本生成，勿手改）
        flipbook.js         翻页引擎
        reader.js           阅读器编排（URL、进度、缩略图、键盘）
        home.js             首页过渡
  books/vol-1|vol-2/        页图 pages/、缩略图 thumbs/、封面 cover.webp
  fonts/                    站点用字的子集（woff2）
  source/jpg/               原始 JPG 副本（不进仓库，仅本机留档）
scripts/
  measure_folds.py          量出每张跨页的中缝位置 → fold-lines.json
  build_assets.py           原图 → 对齐后的 WebP 页图 + 缩略图 + books-data.js
  build_fonts.py            按页面文案做字体子集
  fold-lines.json           中缝坐标表（构建输入，勿手改）
```

## 本地预览

```bash
python3 -m http.server 8123
# 打开 http://127.0.0.1:8123/
```

直接用 `file://` 打开 `index.html` 也可以（脚本是普通 script，不是 ES module）。

## 重新生成资源

原图（抠图产物）默认读这两个目录：

- `/home/penguin/Desktop/penguin/高中观察日记/裁剪/JPG`
- `/home/penguin/Desktop/penguin/高中观察日记/裁剪/PNG`（透明底，优先使用）

```bash
python3 scripts/measure_folds.py --write   # 原图换过之后先量中缝
python3 scripts/build_assets.py            # 出页图 pages/、thumbs/、books-data.js
python3 scripts/build_fonts.py             # 改过文案后重跑，补字体子集
```

### 页图怎么对齐

源片是手持翻拍的：书在画面里忽大忽小，中缝也常常不在正中，上下留白各不相同。
直接缩放到 1600×1200 的话，翻页时纸边会一页一跳。所以每张跨页都要重新装框：

- 中缝钉在画布正中 `x=800`；
- 纸的上边钉在 `y=64`，下边钉在 `y=1135`，左右各留 30px 白边；
- 左右两页分别按自己那半的宽度缩放——中缝因透视偏在一侧时，两页拍出来的宽度不等，
  各自贴回 770px，两张纸的外边也就对齐了。

中缝位置由 `measure_folds.py` 按「每列亮度的低分位数取最小值」量出来：中缝是两页
纸相接处的暗缝，它在绝大多数行上都暗，而字迹只在少数行上暗。量完写进
`scripts/fold-lines.json`，`build_assets.py` 只按表装框，缺条目直接报错。
注意 `measure_folds.py` 读的是 `裁剪/PNG` 原图，换原图后要重跑。

`build_assets.py` 里的 `BOOKS` 定义了每册的封面、封底与跨页区间；换书或调页序改这里。
**改动文案后必须重跑 `build_fonts.py`**，否则新出现的汉字会掉回系统字体。

## 部署到 GitHub Pages

仓库根目录即站点根目录（已有 `.nojekyll`）：

1. 推到 GitHub；
2. Settings → Pages → Source 选 `Deploy from a branch`，分支 `main`、目录 `/ (root)`；
3. 等一两分钟，访问 `https://<用户名>.github.io/311-diary/`。

所有资源都用相对路径，放在子路径下也能正常加载。

## 关于体积

页图是 1600×1200 的带 alpha WebP（约 240 KB/张），两册合计约 26 MB；
原始的 115 张 JPG/PNG 体积很大，只在 `assets/source/` 与本机原目录各留一份，
已在 `.gitignore` 里排除，不会进仓库。

## 内容说明

内页为同学手写原件，未做删改与转录；照片中的日期、班级与姓名一仍其旧。
站点只做陈列，不做检索与再分发。
