
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
