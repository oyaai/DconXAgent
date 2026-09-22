# คู่มือใช้งาน Dconx Agent (ภาษาไทย)

ผู้ช่วยเขียนโค้ดใน VS Code ที่ทำงาน **offline ทั้งหมด** ต่อกับ Ollama บนเครื่องตัวเอง
ไม่ส่งโค้ดออกอินเทอร์เน็ต **ไฟล์ใหม่สร้างให้อัตโนมัติ (มีปุ่ม Undo) ส่วนไฟล์ที่มีอยู่แล้วต้องกด Approve ก่อนเสมอ**

> **หมายเหตุเรื่อง path:** คู่มือนี้ใช้ `D:\DconxAgent` เป็นตัวอย่างเฉยๆ — ให้แทนด้วย path จริงที่คุณ clone/วางโปรเจกต์นี้ไว้บนเครื่องของคุณ (เช่นอาจเป็นโฟลเดอร์ใน `OneDrive\เอกสาร\sourcecode\...` ก็ได้) ถ้า path มีช่องว่างหรือภาษาไทยปนอยู่ ให้ใส่เครื่องหมายคำพูดครอบเสมอ เช่น `cd "C:\Users\Admin\OneDrive\เอกสาร\sourcecode\DconXAgent"`

---

## 1. ติดตั้งครั้งเดียว (ไม่ต้อง `npm run build` ทุกครั้ง)

### 1.1 เตรียม Ollama

ติดตั้ง Ollama จาก https://ollama.com แล้วโหลดโมเดลที่รองรับ **tool calling**:

```
ollama pull qwen2.5-coder:7b
```

รุ่นอื่นที่ใช้ได้: `qwen2.5-coder:14b` (ถ้า RAM พอ), `llama3.1`, `mistral-nemo`
เช็กว่า Ollama ทำงานอยู่: เปิด http://127.0.0.1:11434 ในเบราว์เซอร์ ต้องเห็นคำว่า "Ollama is running"

> โมเดลที่ **ไม่รองรับ tool calling** จะคุยได้อย่างเดียว แก้โค้ดไม่ได้ — ถ้า agent ตอบแต่ข้อความไม่ยอมแก้ไฟล์ ให้สงสัยข้อนี้ก่อน

### 1.2 สร้างไฟล์ .vsix

เปิด PowerShell หรือ cmd แล้วไปที่โฟลเดอร์โปรเจกต์ก่อน (คำสั่งนี้ใช้ได้ทั้งสอง shell และย้าย drive ให้อัตโนมัติ):

```
pushd "D:\DconxAgent"
npm install
npm run package
```

> ⚠️ **อย่าใช้ `cd /d D:\DconxAgent`** — เป็น syntax เฉพาะ cmd เท่านั้น ถ้ารันใน PowerShell จะพยายาม cd เข้าโฟลเดอร์ชื่อ "/d" ที่ไม่มีจริงแล้ว error (มักตามมาด้วย `npm install` ที่รันผิดโฟลเดอร์และหา `package.json` ไม่เจอ)
> ถ้าอยากรู้ว่าตอนนี้ใช้ shell ไหนอยู่: PowerShell พรอมต์จะขึ้นต้นด้วย `PS ` ส่วน cmd จะไม่มี

จะได้ไฟล์ `D:\DconxAgent\dconx-agent.vsix`
(`npm run package` จะรัน typecheck + test + build ให้อัตโนมัติ ถ้า test ไม่ผ่านจะไม่สร้างไฟล์ให้)

### 1.3 ติดตั้งลง VS Code

**วิธีที่ 1 — ผ่านหน้าจอ VS Code**

1. กด `Ctrl+Shift+X` (Extensions)
2. กดปุ่ม `...` มุมขวาบนของแถบ Extensions
3. เลือก **Install from VSIX...**
4. เลือกไฟล์ `D:\DconxAgent\dconx-agent.vsix`
5. Reload เมื่อ VS Code ถาม

**วิธีที่ 2 — ผ่าน command line**

