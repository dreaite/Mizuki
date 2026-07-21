# 画作展示页使用说明

画作展示页的默认中文规范地址为 `/gallery/`。页面会扫描 `public/images/artworks/`，按发布日期从新到旧生成瀑布流，点击任意作品可打开大图。

为避免 GSC 收录重复页面，构建不会生成 `/cn/gallery/`；生产环境已有的 `/cn/*` 规则会把旧地址 301 到无前缀地址。`/en/gallery/` 与 `/jp/gallery/` 是独立语言版本，保留各自的 canonical 与 hreflang。

## 最快的上传方式

把图片放进 `public/images/artworks/`，文件名以日期开头：

```text
public/images/artworks/
├── 2026-07-21-summer-sky.webp
├── 2026-07-04-blue-hour.webp
└── gallery.json
```

文件名中的 `YYYY-MM-DD` 会作为发布日期；后面的名称会自动转换为作品标题。没有日期前缀时，必须在 `gallery.json` 中填写 `publishedAt`，否则构建会报错。这样经过 Git 拉取或内容同步后，排序也不会漂移。

## 完整元数据

需要自定义标题、说明、缩略图或尺寸时，在同目录的 `gallery.json` 中添加：

```json
{
  "artworks": [
    {
      "file": "2026-07-21-summer-sky.webp",
      "title": "夏空",
      "alt": "蓝天下漂浮着白云的原创插画",
      "publishedAt": "2026-07-21",
      "description": "一次夏日色彩练习",
      "thumbnail": "thumbs/2026-07-21-summer-sky.webp",
      "width": 2400,
      "height": 3200,
      "hidden": false
    }
  ]
}
```

- `file` 是必填项，其余字段可选。
- `thumbnail` 用于图片墙预览，点击后仍会打开 `file` 指向的完整图片。
- `thumbs/`、`thumbnails/` 和 `_thumbs/` 目录不会被当成独立作品扫描。
- `hidden: true` 可以暂时隐藏作品。
- 页面以 `publishedAt` 为最高优先级进行倒序排列。

建议上传 WebP 或 AVIF，并为大尺寸原图准备约 640–960px 宽的缩略图，以减少图片墙的首屏流量。

## 社交链接

Pixiv、X、Bilibili 的入口在 `src/config/galleryConfig.ts` 集中配置。链接留空时，图标仍会显示，但处于不可点击的“待配置”状态。

每项的 `icon` 是 Iconify 图标名，`url` 是点击后打开的主页地址；无需改页面组件：

```ts
export const galleryConfig = {
  socialLinks: [
    { platform: "pixiv", label: "Pixiv", icon: "simple-icons:pixiv", url: "" },
    { platform: "x", label: "X", icon: "fa7-brands:x-twitter", url: "https://x.com/inkks1996" },
    { platform: "bilibili", label: "Bilibili", icon: "fa7-brands:bilibili", url: "" },
  ],
};
```

## 启用内容分离时

生产环境启用 `ENABLE_CONTENT_SYNC=true` 后，会按内容仓库 `images/` 下的一级文件或目录分别映射到 `public/images/`，不会再替换整个 `public/images/`。因此，只要内容仓库没有同名的 `images/artworks/`，主仓库中的 `public/images/artworks/` 与 `gallery.json` 会原样进入部署产物。

同一个一级目录只建议由一个仓库维护：如果内容仓库也提供 `images/artworks/`，它会覆盖主仓库的 `public/images/artworks/`；此时画作与 `gallery.json` 应全部放在内容仓库中。
