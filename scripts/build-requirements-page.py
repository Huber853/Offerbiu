# -*- coding: utf-8 -*-
"""由三份 Offerbiu CSV 生成自包含的展示型 HTML 页面。

用法：
    python scripts/build-requirements-page.py

输入： docs/Offerbiu-需求清单.csv
       docs/Offerbiu-验收要点清单.csv
       docs/Offerbiu-用况清单.csv
输出： docs/Offerbiu-需求与验收总览.html
"""
import csv, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'docs')


def load(name):
    with open(os.path.join(DOCS, name), encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))


REQ = load('Offerbiu-需求清单.csv')
ACC = load('Offerbiu-验收要点清单.csv')
UC = load('Offerbiu-用况清单.csv')


def jsdump(obj):
    return json.dumps(obj, ensure_ascii=False).replace('<', '\\u003c').replace('-->', '--\\u003e')


DATA = {'req': REQ, 'acc': ACC, 'uc': UC}

HTML = r'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offerbiu 求职工作台 · 需求与验收总览</title>
<style>
:root{
  --bg:#f5f7fc; --bg2:#eef2fa; --panel:#fff; --panel2:#fbfcff;
  --line:#e4e9f2; --line2:#eef1f7;
  --ink:#0f172a; --ink2:#3d4a5f; --ink3:#6b7a90; --ink4:#93a0b4;
  --brand:#2b5cff; --brand2:#6b6bff; --brand-soft:#eef2ff;
  --shadow:0 1px 2px rgba(16,24,40,.04),0 8px 24px -12px rgba(16,24,40,.14);
  --shadow-hi:0 2px 4px rgba(16,24,40,.05),0 18px 44px -18px rgba(43,92,255,.32);
  --r:16px; --r-sm:10px;
  --font:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
  --mono:"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:var(--font);color:var(--ink);background:var(--bg);-webkit-font-smoothing:antialiased;line-height:1.65}
body::before{
  content:"";position:fixed;inset:0;pointer-events:none;z-index:0;
  background:
    radial-gradient(900px 520px at 12% -6%,rgba(43,92,255,.10),transparent 62%),
    radial-gradient(760px 460px at 96% 4%,rgba(139,92,246,.10),transparent 60%),
    radial-gradient(700px 500px at 50% 108%,rgba(20,184,166,.08),transparent 62%);
}
h1,h2,h3,h4{margin:0;line-height:1.3;letter-spacing:-.01em}
p{margin:0}

/* top bar */
.bar{position:fixed;top:0;left:0;right:0;z-index:60;height:60px;backdrop-filter:saturate(180%) blur(14px);
  background:rgba(255,255,255,.78);border-bottom:1px solid var(--line)}
.bar-in{max-width:1180px;margin:0 auto;height:100%;padding:0 22px;display:flex;align-items:center;gap:22px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:15px;letter-spacing:-.02em;white-space:nowrap}
.brand .dot{width:26px;height:26px;border-radius:9px;flex:none;background:linear-gradient(140deg,var(--brand),var(--brand2));
  box-shadow:0 6px 16px -6px rgba(43,92,255,.7);display:grid;place-items:center;color:#fff;font-size:13px;font-weight:800;font-family:var(--mono)}
.brand small{font-weight:500;color:var(--ink3);font-size:12.5px;margin-left:2px}
.nav{display:flex;gap:4px;margin-left:auto;overflow-x:auto;scrollbar-width:none}
.nav::-webkit-scrollbar{display:none}
.nav a{padding:7px 13px;border-radius:999px;font-size:13.5px;color:var(--ink3);font-weight:500;white-space:nowrap;
  transition:background .22s,color .22s}
.nav a:hover{background:var(--bg2);color:var(--ink)}
.nav a.on{background:var(--brand);color:#fff;box-shadow:0 6px 16px -8px rgba(43,92,255,.9)}
.prog{position:fixed;top:0;left:0;height:2.5px;width:0;z-index:70;
  background:linear-gradient(90deg,var(--brand),var(--brand2),#14b8a6);transition:width .1s linear}

/* hero */
.hero{position:relative;min-height:100svh;display:grid;place-items:center;padding:120px 22px 72px;z-index:1;overflow:hidden}
.hero-in{max-width:1040px;width:100%;text-align:center}
.eyebrow{display:inline-flex;align-items:center;gap:8px;padding:6px 15px;border-radius:999px;background:rgba(255,255,255,.85);
  border:1px solid var(--line);color:var(--brand);font-size:12.5px;font-weight:600;letter-spacing:.02em;box-shadow:var(--shadow)}
.eyebrow i{width:7px;height:7px;border-radius:50%;background:var(--brand);animation:pulse 2.2s infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(43,92,255,.5)}55%{box-shadow:0 0 0 7px rgba(43,92,255,0)}}
.hero h1{margin:24px 0 0;font-size:clamp(34px,6.2vw,66px);font-weight:800;letter-spacing:-.035em;
  background:linear-gradient(112deg,#0f172a 8%,#2b5cff 46%,#8b5cf6 78%,#14b8a6 102%);
  -webkit-background-clip:text;background-clip:text;color:transparent;background-size:220% 100%;animation:hue 14s ease-in-out infinite}
@keyframes hue{0%,100%{background-position:0 50%}50%{background-position:100% 50%}}
.hero h2{margin:16px 0 0;font-size:clamp(15px,2.1vw,20px);font-weight:600;color:var(--ink2);letter-spacing:-.01em}
.hero .lede{margin:18px auto 0;max-width:680px;color:var(--ink3);font-size:14.5px}
.hero .lede code{font-family:var(--mono);font-size:12.8px;background:#eef1f8;padding:1px 6px;border-radius:6px;color:var(--ink2)}
.stats{margin:44px auto 0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;max-width:780px}
.stat{background:rgba(255,255,255,.92);border:1px solid var(--line);border-radius:var(--r);padding:20px 14px;
  box-shadow:var(--shadow);transition:transform .3s cubic-bezier(.2,.8,.3,1),box-shadow .3s}
.stat:hover{transform:translateY(-4px);box-shadow:var(--shadow-hi)}
.stat b{display:block;font-size:clamp(26px,4vw,38px);font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums;
  background:linear-gradient(150deg,var(--brand),var(--brand2));-webkit-background-clip:text;background-clip:text;color:transparent}
.stat span{display:block;margin-top:4px;font-size:12.5px;color:var(--ink3);font-weight:500}
.cue{margin-top:52px;display:inline-flex;flex-direction:column;align-items:center;gap:7px;color:var(--ink4);font-size:12px}
.cue svg{animation:bob 1.9s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translateY(0);opacity:.5}50%{transform:translateY(7px);opacity:1}}
.blob{position:absolute;border-radius:50%;filter:blur(70px);opacity:.5;z-index:-1;pointer-events:none}
.blob.b1{width:420px;height:420px;background:#c7d5ff;top:-90px;left:-80px}
.blob.b2{width:380px;height:380px;background:#ded0ff;top:40px;right:-90px}
.blob.b3{width:340px;height:340px;background:#c6f0e9;bottom:-110px;left:32%}

/* sections */
main{position:relative;z-index:1}
.sec{max-width:1180px;margin:0 auto;padding:88px 22px 24px;scroll-margin-top:76px}
.sec-head{max-width:780px;margin-bottom:34px}
.kicker{display:flex;align-items:center;gap:9px;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--brand)}
.kicker::before{content:"";width:22px;height:2px;border-radius:2px;background:linear-gradient(90deg,var(--brand),transparent)}
.sec-head h2{margin-top:12px;font-size:clamp(24px,3.6vw,36px);font-weight:800;letter-spacing:-.03em}
.sec-head p{margin-top:12px;color:var(--ink3);font-size:14.5px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow)}
.rv{opacity:0;transform:translateY(20px);
  transition:opacity .72s cubic-bezier(.2,.8,.3,1),transform .72s cubic-bezier(.2,.8,.3,1);transition-delay:var(--d,0ms)}
.rv.in{opacity:1;transform:none}

/* distribution */
.dist{display:grid;grid-template-columns:1.35fr .95fr;gap:18px}
.panel{padding:24px}
.panel h3{font-size:15px;font-weight:700;display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.panel h3 em{font-style:normal;font-size:11.5px;font-weight:600;color:var(--ink4);background:var(--bg2);padding:2px 8px;border-radius:999px}
.rows{margin-top:20px;display:flex;flex-direction:column;gap:12px}
.row{display:grid;grid-template-columns:88px 1fr 46px;align-items:center;gap:12px}
.row .nm{color:var(--ink2);font-weight:600;font-size:12.5px;white-space:nowrap}
.row .track{height:9px;border-radius:999px;background:var(--bg2);overflow:hidden}
.row .fill{display:block;height:100%;width:0;border-radius:999px;transition:width 1.05s cubic-bezier(.2,.8,.3,1)}
.row .ct{text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:var(--ink2);font-size:12.5px}
.prio{margin-top:22px;display:flex;flex-direction:column;gap:10px}
.pri{display:flex;align-items:center;gap:11px;padding:11px 13px;border-radius:var(--r-sm);background:var(--panel2);border:1px solid var(--line2)}
.pri i{width:9px;height:9px;border-radius:50%;flex:none}
.pri .txt{flex:1;min-width:0}
.pri b{font-size:13px}
.pri small{display:block;color:var(--ink4);font-size:11.5px;font-weight:400}
.pri .n{margin-left:auto;font-weight:700;font-variant-numeric:tabular-nums;font-size:13px;color:var(--ink2);white-space:nowrap}
.note{margin-top:18px;padding:13px 15px;border-radius:var(--r-sm);background:#fffaf0;border:1px solid #fbe3b8;color:#8a5a06;font-size:12.3px;line-height:1.7}
.note b{color:#7a4d00}

/* filters */
.tools{margin:26px 0 18px;display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.chips{display:flex;flex-wrap:wrap;gap:7px}
.chip{padding:6.5px 13px;border-radius:999px;border:1px solid var(--line);background:#fff;color:var(--ink2);font-size:12.5px;
  font-weight:600;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;gap:7px;font-family:inherit}
.chip:hover{border-color:#c9d4e8;transform:translateY(-1px)}
.chip u{text-decoration:none;font-size:11px;color:var(--ink4);font-variant-numeric:tabular-nums}
.chip.on{background:var(--ink);border-color:var(--ink);color:#fff}
.chip.on u{color:rgba(255,255,255,.72)}
.search{margin-left:auto;position:relative}
.search input{width:246px;padding:9px 13px 9px 34px;border-radius:999px;border:1px solid var(--line);background:#fff;font-size:13px;
  font-family:inherit;color:var(--ink);outline:none;transition:border-color .2s,box-shadow .2s}
.search input:focus{border-color:var(--brand);box-shadow:0 0 0 3.5px rgba(43,92,255,.13)}
.search svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--ink4)}
.count{font-size:12.5px;color:var(--ink4);padding:9px 0}
.group{margin-top:30px}
.group-h{display:flex;align-items:center;gap:11px;margin-bottom:15px;position:sticky;top:68px;z-index:12;
  padding:9px 0;background:linear-gradient(180deg,var(--bg) 62%,rgba(245,247,252,0))}
.group-h b{font-size:14.5px;font-weight:700}
.group-h s{text-decoration:none;font-family:var(--mono);font-size:11.5px;color:var(--ink4);background:#fff;
  border:1px solid var(--line);padding:2px 8px;border-radius:999px}
.group-h hr{flex:1;border:0;height:1px;background:var(--line);margin:0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:15px}

/* requirement cards */
.rc{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:18px 19px 15px;
  box-shadow:var(--shadow);position:relative;overflow:hidden;
  animation:cardIn .5s cubic-bezier(.2,.8,.3,1) both;animation-delay:var(--cd,0ms);
  transition:transform .3s cubic-bezier(.2,.8,.3,1),box-shadow .3s,border-color .3s}
@keyframes cardIn{from{opacity:0;translate:0 16px}to{opacity:1;translate:0 0}}
.rc::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--c,var(--brand));opacity:.9}
.rc:hover{transform:translateY(-3px);box-shadow:var(--shadow-hi);border-color:#d3ddef}
.rc-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.id{font-family:var(--mono);font-size:11.5px;font-weight:600;color:var(--ink4)}
.tag{font-size:11.5px;font-weight:700;padding:2.5px 9px;border-radius:999px;line-height:1.6}
.pa{background:#fdeceb;color:#c0392f}
.pb{background:#fff5e6;color:#a86711}
.pc{background:#eef1f7;color:#5b6a80}
.t-lv{margin-left:auto;font-size:11.5px;font-weight:600;padding:2.5px 9px;border-radius:999px;
  background:color-mix(in srgb,var(--c) 12%,#fff);color:var(--c)}
.rc h4{margin-top:11px;font-size:16px;font-weight:700;letter-spacing:-.015em}
.rc .desc{margin-top:8px;font-size:13.2px;color:var(--ink2);line-height:1.72}
.rc .meta{margin-top:13px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.mt{font-size:11.5px;color:var(--ink3);background:var(--panel2);border:1px solid var(--line2);padding:2.5px 9px;border-radius:7px}
.mt.k{font-family:var(--mono);color:var(--brand);background:var(--brand-soft);border-color:#dbe3ff}
.rc .more{margin:0;max-height:0;overflow:hidden;opacity:0;
  transition:max-height .45s ease,opacity .35s ease,margin-top .45s ease}
.rc.open .more{max-height:640px;opacity:1;margin-top:12px}
.rc.open{padding-bottom:15px}
.rc .more dt{font-size:11.5px;font-weight:700;color:var(--ink4);letter-spacing:.03em;margin-top:10px}
.rc .more dt:first-child{margin-top:0}
.rc .more dd{margin:4px 0 0;font-size:12.7px;color:var(--ink2);line-height:1.7}
.toggle{margin-top:12px;background:none;border:0;padding:0;font-family:inherit;font-size:12.2px;font-weight:600;color:var(--brand);
  cursor:pointer;display:inline-flex;align-items:center;gap:5px}
.toggle svg{transition:transform .3s}
.rc.open .toggle svg{transform:rotate(180deg)}
.empty{padding:56px 20px;text-align:center;color:var(--ink4);font-size:13.5px}

/* acceptance */
.acc-wrap{display:grid;grid-template-columns:300px 1fr;gap:18px;align-items:start}
.acc-side{position:sticky;top:82px;padding:24px}
.ring{position:relative;width:150px;height:150px;margin:6px auto 0}
.ring svg{transform:rotate(-90deg)}
.ring .bgc{stroke:var(--bg2)}
.ring .fgc{stroke:url(#gr);stroke-linecap:round;transition:stroke-dashoffset 1s cubic-bezier(.2,.8,.3,1)}
.ring .val{position:absolute;inset:0;display:grid;place-content:center;text-align:center}
.ring .val b{font-size:32px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums;display:block}
.ring .val span{font-size:11.5px;color:var(--ink4)}
.acc-side .lbl{margin-top:16px;text-align:center;font-size:12.8px;color:var(--ink3)}
.acc-side .lbl b{color:var(--ink)}
.legend{margin-top:22px;display:flex;flex-direction:column;gap:9px;font-size:12.3px;color:var(--ink3)}
.legend div{display:flex;align-items:center;gap:9px}
.legend i{width:9px;height:9px;border-radius:3px;flex:none}
.acc-list{display:flex;flex-direction:column;gap:14px}
.ac{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:19px 21px;box-shadow:var(--shadow);
  transition:transform .3s cubic-bezier(.2,.8,.3,1),box-shadow .3s,border-color .3s,background .35s}
.ac:hover{transform:translateY(-2px);box-shadow:var(--shadow-hi)}
.ac.done{border-color:#bfe8d8;background:linear-gradient(180deg,#fbfffd,#fff)}
.ac-h{display:flex;align-items:center;gap:13px}
.ac-n{width:40px;height:40px;flex:none;border-radius:12px;display:grid;place-items:center;font-family:var(--mono);font-weight:700;
  font-size:14px;color:#fff;background:linear-gradient(140deg,var(--brand),var(--brand2));
  box-shadow:0 8px 18px -10px rgba(43,92,255,.85);transition:background .35s,box-shadow .35s}
.ac.done .ac-n{background:linear-gradient(140deg,#10b981,#34d399);box-shadow:0 8px 18px -10px rgba(16,185,129,.85)}
.ac-h .tt{min-width:0}
.ac-h h4{font-size:15.5px;font-weight:700}
.ac-h p{margin-top:2px;font-size:12.3px;color:var(--ink4)}
.ac-h .st{margin-left:auto;flex:none}
.st-btn{border:1px solid var(--line);background:#fff;color:var(--ink3);font-family:inherit;font-size:12px;font-weight:600;
  padding:6.5px 13px;border-radius:999px;cursor:pointer;transition:all .22s;white-space:nowrap}
.st-btn:hover{border-color:#c9d4e8;color:var(--ink)}
.st-btn.on{background:#10b981;border-color:#10b981;color:#fff;box-shadow:0 8px 18px -10px rgba(16,185,129,.9)}
.ac-body{margin:14px 0 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:11px}
.fld{margin:0;padding:11px 13px;border-radius:var(--r-sm);background:var(--panel2);border:1px solid var(--line2)}
.fld dt{font-size:11px;font-weight:700;color:var(--ink4);letter-spacing:.05em}
.fld dd{margin:5px 0 0;font-size:12.7px;color:var(--ink2);line-height:1.66}
.ac-foot{margin-top:12px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.ac-foot .mt{font-family:var(--mono);font-size:11px;color:var(--brand);background:var(--brand-soft);border-color:#dbe3ff}
.ac-foot .src{margin-left:auto;font-family:inherit;color:var(--ink4);background:var(--panel2);border-color:var(--line2)}

/* use cases */
.tl{position:relative;padding-left:34px}
.tl::before{content:"";position:absolute;left:9px;top:8px;bottom:8px;width:2px;border-radius:2px;opacity:.3;
  background:linear-gradient(180deg,var(--brand),var(--brand2),#14b8a6)}
.uc{position:relative;margin-bottom:16px}
.uc::before{content:"";position:absolute;left:-31px;top:24px;width:12px;height:12px;border-radius:50%;background:#fff;
  border:2.5px solid var(--brand);box-shadow:0 0 0 4px rgba(43,92,255,.13);transition:transform .3s,background .3s}
.uc:hover::before{transform:scale(1.22);background:var(--brand)}
.uc-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:19px 21px;box-shadow:var(--shadow);
  transition:transform .3s cubic-bezier(.2,.8,.3,1),box-shadow .3s}
.uc-card:hover{transform:translateX(3px);box-shadow:var(--shadow-hi)}
.uc-h{display:flex;align-items:center;gap:11px;flex-wrap:wrap}
.uc-h .n{font-family:var(--mono);font-size:11.5px;font-weight:700;color:var(--brand);background:var(--brand-soft);
  border:1px solid #dbe3ff;padding:2.5px 9px;border-radius:999px}
.uc-h h4{font-size:16px;font-weight:700}
.uc-h .who{margin-left:auto;font-size:12px;color:var(--ink3);background:var(--panel2);border:1px solid var(--line2);
  padding:3px 10px;border-radius:999px;font-weight:600;white-space:nowrap}
.flows{margin-top:15px;display:grid;gap:11px}
.fl{display:grid;grid-template-columns:74px 1fr;gap:12px;align-items:start}
.fl .k{font-size:11.5px;font-weight:700;color:var(--ink4);padding-top:2px;letter-spacing:.02em}
.fl .v{font-size:13px;color:var(--ink2);line-height:1.74}
.fl.main .v{color:var(--ink)}
.fl.alt .k{color:#a86711}
.fl.alt .v{color:#7a5a1e}

/* footer */
footer{max-width:1180px;margin:0 auto;padding:56px 22px 64px;color:var(--ink4);font-size:12.5px;line-height:1.85}
footer .fcard{padding:26px 28px;display:grid;grid-template-columns:1fr auto;gap:22px;align-items:center}
footer b{color:var(--ink2)}
footer code{font-family:var(--mono);font-size:11.8px;background:#eef1f8;padding:1.5px 6px;border-radius:6px;color:var(--ink2)}
.up{position:fixed;right:22px;bottom:22px;z-index:55;width:42px;height:42px;border-radius:13px;border:1px solid var(--line);
  background:rgba(255,255,255,.92);backdrop-filter:blur(10px);display:grid;place-items:center;cursor:pointer;box-shadow:var(--shadow);
  opacity:0;transform:translateY(12px) scale(.9);pointer-events:none;transition:all .3s}
.up.on{opacity:1;transform:none;pointer-events:auto}
.up:hover{box-shadow:var(--shadow-hi);color:var(--brand)}
.dots{position:fixed;right:20px;top:50%;transform:translateY(-50%);z-index:55;display:flex;flex-direction:column;gap:11px}
.dots button{width:9px;height:9px;border-radius:50%;border:0;padding:0;background:#c9d4e8;cursor:pointer;transition:all .28s}
.dots button.on{background:var(--brand);height:24px;border-radius:999px}
.dots button:hover{background:var(--brand2)}

@media (max-width:1000px){
  .dist{grid-template-columns:1fr}
  .acc-wrap{grid-template-columns:1fr}
  .acc-side{position:static}
  .dots{display:none}
}
@media (max-width:720px){
  .stats{grid-template-columns:repeat(2,1fr)}
  .nav a{padding:6px 10px;font-size:12.5px}
  .brand small{display:none}
  .search{margin-left:0;width:100%}
  .search input{width:100%}
  .sec{padding:70px 18px 20px}
  .hero{padding:104px 18px 60px}
  .grid{grid-template-columns:1fr}
  footer .fcard{grid-template-columns:1fr}
  .group-h{top:64px}
  .fl{grid-template-columns:1fr;gap:3px}
}
@media (prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  *,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}
  .rv{opacity:1;transform:none}
}
@media print{
  .bar,.up,.dots,.tools,.cue,.prog{display:none}
  body::before{display:none}
  .rv{opacity:1;transform:none}
  .rc,.ac,.uc-card,.card{break-inside:avoid;box-shadow:none}
  .rc .more{max-height:none!important;opacity:1!important;margin-top:12px!important}
  .group-h{position:static}
}
</style>
<noscript><style>
  .rv{opacity:1 !important;transform:none !important}
  .fill{width:100% !important}
  .prog,.dots,.up{display:none}
</style></noscript>
</head>
<body>
<div class="prog" id="prog"></div>

<header class="bar">
  <div class="bar-in">
    <div class="brand"><span class="dot">O</span>Offerbiu<small>需求 · 验收总览</small></div>
    <nav class="nav" id="nav">
      <a href="#top" class="on">首页</a>
      <a href="#req">需求全景</a>
      <a href="#acc">验收要点</a>
      <a href="#uc">用况</a>
    </nav>
  </div>
</header>

<section class="hero" id="top">
  <div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>
  <div class="hero-in">
    <span class="eyebrow"><i></i>2027 届秋招 · 个人求职工作台</span>
    <h1>Offerbiu 需求与验收总览</h1>
    <h2>岗位检索 · 投递跟踪 · 在线简历 · DeepSeek 润色，一体化本地优先工作台</h2>
    <p class="lede">由 <code>需求文档.docx</code> 与 <code>需求分析.docx</code>（含验收要点与用况）逐条整理，经 <code>docs/Offerbiu-*.csv</code> 生成。</p>
    <div class="stats">
      <div class="stat"><b data-n="__N_REQ__">0</b><span>需求条目</span></div>
      <div class="stat"><b data-n="8">0</b><span>需求层级</span></div>
      <div class="stat"><b data-n="__N_ACC__">0</b><span>验收要点</span></div>
      <div class="stat"><b data-n="__N_UC__">0</b><span>用况</span></div>
    </div>
    <div class="cue">
      <span>向下滚动查看</span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
    </div>
  </div>
</section>

<main>
  <section class="sec" id="req">
    <div class="sec-head rv">
      <div class="kicker">Requirements</div>
      <h2>需求全景</h2>
      <p>共 __N_REQ__ 条需求，按层级归入 8 个类别，覆盖项目概述、用户与角色、系统目标、功能需求、非功能需求、架构需求、边界约束与验收结论。</p>
    </div>

    <div class="dist">
      <div class="card panel rv">
        <h3>层级分布 <em>共 __N_REQ__ 条</em></h3>
        <div class="rows" id="distRows"></div>
      </div>
      <div class="card panel rv" style="--d:110ms">
        <h3>优先级分布 <em>按原文语气推断</em></h3>
        <div class="prio" id="prioRows"></div>
        <div class="note"><b>说明：</b>两份原始文档均未定义优先级与验收方式，此处按「需要 / 应 / 支持」的措辞映射为必做、重要、可选，可直接在 CSV 中修改后重新生成。</div>
      </div>
    </div>

    <div class="tools rv" style="--d:80ms">
      <div class="chips" id="chips"></div>
      <div class="search">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <input id="q" type="search" placeholder="搜索编号、需求项、描述…">
      </div>
    </div>
    <div class="count" id="count"></div>
    <div id="reqBody"></div>
  </section>

  <section class="sec" id="acc">
    <div class="sec-head rv">
      <div class="kicker">Acceptance</div>
      <h2>验收要点</h2>
      <p>需求分析文档「六、验收要点」共 __N_ACC__ 项。点击卡片右侧按钮可模拟勾选验收状态，进度环会实时更新（仅本页交互，不写回文件）。</p>
    </div>

    <div class="acc-wrap">
      <div class="card acc-side rv">
        <h3>验收进度</h3>
        <div class="ring">
          <svg width="150" height="150" viewBox="0 0 150 150" aria-hidden="true">
            <defs><linearGradient id="gr" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#2b5cff"/><stop offset="1" stop-color="#14b8a6"/>
            </linearGradient></defs>
            <circle class="bgc" cx="75" cy="75" r="63" fill="none" stroke-width="11"/>
            <circle class="fgc" id="ring" cx="75" cy="75" r="63" fill="none" stroke-width="11"/>
          </svg>
          <div class="val"><div><b id="ringNum">0</b><span>/ __N_ACC__ 通过</span></div></div>
        </div>
        <div class="lbl">当前交付状态：<b>已开发、未测试</b></div>
        <div class="legend">
          <div><i style="background:#2b5cff"></i>未验收 — 需实际测试后确认</div>
          <div><i style="background:#10b981"></i>已通过 — 本页模拟勾选状态</div>
        </div>
      </div>
      <div class="acc-list" id="accList"></div>
    </div>
  </section>

  <section class="sec" id="uc">
    <div class="sec-head rv">
      <div class="kicker">Use Cases</div>
      <h2>用况</h2>
      <p>__N_UC__ 个用况覆盖从启动服务、注册登录，到岗位投递、简历润色、日程管理、导出备份与岗位重新采集的完整链路。</p>
    </div>
    <div class="tl" id="ucList"></div>
  </section>
</main>

<footer>
  <div class="card fcard">
    <div>
      <p><b>数据来源：</b><code>需求文档.docx</code>（Offerbiu 求职工作台需求文档）、<code>需求分析.docx</code>（需求分析 + 六、验收要点 + 七、用况）。</p>
      <p style="margin-top:9px"><b>中间产物：</b><code>docs/Offerbiu-需求清单.csv</code>、<code>docs/Offerbiu-验收要点清单.csv</code>、<code>docs/Offerbiu-用况清单.csv</code>；本页由 <code>scripts/build-requirements-page.py</code> 生成。</p>
      <p style="margin-top:9px"><b>口径提示：</b>需求分析文档仍写「196 条岗位」为早期口径，现口径以需求文档为准 —— 6373 条岗位／约 40 家企业。项目已开发，但未执行编译、测试或浏览器验收。</p>
    </div>
    <div style="text-align:right;white-space:nowrap">
      <div style="font-weight:700;color:var(--ink2);font-size:13px">Offerbiu</div>
      <div>整理日期 2026-09-23</div>
    </div>
  </div>
</footer>

<button class="up" id="up" aria-label="回到顶部">
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 19V6M6 12l6-6 6 6"/></svg>
</button>
<div class="dots" id="dots"></div>

<script id="payload" type="application/json">__DATA__</script>
<script>
(function(){
  'use strict';
  var DATA = JSON.parse(document.getElementById('payload').textContent);
  var REQ = DATA.req, ACC = DATA.acc, UC = DATA.uc;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var LV_COLOR = {
    '项目概述':'#64748b','用户需求':'#0ea5e9','系统目标':'#6366f1','功能需求':'#2b5cff',
    '非功能需求':'#14b8a6','架构需求':'#8b5cf6','边界约束':'#f59e0b','验收结论':'#ef4444'
  };
  var LV_ORDER = ['项目概述','用户需求','系统目标','功能需求','非功能需求','架构需求','边界约束','验收结论'];
  var PRI_CLS = {'必做':'pa','重要':'pb','可选':'pc'};
  var PRI_COLOR = {'必做':'#ef4444','重要':'#f59e0b','可选':'#94a3b8'};
  var PRI_DESC = {'必做':'核心主流程，缺一不可','重要':'支撑性能力，影响体验','可选':'文档未强制的附加项'};

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
    });
  }
  function el(html){
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  /* 层级 / 优先级分布 */
  var byLv = {}, byPri = {};
  REQ.forEach(function(r){
    byLv[r['需求层级']] = (byLv[r['需求层级']] || 0) + 1;
    byPri[r['优先级']] = (byPri[r['优先级']] || 0) + 1;
  });
  var maxLv = Math.max.apply(null, LV_ORDER.map(function(k){ return byLv[k] || 0; })) || 1;
  var distRows = document.getElementById('distRows');
  LV_ORDER.forEach(function(k){
    var n = byLv[k] || 0, c = LV_COLOR[k];
    distRows.appendChild(el(
      '<div class="row"><span class="nm">' + esc(k) + '</span>' +
      '<span class="track"><i class="fill" data-w="' + (n / maxLv * 100).toFixed(2) +
      '" style="background:linear-gradient(90deg,' + c + 'aa,' + c + ')"></i></span>' +
      '<span class="ct">' + n + '</span></div>'
    ));
  });
  var prioRows = document.getElementById('prioRows');
  ['必做','重要','可选'].forEach(function(k){
    var n = byPri[k] || 0;
    prioRows.appendChild(el(
      '<div class="pri"><i style="background:' + PRI_COLOR[k] + '"></i>' +
      '<span class="txt"><b>' + k + '</b><small>' + PRI_DESC[k] + '</small></span>' +
      '<span class="n">' + n + ' 条</span></div>'
    ));
  });

  /* 筛选 + 卡片 */
  var state = {lv:'全部', q:''};
  var chips = document.getElementById('chips');
  function chipHtml(k){
    var n = k === '全部' ? REQ.length : (byLv[k] || 0);
    return '<button class="chip' + (state.lv === k ? ' on' : '') + '" data-lv="' + esc(k) + '">' + esc(k) + ' <u>' + n + '</u></button>';
  }
  chips.innerHTML = chipHtml('全部') + LV_ORDER.map(chipHtml).join('');

  var body = document.getElementById('reqBody');
  var countEl = document.getElementById('count');

  function match(r){
    if(state.lv !== '全部' && r['需求层级'] !== state.lv) return false;
    if(!state.q) return true;
    var hay = ['需求编号','需求层级','所属模块','需求项','需求描述','验收标准','来源文档','备注']
      .map(function(k){ return r[k] || ''; }).join(' ').toLowerCase();
    return hay.indexOf(state.q) !== -1;
  }

  function cardHtml(r){
    var c = LV_COLOR[r['需求层级']] || '#2b5cff';
    var extra = ['验收标准','验收方式','验收结果','来源文档','备注']
      .filter(function(k){ return r[k] && r[k] !== '—'; });
    return '<article class="rc" style="--c:' + c + '">' +
      '<div class="rc-top"><span class="id">' + esc(r['需求编号']) + '</span>' +
        '<span class="tag ' + (PRI_CLS[r['优先级']] || 'pc') + '">' + esc(r['优先级']) + '</span>' +
        '<span class="t-lv">' + esc(r['需求层级']) + '</span></div>' +
      '<h4>' + esc(r['需求项']) + '</h4>' +
      '<p class="desc">' + esc(r['需求描述']) + '</p>' +
      '<div class="meta"><span class="mt">' + esc(r['所属模块']) + '</span>' +
        (r['验收要点'] && r['验收要点'] !== '—' ? '<span class="mt k">' + esc(r['验收要点']) + '</span>' : '') +
        '<span class="mt">' + esc(r['来源文档']) + '</span></div>' +
      (extra.length
        ? '<dl class="more">' + extra.map(function(k){
            return '<dt>' + esc(k) + '</dt><dd>' + esc(r[k]) + '</dd>';
          }).join('') + '</dl>' +
          '<button class="toggle" type="button">展开明细 <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg></button>'
        : '') +
    '</article>';
  }

  function render(){
    var list = REQ.filter(match);
    countEl.textContent = '显示 ' + list.length + ' / ' + REQ.length + ' 条需求';
    if(!list.length){
      body.innerHTML = '<div class="card empty">没有匹配的需求，试试换个关键词或切换层级。</div>';
      return;
    }
    var html = '', cur = null, n = 0;
    list.forEach(function(r){
      if(r['需求层级'] !== cur){
        if(cur) html += '</div></div>';
        cur = r['需求层级'];
        n = list.filter(function(x){ return x['需求层级'] === cur; }).length;
        html += '<div class="group"><div class="group-h"><b>' + esc(cur) + '</b><s>' + n + ' 条</s><hr></div><div class="grid">';
      }
      html += cardHtml(r);
    });
    html += '</div></div>';
    body.innerHTML = html;

    var cards = body.querySelectorAll('.rc');
    Array.prototype.forEach.call(cards, function(card, i){
      card.style.setProperty('--cd', (Math.min(i, 14) * 28) + 'ms');
      var tg = card.querySelector('.toggle');
      if(tg){
        tg.addEventListener('click', function(){
          var open = card.classList.toggle('open');
          tg.firstChild.nodeValue = open ? '收起明细 ' : '展开明细 ';
        });
      }
    });
  }

  chips.addEventListener('click', function(e){
    var b = e.target.closest('.chip');
    if(!b) return;
    state.lv = b.dataset.lv;
    Array.prototype.forEach.call(chips.querySelectorAll('.chip'), function(c){
      c.classList.toggle('on', c === b);
    });
    render();
  });
  var qt;
  document.getElementById('q').addEventListener('input', function(e){
    clearTimeout(qt);
    qt = setTimeout(function(){
      state.q = e.target.value.trim().toLowerCase();
      render();
    }, 140);
  });
  render();

  /* 验收要点 */
  var accList = document.getElementById('accList');
  var done = 0;
  var TOT = ACC.length || 1;
  ACC.forEach(function(a){
    var card = el(
      '<article class="ac">' +
        '<div class="ac-h"><span class="ac-n">' + esc(a['验收编号']) + '</span>' +
          '<div class="tt"><h4>' + esc(a['验收项']) + '</h4><p>' + esc(a['验收要点']) + '</p></div>' +
          '<span class="st"><button class="st-btn" type="button">标记通过</button></span></div>' +
        '<dl class="ac-body">' +
          '<div class="fld"><dt>验收方式</dt><dd>' + esc(a['验收方式']) + '</dd></div>' +
          '<div class="fld"><dt>预期结果</dt><dd>' + esc(a['预期结果']) + '</dd></div>' +
          '<div class="fld"><dt>备注</dt><dd>' + esc(a['备注']) + '</dd></div>' +
        '</dl>' +
        '<div class="ac-foot">' + esc(a['关联需求编号']).split(/\s*\/\s*/).map(function(x){
            return '<span class="mt">' + esc(x) + '</span>';
          }).join('') + '<span class="mt src">' + esc(a['来源文档']) + '</span></div>' +
      '</article>'
    );
    card.querySelector('.st-btn').addEventListener('click', function(){
      var on = card.classList.toggle('done');
      this.classList.toggle('on', on);
      this.textContent = on ? '已通过' : '标记通过';
      done += on ? 1 : -1;
      paintRing();
    });
    accList.appendChild(card);
  });
  var ring = document.getElementById('ring'), ringNum = document.getElementById('ringNum');
  var CIRC = 2 * Math.PI * 63;
  ring.setAttribute('stroke-dasharray', String(CIRC));
  ring.setAttribute('stroke-dashoffset', String(CIRC));
  function paintRing(){
    ring.setAttribute('stroke-dashoffset', String(CIRC * (1 - done / TOT)));
    ringNum.textContent = String(done);
  }

  /* 用况 */
  var ucList = document.getElementById('ucList');
  UC.forEach(function(u){
    ucList.appendChild(el(
      '<article class="uc"><div class="uc-card">' +
        '<div class="uc-h"><span class="n">' + esc(u['用况编号']) + '</span><h4>' + esc(u['用况名称']) + '</h4>' +
          '<span class="who">' + esc(u['参与者']) + '</span></div>' +
        '<div class="flows">' +
          '<div class="fl"><span class="k">前置条件</span><span class="v">' + esc(u['前置条件']) + '</span></div>' +
          '<div class="fl main"><span class="k">基本流</span><span class="v">' + esc(u['基本流']) + '</span></div>' +
          '<div class="fl alt"><span class="k">备选流</span><span class="v">' + esc(u['备选流/异常流']) + '</span></div>' +
          '<div class="fl"><span class="k">后置条件</span><span class="v">' + esc(u['后置条件']) + '</span></div>' +
        '</div>' +
        '<div class="ac-foot">' + esc(u['关联需求编号']).split(/\s*\/\s*/).map(function(x){
            return '<span class="mt">' + esc(x) + '</span>';
          }).join('') + '<span class="mt src">' + esc(u['来源文档']) + '</span></div>' +
      '</div></article>'
    ));
  });

  /* 滚动入场：由滚动扫描驱动，不依赖 IntersectionObserver，避免内容停在透明态 */
  var counters = document.querySelectorAll('.stat b');
  var rvNodes = document.querySelectorAll('.rv');
  var fills = document.querySelectorAll('.fill');
  var statsBox = document.querySelector('.stats');
  var counted = false;

  function animateCount(node){
    var to = parseInt(node.dataset.n, 10) || 0;
    if(reduce){ node.textContent = String(to); return; }
    setTimeout(function(){ node.textContent = String(to); }, 1260);  /* 兜底终值 */
    var t0 = null, dur = 1100;
    function step(ts){
      if(t0 === null) t0 = ts;
      var k = Math.min(1, (ts - t0) / dur);
      node.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if(k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function revealScan(){
    var vh = window.innerHeight || document.documentElement.clientHeight;
    Array.prototype.forEach.call(rvNodes, function(n){
      if(n.classList.contains('in')) return;
      if(n.getBoundingClientRect().top < vh * 0.9) n.classList.add('in');
    });
    Array.prototype.forEach.call(fills, function(n){
      if(n.dataset.done) return;
      if(n.getBoundingClientRect().top < vh * 0.92){
        n.dataset.done = '1';
        n.style.width = n.dataset.w + '%';
      }
    });
    if(statsBox && !counted && statsBox.getBoundingClientRect().top < vh * 0.92){
      counted = true;
      Array.prototype.forEach.call(counters, animateCount);
    }
  }

  /* 滚动进度 / 章节切换 / 侧点 */
  var prog = document.getElementById('prog'), up = document.getElementById('up');
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('#nav a'));
  var IDs = ['top','req','acc','uc'], LABELS = ['首页','需求全景','验收要点','用况'];
  var secs = IDs.map(function(id){ return document.getElementById(id); });
  var dots = document.getElementById('dots');
  LABELS.forEach(function(label, i){
    var b = document.createElement('button');
    b.type = 'button'; b.title = label; b.setAttribute('aria-label', label);
    if(i === 0) b.className = 'on';
    b.addEventListener('click', function(){ secs[i].scrollIntoView({behavior: reduce ? 'auto' : 'smooth'}); });
    dots.appendChild(b);
  });
  var dotBtns = Array.prototype.slice.call(dots.children);
  var ticking = false;
  function onScroll(){
    revealScan();
    var y = window.scrollY || document.documentElement.scrollTop;
    var h = document.documentElement.scrollHeight - window.innerHeight;
    prog.style.width = (h > 0 ? Math.min(100, (y / h) * 100) : 0) + '%';
    up.classList.toggle('on', y > 620);
    var cur = 0;
    secs.forEach(function(s, i){ if(s && s.getBoundingClientRect().top <= 110) cur = i; });
    navLinks.forEach(function(a, i){ a.classList.toggle('on', i === cur); });
    dotBtns.forEach(function(b, i){ b.classList.toggle('on', i === cur); });
    ticking = false;
  }
  function requestTick(){
    if(!ticking){ ticking = true; requestAnimationFrame(onScroll); }
  }
  window.addEventListener('scroll', requestTick, {passive:true});
  window.addEventListener('resize', requestTick);
  onScroll();

  up.addEventListener('click', function(){
    window.scrollTo({top:0, behavior: reduce ? 'auto' : 'smooth'});
  });

  if(!reduce){
    var blobs = document.querySelectorAll('.blob');
    window.addEventListener('scroll', function(){
      var y = window.scrollY;
      if(y > window.innerHeight * 1.2) return;
      Array.prototype.forEach.call(blobs, function(b, i){
        b.style.transform = 'translate3d(0,' + (y * (0.05 + i * 0.045)) + 'px,0)';
      });
    }, {passive:true});
  }
})();
</script>
</body>
</html>
'''

subs = {
    '__N_REQ__': str(len(REQ)),
    '__N_ACC__': str(len(ACC)),
    '__N_UC__': str(len(UC)),
    '__DATA__': jsdump(DATA),
}
for k, v in subs.items():
    HTML = HTML.replace(k, v)

out = os.path.join(DOCS, 'Offerbiu-需求与验收总览.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(HTML)
print('wrote', out)
print('bytes', os.path.getsize(out), '| req', len(REQ), '| acc', len(ACC), '| uc', len(UC))