```
code --install-extension D:\DconxAgent\dconx-agent.vsix
```

ติดตั้งเสร็จแล้ว **จบ** — เปิด VS Code โปรเจกต์ไหนก็ใช้ได้เลย ไม่ต้อง F5 ไม่ต้อง build อีก

> อัปเดตภายหลัง: แก้โค้ด → `npm run package` → Install from VSIX ทับอันเดิม → Reload

---

## 1.4 ทางเลือก: ใช้เป็นเว็บ ไม่ต้องพึ่ง VS Code

ถ้า VS Code มีปัญหา (เช่นหาไอคอนไม่เจอ) ใช้ตัวนี้แทนได้เลย **ความสามารถเท่ากันทุกอย่าง**
เพราะใช้ `src/core` ตัวเดียวกัน — guardrails, diff approval, tools, auto-create ครบเหมือนกัน

```
pushd "D:\DconxAgent"
npm install
npm run web -- "D:\path\to\your-project"
```

แล้วเปิด **http://127.0.0.1:3939** ในเบราว์เซอร์

- เปลี่ยนพอร์ต: `npm run web -- "D:\myproject" --port 4000`
- หน้าตาและปุ่มเหมือนใน VS Code ทุกอย่าง (ใช้ไฟล์ UI ชุดเดียวกันจริง ๆ)
- เปิดได้เฉพาะจากเครื่องตัวเอง (bind `127.0.0.1` และปฏิเสธ request ที่ Host ไม่ใช่ localhost)
- กด `Ctrl+C` ที่หน้าต่าง command เพื่อปิด

**ตั้งค่าของเว็บ** อยู่ที่ไฟล์ `dconx.config.json` ในโฟลเดอร์โปรเจกต์ (สร้างให้อัตโนมัติครั้งแรก)

```json
{
  "ollama": { "baseUrl": "http://127.0.0.1:11434", "model": "qwen2.5-coder:7b" },
  "guard": { "maxEditLines": 400, "autoApproveCreate": true }
}
```

**สิ่งที่ต่างจาก extension:** เว็บไม่มี editor เลยใช้ `get_editor_context` กับ `get_diagnostics` ไม่ได้
(ไม่มีไฟล์ที่ "กำลังเปิดอยู่" และไม่มี Problems panel) — ต้องบอก path เอง และใช้ `run_command`
เช่น `npx tsc --noEmit` แทนการดู error ส่วนอื่นเหมือนกันหมด

---

## 1.5 ต่อ Ollama ที่อยู่บนเซิร์ฟเวอร์ (online)

ใช้ได้ทั้ง Ollama บน VPS, ในวง LAN, หรือบริการ cloud ที่ใช้ Ollama API

**ใน VS Code** (`Ctrl+,` → ค้น `dconx.ollama`)

| Setting | ใส่อะไร |
|---|---|
| `baseUrl` | `https://ollama.example.com` — **ใส่แค่ root ห้ามมี `/api` หรือ `/v1` ต่อท้าย** |
| `apiKey` | token ถ้าเซิร์ฟเวอร์ต้องใช้ (ส่งเป็น `Authorization: Bearer ...`) |
| `headers` | header เพิ่มเติม ถ้าผ่าน gateway ที่ต้องใช้ของตัวเอง |
| `requestTimeoutMs` | ค่าเริ่มต้น 5 นาที — เพิ่มถ้าโมเดลใหญ่และเครื่องปลายทางช้า |

**ในเว็บ** ใส่ใน `dconx.config.json` หรือใช้ environment variable ก็ได้:

```
set OLLAMA_BASE_URL=https://ollama.example.com
set OLLAMA_API_KEY=sk-xxxxx
set DCONX_MODEL=qwen2.5-coder:14b
npm run web -- "D:\myproject"
```

