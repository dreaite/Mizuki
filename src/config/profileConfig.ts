import type { ProfileConfig } from "../types/config";

// 个人资料配置
export const profileConfig: ProfileConfig = {
	avatar: "https://q2.qlogo.cn/headimg_dl?dst_uin=877261793&spec=640", // 相对于 /src 目录。如果以 '/' 开头，则相对于 /public 目录
	name: "dreaife",
	bio: "The world's end begins.",
	typewriter: {
		enable: true, // 启用个人简介打字机效果
		speed: 80, // 打字速度（毫秒）
	},
	links: [
		{
			name: "GitHub",
			icon: "fa7-brands:github",
			url: "https://github.com/dreaifekks",
		},
		{
			name: "X",
			icon: "fa7-brands:x-twitter",
			url: "https://x.com/inkks1996",
		},
		{
			name: "Telegram Channel",
			icon: "fa7-brands:telegram",
			url: "https://t.me/inkks1996",
		},
		{
			name: "Bangumi",
			icon: "simple-icons:barmenia",
			url: "https://bgm.tv/user/lagos",
		},
		{
			name: "Email",
			icon: "fa7-solid:envelope",
			url: "mailto:dreaifehe@gmail.com",
		},
	],
};
