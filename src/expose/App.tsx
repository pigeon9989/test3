import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Menu, Pill, Segmented, Stack, Text,
} from '@mf-platform/ui';
import { platform } from '../platform';

/* ─── Templates ─── */

const TEMPLATES: { id: string; label: string; body: string }[] = [
  { id: 'blank',   label: '빈 문서',     body: '' },
  {
    id: 'intro',
    label: '소개',
    body: `# Markdown Preview

이 모듈은 host와 분리된 코드 베이스에서 빌드/배포되어 host에 동적으로 mount됩니다.

## 지원 문법
- **굵게** 와 *기울임* 그리고 \`inline code\`
- 안전한 [링크](https://module-federation.io)
- 번호/불릿 목록

> 인용은 이렇게 표시됩니다.

\`\`\`
코드 블록도 가능합니다.
\`\`\`
`,
  },
  {
    id: 'meeting',
    label: '회의록',
    body: `# 회의록 · YYYY-MM-DD

## 참석자
- 이름 (역할)

## 안건
1. 안건 1
2. 안건 2

## 결정 사항
- [ ] 액션 아이템 1 — 담당자, 기한
- [ ] 액션 아이템 2 — 담당자, 기한

## 메모
> 인용/배경 정보가 있다면 여기에.
`,
  },
  {
    id: 'release',
    label: '릴리즈 노트',
    body: `# v0.0.0 — YYYY-MM-DD

## 새로운 기능
- 기능 A
- 기능 B

## 개선
- 무엇이 좋아졌는지

## 버그 수정
- 어떤 버그가 잡혔는지

## 알려진 문제
- 다음 릴리즈에서 다룰 항목

## 마이그레이션 가이드
\`\`\`
필요 시 코드 예시
\`\`\`
`,
  },
  {
    id: 'todo',
    label: '할 일',
    body: `# 오늘 할 일

## 우선순위 높음
- [ ] 작업 1
- [ ] 작업 2

## 나중에
- [ ] 후순위 1

## 완료
- [x] 끝낸 작업
`,
  },
];

const STORAGE_KEY = 'markdown/state';

/* ─── Markdown → HTML (XSS-safe) ─── */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(url: string): string | null {
  try {
    const u = new URL(url, 'https://example.invalid');
    return u.protocol === 'http:' || u.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function renderInline(text: string): string {
  let out = text;
  out = out.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, (_, c) => `<strong>${c}</strong>`);
  out = out.replace(/\*([^*]+)\*/g, (_, c) => `<em>${c}</em>`);
  out = out.replace(/~~([^~]+)~~/g, (_, c) => `<s>${c}</s>`);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const safe = safeUrl(url);
    return safe ? `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>` : m;
  });
  return out;
}

interface MdHeading { level: number; text: string; id: string; }

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function mdToHtml(md: string): { html: string; headings: MdHeading[] } {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  const headings: MdHeading[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? '';

    if (/^```/.test(raw)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '');
        i++;
      }
      i++;
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (h) {
      const level = h[1]!.length;
      const text = h[2] ?? '';
      const id = slugify(text);
      headings.push({ level, text, id });
      out.push(`<h${level} id="${id}">${renderInline(escapeHtml(text))}</h${level}>`);
      i++;
      continue;
    }

    if (/^>\s?/.test(raw)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] ?? '')) {
        buf.push((lines[i] ?? '').replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderInline(escapeHtml(buf.join(' ')))}</blockquote>`);
      continue;
    }

    if (/^(-|\*)\s+\[[ xX]\]\s+/.test(raw)) {
      const items: string[] = [];
      while (i < lines.length && /^(-|\*)\s+\[[ xX]\]\s+/.test(lines[i] ?? '')) {
        const m = /^(-|\*)\s+\[([ xX])\]\s+(.*)$/.exec(lines[i] ?? '');
        if (!m) break;
        const checked = m[2]?.toLowerCase() === 'x';
        items.push(
          `<li class="task"><input type="checkbox" disabled${checked ? ' checked' : ''} /> ${renderInline(escapeHtml(m[3] ?? ''))}</li>`,
        );
        i++;
      }
      out.push(`<ul class="task-list">${items.join('')}</ul>`);
      continue;
    }

    if (/^(\d+\.|[-*])\s+/.test(raw)) {
      const ordered = /^\d+\.\s+/.test(raw);
      const items: string[] = [];
      while (i < lines.length && /^(\d+\.|[-*])\s+/.test(lines[i] ?? '') && !/^(-|\*)\s+\[[ xX]\]\s+/.test(lines[i] ?? '')) {
        const item = (lines[i] ?? '').replace(/^(\d+\.|[-*])\s+/, '');
        items.push(`<li>${renderInline(escapeHtml(item))}</li>`);
        i++;
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^(---|\*\*\*)\s*$/.test(raw)) {
      out.push('<hr />');
      i++;
      continue;
    }

    if (raw.trim() === '') {
      i++;
      continue;
    }

    const para: string[] = [raw];
    i++;
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() !== '' &&
      !/^(#|>|```|(\d+\.|[-*])\s+|(---|\*\*\*)\s*$)/.test(lines[i] ?? '')
    ) {
      para.push(lines[i] ?? '');
      i++;
    }
    out.push(`<p>${renderInline(escapeHtml(para.join(' ')))}</p>`);
  }
  return { html: out.join('\n'), headings };
}