> **เรื่อง key:** `OLLAMA_API_KEY` มีลำดับเหนือกว่า setting เสมอ — แนะนำให้ใช้ทางนี้
> เพราะ `apiKey` ใน settings.json เก็บเป็น **ข้อความธรรมดา** และ `dconx.config.json`
> อาจถูก commit ขึ้น git โดยไม่ตั้งใจ (ผมไม่เขียน key ลงไฟล์นี้ให้ตั้งแต่แรกด้วยเหตุผลนี้)

**ถ้าต่อไม่ติด** ข้อความ error จะบอกว่าให้เช็กอะไร ที่เจอบ่อยคือ:

- เซิร์ฟเวอร์ปลายทางต้องสตาร์ตด้วย `OLLAMA_HOST=0.0.0.0 ollama serve` ไม่งั้นมันฟังแค่ localhost ของตัวเอง
- `401`/`403` = ต้องใส่ API key
- `404` = ใส่ baseUrl เกิน เช่นเผลอใส่ `/api` ต่อท้าย

---

## 2. เริ่มใช้งาน

1. เปิดโฟลเดอร์โปรเจกต์ที่อยากให้ agent ช่วย (**ต้องเปิดเป็นโฟลเดอร์** ไม่ใช่เปิดไฟล์เดี่ยว ๆ)
2. กดไอคอน **Dconx Agent** ที่แถบด้านซ้าย (activity bar)
   หรือกด **`Ctrl+Alt+D`** / Command Palette (`Ctrl+Shift+P`) → `Dconx Agent: Open Chat`
3. คลิกคำว่า `model: …` ด้านล่างช่องพิมพ์ เพื่อเลือกโมเดล Ollama
4. พิมพ์สิ่งที่อยากให้ทำ แล้วกด Enter (`Shift+Enter` = ขึ้นบรรทัดใหม่)

ปุ่ม `+` มุมขวาบนของ panel = **เริ่มงานใหม่** (ล้างประวัติการคุย)

---

## 3. สั่งงานยังไงให้ได้ผลดี

### ตัวอย่างที่ใช้ได้จริง

| อยากได้ | พิมพ์แบบนี้ |
|---|---|
| แก้ไฟล์ที่เปิดอยู่ | `ไฟล์นี้ error ตรงไหน ช่วยแก้ให้หน่อย` |
| แก้โค้ดที่ select ไว้ | (ลากคลุมโค้ดก่อน) `refactor ส่วนที่เลือกให้อ่านง่ายขึ้น` |
| หา bug จาก error จริง | `ดู Problems panel แล้วแก้ error ทั้งหมดใน src/` |
| เขียนฟีเจอร์ใหม่ | `เพิ่มฟังก์ชัน validateEmail ใน src/utils.ts พร้อม unit test` |
| รัน test แล้วแก้จนผ่าน | `รัน npm test แล้วแก้ที่ fail จนผ่าน` |
| ทำความเข้าใจโค้ด | `อธิบายว่า src/core/agent.ts ทำงานยังไง` (ไม่แก้ไฟล์) |

### สร้างโปรเจกต์ใหม่ (เช่น React app)

พิมพ์ได้เลย เช่น `สร้าง React app ตัวอย่างให้หน่อย`

ถ้า**ยังไม่ได้บอกว่าจะเอาไว้ที่ไหน** agent จะถามก่อน โดยขึ้นเป็นปุ่มให้กด 3 ตัวเลือก:

| ตัวเลือก | เหมาะกับ |
|---|---|
| **Create in a new folder here** | สร้างโฟลเดอร์ใหม่ใน workspace เช่น `my-react-app/` — ใช้บ่อยที่สุด |
| **Create in `dconx-scratch/` (throwaway)** | แค่อยากลองดู ไม่อยากให้ปนกับโค้ดจริง ลบทิ้งทีหลังได้เลย |
| **Create in the current folder** | ไฟล์ลงที่ root ตรง ๆ — ใช้เมื่อโฟลเดอร์ว่างอยู่แล้วเท่านั้น |

