import * as cheerio from 'cheerio';
import type { Listing } from '../../shared/types.js';
import type { Fetcher } from '../fetcher.js';
import { classifyUrl, parseDate } from './urls.js';

export const WWMOD_DOWNLOAD_URL = 'https://wickedwhimsmod.com/download';

export interface DirectoryEntry {
  /** Author/animator name. */
  name: string;
  /** Item name for non-animator boxes ("Body Mesh", "CinErotique TV"). */
  item?: string;
  section: string;
  links: Listing[];
}

export interface WwModPage {
  version?: string;
  releasedAt?: number;
  gameVersions?: string;
  supportedGameVersions: string[];
  coreLinks: string[];
  directory: DirectoryEntry[];
}

export function parseWwModPage(html: string): WwModPage {
  const $ = cheerio.load(html);

  let version: string | undefined;
  let releasedAt: number | undefined;
  $('h2').each((_, el) => {
    const m = /WickedWhims\s+v(\d+[a-z]?(?:\.\d+)?)/i.exec($(el).text());
    if (!m || version) return;
    version = m[1];
    releasedAt = parseDate($(el).nextAll('h3').first().text());
  });

  const text = $('body').text().replace(/\s+/g, ' ');
  const gv = /Supported Game Versions:\s*(\d+\.\d+\.\d+)\s*\/\s*([A-Za-z]+ \d{1,2})/.exec(text);
  const gameVersions = gv ? `${gv[1]} (${gv[2]})` : undefined;
  const listStart = text.indexOf('Supported Game Versions:');
  const listText = listStart < 0 ? '' : text.slice(listStart, listStart + 1500).split(/Update Patch Notes|Download from/)[0]!;
  const supportedGameVersions = [...new Set(listText.match(/\b\d+\.\d+\.\d+\b/g) ?? [])];

  const coreLinks = [
    ...new Set(
      $('a[href]')
        .map((_, a) => $(a).attr('href') ?? '')
        .get()
        .filter((u) => /wicked\.cc\/mods\/admin\/wickedwhims|turbodriver\.itch\.io\/wickedwhims\/?$/.test(u)),
    ),
  ];

  const directory: DirectoryEntry[] = [];
  let section = '';
  $('h1, .download-box').each((_, el) => {
    const node = $(el);
    if (el.tagName === 'h1') {
      section = node.text().trim();
      return;
    }
    const title = node.find('.download-box-title').first().text().replace(/\s+/g, ' ').trim();
    const author = node.find('.download-box-text').first().text().replace(/\s+/g, ' ').trim();
    const links: Listing[] = [];
    node.find('.download-box-links a[href]').each((_, a) => {
      const url = $(a).attr('href')!;
      const source = classifyUrl(url);
      if (source && source !== 'wwmod') links.push({ source, url, origin: 'directory' });
    });
    if (!title) return;
    directory.push(author ? { name: author, item: title, section, links } : { name: title, section, links });
  });

  return { version, releasedAt, gameVersions, supportedGameVersions, coreLinks, directory };
}

export async function fetchWwModPage(fetcher: Fetcher): Promise<WwModPage> {
  const res = await fetcher.get(WWMOD_DOWNLOAD_URL);
  if (res.status !== 200) throw new Error(`wickedwhimsmod.com returned HTTP ${res.status}`);
  return parseWwModPage(res.body);
}
