
export interface CardData {
  id: string;
  url: string;
  title: string;
  description: string;
  thumbnail: string;
  x: number;
  y: number;
  color: string;
  type?: 'link' | 'youtube' | 'image' | 'pdf';
}

export interface SiteInfo {
  title: string;
  description: string;
  themeColor: string;
  category: string;
}

export type ResourceKind = 'video' | 'paper' | 'doc' | 'article';

export interface SuggestedResource {
  title: string;
  description: string;
  url: string;
  type: ResourceKind;
  reason: string;
  source: string;
}