/* ─── Component ─── */

type ViewMode = 'split' | 'edit' | 'preview';

interface PersistedState {
  src: string;
  view: ViewMode;
}

// Module-local narrow-viewport hook — modules deploy independently from
// the host, so we don't share `useIsMobile` between them.
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 720px)');
    const fn = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return narrow;
}

export default function App() {
  const initial = TEMPLATES[1]!.body;
  const [src, setSrc] = useState(initial);
  const [view, setView] = useState<ViewMode>('split');
  const [hosted, setHosted] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const narrow = useIsNarrow();
  // On narrow viewports the split view doesn't fit; force-collapse to edit
  // and hide the outline column.
  const effectiveView: ViewMode = narrow && view === 'split' ? 'edit' : view;
  const effectiveOutline = narrow ? false : showOutline;

  const { html, headings } = useMemo(() => mdToHtml(src), [src]);

  useEffect(() => {
    setHosted(platform.connected);
    void platform.storage.get<PersistedState>(STORAGE_KEY).then((s) => {
      if (s && typeof s === 'object') {
        if (typeof s.src === 'string') setSrc(s.src);
        if (s.view === 'edit' || s.view === 'preview' || s.view === 'split') setView(s.view);
      }
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void platform.storage.set(STORAGE_KEY, { src, view } satisfies PersistedState);
    setSavedAt(Date.now());
  }, [src, view, hydrated]);

  const [, forceTick] = useState(0);
  useEffect(() => {
    if (savedAt === null) return;
    const t = window.setInterval(() => forceTick((n) => n + 1), 5000);
    return () => window.clearInterval(t);
  }, [savedAt]);
  const savedLabel = (() => {
    if (savedAt === null) return null;
    const diff = Math.max(0, Math.floor((Date.now() - savedAt) / 1000));
    if (diff < 3) return '방금 저장됨';
    if (diff < 60) return `${diff}초 전 저장됨`;
    const m = Math.floor(diff / 60);
    return `${m}분 전 저장됨`;
  })();

  const wordCount = src.trim().length === 0 ? 0 : src.trim().split(/\s+/).length;
  const readingMin = Math.max(1, Math.round(wordCount / 220));

  const copyHtml = async () => {
    const ok = await platform.clipboard.write(html);
    void platform.notify({
      text: ok ? 'HTML이 클립보드에 복사됐어요' : '복사에 실패했어요',
      tone: ok ? 'success' : 'danger',
      timeout: 1800,
    });
  };
  const copyMd = async () => {
    const ok = await platform.clipboard.write(src);
    void platform.notify({
      text: ok ? '마크다운이 복사됐어요' : '복사에 실패했어요',
      tone: ok ? 'success' : 'danger',
      timeout: 1800,
    });
  };

  const loadTemplate = (id: string) => {
    const tpl = TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;
    if (src.trim().length > 0 && !confirm(`현재 내용을 "${tpl.label}"로 바꿀까요?`)) return;
    setSrc(tpl.body);
    void platform.notify({ text: `"${tpl.label}" 템플릿 로드`, tone: 'info', timeout: 1500 });
  };

  // Toolbar action: wrap or prefix the current selection.
  const surroundSelection = (before: string, after = before, blockPrefix?: string) => {
    const ta = editorRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const value = ta.value;
    const sel = value.slice(start, end);
    let next: string;
    let cursorAt: number;
    if (blockPrefix !== undefined) {
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      next = value.slice(0, lineStart) + blockPrefix + value.slice(lineStart);
      cursorAt = end + blockPrefix.length;
    } else {
      next = value.slice(0, start) + before + sel + after + value.slice(end);
      cursorAt = end + before.length + after.length;
    }
    setSrc(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(cursorAt, cursorAt);
    });
  };

  const tools = [
    { id: 'bold',    label: 'B',   title: '굵게 (⌘B)',   onClick: () => surroundSelection('**'), style: { fontWeight: 700 } },
    { id: 'italic',  label: 'I',   title: '기울임 (⌘I)', onClick: () => surroundSelection('*'),  style: { fontStyle: 'italic' as const } },
    { id: 'strike',  label: 'S',   title: '취소선',       onClick: () => surroundSelection('~~'), style: { textDecoration: 'line-through' as const } },
    { id: 'code',    label: '</>', title: '인라인 코드',  onClick: () => surroundSelection('`'),  style: { fontFamily: 'var(--font-mono)' } },
    { id: 'h1',      label: 'H1',  title: '제목 1',       onClick: () => surroundSelection('', '', '# ') },
    { id: 'h2',      label: 'H2',  title: '제목 2',       onClick: () => surroundSelection('', '', '## ') },
    { id: 'link',    label: '🔗',  title: '링크',         onClick: () => surroundSelection('[', '](https://)') },
    { id: 'quote',   label: '"',   title: '인용',         onClick: () => surroundSelection('', '', '> ') },
    { id: 'ul',      label: '•',   title: '불릿 목록',     onClick: () => surroundSelection('', '', '- ') },
    { id: 'task',    label: '☐',   title: '할 일',         onClick: () => surroundSelection('', '', '- [ ] ') },
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (document.activeElement !== editorRef.current) return;
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); surroundSelection('**'); }
      else if (k === 'i') { e.preventDefault(); surroundSelection('*'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gridTemplateColumns = (effectiveOutline ? '180px ' : '') + (effectiveView === 'split' ? '1fr 1fr' : '1fr');

  return (
    <section
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        overflow: 'hidden',
        color: 'var(--text)',
        fontFamily: 'var(--font-sans, -apple-system, system-ui, sans-serif)',
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: '12px 16px',
          background: 'var(--bg-rail, transparent)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>📄</span>
        <Text weight="semibold" size="md">Markdown</Text>
        {hosted && !narrow && (
          <Pill tone="success" size="sm" style={{ letterSpacing: '0.04em' }}>SDK CONNECTED</Pill>
        )}
        <Text size="xs" tone="muted" mono>
          {src.length}자 · {wordCount}단어{narrow ? '' : ` · 약 ${readingMin}분`}
        </Text>
        {savedLabel && (
          <Text size="xs" tone="dim" aria-live="polite" style={{ letterSpacing: '0.02em' }}>
            {savedLabel}
          </Text>
        )}
        <div style={{ flex: 1 }} />
        {!narrow && (
          <Menu placement="bottom-end">
            <Menu.Trigger>
              <Button size="sm">템플릿 ▾</Button>
            </Menu.Trigger>
            <Menu.Items>
              {TEMPLATES.map((t) => (
                <Menu.Item key={t.id} onSelect={() => loadTemplate(t.id)}>
                  {t.label}
                </Menu.Item>
              ))}
            </Menu.Items>
          </Menu>
        )}
        <Segmented<ViewMode>
          value={effectiveView}
          onChange={setView}
          options={
            narrow
              ? [{ value: 'edit', label: '편집' }, { value: 'preview', label: '미리보기' }]
              : [
                  { value: 'edit', label: '편집' },
                  { value: 'split', label: '나란히' },
                  { value: 'preview', label: '미리보기' },
                ]
          }
          size="sm"
          aria-label="View"
        />
        {!narrow && (
          <Button
            size="sm"
            variant={showOutline ? 'primary' : 'secondary'}
            onClick={() => setShowOutline((s) => !s)}
            title="목차 토글"
          >
            ☰
          </Button>
        )}
      </header>

      {/* Toolbar */}
      <div
        style={{
          padding: '6px 10px',
          background: 'var(--bg-rail, transparent)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          flexWrap: 'wrap',
        }}
      >
        {tools.map((t) => (
          <Button
            key={t.id}
            size="sm"
            variant="secondary"
            title={t.title}
            onClick={t.onClick}
            style={{ minWidth: 28, ...(t.style ?? {}) }}
          >
            {t.label}
          </Button>
        ))}
        <span style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 6px' }} />
        <Button size="sm" variant="ghost" onClick={copyMd} title="원본 마크다운을 클립보드에 복사">
          MD 복사
        </Button>
        <Button size="sm" variant="ghost" onClick={copyHtml} title="렌더된 HTML을 클립보드에 복사">
          HTML 복사
        </Button>
      </div>

      {/* Body */}
      <div style={{ display: 'grid', gridTemplateColumns, minHeight: narrow ? 320 : 420 }}>
        {effectiveOutline && <Outline headings={headings} />}
        {(effectiveView === 'split' || effectiveView === 'edit') && (
          <textarea
            ref={editorRef}
            value={src}
            onChange={(e) => setSrc(e.target.value)}
            spellCheck={false}
            style={{
              border: 'none',
              outline: 'none',
              padding: narrow ? '14px 16px' : '18px 20px',
              fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)',
              fontSize: 13,
              lineHeight: 1.65,
              resize: 'none',
              minHeight: narrow ? 320 : 420,
              background: 'var(--bg)',
              color: 'var(--text)',
              borderLeft: effectiveOutline ? '1px solid var(--border)' : 'none',
            }}
            placeholder="여기에 마크다운을 입력하세요…"
          />
        )}
        {(effectiveView === 'split' || effectiveView === 'preview') && (
          <Preview html={html} hasEditor={effectiveView === 'split'} mobile={narrow} />
        )}
      </div>
    </section>
  );
}

/* ─── Sub-components ─── */

function Outline({ headings }: { headings: MdHeading[] }) {
  return (
    <aside
      style={{
        background: 'var(--bg-rail, transparent)',
        borderRight: '1px solid var(--border)',
        padding: '14px 12px',
        overflowY: 'auto',
        maxHeight: 540,
      }}
    >
      <Stack align="center" gap="sm" style={{ marginBottom: 8 }}>
        <Text size="xs" weight="semibold" tone="muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          목차
        </Text>
        <Text size="xs" tone="dim" mono>{headings.length}</Text>
      </Stack>
      {headings.length === 0 ? (
        <Text size="xs" tone="dim" style={{ padding: '4px 6px' }}>
          제목(# / ##)을 추가하면 여기에 표시됩니다.
        </Text>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {headings.map((h, i) => (
            <li key={i}>
              <a
                href={`#${h.id}`}
                style={{
                  display: 'block',
                  padding: '4px 6px',
                  paddingLeft: 6 + (h.level - 1) * 10,
                  fontSize: 11.5,
                  color: 'var(--text-mid)',
                  textDecoration: 'none',
                  borderRadius: 4,
                  lineHeight: 1.4,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-mid)'; }}
              >
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function Preview({ html, hasEditor, mobile = false }: { html: string; hasEditor: boolean; mobile?: boolean }) {
  return (
    <div
      style={{
        padding: mobile ? '14px 16px' : '18px 24px',
        borderLeft: hasEditor ? '1px solid var(--border)' : 'none',
        background: 'var(--bg-panel)',
        overflow: 'auto',
        color: 'var(--text)',
        fontSize: 13.5,
        lineHeight: 1.7,
        maxHeight: mobile ? undefined : 540,
      }}
      className="md-preview"
      ref={(el) => {
        if (!el) return;
        while (el.firstChild) el.removeChild(el.firstChild);
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.body.childNodes.forEach((n) => el.appendChild(n.cloneNode(true)));
      }}
    />
  );
}
