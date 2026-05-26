import { useEffect, useMemo, useRef, useState } from 'react';
import { platform } from '../platform';

// Module-local narrow-viewport hook — modules deploy independently from the
// host, so we don't share `useIsMobile`.
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

/* ─── Templates ─── */

const TEMPLATES: { id: string; label: string; body: string }[] = [
  {
    id: 'blank',
    label: '빈 문서',
    body: '',
  },
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

interface Heading { level: number; text: string; id: string; }

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function mdToHtml(md: string): { html: string; headings: Heading[] } {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  const headings: Heading[] = [];
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

    // task list (- [ ] / - [x])
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
  // On narrow viewports there isn't room for a side-by-side editor + preview
  // *and* a sidebar outline, so we force-collapse split → edit and outline off.
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

  // Tick a "saved Ns ago" label so the user has feedback that the autosave
  // pipeline is alive. Only re-runs while a save has happened.
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
    { id: 'strike',  label: 'S',   title: '취소선',       onClick: () => surroundSelection('~~'), style: { textDecoration: 'line-through' } },
    { id: 'code',    label: '</>', title: '인라인 코드',  onClick: () => surroundSelection('`'),  style: { fontFamily: 'var(--font-mono)' } },
    { id: 'h1',      label: 'H1',  title: '제목 1',       onClick: () => surroundSelection('', '', '# ') },
    { id: 'h2',      label: 'H2',  title: '제목 2',       onClick: () => surroundSelection('', '', '## ') },
    { id: 'link',    label: '🔗',  title: '링크',         onClick: () => surroundSelection('[', '](https://)') },
    { id: 'quote',   label: '"',   title: '인용',         onClick: () => surroundSelection('', '', '> ') },
    { id: 'ul',      label: '•',   title: '불릿 목록',     onClick: () => surroundSelection('', '', '- ') },
    { id: 'task',    label: '☐',   title: '할 일',         onClick: () => surroundSelection('', '', '- [ ] ') },
  ];

  /* Keyboard shortcuts */
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

  return (
    <section
      style={{
        background: 'var(--bg-panel, #fff)',
        border: '1px solid var(--border, #e3e3eb)',
        borderRadius: 14,
        overflow: 'hidden',
        color: 'var(--text, #1a1a1a)',
        fontFamily: 'var(--font-sans, -apple-system, system-ui, sans-serif)',
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: '12px 16px',
          background: 'var(--bg-rail, #fafafa)',
          borderBottom: '1px solid var(--border, #eee)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>📄</span>
        <strong style={{ fontSize: 14, fontWeight: 600 }}>Markdown</strong>
        {hosted && !narrow && <SdkBadge />}
        <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }} className="tabular">
          {src.length}자 · {wordCount}단어{narrow ? '' : ` · 약 ${readingMin}분`}
        </span>
        {savedLabel && (
          <span
            style={{ color: 'var(--text-dim)', fontSize: 10.5, letterSpacing: '0.02em' }}
            aria-live="polite"
          >
            {savedLabel}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {!narrow && <TemplatePicker onPick={loadTemplate} />}
        <ViewToggle value={effectiveView} onChange={setView} mobile={narrow} />
        {!narrow && (
          <button
            type="button"
            onClick={() => setShowOutline((s) => !s)}
            title="목차 토글"
            aria-pressed={showOutline}
            style={iconBtn(showOutline)}
          >
            ☰
          </button>
        )}
      </header>

      {/* Toolbar */}
      <div
        style={{
          padding: '6px 10px',
          background: 'var(--bg-rail, #fafafa)',
          borderBottom: '1px solid var(--border, #eee)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          flexWrap: 'wrap',
        }}
      >
        {tools.map((t) => (
          <button
            key={t.id}
            type="button"
            title={t.title}
            onClick={t.onClick}
            style={{
              ...toolBtn,
              ...(t.style ?? {}),
            }}
          >
            {t.label}
          </button>
        ))}
        <span style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 6px' }} />
        <button type="button" onClick={copyMd} style={toolTextBtn} title="원본 마크다운을 클립보드에 복사">
          MD 복사
        </button>
        <button type="button" onClick={copyHtml} style={toolTextBtn} title="렌더된 HTML을 클립보드에 복사">
          HTML 복사
        </button>
      </div>

      {/* Body */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: outlineWidth(effectiveOutline) + (effectiveView === 'split' ? '1fr 1fr' : '1fr'),
          minHeight: narrow ? 320 : 420,
        }}
      >
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
              background: 'var(--bg, #fff)',
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

function outlineWidth(show: boolean) {
  return show ? '180px ' : '';
}

const toolBtn: React.CSSProperties = {
  height: 26,
  minWidth: 28,
  padding: '0 8px',
  background: 'var(--bg-elev, #fff)',
  color: 'var(--text-mid, #555)',
  border: '1px solid var(--border, #ddd)',
  borderRadius: 5,
  fontSize: 11.5,
  cursor: 'pointer',
};

const toolTextBtn: React.CSSProperties = {
  ...toolBtn,
  padding: '0 10px',
  fontSize: 11.5,
};

function iconBtn(active: boolean): React.CSSProperties {
  return {
    height: 28,
    minWidth: 28,
    padding: '0 8px',
    background: active ? 'var(--accent-soft)' : 'var(--bg-elev, #fff)',
    color: active ? 'var(--accent)' : 'var(--text-mid)',
    border: `1px solid ${active ? 'transparent' : 'var(--border)'}`,
    borderRadius: 6,
    fontSize: 14,
    cursor: 'pointer',
  };
}

function SdkBadge() {
  return (
    <span
      style={{
        fontSize: 10.5,
        padding: '2px 8px',
        borderRadius: 999,
        background: 'var(--success-soft, rgba(0,180,80,0.12))',
        color: 'var(--success, #0a8a52)',
        fontWeight: 600,
        letterSpacing: '0.04em',
      }}
      title="플랫폼 SDK 연결됨"
    >
      SDK CONNECTED
    </span>
  );
}

function ViewToggle({ value, onChange, mobile = false }: { value: ViewMode; onChange: (v: ViewMode) => void; mobile?: boolean }) {
  // Hide the "split" option on narrow screens — there isn't room for it.
  const options: ViewMode[] = mobile ? ['edit', 'preview'] : ['edit', 'split', 'preview'];
  return (
    <div
      role="group"
      aria-label="View"
      style={{
        display: 'flex',
        gap: 2,
        padding: 2,
        background: 'var(--bg-elev)',
        border: '1px solid var(--border)',
        borderRadius: 7,
      }}
    >
      {options.map((v) => {
        const active = v === value;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            aria-pressed={active}
            style={{
              padding: '4px 10px',
              background: active ? 'var(--bg-panel)' : 'transparent',
              color: active ? 'var(--text)' : 'var(--text-muted)',
              border: 'none',
              borderRadius: 5,
              fontSize: 11.5,
              fontWeight: active ? 600 : 500,
              cursor: 'pointer',
              boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            {v === 'edit' ? '편집' : v === 'split' ? '나란히' : '미리보기'}
          </button>
        );
      })}
    </div>
  );
}

function TemplatePicker({ onPick }: { onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          height: 28,
          padding: '0 10px',
          background: 'var(--bg-elev)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          color: 'var(--text-mid)',
          fontSize: 11.5,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        템플릿 <span style={{ fontSize: 8 }}>▼</span>
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 9 }}
          />
          <div
            style={{
              position: 'absolute',
              top: 32,
              right: 0,
              minWidth: 180,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-strong)',
              borderRadius: 8,
              padding: 4,
              boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
              zIndex: 10,
            }}
          >
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { onPick(t.id); setOpen(false); }}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 5,
                  color: 'var(--text)',
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Outline({ headings }: { headings: Heading[] }) {
  return (
    <aside
      style={{
        background: 'var(--bg-rail, #fafafa)',
        borderRight: '1px solid var(--border)',
        padding: '14px 12px',
        overflowY: 'auto',
        maxHeight: 540,
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 8,
        }}
      >
        목차 <span className="tabular" style={{ color: 'var(--text-dim)' }}>{headings.length}</span>
      </div>
      {headings.length === 0 ? (
        <div style={{ fontSize: 11.5, color: 'var(--text-dim)', padding: '4px 6px' }}>
          제목(# / ##)을 추가하면 여기에 표시됩니다.
        </div>
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
        borderLeft: hasEditor ? '1px solid var(--border, #eee)' : 'none',
        background: 'var(--bg-panel, #fff)',
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
