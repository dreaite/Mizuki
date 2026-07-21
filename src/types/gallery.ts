export type GalleryPlatform = "pixiv" | "x" | "bilibili";

export interface GallerySocialLink {
	platform: GalleryPlatform;
	label: string;
	icon: string;
	url: string;
}

export interface GalleryConfig {
	socialLinks: GallerySocialLink[];
}

export interface ArtworkManifestEntry {
	file: string;
	title?: string;
	alt?: string;
	publishedAt?: string;
	description?: string;
	thumbnail?: string;
	width?: number;
	height?: number;
	hidden?: boolean;
}

export interface Artwork {
	id: string;
	title: string;
	alt: string;
	publishedAt: string;
	description?: string;
	src: string;
	thumbnail?: string;
	width?: number;
	height?: number;
}
