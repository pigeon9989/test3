# test3 — Markdown Preview (MF Platform remote)

마크다운을 실시간으로 HTML 미리보기. **MF Platform**의 host shell이 런타임에 동적으로 로드합니다.

- expose: `./App` (default export)
- MF runtime name: `markdown`
- GitHub Pages base: `/test3/`

## 로컬에서 실행

```powershell
pnpm install
pnpm dev   # http://localhost:5180 — standalone 미리보기
```

## 처음 GitHub에 push 하기

```powershell
git init
git add .
git commit -m "feat: initial scaffold for markdown remote"
git branch -M main
git remote add origin https://github.com/pigeon9989/test3.git
git push -u origin main
```

## GitHub Pages 활성화

저장소 Settings → Pages → **Source: GitHub Actions**.

배포 URL: `https://pigeon9989.github.io/test3/`

## 보안 노트

이 모듈은 사용자 입력 markdown을 HTML로 변환합니다. XSS 위험을 막기 위해:

1. 모든 텍스트 노드는 먼저 `escapeHtml`로 이스케이프
2. 좁은 집합의 인라인 태그(`<strong>`, `<em>`, `<code>`, `<a>`)만 재도입
3. `<a href>` 는 http/https만 허용
4. `dangerouslySetInnerHTML` 미사용 → DOMParser로 안전하게 마운트

## host에 등록

host-shell의 `public/local-registry.json`에서 `markdown` 항목 status를 `active`로.
