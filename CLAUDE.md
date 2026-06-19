# CLAUDE.md

## プロジェクト概要

- **名前**: `growi-plugin-table-extended`
- **種別**: GROWI Script プラグイン
- **目的**: GROWI ページ本文中の Markdown テーブルのヘッダーをクリックして列ソートでき、キーワードで行をフィルタできるようにする

### 確定仕様

| 項目 | 内容 |
|---|---|
| 対象 | ページ本文中の `<table>`（`thead > tr > th` を持つもの） |
| 操作 | 各 `th` クリックで該当列を asc → desc → 元の順 にトグル |
| データ型推定 | 数値（カンマ区切り対応）→ ISO 日付 → 文字列の順で判定し列単位で固定 |
| 同時ソート | 1 テーブル内で 1 列のみ（他列クリックで切替） |
| 視覚表現 | sortable な `th` の矢印は CSS `::after` 疑似要素（⇅ → ▲ → ▼）、`aria-sort` 属性、`cursor:pointer`、`color-mix` 由来のホバー背景 |
| 視覚スタイル | `table.gpte-enhanced` に対し角丸ボーダー・ヘッダー背景（`--bs-primary`）・偶数行ストライプ・行ホバーを `color-mix(--bs-primary, base)` で付与。CSS 変数で light/dark を切替 |
| ダークモード | `@media (prefers-color-scheme: dark)` と `html[data-bs-theme="dark"]`（Bootstrap 5.3 GROWI UI トグル）の双方で CSS 変数を上書き |
| 元順保持 | 初期化時に各 `<tr>` へ `data-gpte-original-index` を付与し、3 回目クリックで復元 |
| フィルタ | テーブル上部に検索ボックス 1 つ。全列対象・大小文字無視の部分一致。スペース区切りで AND 絞り込み |
| マッチハイライト | フィルタ一致テキストを `<mark class="gpte-mark">` で wrap し背景色強調。クエリ空で全解除。textNode 単位のため `<strong>` 等のインライン要素を跨ぐマッチは描画されない（行表示判定は従来通り `textContent` 全体で機能）。印刷時は背景を透明化 |
| 行数カウント | フィルタ入力中のみテーブル下部に「M / N 件」を表示（空クリアで非表示） |
| 適用除外 | `thead` なし / `th` 0 個 / `data-no-sort` 属性付きテーブル / 既に `data-gpte-enhanced` 付き |
| フィルタ除外 | `data-no-filter` 属性付きテーブルではフィルタ UI のみ非表示（ソートは有効） |
| スティッキーヘッダー | スクロール時に `thead` を画面上部に固定。GROWI ナビバー（`NAVBAR_SELECTORS` 優先順で検出）の高さを JS が自動取得し `--gpte-sticky-top` を inline style で設定。`ResizeObserver` でナビバー高さの変化に動的追従。手動上書きは CSS 変数 `--gpte-sticky-top` で可能（デフォルト `0px`）。固定時に薄い下方向 `box-shadow` を付与 |
| スティッキー除外 | `data-no-sticky` 属性付きテーブルでは sticky を無効化（ソート/フィルタは有効） |
| 非表示条件 | 編集モード（`/edit`, `#edit`, `body.editing`, `body.modal-open`）・管理画面（`/admin`）・印刷時は矢印・フィルタ UI 非表示かつソート無効。印刷時はスティッキーも解除 |
| SPA 遷移 | `pushState` / `replaceState` モンキーパッチ + `popstate` + `hashchange` で再スキャン |
| 新規テーブル追加 | `MutationObserver`（`childList: true, subtree: true`）で `<table>` 追加を検知して自動初期化 |
| deactivate | 全 listener 解除・MutationObserver.disconnect・ResizeObserver.disconnect・モンキーパッチ復元・付与した `gpte-enhanced` / `gpte-sortable` / `gpte-sorted-*` / `gpte-row-odd` / `gpte-row-even` クラスと `aria-sort` / `data-gpte-*` 属性を全削除・フィルタ UI 削除・行の `display` / 行順を復元 |

## アーキテクチャ

このプラグインは Markdown レンダリングの拡張ではなく **DOM 直接操作** を行う。`customGenerateViewOptions` は使わず、`activate()` 内で既存テーブルをスキャンして機能を注入し、`MutationObserver` で動的追加にも追従する。

### ファイル構成

