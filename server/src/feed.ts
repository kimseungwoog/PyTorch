import type { FeedAuthor, FeedPost, FeedSource, FeedState } from '../../shared/types';
import { OrderError } from './broker/types';
import { loadJson, saveJson } from './json';

// 글 모아보기: 등록한 사람의 새 글을 주기적으로 가져온다.
//
//  - X: 공식 API v2 로만 가져온다. 서버 .env 에 X_BEARER_TOKEN 이 있어야 하고, 요금제에 따라 유료다.
//       (GET /2/users/by/username/:name, GET /2/users/:id/tweets)
//  - 에펨코리아: 공식 API 가 없고 자동 수집을 막고 있어 서버가 가져오지 않는다.
//       등록한 닉네임의 검색 화면을 여는 링크만 제공한다.
//
// 이 환경에서는 X 서버에 닿지 않아 실제 호출은 확인하지 못했다. 응답 처리는 공개 문서의 형식을 따른다.

interface Stored {
  authors: FeedAuthor[];
  posts: FeedPost[];
  intervalMin: number;
  lastPollAt?: number;
  seq: number;
}

type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const X_API = 'https://api.x.com/2';
const MAX_POSTS = 300;

export function authorLink(a: Pick<FeedAuthor, 'source' | 'handle'>): string {
  return a.source === 'x'
    ? `https://x.com/${encodeURIComponent(a.handle)}`
    : `https://www.fmkorea.com/search.php?mid=stock&search_target=nick_name&search_keyword=${encodeURIComponent(a.handle)}`;
}

export class Feed {
  private state: Stored;
  private timer?: NodeJS.Timeout;
  private listeners: Array<(posts: FeedPost[], author: FeedAuthor) => void> = [];

  constructor(
    private token: string | undefined,
    private file?: string,
    private fetchImpl: Fetch = fetch as unknown as Fetch,
  ) {
    this.state = loadJson<Stored>(file, { authors: [], posts: [], intervalMin: 15, seq: 0 });
  }

  // 알림을 켠 사람의 새 글이 들어오면 불린다. 처음 등록할 때 가져온 글은 알리지 않는다.
  onNewPosts(cb: (posts: FeedPost[], author: FeedAuthor) => void) {
    this.listeners.push(cb);
  }

  snapshot(): FeedState {
    const { authors, posts, intervalMin, lastPollAt } = this.state;
    return { authors, posts, intervalMin, lastPollAt, xEnabled: Boolean(this.token) };
  }

  start() {
    clearInterval(this.timer);
    if (this.token) this.timer = setInterval(() => void this.poll(), this.state.intervalMin * 60_000);
  }

  stop() {
    clearInterval(this.timer);
  }

  addAuthor(source: FeedSource, handle: string, notify: boolean): FeedAuthor {
    const clean = handle.trim().replace(/^@/, '');
    if (source !== 'x' && source !== 'fmkorea') throw new OrderError('지원하지 않는 곳입니다.');
    if (!clean || clean.length > 40) throw new OrderError('아이디(닉네임)를 확인해 주세요.');
    if (source === 'x' && !/^[A-Za-z0-9_]{1,15}$/.test(clean)) throw new OrderError('X 아이디는 영문·숫자·밑줄 15자 이내입니다.');
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
    if (!this.token) return;
    for (const author of this.state.authors) {
      if (author.source !== 'x') continue;
      try {
        const fresh = await this.fetchX(author);
        author.error = undefined;
        if (fresh.length) {
          const first = author.lastId === undefined;
          author.lastId = fresh[0].id;
          this.state.posts = [...fresh, ...this.state.posts].sort((a, b) => b.ts - a.ts).slice(0, MAX_POSTS);
          if (!first && author.notify) for (const cb of this.listeners) cb(fresh, author);
        } else if (author.lastId === undefined) {
          author.lastId = '0';
        }
      } catch (e) {
        author.error = (e as Error).message;
      }
    }
    this.state.lastPollAt = Date.now();
    this.save();
  }

  private async xGet<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${X_API}${path}`, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!res.ok) {
      const hint = { 401: '토큰이 올바르지 않습니다', 403: '이 요금제로는 읽을 수 없습니다', 429: '호출 한도를 넘었습니다' }[res.status];
      throw new Error(`X API 오류 ${res.status}${hint ? ` · ${hint}` : ''}`);
    }
    return (await res.json()) as T;
  }

  // 새 글을 최신순으로 돌려준다. 리트윗과 답글은 뺀다.
  private async fetchX(author: FeedAuthor): Promise<FeedPost[]> {
    if (!author.userId) {
      const user = await this.xGet<{ data?: { id: string } }>(`/users/by/username/${author.handle}`);
      if (!user.data?.id) throw new Error('X 에서 이 아이디를 찾지 못했습니다');
      author.userId = user.data.id;
    }
    const since = author.lastId && author.lastId !== '0' ? `&since_id=${author.lastId}` : '';
    const res = await this.xGet<{ data?: Array<{ id: string; text: string; created_at?: string }> }>(
      `/users/${author.userId}/tweets?max_results=10&exclude=retweets,replies&tweet.fields=created_at${since}`,
    );
    return (res.data ?? []).map((t) => ({
      id: t.id,
      authorId: author.id,
      handle: author.handle,
      text: t.text,
      url: `https://x.com/${author.handle}/status/${t.id}`,
      ts: t.created_at ? Date.parse(t.created_at) : Date.now(),
    }));
  }

  private save() {
    saveJson(this.file, this.state);
  }
}
