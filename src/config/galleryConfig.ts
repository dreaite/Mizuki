import type { GalleryConfig } from "../types/gallery";

/**
 * 画作展示页配置。
 *
 * Pixiv 与 Bilibili 暂未在仓库中找到可确认的个人主页地址，因此先留空。
 * 留空的链接仍会在页面显示为“待配置”，但不会跳转到错误的账号。
 */
export const galleryConfig: GalleryConfig = {
	socialLinks: [
		{
			platform: "pixiv",
			label: "Pixiv",
			icon: "simple-icons:pixiv",
			url: "https://www.pixiv.net/users/24495678",
		},
		{
			platform: "x",
			label: "X",
			icon: "fa7-brands:x-twitter",
			url: "https://x.com/inddkks004",
		},
		{
			platform: "bilibili",
			label: "Bilibili",
			icon: "fa7-brands:bilibili",
			url: "https://space.bilibili.com/66384529",
		},
	],
};
