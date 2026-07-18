// フロアマップ 予約公開チェックスクリプト
// scheduled/ 配下のジョブ票(JSON)を確認し、公開時刻(JST)を過ぎていれば
// 対象パスへ配置します。壊れたジョブは failed/ へ退避し、他のジョブの処理は継続します。
import fs from 'fs';
import path from 'path';

const SCHED_DIR = 'scheduled';
const FAILED_DIR = 'failed';

function listJobManifests(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json') && !name.includes('--'))
    .map((name) => path.join(dir, name));
}

function quarantine(manifestPath, job, reason) {
  fs.mkdirSync(FAILED_DIR, { recursive: true });
  const base = path.basename(manifestPath, '.json');
  const failedManifest = path.join(FAILED_DIR, base + '.json');
  if (fs.existsSync(manifestPath)) fs.renameSync(manifestPath, failedManifest);
  if (job && Array.isArray(job.files)) {
    for (const f of job.files) {
      if (!f || !f.storedName) continue;
      const src = path.join(SCHED_DIR, f.storedName);
      if (fs.existsSync(src)) fs.renameSync(src, path.join(FAILED_DIR, f.storedName));
    }
  }
  fs.writeFileSync(path.join(FAILED_DIR, base + '.error.txt'), String(reason), 'utf-8');
}

function safeTargetPath(targetPath) {
  const norm = path.normalize(targetPath).replace(/^([/\\])+/, '');
  if (norm.split(/[/\\]/).includes('..') || path.isAbsolute(norm)) {
    throw new Error('不正なtargetPathです: ' + targetPath);
  }
  return norm;
}

function main() {
  const manifests = listJobManifests(SCHED_DIR);
  const now = Date.now();
  let published = 0, failed = 0, skipped = 0;

  for (const manifestPath of manifests) {
    let job = null;
    try {
      job = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (e) {
      quarantine(manifestPath, null, 'ジョブ票のJSON解析エラー: ' + e.message);
      failed++;
      continue;
    }
    try {
      if (!job.publishAt) throw new Error('publishAtがありません');
      const t = new Date(job.publishAt).getTime();
      if (Number.isNaN(t)) throw new Error('publishAtの日付形式が不正です: ' + job.publishAt);
      if (t > now) { skipped++; continue; }
      if (!Array.isArray(job.files) || job.files.length === 0) throw new Error('filesが空です');

      for (const f of job.files) {
        if (!f || !f.storedName || !f.targetPath) throw new Error('files定義が不正です');
        const safeTarget = safeTargetPath(f.targetPath);
        const src = path.join(SCHED_DIR, f.storedName);
        if (!fs.existsSync(src)) throw new Error('データファイルが見つかりません: ' + f.storedName);
        const dir = path.dirname(safeTarget);
        if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(src, safeTarget);
      }
      for (const f of job.files) {
        const src = path.join(SCHED_DIR, f.storedName);
        if (fs.existsSync(src)) fs.unlinkSync(src);
      }
      fs.unlinkSync(manifestPath);
      published++;
      console.log('公開完了:', job.id || path.basename(manifestPath));
    } catch (e) {
      quarantine(manifestPath, job, e.message || String(e));
      failed++;
      console.error('失敗:', manifestPath, '-', e.message || e);
    }
  }
  console.log(`結果: 公開${published}件 / 保留${skipped}件 / 失敗${failed}件`);
}

main();
