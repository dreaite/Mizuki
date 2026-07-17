import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";

import { LinkPreset, type NavBarLink } from "@/types/config";

export const LinkPresets: Record<LinkPreset, NavBarLink> = {
	[LinkPreset.Home]: {
		name: "Home",
		url: "/",
		icon: "material-symbols:home",
	},
	[LinkPreset.About]: {
		name: "About",
		url: "/about/",
		icon: "material-symbols:person",
	},
	[LinkPreset.Archive]: {
		name: "Archive",
		url: "/archive/",
		icon: "material-symbols:archive",
	},
	[LinkPreset.Friends]: {
		name: "Friends",
		url: "/friends/",
		icon: "material-symbols:group",
	},
	[LinkPreset.Anime]: {
		name: "Anime",
		url: "/anime/",
		icon: "material-symbols:movie",
	},
	[LinkPreset.Diary]: {
		name: "Diary",
		url: "/diary/",
		icon: "material-symbols:book",
	},
	[LinkPreset.Albums]: {
		name: "Gallery",
		url: "/albums/",
		icon: "material-symbols:photo-library",
	},
	[LinkPreset.Projects]: {
		name: "Projects",
		url: "/projects/",
		icon: "material-symbols:work",
	},
	[LinkPreset.Skills]: {
		name: "Skills",
		url: "/skills/",
		icon: "material-symbols:psychology",
	},
	[LinkPreset.Timeline]: {
		name: "Timeline",
		url: "/timeline/",
		icon: "material-symbols:timeline",
	},
	[LinkPreset.AITools]: {
		name: i18n(I18nKey.aiTools),
		url: "/ai-tools/",
		icon: "material-symbols:smart-toy",
	},
};