```
growi-plugin-table-extended/
├── client-entry.tsx                    # activate / deactivate + pluginActivators 登録
├── src/
│   ├── tableExtended.ts               # コア実装（スキャン・ソート・フィルタ・SPA 遷移・クリーンアップ）
│   ├── types.ts                        # Window 型の最小宣言
│   └── styles/tableExtended.css       # sortable th スタイル・矢印 (::after)・テーブル視覚スタイル・ダークモード・@media print
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts                      # build.manifest: 'manifest.json' を明示
├── pnpm-workspace.yaml                 # approve-builds で自動生成（コミット必須）
└── dist/                               # ビルド成果物（コミット必須）
    ├── manifest.json
    └── assets/
        ├── client-entry-*.js
        └── client-entry-*.css
```

### 主要な実装ポイント

**`createTableExtended()`** が公開 API で `{ mount, unmount }` を返す。

- **`scanAndEnhance()`**: `document.querySelectorAll('table')` でページ上の全テーブルをスキャンし、対象判定をパスしたものに `enhanceTable()` を呼ぶ。`isHiddenContext()` が true の場合は何もしない。
- **`enhanceTable(table)`**: 各 `th` に `data-gpte-col` / `aria-sort` / `.gpte-sortable` を付与（矢印は CSS `::after` で描画するため span 挿入は行わない）。`tbody > tr` 全件に `data-gpte-original-index` を付与。イベントはクリック委譲で `thead` に 1 つだけ登録し、`WeakMap` に参照を保持。テーブルに `data-gpte-enhanced="1"` と `.gpte-enhanced` クラスを付与して二重初期化を防ぎ、視覚スタイル（CSS `table.gpte-enhanced` セレクタ）を適用する。`data-no-sticky` がなければ `.gpte-sticky-head` クラスを追加してスティッキーヘッダーを有効化する（CSS `table.gpte-enhanced.gpte-sticky-head thead th` セレクタで `position: sticky` 適用）。`data-no-filter` がなければフィルタバー（`[data-gpte-filter-bar]`）を table の直前の sibling として、カウントフッター（`[data-gpte-filter-footer]`）を直後の sibling として挿入し、`FilterRefs` を `WeakMap` で table に紐付ける。最後に `restripeRows()` を呼んで全行に `gpte-row-odd` / `gpte-row-even` クラスを付与する。
- **`sortRows(table, colIdx, dir)`**: `tbody > tr` を配列化し、列値から `detectColumnType()` で数値 / 日付 / 文字列を判定。比較関数でソートして DocumentFragment で再 append。`dir === 'none'` は `data-gpte-original-index` 昇順で復元。各行の `style.display`（フィルタによる非表示状態）は inline style として保持されるため、ソート後も非表示が維持される。再 append 後に `restripeRows()` を呼んで、新しい DOM 順に基づいて表示中の行へ `gpte-row-odd` / `gpte-row-even` を振り直す。
- **`applyFilter(table, query)`**: クエリを空白で分割してトークン化し、`tbody > tr` 全行の `textContent` に対して全トークンが含まれる行のみ `display: ''`、それ以外を `display: 'none'` にする。空クエリ時は全行を復元。処理後に `restripeRows()` で表示中の行に `gpte-row-odd` / `gpte-row-even` を振り直し（CSS `:nth-child` は非表示行も数えるため、この再計算でフィルタ後のストライプ崩れを防ぐ）、`updateFilterFooter()` を呼んでカウントを更新。
- **`updateFilterFooter(footer, query, visible, total)`**: クエリが空なら `footer.hidden = true`。非空なら `footer.hidden = false` にして `textContent` を「M / N 件」形式で書き込む（`innerHTML` は使わない）。
- **`cleanupTable(table)`**: `filterRefs` WeakMap からフィルタ UI の参照を取り出し、input の `'input'` イベントを解除してバー・フッターを `.remove()`。`tbody > tr` の `style.display` を全て `''` に戻し、`gpte-row-odd` / `gpte-row-even` クラスを除去してから `data-gpte-original-index` 昇順で行を復元。付与した属性・クラス（`gpte-sortable` / `gpte-sorted-*`）を全 `th` から削除。`thead` のクリックハンドラを `WeakMap` から取り出して `removeEventListener`。テーブルから `data-gpte-enhanced` 属性・`.gpte-enhanced` クラス・`.gpte-sticky-head` クラスをまとめて削除して視覚スタイルとスティッキーを解除する。
- **`findNavbarEl()`**: `NAVBAR_SELECTORS` を上から順に試し、`offsetHeight > 0` の要素を返す。見つからなければ `null`。`getNavbarHeight()` はこれを内部で呼んで高さのみを返すラッパー。
- **ResizeObserver（`navbarObserver`）**: `mount()` 時に `findNavbarEl()` でナビバー要素を取得し、見つかった場合は `ResizeObserver` をアタッチ。ナビバーのサイズ変化のたびに `table[data-gpte-enhanced].gpte-sticky-head` 全件の `--gpte-sticky-top` を `style.setProperty` で更新する。`unmount()` で `navbarObserver.disconnect()` してクリーンアップ。
- **SPA 遷移検知**: `pushState` / `replaceState` にカスタムイベント `'growi-pte-navigate'` をモンキーパッチ。`popstate` / `hashchange` も購読し、いずれも 2 段 `requestAnimationFrame` で DOM が安定してから `scanAndEnhance()` を実行。
- **MutationObserver**: `document.body` を `childList: true, subtree: true, attributes: true, attributeFilter: ['class']` で監視。新しい `<table>` 追加時は `scheduleScan()` を呼ぶ。`body.class` 変化時（編集モード遷移）は `isHiddenContext()` を判定し、true（編集モードへ移行）なら enhance 済みテーブルを即 `cleanupTable` し、false（閲覧モードへ復帰）なら `scheduleScan()` を呼ぶ。
- **編集モード判定**: `location.hash === '#edit'` / `pathname.endsWith('/edit')` / `body.classList.contains('editing')` / `body.classList.contains('grw-editor-mode')` / `body.classList.contains('modal-open')`（GROWI テーブル編集モーダル）のいずれかで判定。
- **データ型推定**: `detectColumnType(values)` で列全セルを見て all-numeric（カンマ除去後）→ all-date（`YYYY-MM-DD` or `YYYY/MM/DD` パターン）→ 文字列の優先順で判定。