จากนั้นจะ **สร้างไฟล์ให้เลยโดยไม่ต้องกดอะไร** (`package.json` → `public/index.html` → `src/index.js` → `src/App.js`)
แต่ละไฟล์จะขึ้นการ์ด `+ Created ...` พร้อมปุ่ม **Undo** ถ้าไม่เอาก็กดลบทิ้งได้ทันที
พอเสร็จจะบอกคำสั่งที่ต้องรันต่อ เช่น `npm install` แล้ว `npm start`

> agent **ติดตั้ง package เองไม่ได้** (ไม่มีอินเทอร์เน็ต) — `npm install` คุณต้องรันเอง
> เปลี่ยนชื่อโฟลเดอร์ throwaway ได้ที่ setting `dconx.agent.scratchFolder`

**บอกตำแหน่ง/ชื่อโฟลเดอร์มาในประโยคเดียวกันได้เลย ไม่ต้องรอให้ถาม** เช่น
`สร้าง React app ตัวอย่าง สร้างไว้ที่โฟลเดอร์ใหม่ชื่อ my-react-app` หรือ
`...create new folder 'my-react-app' in here` — agent จะอ่านจากประโยคนี้แล้วสร้างให้เลยโดยไม่ถามซ้ำ
(ถ้ายังเจอ agent ถามซ้ำทั้งที่บอกชื่อไปแล้ว แปลว่า vsix ที่ติดตั้งอยู่ยังเป็นเวอร์ชันเก่ากว่าที่แก้จุดนี้ไว้ — ดูข้อ 8 เรื่อง build ใหม่)

**สั่งสร้างโปรเจกต์ใหม่ซ้ำได้เรื่อย ๆ แม้จะมีโปรเจกต์เดิมชื่อเดียวกันอยู่แล้ว** — ถ้าเลือก "Create in a new folder here" แล้วชื่อโฟลเดอร์ที่ agent จะใช้ชนกับของเดิม (เช่นสั่ง "สร้าง React app" ซ้ำอีกรอบ) มันจะเช็กก่อนแล้วเติม `-2`, `-3`, ... ให้เองอัตโนมัติ (เช่น `react-demo-2`) ไม่ทับของเดิมและไม่ค้าง

### เคล็ดลับ

- **บอกไฟล์หรือ select โค้ดไว้ก่อน** — agent จะเรียก `get_editor_context` เห็นว่าคุณเปิดไฟล์ไหนอยู่และเลือกบรรทัดไหน ไม่ต้องพิมพ์ path ยาว ๆ
- **งานใหญ่ให้แบ่งเป็นงานย่อย** — จำกัดไว้ที่ 400 บรรทัดต่อ 1 diff และ 12 รอบต่อ 1 คำสั่ง
- **ถ้า agent เดาผิด ให้กด Reject แล้วบอกใหม่** — มันจะไม่ลองซ้ำเดิม แต่จะถามคุณ
- **โมเดล 7b ทำงานง่าย ๆ ได้ดี** งานที่ต้องคิดหลายขั้นควรใช้ 14b ขึ้นไป

---

## 4. ระบบความปลอดภัย (สำคัญ)

### 4.1 การเขียนไฟล์ — แยกเป็น 2 กรณี

**สร้างไฟล์ใหม่ → อัตโนมัติ ไม่ต้องกด**

ขึ้นการ์ด `+ Created src/App.jsx  12 lines` พร้อมปุ่ม **Undo**
ปลอดภัยเพราะไฟล์ใหม่ไม่ทับของเดิมอะไรเลย และ Undo กดลบได้ทันที
(Undo จะลบให้เฉพาะเมื่อไฟล์ยังเหมือนเดิมทุก byte — ถ้าคุณแก้ไปแล้วมันจะไม่ยอมลบ บอกเหตุผลแทน)

**แก้ไฟล์ที่มีอยู่แล้ว → ต้อง Approve เสมอ**

1. **เปิดหน้า diff** ของ VS Code (ซ้าย = ของเดิม, ขวา = ที่เสนอ)
2. **การ์ดใน panel** พร้อมปุ่ม **Approve** / **Reject**

