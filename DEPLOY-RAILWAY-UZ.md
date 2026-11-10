# Telegramga o‘xshash chat — bitta internet serveriga joylashtirish

Bu loyihada **frontend va backend bitta Node.js xizmatida** ishlaydi. Tashqaridagi foydalanuvchilar `https://...up.railway.app` havolasini ochishadi, `localhost` kerak emas. Google OAuth ishlashi uchun HTTPS domen zarur.

## 1. GitHub repozitoriy tayyorlang

1. ZIPni kompyuterda oching.
2. https://github.com/new orqali yangi, yaxshisi **private** repository yarating.
3. `telegram-chat` papkasi ichidagi fayllarni (`server.js`, `index.html`, `package.json`, `Dockerfile` va boshqalar) repo **ildiziga** yuklang. Butun ZIPni bitta fayl sifatida emas.
4. Maxfiy email/sozlamalarni kodga yozmang. `data/` va `.env` fayllarini GitHubga yuklamang.

## 2. Railway bitta server yaratsin

1. https://railway.com/ saytiga kiring va loyiha yarating: **New Project → Deploy from GitHub repo**.
2. Reponi tanlang. Railway mavjud `Dockerfile` orqali Node.js 22 serverini ishga tushiradi.
3. **Variables** bo‘limiga quyidagilarni kiriting:
   - `OWNER_EMAIL` = o‘zingiz login qiladigan Google akkaunt elektron pochtasi
   - `GOOGLE_CLIENT_ID` = Google Cloud'dan olingan Web application OAuth client ID
   - `NODE_ENV` = `production`
   - `DEV_LOGIN` = kiritmang (sinov rejimi internetda taqiqlangan)
   - `PORT` = kiritish shart emas; Railway avtomatik belgilaydi
4. **Settings → Networking → Public Networking → Generate Domain** orqali HTTPS manzil oling. Masalan `https://sizning-chat.up.railway.app` (faqat misol; sizning haqiqiy havolangiz boshqa bo‘ladi).
5. Server tekshiruvi: `https://sizning-haqiqiy-domeningiz/health` → `{"ok":true}` qaytishi kerak.

## 3. Google login ishlashi uchun ruxsat bering

1. https://console.cloud.google.com/apis/credentials dagi OAuth **Web application** clientini oching.
2. **Authorized JavaScript origins** ichiga Railway bergan to‘liq originni qo‘shing, masalan: `https://sizning-chat.up.railway.app`. Oxirida `/` yoki `/auth/google` bo‘lmasin.
3. Client ID qiymati Railway'dagi `GOOGLE_CLIENT_ID` bilan bir xil bo‘lsin.
4. Google Auth Platform / OAuth consent screen bo‘limida loyiha sozlamalarini tekshiring. **Testing** rejimida faqat test users ro‘yxatidagi Google hisoblar kira olishi mumkin.
5. Sayt orqali aynan `OWNER_EMAIL` sifatida belgilangan Google akkaunt bilan kiring — shu hisob administrator bo‘ladi. Qolgan foydalanuvchilar uning tasdiqlashini kutadi.

Bu dastur Google Sign In ID tokenlarini ishlatadi: odatdagi JavaScript popup kirishda **Authorized redirect URI** shart emas.

## 4. Xabarlar o‘chib ketmasligi uchun doimiy xotira (muhim)

1. Railway loyihasida chat xizmatiga **Volume** qo‘shing.
2. Volume mount path: `/data` (masalan).
3. Server `RAILWAY_VOLUME_MOUNT_PATH` ni avtomatik o‘qiydi; `DATA_DIR` yozish shart emas. Agar uni alohida yozsangiz, disk bilan mos yo‘l ko‘rsating: `DATA_DIR=/data`.
4. Xabarlar `db.json` da, yuborilgan rasmlar `uploads/` papkasida saqlanadi. Volume ulanmasa, deploy va restartlarda fayllar yo‘qolishi mumkin.
5. Bitta xizmatni **1 replika** bilan ishlating. JSON-fayl bazasi bir nechta server nusxalari uchun mo‘ljallanmagan.
6. Doimiy diskning **backup** nusxalarini olib boring.

## 5. Qanday ishlaydi?

- Foydalanuvchi telefon yoki kompyuterdan HTTPS manzilni ochadi.
- `Google bilan kirish` tugmasi chiqadi. Dastlab egasining emaili bilan kiring.
- Keyin boshqa foydalanuvchilar kirsa, ularning ruxsat so‘rovini administrator panelidan qabul qiling.
- Guruhlar, shaxsiy chat, rasm va xabarlar aynan shu bitta serverda ishlaydi.

## Muhim eslatmalar

- Bu Telegramning rasmiy xizmatiga ulanmaydi; alohida xususiy chat sayti.
- Hosting, saqlash xotirasi va trafik uchun to‘lov bo‘lishi mumkin. Reja va narxlarni Railway'da tekshiring.
- `GitHub Pages` yoki oddiy `Cloudflare Pages` statik hostingida `server.js` doimiy ishlamaydi. Buning uchun Node.js serveri kerak.
- HTTPS, maxfiylik va zaxira nusxasini nazorat qiling. Bu kod kichik guruhlar uchun namuna; maxfiy, yuqori xavfsizlik talab qiladigan yozishmalar uchun mustaqil xavfsizlik auditi zarur.
- `START-WINDOWS.bat` / `START-MAC-LINUX.sh` faqat kompyuterdagi lokal test uchun; Railway ularni ishlatmaydi.
- Sayt ochilmasa: Railway deployment logs, environment variables, Google Authorized JavaScript origins va `/health` ni tekshiring.