## ハマりどころ (必読)

### 1. `dist/` を git にコミットすること

GROWI はプラグインインストール時に **`pnpm install` も `pnpm build` も実行しない**。GitHub の archive zip を展開し、`dist/` 配下を Express で静的配信するだけ。

→ `.gitignore` に `dist/` を含めると GROWI 側で JS が読み込まれない。`dist/` は必ずコミットすること。

(根拠: `weseek/growi` の `apps/app/src/features/growi-plugin/server/services/growi-plugin/growi-plugin.ts` 内 `install()` / `retrievePluginManifest()`)

### 2. Vite のマニフェスト出力先

GROWI が読みに行く manifest のパスは以下の順で fallback:

1. `dist/.vite/manifest.json` (Vite 5 デフォルト)
2. `dist/manifest.json` (Vite 4 互換 / 明示設定時)

Vite 5+ では `vite.config.ts` で `build.manifest: 'manifest.json'` を明示してプロジェクト直下風のパスに出力するのが無難。

```ts
export default defineConfig({
  plugins: [react()],
  build: {
    manifest: 'manifest.json',
    rollupOptions: { input: ['/client-entry.tsx'] },
  },
});
```

### 3. pnpm のビルドスクリプト承認 (pnpm 11+ では別対応が必要)

`esbuild` (Vite 依存) はインストール時にビルドスクリプト (`postinstall` の `node install.js`) を実行する必要があるが、pnpm はデフォルトでブロックする。

**pnpm 8〜10**: `package.json` の `pnpm.onlyBuiltDependencies` で明示する。

**pnpm 11+**: 上記設定は無視される。初回 `pnpm install` 後に以下のエラーが出る:

```
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@X.Y.Z
```

解決手順:

1. `pnpm approve-builds --all` を実行
2. `pnpm-workspace.yaml` が自動生成される（**git にコミットすること**）
3. 再度 `pnpm install` を実行して esbuild の postinstall を完了させる

### 4. 再インストールが必要

コード更新を push しても、GROWI 管理画面で「有効/無効トグル」だけでは zip が取り直されない。確実に反映するには `/admin/plugins` で **削除 → 再インストール**。

### 5. 編集モード終了後の再スキャン

`body.classList` の変化を MutationObserver で検知するには `attributes: true, attributeFilter: ['class']` が必要（デフォルトの `attributes: false` では検知されない）。

また Edit → View 遷移で `location.hash` のみが変わる場合、`pushState` のモンキーパッチは発火しない。`hashchange` イベントの購読が必須。

### 6. `th` 内の矢印は CSS `::after` で描画する（`<span>` 禁止）