ยังไม่มีอะไรถูกเขียนทับจนกว่าจะกด Approve — กด Reject แล้วไฟล์เหมือนเดิมทุก byte
ข้อนี้ **ปิดไม่ได้** ไม่ว่าจะตั้งค่ายังไงก็ตาม

อยากให้ถามก่อนสร้างไฟล์ใหม่ด้วย → ปิด `dconx.guard.autoApproveCreate`

### 4.2 การรันคำสั่ง — ต้องอนุมัติทุกครั้ง + อยู่ใน allowlist

agent รันคำสั่งได้เฉพาะที่อยู่ในรายการอนุญาต ค่าเริ่มต้นคือ:

```
npm test, npm run build, npm run typecheck, npm run check, npm run lint,
npx tsc --noEmit, node --version, python -m pytest, pytest,
git status, git diff, git log, git branch
```

- คำสั่งที่มี `;` `&&` `|` `>` `` ` `` `$()` **ถูกปฏิเสธเสมอ** (กันการต่อคำสั่งแอบแฝง เช่น `npm test && rm -rf .`)
- เทียบแบบ token เต็มคำ — อนุญาต `git log` ไม่ได้แปลว่าอนุญาต `git push`
- รันในโฟลเดอร์ root ของ workspace, timeout 2 นาที
- ไม่มี shell จริง รันได้ทีละคำสั่งเดียว

อยากเพิ่มคำสั่ง เช่น `pnpm test` → ใส่ใน Settings ที่ `dconx.guard.commandAllowlist`
ไม่อยากให้รันอะไรเลย → ปิด `dconx.guard.allowCommands`

### 4.3 ไฟล์ที่แตะไม่ได้เด็ดขาด

ถูกบล็อกทั้งอ่านและเขียน:

```
.git/, node_modules/, .env, .env.*, *.pem, *.key, id_rsa*,
package-lock.json, yarn.lock, pnpm-lock.yaml, dist/, build/, out/
```

และออกนอกโฟลเดอร์ workspace ไม่ได้เลย (`..` หรือ path เต็มอย่าง `C:\Windows\...` ถูกปฏิเสธ)

อยากล็อกให้แคบกว่านี้ เช่นให้แก้ได้แต่ `src/` → ตั้ง `dconx.guard.allowGlobs` เป็น `["src/**"]`

---

## 5. ตั้งค่า (Settings)

กด `Ctrl+,` แล้วค้นคำว่า `dconx`

| Setting | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `dconx.ollama.baseUrl` | `http://127.0.0.1:11434` | ที่อยู่ Ollama |
| `dconx.ollama.model` | `qwen2.5-coder:7b` | โมเดลที่ใช้ |
| `dconx.ollama.temperature` | `0.2` | ยิ่งต่ำยิ่งนิ่ง เหมาะกับงานโค้ด |
| `dconx.ollama.numCtx` | `16384` | ขนาด context (ลดลงถ้า RAM ไม่พอ) |
| `dconx.agent.maxIterations` | `12` | จำนวนรอบเรียก tool ต่อ 1 คำสั่ง |
| `dconx.agent.scratchFolder` | `dconx-scratch` | โฟลเดอร์สำหรับงานลองของ (ห้ามขึ้นต้นด้วยจุด) |
| `dconx.guard.denyGlobs` | ดูข้อ 4.3 | ไฟล์ที่ห้ามแตะ |
| `dconx.guard.allowGlobs` | `[]` | ถ้าใส่ จะแก้ได้เฉพาะที่ match |
| `dconx.guard.maxEditLines` | `400` | จำนวนบรรทัดสูงสุดต่อ 1 diff |
| `dconx.guard.maxFileBytes` | `262144` | ขนาดไฟล์สูงสุดที่อ่าน/เขียน |
| `dconx.guard.allowCreate` | `true` | ให้สร้างไฟล์ใหม่ได้ไหม |
| `dconx.guard.autoApproveCreate` | `true` | สร้างไฟล์ใหม่โดยไม่ต้องกด Approve (ไฟล์เดิมไม่เกี่ยว) |
| `dconx.guard.allowCommands` | `true` | ให้รันคำสั่งได้ไหม |
| `dconx.guard.commandAllowlist` | ดูข้อ 4.2 | คำสั่งที่อนุญาต |
| `dconx.guard.commandTimeoutMs` | `120000` | timeout ของคำสั่ง |

