# From Visual Novel

ノベルゲームを登録し、プレイ時間を自動計測、プレイ中は常時最前面の拡張UI（Recorder Panel）を表示するWindows向けデスクトップアプリ（MVP）。

## 開発

```bash
npm install
npm run dev
```

## ビルド（配布用インストーラ）

```bash
npm run dist
```

`electron-builder.yml` の `publish.owner` / `publish.repo` を実際のGitHubリポジトリに合わせて変更してください。

Windowsで `npm run dist` がシンボリックリンク作成エラーで失敗する場合は、以下のいずれかが必要です。

- Windows の「開発者モード」を有効化する（設定 → プライバシーとセキュリティ → 開発者向け）
- 管理者権限のターミナルで実行する

## 現在のスコープ（MVP）

- ゲーム登録（手動入力）・ライブラリ一覧
- Playボタンからの起動とプレイ時間の自動計測
- プレイ中の常時最前面オーバーレイ（経過時間・一時停止・スクリーンショット）

以下は未実装（今後のフェーズ）:

- ヒロイン/ルート別プレイ時間管理・円グラフ
- プレイログ（イベントタイムライン）
- プレイ予定カレンダー
- ErogeScape / VNDB 連携によるメタデータ自動取得