GROWI 標準のテーブルは `th` 上に編集ボタン（鉛筆アイコン）を絶対配置で重ねている。`th` に `position: relative` + 子 `<span>`（矢印）を入れるとスタッキングコンテキストが変わり、そのレイヤが編集ボタンを覆って押せなくなる（コミット `80ed36e` / `aa66aa5` で対処した既知の不具合）。

解決策：`<span>` は一切挿入せず、`th.gpte-sortable::after { content: '⇅' }` で矢印を描画する。`th` の `position` も明示しない。`gpte-sortable` / `gpte-sorted-asc` / `gpte-sorted-desc` クラスのトグルだけでソート状態を表示する。

### 7. ゼブラストライプは CSS `:nth-child` でなく JS クラスで管理する

CSS の `tr:nth-child(odd/even)` は `display: none` の行も子要素としてカウントする。フィルタで一部行を非表示にすると、表示中の行の odd/even が崩れて同じ背景色が連続する。

解決策：`gpte-row-odd` / `gpte-row-even` クラスを JS で付与し、行の表示状態・並び順が変わるたびに `restripeRows()` で振り直す（初期化・ソート・フィルタの各タイミングで呼び出し）。CSS セレクタは `tr.gpte-row-odd td` / `tr.gpte-row-even td` とする。

### 8. フィルタ UI は `<table>` を wrapper で包まず sibling として挿入する

フィルタバー・カウントフッターをテーブルと親子関係にしたい場合、`<table>` を `<div>` で包む（wrap）実装が思い浮かぶが、**GROWI のページレイアウトで table の親要素のスタイルに依存している箇所** を壊すリスクがある。

また、MutationObserver の childList 監視で「追加ノードが `table` かその子孫に `table` を持つか」を判定しているため、filter 用 div を挿入する際に `el.querySelector('table')` がヒットしてしまい無限スキャンループが起きる恐れがある。

解決策：`table.insertAdjacentElement('beforebegin', bar)` と `table.insertAdjacentElement('afterend', footer)` で sibling として挿入する。filter 用 div は `<table>` を含まないため MutationObserver の再スキャン判定をすり抜ける。cleanup は `.remove()` 一発で完了。

### 9. ハイライトは textNode 単位で行う（HTML 全体に対する正規表現 replace を使わない）

セル内 HTML を `innerHTML` で書き換える方式は XSS リスクと既存リンクのイベント破壊が起きる。`TreeWalker(SHOW_TEXT)` で textNode を 1 つずつ走査し、`splitText` で範囲を切り出して `createElement('mark')` で wrap する。

再フィルタ時は `mark.gpte-mark` を `replaceWith(...childNodes)` で外し、親要素に `normalize()` を呼んで隣接 textNode を統合する（これがないと次回の `indexOf` 位置がズレる）。

textNode の境界を跨ぐマッチ（例: `<strong>東京</strong>都` で「東京都」を検索）はハイライトが付かない制約がある。行の表示判定は `row.textContent` 全体を見るため、マッチした行は正しく表示される。

## デプロイ手順

```bash
pnpm build              # dist/ を更新
git add src/ dist/ ...  # 変更ファイルを staging
git commit -m "..."
git push
```

GROWI 管理画面 `/admin/plugins` で **削除 → 再インストール**。

## 動作確認チェックリスト

