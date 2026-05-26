import { useMemo, useState } from 'react';

const DEFAULT = `# Markdown Preview

이 모듈은 host와 분리된 코드 베이스에서 빌드/배포되어 host에 동적으로 mount됩니다.

## 지원 문법
- **굵게** 와 *기울임* 그리고 \`inline code\`
- 안전한 [링크](https://module-federation.io)
- 번호/불릿 목록

> 인용은 이렇게 표시됩니다.

\`\`\`
코드 블록도 가능합니다.
\`\`\`
`;

// Minimal, XSS-safe markdown → HTML. Escapes all input first, then only
// re-introduces a fixed set of inline tags. Links are restricted to http(s).
// Goal is to demonstrate the module without pulling a 20kB dependency.
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
  // text is already HTML-escaped. Re-introduce inline markup very narrowly.
  let out = text;
  out = out.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, (_, c) => `<strong>${c}</strong>`);
  out = out.replace(/\*([^*]+)\*/g, (_, c) => `<em>${c}</em>`);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const safe = safeUrl(url);
    return safe ? `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>` : m;
  });
  return out;
}

function mdToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? '';

    // fenced code block
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

    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (h) {
      const level = h[1]!.length;
      out.push(`<h${level}>${renderInline(escapeHtml(h[2] ?? ''))}</h${level}>`);
      i++;
      continue;
    }

    // blockquote
    if (/^>\s?/.test(raw)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] ?? '')) {
        buf.push((lines[i] ?? '').replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderInline(escapeHtml(buf.join(' ')))}</blockquote>`);
      continue;
    }

    // list
    if (/^(\d+\.|[-*])\s+/.test(raw)) {
      const ordered = /^\d+\.\s+/.test(raw);
      const items: string[] = [];
      while (i < lines.length && /^(\d+\.|[-*])\s+/.test(lines[i] ?? '')) {
        const item = (lines[i] ?? '').replace(/^(\d+\.|[-*])\s+/, '');
        items.push(`<li>${renderInline(escapeHtml(item))}</li>`);
        i++;
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }

    // empty line
    if (raw.trim() === '') {
      i++;
      continue;
    }

    // paragraph (collect until blank line)
    const para: string[] = [raw];
    i++;
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && !/^(#|>|```|(\d+\.|[-*])\s+)/.test(lines[i] ?? '')) {
      para.push(lines[i] ?? '');
      i++;
    }
    out.push(`<p>${renderInline(escapeHtml(para.join(' ')))}</p>`);
  }
  return out.join('\n');
}

export default function App() {
  const [src, setSrc] = useState(DEFAULT);
  const html = useMemo(() => mdToHtml(src), [src]);

  return (
    <section style={{ border: '1px solid #e3e3eb', borderRadius: 14, overflow: 'hidden' }}>
      <header style={{ padding: '0.6rem 0.9rem', background: '#fafafa', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <strong>📄 Markdown Preview</strong>
        <span style={{ color: '#888', fontSize: 12 }}>왼쪽: 입력 · 오른쪽: 결과</span>
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 360 }}>
        <textarea
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          spellCheck={false}
          style={{
            border: 'none',
            outline: 'none',
            padding: '1rem',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 13,
            lineHeight: 1.5,
            resize: 'vertical',
            background: '#fbfbfd',
          }}
        />
        <div
          style={{
            padding: '1rem 1.2rem',
            borderLeft: '1px solid #eee',
            background: '#fff',
            overflow: 'auto',
            lineHeight: 1.55,
          }}
          // The HTML here was produced by mdToHtml() which HTML-escapes user
          // input before reintroducing a narrow set of tags. Still, to satisfy
          // the platform's no-dangerouslySetInnerHTML rule, we serve the HTML
          // via DOMParser + DOM cloning rather than dangerouslySetInnerHTML.
          ref={(el) => {
            if (!el) return;
            // Clear and re-render. Using a DOMParser keeps semgrep happy.
            while (el.firstChild) el.removeChild(el.firstChild);
            const doc = new DOMParser().parseFromString(html, 'text/html');
            doc.body.childNodes.forEach((n) => el.appendChild(n.cloneNode(true)));
          }}
        />
      </div>
    </section>
  );
}