---

## 6. เครื่องมือที่ agent มี

| Tool | ทำอะไร | ต้อง approve? |
|---|---|---|
| `get_editor_context` | ดูว่าเปิดไฟล์ไหน select อะไรไว้ | ไม่ |
| `list_files` | ดูรายชื่อไฟล์ | ไม่ |
| `read_file` | อ่านไฟล์ | ไม่ |
| `search_files` | ค้นหาด้วย regex | ไม่ |
| `get_diagnostics` | อ่าน error/warning จาก Problems panel | ไม่ |
| `replace_in_file` | แก้โค้ดบางส่วน | **ใช่** |
| `write_file` | สร้างไฟล์ใหม่ | ไม่ (auto + Undo) |
| `write_file` | เขียนทับไฟล์เดิม | **ใช่** |
| `pick_folder_name` | หาชื่อโฟลเดอร์ที่ไม่ชนกับที่มีอยู่แล้ว (ต่อ `-2`, `-3`... ให้อัตโนมัติ) ใช้ตอนเริ่มโปรเจกต์ใหม่ | ไม่ |
| `run_command` | รันคำสั่งใน allowlist | **ใช่** |
| `ask_user` | ถามคุณพร้อมปุ่มให้กดเลือก | ไม่ |
| `attempt_completion` | สรุปงานที่ทำเสร็จ | ไม่ |

agent **ไม่มี**: การเข้าถึงอินเทอร์เน็ต, การลบไฟล์, shell แบบอิสระ

---

## 7. แก้ปัญหาที่เจอบ่อย

**`Cannot reach Ollama at http://127.0.0.1:11434`**
Ollama ไม่ได้เปิดอยู่ → เปิดแอป Ollama หรือรัน `ollama serve` แล้วลองใหม่

**กดเลือกโมเดลแล้วขึ้นว่าไม่มีโมเดล**
ยังไม่ได้ pull → `ollama pull qwen2.5-coder:7b`

**agent ตอบเป็นข้อความอย่างเดียว ไม่ยอมแก้ไฟล์**
โมเดลไม่รองรับ tool calling → เปลี่ยนเป็น `qwen2.5-coder` หรือ `llama3.1`

**agent พิมพ์เมนูออกมาแล้วให้ "ตอบเป็นตัวเลข 1/2/3"**
เป็นนิสัยของโมเดลเล็ก — ระบบสั่งห้ามไว้แล้วและให้ใช้ปุ่มกดแทน (`ask_user`)
ถ้ายังเจออยู่ แปลว่าโมเดลเล็กเกินไปสำหรับงานนั้น → ลอง `qwen2.5-coder:14b`
ระหว่างนี้พิมพ์ตอบเป็นข้อความได้เลย เช่น `เอาข้อ 1` หรือบอกตรง ๆ ว่า `สร้างในโฟลเดอร์ใหม่ชื่อ my-app`

**`No workspace folder is open`**
เปิดไฟล์เดี่ยวอยู่ → ใช้ File > Open Folder เปิดทั้งโฟลเดอร์

**ขึ้น `GUARD: …` สีแดง**
ไม่ใช่ error ของโปรแกรม แต่เป็นกฎความปลอดภัยที่ทำงาน — ข้อความจะบอกว่าติดกฎข้อไหน agent จะปรับวิธีเองต่อ

**`Stopped after 12 tool rounds`**
งานใหญ่เกิน 1 รอบ → พิมพ์ `ทำต่อ` เพื่อให้ไปต่อ หรือเพิ่ม `dconx.agent.maxIterations`

**ช้ามาก**
โมเดลใหญ่เกินเครื่อง → ลองรุ่น 7b, ลด `numCtx` เหลือ 8192, หรือปิดโปรแกรมที่กิน RAM

