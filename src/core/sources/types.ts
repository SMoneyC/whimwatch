import type { Listing, RemoteInfo } from '../../shared/types.js';
import type { Fetcher } from '../fetcher.js';

export type SourceFindings = Omit<RemoteInfo, 'listing' | 'checkedAt' | 'status'> & {
  status?: RemoteInfo['status'];
  /** Author/uploader name the page credits, for sanity checks. */
  author?: string;
  /** Creator Patreon links found on the page. */
  patreonLinks?: string[];
  /** The listing was an index page; these pages should be checked instead. */
  expandTo?: string[];
};

export type SourceChecker = (listing: Listing, fetcher: Fetcher) => Promise<SourceFindings>;