1. `pnpm build` が成功し `dist/manifest.json` が出力される
2. GROWI で削除 → 再インストール後、DevTools Network で `client-entry-*.js` が 200 で取得される
3. テーブル付きページで `th` をクリックすると ⇅ → ▲（昇順）→ ▼（降順）→ ⇅（復元）に変化する
4. 数値列（カンマ区切り含む）が文字列順ではなく数値順でソートされる
5. ISO 日付列が時系列でソートされる
6. 別 `th` をクリックすると前の列の矢印がリセットされ新しい列でソートされる
7. SPA 遷移後、新ページのテーブルも自動的にソート可能化される
8. 編集モード中は `th` クリックしてもソートが効かない（矢印が出ない）
9. 編集モード終了後にテーブルが自動でソート可能化される
10. 管理画面（`/admin`）ではソートが無効化される
11. 印刷プレビューで矢印が非表示になる
12. プラグイン無効化で全テーブルが元の状態（矢印・class・行順）に完全復元される
13. ダークモード切替（OS 設定 / GROWI UI トグル）でテーブルの配色が追従する
14. テーブル編集モーダルを開いている間は矢印・スタイルが消え、編集ボタンが正常に押せる
15. テーブル編集モーダルを閉じた後、自動でソート可能・スタイル付き状態に戻る
16. テーブル上部の検索ボックスにキーワードを入力すると、含む行のみ表示される
17. スペース区切りで複数キーワードを入力すると AND で絞り込まれる（「東京 2025」など）
18. 大文字・小文字を無視してマッチする（「TOKYO」「tokyo」が同じ結果）
19. フィルタ入力中はテーブル下に「M / N 件」が表示され、クリアすると非表示になる
20. フィルタ後ソート → 非表示行は非表示のまま。ソート後フィルタ → 行の並び順は維持される
21. `<table data-no-filter>` 属性付きテーブルではフィルタ UI が表示されない（ソートは有効）
22. 編集モード移行時はフィルタ UI も消え、閲覧モード復帰で再表示される
23. プラグイン無効化でフィルタ UI 削除・全行の `display` が復元される
24. 印刷プレビューでフィルタ入力欄・行数カウントが非表示になる
25. 縦長テーブルを下にスクロールしたとき、`thead` が画面上部に固定されたまま見え続ける
26. 固定中の `thead` に薄い下方向の影（`box-shadow`）が表示される
27. GROWI ナビバーの高さが自動検出され、ヘッダーがナビバーの直下に固定される
28. ナビバーの高さが動的に変化した場合（展開/折りたたみ等）も固定位置が追従する
29. `--gpte-sticky-top: 60px` を CSS で指定すると自動検出を上書きして 60px 下に固定される
30. `<table data-no-sticky>` 属性付きテーブルでは sticky にならない（ソート/フィルタは有効）
31. 編集モード移行時は sticky も解除され、閲覧モード復帰で再度固定される
32. 印刷プレビューでスティッキーが解除され（`position: static`）、影も消える
33. プラグイン無効化で `gpte-sticky-head` クラスが全テーブルから削除される
34. フィルタ入力でマッチした `td` 内テキストが黄色（warning 系）背景でハイライトされる
35. 複数トークン（「東京 2025」）入力で、各トークンの該当箇所がすべてハイライトされる
36. 大文字小文字混在クエリで同じ箇所がハイライトされる（「Tokyo」「TOKYO」「tokyo」）
37. クエリをクリアすると `<mark>` が消えセルが元の DOM 状態に戻る
38. クエリを連続変更しても前回のハイライトが残らず、`<mark>` がネストしない
39. `<th>` 内のヘッダーテキストはハイライトされない（編集ボタンが従来通り押せる）
40. `<a>` 内テキストがマッチしてもリンクは有効なまま（クリック可）
41. ハイライト中にソートしても `<mark>` は維持され、ソート結果が正しい
42. ダークモード（OS / GROWI UI トグル両方）でハイライトのコントラストが保たれる
43. 印刷プレビューでハイライト背景が消え、テキストのみ印字される
44. プラグイン無効化で全テーブルから `<mark class="gpte-mark">` が消え、textContent が完全に元通り
45. 編集モード遷移でハイライトが消え、復帰後の新規フィルタで再付与される

## 会話ガイドライン

- 常に日本語で会話する

## 作業ルール

- **git 操作は行わない**。`git add` / `git commit` / `git push` / `git restore` / `git checkout` などの git コマンドは一切実行しないこと。コミットやプッシュが必要な場面ではユーザーに依頼し、こちらでは行わない。
  - 変更内容のサマリだけ提示し、コミットメッセージ案を出す程度に留める。
  - 例外として `git status` / `git log` / `git diff` などの**読み取り専用**コマンドは状況把握のために実行してよい。

- **セキュリティチェックを必ず行う**。コード変更を完了したら、コミット候補としてユーザーに提示する前に以下を確認すること。問題が見つかった場合はその場で修正するか、ユーザーに明示的に報告する。
  - **機密情報の混入**: API キー / トークン / パスワード / 秘密鍵 / `.env` 系ファイルの値が、ソースコード・コメント・`dist/` 配下のビルド成果物に含まれていないか。
  - **XSS / 危険な HTML 挿入**: ユーザー入力を `dangerouslySetInnerHTML`・`innerHTML` で未エスケープで埋め込んでいないか。DOM 操作は `createElement` + `setAttribute` のみを使うこと。
  - **外部通信**: 外部 URL に対する `fetch` / `XMLHttpRequest` を新規追加していないか。
  - **依存パッケージの脆弱性**: 新規追加した npm パッケージは `pnpm audit` を実行して確認する。
  - **CSP / 外部リソース**: `<script>` / `<link>` を動的挿入して外部ドメインから読み込む実装になっていないか。自己完結なバンドルにすること。
