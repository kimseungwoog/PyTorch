import type { FeedAuthor, FeedPost, FeedSource, FeedState } from '../../shared/types';
import { OrderError } from './broker/types';
import { loadJson, saveJson } from './json';

// 새 글 알림: 등록한 사람의 새 글을 주기적으로 확인해 제목과 링크만 남긴다. 본문은 저장하지 않는다.
//
//  - X          : 공식 API v2 (서버 .env 의 X_BEARER_TOKEN 필요, 요금제에 따라 유료)
//  - 트레이딩뷰 : 공개 RSS (https://www.tradingview.com/feed/?username=아이디)
//  - 에펨코리아 : 주식 게시판 닉네임 검색 화면
//
// 트레이딩뷰와 에펨코리아는 먼저 그 사이트의 robots.txt 를 읽어 허용된 주소만 확인한다.
// 허용하지 않거나 접속을 막으면 우회하지 않고 그 사실을 화면에 표시한다(바로 가기 링크는 그대로 쓸 수 있다).
//
// 이 작업 환경에서는 세 사이트 모두 접속이 막혀 실제 응답으로 확인하지 못했다.
// 주소와 응답 형식(특히 에펨코리아 화면 구조)은 실제로 돌려 보며 맞춰야 한다.

interface Stored {
  authors: FeedAuthor[];
  posts: FeedPost[];
  intervalMin: number;
  lastPollAt?: number;
  seq: number;
}

interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}
export type Fetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<HttpResponse>;

const X_API = 'https://api.x.com/2';
const USER_AGENT = 'TradeDeck/1.0 (personal new-post checker)';
const MAX_POSTS = 300;
const HANDLE_RULE: Record<FeedSource, RegExp> = {
  x: /^[A-Za-z0-9_]{1,15}$/,
  tradingview: /^[A-Za-z0-9_-]{1,40}$/,
  fmkorea: /^.{1,40}$/,
};

// 사람이 직접 열어 볼 주소
export function authorLink(a: Pick<FeedAuthor, 'source' | 'handle'>): string {
  const h = encodeURIComponent(a.handle);
  if (a.source === 'x') return `https://x.com/${h}`;
  if (a.source === 'tradingview') return `https://www.tradingview.com/u/${h}/`;
  return `https://www.fmkorea.com/search.php?mid=stock&search_target=nick_name&search_keyword=${h}`;
}

const stripTags = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

// robots.txt 의 "User-agent: *" 규칙으로 path 를 읽어도 되는지 판단한다. 가장 긴 규칙이 이긴다.
export function robotsAllows(robots: string, path: string): boolean {
  let applies = false;
  let lastWasAgent = false;
  let best = { length: -1, allow: true };
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      applies = lastWasAgent ? applies || value === '*' : value === '*';
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!applies || (key !== 'allow' && key !== 'disallow') || !value) continue;
    const pattern = new RegExp(
      '^' +
        value
          .split('*')
          .map((part) => part.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\\?\$$/, '$'))
          .join('.*'),
    );
    if (pattern.test(path) && value.length > best.length) best = { length: value.length, allow: key === 'allow' };
  }
  return best.allow;
}

export class Feed {
  private state: Stored;
  private timer?: NodeJS.Timeout;
  private robots = new Map<string, { at: number; text: string | null }>();
  private listeners: Array<(posts: FeedPost[], author: FeedAuthor) => void> = [];

  constructor(
    private token: string | undefined,
    private file?: string,
    private fetchImpl: Fetch = fetch as unknown as Fetch,
  ) {
    this.state = loadJson<Stored>(file, { authors: [], posts: [], intervalMin: 15, seq: 0 });
  }

  // 알림을 켠 사람의 새 글이 확인되면 불린다. 처음 등록할 때 이미 있던 글은 알리지 않는다.
  onNewPosts(cb: (posts: FeedPost[], author: FeedAuthor) => void) {
    this.listeners.push(cb);
  }

  snapshot(): FeedState {
    const { authors, posts, intervalMin, lastPollAt } = this.state;
    return { authors, posts, intervalMin, lastPollAt, xEnabled: Boolean(this.token) };
  }

  start() {
    clearInterval(this.timer);
    this.timer = setInterval(() => void this.poll(), this.state.intervalMin * 60_000);
  }

  stop() {
    clearInterval(this.timer);
  }

  addAuthor(source: FeedSource, handle: string, notify: boolean): FeedAuthor {
    const clean = handle.trim().replace(/^@/, '');
    if (!(source in HANDLE_RULE)) throw new OrderError('지원하지 않는 곳입니다.');
    if (!HANDLE_RULE[source].test(clean)) throw new OrderError('아이디(닉네임) 형식을 확인해 주세요.');
    if (this.state.authors.some((a) => a.source === source && a.handle.toLowerCase() === clean.toLowerCase())) {
      throw new OrderError('이미 등록한 사람입니다.');
    }
    const author: FeedAuthor = { id: `F${++this.state.seq}`, source, handle: clean, notify };
    this.state.authors.push(author);
    this.save();
    return author;
  }

  removeAuthor(id: string) {
    this.state.authors = this.state.authors.filter((a) => a.id !== id);
    this.state.posts = this.state.posts.filter((p) => p.authorId !== id);
    this.save();
  }

  setInterval(min: number) {
    if (![5, 15, 30, 60].includes(min)) throw new OrderError('주기는 5·15·30·60분 중에서 고릅니다.');
    this.state.intervalMin = min;
    this.save();
    this.start();
  }

