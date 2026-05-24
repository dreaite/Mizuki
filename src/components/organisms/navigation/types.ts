import type { LinkPreset, NavBarLink } from "../../../types/config";
import type { LocaleSwitchPathMap } from "../../../utils/locale-switch-utils";

export interface NavMenuPanelProps {
	links: NavBarLink[];
	localeSwitchPaths?: LocaleSwitchPathMap;
}

export interface DropdownMenuProps {
	link: NavBarLink;
	class?: string;
}

export interface ProcessedNavBarLink extends Omit<NavBarLink, "children"> {
	children?: ProcessedNavBarLink[];
}

export type { LinkPreset };
