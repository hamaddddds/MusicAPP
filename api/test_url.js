import https from 'https';

const url = "https://rr2---sn-4pcxgoxupq-jb3e.googlevideo.com/videoplayback?expire=1784710291&ei=MzBgaryNB4uu4-EP996H8Aw&ip=218.33.80.221&id=o-AKIaCpJR2u1Ous2e2_49svyd68Y8ju9pCYiW455xYmZy&itag=251&source=youtube&requiressl=yes&xpc=EgVo2aDSNQ%3D%3D&cps=350&met=1784688691%2C&mh=QH&mm=31%2C29&mn=sn-4pcxgoxupq-jb3e%2Csn-npoeenek&ms=au%2Crdu&mv=m&mvi=2&pl=24&rms=au%2Cau&gcr=id&initcwndbps=752500&bui=AZFlqhOfsPsKyKv27Sr6Sx7AX-RhFuLQGBOlLJSmbECWC8DmJgR8LUfqJ3jsbiv_tyfs8MgT9ZVPQYtV&spc=SQ-umitO1ZG7t_FIK90ACHekwjN9sKRypgPT9cb8ahgfuPmb3UC_bZX4OMXo9c_ipENfsUkmNcB2I5Ndynskww&vprv=1&svpuc=1&mime=audio%2Fwebm&ns=hPG1S7gT4a1iLghRjrr6XiEW&rqh=1&gir=yes&clen=5199799&dur=304.301&lmt=1770711357425574&mt=1784688055&fvip=2&keepalive=yes&lmw=1&fexp=51565115%2C51992867%2C52019391&c=TVHTML5&sefc=1&txp=5532534&n=Sar1OcSOqJjbXeGo-I0F&sparams=expire%2Cei%2Cip%2Cid%2Citag%2Csource%2Crequiressl%2Cxpc%2Cgcr%2Cbui%2Cspc%2Cvprv%2Csvpuc%2Cmime%2Cns%2Crqh%2Cgir%2Cclen%2Cdur%2Clmt&lsparams=cps%2Cmet%2Cmh%2Cmm%2Cmn%2Cms%2Cmv%2Cmvi%2Cpl%2Crms%2Cinitcwndbps&lsig=APaTxxMwRQIgAReLV_ggyI_Ti0fAGBjcGozhPptuhxO2YHWmY7Ra5jcCIQCDMtpFQXmEQ6-ZF5o8ez5cFdtNYoX5EiZJMGQi4ejFDA%3D%3D";

https.get(url, (res) => {
  console.log("Status:", res.statusCode);
}).on('error', (e) => {
  console.error("Error:", e);
});