  async poll(): Promise<void> {
    for (const author of this.state.authors) {
      try {
        if (author.source === 'x' && !this.token) {
          author.error = 'X 토큰이 없어 자동 확인을 하지 않습니다.';
          continue;
        }
        const found =
          author.source === 'x'
            ? await this.checkX(author)
            : author.source === 'tradingview'
              ? await this.checkTradingView(author)
              : await this.checkFmkorea(author);
        author.error = undefined;
        const first = author.seen === undefined;
        const seen = new Set(author.seen ?? []);
        const fresh = found.filter((p) => !seen.has(p.id));
        author.seen = [...fresh.map((p) => p.id), ...(author.seen ?? [])].slice(0, 200);
        if (!fresh.length) continue;
        this.state.posts = [...fresh, ...this.state.posts].sort((a, b) => b.ts - a.ts).slice(0, MAX_POSTS);
        if (!first && author.notify) for (const cb of this.listeners) cb(fresh, author);
      } catch (e) {
        // 연결 실패·시간 초과는 사람이 읽을 수 있는 말로 바꾼다.
        const { name, message } = e as Error;
        author.error = name === 'TypeError' || name === 'TimeoutError' ? '사이트에 접속하지 못했습니다. 잠시 뒤 다시 확인합니다.' : message;
      }
    }
    this.state.lastPollAt = Date.now();
    this.save();
  }

  private post(author: FeedAuthor, id: string, title: string, url: string, ts = Date.now()): FeedPost {
    return { id, authorId: author.id, source: author.source, handle: author.handle, text: title.slice(0, 200), url, ts };
  }

  // ---------- X ----------
  private async xGet<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${X_API}${path}`, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!res.ok) {
      const hint = { 401: '토큰이 올바르지 않습니다', 403: '이 요금제로는 읽을 수 없습니다', 429: '호출 한도를 넘었습니다' }[res.status];
      throw new Error(`X API 오류 ${res.status}${hint ? ` · ${hint}` : ''}`);
    }
    return (await res.json()) as T;
  }

  // 리트윗과 답글은 뺀다.
  private async checkX(author: FeedAuthor): Promise<FeedPost[]> {
    if (!author.userId) {
      const user = await this.xGet<{ data?: { id: string } }>(`/users/by/username/${author.handle}`);
      if (!user.data?.id) throw new Error('X 에서 이 아이디를 찾지 못했습니다');
      author.userId = user.data.id;
    }
    const since = author.lastId ? `&since_id=${author.lastId}` : '';
    const res = await this.xGet<{ data?: Array<{ id: string; text: string; created_at?: string }> }>(
      `/users/${author.userId}/tweets?max_results=10&exclude=retweets,replies&tweet.fields=created_at${since}`,
    );
    const tweets = res.data ?? [];
    if (tweets.length) author.lastId = tweets[0].id;
    return tweets.map((t) =>
      this.post(author, t.id, t.text, `https://x.com/${author.handle}/status/${t.id}`, t.created_at ? Date.parse(t.created_at) : undefined),
    );
  }

  // ---------- 공개 웹 (robots.txt 를 따른다) ----------
  private async getPage(url: string): Promise<string> {
    const u = new URL(url);
    const cached = this.robots.get(u.origin);
    let robots = cached && Date.now() - cached.at < 86_400_000 ? cached.text : undefined;
    if (robots === undefined) {
      const res = await this.fetchImpl(`${u.origin}/robots.txt`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
      // 규칙 파일이 없으면(404 등) 허용, 서버 오류면 확인을 미룬다.
      if (res.status >= 500) throw new Error(`사이트 규칙(robots.txt)을 읽지 못했습니다 (${res.status})`);
      robots = res.ok ? await res.text() : null;
      this.robots.set(u.origin, { at: Date.now(), text: robots });
    }
    if (robots !== null && !robotsAllows(robots, u.pathname + u.search)) {
      throw new Error('이 사이트가 자동 확인을 허용하지 않습니다. "열기"로 직접 확인해 주세요.');
    }
    const res = await this.fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`사이트가 접속을 받지 않았습니다 (${res.status}). "열기"로 직접 확인해 주세요.`);
    return res.text();
  }

  private async checkTradingView(author: FeedAuthor): Promise<FeedPost[]> {
    const xml = await this.getPage(`https://www.tradingview.com/feed/?username=${encodeURIComponent(author.handle)}`);
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
    if (!items.length && !/<rss|<channel/.test(xml)) throw new Error('트레이딩뷰 글 목록 형식을 읽지 못했습니다.');
    const tag = (item: string, name: string) => stripTags(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(item)?.[1] ?? '');
    return items.flatMap((item) => {
      const link = tag(item, 'link');
      if (!link.startsWith('https://')) return [];
      const ts = Date.parse(tag(item, 'pubDate'));
      return [this.post(author, link, tag(item, 'title') || '새 글', link, Number.isNaN(ts) ? undefined : ts)];
    });
  }

  private async checkFmkorea(author: FeedAuthor): Promise<FeedPost[]> {
    const html = await this.getPage(authorLink(author));
    const posts = new Map<string, FeedPost>();
    // 글 주소는 /글번호 또는 document_srl=글번호 꼴이다. 제목이 있는 링크만 쓴다.
    for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const id = /(?:document_srl=|^\/|fmkorea\.com\/)(\d{6,})(?:[?&#]|$)/.exec(m[1].replace(/&amp;/g, '&'))?.[1];
      const title = stripTags(m[2]);
      if (id && title.length >= 2 && !posts.has(id)) posts.set(id, this.post(author, id, title, `https://www.fmkorea.com/${id}`));
    }
    if (!posts.size) throw new Error('글 목록을 읽지 못했습니다 (접속 차단 또는 화면 구조 변경).');
    return [...posts.values()].slice(0, 30);
  }

  private save() {
    saveJson(this.file, this.state);
  }
}
