# test3 — Markdown Preview (MF Platform remote)

마크다운을 실시간으로 HTML 미리보기. **MF Platform**의 host shell이 런타임에 동적으로 로드합니다.

- expose: `./App` (default export)
- MF runtime name: `markdown`
- GitHub Pages base: `/test3/` (보조 채널)
- 운영 URL: `https://mf.gonogono.org/remotes/test3/` (호스트 서버가 직접 빌드/서빙)

## 로컬에서 실행

```powershell
pnpm install
pnpm dev   # http://localhost:5180 — standalone 미리보기
```

host-shell의 `public/local-registry.json`에 이미 `markdown` 항목이 `status: "active"`로 등록되어
있어, `cd ../host-shell && pnpm dev`로 host(:5175)에 mount 가능.

## 서비스에 반영 (운영 흐름)

`pigeon9989/test3`에 `git push` → 호스트 운영자가 `bash scripts/deploy.sh` 실행 → 서버가
git pull + `vite build --base /remotes/test3/` → registry에 버전/SHA 자동 stamp.
자세한 흐름은 `docs/PUSH_REMOTES.md` 참고.

GitHub Actions는 보조 채널로 `gh-pages` branch deploy (action-less workflow).

## 보안 노트

이 모듈은 사용자 입력 markdown을 HTML로 변환합니다. XSS 위험을 막기 위해:

1. 모든 텍스트 노드는 먼저 `escapeHtml`로 이스케이프
2. 좁은 집합의 인라인 태그(`<strong>`, `<em>`, `<code>`, `<a>`)만 재도입
3. `<a href>` 는 http/https만 허용
4. `dangerouslySetInnerHTML` 미사용 → DOMParser로 안전하게 마운트

호스트 측 SDK 호출도 `platform.ts`의 host-origin handshake로 보호됩니다 (wildcard postMessage 거부).

## 처음 GitHub에 push 하기 (이미 끝남)

이미 `pigeon9989/test3`에 push되어 있습니다. 새 fork 시:

```powershell
git init
git add .
git commit -m "feat: initial scaffold for markdown remote"
git branch -M main
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

Settings → Pages → Source = "Deploy from a branch" → `gh-pages` / `(root)`로 설정.
