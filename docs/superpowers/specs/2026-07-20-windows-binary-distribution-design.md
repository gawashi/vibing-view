# Windows バイナリ配布 — 設計

作成日: 2026-07-20

## 目的

自作チャートアプリ Vibing View を、身内・少人数の Windows ユーザーに
配布できる形（インストーラー .exe）にする。各自が自分の FMP キーを
インストール後に設定する前提。

## 現状

- `electron-builder@26` は devDependency に導入済み。
- `postinstall: electron-builder install-app-deps` で native モジュール
  (`better-sqlite3`) の Electron ABI 再ビルドは配線済み。
- FMP API キーは `src/main/keystore.ts` でユーザーごとにランタイム保存 →
  バイナリに秘密が焼き込まれない。
- **欠けているのは electron-builder の `build` 設定のみ。** installer を
  生成する設定がまだ無い。

## 決定事項

| 項目 | 決定 | 理由 |
|------|------|------|
| 配布形式 | NSIS インストーラー (.exe) | electron-builder 既定で最も手間が少ない。ファイル1つ渡すだけ。 |
| 配布経路 | ローカルビルドのみ | 数人なので手渡しで足りる。GitHub Releases 自動化は後から足せる。 |
| コード署名 | なし | 有料証明書コスト回避。初回起動の SmartScreen 警告は身内なら口頭で回避案内。 |
| 自動更新 | なし | 新版は新 exe を配るだけ。YAGNI。 |
| アイコン | Electron 既定 | `.ico` は用意でき次第 `build.win.icon` に追加。無くてもビルド可。 |

## 実装

### package.json に `build` セクション追加

```jsonc
"build": {
  "appId": "com.gawashi.vibingview",
  "productName": "Vibing View",
  "directories": { "output": "release" },
  "files": ["out/**/*"],
  "win": { "target": "nsis" },
  "nsis": {
    "artifactName": "${name}-setup-${version}.${ext}",
    "oneClick": false,
    "perMachine": false,
    "allowToChangeInstallationDirectory": true
  }
}
```

### スクリプト追加

```jsonc
"dist": "electron-vite build && electron-builder --win"
```

### .gitignore に1行追加

```
release/
```

## フロー

`npm run dist`
→ electron-vite が `out/` を生成
→ electron-builder が native 依存を Electron ABI で再ビルド
→ `release/vibing-view-setup-0.1.0.exe` を生成
→ 手渡し配布。

## 検証（手動スモークテスト1回）

1. `npm run dist` がエラーなく完了し `release/*.exe` が生成される。
2. その exe を実行 → インストール → アプリ起動。
3. FMP キーを設定 → チャートが表示される（native の better-sqlite3 が
   正しく動いている確認）。

## スコープ外（必要になったら足す）

- コード署名 / 公証
- 自動更新 (electron-updater)
- GitHub Releases + CI 自動ビルド
- カスタムアイコン
- macOS / Linux ターゲット
