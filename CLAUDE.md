# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deployment

- **Hosting**: Cloudflare Pages (https://inzoi-map-editor.pages.dev/)
- **Production branch**: `master`
- **Server functions**: Netlify Functions in `netlify/functions/` — these handle saving data back to GitHub
- **Cloudflare Pages does NOT auto-deploy from GitHub push.** Always deploy manually after every push:
  ```bash
  WRANGLER_HOME=~/Library/Preferences/.wrangler wrangler pages deploy . --project-name=inzoi-map-editor
  ```
- `main` and `master` are unrelated branches. Always work on `master`. Keep `main` in sync by running:
  ```bash
  git push origin master:main
  ```

## Versioning

앱 버전과 변경이력은 `js/app.js` 상단의 `APP_VERSION`과 `CHANGELOG` 배열에서 관리한다. 로고 클릭 시 모달로 표시됨.

**배포 시 필수**: 코드 변경을 배포할 때마다 아래 두 가지를 반드시 함께 업데이트한다.

1. **`APP_VERSION`** — SemVer 형식 (`MAJOR.MINOR.PATCH`). 기능 추가는 MINOR, 버그 수정은 PATCH 올림.
2. **`CHANGELOG` 배열** — 최신 항목을 배열 맨 앞에 추가:
   ```js
   { ver: '1.1.0', date: 'YYYY-MM-DD', changes: ['변경 내용 1', '변경 내용 2'] },
   ```

버전 업데이트 없이 배포하지 않는다. 커밋 메시지에도 버전을 포함한다 (예: `v1.1.0: 기능 설명`).

## Architecture

Single-page vanilla JS app with no build step. The app serves static files from the repo root.

### Key files

- `js/app.js` — All frontend logic (~1,400 lines). A single `state` object holds the entire app state.
- `css/style.css` — Dark-themed CSS Grid layout (header 56px + 3 columns: 300px / 1fr / 340px).
- `data/sites.json` — Master database of ~1,000+ game sites (properties).
- `data/positions.json` — Shared map placements (committed to GitHub via server function).
- `data/memos.json` — User annotations with images (committed to GitHub via server function).
- `netlify/functions/save-positions.js`, `save-memos.js`, `get-memos.js` — Serverless functions that use `GITHUB_TOKEN` to commit JSON files back to the `master` branch.

### Data flow

1. On load: fetches `sites.json`, `positions.json`, calls `/get-memos` endpoint, loads map images from IndexedDB.
2. Local changes: saved to `localStorage` (`inzoi_map_data_v2`) and IndexedDB (map images).
3. Shared changes: "위치 저장" button POSTs to `/save-positions` → Netlify function commits `data/positions.json` to GitHub. Same pattern for memos.

### State structure

```js
state = {
  city: "Gangnam" | "RedCity" | "Cahaya",
  sites: [...],           // loaded from sites.json
  memos: { Gangnam: [], RedCity: [], Cahaya: [] },
  maps: {
    Gangnam: { imageData, positions: { siteId: {x, y} }, panX, panY, zoom },
    ...
  }
}
```

### Cities

- `Gangnam` → "도원"
- `RedCity` → "블리스베이"
- `Cahaya` → "차하야"

### Site types

`Residence`, `Business`, `Public`, `Override` — each rendered with different colors/icons on the map.