**หาไอคอน Dconx Agent ใน activity bar ไม่เจอ**

ไล่ตามลำดับนี้:

1. กด `Ctrl+Alt+D` หรือ `Ctrl+Shift+P` → พิมพ์ `Dconx` — **ถ้าเห็นคำสั่ง แปลว่า extension ติดตั้งแล้ว** เป็นแค่ปัญหาไอคอนไม่โผล่ (ใช้คำสั่งนี้เปิด panel ได้เลย)
2. **คลิกขวาที่ activity bar** → ดูว่า `Dconx Agent` ถูกติ๊กออกอยู่หรือเปล่า (VS Code รุ่นใหม่ซ่อนไอคอนได้ และบางทีซ่อนค้างหลังติดตั้งทับ) ถ้ามีปุ่ม `...` ให้ดูใน **Hidden items** ด้วย
3. เช็กว่าติดตั้งจริงไหม: `Ctrl+Shift+X` → พิมพ์ `@installed dconx` — ต้องเห็น **Dconx Agent**
4. ถ้าไม่เห็นในข้อ 3 แปลว่าติดตั้งไม่ติด → ติดตั้งใหม่ด้วย `code --install-extension D:\DconxAgent\dconx-agent.vsix` แล้วปิด VS Code **ทั้งโปรแกรม** เปิดใหม่ (แค่ Reload Window บางทีไม่พอ)
5. เช็กจาก command line ว่าติดตั้งจริงไหม — เปิด cmd แล้วพิมพ์:
   ```
   code --list-extensions
   ```
   ต้องเห็นบรรทัด `dconx.dconx-agent` ถ้าไม่เห็น = ยังไม่ได้ติดตั้งจริง
6. ดู error ตอน VS Code โหลด extension: `Ctrl+Shift+U` (Output) → เลือก **Extension Host** จาก dropdown มุมขวาบน → หาคำว่า `dconx`
7. ดู error ของหน้าจอ: `Ctrl+Shift+P` → `Developer: Toggle Developer Tools` → แท็บ Console หา error สีแดงที่มีคำว่า `dconx`
8. ลองแบบ dev mode เพื่อแยกว่าเป็นปัญหาของ VSIX หรือของโค้ด: เปิด `D:\DconxAgent` ใน VS Code แล้วกด `F5` — ถ้าหน้าต่างใหม่เห็นไอคอน แปลว่าโค้ดปกติ ปัญหาอยู่ที่ขั้นตอนติดตั้ง
9. **ถ้ายังไม่ได้ ใช้เว็บแทนไปก่อน** (ข้อ 1.4) ความสามารถเท่ากันทุกอย่าง

**แก้โค้ดใน D:\DconxAgent แล้วแต่ extension ไม่เปลี่ยน**
ต้อง `npm run package` แล้ว Install from VSIX ใหม่ทุกครั้ง (ตัวที่ติดตั้งไปแล้วเป็นสำเนา ไม่ได้ลิงก์กับโฟลเดอร์นี้)

---

## 8. สำหรับตอนพัฒนาตัว extension เอง

ถ้าจะแก้ตัว agent เอง ใช้โหมด dev จะเร็วกว่า:

```
npm run watch     # build อัตโนมัติเมื่อแก้ไฟล์
```

แล้วกด `F5` ใน VS Code — จะเปิดหน้าต่างใหม่ที่โหลด extension จากโฟลเดอร์นี้โดยตรง
แก้โค้ดแล้วกด `Ctrl+R` ในหน้าต่างนั้นเพื่อ reload ไม่ต้อง package ใหม่

คำสั่งอื่น:

```
npm run check      # typecheck + test ทั้งหมด (263 assertions)
npm test           # test อย่างเดียว
npm run typecheck  # เช็ก type อย่างเดียว
```

โครงสร้างโค้ดและวิธีเพิ่ม tool ใหม่ อ่านที่ `ARCHITECTURE.md`
