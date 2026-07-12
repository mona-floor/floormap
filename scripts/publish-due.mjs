import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd(), dir=path.join(root,'scheduled'), done=path.join(root,'published'), failed=path.join(root,'failed');
if(!fs.existsSync(dir)) process.exit(0);
fs.mkdirSync(done,{recursive:true});

// 予約票のみ対象。データファイル(例: 20260801-0900-ab1cd--version.json)は「--」を含むため除外する
const jobNames=fs.readdirSync(dir).filter(n=>n.endsWith('.json')&&!n.includes('--')).sort();
let hadFailure=false;

for(const name of jobNames){
  const jsonPath=path.join(dir,name);
  try{
    const job=JSON.parse(fs.readFileSync(jsonPath,'utf8'));
    const publishTime=Date.parse(job.publishAt);
    if(!Number.isFinite(publishTime)) throw new Error(`Invalid publishAt: ${job.publishAt}`);
    if(publishTime>Date.now()) continue;
    const files=Array.isArray(job.files)?job.files.map(f=>({storedName:f.storedName,targetPath:f.targetPath})):[{storedName:job.mapFile,targetPath:job.targetPath}];
    for(const file of files){
      if(typeof file.storedName!=='string'||!/^[\w.-]+(--[\w.-]+)?$/.test(file.storedName)||file.storedName.includes('..')) throw new Error(`Invalid storedName: ${file.storedName}`);
      if(typeof file.targetPath!=='string') throw new Error(`Missing targetPath`);
      const target=path.resolve(root,file.targetPath);
      const rel=path.relative(root,target);
      if(rel.startsWith('..')||path.isAbsolute(rel)) throw new Error(`Invalid targetPath: ${file.targetPath}`);
      // 自分自身の仕組みを上書きさせない
      const top=rel.split(path.sep)[0];
      if(['scheduled','published','failed','.github','scripts'].includes(top)) throw new Error(`Protected targetPath: ${file.targetPath}`);
      if(!fs.existsSync(path.join(dir,file.storedName))) throw new Error(`Scheduled file not found: ${file.storedName}`);
    }
    // 全ファイルの検証を通過してからコピー(途中失敗による中途半端な公開を防ぐ)
    for(const file of files){
      const target=path.resolve(root,file.targetPath);
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.copyFileSync(path.join(dir,file.storedName),target);
    }
    for(const file of files) fs.renameSync(path.join(dir,file.storedName),path.join(done,file.storedName));
    fs.renameSync(jsonPath,path.join(done,name));
    console.log(`Published ${files.map(f=>f.targetPath).join(', ')}`);
  }catch(err){
    // 不正な予約票1件で全体を止めない。failed/ へ退避して次のジョブへ進む
    hadFailure=true;
    console.error(`[SKIP] ${name}: ${err.message}`);
    try{
      fs.mkdirSync(failed,{recursive:true});
      fs.renameSync(jsonPath,path.join(failed,name));
      fs.writeFileSync(path.join(failed,name+'.error.txt'),`${new Date().toISOString()}\n${err.message}\n`);
    }catch(moveErr){console.error(`[WARN] could not quarantine ${name}: ${moveErr.message}`)}
  }
}
if(hadFailure) process.exitCode=0; // 退避済みなのでワークフロー自体は成功扱い(コミットで failed/ が残る)
